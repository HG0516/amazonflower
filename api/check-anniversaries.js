// api/check-anniversaries.js
// 기념일 D-7 웹푸시 — 7일 뒤가 기념일인 회원에게 푸시 발송.
// Supabase pg_cron 이 하루 1회(예: 매일 09:00 KST) Authorization: Bearer <CRON_SECRET> 로 호출한다.
// (check-deadlines.js 와 동일한 보호·호출 방식)

import webpush from "web-push";
import crypto from "node:crypto";
import KoreanLunarCalendar from "korean-lunar-calendar";

export const config = { runtime: "nodejs" };

// VAPID public 은 공개값(코드/클라 공유). private 은 반드시 Vercel env(VAPID_PRIVATE_KEY).
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "BK4frAB9SMwq4pDiMapQf0uPlZG2nbfPbMR1qxiKs9JT5w5SVvre6dzkrW2NRJT9SWnVs1JE-UtEZ_24usKxFBE";

function safeEq(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEq(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "supabase env missing" });
  if (!VAPID_PRIVATE) return res.status(503).json({ error: "VAPID_PRIVATE_KEY 미설정 (Vercel 환경변수 필요)" });

  webpush.setVapidDetails("mailto:hghdec@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);
  const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  // 한국시간 기준 '7일 뒤'의 월/일과 '오늘'(중복발송 방지 키)
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const kst7 = new Date(kstNow.getTime() + 7 * 86400000);
  const m = kst7.getUTCMonth() + 1;
  const day = kst7.getUTCDate();
  const todayStr = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, "0")}-${String(kstNow.getUTCDate()).padStart(2, "0")}`;

  // D-7 양력날짜(m,day)를 음력으로도 환산(lm,ld) → 음력 기념일도 올해 해당 양력일에 알림
  let lm = null, ld = null;
  try {
    const cal = new KoreanLunarCalendar();
    cal.setSolarDate(kst7.getUTCFullYear(), m, day);
    const lu = cal.getLunarCalendar();
    if (lu && lu.month && lu.day) { lm = lu.month; ld = lu.day; }
  } catch (e) { /* 변환 실패 → 양력만 매칭(안전) */ }

  // D-7 기념일 (오늘 이미 보낸 건 제외). 양력 + 음력 둘 다 매칭.
  let annivs = [];
  try {
    const dateFilter = (lm && ld)
      ? `or(and(cal_type.eq.solar,month.eq.${m},day.eq.${day}),and(cal_type.eq.lunar,month.eq.${lm},day.eq.${ld}))`
      : `and(cal_type.eq.solar,month.eq.${m},day.eq.${day})`;
    const url = `${SUPABASE_URL}/rest/v1/anniversaries?select=id,user_id,label,recipient,notified_on,cal_type`
      + `&and=(${dateFilter},or(notified_on.is.null,notified_on.neq.${todayStr}))`;
    const r = await fetch(url, { headers: sb });
    if (!r.ok) return res.status(502).json({ error: "anniv query failed", detail: await r.text().catch(() => "") });
    annivs = await r.json();
  } catch (e) {
    return res.status(502).json({ error: "anniv query exception", detail: e.message });
  }

  let sent = 0, gone = 0;
  for (const a of annivs) {
    // 해당 회원의 구독 조회
    let subs = [];
    try {
      const sr = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq.${a.user_id}`, { headers: sb });
      if (sr.ok) subs = await sr.json();
    } catch (e) { /* skip */ }

    const who = a.recipient ? `${a.recipient}님 ` : "";
    const payload = JSON.stringify({
      title: "🌸 꽃안부 기념일 알림",
      body: `${a.label} 7일 전이에요. ${who}올해도 꽃으로 안부 전해보세요.`,
      url: "/",
      tag: "anniv-" + a.id,
    });

    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err) {
        // 만료/해지된 구독은 정리
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          gone++;
          fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: sb }).catch(() => {});
        } else {
          console.error("push 발송 실패", err && err.statusCode, err && err.body);
        }
      }
    }

    // 올해 발송 표시(중복 방지)
    fetch(`${SUPABASE_URL}/rest/v1/anniversaries?id=eq.${a.id}`, {
      method: "PATCH",
      headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ notified_on: todayStr }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, anniversaries: annivs.length, sent, removed: gone });
}
