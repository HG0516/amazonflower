// 주소 없는 꽃 선물 — 실제 승인 경로(api/confirm-payment.js)를 가짜 토스·DB로 끝까지 돌려 본다.
import assert from "node:assert/strict";
import test from "node:test";

import confirmPayment from "../api/confirm-payment.js";
import { priceOf } from "../products.mjs";
import { giftCodeFor } from "../lib/gift.mjs";

function mockResponse() {
  return {
    statusCode: 200, body: undefined,
    setHeader() {}, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; }, end() { return this; },
  };
}
const KEYS = ["TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "GIFT_ENABLED", "CRON_SECRET",
  "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PAYMENT_INTENTS_REQUIRED", "LIVE_PRICING", "VIRTUAL_ACCOUNT_ENABLED", "BANK_TRANSFER_ENABLED", "TRANSFER_ENABLED"];
const ENV = {
  TOSS_SECRET_KEY: "test-secret", SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_ROLE_KEY: "svc",
  TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_CHAT_ID: "chat", GIFT_ENABLED: "1", CRON_SECRET: "cron",
};
function withEnv(values, fn) {
  return async () => {
    const old = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    const oldFetch = globalThis.fetch;
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, values);
    try { await fn(); } finally {
      globalThis.fetch = oldFetch;
      for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}
const PC = "BQ-001", PRICE = priceOf(PC);
const GIFT = {
  gift: true, productCode: PC, category: "basket", type: "unknown", productLabel: "꽃다발", price: PRICE, quantity: 1, toppings: [],
  recipientName: "박서연", recipientPhone: "010-1111-2222", senderName: "김영자", senderPhone: "010-3333-4444",
  // 주문서에 남아 있던 주소·날짜가 섞여 와도 서버가 지운다
  address: "옛 주소 1", date: "2099-01-01", timeSlot: "am",
};
function world({ loggedIn = true } = {}) {
  const w = { inserts: [], links: [], telegrams: [], confirm: 0 };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/auth/v1/user") return loggedIn ? Response.json({ id: "user-1", email: "a@b.c" }) : new Response("", { status: 401 });
    if (url.pathname === "/rest/v1/payment_intents") return Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 });
    if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json([]);
    if (url.pathname === "/rest/v1/orders" && method === "POST") { w.inserts.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") return Response.json([{ order_id: "x" }]);
    if (url.pathname === "/rest/v1/gift_links" && method === "POST") { w.links.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    if (url.hostname === "api.tosspayments.com") {
      w.confirm++;
      const oid = url.pathname.startsWith("/v1/payments/orders/") ? decodeURIComponent(url.pathname.split("/").pop()) : JSON.parse(options.body).orderId;
      return Response.json({ orderId: oid, paymentKey: "pk", totalAmount: PRICE, status: "DONE", method: "카드", approvedAt: "2099-01-01T10:00:00+09:00" });
    }
    if (url.hostname === "api.telegram.org") { w.telegrams.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return w;
}
const pay = (order, orderId, headers = { authorization: "Bearer tok" }, amount = PRICE) => {
  const res = mockResponse();
  return confirmPayment({ method: "POST", headers, query: {}, body: { paymentKey: "pk", orderId, amount, order } }, res).then(() => res);
};

test("선물 결제: 주소 대기로 저장, 링크 행 생성, 사장님께 '아직 만들지 마세요', 완료 화면에 링크", { concurrency: false }, withEnv(ENV, async () => {
  const w = world();
  const oid = "AFG20990101-GIFT01";
  const res = await pay(GIFT, oid);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = w.inserts.find((r) => r.order_id === oid);
  assert.equal(row.status, "gift_wait");
  assert.equal(row.address, undefined, "주문서에 남은 주소는 지운다");
  assert.equal(row.event_date, undefined);
  assert.equal(row.user_id, "user-1");
  assert.equal(w.links.length, 1);
  assert.equal(w.links[0].code, giftCodeFor(oid));
  assert.equal(w.links[0].recipient_phone, "01011112222");
  assert.match(w.telegrams[0].text, /아직 만들지 마세요/);
  assert.equal(res.body.gift.url, `https://floweranbu.co.kr/g/${giftCodeFor(oid)}`);
}));

test("선물은 로그인·스위치·주문번호가 맞아야 하고, 아니면 토스 승인 전에 막는다", { concurrency: false }, withEnv(ENV, async () => {
  let w = world({ loggedIn: false });
  let res = await pay(GIFT, "AFG20990101-GIFT02", {});
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /로그인/); assert.equal(w.confirm, 0);

  w = world();
  res = await pay(GIFT, "AF20990101-GIFT03");                      // 선물인데 AF
  assert.equal(res.statusCode, 400); assert.equal(w.confirm, 0);
  res = await pay({ ...GIFT, gift: undefined }, "AFG20990101-GIFT04");   // 일반 주문인데 AFG
  assert.equal(res.statusCode, 400); assert.equal(w.confirm, 0);
  res = await pay({ ...GIFT, productCode: "WC-01", price: priceOf("WC-01") }, "AFG20990101-GIFT05", undefined, priceOf("WC-01"));
  assert.match(res.body.error, /주소를 넣어/);
  assert.equal(res.statusCode, 400); assert.equal(w.confirm, 0);

  delete process.env.GIFT_ENABLED;
  res = await pay(GIFT, "AFG20990101-GIFT06");
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /준비 중/); assert.equal(w.confirm, 0);
}));

test("링크 행을 못 만들면 '저장 실패'로 알리고 성공 화면에 대사 안내", { concurrency: false }, withEnv(ENV, async () => {
  const w = world();
  const base = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    if (String(input).includes("/rest/v1/gift_links")) return new Response("{}", { status: 500 });
    return base(input, options);
  };
  const res = await pay(GIFT, "AFG20990101-GIFT07");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.saved, false);
  assert.ok(w.telegrams.some((t) => /DB 저장 실패/.test(t.text)));
}));

test("무통장 주문으로는 선물을 못 보낸다", { concurrency: false }, withEnv({ ...ENV, BANK_TRANSFER_ENABLED: "1" }, async () => {
  world();
  const res = mockResponse();
  await confirmPayment({ method: "POST", headers: {}, query: {}, body: { action: "bank_order", amount: PRICE, order: GIFT } }, res);
  assert.equal(res.statusCode, 400);
}));
