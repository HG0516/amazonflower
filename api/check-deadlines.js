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

// ── 애플 Sign in with Apple: Client Secret(JWT) 만료 임박 알림 ──
// 애플 웹 로그인 시크릿(JWT)은 최대 6개월이면 만료된다. 만료되면 애플 로그인이 막히므로,
// 만료 임계일(D-day)에 사장님 텔레그램으로 "재발급하라"고 알린다.
// ⚠️ 재발급하면 아래 APPLE_SECRET_EXPIRY 를 새 만료일로 바꿔야 한다. (재발급 방법: apple-signin.local.md)
const APPLE_SECRET_EXPIRY = "2027-01-03"; // 현재 Supabase에 넣은 애플 client secret(JWT) 만료일 (YYYY-MM-DD, KST)
const APPLE_ALERT_DAYS = [60, 45, 30, 21, 14, 7, 3, 1]; // 이 D-day들에 알림

async function checkAppleSecretExpiry(now) {
  // 30분 크론이라 하루에 한 번만 알리도록 KST 09:00~09:29 창에서만 발송(스팸 방지).
  const kstHour = (now.getUTCHours() + 9) % 24;
  if (kstHour !== 9 || now.getUTCMinutes() >= 30) return;
  const exp = new Date(APPLE_SECRET_EXPIRY + "T00:00:00+09:00");
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
  if (!APPLE_ALERT_DAYS.includes(daysLeft)) return;
  await sendTelegram(
    `🍎 애플 로그인 보안키 만료 D-${daysLeft} (${APPLE_SECRET_EXPIRY})\n`
    + `만료되면 애플 로그인이 막혀요. 6개월짜리 Client Secret(JWT)을 재발급해야 합니다.\n`
    + `재발급: 다운로드 폴더의 AuthKey_*.p8 로 새 JWT 생성 → Supabase Apple provider의 Secret Key 교체.\n`
    + `(간단히: 클로드에게 "애플 시크릿 재발급" 요청 → 명령 한 줄로 새 JWT 생성)`
  );
}

// ── 사장님 브리핑 (아침/점심/저녁) — 미결 주문·오늘 행사·매출 한 통 요약 ──
const BRIEF_META = {
  morning: { emoji: "🌅", label: "아침 브리핑" },
  noon:    { emoji: "☀️", label: "점심 브리핑" },
  evening: { emoji: "🌆", label: "저녁 브리핑" },
};
function kstDayRangeUtc(offsetDays) {
  // KST 자정 기준 [시작,끝) 을 UTC ISO로. offsetDays: 0=오늘, -1=어제, 1=내일
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600000);
  const day = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + offsetDays));
  const start = new Date(day.getTime() - 9 * 3600000);
  return [start.toISOString(), new Date(start.getTime() + 86400000).toISOString()];
}
function kstDT(iso) {
  // 오늘이면 HH:MM, 다른 날이면 M/D HH:MM
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  const now = new Date(Date.now() + 9 * 3600000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const sameDay = d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
  return sameDay ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
}
function briefLine(o) {
  const st = o.status === "ordered" ? "🟡" : o.status === "delivered" ? "✅" : "🔴";
  const when = o.event_at ? kstDT(o.event_at) : (o.event_time || "시간미정");
  const who = [o.recipient_name, o.venue].filter(Boolean).join(" / ") || "받는분 미상";
  return ` ${st} ${when} ${o.product_label || o.product_code || "주문"} — ${who}`;
}
async function runBriefing(kind, SUPABASE_URL, sbHeaders) {
  const meta = BRIEF_META[kind];
  const [todayS, todayE] = kstDayRangeUtc(0);
  const [yesterS] = kstDayRangeUtc(-1);
  const [tomorS, tomorE] = kstDayRangeUtc(1);
  const sel = "order_id,status,product_label,product_code,recipient_name,venue,event_at,event_time,created_at,paid_amount,amount";
  let failed = false;
  // count=exact + Content-Range 로 진짜 총 건수 확보(limit에 잘려도 "N건"이 정확하게)
  const get = async (qs, limit) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=${sel}&${qs}&limit=${limit}`, {
        headers: { ...sbHeaders, Prefer: "count=exact" },
      });
      if (!r.ok) { failed = true; return { rows: [], total: 0 }; }
      const rows = (await r.json().catch(() => [])) || [];
      const cr = r.headers.get("content-range") || "";
      const total = parseInt(cr.split("/")[1], 10);
      return { rows, total: Number.isFinite(total) ? total : rows.length };
    } catch { failed = true; return { rows: [], total: 0 }; }
  };
  const [pending, today, tomorrow, sales] = await Promise.all([
    get(`status=eq.new&order=event_at.asc.nullslast`, 12),
    get(`event_at=gte.${encodeURIComponent(todayS)}&event_at=lt.${encodeURIComponent(todayE)}&status=neq.canceled&order=event_at.asc`, 12),
    get(`event_at=gte.${encodeURIComponent(tomorS)}&event_at=lt.${encodeURIComponent(tomorE)}&status=neq.canceled&order=event_at.asc`, 12),
    kind === "morning"
      ? get(`created_at=gte.${encodeURIComponent(yesterS)}&created_at=lt.${encodeURIComponent(todayS)}&status=neq.canceled`, 200)
      : get(`created_at=gte.${encodeURIComponent(todayS)}&status=neq.canceled`, 200),
  ]);
  if (failed) return { sent: false, reason: "query_failed" }; // 데이터가 불완전하면 틀린 브리핑 대신 침묵

  const salesSum = sales.rows.reduce((s, o) => s + (Number(o.paid_amount || o.amount) || 0), 0);
  const salesLabel = kind === "morning" ? "어제 매출" : "오늘 매출";

  const quiet = !pending.total && !today.total && !tomorrow.total && !sales.total;
  if (quiet && kind !== "morning") return { sent: false, reason: "quiet" }; // 조용하면 아침에만 알림

  const kstNow = new Date(Date.now() + 9 * 3600000);
  const dateStr = `${kstNow.getUTCMonth() + 1}/${kstNow.getUTCDate()}(${"일월화수목금토"[kstNow.getUTCDay()]})`;
  const L = [`${meta.emoji} ${meta.label} — ${dateStr}`];
  if (pending.total) {
    L.push(`\n📋 미결 주문 ${pending.total}건 (아직 발주 전)`);
    for (const o of pending.rows.slice(0, 8)) L.push(briefLine(o));
    if (pending.total > 8) L.push(` … 외 ${pending.total - 8}건 — 관리 화면에서 확인`);
  }
  if (today.total) {
    L.push(`\n🌸 오늘 행사 ${today.total}건 (🔴접수 🟡준비중 ✅완료)`);
    for (const o of today.rows) L.push(briefLine(o));
    if (today.total > today.rows.length) L.push(` … 외 ${today.total - today.rows.length}건`);
  }
  if (kind === "evening" && tomorrow.total) {
    L.push(`\n📅 내일 행사 ${tomorrow.total}건`);
    for (const o of tomorrow.rows) L.push(briefLine(o));
  }
  L.push(`\n💰 ${salesLabel} ${salesSum.toLocaleString()}원 (${sales.total}건)`);
  if (quiet) L.push("\n오늘은 조용해요. 좋은 하루 되세요 🌿");
  L.push(`\n주문 관리 → https://amazonflower.vercel.app/admin-orders.html`);
  const ok = await sendTelegram(L.join("\n"));
  return { sent: ok };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEq(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 브리핑 모드 — pg_cron이 ?briefing=morning|noon|evening 으로 하루 3번 호출
  let briefKind = "";
  try { briefKind = new URL(req.url, "http://localhost").searchParams.get("briefing") || ""; } catch {}
  if (briefKind && BRIEF_META[briefKind]) {
    const SUPABASE_URL_B = process.env.SUPABASE_URL;
    const SERVICE_KEY_B = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL_B || !SERVICE_KEY_B) return res.status(503).json({ error: "supabase env missing" });
    try {
      const out = await runBriefing(briefKind, SUPABASE_URL_B, { apikey: SERVICE_KEY_B, Authorization: `Bearer ${SERVICE_KEY_B}` });
      return res.status(200).json({ ok: true, briefing: briefKind, ...out });
    } catch (e) {
      console.error("briefing error:", e.message);
      return res.status(500).json({ error: "briefing_failed" });
    }
  }

  // 애플 로그인 시크릿 만료 임박 알림 (배송 체크와 독립 — 실패해도 아래 로직엔 영향 없음)
  try { await checkAppleSecretExpiry(new Date()); } catch (e) { console.error("apple secret check:", e.message); }

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
