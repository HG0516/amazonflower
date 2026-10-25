// lib/daily-numbers.mjs — 아침 브리핑 아래 붙는 '어제 숫자'(2026-10-25 형구: 일별로 보고, 같은 방 아침 브리핑에).
//
// 방문(Vercel Web Analytics API) · 주문과 어디서 왔는지 · 부고장/청첩장 만든 수 · 새 회원 · 적립금(켜졌을 때).
// 브리핑 본문을 절대 막지 않는다: 하나가 실패하면 그 줄만 빠지고, 다 실패하면 섹션째 빠진다(null).
// 방문 숫자는 VERCEL_ANALYTICS_TOKEN 이 있을 때만. 형구가 Vercel 설정에 직접 넣는다(채팅·코드에 남기지 않음).
// 지난주 같은 요일과 견준다(무료 요금제 보관 1달이라 1주 전은 늘 있다).

import { pointsMode } from "./points.mjs";

// 프로젝트·팀 번호는 비밀이 아니다(.vercel/project.json 과 같은 값). 바꿀 일이 생기면 env 로 덮는다.
const VA_PROJECT = "prj_EVk2t10j0JvRE5nOO05SpsFY8UFQ";
const VA_TEAM = "team_NVttvzI04dJLhskusaWaUB4y";
const SITE_HOSTS = ["floweranbu.co.kr", "www.floweranbu.co.kr"];
const DAY = 86400000;

/** KST 기준 offset 일의 [시작, 끝) — 밀리초. offset -1 = 어제. */
export function kstDay(offset, now = Date.now()) {
  const k = new Date(now + 9 * 3600000);
  const start = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600000 + offset * DAY;
  return [start, start + DAY];
}

function dayLabel(startMs) {
  const k = new Date(startMs + 9 * 3600000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${"일월화수목금토"[k.getUTCDay()]})`;
}

const won = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;

const PAGE_NAMES = {
  "/": "홈", "/index.html": "홈", "/catalog.html": "상품", "/corp.html": "기업 주문", "/my": "내 정보", "/my.html": "내 정보",
  "/bugo": "부고장 소개", "/bugo.html": "부고장 소개", "/wedding-card": "청첩장 소개", "/wedding-card.html": "청첩장 소개",
  "/bugo/make": "부고장 만들기", "/wedding-card/make": "청첩장 만들기", "/card-make.html": "부고장·청첩장 만들기",
  "/funeral/": "장례식장 목록", "/wedding.html": "결혼 꽃", "/quote.html": "견적서", "/pay.html": "맞춤 결제",
  "/ask": "생일 알려 주기", "/ask.html": "생일 알려 주기", "/privacy.html": "개인정보처리방침", "/terms.html": "이용약관",
};

export function pageLabel(path) {
  const p = String(path || "");
  if (PAGE_NAMES[p]) return PAGE_NAMES[p];
  if (p.startsWith("/funeral/")) {
    let name = p.slice(9).replace(/\.html$/, "");
    try { name = decodeURIComponent(name); } catch {}
    return name || "장례식장 목록";
  }
  return p || "(알 수 없음)";
}

export function refLabel(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!h) return "직접·카톡";
  if (h.includes("naver")) return "네이버";
  if (h.includes("google")) return "구글";
  if (h.includes("instagram")) return "인스타";
  if (h.includes("facebook")) return "페이스북";
  if (h.includes("daum") || h.includes("kakao")) return "카카오·다음";
  if (h.includes("bing")) return "빙";
  if (h.includes("daangn") || h.includes("karrot")) return "당근";
  return h;
}

const CHANNEL_NAMES = {
  insta: "인스타", domain: "꽃배달49000.kr·amazonflower", card: "부고장·청첩장", funeral: "장례식장 페이지",
  biz: "기업 링크", pwa: "앱 아이콘", flyer: "전단", shop: "매장 문자", naver: "네이버", kakao: "카카오",
};
export function channelLabel(src) {
  const s = String(src || "").trim();
  if (!s) return "직접";
  return CHANNEL_NAMES[s] || s;
}

/** [[이름, 수], ...] 를 같은 이름끼리 더해 큰 순으로. */
function tally(pairs, max = 5) {
  const m = new Map();
  for (const [k, v] of pairs) if (v > 0) m.set(k, (m.get(k) || 0) + v);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
}
const joinTally = (arr) => arr.map(([k, v]) => `${k} ${v}`).join(" · ");

async function getJson(fetchImpl, url, init, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctl.signal });
    const data = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, data };
  } catch {
    return { status: 0, ok: false, data: null };
  } finally {
    clearTimeout(t);
  }
}

/** Vercel 방문 숫자. 토큰이 없으면 { missing: true }, 인증 실패면 { auth: true }. */
export async function fetchVisits({ env = process.env, since, until, lwSince, lwUntil, fetchImpl = fetch, timeoutMs = 5000 }) {
  const token = String(env.VERCEL_ANALYTICS_TOKEN || "").trim();
  if (!token) return { missing: true };
  const base = new URLSearchParams({
    projectId: env.VERCEL_ANALYTICS_PROJECT || VA_PROJECT,
    teamId: env.VERCEL_ANALYTICS_TEAM || VA_TEAM,
  });
  const q = (path, extra) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return getJson(fetchImpl, `https://api.vercel.com/v1/query/web-analytics/${path}?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, timeoutMs);
  };
  const day = { since, until: until - 1 };
  const [total, lw, pages, refs, funeral] = await Promise.all([
    q("visits/count", day),
    q("visits/count", { since: lwSince, until: lwUntil - 1 }),
    q("visits/aggregate", { ...day, by: "requestPath", limit: 8 }),
    q("visits/aggregate", { ...day, by: "referrerHostname", limit: 12 }),
    q("visits/count", { ...day, filter: "startswith(requestPath,'/funeral/')" }),
  ]);
  if (total.status === 401 || total.status === 403) return { auth: true };
  if (!total.ok || !total.data || !total.data.data) return { failed: true };
  const n = (x) => Number(x) || 0;
  const rows = (r) => (r.ok && r.data && Array.isArray(r.data.data) ? r.data.data : []);
  return {
    visitors: n(total.data.data.visitors),
    pageviews: n(total.data.data.pageviews),
    lwVisitors: lw.ok && lw.data && lw.data.data ? n(lw.data.data.visitors) : null,
    funeral: funeral.ok && funeral.data && funeral.data.data ? { visitors: n(funeral.data.data.visitors), pageviews: n(funeral.data.data.pageviews) } : null,
    pages: rows(pages).filter((r) => r.requestPath && r.requestPath !== "Others").map((r) => [pageLabel(r.requestPath), n(r.pageviews)]),
    // 사이트 안에서 화면을 옮겨 다닌 것(우리 주소가 들어온 곳으로 찍힘)은 뺀다.
    refs: rows(refs).filter((r) => r.referrerHostname !== "Others" && !SITE_HOSTS.includes(String(r.referrerHostname || "").toLowerCase()))
      .map((r) => [refLabel(r.referrerHostname), n(r.visitors)]),
  };
}

/** 주문·부고장/청첩장·새 회원·적립금. 각 조회가 실패하면 그 칸만 null. */
export async function fetchSiteNumbers({ supabaseUrl, headers, since, until, lwSince, lwUntil, env = process.env, fetchImpl = fetch, timeoutMs = 5000 }) {
  const iso = (ms) => encodeURIComponent(new Date(ms).toISOString());
  const range = (a, b) => `created_at=gte.${iso(a)}&created_at=lt.${iso(b)}`;
  const get = (table, qs) => getJson(fetchImpl, `${supabaseUrl}/rest/v1/${table}?${qs}`, { headers }, timeoutMs)
    .then((r) => (r.ok && Array.isArray(r.data) ? r.data : null));
  const live = "status=neq.canceled&cancel_requested_at=is.null";
  const pts = pointsMode(env) !== "off";
  const [orders, lwOrders, cards, members, points] = await Promise.all([
    get("orders", `select=paid_amount,amount,utm_source,referral_source&${range(since, until)}&${live}&limit=500`),
    get("orders", `select=order_id&${range(lwSince, lwUntil)}&${live}&limit=500`),
    get("cards", `select=kind&${range(since, until)}&limit=1000`),
    get("profiles", `select=user_id&${range(since, until)}&limit=1000`),
    pts ? get("points_ledger", `select=amount,reason&${range(since, until)}&reason=in.(${encodeURIComponent("사용,추천")})&limit=1000`) : Promise.resolve(null),
  ]);
  return { orders, lwOrders: lwOrders ? lwOrders.length : null, cards, members: members ? members.length : null, points };
}

export function formatDailyNumbers({ since, visits, site }) {
  const L = [`📊 어제 숫자 — ${dayLabel(since)}`];
  if (visits) {
    if (visits.missing) L.push("👀 방문 숫자는 Vercel 토큰을 넣으면 나와요");
    else if (visits.auth) L.push("👀 방문 숫자를 못 읽었어요. Vercel 토큰이 만료됐는지 확인해 주세요");
    else if (visits.failed) L.push("👀 방문 숫자를 못 읽었어요");
    else {
      const lw = visits.lwVisitors == null ? "" : ` (지난주 ${visits.lwVisitors}명)`;
      L.push(`👀 방문 ${visits.visitors}명${lw} · 화면 ${visits.pageviews}번`);
      if (visits.funeral && visits.funeral.pageviews) L.push(`  장례식장 페이지 ${visits.funeral.visitors}명 · ${visits.funeral.pageviews}번`);
      const pages = tally(visits.pages);
      if (pages.length) L.push(`  많이 본 화면: ${joinTally(pages)}`);
      const refs = tally(visits.refs);
      if (refs.length) L.push(`  들어온 곳: ${joinTally(refs)}`);
    }
  }
  if (site && site.orders) {
    const sum = site.orders.reduce((s, o) => s + (Number(o.paid_amount || o.amount) || 0), 0);
    const lw = site.lwOrders == null ? "" : ` (지난주 ${site.lwOrders}건)`;
    L.push(`🛒 주문 ${site.orders.length}건 ${won(sum)}${lw}`);
    const ch = tally(site.orders.map((o) => [channelLabel(o.utm_source || o.referral_source), 1]), 6);
    if (ch.length) L.push(`  어디서: ${joinTally(ch)}`);
  }
  if (site && site.cards) {
    const f = site.cards.filter((c) => c.kind === "f").length;
    const w = site.cards.filter((c) => c.kind === "w").length;
    L.push(`📝 부고장 ${f} · 청첩장 ${w} 만듦`);
  }
  if (site && site.members != null) L.push(`🙋 새 회원 ${site.members}명`);
  if (site && site.points) {
    const used = site.points.filter((p) => p.reason === "사용");
    const refer = site.points.filter((p) => p.reason === "추천" && Number(p.amount) > 0);
    const usedSum = used.reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0);
    L.push(`💳 적립금 사용 ${used.length}건 ${won(usedSum)} · 추천 적립 ${refer.length}건`);
  }
  return L.length > 1 ? L.join("\n") : null;
}

/** 아침 브리핑이 부른다. 무엇이 실패해도 throw 하지 않고, 보여 줄 게 없으면 null. */
export async function dailyNumbersSection({ supabaseUrl, headers, env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
  try {
    const [since, until] = kstDay(-1, now);
    const [lwSince, lwUntil] = kstDay(-8, now);
    const [visits, site] = await Promise.all([
      fetchVisits({ env, since, until, lwSince, lwUntil, fetchImpl }).catch(() => ({ failed: true })),
      fetchSiteNumbers({ supabaseUrl, headers, since, until, lwSince, lwUntil, env, fetchImpl }).catch(() => null),
    ]);
    return formatDailyNumbers({ since, visits, site });
  } catch {
    return null;
  }
}
