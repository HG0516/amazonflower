// 운영 DB 에 1차 안전 묶음 칸이 없는 상태(2026-10-04 실제 운영)에서도
// 관리자 주문 목록·상태 변경·30분 마감 경고·텔레그램 '발주 완료' 버튼이 도는지.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import admin from "../api/admin.js";
import checkDeadlines from "../api/check-deadlines.js";
import orderConfirm from "../api/order-confirm.js";
import { compatFetch, stripColumnFromUrl } from "../lib/schema-compat.mjs";
import confirmPayment from "../api/confirm-payment.js";
import { priceOf } from "../products.mjs";

function mockResponse() {
  return {
    headers: new Map(), statusCode: 200, body: undefined,
    setHeader(n, v) { this.headers.set(String(n).toLowerCase(), v); },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
    send(v) { this.body = v; return this; },
    end() { return this; },
  };
}

// 2026-10-04 운영 DB 에 실제로 없는 칸(anon REST 로 확인)
const MISSING = ["cancel_requested_at", "photo_notice_status", "photo_notified_at", "photo_notify_error",
  "photo_access_expires_at", "payment_method", "payment_status", "payment_key", "approved_at", "receipt_url"];

// 운영과 같은 '칸이 빠진' 가짜 DB. 없는 칸을 조회·조건·본문에 쓰면 PostgREST 처럼 400.
function oldDb(rows, { onPatch } = {}) {
  return (url, method, body) => {
    const sel = (url.searchParams.get("select") || "").split(",");
    for (const c of MISSING) {
      if (sel.includes(c) || url.searchParams.has(c)) {
        return Response.json({ code: "42703", message: `column orders.${c} does not exist` }, { status: 400 });
      }
      if (body && Object.prototype.hasOwnProperty.call(body, c)) {
        return Response.json({ code: "PGRST204", message: `Could not find the '${c}' column of 'orders' in the schema cache` }, { status: 400 });
      }
    }
    const match = (r) => [...url.searchParams.entries()].every(([k, v]) => {
      if (["select", "order", "limit"].includes(k)) return true;
      if (v.startsWith("eq.")) return String(r[k]) === v.slice(3);
      if (v === "is.null") return r[k] == null;
      if (v.startsWith("not.in.(")) return !v.slice(8, -1).split(",").includes(r[k]);
      if (v.startsWith("neq.")) return String(r[k]) !== v.slice(4);
      return true; // gte/lte 등은 시험에서 무시
    });
    if (method === "GET") return Response.json(rows.filter(match));
    if (method === "PATCH") {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, body));
      if (onPatch) onPatch(url, body, hit);
      return Response.json(hit);
    }
    return new Response(null, { status: 201 });
  };
}

function installFetch(db, extra = {}) {
  const calls = { telegram: [], orders: 0 };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/rest/v1/orders") {
      calls.orders++;
      return db(url, method, options.body ? JSON.parse(options.body) : null);
    }
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner-uid" });
    if (url.pathname === "/rest/v1/admin_audit_logs") return new Response(null, { status: 404 });
    if (url.hostname === "api.telegram.org") { calls.telegram.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    if (extra[url.pathname]) return extra[url.pathname](url, method);
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return calls;
}

function withEnv(values, fn) {
  return async () => {
    const keys = [...new Set([...Object.keys(values), "ADMIN_AUTH_MODE", "ADMIN_OWNER_IDS", "CRON_SECRET",
      "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TOSS_SECRET_KEY", "ANTHROPIC_API_KEY"])];
    const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const oldFetch = globalThis.fetch;
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
    try { await fn(); } finally {
      globalThis.fetch = oldFetch;
      for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}
const ENV = {
  SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_ROLE_KEY: "svc",
  ADMIN_AUTH_MODE: "jwt", ADMIN_OWNER_IDS: "owner-uid", CRON_SECRET: "cron-x",
  TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_CHAT_ID: "chat",
};
const adminReq = (body) => ({ method: "POST", headers: { authorization: "Bearer t", origin: "https://floweranbu.co.kr" }, body: { resource: "order", ...body } });

test("칸 빼기는 의미가 같을 때만: select·is.null 은 빼고, 다른 조건은 건드리지 않는다", () => {
  const base = "https://x.test/rest/v1/orders";
  const a = new URL(stripColumnFromUrl(`${base}?select=order_id,cancel_requested_at,status&status=eq.new&cancel_requested_at=is.null`, "cancel_requested_at"));
  assert.equal(a.searchParams.get("select"), "order_id,status");
  assert.equal(a.searchParams.has("cancel_requested_at"), false);
  assert.equal(a.searchParams.get("status"), "eq.new");
  assert.equal(stripColumnFromUrl(`${base}?photo_notice_status=eq.pending`, "photo_notice_status"), null, "eq 조건은 흉내 낼 수 없다");
  assert.equal(stripColumnFromUrl(`${base}?or=(payment_key.is.null,payment_key.eq.x)`, "payment_key"), null);
});

test("모르는 칸 오류·orders 가 아닌 요청은 다시 보내지 않는다", { concurrency: false }, withEnv({}, async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return Response.json({ code: "42703", message: "column orders.typo_col does not exist" }, { status: 400 }); };
  const r = await compatFetch("https://x.test/rest/v1/orders?select=typo_col");
  assert.equal(r.status, 400);
  assert.equal(n, 1, "허용 목록에 없는 칸은 오타일 수 있다 — 숨기지 않는다");
  n = 0;
  await compatFetch("https://api.telegram.org/botx/sendMessage", { method: "POST", body: "{}" });
  assert.equal(n, 1);
}));

test("운영과 같은 옛 DB 에서 관리자 주문 목록이 열린다", { concurrency: false }, withEnv(ENV, async () => {
  const rows = [{ order_id: "AF20261004-1", status: "new", product_label: "꽃다발", amount: 58000, created_at: "2026-10-04T00:00:00Z" }];
  installFetch(oldDb(rows));
  const res = mockResponse();
  await admin(adminReq({ action: "list" }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.orders.length, 1);
}));

test("옛 DB 에서 관리자 '준비중' 표시가 되고, 입금 대기 주문은 여전히 막힌다", { concurrency: false }, withEnv(ENV, async () => {
  const rows = [
    { order_id: "AF20261004-2", status: "new", product_label: "꽃다발" },
    { order_id: "AFB20261004-3", status: "awaiting_deposit", product_label: "꽃다발" },
  ];
  installFetch(oldDb(rows));
  const ok = mockResponse();
  await admin(adminReq({ action: "status", orderId: "AF20261004-2", status: "ordered" }), ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(rows[0].status, "ordered");
  const no = mockResponse();
  await admin(adminReq({ action: "status", orderId: "AFB20261004-3", status: "ordered" }), no);
  assert.equal(no.statusCode, 409);
  assert.equal(rows[1].status, "awaiting_deposit");
}));

test("옛 DB 에서 텔레그램 '발주 완료' 버튼이 접수 주문을 준비중으로 바꾼다", { concurrency: false }, withEnv(ENV, async () => {
  const rows = [{ order_id: "AF20261004-4", status: "new", product_label: "근조화환" }];
  installFetch(oldDb(rows));
  const t = crypto.createHmac("sha256", "cron-x").update("confirm:AF20261004-4").digest("hex").slice(0, 20);
  const res = mockResponse();
  await orderConfirm({ method: "GET", url: `/api/order-confirm?id=AF20261004-4&t=${t}`, headers: {} }, res);
  assert.equal(rows[0].status, "ordered");
}));

test("옛 DB 에서 30분 마감 경고가 다시 간다", { concurrency: false }, withEnv({ ...ENV, TOSS_SECRET_KEY: "s" }, async () => {
  const soon = new Date(Date.now() + 3600000).toISOString();
  const rows = [{ id: 7, order_id: "AF20261004-5", status: "new", alerted_at: null, product_label: "근조화환", recipient_name: "고 김OO", venue: "OO장례식장", order_type: "funeral", event_time: "15:00", event_at: soon }];
  const calls = installFetch(oldDb(rows));
  const res = mockResponse();
  await checkDeadlines({ method: "GET", url: "/api/check-deadlines", headers: { authorization: "Bearer cron-x" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.alerted, 1);
  assert.ok(rows[0].alerted_at, "경고를 보냈다고 표시");
  assert.ok(calls.telegram.length >= 1);
}));

test("SQL 없이(옛 DB) 무통장입금: 주문 접수 → 관리자 목록에 무통장·입금대기 → 입금 확인 → 접수", { concurrency: false },
  withEnv({ ...ENV, TOSS_SECRET_KEY: "s", BANK_TRANSFER_ENABLED: "1" }, async () => {
    const rows = [];
    const db = oldDb(rows);
    const calls = installFetch((url, method, body) => {
      if (method === "POST") {
        // 옛 DB 는 결제 칸을 모른다 — 넣으면 400. 대비책이 빼고 다시 넣어야 한다.
        for (const c of MISSING) if (body && c in body) return Response.json({ code: "PGRST204", message: `Could not find the '${c}' column of 'orders' in the schema cache` }, { status: 400 });
        rows.push({ ...body }); return new Response(null, { status: 201 });
      }
      return db(url, method, body);
    });
    const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
    const order = { productCode: "BQ-001", category: "bouquet", type: "birthday", productLabel: "복주머니", price: priceOf("BQ-001"),
      quantity: 1, toppings: [], recipientName: "김안부", address: "경기 시흥시", date: tomorrow, timeSlot: "am", time: "오전중",
      senderName: "홍길동", senderPhone: "010-1234-5678", depositorName: "홍길동" };
    const r1 = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { action: "bank_order", amount: priceOf("BQ-001"), order } }, r1);
    assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "awaiting_deposit");
    assert.ok(!("payment_method" in rows[0]), "옛 DB 엔 결제 칸 없이 저장");

    const list = mockResponse();
    await admin(adminReq({ action: "list" }), list);
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.orders[0].status, "awaiting_deposit");

    const dep = mockResponse();
    await admin(adminReq({ action: "deposit", orderId: rows[0].order_id }), dep);
    assert.equal(dep.statusCode, 200, JSON.stringify(dep.body));
    assert.equal(rows[0].status, "new");
    assert.ok(calls.telegram.some((t) => /입금 확인 — 발주하세요/.test(t.text)));
  }));
