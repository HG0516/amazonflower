// 화환 발주(lib/dispatch.mjs) — 가짜 Supabase 로. 실제 네트워크로 나가지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { adminShops, checkSnapshot, handleShopDispatch, hashCode } from "../lib/dispatch.mjs";
import { handleShopOwner } from "../lib/shops.mjs";
import { verifyUploadToken } from "../lib/photo-access.mjs";

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", PHOTO_UPLOAD_SECRET: "sec" };
const OWNER = "11111111-1111-1111-1111-111111111111";
const HW = "22222222-2222-2222-2222-222222222222";
const FL = "66666666-6666-6666-6666-666666666666";
const D1 = "33333333-3333-3333-3333-333333333333";
const res = (x, status = 200) => new Response(JSON.stringify(x), { status });
const req = { headers: { authorization: "Bearer good" } };

function fake({ missing = false } = {}) {
  const db = {
    shops: [
      { id: HW, slug: "hw", kind: "hwawon", status: "active", owner_user_id: OWNER, name: "시흥화원", cats: [], settle_bank: "농협", settle_account: "123", settle_holder: "김" },
      { id: FL, slug: "fl", kind: "florist", status: "active", owner_user_id: null, name: "꽃집", cats: [] },
    ],
    orders: [{ order_id: "AF20261105-ABC123", status: "new" }],
    dispatch: [],
    calls: [],
  };
  const pick = (list, q) => list.filter((x) => {
    for (const [k, v] of q) {
      if (["select", "order", "limit"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq" && String(x[k]) !== val) return false;
      if (op === "neq" && String(x[k]) === val) return false;
      if (op === "is" && val === "null" && x[k] != null) return false;
      if (op === "in" && !val.slice(1, -1).split(",").includes(String(x[k]))) return false;
      if (op === "gt" && !(String(x[k] || "") > val)) return false;
    }
    return true;
  });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || "GET";
    db.calls.push(m + " " + decodeURIComponent(u));
    if (u.endsWith("/auth/v1/user")) return res({ id: OWNER });
    if (missing && /\/rest\/v1\/(shops|wreath_dispatch)/.test(u)) return res({ code: "PGRST205" }, 404);
    const q = [...new URL(u).searchParams.entries()];
    const table = u.match(/\/rest\/v1\/(\w+)/)[1];
    const key = { shops: "shops", orders: "orders", wreath_dispatch: "dispatch" }[table];
    if (m === "POST") {
      const row = { id: D1, status: "offered", offered_at: new Date().toISOString(), ...JSON.parse(init.body) };
      if (table === "wreath_dispatch" && db.dispatch.some((d) => d.order_id === row.order_id && ["offered", "accepted", "done"].includes(d.status))) return res({ code: "23505" }, 409);
      db[key].push(row); return res([row], 201);
    }
    const list = pick(db[key], q);
    if (m === "PATCH") { const f = JSON.parse(init.body); list.forEach((x) => Object.assign(x, f)); }
    if (table === "wreath_dispatch" && u.includes("shops(")) return res(list.map((d) => ({ ...d, shops: db.shops.find((s) => s.id === d.shop_id) })));
    return res(list);
  };
  return db;
}
const snap = { text: "근조 기본\n11월 6일(금) 10:00까지\n장소ㆍ시흥장례식장 3호실", product: "근조 기본", ribbon: "삼가 고인의 명복을 빕니다", sender: "아마존 임직원 일동" };

test("표가 없으면 관리 화면에 알려 준다", async () => {
  fake({ missing: true });
  assert.equal((await adminShops({ action: "list" }, ENV)).json.notReady, true);
  assert.equal((await adminShops({ action: "dispatch-of", orderIds: ["AF20261105-ABC123"] }, ENV)).status, 200);
});

test("발주 내용은 글이 있어야 하고 금액 칸은 안 받는다", () => {
  assert.ok(checkSnapshot({}).error);
  const v = checkSnapshot({ ...snap, amount: 99000, orderer_phone: "01011112222" }).value;
  assert.ok(!("amount" in v));
  assert.ok(!JSON.stringify(v).includes("01011112222"));
});

test("발주 → 화원 수락 → 주문은 발주 완료, 사진 링크는 기존 기사님 링크", async () => {
  const db = fake();
  const out = await adminShops({ action: "dispatch", orderId: "AF20261105-ABC123", shopId: HW, fee: 50000, snapshot: snap }, ENV);
  assert.equal(out.status, 200);
  assert.equal(out.json.dispatch.shop_name, "시흥화원");
  const again = await adminShops({ action: "dispatch", orderId: "AF20261105-ABC123", shopId: HW, fee: 50000, snapshot: snap }, ENV);
  assert.equal(again.status, 409);

  const list = await handleShopDispatch(req, { action: "list" }, ENV);
  assert.equal(list.json.dispatches.length, 1);
  assert.ok(!JSON.stringify(list.json).includes("농협"));

  const notes = [];
  const acc = await handleShopDispatch(req, { action: "accept", id: D1 }, ENV, { notify: async (t) => notes.push(t) });
  assert.equal(acc.status, 200);
  assert.equal(db.orders[0].status, "ordered");
  assert.match(notes[0], /화원 수락/);
  const link = new URL(acc.json.photoLink);
  assert.equal(link.pathname, "/deliver.html");
  assert.ok(verifyUploadToken({ orderId: link.searchParams.get("order"), expiresAt: link.searchParams.get("e"), token: link.searchParams.get("t"), secret: "sec" }).ok);
  assert.equal((await handleShopDispatch(req, { action: "decline", id: D1 }, ENV)).status, 409);
});

test("배송완료되면 발주가 끝나고 그 달 정산표에 잡힌다", async () => {
  const db = fake();
  db.orders[0].status = "delivered"; db.orders[0].completed_at = "2026-11-30T16:00:00Z";   // 한국 12월 1일 새벽
  db.dispatch.push({ id: D1, order_id: "AF20261105-ABC123", shop_id: HW, status: "accepted", fee: 50000, snapshot: snap });
  const st = await adminShops({ action: "settle", month: "2026-12" }, ENV);
  assert.equal(st.json.shops.length, 1);
  assert.equal(st.json.shops[0].total, 50000);
  assert.equal(st.json.shops[0].account, "123");
  assert.equal(db.dispatch[0].settle_month, "2026-12");
});

test("화원이 아니면 발주를 못 받고, 꽃집에는 발주할 수 없다", async () => {
  const db = fake();
  db.shops[0].kind = "florist";
  assert.equal((await handleShopDispatch(req, { action: "list" }, ENV)).status, 403);
  db.shops[0].kind = "hwawon";
  assert.equal((await adminShops({ action: "dispatch", orderId: "AF20261105-ABC123", shopId: FL, fee: 1, snapshot: snap }, ENV)).status, 400);
  db.orders[0].status = "ordered";
  assert.equal((await adminShops({ action: "dispatch", orderId: "AF20261105-ABC123", shopId: HW, fee: 1, snapshot: snap }, ENV)).status, 409);
});

test("못 해요 → 텔레그램, 주문은 그대로", async () => {
  const db = fake();
  db.dispatch.push({ id: D1, order_id: "AF20261105-ABC123", shop_id: HW, status: "offered", fee: 1, snapshot: snap });
  const notes = [];
  const out = await handleShopDispatch(req, { action: "decline", id: D1 }, ENV, { notify: async (t) => notes.push(t) });
  assert.equal(out.status, 200);
  assert.equal(db.orders[0].status, "new");
  assert.match(notes[0], /다시 배정/);
});

test("연결 코드로 미리 만든 페이지를 사장님 계정에 붙인다", async () => {
  const db = fake();
  db.shops[0].owner_user_id = null;
  const c = await adminShops({ action: "claim-code", shopId: FL }, ENV);
  assert.match(c.json.code, /^[A-Z2-9]{8}$/);
  assert.equal(db.shops[1].claim_hash, hashCode(c.json.code));
  assert.ok(!JSON.stringify(db.shops[1]).includes(c.json.code));
  assert.equal((await handleShopOwner(req, { action: "claim", slug: "fl", code: "WRONG234" }, ENV)).status, 400);
  const ok = await handleShopOwner(req, { action: "claim", slug: "fl", code: c.json.code.toLowerCase() }, ENV);
  assert.equal(ok.status, 200);
  assert.equal(db.shops[1].owner_user_id, OWNER);
  assert.equal(db.shops[1].claim_hash, null);
  assert.equal((await adminShops({ action: "claim-code", shopId: FL }, ENV)).status, 409);
});
