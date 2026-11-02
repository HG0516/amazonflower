// 주소 없는 꽃 선물 — 결제·알림·주소 옮기기·보낸 선물·아침 점검 (lib/gift.mjs, confirm-payment.js)
import test from "node:test";
import assert from "node:assert/strict";
import {
  GIFT_CODE_RE, GIFT_WAIT, checkGiftOrder, giftCodeFor, giftRowFromOrder, handleGiftPost,
  handleGiftSenderGet, handleGiftSenderPost, sweepGifts, extraFeeLink, filledOrderForNotice,
} from "../lib/gift.mjs";
import { buildOrderRow } from "../lib/payment-integrity.mjs";
import { notifyOwners, notifyTelegram } from "../api/confirm-payment.js";
import { fakeDb } from "./gift-fake.mjs";

const OID = "AFG20261102-1A2B3C4D5E6F";
const ENV = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", GIFT_ENABLED: "1", CRON_SECRET: "s3cret",
  SOLAPI_API_KEY: "a", SOLAPI_API_SECRET: "b", SOLAPI_SENDER: "15772286", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
};
const ORDER = {
  gift: true, productCode: "BQ-001", productLabel: "장미 꽃다발", category: "bouquet",
  recipientName: "박서연", recipientPhone: "010-1111-2222", senderName: "김영자", senderPhone: "010-3333-4444", cardMessage: "생일 축하해",
};
const withEnv = async (fn) => {
  const saved = {}; for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
  const realFetch = globalThis.fetch;
  try { return await fn(); } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

test("링크 코드는 주문번호마다 늘 같고, 주문마다 다르다", () => {
  const a = giftCodeFor(OID, ENV), b = giftCodeFor(OID, ENV), c = giftCodeFor("AFG20261102-ZZZZZZ", ENV);
  assert.match(a, GIFT_CODE_RE);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(giftCodeFor(OID, {}), "");   // 비밀값이 없으면 만들지 않는다
});

test("결제 전 검사: 스위치·주문번호·로그인·상품·번호", () => {
  const ok = { orderId: OID, userId: "u1", category: "bouquet", env: ENV };
  assert.equal(checkGiftOrder(ORDER, ok), null);
  assert.match(checkGiftOrder(ORDER, { ...ok, env: { ...ENV, GIFT_ENABLED: "" } }), /준비 중/);
  assert.match(checkGiftOrder(ORDER, { ...ok, orderId: "AF20261102-1A2B3C" }), /주문번호/);
  assert.match(checkGiftOrder(ORDER, { ...ok, userId: null }), /로그인/);
  assert.match(checkGiftOrder(ORDER, { ...ok, category: "condolence" }), /주소를 넣어/);
  assert.match(checkGiftOrder({ ...ORDER, recipientPhone: "02-123-4567" }, ok), /휴대폰/);
  assert.match(checkGiftOrder({ ...ORDER, items: [{}, {}] }, ok), /하나씩/);
});

test("결제된 선물은 '주소 대기'로 저장되고, 가상계좌 입금 전이면 입금 대기가 앞선다", () => {
  const row = buildOrderRow(ORDER, { orderId: OID, totalAmount: 58000, status: "DONE", method: "카드" });
  assert.equal(row.status, GIFT_WAIT);
  assert.match(row.note, /아직 만들지 마세요/);
  assert.equal(row.address, null);
  const va = buildOrderRow(ORDER, { orderId: OID, totalAmount: 58000, status: "WAITING_FOR_DEPOSIT", method: "가상계좌", virtualAccount: { accountNumber: "1", bankCode: "03" } });
  assert.equal(va.status, "awaiting_deposit");
  assert.equal(buildOrderRow({ ...ORDER, gift: undefined }, { orderId: "AF1", totalAmount: 1 }).status, undefined);
});

test("링크 행: 7일 기한, 사진, 카드 문구", () => {
  const r = giftRowFromOrder(ORDER, OID, new Date("2026-11-02T00:00:00Z"), ENV);
  assert.equal(r.code, giftCodeFor(OID, ENV));
  assert.equal(r.expires_at, "2026-11-09T00:00:00.000Z");
  assert.equal(r.recipient_phone, "01011112222");
  assert.equal(r.message, "생일 축하해");
  assert.ok(r.product_photo && r.product_photo.startsWith("/photos/"));
});

test("결제 직후 문자: 보내는 분 확인 + 받는 분 링크, 사장님 휴대폰은 안 감", async () => withEnv(async () => {
  const db = fakeDb(null);
  const pay = { orderId: OID, totalAmount: 58000, status: "DONE", method: "카드" };
  const out = await notifyOwners(ORDER, pay, { includeCustomer: true, includeOwners: false });
  assert.equal(out.sent, true);
  assert.equal(db.sms.length, 2);
  const url = `https://floweranbu.co.kr/g/${giftCodeFor(OID)}`;
  const toSender = db.sms.find((m) => m.to === "01033334444"), toRcpt = db.sms.find((m) => m.to === "01011112222");
  assert.ok(toSender.text.includes(url) && toSender.text.includes("결제가 끝났어요"));
  assert.ok(toRcpt.text.startsWith("[꽃안부] 김영자님이"));
  assert.ok(toRcpt.text.includes(url));
  assert.ok(!toRcpt.text.includes("58,000"));   // 받는 분께 가격은 안 보인다
}));

test("결제 직후 텔레그램: 만들지 말라는 한 통, 발주 버튼 없음", async () => withEnv(async () => {
  const db = fakeDb(null);
  await notifyTelegram(ORDER, { orderId: OID, totalAmount: 58000, status: "DONE" });
  assert.equal(db.tg.length, 1);
  assert.match(db.tg[0].text, /아직 만들지 마세요/);
  assert.equal(db.tg[0].reply_markup, undefined);
}));

test("주소가 들어오면: 주문을 접수로 옮기고 보내는 분 계정에서 떼고, 사장님께 평소 알림", async () => withEnv(async () => {
  const code = giftCodeFor(OID);
  const db = fakeDb({ code, order_id: OID, status: "waiting", recipient_name: "박서연", recipient_phone: "01011112222", sender_name: "김영자", expires_at: new Date(Date.now() + 864e5).toISOString(), extra_fee: 0 });
  db.order = { order_id: OID, status: GIFT_WAIT, paid_amount: 58000, payment_method: "카드", sender_phone: "01033334444", product_label: "장미 꽃다발" };
  db.intent = { ...ORDER, user_id: "u1" };
  const date = new Date(Date.now() + 9 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
  const calls = [];
  const deps = {
    notifyTelegram: async (o, p) => { calls.push(["tg", o, p]); return { sent: true }; },
    notifyOwners: async (o, p, opt) => { calls.push(["sms", o, p, opt]); return { sent: true }; },
  };
  const out = await handleGiftPost({ code, action: "fill", address: "서울 성동구 왕십리로 12", detail: "101동 1001호", phone: "010-5555-6666", date, slot: "pm", note: "경비실", consent: true }, process.env, deps);
  assert.equal(out.status, 200);
  const p = db.orderPatches[0];
  assert.equal(p.status, "new");
  assert.equal(p.user_id, null);
  assert.equal(p.address, "서울 성동구 왕십리로 12 101동 1001호");
  assert.equal(p.event_date, date);
  assert.equal(p.recipient_phone, "01055556666");
  assert.equal(p.venue, undefined);   // 비회원 조회(lookup_order)는 venue 를 돌려준다. 주소는 address 에만.
  const tg = calls.find((c) => c[0] === "tg");
  assert.equal(tg[1].giftFilled, "new");
  assert.equal(tg[1].address, "서울 성동구 왕십리로 12 101동 1001호");
  assert.equal(tg[2].totalAmount, 58000);
  assert.deepEqual(calls.find((c) => c[0] === "sms")[3], { includeCustomer: false, includeOwners: true });
  const toSender = db.sms.find((m) => m.to === "01033334444");
  assert.ok(toSender && toSender.text.includes("넣으셨어요"));
  assert.ok(!toSender.text.includes("왕십리로"));   // 보내는 분 문자에 주소가 없다
}));

test("주소가 들어온 뒤 사장님 텔레그램은 평소 주문처럼 버튼이 달린다", async () => withEnv(async () => {
  const db = fakeDb(null);
  const value = { address: "서울 성동구 왕십리로 12", address_detail: "101동", filled_phone: "01055556666", deliver_date: "2026-11-05", deliver_slot: "pm", delivery_note: "", extra_fee: 20000 };
  const order = filledOrderForNotice(ORDER, null, value, { first: true });
  await notifyTelegram(order, { orderId: OID, totalAmount: 58000, status: "DONE" });
  assert.match(db.tg[0].text, /\[새 주문\]/);
  assert.match(db.tg[0].text, /받는 분이 주소를 넣었어요/);
  assert.match(db.tg[0].text, /추가 배송비 20,000원/);
  assert.match(db.tg[0].text, /왕십리로/);
  assert.ok(db.tg[0].reply_markup);
}));

test("주문 원장에 못 옮기면 받는 분에게 성공이라고 하지 않는다", async () => withEnv(async () => {
  const code = giftCodeFor(OID);
  const db = fakeDb({ code, order_id: OID, status: "waiting", recipient_name: "박서연", recipient_phone: "01011112222", expires_at: new Date(Date.now() + 864e5).toISOString(), extra_fee: 0 });
  db.order = { order_id: OID, status: "ordered" };   // PATCH 조건(gift_wait,new)에 안 맞음
  const date = new Date(Date.now() + 9 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
  // giftStage 가 ordered 를 준비 중으로 보므로 409, 상태가 비면 503
  assert.equal((await handleGiftPost({ code, action: "fill", address: "서울 성동구 왕십리로 12", phone: "01055556666", date, slot: "am", consent: true }, process.env, {})).status, 409);
  db.order = { order_id: OID, status: "" };
  assert.equal((await handleGiftPost({ code, action: "fill", address: "서울 성동구 왕십리로 12", phone: "01055556666", date, slot: "am", consent: true }, process.env, {})).status, 503);
}));

test("추가 배송비 링크는 맞춤 결제 서명과 같고, 다시 만들어도 같다", () => {
  const a = extraFeeLink(OID, 20000, ENV), b = extraFeeLink(OID, 20000, ENV);
  assert.equal(a.url, b.url);
  assert.match(a.orderId, /^AFC20261102-[0-9A-F]{8}$/);
  assert.match(a.url, /amt=20000/);
  assert.equal(extraFeeLink(OID, 0, ENV), null);
});

test("보낸 선물 목록: 로그인 필요, 주소 없이, 기다리는 중이면 링크", async () => withEnv(async () => {
  const code = giftCodeFor(OID);
  const db = fakeDb({ code, order_id: OID, status: "filled", recipient_name: "박서연", recipient_phone: "01011112222", address: "서울 비밀주소 9", address_detail: "77호", filled_phone: "01099998888", deliver_date: "2026-11-05", deliver_slot: "pm", expires_at: new Date(Date.now() + 864e5).toISOString(), extra_fee: 0 });
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
    if (u.includes("/payment_intents")) return new Response(JSON.stringify([{ order_id: OID }]), { status: 200 });
    if (u.includes("/orders")) return new Response(JSON.stringify([{ order_id: OID, status: "new", paid_amount: 58000 }]), { status: 200 });
    return base(url, init);
  };
  assert.equal((await handleGiftSenderGet({ headers: {} })).status, 401);
  const out = await handleGiftSenderGet({ headers: { authorization: "Bearer x" } });
  assert.equal(out.status, 200);
  const text = JSON.stringify(out.json);
  for (const secret of ["비밀주소", "77호", "01099998888"]) assert.ok(!text.includes(secret), secret);
  assert.equal(out.json.gifts[0].stage, "got");
  assert.equal(out.json.gifts[0].url, undefined);
  db.row = { ...db.row, status: "waiting" };
  const wait = await handleGiftSenderGet({ headers: { authorization: "Bearer x" } });
  assert.equal(wait.json.gifts[0].url, `https://floweranbu.co.kr/g/${code}`);
}));

test("보낸 선물: 남의 주문은 못 건드리고, 주소가 들어온 뒤엔 취소 못 함", async () => withEnv(async () => {
  const code = giftCodeFor(OID);
  const db = fakeDb({ code, order_id: OID, status: "filled", recipient_phone: "01011112222", expires_at: new Date(Date.now() + 864e5).toISOString() });
  const base = globalThis.fetch;
  let mine = [{ order_id: OID }];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
    if (u.includes("/payment_intents")) return new Response(JSON.stringify(mine), { status: 200 });
    if (u.includes("/orders")) return new Response(JSON.stringify([{ order_id: OID, status: "new" }]), { status: 200 });
    return base(url, init);
  };
  const req = { headers: { authorization: "Bearer x" } };
  assert.equal((await handleGiftSenderPost(req, { orderId: OID, action: "cancel" })).status, 409);
  mine = [];
  assert.equal((await handleGiftSenderPost(req, { orderId: OID, action: "cancel" })).status, 404);
  assert.equal(db.patches.length, 0);
}));

test("아침 점검: 기한 지난 선물은 닫고, 환불 비밀값이 없으면 사장님께 수동 환불을 알린다", async () => withEnv(async () => {
  const code = giftCodeFor(OID);
  const db = fakeDb({ code, order_id: OID, status: "waiting", recipient_name: "박서연", recipient_phone: "01011112222", created_at: new Date(Date.now() - 8 * 864e5).toISOString(), expires_at: new Date(Date.now() - 864e5).toISOString() });
  db.order = { order_id: OID, status: GIFT_WAIT, sender_phone: "01033334444", product_label: "장미 꽃다발" };
  delete process.env.REFUND_LINK_SECRET;
  const out = await sweepGifts(process.env);
  assert.equal(out.expired >= 1, true);
  assert.equal(db.row.status, "expired");
  assert.ok(db.tg.some((m) => /자동으로 못 했어요/.test(m.text)));
  assert.equal(db.sms.filter((m) => m.to === "01033334444").length, 0);   // 환불이 안 됐으면 '환불했다' 문자를 보내지 않는다
}));

test("아침 점검: 사장님이 이미 환불한 선물은 다시 환불하지 않는다", async () => withEnv(async () => {
  const code = giftCodeFor(OID);
  const db = fakeDb({ code, order_id: OID, status: "waiting", created_at: new Date(Date.now() - 8 * 864e5).toISOString(), expires_at: new Date(Date.now() - 864e5).toISOString() });
  db.order = { order_id: OID, status: "canceled", sender_phone: "01033334444" };
  await sweepGifts(process.env);
  assert.equal(db.tg.length, 0);
  assert.equal(db.sms.length, 0);
}));
