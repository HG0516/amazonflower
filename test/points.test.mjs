// 적립금 쓰기·추천인 시험(lib/points.mjs · supabase-points-referral.sql).
// 실결제 경로를 건드리므로 ① 꺼져 있으면 지금과 똑같이 막히는지 ② 금액은 결제액+적립금=상품값일 때만 받는지
// ③ 차감은 토스 승인 전에, 승인이 안 되면 돌려주는지를 본다.
import assert from "node:assert/strict";
import test from "node:test";

import confirmPayment from "../api/confirm-payment.js";
import { checkPointsUse, pointsAllowedFor, pointsConfig, POINTS_RULES } from "../lib/points.mjs";
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
const KEYS = ["POINTS_MODE", "POINTS_EXCLUDE_CATS", "POINTS_TEST_EMAILS", "ADMIN_OWNER_EMAILS", "PAYMENT_INTENTS_REQUIRED",
  "BANK_TRANSFER_ENABLED", "VIRTUAL_ACCOUNT_ENABLED", "TRANSFER_ENABLED", "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "LIVE_PRICING"];
function withEnv(values, fn) {
  return async () => {
    const keys = [...new Set([...Object.keys(values), ...KEYS])];
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
const PC = "WC-01";
const PRICE = priceOf(PC);   // 49,000
const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
const ORDER = {
  productCode: PC, category: "wreath", type: "funeral", productLabel: "근조 보통",
  price: PRICE, quantity: 1, toppings: [],
  venue: "시흥장례식장", venueDetail: "특1호", recipientName: "상주", address: "경기 시흥시 신천3길 23",
  date: tomorrow, time: "10:00", senderName: "홍길동", senderPhone: "010-1234-5678",
};
const AUTH = { authorization: "Bearer member-token" };

function pointsFetch({ balance = 5000, useResult = "ok", email = "owner@example.test", toss, tossStatus = 200, log, inserts }) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    log.push(`${method} ${url.pathname}`);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "user-1", email });
    if (url.pathname === "/rest/v1/points_balance") return Response.json([{ balance }]);
    if (url.pathname === "/rest/v1/rpc/use_points") { log.use = JSON.parse(options.body); return Response.json(useResult); }
    if (url.pathname === "/rest/v1/rpc/restore_points") { log.restore = JSON.parse(options.body); return Response.json("ok"); }
    if (url.pathname === "/rest/v1/payment_intents") return Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 });
    if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json([]);
    if (url.pathname === "/rest/v1/orders" && method === "POST") { inserts.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") return Response.json([{ order_id: "x" }]);
    if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") return Response.json(toss, { status: tossStatus });
    if (url.hostname === "api.tosspayments.com" && url.pathname.startsWith("/v1/payments/orders/")) {
      return Response.json({ code: "NOT_FOUND_PAYMENT", message: "없음" }, { status: 404 });
    }
    if (url.hostname === "api.telegram.org") return Response.json({ ok: true });
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}
const cardDone = (orderId, paymentKey, amount) => ({
  orderId, paymentKey, totalAmount: amount, status: "DONE", method: "카드", approvedAt: new Date().toISOString(),
});

test("규칙: 3만 원 이상, 한 번 3,000원까지, 1,000원 단위, 잔액 안, 무통장·법인·맞춤링크 제외", () => {
  const base = { use: 3000, total: 49000, balance: 5000 };
  assert.equal(checkPointsUse(base).ok, true);
  assert.equal(checkPointsUse({ ...base, total: 29000 }).ok, false, "3만 원 미만");
  assert.equal(checkPointsUse({ ...base, use: 4000 }).ok, false, "최대 초과");
  assert.equal(checkPointsUse({ ...base, use: 2500 }).ok, false, "단위");
  assert.equal(checkPointsUse({ ...base, balance: 2000 }).ok, false, "잔액 부족");
  assert.equal(checkPointsUse({ ...base, bank: true }).ok, false, "무통장");
  assert.equal(checkPointsUse({ ...base, buyerType: "corp" }).ok, false, "법인 계산서");
  assert.equal(checkPointsUse({ ...base, customPay: true }).ok, false, "맞춤 결제 링크");
  assert.equal(checkPointsUse({ ...base, cats: ["condolence"], exclude: ["condolence", "congrats"] }).ok, false, "제외 분류");
  assert.equal(checkPointsUse({ ...base, cats: ["plant"], exclude: ["condolence"] }).ok, true);
  assert.equal(POINTS_RULES.maxUse, 3000);
});

test("켜기: off 는 아무도, owner 는 시험 계정만, on 은 모든 회원", () => {
  const u = { id: "u", email: "Owner@Example.test" };
  assert.equal(pointsAllowedFor(u, {}), false);
  assert.equal(pointsAllowedFor(u, { POINTS_MODE: "owner", POINTS_TEST_EMAILS: "owner@example.test" }), true);
  assert.equal(pointsAllowedFor({ id: "u", email: "other@x" }, { POINTS_MODE: "owner", POINTS_TEST_EMAILS: "owner@example.test" }), false);
  assert.equal(pointsAllowedFor(u, { POINTS_MODE: "on" }), true);
  assert.equal(pointsAllowedFor(null, { POINTS_MODE: "on" }), false, "비회원은 못 쓴다");
  assert.deepEqual(pointsConfig({ POINTS_EXCLUDE_CATS: "condolence, congrats" }).exclude, ["condolence", "congrats"]);
});

test("꺼져 있으면 적립금을 실은 주문은 결제 준비에서 막힌다(지금과 같음)", { concurrency: false },
  withEnv({ ...BASE_ENV }, async () => {
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0001", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /적립금/);
  }));

test("켜져 있으면: 결제액 + 적립금 = 상품값일 때만, 잔액·한도 안에서만 준비된다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on" }, async () => {
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ log, inserts });
    const ok = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0002", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, ok);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));

    const full = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0003", amount: PRICE, order: { ...ORDER, usePoints: 3000 } } }, full);
    assert.equal(full.statusCode, 400, "적립금을 쓴다면서 제값을 보내면 금액 불일치");

    const big = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0004", amount: PRICE - 5000, order: { ...ORDER, usePoints: 5000 } } }, big);
    assert.equal(big.statusCode, 400);

    const guest = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0005", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, guest);
    assert.equal(guest.statusCode, 400, "비회원은 못 쓴다");
  }));

test("잔액이 모자라면 준비에서 막힌다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on" }, async () => {
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ balance: 2000, log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0006", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
    assert.equal(res.statusCode, 400);
  }));

test("owner 모드: 시험 계정 이메일만 쓸 수 있다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "owner", POINTS_TEST_EMAILS: "owner@example.test" }, async () => {
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ email: "someone@example.test", log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0007", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
    assert.equal(res.statusCode, 400);
    globalThis.fetch = pointsFetch({ email: "owner@example.test", log, inserts });
    const ok = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "prepare", orderId: "AF20990101-PT0008", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, ok);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  }));

test("승인: 토스 승인 전에 차감하고, 주문 원장에 쓴 적립금·실결제액이 남는다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on" }, async () => {
    const orderId = "AF20990101-PT0010";
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ toss: cardDone(orderId, "pk_pt1", PRICE - 3000), log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { paymentKey: "pk_pt1", orderId, amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const useAt = log.indexOf("POST /rest/v1/rpc/use_points"), tossAt = log.indexOf("POST /v1/payments/confirm");
    assert.ok(useAt >= 0 && tossAt > useAt, "차감이 승인보다 먼저");
    assert.deepEqual(log.use, { p_user: "user-1", p_order: orderId, p_amount: 3000, p_phone: "010-1234-5678" });
    const row = inserts.find((r) => r.order_id === orderId);
    assert.equal(row.discount_points, 3000);
    assert.equal(row.paid_amount, PRICE - 3000);
    assert.equal(row.price, PRICE);
    assert.equal(log.restore, undefined, "성공하면 돌려주지 않는다");
  }));

test("승인: 차감이 안 되면(잔액 부족·다른 계정이 같은 번호로 사용) 토스 승인을 하지 않는다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on" }, async () => {
    for (const useResult of ["insufficient", "phone_used"]) {
      const orderId = `AF20990101-PT${useResult.length}11`;
      const log = [], inserts = [];
      globalThis.fetch = pointsFetch({ useResult, toss: cardDone(orderId, "pk_pt2", PRICE - 3000), log, inserts });
      const res = mockResponse();
      await confirmPayment({ method: "POST", headers: AUTH, query: {},
        body: { paymentKey: "pk_pt2", orderId, amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "POINTS_UNAVAILABLE");
      assert.equal(log.indexOf("POST /v1/payments/confirm"), -1, "돈이 빠져나가기 전에 멈춘다");
      assert.equal(inserts.length, 0);
    }
  }));

test("승인 실패면 쓴 적립금을 바로 돌려준다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on" }, async () => {
    const orderId = "AF20990101-PT0012";
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ toss: { code: "REJECT_CARD_PAYMENT", message: "한도 초과" }, tossStatus: 400, log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { paymentKey: "pk_pt3", orderId, amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
    assert.notEqual(res.statusCode, 200);
    assert.deepEqual(log.restore, { p_order: orderId });
    assert.equal(inserts.length, 0);
  }));

test("무통장 주문에는 적립금을 못 싣는다", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on", BANK_TRANSFER_ENABLED: "1" }, async () => {
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: AUTH, query: {},
      body: { action: "bank_order", amount: PRICE - 3000, order: { ...ORDER, usePoints: 3000 } } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(inserts.length, 0);
  }));

test("적립금 없는 주문은 지금과 똑같다(차감·반환 호출 없음)", { concurrency: false },
  withEnv({ ...BASE_ENV, POINTS_MODE: "on" }, async () => {
    const orderId = "AF20990101-PT0013";
    const log = [], inserts = [];
    globalThis.fetch = pointsFetch({ toss: cardDone(orderId, "pk_pt4", PRICE), log, inserts });
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, query: {},
      body: { paymentKey: "pk_pt4", orderId, amount: PRICE, order: ORDER } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(!log.some((l) => l.includes("/rpc/")), "적립금 함수를 부르지 않는다");
    const row = inserts.find((r) => r.order_id === orderId);
    assert.equal(row.discount_points, undefined, "적립금 칸을 새로 쓰지 않는다");
  }));
