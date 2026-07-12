// api/admin-orders.js
// 사장님(아버지) 전용 주문 관리 대시보드 API — 관리자 비번 확인 후:
//  - action 'list'(기본): 최근 주문 목록 반환 (service_role 로 orders 읽기, RLS 우회)
//  - action 'status': 주문 상태 변경 (new→ordered→delivered). 배송완료로 바꾸면 마감 알림 대상에서 빠짐.
//
// 보안(api/gallery-add.js 와 동일 원칙):
//  - SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD 는 서버 함수 안에서만. 비번 상수시간 비교. CORS 자기 도메인.
//  - orders 는 개인정보라 anon 공개읽기 차단(RLS) → 반드시 이 서버 함수로만 조회.

import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const ORIGIN = "https://amazonflower.vercel.app";
const STATUS_ALLOWED = new Set(["new", "ordered", "delivered"]);
const COLS = [
  "order_id","created_at","status","product_label","product_code","category","order_type",
  "amount","paid_amount","discount_points",
  "recipient_name","recipient_phone",
  "venue","address","road_address","detail_address","building_name","room_info","zip_code",
  "event_date","event_time","event_at","delivery_date","delivery_time_slot",
  "sender_name","sender_phone","orderer_name","orderer_phone","orderer_email",
  "ribbon","ribbon_text","ribbon_sender","note","request_note",
  "completed_photo","delivered_photo_url","completed_at","ordered_at","alerted_at",
  "utm_source","utm_medium","referral_source"
].join(",");

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
    return res.status(503).json({ error: "주문 관리 기능이 아직 설정되지 않았습니다." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { password, action, orderId, status } = body;

  if (!safeEqual(password, ADMIN_PW)) return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });

  const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  // ── 상태 변경 ──
  if (action === "status") {
    if (!orderId || typeof orderId !== "string" || orderId.length > 60) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });
    if (!STATUS_ALLOWED.has(status)) return res.status(400).json({ error: "상태 값이 올바르지 않습니다." });
    const patch = { status };
    const nowIso = new Date().toISOString();
    if (status === "ordered") patch.ordered_at = nowIso;
    if (status === "delivered" && !body.keepCompletedAt) patch.completed_at = nowIso;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      console.error("order status patch fail", r.status, await r.text().catch(() => ""));
      return res.status(502).json({ error: "상태 변경에 실패했습니다." });
    }
    return res.status(200).json({ ok: true });
  }

  // ── 목록 (기본) ──
  const limit = Math.min(200, Math.max(1, parseInt(body.limit, 10) || 100));
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=${COLS}&order=created_at.desc&limit=${limit}`, { headers: sb });
  if (!r.ok) {
    console.error("orders list fail", r.status, await r.text().catch(() => ""));
    return res.status(502).json({ error: "주문을 불러오지 못했습니다." });
  }
  const orders = await r.json().catch(() => []);
  return res.status(200).json({ ok: true, orders: Array.isArray(orders) ? orders : [] });
}
