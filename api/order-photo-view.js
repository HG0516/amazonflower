// 비공개 배송완료 사진 프록시.
// GET  + Authorization Bearer: 로그인 사용자의 본인 주문 조회(기존 경로).
// POST + {token}: 비회원에게 문자로 보낸 30일 보안 토큰 조회.
// 어떤 경로에서도 Supabase 객체 URL·내부 경로를 고객에게 노출하지 않는다.

import { hashGuestToken, normalizeOrderPhotoPath } from "../lib/photo-access.mjs";

export const config = { runtime: "nodejs" };

const BUCKET = "order-photos";
const MAX_SERVED_BYTES = 5 * 1024 * 1024;

function sbHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}
function setPrivateHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Vary", "Authorization");
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body && typeof body === "object" ? body : {};
}

function denied(res) {
  // 토큰 존재·만료·취소 여부를 구분해 주지 않는다.
  return res.status(404).json({ error: "사진 링크가 만료되었거나 사용할 수 없습니다." });
}

async function canceledInPaymentLedger(supabaseUrl, serviceKey, oid) {
  if (!oid) return true;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/payment_intents?order_id=eq.${encodeURIComponent(oid)}&select=state,toss_status&limit=1`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!response.ok) return true;
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return true;
    const row = rows[0];
    return !!(row && (["canceling", "canceled"].includes(row.state) || row.toss_status === "CANCELED"));
  } catch { return true; }
}

async function guestPhotoPath(req, res, supabaseUrl, serviceKey) {
  const tokenHash = hashGuestToken(parseBody(req).token);
  if (!tokenHash) return denied(res);
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?photo_access_token_hash=eq.${tokenHash}`
        + "&select=order_id,completed_photo,status,canceled_at,cancel_requested_at,photo_access_expires_at&limit=1",
      { headers: sbHeaders(serviceKey) },
    );
    if (!response.ok) return res.status(502).json({ error: "사진을 불러오지 못했습니다." });
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return res.status(502).json({ error: "사진을 불러오지 못했습니다." });
    const row = rows[0];
    const expires = row && Date.parse(row.photo_access_expires_at || "");
    if (!row || row.status !== "delivered" || row.canceled_at || row.cancel_requested_at || !Number.isFinite(expires) || expires <= Date.now()) {
      return denied(res);
    }
    if (await canceledInPaymentLedger(supabaseUrl, serviceKey, row.order_id)) return denied(res);
    const path = normalizeOrderPhotoPath(row.completed_photo);
    return path || denied(res);
  } catch { return res.status(502).json({ error: "사진을 불러오지 못했습니다." }); }
}

async function memberPhotoPath(req, res, supabaseUrl, serviceKey) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "로그인이 필요합니다." });

  let oid = "";
  try { oid = new URL(req.url, "http://localhost").searchParams.get("order") || ""; }
  catch { oid = (req.query && req.query.order) || ""; }
  oid = String(oid).trim();
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(oid)) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });

  let uid = "";
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${match[1]}` },
    });
    if (!response.ok) return res.status(401).json({ error: "유효하지 않은 로그인입니다." });
    const user = await response.json().catch(() => ({}));
    uid = user && user.id ? String(user.id) : "";
  } catch { return res.status(401).json({ error: "인증 확인 실패" }); }
  if (!uid) return res.status(401).json({ error: "유효하지 않은 로그인입니다." });

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}`
        + `&user_id=eq.${encodeURIComponent(uid)}&select=order_id,completed_photo,status,canceled_at,cancel_requested_at&limit=1`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!response.ok) return res.status(502).json({ error: "사진을 불러오지 못했습니다." });
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return res.status(502).json({ error: "사진을 불러오지 못했습니다." });
    const row = rows[0];
    if (!row || row.status !== "delivered" || row.canceled_at || row.cancel_requested_at) return denied(res);
    if (await canceledInPaymentLedger(supabaseUrl, serviceKey, row.order_id)) return denied(res);
    const path = normalizeOrderPhotoPath(row.completed_photo);
    return path || denied(res);
  } catch { return res.status(502).json({ error: "사진을 불러오지 못했습니다." }); }
}

export default async function handler(req, res) {
  setPrivateHeaders(res);
  res.setHeader("Allow", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "지원하지 않는 요청입니다." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "서버 설정 오류" });

  const path = req.method === "POST"
    ? await guestPhotoPath(req, res, supabaseUrl, serviceKey)
    : await memberPhotoPath(req, res, supabaseUrl, serviceKey);
  // 위 함수가 오류 응답을 이미 끝냈을 때는 문자열 경로가 아니다.
  if (typeof path !== "string") return path;

  try {
    const objectResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!objectResponse.ok) return denied(res);
    const declared = Number(objectResponse.headers.get("content-length") || 0);
    if (declared > MAX_SERVED_BYTES) return res.status(413).json({ error: "사진 용량이 너무 큽니다." });
    const buf = Buffer.from(await objectResponse.arrayBuffer());
    if (!buf.length || buf.length > MAX_SERVED_BYTES || buf[0] !== 0xFF || buf[1] !== 0xD8) return denied(res);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", "inline");
    return res.status(200).send(buf);
  } catch { return res.status(502).json({ error: "사진을 불러오지 못했습니다." }); }
}
