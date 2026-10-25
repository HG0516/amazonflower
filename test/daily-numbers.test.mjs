// 아침 브리핑 '어제 숫자'(lib/daily-numbers.mjs) 시험.
// ① 날짜 경계가 KST 하루인지 ② 방문·주문·결제창·부고장·회원 숫자가 맞게 묶이는지 ③ 무엇이 실패해도 throw 하지 않는지
// ④ 다가오는 날이 맞게 뜨는지 ⑤ 장례식장 페이지에서 온 주문이 채널로 잡히는지를 본다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  channelLabel, dailyNumbersSection, fetchSiteNumbers, fetchVisits, formatDailyNumbers, kstDay, pageLabel, refLabel,
  upcomingLine, UPCOMING,
} from "../lib/daily-numbers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-26T08:00:00+09:00");

test("어제 = KST 하루, 지난주 같은 요일 = 8일 전", () => {
  const [s, e] = kstDay(-1, NOW);
  assert.equal(new Date(s).toISOString(), "2026-10-24T15:00:00.000Z");
  assert.equal(new Date(e).toISOString(), "2026-10-25T15:00:00.000Z");
  const [lw] = kstDay(-8, NOW);
  assert.equal(new Date(lw).toISOString(), "2026-10-17T15:00:00.000Z");
  const [s2] = kstDay(-1, Date.parse("2026-10-26T00:30:00+09:00"));
  assert.equal(new Date(s2).toISOString(), "2026-10-24T15:00:00.000Z", "자정 직후에도 어제는 바로 전날");
});

test("화면·들어온 곳·채널 이름", () => {
  assert.equal(pageLabel("/"), "홈");
  assert.equal(pageLabel("/catalog.html"), "상품");
  assert.equal(pageLabel("/funeral/Sh%EC%88%98%ED%98%91%EC%9E%A5%EB%A1%80%EC%8B%9D%EC%9E%A5"), "Sh수협장례식장");
  assert.equal(refLabel("m.search.naver.com"), "네이버");
  assert.equal(refLabel("www.google.co.kr"), "구글");
  assert.equal(refLabel(""), "직접·카톡");
  assert.equal(channelLabel("funeral"), "장례식장 페이지");
  assert.equal(channelLabel(""), "직접");
  assert.equal(channelLabel("새채널"), "새채널");
});

test("다가오는 날: 45일 안 두 개까지, 흐린 날은 D-day 대신 글, 준비 시작일부터 '준비 중'", () => {
  assert.equal(upcomingLine(NOW), "다가오는 날: 수능 D-24 · 인사철(11월 말~)");
  assert.equal(upcomingLine(Date.parse("2026-11-10T08:00:00+09:00")), "다가오는 날: 수능 D-9 준비 중 · 인사철(11월 말~) 준비 중");
  assert.equal(upcomingLine(Date.parse("2026-11-19T08:00:00+09:00")), "다가오는 날: 수능 D-0 준비 중 · 인사철(11월 말~) 준비 중");
  assert.equal(upcomingLine(Date.parse("2027-10-01T08:00:00+09:00")), null, "목록이 끝나면 줄째 빠진다");
  for (const u of UPCOMING) {
    assert.ok(Date.parse(u.prep) <= Date.parse(u.date), `${u.label} 준비일이 대목보다 늦음`);
  }
});

function vercelMock(calls, { status = 200 } = {}) {
  return async (input, init = {}) => {
    const u = new URL(String(input));
    calls.push(u);
    assert.equal(init.headers.Authorization, "Bearer tok-test");
    if (status !== 200) return Response.json({ error: "x" }, { status });
    const by = u.searchParams.get("by");
    const lastWeek = Number(u.searchParams.get("since")) < Date.parse("2026-10-20T00:00:00Z");
    if (u.pathname.endsWith("/visits/count")) {
      if (u.searchParams.get("filter")) return Response.json({ data: { pageviews: 9, visitors: 4 } });
      return Response.json({ data: lastWeek ? { pageviews: 30, visitors: 20 } : { pageviews: 87, visitors: 32 } });
    }
    if (by === "requestPath") {
      return Response.json({ data: [
        { requestPath: "/", pageviews: 40, visitors: 25 },
        { requestPath: "/catalog.html", pageviews: 12, visitors: 8 },
        { requestPath: "/funeral/Sh수협장례식장", pageviews: 3, visitors: 2 },
        { requestPath: "/bugo", pageviews: 2, visitors: 2 },
        { requestPath: "Others", pageviews: 20, visitors: 10 },
      ] });
    }
    if (by === "referrerHostname") {
      return Response.json({ data: [
        { referrerHostname: "floweranbu.co.kr", pageviews: 50, visitors: 20 },
        { referrerHostname: "", pageviews: 20, visitors: 15 },
        { referrerHostname: "m.search.naver.com", pageviews: 8, visitors: 6 },
        { referrerHostname: "search.naver.com", pageviews: 5, visitors: 4 },
        { referrerHostname: "www.google.com", pageviews: 3, visitors: 3 },
        { referrerHostname: "instagram.com", pageviews: 1, visitors: 1 },
      ] });
    }
    throw new Error(`unexpected ${u}`);
  };
}

function supabaseMock(seen, { pointsRows = [] } = {}) {
  return async (input, init = {}) => {
    const u = new URL(String(input));
    seen.push(u);
    assert.equal(init.headers.apikey, "svc");
    const table = u.pathname.split("/").pop();
    if (table === "orders") {
      return Response.json([
        { paid_amount: 49000, utm_source: "funeral" },
        { paid_amount: 49000, utm_source: null, referral_source: null },
      ]);
    }
    if (table === "payment_intents") {
      return Response.json([
        { state: "finalized", label: "근조화환 기본" }, { state: "finalized", label: "축하화환 기본" },
        { state: "prepared", label: "근조화환 기본" }, { state: "failed", label: "근조화환 기본" }, { state: "prepared", label: "개업화분" },
        { state: "canceled", label: "축하화환 기본" }, // 결제했다가 환불한 것 = 결제한 것
      ]);
    }
    if (table === "cards") return Response.json([{ kind: "f" }, { kind: "f" }, { kind: "f" }, { kind: "w" }]);
    if (table === "profiles") return Response.json([{ user_id: "u1" }]);
    if (table === "points_ledger") return Response.json(pointsRows);
    throw new Error(`unexpected ${u}`);
  };
}

test("시안 B 모양 그대로: 한 줄에 한 가지, 3개씩만", async () => {
  const calls = [], seen = [];
  const [since, until] = kstDay(-1, NOW);
  const [lwSince, lwUntil] = kstDay(-8, NOW);
  const visits = await fetchVisits({ env: { VERCEL_ANALYTICS_TOKEN: "tok-test" }, since, until, lwSince, lwUntil, fetchImpl: vercelMock(calls) });
  assert.equal(calls.length, 5);
  for (const u of calls) assert.ok(u.searchParams.get("projectId") && u.searchParams.get("teamId"));
  assert.equal(Number(calls[0].searchParams.get("until")), until - 1, "until 은 포함이라 1ms 앞까지");
  assert.ok(!visits.pages.some(([k]) => k === "Sh수협장례식장"), "장례식장 하나하나는 '장례식장 페이지' 한 줄로 합친다");
  const site = await fetchSiteNumbers({ supabaseUrl: "https://sb.test", headers: { apikey: "svc" }, since, until, env: {}, fetchImpl: supabaseMock(seen) });
  assert.equal(seen.length, 4, "적립금이 꺼져 있으면 points_ledger 를 안 읽는다");
  const text = formatDailyNumbers({ since, visits, site, now: NOW });
  assert.equal(text, [
    "📊 어제 10/25(일)",
    "방문 32명 (지난주 20) → 주문 2건 98,000원 (6%)",
    "주문 어디서: 장례식장 페이지 1, 직접 1",
    "결제창 6번 → 결제 3건 · 그만둔 것: 근조화환 기본 2, 개업화분 1",
    "들어온 곳: 직접·카톡 15, 네이버 10, 구글 3",
    "많이 본 곳: 홈 40, 상품 12, 장례식장 페이지 9",
    "부고장 3 · 청첩장 1 · 새 회원 1",
    "다가오는 날: 수능 D-24 · 인사철(11월 말~)",
  ].join("\n"));
});

test("조회 조건: 취소·환불 중 주문은 빼고, 결제창은 상품 이름만 읽는다", async () => {
  const seen = [];
  const [since, until] = kstDay(-1, NOW);
  await fetchSiteNumbers({ supabaseUrl: "https://sb.test", headers: { apikey: "svc" }, since, until, env: {}, fetchImpl: supabaseMock(seen) });
  const byTable = Object.fromEntries(seen.map((u) => [u.pathname.split("/").pop(), u]));
  assert.equal(byTable.orders.searchParams.get("cancel_requested_at"), "is.null");
  assert.equal(byTable.orders.searchParams.get("status"), "neq.canceled");
  assert.deepEqual(byTable.orders.searchParams.getAll("created_at"), [`gte.${new Date(since).toISOString()}`, `lt.${new Date(until).toISOString()}`]);
  assert.equal(byTable.payment_intents.searchParams.get("select"), "state,label:order_data->>productLabel");
  for (const u of seen) assert.doesNotMatch(u.searchParams.get("select"), /phone|name|address|recipient|sender/i, "개인 정보 칸은 안 읽는다");
});

test("적립금을 켜면 한 줄 더", async () => {
  const seen = [];
  const [since, until] = kstDay(-1, NOW);
  const site = await fetchSiteNumbers({
    supabaseUrl: "https://sb.test", headers: { apikey: "svc" }, since, until, env: { POINTS_MODE: "on" },
    fetchImpl: supabaseMock(seen, { pointsRows: [{ reason: "사용", amount: -3000 }, { reason: "사용", amount: -1000 }, { reason: "추천", amount: 3000 }, { reason: "추천", amount: 1000 }] }),
  });
  assert.equal(seen.length, 5);
  assert.match(formatDailyNumbers({ since, visits: null, site, now: NOW }), /\n적립금 사용 2건 4,000원 · 추천 적립 2건\n/);
});

test("방문 숫자를 못 읽으면 주문 줄만 남기고 끝에 괄호로 알린다", async () => {
  const [since, until] = kstDay(-1, NOW);
  const site = { orders: [{ paid_amount: 49000 }], intents: [], cards: [], members: 0 };
  const missing = await fetchVisits({ env: {}, since, until, lwSince: 0, lwUntil: 1, fetchImpl: () => { throw new Error("부르면 안 됨"); } });
  const t1 = formatDailyNumbers({ since, visits: missing, site, now: NOW });
  assert.match(t1, /^📊 어제 10\/25\(일\)\n주문 1건 49,000원\n/);
  assert.match(t1, /\(방문 숫자는 Vercel 토큰을 넣으면 나와요\)$/);
  const auth = await fetchVisits({ env: { VERCEL_ANALYTICS_TOKEN: "tok-test" }, since, until, lwSince: 0, lwUntil: 1, fetchImpl: vercelMock([], { status: 403 }) });
  assert.deepEqual(auth, { auth: true });
  assert.match(formatDailyNumbers({ since, visits: auth, site, now: NOW }), /만료됐는지/);
  const hang = (input, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const t0 = Date.now();
  const failed = await fetchVisits({ env: { VERCEL_ANALYTICS_TOKEN: "tok-test" }, since, until, lwSince: 0, lwUntil: 1, fetchImpl: hang, timeoutMs: 50 });
  assert.ok(Date.now() - t0 < 2000, "멈추면 끊는다");
  assert.deepEqual(failed, { failed: true });
});

test("전부 실패해도 throw 하지 않는다", async () => {
  const boom = async () => { throw new Error("network down"); };
  const out = await dailyNumbersSection({ supabaseUrl: "https://sb.test", headers: {}, env: {}, now: NOW, fetchImpl: boom });
  assert.equal(out, "📊 어제 10/25(일)\n다가오는 날: 수능 D-24 · 인사철(11월 말~)\n(방문 숫자는 Vercel 토큰을 넣으면 나와요)");
  const out2 = await dailyNumbersSection({ supabaseUrl: "https://sb.test", headers: {}, env: { VERCEL_ANALYTICS_TOKEN: "t" }, now: NOW, fetchImpl: boom });
  assert.match(out2, /\(방문 숫자를 못 읽었어요\)$/);
  assert.doesNotMatch(out2, /주문|회원|결제창/);
});

test("장례식장 페이지의 주문 버튼은 from=funeral-page, 홈 주문서는 그걸 '장례식장 페이지' 채널로 남긴다", () => {
  const gen = fs.readFileSync(path.join(ROOT, "scripts/build-funeral-pages.mjs"), "utf8");
  assert.match(gen, /from: "funeral-page"/);
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(index, /P\("from"\)==="funeral-page"\) window\.AF_CARD_UTM=\{ s:"funeral", m:"page"/);
});
