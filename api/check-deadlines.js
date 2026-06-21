// api/check-deadlines.js
// 식/발인이 임박했거나 이미 지났는데 아직 '배송완료'가 안 된 주문을 찾아 사장님 텔레그램으로 경고한다.
// Supabase pg_cron 이 주기적으로(예: 30분마다) Authorization 헤더로 이 엔드포인트를 호출한다.
// 보호: CRON_SECRET (Authorization: Bearer <secret>). 미설정/불일치면 401.

import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const ALERT_WINDOW_HOURS = 3;  // 행사 N시간 전부터 경고
const GRACE_PAST_HOURS = 24;   // 행사 지났어도 24h까지는 미배송이면 계속 경고(놓침 방지)

function safeEq(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: tag + text, disable_web_page_preview: true }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEq(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "supabase env missing" });
  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  const now = new Date();
  const until = new Date(now.getTime() + ALERT_WINDOW_HOURS * 3600000);
  const floor = new Date(now.getTime() - GRACE_PAST_HOURS * 3600000);

  // 미배송(new) + 아직 경고 안 함 + 행사시각이 [지금-24h, 지금+3h] (지난 미배송도 포함)
  const q = `${SUPABASE_URL}/rest/v1/orders?select=id,product_label,recipient_name,venue,order_type,event_time,event_at`
    + `&status=eq.new&alerted_at=is.null`
    + `&event_at=gte.${encodeURIComponent(floor.toISOString())}`
    + `&event_at=lte.${encodeURIComponent(until.toISOString())}`
    + `&order=event_at.asc`;

  let rows = [];
  try {
    const r = await fetch(q, { headers: sbHeaders });
    if (!r.ok) return res.status(502).json({ error: "query_failed", detail: await r.text().catch(() => "") });
    rows = await r.json();
  } catch (e) {
    return res.status(502).json({ error: "query_exception", detail: e.message });
  }

  let alerted = 0;
  for (const o of rows) {
    // 1) 원자적 선점: alerted_at이 아직 null일 때만 갱신 + 갱신행 반환 → 한 인스턴스만 성공
    let claimed = false;
    try {
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${o.id}&alerted_at=is.null`, {
        method: "PATCH",
        headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ alerted_at: now.toISOString() }),
      });
      if (cr.ok) {
        const u = await cr.json().catch(() => []);
        claimed = Array.isArray(u) && u.length > 0;
      }
    } catch (e) {
      console.error("claim 실패:", e.message);
    }
    if (!claimed) continue; // 다른 실행이 이미 알림 담당

    // 2) 선점 성공한 인스턴스만 발송
    const ev = o.event_at ? new Date(o.event_at) : null;
    const diffH = ev ? Math.round((ev.getTime() - now.getTime()) / 3600000) : null;
    const kind = o.order_type === "funeral" ? "발인/조문" : o.order_type === "wedding" ? "예식" : "행사";
    const past = diffH != null && diffH < 0;
    const when = diffH == null ? "" : past ? ` (⏰ 약 ${-diffH}시간 지남!)` : ` (약 ${diffH}시간 후)`;
    const lines = [
      past ? "🚨 이미 지났는데 미배송!" : "⚠️ 미배송 확인 필요!",
      `${o.product_label || "주문"} — ${[o.recipient_name, o.venue].filter(Boolean).join(" / ")}`,
      `${kind} ${o.event_time || ""}${when}`,
      "아직 '배송완료' 처리가 안 됐어요. 확인해주세요.",
    ];
    const ok = await sendTelegram(lines.join("\n"));
    if (ok) {
      alerted++;
    } else {
      // 발송 실패 → 선점 롤백(다음 cron이 재시도하도록)
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${o.id}`, {
          method: "PATCH",
          headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ alerted_at: null }),
        });
      } catch (e) {
        console.error("롤백 실패:", e.message);
      }
    }
  }

  return res.status(200).json({ ok: true, checked: rows.length, alerted });
}
