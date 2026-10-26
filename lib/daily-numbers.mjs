// lib/daily-numbers.mjs — 아침 브리핑 아래 붙는 '어제 숫자'(2026-10-25 형구: 일별로 보고, 같은 방 아침 브리핑에, 간결하게).
//
// 한 줄에 한 가지: 방문→주문 · 주문 어디서 · 결제창→결제 · 들어온 곳 · 많이 본 곳 · 부고장/청첩장/새 회원 · 다가오는 날.
// 브리핑 본문을 절대 막지 않는다: 하나가 실패하면 그 줄만 빠지고, 다 실패하면 섹션째 빠진다(null).
// 방문 숫자는 VERCEL_ANALYTICS_TOKEN 이 있을 때만. 형구가 Vercel 설정에 직접 넣는다(채팅·코드에 남기지 않음).
// 시안: docs/시안/텔레그램보고-2026-10/index.html

import { pointsMode } from "./points.mjs";

// 프로젝트·팀 번호는 비밀이 아니다(.vercel/project.json 과 같은 값). 바꿀 일이 생기면 env 로 덮는다.
const VA_PROJECT = "prj_EVk2t10j0JvRE5nOO05SpsFY8UFQ";
const VA_TEAM = "team_NVttvzI04dJLhskusaWaUB4y";
const SITE_HOSTS = ["floweranbu.co.kr", "www.floweranbu.co.kr"];
const DAY = 86400000;

// 다가오는 대목. docs/research/마케팅-2026-10/기념일달력.html 에서 옮김(10/22 조사). 2027년 9월 뒤로는 다시 채울 것.
// date = 대목 시작, when = 날이 흐린 대목은 D-day 대신 이 글로, prep = 준비 시작(이날부터 '준비 중').
export const UPCOMING = [
  { label: "수능", date: "2026-11-19", prep: "2026-11-05" },
  { label: "인사철", when: "11월 말~", date: "2026-11-23", prep: "2026-11-09" },
  { label: "크리스마스", date: "2026-12-25", prep: "2026-12-07" },
  { label: "졸업식", when: "1~2월", date: "2027-01-04", prep: "2026-12-14" },
  { label: "설", date: "2027-02-06", prep: "2027-01-18" },
  { label: "입학·취임", when: "3월", date: "2027-03-02", prep: "2027-02-22" },
  { label: "어버이날", date: "2027-05-08", prep: "2027-03-29" },
  { label: "스승의날", date: "2027-05-15", prep: "2027-05-01" },
  { label: "추석", date: "2027-09-14", prep: "2027-08-23" },
];
const UPCOMING_DAYS = 45;

/** KST 기준 offset 일의 [시작, 끝) — 밀리초. offset -1 = 어제. */
export function kstDay(offset, now = Date.now()) {
  const k = new Date(now + 9 * 3600000);
  const start = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600000 + offset * DAY;
  return [start, start + DAY];
}
const kstMidnight = (ymd) => Date.parse(`${ymd}T00:00:00+09:00`);

function dayLabel(startMs) {
  const k = new Date(startMs + 9 * 3600000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${"일월화수목금토"[k.getUTCDay()]})`;
}

const won = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;

const PAGE_NAMES = {
  "/": "홈", "/index.html": "홈", "/catalog.html": "상품", "/corp.html": "기업 주문", "/my": "내 정보", "/my.html": "내 정보",
  "/bugo": "부고장 소개", "/bugo.html": "부고장 소개", "/wedding-card": "청첩장 소개", "/wedding-card.html": "청첩장 소개",
  "/bugo/make": "부고장 만들기", "/wedding-card/make": "청첩장 만들기", "/card-make.html": "부고장·청첩장 만들기",
  "/wedding.html": "결혼 꽃", "/quote.html": "견적서", "/pay.html": "맞춤 결제",
  "/ask": "생일 알려 주기", "/ask.html": "생일 알려 주기", "/privacy.html": "개인정보처리방침", "/terms.html": "이용약관",
  "/prices": "가격표", "/prices.html": "가격표", "/faq": "자주 묻는 것", "/faq.html": "자주 묻는 것",
};

export function pageLabel(path) {
  const p = String(path || "");
  if (PAGE_NAMES[p]) return PAGE_NAMES[p];
  if (p.startsWith("/ribbon/")) return "리본 문구";
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
  ribbon: "리본 문구 페이지", ai: "AI 비서",
};
export function channelLabel(src) {
  const s = String(src || "").trim();
  if (!s) return "직접";
  return CHANNEL_NAMES[s] || s;
}

/** [[이름, 수], ...] 를 같은 이름끼리 더해 큰 순으로. */
function tally(pairs, max = 3) {
  const m = new Map();
  for (const [k, v] of pairs) if (v > 0) m.set(k, (m.get(k) || 0) + v);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
}
const joinTally = (arr) => arr.map(([k, v]) => `${k} ${v}`).join(", ");

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
export async function fetchVisits({ env = process.env, since, until, lwSince, lwUntil, funeralTop = false, fetchImpl = fetch, timeoutMs = 5000 }) {
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
  const [total, lw, pages, refs, funeral, homes] = await Promise.all([
    q("visits/count", day),
    q("visits/count", { since: lwSince, until: lwUntil - 1 }),
    q("visits/aggregate", { ...day, by: "requestPath", limit: 10 }),
    q("visits/aggregate", { ...day, by: "referrerHostname", limit: 12 }),
    q("visits/count", { ...day, filter: "startswith(requestPath,'/funeral/')" }),
    // 주간 보고: 어느 장례식장 페이지가 많이 열렸는지(그 근처부터 영업하려고).
    funeralTop ? q("visits/aggregate", { ...day, by: "requestPath", filter: "startswith(requestPath,'/funeral/')", limit: 8 }) : Promise.resolve(null),
  ]);
  if (total.status === 401 || total.status === 403) return { auth: true };
  if (!total.ok || !total.data || !total.data.data) return { failed: true };
  const n = (x) => Number(x) || 0;
  const rows = (r) => (r.ok && r.data && Array.isArray(r.data.data) ? r.data.data : []);
  const funeralViews = funeral.ok && funeral.data && funeral.data.data ? n(funeral.data.data.pageviews) : 0;
  // 장례식장 페이지는 1,117곳이 한 곳에 몇 번씩이라, '많이 본 곳'에선 한 줄로 합친다.
  const pageRows = rows(pages)
    .filter((r) => r.requestPath && r.requestPath !== "Others" && !String(r.requestPath).startsWith("/funeral/"))
    .map((r) => [pageLabel(r.requestPath), n(r.pageviews)]);
  if (funeralViews) pageRows.push(["장례식장 페이지", funeralViews]);
  return {
    visitors: n(total.data.data.visitors),
    pageviews: n(total.data.data.pageviews),
    lwVisitors: lw.ok && lw.data && lw.data.data ? n(lw.data.data.visitors) : null,
    pages: pageRows,
    // 사이트 안에서 화면을 옮겨 다닌 것(우리 주소가 들어온 곳으로 찍힘)은 뺀다.
    refs: rows(refs)
      .filter((r) => r.referrerHostname !== "Others" && !SITE_HOSTS.includes(String(r.referrerHostname || "").toLowerCase()))
      .map((r) => [refLabel(r.referrerHostname), n(r.visitors)]),
    funeralPages: homes ? rows(homes)
      .filter((r) => r.requestPath && r.requestPath !== "Others" && r.requestPath !== "/funeral/")
      .map((r) => [pageLabel(r.requestPath), n(r.pageviews)]) : null,
  };
}

// 결제창(토스)까지 갔는지: 결제 기록 장부(payment_intents)의 상태. prepared·failed 로 남았으면 그만둔 것.
// 무통장입금은 결제창을 안 거쳐서 여기 안 잡힌다. 상품 이름만 읽는다(받는 분·연락처는 안 읽음).
const PAID_STATES = ["confirming", "paid", "finalized", "canceling", "canceled"];

/** 주문·결제창·부고장/청첩장·새 회원·적립금. 각 조회가 실패하면 그 칸만 null. */
export async function fetchSiteNumbers({ supabaseUrl, headers, since, until, env = process.env, fetchImpl = fetch, timeoutMs = 5000 }) {
  const iso = (ms) => encodeURIComponent(new Date(ms).toISOString());
  const range = `created_at=gte.${iso(since)}&created_at=lt.${iso(until)}`;
  const get = (table, qs) => getJson(fetchImpl, `${supabaseUrl}/rest/v1/${table}?${qs}`, { headers }, timeoutMs)
    .then((r) => (r.ok && Array.isArray(r.data) ? r.data : null));
  const pts = pointsMode(env) !== "off";
  const [orders, intents, cards, members, points] = await Promise.all([
    get("orders", `select=paid_amount,amount,utm_source,referral_source,product_label&${range}&status=neq.canceled&cancel_requested_at=is.null&limit=500`),
    get("payment_intents", `select=state,label:order_data->>productLabel&${range}&limit=500`),
    get("cards", `select=kind&${range}&limit=1000`),
    get("profiles", `select=user_id&${range}&limit=1000`),
    pts ? get("points_ledger", `select=amount,reason&${range}&reason=in.(${encodeURIComponent("사용,추천")})&limit=1000`) : Promise.resolve(null),
  ]);
  return { orders, intents, cards, members: members ? members.length : null, points };
}

/** '다가오는 날: 수능 D-24 · 인사철(11월 말~)' — 45일 안에 드는 것 두 개까지. 없으면 null. */
export function upcomingLine(now = Date.now(), list = UPCOMING) {
  const [today] = kstDay(0, now);
  const items = list
    .map((u) => ({ ...u, d: Math.round((kstMidnight(u.date) - today) / DAY), started: today >= kstMidnight(u.prep) }))
    .filter((u) => u.d >= 0 && u.d <= UPCOMING_DAYS)
    .slice(0, 2)
    .map((u) => `${u.label}${u.when ? `(${u.when})` : ` D-${u.d}`}${u.started ? " 준비 중" : ""}`);
  return items.length ? `다가오는 날: ${items.join(" · ")}` : null;
}

export function formatDailyNumbers({ since, visits, site, now = Date.now() }) {
  const L = [`📊 어제 ${dayLabel(since)}`];
  const ok = !!visits && !visits.missing && !visits.auth && !visits.failed;
  const orders = site && site.orders;
  const sum = orders ? orders.reduce((s, o) => s + (Number(o.paid_amount || o.amount) || 0), 0) : 0;
  const orderTxt = orders ? `주문 ${orders.length}건 ${won(sum)}` : "";

  if (ok) {
    const lw = visits.lwVisitors == null ? "" : ` (지난주 ${visits.lwVisitors})`;
    const pct = orders && visits.visitors ? ` (${Math.round((orders.length / visits.visitors) * 100)}%)` : "";
    L.push(`방문 ${visits.visitors}명${lw}${orderTxt ? ` → ${orderTxt}${pct}` : ""}`);
  } else if (orderTxt) {
    L.push(orderTxt);
  }
  if (orders && orders.length) {
    L.push(`주문 어디서: ${joinTally(tally(orders.map((o) => [channelLabel(o.utm_source || o.referral_source), 1]), 4))}`);
  }

  const intents = site && site.intents;
  if (intents && intents.length) {
    const paid = intents.filter((i) => PAID_STATES.includes(i.state)).length;
    const quit = tally(intents.filter((i) => !PAID_STATES.includes(i.state)).map((i) => [String(i.label || "상품").slice(0, 20), 1]));
    L.push(`결제창 ${intents.length}번 → 결제 ${paid}건${quit.length ? ` · 그만둔 것: ${joinTally(quit)}` : ""}`);
  }

  if (ok) {
    const refs = tally(visits.refs);
    if (refs.length) L.push(`들어온 곳: ${joinTally(refs)}`);
    const pages = tally(visits.pages);
    if (pages.length) L.push(`많이 본 곳: ${joinTally(pages)}`);
  }

  const small = [];
  if (site && site.cards) {
    small.push(`부고장 ${site.cards.filter((c) => c.kind === "f").length}`);
    small.push(`청첩장 ${site.cards.filter((c) => c.kind === "w").length}`);
  }
  if (site && site.members != null) small.push(`새 회원 ${site.members}`);
  if (small.length) L.push(small.join(" · "));

  if (site && site.points) {
    const used = site.points.filter((p) => p.reason === "사용");
    const refer = site.points.filter((p) => p.reason === "추천" && Number(p.amount) > 0);
    const usedSum = used.reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0);
    L.push(`적립금 사용 ${used.length}건 ${won(usedSum)} · 추천 적립 ${refer.length}건`);
  }

  const up = upcomingLine(now);
  if (up) L.push(up);

  if (visits && visits.missing) L.push("(방문 숫자는 Vercel 토큰을 넣으면 나와요)");
  else if (visits && visits.auth) L.push("(방문 숫자를 못 읽었어요. Vercel 토큰이 만료됐는지 확인해 주세요)");
  else if (visits && visits.failed) L.push("(방문 숫자를 못 읽었어요)");

  return L.length > 1 ? L.join("\n") : null;
}

// ── 월요일 주간 보고(10/27 형구: 11월 둘째 주부터). 시안 docs/시안/텔레그램보고-2026-10 ──
// 월요일 아침 브리핑 아래에 '📈 지난주'(월~일)를 붙인다. 그 전 주와 방문을 견주고, 많이 팔린 것·많이 본 장례식장을 더한다.
export const WEEKLY_FROM = "2026-11-09";
export function isWeeklyDay(now = Date.now(), from = WEEKLY_FROM) {
  const [today] = kstDay(0, now);
  return new Date(today + 9 * 3600000).getUTCDay() === 1 && today >= kstMidnight(from);
}

export function formatWeeklyNumbers({ since, until, visits, site }) {
  const L = [`📈 지난주 ${dayLabel(since)}~${dayLabel(until - DAY)}`];
  const ok = !!visits && !visits.missing && !visits.auth && !visits.failed;
  const orders = site && site.orders;
  const sum = orders ? orders.reduce((s, o) => s + (Number(o.paid_amount || o.amount) || 0), 0) : 0;
  const orderTxt = orders ? `주문 ${orders.length}건 ${won(sum)}` : "";
  if (ok) {
    const lw = visits.lwVisitors == null ? "" : ` (그 전 주 ${visits.lwVisitors})`;
    const pct = orders && visits.visitors ? ` (${Math.round((orders.length / visits.visitors) * 100)}%)` : "";
    L.push(`방문 ${visits.visitors}명${lw}${orderTxt ? ` → ${orderTxt}${pct}` : ""}`);
  } else if (orderTxt) {
    L.push(orderTxt);
  }
  if (orders && orders.length) {
    L.push(`주문 어디서: ${joinTally(tally(orders.map((o) => [channelLabel(o.utm_source || o.referral_source), 1]), 4))}`);
  }
  const intents = site && site.intents;
  if (intents && intents.length) {
    const paid = intents.filter((i) => PAID_STATES.includes(i.state)).length;
    L.push(`결제창 ${intents.length}번 → 결제 ${paid}건`);
  }
  if (orders && orders.length) {
    const sold = tally(orders.map((o) => [String(o.product_label || "상품").replace(/\s*\(.*\)$/, "").slice(0, 20), 1]));
    if (sold.length) L.push(`많이 팔린 것: ${joinTally(sold)}`);
  }
  if (ok && visits.funeralPages) {
    const top = tally(visits.funeralPages);
    if (top.length) L.push(`많이 본 장례식장: ${joinTally(top)}`);
  }
  const small = [];
  if (site && site.cards) {
    const card = orders ? orders.filter((o) => (o.utm_source || o.referral_source) === "card").length : null;
    small.push(`부고장 ${site.cards.filter((c) => c.kind === "f").length} · 청첩장 ${site.cards.filter((c) => c.kind === "w").length}${card != null ? ` → 화환 ${card}건` : ""}`);
  }
  if (site && site.members != null) small.push(`새 회원 ${site.members}`);
  if (small.length) L.push(small.join(" · "));
  return L.length > 1 ? L.join("\n") : null;
}

/** 월요일 아침 브리핑이 부른다. 월요일이 아니거나 시작일 전이면 null. 무엇이 실패해도 throw 하지 않는다. */
export async function weeklyNumbersSection({ supabaseUrl, headers, env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
  try {
    if (!isWeeklyDay(now)) return null;
    const since = kstDay(-7, now)[0], until = kstDay(0, now)[0], lwSince = kstDay(-14, now)[0];
    const [visits, site] = await Promise.all([
      fetchVisits({ env, since, until, lwSince, lwUntil: since, funeralTop: true, fetchImpl }).catch(() => ({ failed: true })),
      fetchSiteNumbers({ supabaseUrl, headers, since, until, env, fetchImpl }).catch(() => null),
    ]);
    return formatWeeklyNumbers({ since, until, visits, site });
  } catch {
    return null;
  }
}

/** 아침 브리핑이 부른다. 무엇이 실패해도 throw 하지 않고, 보여 줄 게 없으면 null. */
export async function dailyNumbersSection({ supabaseUrl, headers, env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
  try {
    const [since, until] = kstDay(-1, now);
    const [lwSince, lwUntil] = kstDay(-8, now);
    const [visits, site] = await Promise.all([
      fetchVisits({ env, since, until, lwSince, lwUntil, fetchImpl }).catch(() => ({ failed: true })),
      fetchSiteNumbers({ supabaseUrl, headers, since, until, env, fetchImpl }).catch(() => null),
    ]);
    return formatDailyNumbers({ since, visits, site, now });
  } catch {
    return null;
  }
}
