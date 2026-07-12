// api/product-edit.js
// 아버지(사장님) 전용 상품 편집 — 관리자 비번 확인 후 product_overrides 테이블에 upsert.
// 편집 항목: 한줄설명(subtitle) · 상세설명(description) · 판매상태(status) · 사진(photos).
//
// ⚠️ 가격은 다루지 않습니다. 판매가는 products.mjs(결제검증) 단일 소스 그대로 →
//    이 엔드포인트는 confirm-payment 와 완전히 분리, 결제 금액에 영향 없음(Phase 1).
//
// 보안(api/gallery-add.js 와 동일 원칙):
//  - SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD 는 서버 함수 안에서만 사용(프론트 노출 금지).
//  - 비번 상수시간 비교, 입력 정화(저장형 XSS 2차 방어), JPEG 매직바이트·용량 검증, CORS 자기 도메인 고정.
//  - pc 는 products.mjs 의 실제 상품 코드만 허용, photos URL 은 자기 사진 경로만 허용(임의 URL 주입 차단).

import crypto from "node:crypto";
import { PRODUCTS } from "../products.mjs";

export const config = { runtime: "nodejs" };

const ORIGIN = "https://amazonflower.vercel.app";
const VALID_PC = new Set(PRODUCTS.map((p) => p.pc));
const STATUS_ALLOWED = new Set(["판매중", "품절"]);
const MAX_PHOTOS = 8;
const MAX_B64 = 4_000_000; // base64 길이 선검사(디코드 전, Vercel 4.5MB 본문 한도 대비)
const MAX_BYTES = 3 * 1024 * 1024; // 디코드 후 상한

function clean(s, n) {
  return String(s == null ? "" : s).replace(/[<>"'`\\]/g, "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}
// 자기 사진만 허용: 정적 /photos/... 또는 우리 Supabase Storage public/gallery/... URL
function allowedPhoto(url, supabaseUrl) {
  const u = String(url || "");
  if (/^\/photos\/[A-Za-z0-9가-힣/_\-.]+\.(jpg|jpeg|png|webp)$/i.test(u)) return u;
  if (u.startsWith(`${supabaseUrl}/storage/v1/object/public/gallery/`)) return u;
  return null;
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
    return res.status(503).json({ error: "편집 기능이 아직 설정되지 않았습니다. (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ADMIN_PASSWORD 필요)" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { password, pc, subtitle, description, status, photos, newPhotoBase64 } = body;

  if (!safeEqual(password, ADMIN_PW)) return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });
  if (!VALID_PC.has(pc)) return res.status(400).json({ error: "상품 코드가 올바르지 않습니다." });

  // 사진 배열 정화(자기 사진 경로만) + 개수 제한
  let finalPhotos = [];
  if (Array.isArray(photos)) {
    for (const p of photos) {
      const ok = allowedPhoto(p, SUPABASE_URL);
      if (ok && !finalPhotos.includes(ok)) finalPhotos.push(ok);
    }
    finalPhotos = finalPhotos.slice(0, MAX_PHOTOS);
  }

  // 새 사진 업로드(선택) → gallery 버킷의 product/ 경로에 저장 후 배열에 추가
  if (newPhotoBase64) {
    if (typeof newPhotoBase64 !== "string" || newPhotoBase64.length > MAX_B64) {
      return res.status(413).json({ error: "사진 용량이 큽니다. 더 작게 찍어 올려주세요." });
    }
    if (finalPhotos.length >= MAX_PHOTOS) return res.status(400).json({ error: `사진은 최대 ${MAX_PHOTOS}장까지예요.` });
    let buf;
    try { buf = Buffer.from(newPhotoBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"); }
    catch { return res.status(400).json({ error: "사진 데이터를 읽을 수 없습니다." }); }
    if (!buf.length || buf.length > MAX_BYTES) return res.status(413).json({ error: "사진 용량이 큽니다. (3MB 이하)" });
    if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return res.status(400).json({ error: "JPG 이미지만 올릴 수 있어요." }); // JPEG 매직바이트

    const path = `product/${encodeURIComponent(pc)}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) {
      console.error("product photo upload fail", up.status, await up.text().catch(() => ""));
      return res.status(502).json({ error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." });
    }
    finalPhotos.push(`${SUPABASE_URL}/storage/v1/object/public/gallery/${path}`);
  }

  // 필드 정화 — 빈 값은 null(정적 기본값으로 복귀)
  const row = {
    pc,
    subtitle: subtitle != null ? (clean(subtitle, 60) || null) : null,
    description: description != null ? (clean(description, 800) || null) : null,
    status: STATUS_ALLOWED.has(status) ? status : null,
    photos: finalPhotos.length ? finalPhotos : null,
    updated_at: new Date().toISOString(),
  };

  // upsert (pc 충돌 시 병합)
  const r = await fetch(`${SUPABASE_URL}/rest/v1/product_overrides?on_conflict=pc`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    console.error("override upsert fail", r.status, await r.text().catch(() => ""));
    return res.status(502).json({ error: "저장에 실패했습니다. 다시 시도해주세요." });
  }
  const rows = await r.json().catch(() => []);
  return res.status(200).json({ ok: true, item: Array.isArray(rows) ? rows[0] : rows });
}
