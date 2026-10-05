// 주문서 항목(아버지 비교표 10/5) — 서버가 받아서 사장님·원장에 제대로 싣는지.
//  - 메시지 카드(꽃다발·꽃바구니): 문구는 사장님 문자·텔레그램과 원장 '요청'에, 안 넣기도 표시
import assert from "node:assert/strict";
import test from "node:test";

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
function withEnv(values, fn) {
  return async () => {
    const keys = [...new Set([...Object.keys(values), "VIRTUAL_ACCOUNT_ENABLED", "BANK_TRANSFER_ENABLED", "TRANSFER_ENABLED",
      "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PAYMENT_INTENTS_REQUIRED", "LIVE_PRICING", "REFUND_LINK_SECRET"])];
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
  TOSS_SECRET_KEY: "test-secret",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_CHAT_ID: "chat",
};

// 운영과 같은 예전(legacy) 승인 경로 — payment_intents 표 없음
function legacyFetch({ tossPayment, inserts, telegrams, calls = { confirm: 0 } }) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.pathname === "/rest/v1/payment_intents") return Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 });
    if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json([]);
    if (url.pathname === "/rest/v1/orders" && method === "POST") { inserts.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") return Response.json([{ order_id: "x" }]);
    if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") { calls.confirm++; return Response.json(tossPayment); }
    if (url.hostname === "api.tosspayments.com" && url.pathname.startsWith("/v1/payments/orders/")) return Response.json(tossPayment);
    if (url.hostname === "api.telegram.org") { telegrams.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}

const PC = "BQ-001";
const PRICE = priceOf(PC);
const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
// 주문서가 꽃다발·꽃바구니에 보내는 분류는 'basket'(index.html productOrderCat)
const BASKET = {
  productCode: PC, category: "basket", type: "unknown", productLabel: "복주머니",
  price: PRICE, quantity: 1, toppings: [],
  recipientName: "김안부", recipientPhone: "010-2222-3333", address: "경기 시흥시 신천3길 23",
  date: tomorrow, timeSlot: "am", time: "오전중",
  senderName: "홍길동", senderPhone: "010-1234-5678",
};
const cardDone = (orderId, paymentKey, amount) => ({
  orderId, paymentKey, totalAmount: amount, status: "DONE", method: "카드",
  approvedAt: "2099-01-01T10:00:00+09:00", receipt: { url: "https://r.example.test" },
});
async function pay(order, orderId, key) {
  const inserts = [], telegrams = [], calls = { confirm: 0 };
  globalThis.fetch = legacyFetch({ tossPayment: cardDone(orderId, key, PRICE), inserts, telegrams, calls });
  const res = mockResponse();
  await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: key, orderId, amount: PRICE, order } }, res);
  return { res, row: inserts.find((r) => r.order_id === orderId), telegrams, calls };
}

test("메시지 카드: 문구가 사장님 텔레그램과 원장 '요청'에 실린다", { concurrency: false }, withEnv(ENV, async () => {
  const { res, row, telegrams } = await pay({ ...BASKET, cardMessage: "엄마 생신 축하드려요. — 막내", senderNote: "분홍 위주로" }, "AF20990101-CARD01", "pk_c1");
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(telegrams[0].text, /카드 문구: 엄마 생신 축하드려요\. — 막내/);
  assert.doesNotMatch(telegrams[0].text, /메시지 카드: 안 넣음/);
  assert.match(row.note, /^\[카드\] 엄마 생신 축하드려요\. — 막내 분홍 위주로$/);
}));

test("메시지 카드 '안 넣기'는 사장님에게 '안 넣음'으로 보이고, 화환엔 카드 줄이 없다", { concurrency: false }, withEnv(ENV, async () => {
  const a = await pay({ ...BASKET }, "AF20990101-CARD02", "pk_c2");
  assert.equal(a.res.statusCode, 200, JSON.stringify(a.res.body));
  assert.match(a.telegrams[0].text, /메시지 카드: 안 넣음/);
  assert.ok(!a.row.note, "카드를 안 넣으면 원장 요청 칸에 [카드] 가 없다");

  const WREATH_PC = "WC-01";
  const wp = priceOf(WREATH_PC);
  assert.ok(wp, "화환 상품 코드 확인");
  const inserts = [], telegrams = [];
  globalThis.fetch = legacyFetch({ tossPayment: cardDone("AF20990101-CARD03", "pk_c3", wp), inserts, telegrams });
  const res = mockResponse();
  await confirmPayment({ method: "POST", headers: {}, query: {}, body: { paymentKey: "pk_c3", orderId: "AF20990101-CARD03", amount: wp, order: {
    ...BASKET, productCode: WREATH_PC, category: "wreath", type: "funeral", productLabel: "근조화환", price: wp,
    venue: "OO장례식장", venueDetail: "3호실", ribbonLeft: "홍길동", ribbonRight: "삼가 고인의 명복을 빕니다" } } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.doesNotMatch(telegrams[0].text, /메시지 카드|카드 문구/);
}));

test("메시지 카드 150자 초과는 결제 승인 전에 거절", { concurrency: false }, withEnv(ENV, async () => {
  const { res, calls, row } = await pay({ ...BASKET, cardMessage: "가".repeat(151) }, "AF20990101-CARD04", "pk_c4");
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(calls.confirm, 0, "토스 승인을 부르기 전에 막아야 한다");
  assert.equal(row, undefined);
}));
