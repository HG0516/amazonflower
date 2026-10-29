// 보낸 꽃 사진(10/29): 텔레그램 주문 알림 방 사진 → 후보함. 다른 방·비밀값 틀림은 버리고, 답장이면 주문 상품을 붙이고,
// 근조는 동네를 안 붙이고, 같은 사진을 두 번 넣지 않고, 묶음은 첫 장에만 답한다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  areaOf, fromOrder, handleTelegramWebhook, orderIdFromAlarm, pickTelegramPhoto, secretMatches, webhookSecret,
} from "../lib/sent-photos.mjs";
import { PRODUCTS } from "../products.mjs";

const TOKEN = "123:test-token", CHAT = "-1001234";
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "svc" };
const HEAD = { "x-telegram-bot-api-secret-token": webhookSecret(TOKEN) };
const ALARM = { message_id: 50, from: { id: 9, is_bot: true }, text: "🌸 새 주문\n상품: 축하 보통\n주문번호: AF20261029-AB12\n결제: 카드" };
const photoMsg = (extra = {}) => ({
  message: {
    message_id: 77, date: 1761724800, chat: { id: Number(CHAT), type: "supergroup" }, from: { id: 5, is_bot: false },
    photo: [{ file_id: "small", width: 90, height: 120, file_size: 2000 }, { file_id: "big", width: 960, height: 1280, file_size: 180000 }],
    ...extra,
  },
});

test("비밀값: 봇 토큰에서 만들고, 길이·값이 다르면 거절", () => {
  assert.equal(webhookSecret(TOKEN), webhookSecret(TOKEN));
  assert.notEqual(webhookSecret(TOKEN), webhookSecret("other"));
  assert.ok(secretMatches(webhookSecret(TOKEN), webhookSecret(TOKEN)));
  assert.ok(!secretMatches("", webhookSecret(TOKEN)));
  assert.ok(!secretMatches(webhookSecret("other"), webhookSecret(TOKEN)));
});

test("주문 알림 본문에서 주문번호를 읽는다", () => {
  assert.equal(orderIdFromAlarm(ALARM.text), "AF20261029-AB12");
  assert.equal(orderIdFromAlarm("그냥 사진"), "");
});

test("동네: 특별·광역시는 구, 도는 시·군, 번지·건물은 안 씀", () => {
  assert.equal(areaOf("서울 강남구 테헤란로 521"), "강남구");
  assert.equal(areaOf("[06164] 서울특별시 서초구 서초대로 1"), "서초구");
  assert.equal(areaOf("경기 수원시 팔달구 효원로 1"), "수원시");
  assert.equal(areaOf("경북 문경시 당교3길 25"), "문경시");
  assert.equal(areaOf("세종특별자치시 한누리대로 1"), "세종시");
  assert.equal(areaOf(""), "");
});

test("주문에서 상품·종류를 따오고, 근조는 동네를 비운다", () => {
  const p = PRODUCTS.find((x) => x.cat === "orchid");
  const a = fromOrder({ product_code: p.pc, order_type: "general", address: "서울 서초구 반포대로 1" });
  assert.equal(a.category, "orchid");
  assert.equal(a.product_code, p.pc);
  assert.match(a.title, new RegExp(p.name));
  assert.equal(a.area, "서초구");
  const f = fromOrder({ product_code: "WC-01", product_label: "근조 보통", order_type: "funeral", address: "경북 문경시 당교3길 25" });
  assert.equal(f.area, null);
  assert.equal(f.category, "condolence");
});

test("사진 고르기: 다른 방·글만 있는 메시지는 버리고, 가장 큰 사진, 봇 알림에 답장이면 주문번호", () => {
  assert.equal(pickTelegramPhoto(photoMsg({ chat: { id: -999 } }), CHAT).skip, "other_chat");
  assert.equal(pickTelegramPhoto({ message: { message_id: 1, chat: { id: Number(CHAT) }, text: "안녕" } }, CHAT).skip, "no_photo");
  const a = pickTelegramPhoto(photoMsg(), CHAT);
  assert.equal(a.fileId, "big");
  assert.equal(a.orderId, "");
  assert.equal(pickTelegramPhoto(photoMsg({ reply_to_message: ALARM }), CHAT).orderId, "AF20261029-AB12");
  // 사람이 쓴 글에 답장한 건 주문으로 보지 않는다
  assert.equal(pickTelegramPhoto(photoMsg({ reply_to_message: { ...ALARM, from: { id: 5, is_bot: false } } }), CHAT).orderId, "");
  const png = { message: { message_id: 2, chat: { id: Number(CHAT) }, document: { file_id: "d", mime_type: "image/png", file_size: 1000 } } };
  assert.equal(pickTelegramPhoto(png, CHAT).bad, "not_jpeg");
});

function mockFetch({ dup = [], group = [], order = null } = {}) {
  const calls = [];
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
  const fn = async (input, opts = {}) => {
    const url = String(input), method = String(opts.method || "GET").toUpperCase();
    calls.push({ url, method, body: opts.body });
    if (url.includes("/getFile")) return Response.json({ ok: true, result: { file_path: "photos/f.jpg", file_size: 7 } });
    if (url.startsWith("https://api.telegram.org/file/")) return new Response(jpeg);
    if (url.includes("/sendMessage")) return Response.json({ ok: true, result: {} });
    if (url.includes("/storage/v1/object/order-photos/sent-raw/") && method === "POST") return Response.json({ Key: "x" });
    if (url.includes("/storage/v1/object/order-photos/") && method === "DELETE") return Response.json({});
    if (url.includes("/rest/v1/sent_photos?select=id&tg_message_id=")) return Response.json(dup);
    if (url.includes("/rest/v1/sent_photos?select=id&tg_group=")) return Response.json(group);
    if (url.includes("/rest/v1/orders?")) return Response.json(order ? [order] : []);
    if (url.endsWith("/rest/v1/sent_photos") && method === "POST") return new Response(null, { status: 201 });
    throw new Error("unexpected " + method + " " + url);
  };
  return { fn, calls };
}
async function withFetch(mock, run) {
  const old = globalThis.fetch;
  globalThis.fetch = mock.fn;
  try { return await run(); } finally { globalThis.fetch = old; }
}

test("웹후크: 비밀값이 틀리면 아무것도 안 하고 401", async () => {
  const m = mockFetch();
  const out = await withFetch(m, () => handleTelegramWebhook({ headers: { "x-telegram-bot-api-secret-token": "nope" }, body: photoMsg(), env: ENV }));
  assert.equal(out.status, 401);
  assert.equal(m.calls.length, 0);
});

test("웹후크: 알림에 답장한 사진은 비공개 원본으로 저장하고, 주문 상품·동네를 붙여 후보함에, 한 번 답한다", async () => {
  const p = PRODUCTS.find((x) => x.cat === "congrats");
  const m = mockFetch({ order: { order_id: "AF20261029-AB12", order_type: "general", product_code: p.pc, product_label: p.name, address: "서울 강남구 테헤란로 521" } });
  const out = await withFetch(m, () => handleTelegramWebhook({ headers: HEAD, body: photoMsg({ reply_to_message: ALARM, caption: "개업 축하" }), env: ENV }));
  assert.equal(out.status, 200);
  assert.ok(out.saved);
  const up = m.calls.find((c) => c.url.includes("/storage/v1/object/order-photos/sent-raw/"));
  assert.ok(up, "원본은 비공개 order-photos 버킷의 sent-raw/ 로");
  assert.ok(!m.calls.some((c) => c.url.includes("/object/gallery/")), "공개 버킷엔 안 올린다");
  const ins = JSON.parse(m.calls.find((c) => c.url.endsWith("/rest/v1/sent_photos") && c.method === "POST").body);
  assert.equal(ins.status, "pending");
  assert.equal(ins.source, "telegram");
  assert.equal(ins.order_id, "AF20261029-AB12");
  assert.equal(ins.product_code, p.pc);
  assert.equal(ins.category, "congrats");
  assert.equal(ins.area, "강남구");
  assert.equal(ins.note, "개업 축하");
  assert.equal(ins.tg_message_id, 77);
  const replies = m.calls.filter((c) => c.url.includes("/sendMessage"));
  assert.equal(replies.length, 1);
  assert.match(JSON.parse(replies[0].body).text, /사진 받았어요/);
  assert.equal(JSON.parse(replies[0].body).reply_to_message_id, 77);
});

test("웹후크: 같은 메시지가 다시 오면 내려받지도 넣지도 않는다", async () => {
  const m = mockFetch({ dup: [{ id: "x" }] });
  const out = await withFetch(m, () => handleTelegramWebhook({ headers: HEAD, body: photoMsg(), env: ENV }));
  assert.equal(out.skip, "dup");
  assert.ok(!m.calls.some((c) => c.url.includes("/getFile")));
  assert.ok(!m.calls.some((c) => c.method === "POST" && c.url.endsWith("/rest/v1/sent_photos")));
});

test("웹후크: 여러 장 묶음의 두 번째 사진부터는 답하지 않는다", async () => {
  const m = mockFetch({ group: [{ id: "first" }] });
  const out = await withFetch(m, () => handleTelegramWebhook({ headers: HEAD, body: photoMsg({ media_group_id: "g1" }), env: ENV }));
  assert.ok(out.saved);
  assert.equal(JSON.parse(m.calls.find((c) => c.url.endsWith("/rest/v1/sent_photos") && c.method === "POST").body).tg_group, "g1");
  assert.equal(m.calls.filter((c) => c.url.includes("/sendMessage")).length, 0);
});

test("웹후크: 다른 방 사진은 조용히 버린다", async () => {
  const m = mockFetch();
  const out = await withFetch(m, () => handleTelegramWebhook({ headers: HEAD, body: photoMsg({ chat: { id: -42 } }), env: ENV }));
  assert.equal(out.skip, "other_chat");
  assert.equal(m.calls.length, 0);
});
