// api/check-anniversaries.js
// 기념일 웹푸시 — 7일 뒤·내일이 기념일인 회원에게 푸시 발송(하루 전은 10/20 챙길 사람 수첩에서 더함).
// Supabase pg_cron 이 하루 1회(예: 매일 09:00 KST) Authorization: Bearer <CRON_SECRET> 로 호출한다.
// (check-deadlines.js 와 동일한 보호·호출 방식)

import webpush from "web-push";
import crypto from "node:crypto";
import KoreanLunarCalendar from "korean-lunar-calendar";

export const config = { runtime: "nodejs" };

// 기념일 라벨이 자유 입력이라 추도일이 섞여 들어온다. 컬럼을 새로 만들지 않고 라벨로 판별하는 이유:
// (1) 마이그레이션 없이 이미 저장된 행까지 즉시 보호된다 (2) 지금 나가고 있는 알림이 문제이므로 소급이 핵심.
// 애매하면 '아니다' 쪽으로 판정하지 않는다 — 놓쳐서 결례하느니 담백한 문구가 낫다.
const MEMORIAL_RE = /(기일|忌日|제사|제삿|차례|추도|추모|소상|대상|탈상|49재|사십구재|기제)/;
function isMemorial(label) {
  return MEMORIAL_RE.test(String(label || ""));
}

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

  // 한국시간 기준 '오늘'(중복발송 방지 키)
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const todayStr = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, "0")}-${String(kstNow.getUTCDate()).padStart(2, "0")}`;
  // N일 뒤의 양력 월/일과, 그날을 음력으로 바꾼 월/일(음력 기념일도 올해 해당 양력일에 알림)
  const target = (n) => {
    const t = new Date(kstNow.getTime() + n * 86400000);
    const o = { m: t.getUTCMonth() + 1, day: t.getUTCDate(), lm: null, ld: null };
    try {
      const cal = new KoreanLunarCalendar();
      cal.setSolarDate(t.getUTCFullYear(), o.m, o.day);
      const lu = cal.getLunarCalendar();
      if (lu && lu.month && lu.day) { o.lm = lu.month; o.ld = lu.day; }
    } catch (e) { /* 변환 실패 → 양력만 매칭(안전) */ }
    return o;
  };
  const t7 = target(7), t1 = target(1);
  const { m, day, lm, ld } = t7;

  // 7일 전과 하루 전(10/20 챙길 사람 수첩). 오늘 이미 보낸 건 빼고, 양력·음력 둘 다 매칭.
  let annivs = [];
  try {
    for (const [n, t] of [[7, t7], [1, t1]]) {
      const dateFilter = (t.lm && t.ld)
        ? `or(and(cal_type.eq.solar,month.eq.${t.m},day.eq.${t.day}),and(cal_type.eq.lunar,month.eq.${t.lm},day.eq.${t.ld}))`
        : `and(cal_type.eq.solar,month.eq.${t.m},day.eq.${t.day})`;
      const url = `${SUPABASE_URL}/rest/v1/anniversaries?select=id,user_id,label,recipient,notified_on,cal_type`
        + `&and=(${dateFilter},or(notified_on.is.null,notified_on.neq.${todayStr}))`;
      const r = await fetch(url, { headers: sb });
      if (!r.ok) return res.status(502).json({ error: "anniv query failed", detail: await r.text().catch(() => "") });
      for (const a of await r.json()) annivs.push({ ...a, n });
    }
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

    // 수첩은 recipient=누구, label=무슨 날로 따로 적는다. 예전 행은 label 에 '어머니 생신'이 다 들어 있다.
    const name = a.recipient && !String(a.label || "").includes(a.recipient) ? `${a.recipient} ${a.label}` : a.label;
    const when = a.n === 1 ? "내일이에요" : "7일 전이에요";
    const memorial = isMemorial(a.label);
    const payload = JSON.stringify({
      // 기일·제사에는 판촉 문구를 붙이지 않는다. 라벨이 자유 입력이라 '아버지 기일'을 적어둔
      // 사람에게 '올해도 꽃으로 안부 전해보세요'가 그대로 나가면 되돌릴 수 없는 결례가 된다.
      title: memorial ? "🌿 꽃안부 알림" : "🌸 꽃안부 기념일 알림",
      body: memorial
        ? `${name} ${a.n === 1 ? "내일입니다." : "7일 전입니다."}`
        : `${name} ${when}. ${a.n === 1 ? "오늘 주문하면 내일 도착해요." : "올해도 꽃으로 안부 전해보세요."}`,
      url: "/my?tab=people",
      tag: "anniv-" + a.id + "-" + a.n,
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

  // 거래처 직원 생일 D-7 → 사장님 텔레그램(10/20, supabase-corp-birthdays.sql). 표가 없거나 실패해도 위 알림 결과는 그대로.
  let corpBd = 0;
  try {
    const dateFilter = (lm && ld)
      ? `or(and(lunar.is.false,month.eq.${m},day.eq.${day}),and(lunar.is.true,month.eq.${lm},day.eq.${ld}))`
      : `and(lunar.is.false,month.eq.${m},day.eq.${day})`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/corp_birthdays?select=id,corp_regno,name,lunar,addr,phone,budget,msg`
      + `&and=(${dateFilter},or(notified_on.is.null,notified_on.neq.${todayStr}))&limit=200`, { headers: sb });
    const rows = r.ok ? await r.json() : [];
    const tg = process.env.TELEGRAM_BOT_TOKEN, tgc = process.env.TELEGRAM_CHAT_ID;
    if (rows.length && tg && tgc) {
      const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
      const lines = rows.map((x) => `· ${x.name}${x.lunar ? "(음력)" : ""} ${x.budget ? x.budget.toLocaleString("ko-KR") + "원 " : ""}— ${x.addr || "주소 없음"}${x.phone ? " " + x.phone : ""}${x.msg ? ` / "${x.msg}"` : ""} [${x.corp_regno}]`);
      await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgc, text: `${tag}🎂 7일 뒤 거래처 직원 생일 ${rows.length}명 (${m}/${day})\n${lines.join("\n")}`.slice(0, 3900), disable_web_page_preview: true }),
      });
      corpBd = rows.length;
      const ids = rows.map((x) => x.id).join(",");
      await fetch(`${SUPABASE_URL}/rest/v1/corp_birthdays?id=in.(${ids})`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ notified_on: todayStr }),
      }).catch(() => {});
    }
  } catch (e) { console.error("corp birthdays", e && e.message); }

  return res.status(200).json({ ok: true, anniversaries: annivs.length, sent, removed: gone, corpBirthdays: corpBd });
}
