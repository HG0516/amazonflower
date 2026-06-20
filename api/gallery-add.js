// api/gallery-add.js
// 부모님(사장님) 전용 갤러리 업로드 — 관리자 비번 확인 후 Supabase Storage에 사진 저장 +
// gallery_items 테이블에 한 줄 추가. 결제(confirm-payment)와 완전히 분리돼 있다.
//
// 보안:
//  - SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD 는 이 서버 함수 안에서만 사용(프론트 노출 금지).
//  - 비번은 상수시간 비교, 입력(name/sub/color)은 서버에서 정화(저장형 XSS 2차 방어).
//  - JPEG 매직바이트 검증, 용량·하루 업로드 한도(남용/스토리지 고갈 방지), CORS 자기 도메인 고정.
//  - 클라이언트(catalog)는 anon 키로 visible=true 만 읽고, 출력 시에도 HTML 이스케이프(1차 방어).

import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const ORIGIN = "https://amazonflower.vercel.app";
const CATEGORIES = ["plant", "orchid", "basket", "congrats", "condolence"];
const SUB_CANON = { plant: "관엽", congrats: "축하", condolence: "근조" }; // 세부분류 없는 카테고리는 대표값 고정
const SUB_ALLOWED = { orchid: ["동양란", "서양란"], basket: ["꽃다발", "꽃바구니"] };
const MAX_B64 = 4_000_000;          // base64 길이 선검사(디코드 전, Vercel 4.5MB 본문 한도 대비)
const MAX_BYTES = 3 * 1024 * 1024;  // 디코드 후 상한
const DAILY_LIMIT = 100;            // 하루 업로드 상한(남용/스토리지 고갈 방지)

function clean(s, n) {
  return String(s == null ? "" : s).replace(/[<>"'`&\\]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
}
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
    return res.status(503).json({ error: "업로드 기능이 아직 설정되지 않았습니다. (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ADMIN_PASSWORD 필요)" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { password, category, name, sub, color, imageBase64 } = body;

  if (!safeEqual(password, ADMIN_PW)) return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "카테고리가 올바르지 않습니다." });
  const cleanName = clean(name, 40);
  if (!cleanName) return res.status(400).json({ error: "꽃 이름을 입력해주세요." });
  if (!imageBase64 || typeof imageBase64 !== "string") return res.status(400).json({ error: "사진이 없습니다." });
  if (imageBase64.length > MAX_B64) return res.status(413).json({ error: "사진 용량이 큽니다. 더 작게 찍어 올려주세요." });

  // sub 정규화: 세부 없는 카테고리는 대표값, 있는 카테고리는 화이트리스트만
  let cleanSub = null;
  if (SUB_CANON[category]) cleanSub = SUB_CANON[category];
  else { const s = String(sub || "").trim(); if ((SUB_ALLOWED[category] || []).includes(s)) cleanSub = s; }
  const cleanColor = color ? clean(color, 30) : null;

  let buf;
  try { buf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"); }
  catch { return res.status(400).json({ error: "사진 데이터를 읽을 수 없습니다." }); }
  if (!buf.length || buf.length > MAX_BYTES) return res.status(413).json({ error: "사진 용량이 큽니다. (3MB 이하)" });
  if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return res.status(400).json({ error: "JPG 이미지만 올릴 수 있어요." }); // JPEG 매직바이트

  // 하루 업로드 한도
  try {
    const since = new Date(Date.now() - 86400000).toISOString();
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items?select=id&created_at=gte.${since}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "count=exact", Range: "0-0" } });
    const total = Number((cr.headers.get("content-range") || "").split("/")[1] || 0);
    if (total >= DAILY_LIMIT) return res.status(429).json({ error: "오늘 업로드 한도를 초과했어요. 내일 다시 시도해주세요." });
  } catch { /* 카운트 실패해도 업로드는 진행 */ }

  const path = `${category}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;

  // 1) Storage 업로드
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${encodeURI(path)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: buf,
  });
  if (!up.ok) {
    console.error("storage upload fail", up.status, await up.text().catch(() => ""));
    return res.status(502).json({ error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." });
  }
  const photo_url = `${SUPABASE_URL}/storage/v1/object/public/gallery/${encodeURI(path)}`;

  // 2) 테이블 insert (실패 시 방금 올린 고아 객체 보상 삭제)
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ category, name: cleanName, sub: cleanSub, color: cleanColor, photo_url }),
  });
  if (!ins.ok) {
    console.error("insert fail", ins.status, await ins.text().catch(() => ""));
    fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${encodeURI(path)}`, { method: "DELETE", headers: { Authorization: `Bearer ${SERVICE_KEY}` } }).catch(() => {});
    return res.status(502).json({ error: "목록 저장에 실패했습니다. 다시 시도해주세요." });
  }
  const rows = await ins.json().catch(() => []);
  return res.status(200).json({ ok: true, item: Array.isArray(rows) ? rows[0] : rows });
}
