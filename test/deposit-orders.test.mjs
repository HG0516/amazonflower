// 입금 대기 주문(가상계좌·무통장입금) 시험.
// 실결제 경로를 건드리므로, 돈이 안 들어온 주문이 '접수'로 새지 않는지와
// 기능 스위치가 꺼져 있을 때 지금과 똑같이 동작하는지를 중점으로 본다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import confirmPayment from "../api/confirm-payment.js";
import admin from "../api/admin.js";
import { vaSecretHash, publicPayment, buildOrderRow } from "../lib/payment-integrity.mjs";
import {
  AWAITING, EXPIRED, reconcileDepositOrders, verifyAcceptedPayment,
} from "../lib/deposit-orders.mjs";
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
function withEnv(values, fn) {
  return async () => {
    const keys = [...new Set([...Object.keys(values), "VIRTUAL_ACCOUNT_ENABLED", "BANK_TRANSFER_ENABLED", "TRANSFER_ENABLED",
      "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PAYMENT_INTENTS_REQUIRED", "LIVE_PRICING",
      "ADMIN_AUTH_MODE", "ADMIN_OWNER_IDS", "CRON_SECRET", "REFUND_LINK_SECRET"])];
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
const BASE_ENV = {
  TOSS_SECRET_KEY: "test-secret",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_CHAT_ID: "chat",
};
const PC = "BQ-001";
const PRICE = priceOf(PC);
const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
const ORDER = {
  productCode: PC, category: "bouquet", type: "birthday", productLabel: "복주머니",
  price: PRICE, quantity: 1, toppings: [],
  recipientName: "김안부", address: "경기 시흥시 신천3길 23", date: tomorrow, timeSlot: "am", time: "오전중",
  senderName: "홍길동", senderPhone: "010-1234-5678",
};
const waitingVa = (orderId, paymentKey, amount, extra = {}) => ({
  orderId, paymentKey, totalAmount: amount, status: "WAITING_FOR_DEPOSIT", method: "가상계좌",
  approvedAt: null, secret: "va-secret-1",
  virtualAccount: { accountNumber: "X1234567890", bankCode: "20", customerName: "홍길동", dueDate: "2099-01-01T12:00:00+09:00" },
  ...extra,
});

test("가상계좌 입금 대기는 스위치가 켜졌을 때만, 신원이 맞을 때만 승인으로 본다", () => {
  const p = waitingVa("AF20990101-A", "pk_1", 58000);
  const expected = { orderId: "AF20990101-A", amount: 58000, paymentKey: "pk_1" };
  assert.equal(verifyAcceptedPayment(p, expected, {}).ok, false, "스위치 꺼짐 = 지금과 동일");
  assert.equal(verifyAcceptedPayment(p, expected, { VIRTUAL_ACCOUNT_ENABLED: "1" }).ok, true);
  assert.equal(verifyAcceptedPayment(p, { ...expected, amount: 1 }, { VIRTUAL_ACCOUNT_ENABLED: "1" }).reason, "amount_mismatch");
  assert.equal(verifyAcceptedPayment({ ...p, method: "카드" }, expected, { VIRTUAL_ACCOUNT_ENABLED: "1" }).ok, false,
    "카드인데 WAITING 이면 받지 않는다");
});

test("가상계좌 주문 원장은 접수(new)가 아니라 입금 대기로 저장되고 비밀값은 해시로만 남는다", () => {
  const row = buildOrderRow(ORDER, waitingVa("AF20990101-B", "pk_2", PRICE));
  assert.equal(row.status, AWAITING);
  assert.equal(row.va_account, "X1234567890");
  assert.equal(row.va_bank, "우리은행");
  assert.equal(row.va_secret_hash, vaSecretHash("va-secret-1"));
  assert.ok(!JSON.stringify(row).includes("va-secret-1"), "비밀값 원문은 저장하지 않는다");
  const pub = publicPayment(waitingVa("AF20990101-B", "pk_2", PRICE));
  assert.equal(pub.virtualAccount.accountNumber, "X1234567890");
  assert.equal(pub.virtualAccount.bankName, "우리은행");
  // 카드 결제 행은 그대로(상태 칸을 건드리지 않음)
  const card = buildOrderRow(ORDER, { orderId: "AF20990101-C", paymentKey: "pk", totalAmount: PRICE, status: "DONE", method: "카드" });
  assert.equal(card.status, undefined);
  assert.equal(card.va_account, undefined);
});

// confirm-payment 의 예전(legacy) 경로 — 운영 DB 와 같은 상태(payment_intents 없음)
function legacyConfirmFetch({ tossPayment, inserts, telegrams }) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/rest/v1/payment_intents") return Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 });
    if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json([]);
    if (url.pathname === "/rest/v1/orders" && method === "POST") { inserts.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") return Response.json([{ order_id: "x" }]);
    if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") return Response.json(tossPayment);
    if (url.hostname === "api.tosspayments.com" && url.pathname.startsWith("/v1/payments/orders/")) return Response.json(tossPayment);
    if (url.hostname === "api.telegram.org") { telegrams.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}

test("가상계좌 승인(스위치 켬): 손님 화면에 계좌가 가고, 원장은 입금 대기, 사장님엔 '발주 X' 알림·버튼 없음", { concurrency: false },
  withEnv({ ...BASE_ENV, VIRTUAL_ACCOUNT_ENABLED: "1" }, async () => {
    const orderId = "AF20990101-VA0001";
    const inserts = [], telegrams = [];
    globalThis.fetch = legacyConfirmFetch({ tossPayment: waitingVa(orderId, "pk_va", PRICE), inserts, telegrams });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_va", orderId, amount: PRICE, order: ORDER } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.payment.status, "WAITING_FOR_DEPOSIT");
    assert.equal(res.body.payment.virtualAccount.accountNumber, "X1234567890");
    const saved = inserts.find((r) => r.order_id === orderId);
    assert.ok(saved, "주문이 저장돼야 한다");
    assert.equal(saved.status, AWAITING, "입금 전 주문은 접수(new)로 저장하면 안 된다");
    assert.equal(telegrams.length, 1);
    assert.match(telegrams[0].text, /입금 대기 — 아직 발주하지 마세요/);
    assert.equal(telegrams[0].reply_markup, undefined, "입금 전엔 '발주 완료' 버튼을 달지 않는다");
  }));

test("가상계좌 승인(스위치 끔): 지금과 똑같이 받지 않고 주문도 만들지 않는다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const orderId = "AF20990101-VA0002";
    const inserts = [], telegrams = [];
    globalThis.fetch = legacyConfirmFetch({ tossPayment: waitingVa(orderId, "pk_va2", PRICE), inserts, telegrams });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_va2", orderId, amount: PRICE, order: ORDER } }, res);
    assert.notEqual(res.statusCode, 200);
    assert.equal(inserts.length, 0);
    assert.equal(telegrams.length, 0);
  }));

test("결제수단 설정 조회는 스위치를 그대로 알려준다", { concurrency: false },
  withEnv({ ...BASE_ENV, BANK_TRANSFER_ENABLED: "1" }, async () => {
    const res = mockResponse();
    await confirmPayment({ method: "GET", headers: {}, query: { config: "1" } }, res);
    assert.deepEqual(res.body, { virtualAccount: false, bankTransfer: true, transfer: false });
    const on = mockResponse();
    process.env.TRANSFER_ENABLED = "1";
    await confirmPayment({ method: "GET", headers: {}, query: { config: "1" } }, on);
    assert.equal(on.body.transfer, true);
  }));

// ── 입금 웹훅 ──
function webhookFetch({ row, toss, patches, telegrams, tossStatus = 200 }) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json(row ? [row] : []);
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
      const body = JSON.parse(options.body);
      patches.push({ filter: url.search, body });
      const from = url.searchParams.get("status");
      const matched = row && from === `eq.${row.status}`;
      if (matched) Object.assign(row, body);
      return Response.json(matched ? [{ ...row }] : []);
    }
    if (url.hostname === "api.tosspayments.com") return Response.json(toss, { status: tossStatus });
    if (url.hostname === "api.telegram.org") { telegrams.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}
const vaRow = (over = {}) => ({
  order_id: "AF20990101-VA0003", status: AWAITING, product_label: "복주머니", amount: PRICE, paid_amount: PRICE,
  event_date: tomorrow, sender_name: "홍길동", sender_phone: "01012345678",
  payment_method: "가상계좌", va_secret_hash: vaSecretHash("good-secret"), va_due: "2099-01-01T12:00:00+09:00",
  deposited_at: null, alerted_at: null, ...over,
});
const tossVa = (status, over = {}) => ({
  orderId: "AF20990101-VA0003", paymentKey: "pk_3", totalAmount: PRICE, status, method: "가상계좌",
  approvedAt: status === "DONE" ? "2099-01-01T10:00:00+09:00" : null,
  virtualAccount: { accountNumber: "X1", bankCode: "20", dueDate: "2099-01-01T12:00:00+09:00" }, ...over,
});
const hook = (secret = "good-secret") => ({ method: "POST", headers: {}, query: { hook: "deposit" },
  body: { createdAt: "x", secret, status: "DONE", transactionKey: "t", orderId: "AF20990101-VA0003" } });

test("입금 웹훅: 토스 재조회가 DONE 일 때만 접수로 넘기고, 사장님에게 '발주하세요'를 한 번만 보낸다", { concurrency: false },
  withEnv({ ...BASE_ENV, CRON_SECRET: "cron-x" }, async () => {
    const row = vaRow(), patches = [], telegrams = [];
    globalThis.fetch = webhookFetch({ row, toss: tossVa("DONE"), patches, telegrams });
    const res = mockResponse();
    await confirmPayment(hook(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(row.status, "new");
    assert.equal(telegrams.length, 1);
    assert.match(telegrams[0].text, /입금 확인 — 발주하세요/);
    assert.ok(telegrams[0].reply_markup, "입금 확인 뒤에는 '발주 완료' 버튼이 붙는다");
    // 같은 웹훅이 다시 와도(토스 재전송) 두 번 알리지 않는다
    const res2 = mockResponse();
    await confirmPayment(hook(), res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(telegrams.length, 1);
  }));

test("입금 웹훅 위조: 비밀값이 틀리거나 토스가 아직 입금 전이면 아무것도 바꾸지 않는다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    for (const [secret, toss] of [["bad-secret", tossVa("DONE")], ["good-secret", tossVa("WAITING_FOR_DEPOSIT")]]) {
      const row = vaRow(), patches = [], telegrams = [];
      globalThis.fetch = webhookFetch({ row, toss, patches, telegrams });
      const res = mockResponse();
      await confirmPayment(hook(secret), res);
      assert.equal(res.statusCode, 200);
      assert.equal(row.status, AWAITING);
      assert.equal(patches.length, 0);
      assert.equal(telegrams.length, 0);
    }
  }));

test("입금 웹훅: 토스·DB 일시 오류면 500 을 돌려 토스가 다시 보내게 한다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const row = vaRow(), patches = [], telegrams = [];
    globalThis.fetch = webhookFetch({ row, toss: { message: "x" }, patches, telegrams, tossStatus: 503 });
    const res = mockResponse();
    await confirmPayment(hook(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(row.status, AWAITING);
  }));

test("은행 입금 취소(DONE→WAITING)면 접수에서 입금 대기로 되돌리고 '배송 멈추세요'를 알린다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const row = vaRow({ status: "new", deposited_at: "2099-01-01T10:00:00Z" }), patches = [], telegrams = [];
    globalThis.fetch = webhookFetch({ row, toss: tossVa("WAITING_FOR_DEPOSIT"), patches, telegrams });
    await confirmPayment(hook(), mockResponse());
    assert.equal(row.status, AWAITING);
    assert.match(telegrams[0].text, /입금이 취소됐어요 — 발주·배송 멈추세요/);
  }));

test("크론: 기한 지난 가상계좌는 닫고, 24시간 지난 무통장은 사장님에게 한 번만 알린다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const now = Date.parse("2099-01-02T00:00:00+09:00");
    const rows = [
      vaRow({ order_id: "AF20990101-VA0003" }),
      { order_id: "AFB20990101-OLD1", status: AWAITING, payment_method: "BANK_TRANSFER", created_at: "2098-12-31T20:00:00+09:00", alerted_at: null, product_label: "꽃다발", amount: 58000 },
      { order_id: "AFB20990101-NEW1", status: AWAITING, payment_method: "BANK_TRANSFER", created_at: "2099-01-01T23:00:00+09:00", alerted_at: null, product_label: "꽃다발", amount: 58000 },
    ];
    const byId = Object.fromEntries(rows.map((r) => [r.order_id, r]));
    const telegrams = [], patches = [];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      const oid = (url.searchParams.get("order_id") || "").replace(/^eq\./, "");
      if (url.pathname === "/rest/v1/orders" && method === "GET" && url.searchParams.get("status") === `eq.${AWAITING}`) return Response.json(rows);
      if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json(byId[oid] ? [byId[oid]] : []);
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const r = byId[oid]; const body = JSON.parse(options.body); patches.push({ oid, body });
        const ok = r && url.searchParams.get("status") === `eq.${r.status}` && (!url.searchParams.has("alerted_at") || !r.alerted_at);
        if (ok) Object.assign(r, body);
        return Response.json(ok ? [{ ...r }] : []);
      }
      if (url.hostname === "api.tosspayments.com") return Response.json(tossVa("WAITING_FOR_DEPOSIT"));
      if (url.hostname === "api.telegram.org") { telegrams.push(JSON.parse(options.body).text); return Response.json({ ok: true }); }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const out = await reconcileDepositOrders({ supabaseUrl: BASE_ENV.SUPABASE_URL, serviceKey: "k", secretKey: "s", now });
    assert.equal(byId["AF20990101-VA0003"].status, EXPIRED);
    assert.equal(byId["AFB20990101-OLD1"].status, AWAITING, "무통장은 자동으로 닫지 않는다");
    assert.ok(byId["AFB20990101-OLD1"].alerted_at);
    assert.equal(byId["AFB20990101-NEW1"].alerted_at, null);
    assert.equal(out.bankReminders, 1);
    assert.equal(telegrams.filter((t) => /무통장 입금 기한/.test(t)).length, 1);
    // 다음 크론 때 같은 무통장 건을 또 알리지 않는다
    await reconcileDepositOrders({ supabaseUrl: BASE_ENV.SUPABASE_URL, serviceKey: "k", secretKey: "s", now: now + 1800000 });
    assert.equal(telegrams.filter((t) => /무통장 입금 기한/.test(t)).length, 1);
  }));

// ── 무통장입금 주문 ──
function bankFetch(inserts, telegrams) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/rest/v1/orders" && method === "POST") { inserts.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    if (url.hostname === "api.telegram.org") { telegrams.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}

test("무통장 주문: 스위치가 꺼져 있으면 받지 않는다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const inserts = [], telegrams = [];
    globalThis.fetch = bankFetch(inserts, telegrams);
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { action: "bank_order", amount: PRICE, order: ORDER } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(inserts.length, 0);
  }));

test("무통장 주문: 서버가 금액을 다시 계산하고, 서버가 만든 AFB 번호로 입금 대기 저장", { concurrency: false },
  withEnv({ ...BASE_ENV, BANK_TRANSFER_ENABLED: "1" }, async () => {
    const inserts = [], telegrams = [];
    globalThis.fetch = bankFetch(inserts, telegrams);
    const bad = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { action: "bank_order", amount: PRICE - 1, order: ORDER } }, bad);
    assert.equal(bad.statusCode, 400, "금액이 다르면 거절");
    const custom = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { action: "bank_order", amount: PRICE, order: { ...ORDER, customPay: true } } }, custom);
    assert.equal(custom.statusCode, 400, "맞춤 결제 링크는 무통장 불가");
    assert.equal(inserts.length, 0);

    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: {
      action: "bank_order", orderId: "AF-CLIENT-CHOSEN", amount: PRICE,
      order: { ...ORDER, depositorName: "홍길동(회사)", cashReceiptType: "소득공제", cashReceiptNo: "010-1234-5678" },
    } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.match(res.body.orderId, /^AFB\d{8}-[0-9A-F]{8}$/);
    assert.notEqual(res.body.orderId, "AF-CLIENT-CHOSEN");
    assert.equal(res.body.bank.account, "169-165982-04-025");
    const row = inserts[0];
    assert.equal(row.status, AWAITING);
    assert.equal(row.payment_method, "BANK_TRANSFER");
    assert.equal(row.amount, PRICE);
    assert.match(row.note, /입금자 홍길동\(회사\)/);
    assert.match(row.note, /현금영수증 소득공제 01012345678/);
    assert.match(telegrams[0].text, /무통장입금 입금 대기 — 아직 발주하지 마세요/);
  }));

// ── 관리자 ──
function adminFetch(row, { telegrams, patches, toss } = {}) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner-uid", email: "o@example.test" });
    if (url.pathname === "/rest/v1/admin_audit_logs") return new Response(null, { status: 201 });
    if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json(row ? [row] : []);
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
      const body = JSON.parse(options.body); patches && patches.push({ search: url.search, body });
      const st = url.searchParams.get("status");
      const ok = row && (st === `eq.${row.status}`);
      if (ok) Object.assign(row, body);
      return Response.json(ok ? [{ ...row }] : []);
    }
    if (url.hostname === "api.tosspayments.com") return Response.json(toss || {});
    if (url.hostname === "api.telegram.org") { telegrams && telegrams.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}
const ADMIN_ENV = { ...BASE_ENV, ADMIN_AUTH_MODE: "jwt", ADMIN_OWNER_IDS: "owner-uid", CRON_SECRET: "cron-x" };
const adminReq = (body) => ({ method: "POST", headers: { authorization: "Bearer owner-token", origin: "https://floweranbu.co.kr" }, body: { resource: "order", ...body } });

test("관리자 '입금 확인': 무통장 입금 대기만 접수로 넘기고 '발주하세요'를 보낸다. 가상계좌는 거절", { concurrency: false },
  withEnv(ADMIN_ENV, async () => {
    const telegrams = [];
    const bank = { order_id: "AFB20990101-AAAA0001", status: AWAITING, payment_method: "BANK_TRANSFER", product_label: "꽃다발", amount: 58000, sender_phone: "01012345678" };
    globalThis.fetch = adminFetch(bank, { telegrams });
    const ok = mockResponse();
    await admin(adminReq({ action: "deposit", orderId: bank.order_id }), ok);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.equal(bank.status, "new");
    assert.ok(telegrams.some((t) => /입금 확인 — 발주하세요/.test(t.text)));

    const va = { order_id: "AF20990101-VA0009", status: AWAITING, payment_method: "가상계좌", amount: 58000 };
    globalThis.fetch = adminFetch(va, {});
    const no = mockResponse();
    await admin(adminReq({ action: "deposit", orderId: va.order_id }), no);
    assert.equal(no.statusCode, 409);
    assert.equal(va.status, AWAITING, "가상계좌는 사람이 입금 확인하지 않는다(토스가 확정)");
  }));

test("관리자 상태 변경은 입금 대기·기한만료 주문을 준비중으로 못 넘긴다", { concurrency: false },
  withEnv(ADMIN_ENV, async () => {
    const patches = [];
    const row = { order_id: "AFB20990101-AAAA0002", status: AWAITING };
    globalThis.fetch = adminFetch(row, { patches });
    const res = mockResponse();
    await admin(adminReq({ action: "status", orderId: row.order_id, status: "ordered" }), res);
    assert.equal(res.statusCode, 409);
    assert.match(decodeURIComponent(patches[0].search), /status=not\.in\.\(canceled,awaiting_deposit,expired\)/);
  }));

test("관리자 환불은 가상계좌 결제를 사이트에서 처리하지 않는다(환불 계좌 필요)", { concurrency: false },
  withEnv({ ...ADMIN_ENV, REFUND_LINK_SECRET: "r" }, async () => {
    const row = { order_id: "AF20990101-VA0010", status: "new", product_label: "꽃다발", paid_amount: 58000, amount: 58000, cancel_requested_at: null };
    globalThis.fetch = adminFetch(row, { toss: { orderId: row.order_id, paymentKey: "pk", totalAmount: 58000, status: "DONE", method: "가상계좌" } });
    const res = mockResponse();
    await admin(adminReq({ action: "cancel", orderId: row.order_id }), res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /토스 상점관리자에서 환불/);
  }));

// ── 같은 곳으로 여러 상품(장바구니 '한 번에 주문') ──
const MULTI_ITEMS = [
  { productCode: "BQ-001", quantity: 1, toppings: [] },
  { productCode: "BS-002", quantity: 2, toppings: [] },
];
const MULTI_TOTAL = priceOf("BQ-001") + priceOf("BS-002") * 2;
const MULTI_ORDER = { ...ORDER, items: MULTI_ITEMS };
const cardDone = (orderId, paymentKey, amount) => ({
  orderId, paymentKey, totalAmount: amount, status: "DONE", method: "카드",
  approvedAt: "2099-01-01T10:00:00+09:00", receipt: { url: "https://r.example.test" },
});

test("여러 상품: 합계가 맞으면 한 번에 승인되고, 사장님 문자에 상품이 하나씩 다 적힌다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const orderId = "AF20990101-MULTI1";
    const inserts = [], telegrams = [];
    globalThis.fetch = legacyConfirmFetch({ tossPayment: cardDone(orderId, "pk_m1", MULTI_TOTAL), inserts, telegrams });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_m1", orderId, amount: MULTI_TOTAL, order: MULTI_ORDER } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const row = inserts.find((r) => r.order_id === orderId);
    assert.match(row.product_label, /외 1건$/);
    assert.match(row.note, /\[상품 2가지: .+ · 노을빛 ×2\]/);
    assert.match(telegrams[0].text, /상품 2가지 \(같은 곳으로\):/);
    assert.match(telegrams[0].text, /· 노을빛 ×2/);
  }));

test("여러 상품: 합계가 하나라도 모자라거나, 모르는 상품·첫 상품 불일치면 승인 전에 거절", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const cases = [
      ["한 상품 값만 결제", MULTI_ORDER, priceOf("BQ-001")],
      ["수량 1개분만 결제", MULTI_ORDER, priceOf("BQ-001") + priceOf("BS-002")],
      ["모르는 상품", { ...ORDER, items: [MULTI_ITEMS[0], { productCode: "ZZ-999", quantity: 1 }] }, MULTI_TOTAL],
      ["첫 상품이 주문서와 다름", { ...ORDER, items: [MULTI_ITEMS[1], MULTI_ITEMS[0]] }, MULTI_TOTAL],
    ];
    for (const [name, order, amount] of cases) {
      const inserts = [], telegrams = [];
      let confirms = 0;
      const base = legacyConfirmFetch({ tossPayment: cardDone("AF20990101-MULTI2", "pk_m2", amount), inserts, telegrams });
      globalThis.fetch = async (input, options) => {
        if (String(input).includes("/v1/payments/confirm")) confirms++;
        return base(input, options);
      };
      const res = mockResponse();
      await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_m2", orderId: "AF20990101-MULTI2", amount, order } }, res);
      assert.equal(res.statusCode, 400, `${name}: ${JSON.stringify(res.body)}`);
      assert.equal(confirms, 0, `${name}: 토스 승인을 부르면 안 된다(돈이 빠지기 전에 막기)`);
      assert.equal(inserts.length, 0, name);
    }
  }));

test("여러 상품: 무통장입금 주문도 상품마다 다시 계산해 입금 대기로 저장", { concurrency: false },
  withEnv({ ...BASE_ENV, BANK_TRANSFER_ENABLED: "1" }, async () => {
    const inserts = [], telegrams = [];
    globalThis.fetch = bankFetch(inserts, telegrams);
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { action: "bank_order", amount: MULTI_TOTAL, order: MULTI_ORDER } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.amount, MULTI_TOTAL);
    assert.equal(inserts[0].status, AWAITING);
    assert.match(inserts[0].note, /상품 2가지/);
  }));

// ── 실시간 계좌이체(TRANSFER) — 승인 즉시 DONE 이라 카드와 같은 길로 접수된다 ──
const transferDone = (orderId, paymentKey, amount, over = {}) => ({
  orderId, paymentKey, totalAmount: amount, status: "DONE", method: "계좌이체",
  approvedAt: "2099-01-01T10:00:00+09:00", receipt: { url: "https://r.example.test/t" },
  transfer: { bankCode: "88", settlementStatus: "INCOMPLETED" },
  cashReceipt: { type: "소득공제", receiptKey: "rk", issueNumber: "1", receiptUrl: "https://cr.example.test/1", amount },
  ...over,
});

test("계좌이체(에스크로 고름): 바로 접수(new), 손님 화면에 현금영수증·에스크로, 사장님엔 결제수단·배송완료 등록 안내", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const orderId = "AF20990101-TRF001";
    const inserts = [], telegrams = [];
    globalThis.fetch = legacyConfirmFetch({ tossPayment: transferDone(orderId, "pk_t1", PRICE, { useEscrow: true }), inserts, telegrams });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_t1", orderId, amount: PRICE, order: ORDER } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.payment.cashReceipt.receiptUrl, "https://cr.example.test/1");
    assert.equal(res.body.payment.useEscrow, true);
    assert.equal(res.body.payment.virtualAccount, undefined);
    const row = inserts.find((r) => r.order_id === orderId);
    assert.ok(row, "주문이 저장돼야 한다");
    assert.ok(row.status === undefined || row.status === "new", "돈이 들어온 계좌이체는 바로 접수(DB 기본값 new) — 입금 대기 아님");
    assert.equal(row.payment_method, "계좌이체");
    assert.match(telegrams[0].text, /결제수단: 계좌이체/);
    assert.match(telegrams[0].text, /구매안전\(에스크로\).+배송 완료/);
    assert.ok(telegrams[0].reply_markup, "접수 주문엔 '발주 완료' 버튼이 붙는다");
  }));

test("에스크로를 안 고른 결제엔 에스크로 안내가 없고, 간편결제는 어느 페이인지 적힌다", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const orderId = "AF20990101-NPAY01";
    const inserts = [], telegrams = [];
    const pay = { ...cardDone(orderId, "pk_n1", PRICE), method: "간편결제", easyPay: { provider: "네이버페이", amount: PRICE } };
    globalThis.fetch = legacyConfirmFetch({ tossPayment: pay, inserts, telegrams });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_n1", orderId, amount: PRICE, order: ORDER } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.payment.useEscrow, undefined);
    assert.equal(res.body.payment.cashReceipt, undefined);
    assert.match(telegrams[0].text, /결제수단: 간편결제 \(네이버페이\)/);
    assert.doesNotMatch(telegrams[0].text, /에스크로/);
  }));
