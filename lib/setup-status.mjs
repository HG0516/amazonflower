// 설정 점검(2026-10-07) — Vercel 환경변수에 키·스위치가 실제로 들어갔는지 '있다/없다'만 본다.
// 값(키·번호)은 절대 돌려주지 않는다. 관리자 화면(admin-setup.html)과 공개 확인(order-meta ?setup=1)이 쓴다.

const has = (env, k) => String(env[k] == null ? "" : env[k]).trim() !== "";
const mobile = (v) => /^01[016789]\d{7,8}$/.test(String(v || "").replace(/\D/g, ""));
const listCount = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean).length;

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
    },
    admin: {
      mode: ["dual", "jwt", "password"].includes(String(env.ADMIN_AUTH_MODE || "dual").toLowerCase()) ? String(env.ADMIN_AUTH_MODE || "dual").toLowerCase() : "dual",
      ownerIds: listCount(env.ADMIN_OWNER_IDS),
      staffIds: listCount(env.ADMIN_STAFF_IDS),
      password: has(env, "ADMIN_PASSWORD"),
    },
    login: { naver: has(env, "NAVER_CLIENT_ID") && has(env, "NAVER_CLIENT_SECRET") },
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
  };
}
