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
  let id = "", t = "", mode = "";
  try {
    const u = new URL(req.url, "http://localhost");
    id = u.searchParams.get("id") || "";
    t = u.searchParams.get("t") || "";
    mode = u.searchParams.get("mode") || "";
  } catch (e) {
    id = (req.query && req.query.id) || "";
    t = (req.query && req.query.t) || "";
    mode = (req.query && req.query.mode) || "";
  }

  const secret = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
  if (!id || !t || !secret) return page(res, false, "잘못된 요청입니다.", "주소가 올바르지 않아요.");
  if (!/^[A-Za-z0-9-]{6,40}$/.test(id)) return page(res, false, "잘못된 요청입니다.", "주문번호 형식이 올바르지 않아요.");

  // ── 결제취소(환불) 확인 페이지 — GET은 상태를 바꾸지 않는다(프리페치 안전). 버튼을 눌러야 실행. ──
  // 토큰: REFUND_LINK_SECRET 전용 서명 + 발급월 결박(당월·전월). 페이지에 주문 내용을 보여줘 오환불 방지.
  if (mode === "cancel") {
    const RSECRET = process.env.REFUND_LINK_SECRET || "";
    if (!RSECRET) return page(res, false, "환불 링크가 비활성화되어 있어요.", "주문 관리 화면에서 처리해주세요.");
    const kstYm = (off) => { const d = new Date(Date.now() + 9 * 3600000); d.setUTCMonth(d.getUTCMonth() + off); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
    const mk = (ym) => crypto.createHmac("sha256", RSECRET).update(`cancel:${id}:${ym}`).digest("hex").slice(0, 24);
    if (!safeEq(t, mk(kstYm(0))) && !safeEq(t, mk(kstYm(-1)))) {
      return page(res, false, "링크가 만료됐거나 유효하지 않습니다.", "오래된 주문은 주문 관리 화면(비밀번호)에서 환불해주세요.");
    }

    // 주문 내용 조회 — 사장님이 '무엇을' 환불하는지 보고 누르게
    const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let o = null;
    if (SUPABASE_URL && SERVICE_KEY) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(id)}&select=status,product_label,paid_amount,amount,recipient_name,venue,event_date,event_time&limit=1`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        if (r.ok) o = ((await r.json().catch(() => [])) || [])[0] || null;
      } catch {}
    }
    const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    if (o && o.status === "canceled") return page(res, true, "이미 환불된 주문이에요.", "다시 처리할 필요 없어요.");
    if (o && o.status === "delivered") return page(res, false, "배송완료된 주문이에요.", "이 링크로는 환불할 수 없어요. 주문 관리 화면(비밀번호)에서 처리해주세요.");
    const amt = o ? (Number(o.paid_amount || o.amount) || 0) : 0;
    const info = o
      ? `<div style="background:#fff;border:1px solid #dcd9cf;border-radius:12px;padding:14px;margin-top:14px;text-align:left;font-size:14px;line-height:1.8;">`
        + `<b style="font-size:15px;">${escH(o.product_label || "주문")}</b> · <b style="color:#b3261e;">${amt.toLocaleString()}원</b><br>`
        + `받는 분 ${escH(o.recipient_name || "-")}${o.venue ? " · " + escH(o.venue) : ""}<br>`
        + `${escH([o.event_date, o.event_time].filter(Boolean).join(" ") || "")}`
        + `<span style="color:#9e9a8f;font-size:12px;"> · ${escH(id)}</span></div>`
      : `<p style="color:#5a564d;font-size:14px;">주문번호 <b>${escH(id)}</b></p>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(200).send(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">`
      + `<title>결제취소 — 꽃안부</title></head>`
      + `<body style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#f7f4ee;color:#1f1d18;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;margin:0;">`
      + `<div style="max-width:340px;width:100%;">`
      + `<div style="font-size:52px;">💸</div>`
      + `<h2 style="margin:14px 0 6px;font-size:20px;">이 주문을 환불할까요?</h2>`
      + info
      + `<p style="color:#9e9a8f;font-size:12.5px;margin-top:10px;">손님 카드로 환불됩니다. 당일 결제는 즉시, 이후엔 카드사 기준 3~4영업일.</p>`
      + `<button id="go" style="width:100%;margin-top:12px;padding:15px;border:none;border-radius:12px;background:#b3261e;color:#fff;font-size:16px;font-weight:800;font-family:inherit;cursor:pointer;">결제취소 실행</button>`
      + `<div id="out" style="margin-top:14px;font-size:14px;color:#5a564d;min-height:20px;"></div>`
      + `</div>`
      + `<script>`
      + `document.getElementById("go").onclick=async function(){`
      + `if(!confirm("정말 환불할까요? 되돌릴 수 없습니다."))return;`
      + `this.disabled=true;this.textContent="처리 중...";var out=document.getElementById("out");`
      + `try{var r=await fetch("/api/admin",{method:"POST",headers:{"Content-Type":"application/json"},`
      + `body:JSON.stringify({resource:"order",action:"cancel",orderId:${JSON.stringify(id)},token:${JSON.stringify(t)}})});`
      + `var d=await r.json();`
      + `if(d.ok){this.style.background="#1f4733";this.textContent="✅ 취소 완료";`
      + `out.textContent=d.alreadyCanceled?"이미 취소된 결제였어요.":((d.amount?d.amount.toLocaleString()+"원 ":"")+"환불 처리됐어요. 손님 앱에 취소 알림이 갑니다."+(d.dbSynced===false?" (주문목록 갱신은 실패 — 관리 화면에서 확인해주세요)":""));}`
      + `else{this.disabled=false;this.textContent="결제취소 실행";out.style.color="#b3261e";out.textContent=d.error||"실패했어요. 다시 시도해주세요.";}`
      + `}catch(e){this.disabled=false;this.textContent="결제취소 실행";out.style.color="#b3261e";out.textContent="네트워크 오류 — 다시 시도해주세요.";}`
      + `};`
      + `</scr`+`ipt></body></html>`
    );
  }

  const expect = crypto.createHmac("sha256", secret).update("confirm:" + id).digest("hex").slice(0, 20);
  if (!safeEq(t, expect)) return page(res, false, "링크가 유효하지 않습니다.", "버튼을 다시 확인해주세요.");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return page(res, false, "서버 설정 오류", "Supabase 환경변수가 없습니다.");

  try {
    // 취소(환불)된 주문은 되살리지 않는다 — status=neq.canceled 가드 + 갱신행 확인
    const guard = `order_id=eq.${encodeURIComponent(id)}&status=neq.canceled`;
    const hdrs = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    let updated = null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?${guard}`, {
      method: "PATCH", headers: hdrs,
      body: JSON.stringify({ status: "ordered", ordered_at: new Date().toISOString() }),
    });
    if (r.ok) updated = await r.json().catch(() => null);
    else {
      // ordered_at 컬럼이 없을 수 있음 → status만 다시 시도
      const r2 = await fetch(`${SUPABASE_URL}/rest/v1/orders?${guard}`, {
        method: "PATCH", headers: hdrs, body: JSON.stringify({ status: "ordered" }),
      });
      if (!r2.ok) return page(res, false, "처리 실패", "잠시 후 다시 시도해주세요.");
      updated = await r2.json().catch(() => null);
    }
    if (Array.isArray(updated) && updated.length === 0) {
      return page(res, false, "처리할 수 없는 주문이에요.", "이미 취소(환불)됐거나 없는 주문입니다.");
    }
    return page(res, true, "발주 확인 완료!", "이 주문은 챙긴 것으로 표시했어요. 마감 경고가 더 오지 않습니다.");
  } catch (e) {
    return page(res, false, "오류가 발생했습니다.", "잠시 후 다시 시도해주세요.");
  }
}
