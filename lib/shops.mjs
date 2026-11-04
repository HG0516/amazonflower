// 꽃집 페이지 2단계(11/5) — 꽃집·화원 사장님이 로그인해서 자기 가게 페이지·상품을 서버에 저장한다.
// 표는 supabase-shops.sql. 쓰기는 전부 여기(service_role)서만, 사장님 확인은 로그인 토큰 → shops.owner_user_id.
// 웹(/f/<slug>·/my-shop)과 앞으로 낼 앱이 같은 요청을 부른다.
// 표가 아직 없으면(SQL 적용 전) 공개 화면은 data/shops/<slug>.json 으로 계속 보이게 fallback 을 돌려준다.
import crypto from "node:crypto";

export const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KAKAO_RE = /^https:\/\/pf\.kakao\.com\/[A-Za-z0-9_]{1,40}$/;
const INSTA_RE = /^[A-Za-z0-9._]{1,30}$/;
const CAT_ID_RE = /^[a-z0-9]{1,12}$/;
const ITEM_STATES = ["on", "soldout", "reserve", "hidden"];
const BLOCK_KEYS = ["order", "night", "cls", "wreath"];
export const MAX_ITEMS = 60;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const err = (status, error, extra) => ({ status, json: { error, ...extra } });
const BUSY = () => err(503, "잠시 후 다시 시도해 주세요.");
const NOT_READY = () => err(503, "가게 저장 준비가 아직이에요. 꽃안부에 알려 주세요.", { notReady: true });

function sb(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.SUPABASE_URL, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } };
}
const photoBase = (env) => `${env.SUPABASE_URL}/storage/v1/object/public/shop-photos/`;

// PostgREST 가 "그런 표 없음"으로 답했는가(SQL 적용 전).
async function tableMissing(r) {
  if (!r || r.status !== 404) return false;
  const j = await r.clone().json().catch(() => null);
  return !!(j && (j.code === "PGRST205" || j.code === "42P01"));
}
async function rows(r) { return r && r.ok ? r.json().catch(() => null) : null; }

/** 사진 주소는 우리 사이트 사진(/photos/…) 이나 shop-photos 버킷 것만. */
export function safePhoto(u, env) {
  const s = String(u || "");
  if (/^\/photos\/[^\s"'<>]{1,200}$/.test(s) && !s.includes("..")) return s;
  if (env.SUPABASE_URL && s.startsWith(photoBase(env)) && /^[A-Za-z0-9/_.-]{1,120}$/.test(s.slice(photoBase(env).length)) && !s.includes("..")) return s;
  return "";
}

/** 사장님이 고친 가게 정보 검사. 모르는 칸은 버린다. */
export function checkShopInput(o, env) {
  o = o || {};
  const name = clean(o.name, 30);
  if (!name) return { error: "가게 이름을 넣어 주세요." };
  const p = o.profile || {};
  const kakao = clean(p.kakao, 80);
  if (kakao && !KAKAO_RE.test(kakao)) return { error: "카카오톡 채널 주소는 https://pf.kakao.com/ 으로 시작해요." };
  const insta = clean(p.insta, 31).replace(/^@/, "");
  if (insta && !INSTA_RE.test(insta)) return { error: "인스타 아이디를 확인해 주세요." };
  const phone = clean(p.phone, 20);
  if (phone && !/^[0-9-]{8,20}$/.test(phone)) return { error: "전화번호를 확인해 주세요." };
  const hours = p.hours || {};
  const open = Number(hours.open), close = Number(hours.close);
  const okH = (h) => Number.isInteger(h) && h >= 0 && h <= 24;
  const profile = {
    tagline: clean(p.tagline, 60),
    area: clean(p.area, 30),
    tags: (Array.isArray(p.tags) ? p.tags : []).map((t) => clean(t, 12)).filter(Boolean).slice(0, 5),
    hours: okH(open) && okH(close) ? { open, close } : { open: 10, close: 19 },
    unmanned: p.unmanned === true,
    kakao, phone, insta,
    address: clean(p.address, 100),
    hero: safePhoto(p.hero, env),
  };
  const cats = [], seen = new Set();
  for (const c of Array.isArray(o.cats) ? o.cats.slice(0, 8) : []) {
    const id = String((c && c.id) || ""), label = clean(c && c.label, 10);
    if (!CAT_ID_RE.test(id) || !label || seen.has(id)) continue;
    seen.add(id); cats.push({ id, label });
  }
  const blocks = {};
  for (const k of BLOCK_KEYS) blocks[k] = !(o.blocks && o.blocks[k] === false);
  const classes = (Array.isArray(o.classes) ? o.classes : []).slice(0, 6)
    .map((c) => ({ name: clean(c && c.name, 30), when: clean(c && c.when, 30) })).filter((c) => c.name);
  return { value: { name, profile, cats, blocks, classes } };
}

/** 상품 하나 검사. cats 는 그 가게 분류 id 목록. */
export function checkItemInput(o, cats, env) {
  o = o || {};
  const name = clean(o.name, 30);
  if (!name) return { error: "메뉴 이름을 넣어 주세요." };
  const cat = String(o.cat || "");
  const state = ITEM_STATES.includes(o.state) ? o.state : "on";
  const sort = Number.isInteger(o.sort) ? Math.max(-1000, Math.min(1000, o.sort)) : 0;
  return { value: {
    cat: cats.includes(cat) ? cat : (cats[0] || ""),
    name,
    descr: clean(o.descr != null ? o.descr : o.desc, 120),
    price_text: clean(o.price_text != null ? o.price_text : o.price, 20),
    photos: (Array.isArray(o.photos) ? o.photos : []).map((u) => safePhoto(u, env)).filter(Boolean).slice(0, 5),
    state, pinned: o.pinned === true, sort,
  } };
}

// 서버 시각(UTC) → 한국 날짜
const kstDate = (now) => new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 손님 화면용 모양(1단계 data/shops/*.json 과 같은 칸). 오늘 품절이 아니면 품절 표시를 푼다. */
export function publicShape(shop, items, now = new Date()) {
  const p = shop.profile || {};
  const today = kstDate(now);
  const menu = (items || []).filter((it) => it.state !== "hidden").map((it) => {
    const soldout = it.state === "soldout" && (!it.soldout_on || it.soldout_on === today);
    return {
      id: it.id, cat: it.cat, name: it.name, desc: it.descr || "", price: it.price_text || "",
      img: (it.photos && it.photos[0]) || "", photos: it.photos || [],
      state: soldout ? "soldout" : it.state === "reserve" ? "reserve" : "on", pinned: !!it.pinned,
    };
  });
  return {
    slug: shop.slug, kind: shop.kind, name: shop.name,
    tagline: p.tagline || "", area: p.area || "", tags: p.tags || [], hours: p.hours || { open: 10, close: 19 },
    unmanned: !!p.unmanned, kakao: p.kakao || "", phone: p.phone || "", insta: p.insta || "", address: p.address || "", hero: p.hero || "",
    cats: shop.cats || [], blocks: shop.blocks || {}, classes: shop.classes || [], menu,
  };
}

const ITEM_ORDER = "order=pinned.desc,sort.asc,created_at.asc";

/** GET ?shop=<slug> — 운영 중 가게만. 없거나 표가 없으면 fallback(파일로 보라는 뜻). */
export async function handleShopGet(q, env = process.env, now = new Date()) {
  const slug = String(q.shop || "");
  if (!SLUG_RE.test(slug)) return err(404, "없는 가게예요.");
  const s = sb(env);
  if (!s) return err(404, "없는 가게예요.", { fallback: true });
  const r = await fetch(`${s.url}/rest/v1/shops?slug=eq.${slug}&status=eq.active&select=id,slug,kind,name,profile,cats,blocks,classes&limit=1`, { headers: s.headers }).catch(() => null);
  if (await tableMissing(r)) return err(404, "없는 가게예요.", { fallback: true });
  const list = await rows(r);
  if (!list) return BUSY();
  if (!list[0]) return err(404, "없는 가게예요.", { fallback: true });
  const ir = await fetch(`${s.url}/rest/v1/shop_items?shop_id=eq.${list[0].id}&state=neq.hidden&select=id,cat,name,descr,price_text,photos,state,soldout_on,pinned,sort&${ITEM_ORDER}`, { headers: s.headers }).catch(() => null);
  const items = await rows(ir);
  if (!items) return BUSY();
  return { status: 200, json: { shop: publicShape(list[0], items, now) } };
}

export async function userOf(req, env) {
  const m = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "").match(/^Bearer\s+(.+)$/i);
  if (!m || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${m[1]}` } }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? u.id : null;
}

// 사장님에게 돌려줄 가게 칸(관리 메모는 빼고).
const OWNER_COLS = "id,slug,kind,status,name,profile,cats,blocks,classes,biz_no,biz_name,settle_bank,settle_account,settle_holder,wreath_area,approved_at";

/** 로그인한 사람의 가게. 여러 개면 slug 로 고른다. */
export async function ownerShop(s, uid, slug) {
  const pick = slug && SLUG_RE.test(slug) ? `&slug=eq.${slug}` : "";
  const r = await fetch(`${s.url}/rest/v1/shops?owner_user_id=eq.${uid}${pick}&select=${OWNER_COLS}&order=created_at.asc&limit=1`, { headers: s.headers }).catch(() => null);
  if (await tableMissing(r)) return { notReady: true };
  const list = await rows(r);
  if (!list) return { busy: true };
  return { shop: list[0] || null };
}

async function listItems(s, shopId) {
  const r = await fetch(`${s.url}/rest/v1/shop_items?shop_id=eq.${shopId}&select=*&${ITEM_ORDER}`, { headers: s.headers }).catch(() => null);
  return rows(r);
}

/** 사진 한 장(data URL) → shop-photos/<가게 id>/… 공개 주소. */
export function decodePhoto(dataUrl) {
  if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(dataUrl)) return null;
  let buf;
  try { buf = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64"); } catch { return null; }
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8) return { buf, ext: "jpg", type: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { buf, ext: "png", type: "image/png" };
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return { buf, ext: "webp", type: "image/webp" };
  return null;
}

const json = { "Content-Type": "application/json", Prefer: "return=representation" };

/** POST {type:"shop-owner", action, slug?} — 그 가게 사장님만. */
export async function handleShopOwner(req, body, env = process.env) {
  const s = sb(env);
  if (!s) return BUSY();
  const uid = await userOf(req, env);
  if (!uid) return err(401, "로그인이 필요해요.");
  const own = await ownerShop(s, uid, body.slug);
  if (own.notReady) return NOT_READY();
  if (own.busy) return BUSY();
  const shop = own.shop;
  const action = String(body.action || "");

  if (action === "me") {
    if (!shop) return { status: 200, json: { shop: null } };
    const items = await listItems(s, shop.id);
    if (!items) return BUSY();
    return { status: 200, json: { shop, items } };
  }
  // 꽃안부가 미리 만든 페이지를 사장님 계정에 붙인다(책자·DM 으로 받은 연결 코드). 아직 주인이 없는 가게만.
  if (action === "claim") {
    const slug = String(body.slug || ""), code = String(body.code || "").toUpperCase();
    if (!SLUG_RE.test(slug) || !/^[A-Z0-9]{8}$/.test(code)) return err(400, "연결 코드를 확인해 주세요.");
    const hash = crypto.createHash("sha256").update(`shop-claim:${code}`).digest("hex");
    const r = await fetch(`${s.url}/rest/v1/shops?slug=eq.${slug}&owner_user_id=is.null&claim_hash=eq.${hash}&claim_expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=${OWNER_COLS}`, { method: "PATCH", headers: { ...s.headers, ...json }, body: JSON.stringify({ owner_user_id: uid, claim_hash: null, claim_expires_at: null }) }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    if (!out[0]) return err(400, "연결 코드가 맞지 않거나 기간이 지났어요. 꽃안부에 새 코드를 요청해 주세요.");
    return { status: 200, json: { shop: out[0] } };
  }
  if (!shop) return err(403, "연결된 가게가 없어요. 꽃안부에 가게 연결을 요청해 주세요.");
  if (shop.status === "closed") return err(403, "닫은 가게예요.");
  const hdr = { ...s.headers, ...json };

  if (action === "save-shop") {
    const c = checkShopInput(body.shop, env);
    if (c.error) return err(400, c.error);
    const r = await fetch(`${s.url}/rest/v1/shops?id=eq.${shop.id}&owner_user_id=eq.${uid}&select=${OWNER_COLS}`, { method: "PATCH", headers: hdr, body: JSON.stringify(c.value) }).catch(() => null);
    const out = await rows(r);
    if (!out || !out[0]) return BUSY();
    return { status: 200, json: { shop: out[0] } };
  }

  if (action === "save-item") {
    const it = body.item || {};
    const c = checkItemInput(it, (shop.cats || []).map((x) => x.id), env);
    if (c.error) return err(400, c.error);
    if (it.id) {
      if (!UUID_RE.test(String(it.id))) return err(400, "없는 메뉴예요.");
      const r = await fetch(`${s.url}/rest/v1/shop_items?id=eq.${it.id}&shop_id=eq.${shop.id}`, { method: "PATCH", headers: hdr, body: JSON.stringify(c.value) }).catch(() => null);
      const out = await rows(r);
      if (!out) return BUSY();
      if (!out[0]) return err(404, "없는 메뉴예요.");
      return { status: 200, json: { item: out[0] } };
    }
    const cr = await fetch(`${s.url}/rest/v1/shop_items?shop_id=eq.${shop.id}&select=id`, { headers: { ...s.headers, Prefer: "count=exact", Range: "0-0" } }).catch(() => null);
    const total = Number(String((cr && cr.headers.get("content-range")) || "").split("/")[1]);
    if (!cr || !cr.ok || !Number.isFinite(total)) return BUSY();
    if (total >= MAX_ITEMS) return err(400, `메뉴는 ${MAX_ITEMS}개까지 올릴 수 있어요.`);
    const r = await fetch(`${s.url}/rest/v1/shop_items`, { method: "POST", headers: hdr, body: JSON.stringify({ ...c.value, shop_id: shop.id }) }).catch(() => null);
    const out = await rows(r);
    if (!out || !out[0]) return BUSY();
    return { status: 200, json: { item: out[0] } };
  }

  if (action === "delete-item") {
    const id = String(body.id || "");
    if (!UUID_RE.test(id)) return err(400, "없는 메뉴예요.");
    const r = await fetch(`${s.url}/rest/v1/shop_items?id=eq.${id}&shop_id=eq.${shop.id}`, { method: "DELETE", headers: { ...s.headers, Prefer: "return=representation" } }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    return { status: 200, json: { ok: true, deleted: out.length } };
  }

  if (action === "upload-photo") {
    const p = decodePhoto(body.data);
    if (!p) return err(400, "사진은 5MB 이하 jpg·png·webp 만 올릴 수 있어요.");
    const path = `${shop.id}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${p.ext}`;
    const r = await fetch(`${s.url}/storage/v1/object/shop-photos/${path}`, { method: "POST", headers: { ...s.headers, "Content-Type": p.type, "x-upsert": "false" }, body: p.buf }).catch(() => null);
    if (!r || !r.ok) return BUSY();
    return { status: 200, json: { url: photoBase(env) + path } };
  }

  return err(400, "모르는 요청이에요.");
}
