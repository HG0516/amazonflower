// 꽃집 페이지 2단계 서버(lib/shops.mjs) — 가짜 Supabase 로. 실제 네트워크로 나가지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { checkItemInput, checkShopInput, decodePhoto, handleShopGet, handleShopOwner, publicShape, safePhoto } from "../lib/shops.mjs";

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
const PB = ENV.SUPABASE_URL + "/storage/v1/object/public/shop-photos/";
const OWNER = "11111111-1111-1111-1111-111111111111";
const SHOP_ID = "22222222-2222-2222-2222-222222222222";
const ITEM_ID = "33333333-3333-3333-3333-333333333333";
const res = (x, status = 200, headers = {}) => new Response(JSON.stringify(x), { status, headers });

function fake({ missing = false, shops, items } = {}) {
  const db = {
    shops: shops || [{ id: SHOP_ID, slug: "anel", status: "active", owner_user_id: OWNER, name: "아넬", kind: "florist", profile: { tagline: "t" }, cats: [{ id: "bq", label: "꽃다발" }], blocks: {}, classes: [], admin_note: "비밀" }],
    items: items || [{ id: ITEM_ID, shop_id: SHOP_ID, cat: "bq", name: "장미", descr: "", price_text: "5만원", photos: [], state: "on", pinned: false, sort: 0 }],
    calls: [], uploads: [],
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = init.method || "GET";
    db.calls.push(m + " " + u);
    if (u.endsWith("/auth/v1/user")) return init.headers.Authorization === "Bearer good" ? res({ id: OWNER }) : res({}, 401);
    if (u.includes("/storage/v1/object/shop-photos/")) { db.uploads.push(u); return res({ Key: "k" }); }
    if (missing && u.includes("/rest/v1/shop")) return res({ code: "PGRST205", message: "no table" }, 404);
    const q = new URL(String(url)).searchParams;
    const eq = (k) => (q.get(k) || "").replace(/^eq\./, "");
    if (u.includes("/rest/v1/shops")) {
      let list = db.shops.filter((x) => (!q.get("slug") || x.slug === eq("slug")) && (!q.get("status") || x.status === eq("status")) && (!q.get("owner_user_id") || x.owner_user_id === eq("owner_user_id")) && (!q.get("id") || x.id === eq("id")));
      if (m === "PATCH") { const f = JSON.parse(init.body); list.forEach((x) => Object.assign(x, f)); }
      const cols = (q.get("select") || "*").split(",");
      return res(cols[0] === "*" ? list : list.map((x) => Object.fromEntries(cols.map((c) => [c, x[c]]))));
    }
    if (u.includes("/rest/v1/shop_items")) {
      let list = db.items.filter((x) => x.shop_id === eq("shop_id") && (!q.get("id") || x.id === eq("id")) && (q.get("state") !== "neq.hidden" || x.state !== "hidden"));
      if (m === "POST") { const row = { id: "44444444-4444-4444-4444-44444444444" + db.items.length, ...JSON.parse(init.body) }; db.items.push(row); return res([row], 201); }
      if (m === "PATCH") { const f = JSON.parse(init.body); list.forEach((x) => Object.assign(x, f)); return res(list); }
      if (m === "DELETE") { db.items = db.items.filter((x) => !list.includes(x)); return res(list); }
      if (init.headers && init.headers.Prefer === "count=exact") return res([], 200, { "content-range": `0-0/${list.length}` });
      return res(list);
    }
    throw new Error("unexpected " + u);
  };
  return db;
}
const req = (tok = "good") => ({ headers: { authorization: "Bearer " + tok } });

test("표가 없으면 파일로 보라고 한다(SQL 적용 전 1단계 그대로)", async () => {
  fake({ missing: true });
  const out = await handleShopGet({ shop: "sample" }, ENV);
  assert.equal(out.status, 404);
  assert.equal(out.json.fallback, true);
  const own = await handleShopOwner(req(), { action: "me" }, ENV);
  assert.equal(own.status, 503);
  assert.equal(own.json.notReady, true);
});

test("손님 화면은 운영 중 가게만, 숨긴 메뉴·관리 메모는 안 나간다", async () => {
  const db = fake();
  db.items.push({ id: "x", shop_id: SHOP_ID, cat: "bq", name: "숨김", state: "hidden", photos: [] });
  const out = await handleShopGet({ shop: "anel" }, ENV);
  assert.equal(out.status, 200);
  const text = JSON.stringify(out.json);
  assert.ok(!text.includes("숨김"));
  assert.ok(!text.includes("비밀"));
  assert.ok(!text.includes(OWNER));
  assert.equal(out.json.shop.menu[0].price, "5만원");
  db.shops[0].status = "pending";
  assert.equal((await handleShopGet({ shop: "anel" }, ENV)).json.fallback, true);
  assert.equal((await handleShopGet({ shop: "../x" }, ENV)).status, 404);
});

test("어제 품절은 오늘 다시 판다", () => {
  const now = new Date("2026-11-05T03:00:00Z");
  const it = (soldout_on) => ({ id: "a", cat: "bq", name: "a", state: "soldout", soldout_on, photos: [] });
  assert.equal(publicShape({ profile: {} }, [it("2026-11-05")], now).menu[0].state, "soldout");
  assert.equal(publicShape({ profile: {} }, [it("2026-11-04")], now).menu[0].state, "on");
});

test("로그인 안 했거나 남의 가게면 못 고친다", async () => {
  fake();
  assert.equal((await handleShopOwner(req("bad"), { action: "save-shop", shop: { name: "x" } }, ENV)).status, 401);
  fake({ shops: [{ id: SHOP_ID, slug: "anel", status: "active", owner_user_id: "99999999-9999-9999-9999-999999999999", name: "남의 가게", cats: [] }] });
  const me = await handleShopOwner(req(), { action: "me" }, ENV);
  assert.deepEqual(me.json, { shop: null });
  assert.equal((await handleShopOwner(req(), { action: "save-shop", shop: { name: "x" } }, ENV)).status, 403);
});

test("가게 정보 저장 — 모르는 칸·관리 칸은 못 바꾼다", async () => {
  const db = fake();
  const out = await handleShopOwner(req(), { action: "save-shop", shop: { name: "아넬 플라워", status: "active", owner_user_id: "x", admin_note: "해킹", profile: { kakao: "https://pf.kakao.com/_abc", hero: "javascript:alert(1)" } } }, ENV);
  assert.equal(out.status, 200);
  assert.equal(db.shops[0].name, "아넬 플라워");
  assert.equal(db.shops[0].owner_user_id, OWNER);
  assert.equal(db.shops[0].admin_note, "비밀");
  assert.equal(db.shops[0].profile.hero, "");
  assert.ok(!("admin_note" in out.json.shop));
});

test("가게 정보 검사", () => {
  assert.ok(checkShopInput({ name: "" }, ENV).error);
  assert.ok(checkShopInput({ name: "a", profile: { kakao: "https://evil.com" } }, ENV).error);
  const v = checkShopInput({ name: "a", cats: [{ id: "bq", label: "꽃다발" }, { id: "bq", label: "중복" }, { id: "<x>", label: "y" }], blocks: { wreath: false }, profile: { insta: "@anel_flower", hours: { open: 9, close: 30 } } }, ENV).value;
  assert.deepEqual(v.cats, [{ id: "bq", label: "꽃다발" }]);
  assert.deepEqual(v.blocks, { order: true, night: true, cls: true, wreath: false });
  assert.equal(v.profile.insta, "anel_flower");
  assert.deepEqual(v.profile.hours, { open: 10, close: 19 });
});

test("사진 주소는 우리 것만", () => {
  assert.equal(safePhoto("/photos/a.jpg", ENV), "/photos/a.jpg");
  assert.equal(safePhoto(PB + "abc/1.jpg", ENV), PB + "abc/1.jpg");
  assert.equal(safePhoto("https://evil.com/a.jpg", ENV), "");
  assert.equal(safePhoto("/photos/../api/x", ENV), "");
  assert.equal(safePhoto("data:image/png;base64,AAA", ENV), "");
  const it = checkItemInput({ name: "a", cat: "zz", photos: ["/photos/a.jpg", "https://evil.com/b.jpg"] }, ["bq"], ENV).value;
  assert.equal(it.cat, "bq");
  assert.deepEqual(it.photos, ["/photos/a.jpg"]);
});

test("메뉴 추가·고치기·지우기는 내 가게 것만", async () => {
  const db = fake();
  const add = await handleShopOwner(req(), { action: "save-item", item: { name: "튤립", cat: "bq", price: "3만원" } }, ENV);
  assert.equal(add.status, 200);
  assert.equal(db.items.length, 2);
  assert.equal(db.items[1].shop_id, SHOP_ID);
  const up = await handleShopOwner(req(), { action: "save-item", item: { id: ITEM_ID, name: "장미 한 다발", state: "soldout" } }, ENV);
  assert.equal(up.json.item.name, "장미 한 다발");
  const other = await handleShopOwner(req(), { action: "save-item", item: { id: "55555555-5555-5555-5555-555555555555", name: "x" } }, ENV);
  assert.equal(other.status, 404);
  const del = await handleShopOwner(req(), { action: "delete-item", id: ITEM_ID }, ENV);
  assert.equal(del.json.deleted, 1);
  assert.ok(db.calls.some((c) => c.startsWith("DELETE") && c.includes(`shop_id=eq.${SHOP_ID}`)));
});

test("메뉴는 60개까지", async () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: "i" + i, shop_id: SHOP_ID, cat: "bq", name: "n", state: "on", photos: [] }));
  fake({ items });
  const out = await handleShopOwner(req(), { action: "save-item", item: { name: "하나 더" } }, ENV);
  assert.equal(out.status, 400);
});

test("사진 올리기 — 진짜 사진만, 내 가게 폴더로", async () => {
  const db = fake();
  const jpg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
  const out = await handleShopOwner(req(), { action: "upload-photo", data: jpg }, ENV);
  assert.equal(out.status, 200);
  assert.ok(out.json.url.startsWith(PB + SHOP_ID + "/"));
  assert.equal(db.uploads.length, 1);
  const fakeJpg = "data:image/jpeg;base64," + Buffer.from("<script>").toString("base64");
  assert.equal(decodePhoto(fakeJpg), null);
  assert.equal((await handleShopOwner(req(), { action: "upload-photo", data: fakeJpg }, ENV)).status, 400);
});
