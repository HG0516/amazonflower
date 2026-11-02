import test from "node:test";
import assert from "node:assert/strict";
import { GIFT_CODE_RE, checkGiftFill, giftPublicView, giftStage, handleGiftGet, handleGiftPost, newGiftCode } from "../lib/gift.mjs";

const NOW = new Date("2026-11-03T02:00:00Z");   // 화요일 오전 11시(한국)
const row = (over = {}) => ({
  code: "abcdefgh23", status: "waiting", recipient_name: "박서연", recipient_phone: "01000000000", sender_name: "김영자",
  message: "축하해요", product_label: "꽃다발", product_photo: "/p.jpg", expires_at: "2026-11-09T14:59:00Z", extra_fee: 0, ...over,
});
const good = (over = {}) => ({ address: "서울 성동구 왕십리로 12", detail: "101동", phone: "010-1234-5678", date: "2026-11-04", slot: "pm", consent: true, ...over });

test("코드는 형식에 맞고 매번 다르다", () => {
  const a = newGiftCode(), b = newGiftCode();
  assert.match(a, GIFT_CODE_RE);
  assert.notEqual(a, b);
});

test("다시 열어도 주소가 나가지 않는다", () => {
  const filled = row({ status: "filled", address: "서울 비밀주소 1", address_detail: "101호", delivery_note: "경비실", filled_phone: "01099998888", deliver_date: "2026-11-04", deliver_slot: "pm" });
  for (const status of ["", "new", "ordered", "delivered"]) {
    const text = JSON.stringify(giftPublicView(filled, NOW, status));
    assert.ok(!text.includes("비밀주소"), status);
    assert.ok(!text.includes("101호"), status);
    assert.ok(!text.includes("경비실"), status);
    assert.ok(!text.includes("01099998888"), status);
    assert.ok(!text.includes("01000000000"), status);
  }
});

test("단계", () => {
  assert.equal(giftStage(row(), NOW), "wait");
  assert.equal(giftStage(row({ expires_at: "2026-11-01T00:00:00Z" }), NOW), "closed");
  assert.equal(giftStage(row({ status: "filled" }), NOW), "got");
  assert.equal(giftStage(row({ status: "filled", extra_fee: 10000 }), NOW), "checking");
  assert.equal(giftStage(row({ status: "filled" }), NOW, "ordered"), "preparing");
  assert.equal(giftStage(row({ status: "filled" }), NOW, "delivered"), "delivered");
  assert.equal(giftStage(row({ status: "declined" }), NOW), "declined");
  assert.deepEqual(giftPublicView(row({ status: "canceled" }), NOW), { stage: "closed" });
});

test("입력 검사", () => {
  assert.ok(checkGiftFill(good(), NOW).value);
  assert.match(checkGiftFill(good({ address: "" }), NOW).error, /주소/);
  assert.match(checkGiftFill(good({ phone: "123" }), NOW).error, /연락처/);
  assert.match(checkGiftFill(good({ date: "2026-11-01" }), NOW).error, /지난 날짜/);
  assert.match(checkGiftFill(good({ slot: "" }), NOW).error, /도착 시간/);
  assert.match(checkGiftFill(good({ consent: false }), NOW).error, /동의/);
});

test("오늘 마감 시각은 한국시간으로 본다", () => {
  const evening = new Date("2026-11-03T10:00:00Z");   // 화요일 19시(한국)
  assert.match(checkGiftFill(good({ date: "2026-11-03" }), evening).error, /18시/);
  assert.ok(checkGiftFill(good({ date: "2026-11-03" }), NOW).value);
});

test("먼 지역은 추가금이 잡히고 수도권은 0원이다", () => {
  assert.equal(checkGiftFill(good(), NOW).value.extra_fee, 0);
  assert.ok(checkGiftFill(good({ address: "강원 정선군 정선읍 봉양리 1" }), NOW).value.extra_fee >= 10000);
});

function fakeDb(start) {
  const db = { row: start, patches: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/gift_links") && init.method === "PATCH") {
      const fields = JSON.parse(init.body);
      db.patches.push(fields);
      db.row = { ...db.row, ...fields };
      return new Response(JSON.stringify([db.row]), { status: 200 });
    }
    if (u.includes("/gift_links")) return new Response(JSON.stringify(db.row ? [db.row] : []), { status: 200 });
    if (u.includes("/orders")) return new Response(JSON.stringify(db.order ? [db.order] : []), { status: 200 });
    throw new Error("unexpected " + u);
  };
  return db;
}
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

test("링크 읽기와 저장 뒤에도 주소가 안 나간다", async () => {
  const realFetch = globalThis.fetch;
  try {
    const db = fakeDb(row({ expires_at: new Date(Date.now() + 864e5).toISOString() }));
    const date = new Date(Date.now() + 9 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
    const saved = await handleGiftPost({ code: "abcdefgh23", action: "fill", ...good({ date }) }, ENV);
    assert.equal(saved.status, 200);
    assert.equal(db.row.status, "filled");
    const again = await handleGiftGet({ gift: "abcdefgh23" }, ENV);
    assert.equal(again.json.stage, "got");
    assert.ok(!JSON.stringify(again.json).includes("왕십리로"));
  } finally { globalThis.fetch = realFetch; }
});

test("준비가 시작되면 고칠 수 없고, 입력 뒤에는 거절할 수 없다", async () => {
  const realFetch = globalThis.fetch;
  try {
    const db = fakeDb(row({ status: "filled", order_id: "A1", expires_at: new Date(Date.now() + 864e5).toISOString() }));
    db.order = { status: "ordered" };
    assert.equal((await handleGiftPost({ code: "abcdefgh23", action: "fill", ...good() }, ENV)).status, 409);
    db.order = null;
    assert.equal((await handleGiftPost({ code: "abcdefgh23", action: "decline" }, ENV)).status, 409);
    assert.equal(db.patches.length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("잘못된 코드는 표를 읽지 않는다", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("읽으면 안 됨"); };
    assert.equal((await handleGiftGet({ gift: "../etc" }, ENV)).status, 404);
    assert.equal((await handleGiftPost({ code: "x'y" }, ENV)).status, 404);
  } finally { globalThis.fetch = realFetch; }
});
