// 설정 점검(2026-10-07) — Vercel 환경변수에 키·스위치가 실제로 들어갔는지 '있다/없다'만 본다.
// 값(키·번호)은 절대 돌려주지 않는다. 관리자 화면(admin-setup.html)과 공개 확인(order-meta ?setup=1)이 쓴다.

const has = (env, k) => String(env[k] == null ? "" : env[k]).trim() !== "";
const mobile = (v) => /^01[016789]\d{7,8}$/.test(String(v || "").replace(/\D/g, ""));
const listCount = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean).length;

// 애플 로그인 보안키(Supabase 에 넣은 client secret JWT) 만료일. 다시 만들면 여기를 고친다(check-deadlines 가 D-30부터 알림).
export const APPLE_SECRET_EXPIRY = "2027-01-03";

/** 문자(SOLAPI) 키 세 개가 다 있는가. lib/solapi.mjs·confirm-payment.js 가 보는 것과 같은 조건. */
export const smsConfigured = (env = process.env) =>
  has(env, "SOLAPI_API_KEY") && has(env, "SOLAPI_API_SECRET") && String(env.SOLAPI_SENDER || "").replace(/\D/g, "") !== "";

/**
 * 배송 사진 알림을 실제로 어떻게 보낼지.
 *  - PHOTO_NOTICE_MODE=manual → 사장님 텔레그램에 손님 링크(직접 전달)
 *  - PHOTO_NOTICE_MODE=solapi → 무조건 문자 시도
 *  - 비었거나 auto → 문자 키가 있으면 문자, 없으면 manual 과 같게
 *    (예전엔 키 없이 auto 면 매번 '문자 실패'가 쌓이고 손님 링크도 안 왔다 — 10/7)
 */
export function photoNoticeEffective(env = process.env) {
  const mode = String(env.PHOTO_NOTICE_MODE || "auto").trim().toLowerCase();
  if (mode === "manual") return "manual";
  if (mode === "solapi") return "sms";
  return smsConfigured(env) ? "sms" : "manual";
}

export const kakaoShareKey = (env = process.env) =>
  (/^[a-f0-9]{32}$/i.test(String(env.KAKAO_JS_KEY || "").trim()) ? String(env.KAKAO_JS_KEY).trim() : "");

/** 관리자(사장님) 화면용 — 값 없이 상태만. */
export function setupStatus(env = process.env) {
  let baseHost = "";
  try { baseHost = env.PUBLIC_BASE_URL ? new URL(String(env.PUBLIC_BASE_URL)).host : ""; } catch { baseHost = "잘못된 주소"; }
  return {
    sms: {
      ready: smsConfigured(env),
      apiKey: has(env, "SOLAPI_API_KEY"),
      apiSecret: has(env, "SOLAPI_API_SECRET"),
      sender: String(env.SOLAPI_SENDER || "").replace(/\D/g, "") !== "",
      ownerPhones: ["OWNER_PHONE_1", "OWNER_PHONE_2"].filter((k) => mobile(env[k])).length,
    },
    photoNotice: { mode: String(env.PHOTO_NOTICE_MODE || "auto").trim().toLowerCase(), effective: photoNoticeEffective(env) },
    telegram: has(env, "TELEGRAM_BOT_TOKEN") && has(env, "TELEGRAM_CHAT_ID"),
    kakaoShare: !!kakaoShareKey(env),
    payment: {
      intentsRequired: env.PAYMENT_INTENTS_REQUIRED === "1",
      transfer: env.TRANSFER_ENABLED === "1",
      bankTransfer: env.BANK_TRANSFER_ENABLED === "1",
      virtualAccount: env.VIRTUAL_ACCOUNT_ENABLED === "1",
      livePricing: has(env, "LIVE_PRICING"),
      // 주소 없는 꽃 선물. 기한·거절 때 자동 환불은 텔레그램 환불 버튼 비밀값(REFUND_LINK_SECRET)이 있어야 된다.
      gift: env.GIFT_ENABLED === "1",
      giftAutoRefund: has(env, "REFUND_LINK_SECRET"),
    },
    admin: {
      mode: ["dual", "jwt", "password"].includes(String(env.ADMIN_AUTH_MODE || "dual").toLowerCase()) ? String(env.ADMIN_AUTH_MODE || "dual").toLowerCase() : "dual",
      ownerIds: listCount(env.ADMIN_OWNER_IDS),
      staffIds: listCount(env.ADMIN_STAFF_IDS),
      password: has(env, "ADMIN_PASSWORD"),
    },
    login: { naver: has(env, "NAVER_CLIENT_ID") && has(env, "NAVER_CLIENT_SECRET"), appleExpiry: APPLE_SECRET_EXPIRY },
    // 토스 키가 실제 결제(live_)인지 시험(test_)인지만. 키 값은 안 보낸다.
    tossMode: /^live_/.test(String(env.TOSS_SECRET_KEY || "")) ? "live" : (/^test_/.test(String(env.TOSS_SECRET_KEY || "")) ? "test" : (has(env, "TOSS_SECRET_KEY") ? "unknown" : "none")),
    push: { vapid: has(env, "VAPID_PRIVATE_KEY") },
    baseHost,
  };
}

/** 누구나 볼 수 있는 확인용 — 손님 기능 켜짐 여부만(보안 설정·관리자 방식은 빼고). */
export function publicSetup(env = process.env) {
  return {
    sms: smsConfigured(env),
    photoNotice: photoNoticeEffective(env),
    kakaoShare: !!kakaoShareKey(env),
    transfer: env.TRANSFER_ENABLED === "1",
    bankTransfer: env.BANK_TRANSFER_ENABLED === "1",
    gift: env.GIFT_ENABLED === "1",   // 주소 없는 꽃 선물
  };
}

/**
 * 주문·결제가 실제로 돌고 있는지(설정 점검 화면 '주문' 칸). 실패해도 화면은 떠야 하므로 모르면 null.
 *  - 마지막 주문 시각, 오늘(한국 날짜) 들어온 주문 수
 *  - 결제 자동 점검(5분 대사) 마지막 성공 시각과 마지막 오류
 */
export async function opsStatus({ supabaseUrl, serviceKey, fetchImpl = fetch, now = new Date() } = {}) {
  const out = { lastOrderAt: null, todayOrders: null, reconcileOkAt: null, reconcileError: null };
  if (!supabaseUrl || !serviceKey) return out;
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const get = async (path, extra = {}) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
    try { return await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, { headers: { ...h, ...extra }, signal: ac.signal }); }
    catch { return null; } finally { clearTimeout(t); }
  };
  const kstDay = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const dayStart = new Date(`${kstDay}T00:00:00+09:00`).toISOString();
  const [last, today, rec] = await Promise.all([
    get("orders?select=created_at&order=created_at.desc&limit=1"),
    get(`orders?select=order_id&created_at=gte.${encodeURIComponent(dayStart)}&status=neq.canceled&limit=1`, { Prefer: "count=exact" }),
    get("first_bundle_runtime?name=eq.payment_reconcile&select=last_success_at,last_error&limit=1"),
  ]);
  const rows = async (r) => (r && r.ok ? await r.json().catch(() => null) : null);
  const l = await rows(last); if (Array.isArray(l) && l[0]) out.lastOrderAt = l[0].created_at || null;
  if (today && today.ok) {
    const n = parseInt(String(today.headers.get("content-range") || "").split("/")[1], 10);
    if (Number.isFinite(n)) out.todayOrders = n;
  }
  const rc = await rows(rec); if (Array.isArray(rc) && rc[0]) { out.reconcileOkAt = rc[0].last_success_at || null; out.reconcileError = rc[0].last_error ? String(rc[0].last_error).slice(0, 80) : null; }
  return out;
}
