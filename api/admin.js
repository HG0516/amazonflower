// api/admin.js — 관리자 통합 API
// (Vercel Hobby 서버리스 함수 12개 제한 대응: product-edit + admin-orders 를 한 함수로 통합)
//
//  body.resource === 'order'  → 주문 관리: action 'list'(기본) | 'status'(new→ordered→delivered)
//  그 외(기본)                → 상품 편집: product_overrides upsert (이름·설명·사진·품절)
//
// 보안(gallery-add.js 원칙): SERVICE_ROLE_KEY·ADMIN_PASSWORD 서버 전용, 비번 상수시간 비교,
//   입력 정화, JPEG 매직바이트, CORS 자기 도메인. orders 는 개인정보라 service_role 로만 조회.

import crypto from "node:crypto";
import { PRODUCTS, TOPPINGS } from "../products.mjs";

export const config = { runtime: "nodejs" };

// ── 변경 알림 ──
// 사장님이 상품·옵션·사진을 바꾸면 단톡방에 남긴다. 손님에게 보이는 것이 바뀌는데
// 아무도 모르는 상태를 없애기 위한 것 — 감사 흔적 겸 "이거 누가 바꿨지?"의 답.
// 실패해도 작업 자체는 성공으로 둔다(알림 때문에 저장이 막히면 안 된다). env 없으면 생략.
async function notifyChange(text) {
  const tg = process.env.TELEGRAM_BOT_TOKEN, tgc = process.env.TELEGRAM_CHAT_ID;
  if (!tg || !tgc) return;
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  try {
    await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgc, text: tag + text, disable_web_page_preview: true }),
    });
  } catch { /* 알림 실패는 무시 */ }
}
const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const CAT_LABEL = { congrats: "축하화환", condolence: "근조화환", orchid: "난", plant: "관엽", bouquet: "꽃다발", basket: "꽃바구니" };
const catNames = (cats) => (Array.isArray(cats) && cats.length ? cats.map((c) => CAT_LABEL[c] || c).join("·") : "어디에도 안 보임");

const ORIGIN = "https://amazonflower.vercel.app";
const VALID_PC = new Set(PRODUCTS.map((p) => p.pc));
const STATUS_ALLOWED = new Set(["판매중", "품절"]);
const ORDER_STATUS = new Set(["new", "ordered", "delivered"]);
const CAT_PRODUCT = new Set(["bouquet", "basket", "plant", "orchid", "congrats", "condolence"]);
// 옵션도 상품과 같은 카테고리 체계를 쓴다 = products.mjs TOPPINGS_BY_CAT 의 키.
// ⚠️ 예전엔 ["wreath","orchid","plant","basket"] 이라 화환(congrats/condolence)·꽃다발(bouquet)과
//    이름이 어긋났고, 그 값이 저장되면 손님 화면 병합에서 해당 옵션이 splice 돼 사라졌다.
const CAT_TOPPING = CAT_PRODUCT;
const bandOf = (p) => p < 70000 ? "5만대" : p < 90000 ? "7만대" : p < 100000 ? "9만대" : "10만↑";
async function nextCustomPc(URL, sb) {                       // 문자정렬 미사용 → CU-1000 채번버그 없음
  const r = await fetch(`${URL}/rest/v1/product_overrides?pc=like.CU-*&select=pc`, { headers: sb });
  let max = 0;
  if (r.ok) for (const x of (await r.json().catch(() => []))) {
    const m = /^CU-(\d+)$/.exec(x.pc); if (m) max = Math.max(max, +m[1]);
  }
  return `CU-${String(max + 1).padStart(4, "0")}`;
}
const MAX_PHOTOS = 8;
const MAX_B64 = 4_000_000;
const MAX_BYTES = 3 * 1024 * 1024;
const ORDER_COLS = [
  "order_id","created_at","status","product_label","product_code","category","order_type",
  "amount","paid_amount","discount_points",
  "recipient_name","recipient_phone",
  "venue","address","road_address","detail_address","building_name","room_info","zip_code",
  "event_date","event_time","event_at","delivery_date","delivery_time_slot",
  "sender_name","sender_phone","orderer_name","orderer_phone","orderer_email",
  "ribbon","ribbon_text","ribbon_sender","note","request_note",
  "completed_photo","delivered_photo_url","completed_at","ordered_at","alerted_at","canceled_at",
  "corp_name","corp_regno","corp_email",
  "utm_source","utm_medium","referral_source"
].join(",");

function clean(s, n) {
  return String(s == null ? "" : s).replace(/[<>"'`\\]/g, "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}
function allowedPhoto(url, supabaseUrl) {
  const u = String(url || "");
  if (/^\/photos\/[A-Za-z0-9가-힣/_\-.]+\.(jpg|jpeg|png|webp)$/i.test(u)) return u;
  if (u.startsWith(`${supabaseUrl}/storage/v1/object/public/gallery/`)) return u;
  return null;
}
// 사진(base64) → gallery 버킷의 subdir/ 경로에 저장 후 public URL 반환. 실패시 {err}.
async function uploadPhotoToGallery(base64, subdir, SUPABASE_URL, SERVICE_KEY) {
  if (typeof base64 !== "string" || base64.length > MAX_B64) return { err: "사진 용량이 큽니다. 더 작게 찍어 올려주세요." };
  let buf;
  try { buf = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64"); }
  catch { return { err: "사진 데이터를 읽을 수 없습니다." }; }
  if (!buf.length || buf.length > MAX_BYTES) return { err: "사진 용량이 큽니다. (3MB 이하)" };
  if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return { err: "JPG 이미지만 올릴 수 있어요." };
  const path = `${subdir}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: buf,
  });
  if (!up.ok) { console.error("photo upload fail", up.status, await up.text().catch(() => "")); return { err: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." }; }
  return { url: `${SUPABASE_URL}/storage/v1/object/public/gallery/${path}` };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST 요청만 지원합니다." });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_PW) {
    return res.status(503).json({ error: "관리자 기능이 아직 설정되지 않았습니다." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // 결제취소만 예외적으로 HMAC 토큰 인증 허용(텔레그램 취소 버튼 → order-confirm 확인페이지 경유).
  // 그 외 모든 요청은 비밀번호 필수.
  const passOk = safeEqual(body.password, ADMIN_PW);
  const isCancel = body.resource === "order" && body.action === "cancel";
  if (!passOk && !isCancel) return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });

  const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  // ─────────────────────── 신규상품 (#1) ───────────────────────
  if (body.resource === "product") {
    const act = body.action || "create";
    if (act === "list") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/product_overrides?is_custom=eq.true&select=*&order=pc.asc`, { headers: sb });
      return res.status(200).json({ ok: r.ok, products: r.ok ? await r.json().catch(() => []) : [] });
    }
    if (act === "delete") {                                    // 소프트삭제만(하드삭제 금지 → pc 재사용 없음)
      if (!/^CU-\d{4}$/.test(body.pc || "")) return res.status(400).json({ error: "상품 코드가 올바르지 않습니다." });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/product_overrides?pc=eq.${encodeURIComponent(body.pc)}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }) });
      if (!r.ok) return res.status(502).json({ error: "삭제에 실패했습니다." });
      const gone = ((await r.json().catch(() => [])) || [])[0];
      await notifyChange(`🗑 상품 내림 — ${gone?.name || body.pc} (${body.pc})\n손님 화면에서 사라집니다`);
      return res.status(200).json({ ok: true });
    }
    if (!CAT_PRODUCT.has(body.cat)) return res.status(400).json({ error: "카테고리가 올바르지 않습니다." });
    const price = parseInt(body.price, 10);
    if (!(Number.isInteger(price) && price >= 0 && price <= 1000000)) return res.status(400).json({ error: "가격이 올바르지 않습니다." });
    const nm = clean(body.name, 40); if (!nm) return res.status(400).json({ error: "상품 이름을 입력해주세요." });
    let photos = null;
    if (body.newPhotoBase64) {
      const up = await uploadPhotoToGallery(body.newPhotoBase64, "product", SUPABASE_URL, SERVICE_KEY);
      if (up.err) return res.status(413).json({ error: up.err });
      photos = [up.url];
    }
    const row = {
      name: nm, cat: body.cat, price, band: bandOf(price), is_custom: true, active: true,
      sub: clean(body.sub, 20) || null, subtitle: clean(body.subtitle, 60) || null,
      description: clean(body.description, 800) || null,
      status: STATUS_ALLOWED.has(body.status) ? body.status : "판매중",
      ...(photos ? { photos } : {}), updated_at: new Date().toISOString(),
    };
    if (act === "update") {                                    // PATCH = 지정컬럼만(name null-wipe 없음)
      if (!/^CU-\d{4}$/.test(body.pc || "")) return res.status(400).json({ error: "상품 코드가 올바르지 않습니다." });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/product_overrides?pc=eq.${encodeURIComponent(body.pc)}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(row) });
      if (!r.ok) return res.status(502).json({ error: "수정에 실패했습니다." });
      await notifyChange(`📦 상품 수정 — ${nm} (${body.pc})\n${won(price)} · ${CAT_LABEL[body.cat] || body.cat} · ${row.status}`);
      return res.status(200).json({ ok: true, item: (await r.json().catch(() => []))[0] });
    }
    for (let i = 0; i < 5; i++) {                              // 채번 경쟁 → PK 409 재시도
      row.pc = await nextCustomPc(SUPABASE_URL, sb);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/product_overrides`, {
        method: "POST", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(row) });
      if (r.ok) {
        await notifyChange(`🆕 새 상품 — ${nm} (${row.pc})\n${won(price)} · ${CAT_LABEL[body.cat] || body.cat} · ${row.status}\n손님 화면에 바로 올라갑니다`);
        return res.status(200).json({ ok: true, pc: row.pc, item: (await r.json().catch(() => []))[0] });
      }
      if (r.status !== 409) { console.error("product create", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "상품 생성에 실패했습니다." }); }
    }
    return res.status(500).json({ error: "코드 발급 재시도 초과. 다시 시도해주세요." });
  }

  // ─────────────────────── 옵션(토핑) 가격 (#5) ───────────────────────
  if (body.resource === "topping") {
    if (body.action === "list") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/topping_overrides?select=*&order=sort.asc`, { headers: sb });
      return res.status(200).json({ ok: r.ok, toppings: r.ok ? await r.json().catch(() => []) : [] });
    }
    const code = /^top_[a-z0-9_]{1,32}$/.test(body.code) ? body.code : null;
    if (!code) return res.status(400).json({ error: "옵션 코드가 올바르지 않습니다." });
    const price = parseInt(body.price, 10);
    if (!(Number.isInteger(price) && price >= 0 && price <= 1000000)) return res.status(400).json({ error: "옵션 가격이 올바르지 않습니다." });
    const cats = Array.isArray(body.cats) ? body.cats.filter((c) => CAT_TOPPING.has(c)) : [];
    // "얼마에서 얼마로" 를 알림에 싣기 위해 이전 가격을 먼저 읽는다.
    // DB에 없으면 지금 손님에게 적용 중인 값은 정적 원장(products.mjs)의 가격이다.
    let prevPrice = TOPPINGS[code] ? TOPPINGS[code].price : null;
    try {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/topping_overrides?code=eq.${encodeURIComponent(code)}&select=price&limit=1`, { headers: sb });
      if (pr.ok) { const rows = await pr.json().catch(() => []); if (rows[0] && rows[0].price != null) prevPrice = rows[0].price; }
    } catch { /* 못 읽으면 정적 가격을 이전값으로 본다 */ }
    const row = {
      code, price, nm: clean(body.nm, 40) || null, d: clean(body.d, 120) || null,
      grp: body.grp ? clean(body.grp, 20) : null, cats, active: body.active !== false,
      sort: parseInt(body.sort, 10) || 0, updated_at: new Date().toISOString(),
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/topping_overrides?on_conflict=code`, {
      method: "POST", headers: { ...sb, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
    if (!r.ok) return res.status(502).json({ error: "옵션 저장에 실패했습니다." });
    const tnm = row.nm || (TOPPINGS[code] && TOPPINGS[code].nm) || code;
    const isNew = !TOPPINGS[code] && prevPrice == null;
    await notifyChange(
      (isNew ? `🆕 새 옵션 — ${tnm} ${won(price)}` : `⚙️ 옵션 가격 바뀜 — ${tnm}\n${prevPrice != null && prevPrice !== price ? `${won(prevPrice)} → ${won(price)}` : `${won(price)} (금액 그대로)`}`)
      + `\n${catNames(cats)}에 표시`
      + (row.active === false ? "\n⛔ 숨김 상태" : "")
    );
    return res.status(200).json({ ok: true, item: (await r.json().catch(() => []))[0] });
  }

  // ─────────────────────── 맞춤 결제 링크 (지인·전화 주문) ───────────────────────
  // 관리자가 금액을 정해 링크를 발급 → 손님에게 카톡/문자로 보냄 → 손님이 그 금액만 결제.
  // 정가 카탈로그를 안 건드리고(가격은 코드로만 관리 유지), LIVE_PRICING·DB 없이 동작한다.
  // 보안: 금액을 HMAC 으로 봉인해 orderId 에 결박. confirm-payment.js 가 같은 식으로 검증한다.
  //  ⚠️ 서명 문자열 `pay:${orderId}:${amount}` 는 confirm-payment.js 와 반드시 동일해야 한다.
  if (body.resource === "paylink") {
    const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
    if (!SECRET) return res.status(503).json({ error: "링크 발급 설정이 필요해요(CRON_SECRET)." });
    const amount = parseInt(body.amount, 10);
    if (!(Number.isInteger(amount) && amount >= 1000 && amount <= 3000000)) {
      return res.status(400).json({ error: "금액은 1,000원 ~ 3,000,000원 사이로 넣어주세요." });
    }
    const label = clean(body.label, 40) || "맞춤 주문";
    // orderId: 정가 주문(AF…)과 구분되게 AFC(=커스텀). 토스는 orderId 유일성만 요구.
    // Date/랜덤 불가 제약이 없는 서버리스 런타임이라 여기선 Date/랜덤 사용 가능(워크플로 스크립트 아님).
    const rnd = crypto.randomBytes(4).toString("hex").toUpperCase();
    const ymd = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, "");
    const orderId = `AFC${ymd}-${rnd}`;
    const token = crypto.createHmac("sha256", SECRET).update(`pay:${orderId}:${amount}`).digest("hex").slice(0, 32);
    const url = `${ORIGIN}/pay.html?oid=${orderId}&amt=${amount}&t=${token}&label=${encodeURIComponent(label)}`;
    await notifyChange(`🔗 맞춤 결제 링크 발급 — ${label}\n${won(amount)}\n손님이 결제하면 새 주문으로 알려드려요`);
    return res.status(200).json({ ok: true, url, orderId, amount, label });
  }

  // ─────────────────────── 주문 관리 ───────────────────────
  if (body.resource === "order") {
    const { action, orderId, status } = body;

    // 결제취소(환불) — 전액취소만. 인증: 관리자 비번 OR 텔레그램 취소링크 HMAC 토큰.
    // 토큰: 전용 시크릿(REFUND_LINK_SECRET, Vercel에만 존재)으로 서명 + 발급월 결박(당월·전월만 유효).
    // 토큰 경로는 배송완료 주문 취소 불가(비번 경로만 허용) — 오래된 링크 오탭으로 실돈이 나가는 사고 방지.
    if (action === "cancel") {
      const oid = String(orderId || "").trim();
      if (!/^[A-Za-z0-9-]{6,40}$/.test(oid)) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
      const RSECRET = process.env.REFUND_LINK_SECRET || "";
      const kstYm = (off) => { const d = new Date(Date.now() + 9 * 3600000); d.setUTCMonth(d.getUTCMonth() + off); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
      const mkTok = (ym) => crypto.createHmac("sha256", RSECRET).update(`cancel:${oid}:${ym}`).digest("hex").slice(0, 24);
      const tokOk = RSECRET && (safeEqual(String(body.token || ""), mkTok(kstYm(0))) || safeEqual(String(body.token || ""), mkTok(kstYm(-1))));
      if (!passOk && !tokOk) return res.status(401).json({ error: "인증에 실패했습니다." });

      // DB 상태 확인 — 토큰 경로는 접수/준비중 주문만 취소 가능
      let dbRow = null;
      try {
        const lr = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&select=status,product_label,paid_amount,amount&limit=1`, { headers: sb });
        if (lr.ok) dbRow = ((await lr.json().catch(() => [])) || [])[0] || null;
      } catch {}
      if (!passOk && dbRow && dbRow.status === "delivered") {
        return res.status(403).json({ error: "배송완료된 주문은 이 링크로 환불할 수 없어요. 주문 관리 화면(비밀번호)에서 처리해주세요." });
      }

      const TOSS = process.env.TOSS_SECRET_KEY;
      if (!TOSS) return res.status(503).json({ error: "결제 설정이 없습니다." });
      const tossAuth = "Basic " + Buffer.from(TOSS + ":").toString("base64");

      const pr = await fetch(`https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(oid)}`, { headers: { Authorization: tossAuth } });
      const pay = await pr.json().catch(() => ({}));
      if (!pr.ok) return res.status(404).json({ error: pay.message || "이 주문의 결제 정보를 찾을 수 없어요." });

      let refunded = 0, alreadyCanceled = false;
      if (pay.status === "CANCELED") {
        alreadyCanceled = true;
      } else {
        if (pay.status !== "DONE" && pay.status !== "PARTIAL_CANCELED") {
          return res.status(400).json({ error: `지금은 취소할 수 없는 결제 상태예요. (${pay.status})` });
        }
        const cr = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(pay.paymentKey)}/cancel`, {
          method: "POST",
          headers: { Authorization: tossAuth, "Content-Type": "application/json", "Idempotency-Key": "cancel-" + oid },
          body: JSON.stringify({ cancelReason: clean(body.reason, 80) || "가게 취소(환불)" }),
        });
        const cd = await cr.json().catch(() => ({}));
        if (!cr.ok) { console.error("toss cancel fail", cr.status, cd); return res.status(502).json({ error: cd.message || "결제취소에 실패했습니다. 상점관리자에서 확인해주세요." }); }
        const cs = Array.isArray(cd.cancels) ? cd.cancels : [];
        refunded = cs.length ? Number(cs[cs.length - 1].cancelAmount) || 0 : Number(pay.balanceAmount) || 0;
      }

      // DB 반영 (토스 취소가 원장이므로 DB 실패해도 취소 자체는 완료 — dbSynced로 알림)
      const dr = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status: "canceled", canceled_at: new Date().toISOString() }),
      });
      if (!dr.ok) console.error("cancel db sync fail", dr.status, await dr.text().catch(() => ""));

      // 감사 흔적: 취소 결과를 사장님 텔레그램에도 남김 (실패해도 무시)
      if (!alreadyCanceled) {
        const tg = process.env.TELEGRAM_BOT_TOKEN, tgc = process.env.TELEGRAM_CHAT_ID;
        if (tg && tgc) fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tgc, text: `💸 결제취소 완료 — ${dbRow?.product_label || "주문"} ${refunded.toLocaleString()}원 환불\n주문번호 ${oid}${dr.ok ? "" : "\n⚠️ 주문목록 상태 갱신 실패 — 관리 화면에서 확인 필요"}` }),
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, amount: refunded, alreadyCanceled, dbSynced: dr.ok });
    }

    if (action === "status") {
      if (!orderId || typeof orderId !== "string" || orderId.length > 60) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
      if (!ORDER_STATUS.has(status)) return res.status(400).json({ error: "상태 값이 올바르지 않습니다." });
      const patch = { status };
      const nowIso = new Date().toISOString();
      if (status === "ordered") patch.ordered_at = nowIso;
      if (status === "delivered" && !body.keepCompletedAt) patch.completed_at = nowIso;
      // 취소(환불)된 주문은 상태 변경 불가 — 환불 주문이 활성 주문으로 부활하는 사고 방지
      const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&status=neq.canceled`, {
        method: "PATCH",
        headers: { ...sb, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) { console.error("order status fail", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "상태 변경에 실패했습니다." }); }
      const updated = await r.json().catch(() => []);
      if (!Array.isArray(updated) || !updated.length) return res.status(409).json({ error: "취소(환불)된 주문이라 상태를 바꿀 수 없어요." });
      // 텔레그램 버튼(order-confirm.js)으로 처리하면 방에 회신이 가는데, 관리 화면에서 바꾸면
      // 아무 흔적이 없어 나머지 두 분은 모른다 → 같은 문구로 맞춰준다(중복 발주 방지).
      const o = updated[0] || {};
      const LBL = { new: "접수(발주 전)로 되돌림", ordered: "발주 완료 처리", delivered: "배송완료 처리" };
      const EMO = { new: "↩️", ordered: "✅", delivered: "🚚" };
      await notifyChange(
        `${EMO[status] || "📋"} ${LBL[status] || status} — 관리 화면`
        + `\n${o.product_label || o.product_code || "주문"}${o.recipient_name ? ` · 받는분 ${o.recipient_name}` : ""}`
        + `\n${orderId}`
      );
      return res.status(200).json({ ok: true });
    }

    // 배송완료 사진 보기(관리자) — 비공개 버킷 서명URL 발급
    if (action === "photo") {
      const oid = String(orderId || "").trim();
      if (!oid || oid.length > 64) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
      const lr = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&select=completed_photo&limit=1`, { headers: sb });
      const rows = await lr.json().catch(() => []);
      const path = Array.isArray(rows) && rows[0] && rows[0].completed_photo;
      if (!path) return res.status(404).json({ error: "이 주문엔 배송완료 사진이 없어요." });
      const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/order-photos/${encodeURI(path)}`, {
        method: "POST", headers: { ...sb, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
      if (!sr.ok) return res.status(502).json({ error: "사진을 불러오지 못했어요." });
      const sd = await sr.json().catch(() => ({}));
      return res.status(200).json({ ok: true, url: sd.signedURL ? `${SUPABASE_URL}/storage/v1${sd.signedURL}` : null });
    }

    // 거래처 전용 주문 링크 발급 — 총무팀이 열면 계산서 정보가 채워진 채로 시작한다.
    if (action === "corplink") {
      const regno = String(body.regno || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(regno)) return res.status(400).json({ error: "사업자번호가 올바르지 않습니다." });
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!SECRET) return res.status(503).json({ error: "링크 발급 설정이 필요해요." });
      const tok = crypto.createHmac("sha256", SECRET).update("corp:" + regno).digest("hex").slice(0, 24);
      return res.status(200).json({ ok: true, url: `${ORIGIN}/?corp=${regno}&t=${tok}&utm_source=biz` });
    }

    // 배송사진 업로드 링크 발급 — 배달 기사/파트너 화원에게 전달(그 사람이 직접 도착사진 업로드)
    if (action === "link") {
      const oid = String(orderId || "").trim();
      if (!oid || oid.length > 64) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!SECRET) return res.status(503).json({ error: "링크 발급 설정이 필요해요." });
      const tok = crypto.createHmac("sha256", SECRET).update("photo:" + oid).digest("hex").slice(0, 24);
      return res.status(200).json({ ok: true, url: `${ORIGIN}/deliver.html?order=${encodeURIComponent(oid)}&t=${tok}` });
    }

    // 목록 (기본)
    const limit = Math.min(200, Math.max(1, parseInt(body.limit, 10) || 100));
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=${ORDER_COLS}&order=created_at.desc&limit=${limit}`, { headers: sb });
    if (!r.ok) { console.error("orders list fail", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "주문을 불러오지 못했습니다." }); }
    const orders = await r.json().catch(() => []);
    return res.status(200).json({ ok: true, orders: Array.isArray(orders) ? orders : [] });
  }

  // ─────────────────────── 법인 거래처 계정 링크 발급 ───────────────────────
  // tier-1 서명(corp:regno, 기존 '전용 주문 링크'와 동일 토큰)으로 corp.html 대시보드 링크 생성.
  // 별도 테이블 불필요 — 연결된 Supabase 그대로 동작. 결제·order 블록 불변.
  if (body.resource === "corp") {
    if (body.action === "acctlink") {
      const CSECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!CSECRET) return res.status(503).json({ error: "링크 발급 설정이 필요해요(CRON_SECRET)." });
      const regno = String(body.regno || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(regno)) return res.status(400).json({ error: "사업자번호 10자리가 필요합니다." });
      const tok = crypto.createHmac("sha256", CSECRET).update("corp:" + regno).digest("hex").slice(0, 24);
      return res.status(200).json({ ok: true, url: `${ORIGIN}/corp.html?corp=${regno}&t=${tok}` });
    }
    // 세금계산서 발행완료 표시 → 거래처 대시보드에 '발행완료/대기'로 보임 (invoice_issued 컬럼)
    if (body.action === "invoice") {
      const oid = String(body.order_id || "").trim();
      if (!oid || oid.length > 64) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
      const issued = body.issued !== false;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_issued: issued }),
      });
      if (!r.ok) { console.error("corp invoice fail", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "계산서 상태 변경 실패.(invoice_issued 컬럼 확인 — supabase-corp.sql 실행)" }); }
      await notifyChange(`🧾 계산서 ${issued ? "발행완료" : "대기"} — 주문 ${oid}`);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "알 수 없는 요청입니다." });
  }

  // ─────────────────────── 갤러리 사진 관리 (삭제/숨김/순서) ───────────────────────
  if (body.resource === "gallery") {
    const { action } = body;
    if (action === "delete") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return res.status(400).json({ error: "id가 올바르지 않습니다." });
      // 무엇을 지웠는지 알림에 담으려면 지우기 전에 읽어야 한다(지운 뒤엔 알 길이 없다).
      let gnm = "";
      try {
        const q = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items?id=eq.${body.id}&select=name&limit=1`, { headers: sb });
        if (q.ok) gnm = ((((await q.json().catch(() => [])) || [])[0]) || {}).name || "";
      } catch { /* 이름 못 읽어도 삭제는 진행 */ }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items?id=eq.${body.id}`, { method: "DELETE", headers: sb });
      if (!r.ok) return res.status(502).json({ error: "삭제에 실패했습니다." });
      await notifyChange(`🗑 갤러리 사진 삭제 — ${gnm || "이름 없음"}\n되돌릴 수 없어요`);
      return res.status(200).json({ ok: true });
    }
    if (action === "save") {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return res.status(400).json({ error: "id가 올바르지 않습니다." });
      const patch = {};
      if (typeof body.visible === "boolean") patch.visible = body.visible;
      if (body.sort != null && Number.isFinite(+body.sort)) patch.sort = Math.max(0, Math.min(99999, parseInt(body.sort, 10)));
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items?id=eq.${body.id}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(patch) });
      if (!r.ok) return res.status(502).json({ error: "저장에 실패했습니다." });
      // 순서(▲▼)는 알리지 않는다 — 한 번 정리할 때마다 알림이 쏟아진다. 손님에게 보이고 안 보이고만 알린다.
      if (typeof body.visible === "boolean") {
        const g = ((await r.json().catch(() => [])) || [])[0];
        await notifyChange(`🖼 갤러리 사진 ${body.visible ? "다시 보임" : "숨김"} — ${g?.name || "이름 없음"}`);
      }
      return res.status(200).json({ ok: true });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items?select=id,category,name,sub,photo_url,visible,sort&order=sort.asc,created_at.desc`, { headers: sb });
    return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, items: await r.json().catch(() => []) } : { error: "불러오지 못했습니다." });
  }

  // ─────────────────────── 홈 리뷰사진 관리 ───────────────────────
  if (body.resource === "review") {
    const { action } = body;
    const REVIEW_CATS = new Set(["condolence", "congrats", "orchid", "plant", "basket", "bouquet", ""]);
    if (action === "add") {
      const upl = await uploadPhotoToGallery(body.imageBase64, "review", SUPABASE_URL, SERVICE_KEY);
      if (upl.err) return res.status(413).json({ error: upl.err });
      const cap = clean(body.caption, 80) || null;
      const cat = REVIEW_CATS.has(body.cat) ? (body.cat || null) : null;
      const sort = Number.isFinite(+body.sort) ? Math.max(0, Math.min(9999, parseInt(body.sort, 10) || 0)) : 999;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/home_reviews`, {
        method: "POST", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ photo_url: upl.url, caption: cap, cat, sort, visible: true }),
      });
      if (!r.ok) { console.error("review insert fail", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "저장에 실패했습니다." }); }
      const rows = await r.json().catch(() => []);
      await notifyChange(`🏠 홈 사진 추가${cap ? ` — ${cap}` : ""}${cat ? ` (${CAT_LABEL[cat] || cat})` : ""}`);
      return res.status(200).json({ ok: true, item: Array.isArray(rows) ? rows[0] : rows });
    }
    if (action === "save" || action === "delete") {
      const id = String(body.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "id가 올바르지 않습니다." });
      if (action === "delete") {
        // 지운 뒤엔 무엇이었는지 알 수 없으므로 먼저 읽는다
        let rcap = "";
        try {
          const q = await fetch(`${SUPABASE_URL}/rest/v1/home_reviews?id=eq.${id}&select=caption&limit=1`, { headers: sb });
          if (q.ok) rcap = ((((await q.json().catch(() => [])) || [])[0]) || {}).caption || "";
        } catch { /* 이름 못 읽어도 삭제는 진행 */ }
        const r = await fetch(`${SUPABASE_URL}/rest/v1/home_reviews?id=eq.${id}`, { method: "DELETE", headers: sb });
        if (!r.ok) return res.status(502).json({ error: "삭제에 실패했습니다." });
        await notifyChange(`🗑 홈 사진 삭제${rcap ? ` — ${rcap}` : ""}\n되돌릴 수 없어요`);
        return res.status(200).json({ ok: true });
      }
      const patch = {};
      if (body.caption != null) patch.caption = clean(body.caption, 80) || null;
      if (typeof body.visible === "boolean") patch.visible = body.visible;
      if (body.sort != null && Number.isFinite(+body.sort)) patch.sort = Math.max(0, Math.min(9999, parseInt(body.sort, 10)));
      const r = await fetch(`${SUPABASE_URL}/rest/v1/home_reviews?id=eq.${id}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) return res.status(502).json({ error: "저장에 실패했습니다." });
      // 순서는 알리지 않는다(▲▼ 연타 = 알림 폭탄). 보임/숨김만.
      if (typeof body.visible === "boolean") await notifyChange(`🏠 홈 사진 ${body.visible ? "다시 보임" : "숨김"}`);
      return res.status(200).json({ ok: true });
    }
    // 목록 (기본): 숨김 포함 전체 (관리자용)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/home_reviews?select=id,photo_url,caption,cat,sort,visible&order=sort.asc,created_at.asc`, { headers: sb });
    if (!r.ok) return res.status(502).json({ error: "리뷰를 불러오지 못했습니다." });
    const reviews = await r.json().catch(() => []);
    return res.status(200).json({ ok: true, reviews: Array.isArray(reviews) ? reviews : [] });
  }

  // ─────────────────────── 상품 편집 (기본) ───────────────────────
  const { pc, name, subtitle, description, status, photos, newPhotoBase64 } = body;
  // 정적 106개 + 관리자가 만든 신규상품(CU-). CU-도 여기로 받아야 편집 시트에서 이름·설명·사진·품절을
  // 고칠 수 있다(예전엔 400 → 만든 상품을 영영 수정 못 했음). 아래 upsert 는 merge-duplicates 라
  // cat·price·is_custom·active 를 건드리지 않으므로 신규상품 정보가 날아가지 않는다.
  if (!VALID_PC.has(pc) && !/^CU-\d{4}$/.test(pc || "")) return res.status(400).json({ error: "상품 코드가 올바르지 않습니다." });

  let finalPhotos = [];
  if (Array.isArray(photos)) {
    for (const p of photos) {
      const ok = allowedPhoto(p, SUPABASE_URL);
      if (ok && !finalPhotos.includes(ok)) finalPhotos.push(ok);
    }
    finalPhotos = finalPhotos.slice(0, MAX_PHOTOS);
  }

  if (newPhotoBase64) {
    if (typeof newPhotoBase64 !== "string" || newPhotoBase64.length > MAX_B64) return res.status(413).json({ error: "사진 용량이 큽니다. 더 작게 찍어 올려주세요." });
    if (finalPhotos.length >= MAX_PHOTOS) return res.status(400).json({ error: `사진은 최대 ${MAX_PHOTOS}장까지예요.` });
    let buf;
    try { buf = Buffer.from(newPhotoBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"); }
    catch { return res.status(400).json({ error: "사진 데이터를 읽을 수 없습니다." }); }
    if (!buf.length || buf.length > MAX_BYTES) return res.status(413).json({ error: "사진 용량이 큽니다. (3MB 이하)" });
    if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return res.status(400).json({ error: "JPG 이미지만 올릴 수 있어요." });
    const path = `product/${encodeURIComponent(pc)}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) { console.error("product photo upload fail", up.status, await up.text().catch(() => "")); return res.status(502).json({ error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." }); }
    finalPhotos.push(`${SUPABASE_URL}/storage/v1/object/public/gallery/${path}`);
  }

  const row = {
    pc,
    name: name != null ? (clean(name, 40) || null) : null,
    subtitle: subtitle != null ? (clean(subtitle, 60) || null) : null,
    description: description != null ? (clean(description, 800) || null) : null,
    status: STATUS_ALLOWED.has(status) ? status : null,
    photos: finalPhotos.length ? finalPhotos : null,
    updated_at: new Date().toISOString(),
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/product_overrides?on_conflict=pc`, {
    method: "POST",
    headers: { ...sb, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) { console.error("override upsert fail", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "저장에 실패했습니다. 다시 시도해주세요." }); }
  const rows = await r.json().catch(() => []);
  const saved = Array.isArray(rows) ? rows[0] : rows;
  const staticName = (PRODUCTS.find((p) => p.pc === pc) || {}).name;
  const bits = [];
  if (newPhotoBase64) bits.push("사진 추가");
  if (row.status) bits.push(row.status);
  await notifyChange(
    `✏️ 상품 정보 수정 — ${row.name || staticName || pc} (${pc})`
    + (bits.length ? `\n${bits.join(" · ")}` : "")
  );
  return res.status(200).json({ ok: true, item: saved });
}
