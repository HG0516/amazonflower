// api/order-photo.js
// 배송완료 사진 업로드 — 사장님(관리자 비번) 전용. Supabase Storage(gallery 버킷 orders/ 경로)에 저장 +
// orders 테이블의 completed_photo/completed_at 갱신 + status='delivered'.
// gallery-add.js 와 같은 보안 패턴(상수시간 비번, JPEG 매직바이트, 용량 한도, 보상 삭제).

import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const ORIGIN = "https://amazonflower.vercel.app";
const MAX_B64 = 4_000_000;
const MAX_BYTES = 3 * 1024 * 1024;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
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
    return res.status(503).json({ error: "업로드 기능이 아직 설정되지 않았습니다. (SUPABASE_URL / SERVICE_ROLE_KEY / ADMIN_PASSWORD 필요)" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { password, orderId, imageBase64 } = body;

  if (!safeEqual(password, ADMIN_PW)) return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });
  const oid = String(orderId || "").trim();
  if (!oid || !/^[A-Za-z0-9._-]{4,64}$/.test(oid)) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
  if (!imageBase64 || typeof imageBase64 !== "string") return res.status(400).json({ error: "사진이 없습니다." });
  if (imageBase64.length > MAX_B64) return res.status(413).json({ error: "사진 용량이 큽니다. 더 작게 찍어 올려주세요." });

  let buf;
  try { buf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"); }
  catch { return res.status(400).json({ error: "사진 데이터를 읽을 수 없습니다." }); }
  if (!buf.length || buf.length > MAX_BYTES) return res.status(413).json({ error: "사진 용량이 큽니다. (3MB 이하)" });
  if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return res.status(400).json({ error: "JPG 이미지만 올릴 수 있어요." });

  // 주문 존재 확인 (없는 주문번호로 사진만 쌓이는 것 방지)
  try {
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=order_id&order_id=eq.${encodeURIComponent(oid)}&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const rows = await chk.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: "그 주문번호를 찾을 수 없어요. 번호를 확인해주세요." });
  } catch { /* 확인 실패해도 업로드는 진행 */ }

  const path = `orders/${oid}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.jpg`;

  // 1) Storage 업로드 (gallery 버킷 재사용, orders/ 경로 — 공개 읽기)
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${encodeURI(path)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: buf,
  });
  if (!up.ok) {
    console.error("order-photo storage fail", up.status, await up.text().catch(() => ""));
    return res.status(502).json({ error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." });
  }
  const photo_url = `${SUPABASE_URL}/storage/v1/object/public/gallery/${encodeURI(path)}`;

  // 2) orders 갱신 (completed_photo/completed_at + status=delivered)
  let patchOk = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ completed_photo: photo_url, completed_at: new Date().toISOString(), status: "delivered" }),
    });
    patchOk = r.ok;
  } catch { patchOk = false; }

  if (!patchOk) {
    // 컬럼이 아직 없거나 갱신 실패 → 방금 올린 고아 객체 삭제
    fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${encodeURI(path)}`, { method: "DELETE", headers: { Authorization: `Bearer ${SERVICE_KEY}` } }).catch(() => {});
    return res.status(502).json({ error: "주문에 사진을 연결하지 못했어요. (supabase-auth.sql 의 completed_photo 컬럼이 필요할 수 있어요)" });
  }

  return res.status(200).json({ ok: true, photo_url });
}
