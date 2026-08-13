import crypto from "node:crypto";

export const PHOTO_UPLOAD_TOKEN_VERSION = "v1";
export const PHOTO_UPLOAD_TTL_SECONDS = 72 * 60 * 60;
export const PHOTO_GUEST_TTL_SECONDS = 30 * 24 * 60 * 60;
// 2026-08-14 이전에 이미 기사에게 보낸 무기한 토큰을 갑자기 깨지 않기 위한 짧은 전환창.
// 이 시각 이후에는 v1(주문+만료시각 결박) 링크만 허용한다.
export const LEGACY_PHOTO_LINK_CUTOFF_MS = Date.parse("2026-08-22T00:00:00+09:00");

const GUEST_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_UPLOAD_LINK_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(aa, bb); } catch { return false; }
}

function unixSeconds(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * 기사 업로드 링크 전용 비밀키.
 * PHOTO_UPLOAD_SECRET 분리를 권장하지만 기존 배포와의 호환을 위해 CRON_SECRET을 폴백으로 쓴다.
 * 결제 비밀키는 사진 링크 서명에 재사용하지 않는다.
 */
export function getPhotoUploadSecret(env = process.env) {
  return String(env.PHOTO_UPLOAD_SECRET || env.CRON_SECRET || "");
}

/** 관리자 API가 기사 링크를 만들 때 사용하는 서명 함수. expiresAt은 Unix seconds. */
export function signUploadToken(orderId, expiresAt, secret) {
  const oid = String(orderId || "").trim();
  const exp = unixSeconds(expiresAt);
  const key = String(secret || "");
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(oid) || !exp || !key) return "";
  return crypto
    .createHmac("sha256", key)
    .update(`upload:${PHOTO_UPLOAD_TOKEN_VERSION}:${oid}:${exp}`)
    .digest("base64url");
}

/** 기사 링크 검증. 너무 먼 미래의 링크도 거부해 실수로 사실상 영구 링크가 되는 것을 막는다. */
export function verifyUploadToken({ orderId, expiresAt, token, secret, nowMs = Date.now() }) {
  const exp = unixSeconds(expiresAt);
  const now = Math.floor(Number(nowMs) / 1000);
  if (!String(secret || "")) return { ok: false, reason: "secret_missing" };
  if (!exp || !Number.isSafeInteger(now)) return { ok: false, reason: "invalid" };
  if (exp <= now) return { ok: false, reason: "expired" };
  if (exp - now > MAX_UPLOAD_LINK_LIFETIME_SECONDS) return { ok: false, reason: "invalid" };
  const expected = signUploadToken(orderId, exp, secret);
  if (!expected || !safeEqual(token, expected)) return { ok: false, reason: "invalid" };
  return { ok: true, expiresAt: exp };
}

/** 구형 `HMAC(photo:orderId)` 링크의 한시적 전환 검증. 새 링크 발급에는 절대 쓰지 않는다. */
export function verifyLegacyUploadToken({ orderId, token, env = process.env, nowMs = Date.now() }) {
  if (Number(nowMs) >= LEGACY_PHOTO_LINK_CUTOFF_MS) return { ok: false, reason: "legacy_expired" };
  const oid = String(orderId || "").trim();
  const raw = String(token || "");
  const key = String(env.CRON_SECRET || env.TOSS_SECRET_KEY || "");
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(oid) || !/^[a-f0-9]{24}$/i.test(raw) || !key) {
    return { ok: false, reason: "invalid" };
  }
  const expected = crypto.createHmac("sha256", key).update(`photo:${oid}`).digest("hex").slice(0, 24);
  return safeEqual(raw, expected) ? { ok: true, legacy: true } : { ok: false, reason: "invalid" };
}

export function createGuestAccess({ nowMs = Date.now(), ttlSeconds = PHOTO_GUEST_TTL_SECONDS } = {}) {
  const ttl = Number.isSafeInteger(ttlSeconds) && ttlSeconds > 0
    ? ttlSeconds
    : PHOTO_GUEST_TTL_SECONDS;
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Number(nowMs) + ttl * 1000).toISOString(),
  };
}

/** 비회원이 보낸 원문 토큰을 DB 조회용 해시로 바꾼다. 형식이 다르면 null. */
export function hashGuestToken(token) {
  const raw = String(token || "");
  if (!GUEST_TOKEN_RE.test(raw)) return null;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * DB의 과거 공개/서명 URL 또는 현재 객체 경로를 비공개 버킷 내부 경로로 정규화한다.
 * 고정 Supabase 호스트에만 요청하더라도 경로 탈출·예상 밖 객체 접근은 차단한다.
 */
export function normalizeOrderPhotoPath(value) {
  let path = String(value || "").trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    const match = path.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?.*)?$/);
    if (!match) return null;
    try { path = decodeURIComponent(match[1]); } catch { return null; }
  }
  path = path.replace(/^\/+/, "");
  if (!path || path.length > 300 || path.includes("..") || path.includes("\\")) return null;
  if (!/^[A-Za-z0-9._/-]+\.jpe?g$/i.test(path)) return null;
  return path;
}
