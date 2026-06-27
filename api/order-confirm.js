// api/order-confirm.js
// 발주 누락방지: 사장님이 텔레그램 알림의 '발주 완료 처리' 버튼을 누르면 이 엔드포인트가
// 해당 주문의 status 를 'ordered'(발주 챙김)로 바꾼다 → check-deadlines 마감경고(status=new) 대상에서 빠진다.
// 보호: 링크에 HMAC 토큰(t)을 담아 위조 차단. webhook 불필요(URL 버튼 방식).

import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

function safeEq(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function page(res, ok, title, sub) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(ok ? 200 : 400).send(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>발주 확인 — 꽃안부</title></head>`
    + `<body style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#f7f4ee;color:#1f1d18;`
    + `min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;margin:0;">`
    + `<div><div style="font-size:56px;">${ok ? "✅" : "⚠️"}</div>`
    + `<h2 style="margin:14px 0 6px;font-size:20px;">${title}</h2>`
    + `<p style="color:#5a564d;font-size:14px;">${sub || ""}</p></div></body></html>`
  );
}

export default async function handler(req, res) {
  let id = "", t = "";
  try {
    const u = new URL(req.url, "http://localhost");
    id = u.searchParams.get("id") || "";
    t = u.searchParams.get("t") || "";
  } catch (e) {
    id = (req.query && req.query.id) || "";
    t = (req.query && req.query.t) || "";
  }

  const secret = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
  if (!id || !t || !secret) return page(res, false, "잘못된 요청입니다.", "주소가 올바르지 않아요.");

  const expect = crypto.createHmac("sha256", secret).update("confirm:" + id).digest("hex").slice(0, 20);
  if (!safeEq(t, expect)) return page(res, false, "링크가 유효하지 않습니다.", "버튼을 다시 확인해주세요.");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return page(res, false, "서버 설정 오류", "Supabase 환경변수가 없습니다.");

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status: "ordered", ordered_at: new Date().toISOString() }),
      }
    );
    if (!r.ok) {
      // ordered_at 컬럼이 없을 수 있음 → status만 다시 시도
      const r2 = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ status: "ordered" }),
        }
      );
      if (!r2.ok) return page(res, false, "처리 실패", "잠시 후 다시 시도해주세요.");
    }
    return page(res, true, "발주 확인 완료!", "이 주문은 챙긴 것으로 표시했어요. 마감 경고가 더 오지 않습니다.");
  } catch (e) {
    return page(res, false, "오류가 발생했습니다.", "잠시 후 다시 시도해주세요.");
  }
}
