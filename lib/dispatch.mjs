// 화환 발주(11/5 꽃집 페이지 2단계) — 꽃안부 화환 주문(orders)을 화원에 넘기고, 화원이 수락·거절한다.
// 지금 관리 화면 '발주 복사'(카톡으로 보내던 글)를 화원 화면으로 옮긴 것. 결제·금액·주문자 번호는 화원에게 안 간다.
// 배송 사진은 기존 기사님 링크(deliver.html → /api/order-photo)를 그대로 쓴다. 사진 검사·손님 문자·배송완료 처리가 지금과 같다.
// 사진이 올라가 주문이 배송완료가 되면, 목록을 볼 때 발주도 '완료'로 바꾸고 정산 월을 적는다.
import crypto from "node:crypto";
import { PHOTO_UPLOAD_TTL_SECONDS, getPhotoUploadSecret, signUploadToken } from "./photo-access.mjs";
import { SLUG_RE, ownerShop, userOf } from "./shops.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_RE = /^[A-Za-z0-9._-]{4,64}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHOP_STATUS = ["pending", "active", "paused", "closed"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 헷갈리는 글자(O0I1)는 뺐다
export const CLAIM_DAYS = 14;
export const MAX_FEE = 1000000;

const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const err = (status, error, extra) => ({ status, json: { error, ...extra } });
const BUSY = () => err(503, "잠시 후 다시 시도해 주세요.");
const NOT_READY = () => err(503, "가게 표가 아직 없어요(supabase-shops.sql 적용 전).", { notReady: true });
const kstMonth = (d) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const baseUrl = (env) => String(env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");

function sb(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.SUPABASE_URL, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } };
}
async function rows(r) { return r && r.ok ? r.json().catch(() => null) : null; }
async function missing(r) {
  if (!r || r.status !== 404) return false;
  const j = await r.clone().json().catch(() => null);
  return !!(j && (j.code === "PGRST205" || j.code === "42P01"));
}
const W = { "Content-Type": "application/json", Prefer: "return=representation" };

export const hashCode = (code) => crypto.createHash("sha256").update(`shop-claim:${String(code).toUpperCase()}`).digest("hex");
export function newClaimCode() {
  return Array.from(crypto.randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** 발주 때 화원에게 넘길 내용. 관리 화면 '발주 복사' 글 + 리본 칸. 금액·주문자 번호 칸은 받지 않는다. */
export function checkSnapshot(o) {
  o = o || {};
  const text = clean(o.text, 1500);
  if (!text) return { error: "발주 내용이 비었어요." };
  return { value: {
    text,
    product: clean(o.product, 60),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || "")) ? o.date : "",
    time: clean(o.time, 20),
    ribbon: clean(o.ribbon, 120),
    sender: clean(o.sender, 60),
    place: clean(o.place, 120),
  } };
}

/** 배송완료된 주문의 '수락' 발주를 '완료'로(정산 월 = 배송완료 달, 한국시간). */
async function sweepDone(s, list) {
  const open = list.filter((d) => d.status === "accepted");
  if (!open.length) return list;
  const ids = open.map((d) => encodeURIComponent(d.order_id)).join(",");
  const r = await fetch(`${s.url}/rest/v1/orders?order_id=in.(${ids})&status=eq.delivered&select=order_id,completed_at`, { headers: s.headers }).catch(() => null);
  const done = await rows(r);
  if (!done || !done.length) return list;
  const at = new Map(done.map((o) => [o.order_id, o.completed_at || new Date().toISOString()]));
  for (const d of open) {
    if (!at.has(d.order_id)) continue;
    const patch = { status: "done", done_at: at.get(d.order_id), settle_month: kstMonth(at.get(d.order_id)) };
    const pr = await fetch(`${s.url}/rest/v1/wreath_dispatch?id=eq.${d.id}&status=eq.accepted`, { method: "PATCH", headers: { ...s.headers, ...W }, body: JSON.stringify(patch) }).catch(() => null);
    if (pr && pr.ok) Object.assign(d, patch);
  }
  return list;
}

function driverLink(orderId, env, nowMs = Date.now()) {
  const secret = getPhotoUploadSecret(env);
  if (!secret) return "";
  const exp = Math.floor(nowMs / 1000) + PHOTO_UPLOAD_TTL_SECONDS;
  const t = signUploadToken(orderId, exp, secret);
  return t ? `${baseUrl(env)}/deliver.html?order=${encodeURIComponent(orderId)}&e=${exp}&t=${encodeURIComponent(t)}` : "";
}

// 화원 화면에 보낼 칸(제작비·받는 곳·리본). 주문 금액은 원래 없다.
const DISPATCH_COLS = "id,order_id,status,fee,deadline_at,snapshot,offered_at,answered_at,done_at,settle_month";

/** POST {type:"shop-dispatch", action} — 화원 사장님. list·accept·decline·photo-link */
export async function handleShopDispatch(req, body, env = process.env, deps = {}) {
  const s = sb(env);
  if (!s) return BUSY();
  const uid = await userOf(req, env);
  if (!uid) return err(401, "로그인이 필요해요.");
  const own = await ownerShop(s, uid, body.slug);
  if (own.notReady) return NOT_READY();
  if (own.busy) return BUSY();
  const shop = own.shop;
  if (!shop || shop.kind !== "hwawon") return err(403, "화환 발주를 받는 화원이 아니에요.");
  const action = String(body.action || "list");

  if (action === "list") {
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?shop_id=eq.${shop.id}&status=neq.canceled&select=${DISPATCH_COLS}&order=offered_at.desc&limit=100`, { headers: s.headers }).catch(() => null);
    if (await missing(r)) return NOT_READY();
    const list = await rows(r);
    if (!list) return BUSY();
    await sweepDone(s, list);
    return { status: 200, json: { dispatches: list } };
  }

  const id = String(body.id || "");
  if (!UUID_RE.test(id)) return err(400, "없는 발주예요.");
  const notify = deps.notify || (async () => {});
  const now = new Date().toISOString();

  if (action === "accept" || action === "decline") {
    const status = action === "accept" ? "accepted" : "declined";
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?id=eq.${id}&shop_id=eq.${shop.id}&status=eq.offered&select=${DISPATCH_COLS}`, { method: "PATCH", headers: { ...s.headers, ...W }, body: JSON.stringify({ status, answered_at: now }) }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    if (!out[0]) return err(409, "이미 답했거나 꽃안부가 거둬 간 발주예요.");
    const d = out[0], what = (d.snapshot && d.snapshot.product) || "화환";
    if (status === "accepted") {
      // 화원이 받았으니 주문은 '발주 완료'. 접수(new)일 때만 바꾼다(취소·환불 중 주문은 그대로).
      await fetch(`${s.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(d.order_id)}&status=eq.new&cancel_requested_at=is.null`, { method: "PATCH", headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "ordered", ordered_at: now }) }).catch(() => null);
      await notify(`✅ 화원 수락 — ${shop.name}\n${what}\n${d.order_id}`).catch(() => {});
      return { status: 200, json: { dispatch: d, photoLink: driverLink(d.order_id, env) } };
    }
    await notify(`⚠️ 화원이 못 한대요 — ${shop.name}\n${what}\n${d.order_id}\n다른 화원에 다시 배정해 주세요.`).catch(() => {});
    return { status: 200, json: { dispatch: d } };
  }

  if (action === "photo-link") {
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?id=eq.${id}&shop_id=eq.${shop.id}&status=eq.accepted&select=order_id&limit=1`, { headers: s.headers }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    if (!out[0]) return err(409, "수락한 발주에서만 배송 사진을 올릴 수 있어요.");
    const link = driverLink(out[0].order_id, env);
    if (!link) return err(503, "사진 링크 설정이 아직이에요. 꽃안부에 알려 주세요.");
    return { status: 200, json: { photoLink: link } };
  }

  return err(400, "모르는 요청이에요.");
}

// 관리 화면 가게 목록 칸(정산 계좌는 정산표에서만).
const ADMIN_SHOP_COLS = "id,slug,kind,status,name,profile,owner_user_id,wreath_area,biz_no,biz_name,admin_note,created_at,approved_at,claim_expires_at";

/** admin.js resource:"shops" — 꽃안부 관리자(owner)만. admin.js 가 로그인·권한을 먼저 본다. */
export async function adminShops(body, env = process.env, now = new Date()) {
  const s = sb(env);
  if (!s) return BUSY();
  const action = String(body.action || "list");
  const hdr = { ...s.headers, ...W };

  if (action === "list") {
    const r = await fetch(`${s.url}/rest/v1/shops?select=${ADMIN_SHOP_COLS}&order=created_at.desc&limit=500`, { headers: s.headers }).catch(() => null);
    if (await missing(r)) return NOT_READY();
    const list = await rows(r);
    if (!list) return BUSY();
    return { status: 200, json: { shops: list.map(({ owner_user_id, ...x }) => ({ ...x, linked: !!owner_user_id })) } };
  }

  // 꽃안부가 미리 만들어 두는 페이지(사장님 연결 전에는 pending).
  if (action === "create") {
    const slug = String(body.slug || "");
    const name = clean(body.name, 30);
    const kind = body.kind === "hwawon" ? "hwawon" : "florist";
    if (!SLUG_RE.test(slug)) return err(400, "주소는 영어 소문자·숫자·- 로 40자까지예요.");
    if (!name) return err(400, "가게 이름을 넣어 주세요.");
    const wreath_area = (Array.isArray(body.wreath_area) ? body.wreath_area : []).map((a) => clean(a, 20)).filter(Boolean).slice(0, 20);
    const r = await fetch(`${s.url}/rest/v1/shops?select=${ADMIN_SHOP_COLS}`, { method: "POST", headers: hdr, body: JSON.stringify({ slug, name, kind, wreath_area }) }).catch(() => null);
    if (await missing(r)) return NOT_READY();
    if (r && r.status === 409) return err(409, "이미 있는 주소예요.");
    const out = await rows(r);
    if (!out || !out[0]) return BUSY();
    return { status: 200, json: { shop: out[0] } };
  }

  const shopId = String(body.shopId || "");

  if (action === "set-status" || action === "set-area" || action === "note") {
    if (!UUID_RE.test(shopId)) return err(400, "없는 가게예요.");
    let patch;
    if (action === "set-status") {
      if (!SHOP_STATUS.includes(body.status)) return err(400, "상태 값이 올바르지 않아요.");
      patch = { status: body.status };
      if (body.status === "active") patch.approved_at = now.toISOString();
    } else if (action === "set-area") {
      patch = { wreath_area: (Array.isArray(body.wreath_area) ? body.wreath_area : []).map((a) => clean(a, 20)).filter(Boolean).slice(0, 20) };
    } else {
      patch = { admin_note: clean(body.note, 500) };
    }
    const r = await fetch(`${s.url}/rest/v1/shops?id=eq.${shopId}&select=${ADMIN_SHOP_COLS}`, { method: "PATCH", headers: hdr, body: JSON.stringify(patch) }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    if (!out[0]) return err(404, "없는 가게예요.");
    return { status: 200, json: { shop: out[0] } };
  }

  // 사장님 연결 코드. 원문은 이번 응답에만(책자·DM 으로 전달), 표에는 해시만. 새로 만들면 예전 코드는 못 쓴다.
  if (action === "claim-code") {
    if (!UUID_RE.test(shopId)) return err(400, "없는 가게예요.");
    const code = newClaimCode();
    const until = new Date(now.getTime() + CLAIM_DAYS * 86400000).toISOString();
    const r = await fetch(`${s.url}/rest/v1/shops?id=eq.${shopId}&owner_user_id=is.null&select=slug`, { method: "PATCH", headers: hdr, body: JSON.stringify({ claim_hash: hashCode(code), claim_expires_at: until }) }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    if (!out[0]) return err(409, "이미 사장님이 연결된 가게예요.");
    return { status: 200, json: { code, until, url: `${baseUrl(env)}/my-shop?claim=${code}&shop=${out[0].slug}` } };
  }

  if (action === "dispatch") {
    const orderId = String(body.orderId || "");
    if (!ORDER_RE.test(orderId)) return err(400, "주문번호가 올바르지 않아요.");
    if (!UUID_RE.test(shopId)) return err(400, "화원을 골라 주세요.");
    const fee = Number(body.fee);
    if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE) return err(400, "제작비를 확인해 주세요.");
    const snap = checkSnapshot(body.snapshot);
    if (snap.error) return err(400, snap.error);
    const [or, sr] = await Promise.all([
      fetch(`${s.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=status,cancel_requested_at,canceled_at&limit=1`, { headers: s.headers }).catch(() => null),
      fetch(`${s.url}/rest/v1/shops?id=eq.${shopId}&select=kind,status,name&limit=1`, { headers: s.headers }).catch(() => null),
    ]);
    if (await missing(sr)) return NOT_READY();
    const [order] = (await rows(or)) || [], [shop] = (await rows(sr)) || [];
    if (!order) return err(404, "주문을 찾지 못했어요.");
    if (order.status !== "new" || order.cancel_requested_at || order.canceled_at) return err(409, "접수 상태 주문만 발주할 수 있어요.");
    if (!shop || shop.kind !== "hwawon" || shop.status !== "active") return err(400, "운영 중인 화원만 고를 수 있어요.");
    const deadline = body.deadline && !Number.isNaN(Date.parse(body.deadline)) ? new Date(body.deadline).toISOString() : null;
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?select=${DISPATCH_COLS}`, { method: "POST", headers: hdr, body: JSON.stringify({ order_id: orderId, shop_id: shopId, fee, deadline_at: deadline, snapshot: snap.value }) }).catch(() => null);
    if (await missing(r)) return NOT_READY();
    if (r && r.status === 409) return err(409, "이 주문은 이미 다른 화원에 보냈어요. 먼저 거둬 주세요.");
    const out = await rows(r);
    if (!out || !out[0]) return BUSY();
    return { status: 200, json: { dispatch: { ...out[0], shop_name: shop.name } } };
  }

  if (action === "dispatch-cancel") {
    const id = String(body.id || "");
    if (!UUID_RE.test(id)) return err(400, "없는 발주예요.");
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?id=eq.${id}&status=in.(offered,accepted)&select=id`, { method: "PATCH", headers: hdr, body: JSON.stringify({ status: "canceled", answered_at: now.toISOString() }) }).catch(() => null);
    const out = await rows(r);
    if (!out) return BUSY();
    if (!out[0]) return err(409, "이미 끝났거나 거둔 발주예요.");
    return { status: 200, json: { ok: true } };
  }

  // 관리 화면 주문 카드에 '어느 화원·수락했나'를 붙인다.
  if (action === "dispatch-of") {
    const ids = (Array.isArray(body.orderIds) ? body.orderIds : []).filter((x) => ORDER_RE.test(String(x))).slice(0, 200);
    if (!ids.length) return { status: 200, json: { dispatches: [] } };
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?order_id=in.(${ids.map(encodeURIComponent).join(",")})&select=${DISPATCH_COLS},shop_id,shops(name)&order=offered_at.desc`, { headers: s.headers }).catch(() => null);
    if (await missing(r)) return { status: 200, json: { dispatches: [], notReady: true } };
    const list = await rows(r);
    if (!list) return BUSY();
    await sweepDone(s, list);
    return { status: 200, json: { dispatches: list.map(({ shops, ...d }) => ({ ...d, shop_name: (shops && shops.name) || "" })) } };
  }

  // 정산표: 그 달에 끝난 발주를 화원별로 더한다. 계좌는 여기서만 보인다.
  if (action === "settle") {
    const month = String(body.month || kstMonth(now));
    if (!MONTH_RE.test(month)) return err(400, "달을 확인해 주세요.");
    const ar = await fetch(`${s.url}/rest/v1/wreath_dispatch?status=eq.accepted&select=id,order_id,status&limit=500`, { headers: s.headers }).catch(() => null);
    if (await missing(ar)) return NOT_READY();
    const open = await rows(ar);
    if (open) await sweepDone(s, open);
    const r = await fetch(`${s.url}/rest/v1/wreath_dispatch?status=eq.done&settle_month=eq.${month}&select=id,order_id,fee,done_at,shop_id,shops(name,settle_bank,settle_account,settle_holder)&order=done_at.asc`, { headers: s.headers }).catch(() => null);
    const list = await rows(r);
    if (!list) return BUSY();
    const by = new Map();
    for (const d of list) {
      const g = by.get(d.shop_id) || { shop_id: d.shop_id, name: (d.shops && d.shops.name) || "", bank: (d.shops && d.shops.settle_bank) || "", account: (d.shops && d.shops.settle_account) || "", holder: (d.shops && d.shops.settle_holder) || "", count: 0, total: 0, orders: [] };
      g.count += 1; g.total += d.fee; g.orders.push({ order_id: d.order_id, fee: d.fee, done_at: d.done_at });
      by.set(d.shop_id, g);
    }
    return { status: 200, json: { month, shops: [...by.values()] } };
  }

  return err(400, "모르는 요청이에요.");
}
