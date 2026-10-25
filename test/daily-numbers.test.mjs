// 아침 브리핑 '어제 숫자'(lib/daily-numbers.mjs) 시험.
// ① 날짜 경계가 KST 하루인지 ② 방문·주문·부고장·회원 숫자가 맞게 묶이는지 ③ 무엇이 실패해도 throw 하지 않는지
// ④ 장례식장 페이지에서 온 주문이 채널로 잡히는지를 본다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  channelLabel, dailyNumbersSection, fetchSiteNumbers, fetchVisits, formatDailyNumbers, kstDay, pageLabel, refLabel,
} from "../lib/daily-numbers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-25T08:00:00+09:00");

test("어제 = KST 하루, 지난주 같은 요일 = 8일 전", () => {
  const [s, e] = kstDay(-1, NOW);
  assert.equal(new Date(s).toISOString(), "2026-10-23T15:00:00.000Z");
  assert.equal(new Date(e).toISOString(), "2026-10-24T15:00:00.000Z");
  const [lw] = kstDay(-8, NOW);
  assert.equal(new Date(lw).toISOString(), "2026-10-16T15:00:00.000Z");
  // 자정 직후(00:30 KST)에도 어제는 바로 전날
  const [s2] = kstDay(-1, Date.parse("2026-10-25T00:30:00+09:00"));
  assert.equal(new Date(s2).toISOString(), "2026-10-23T15:00:00.000Z");
});

test("화면·들어온 곳·채널 이름", () => {
  assert.equal(pageLabel("/"), "홈");
  assert.equal(pageLabel("/catalog.html"), "상품");
  assert.equal(pageLabel("/funeral/Sh%EC%88%98%ED%98%91%EC%9E%A5%EB%A1%80%EC%8B%9D%EC%9E%A5"), "Sh수협장례식장");
  assert.equal(pageLabel("/funeral/Sh수협장례식장"), "Sh수협장례식장");
  assert.equal(refLabel("m.search.naver.com"), "네이버");
  assert.equal(refLabel("www.google.co.kr"), "구글");
  assert.equal(refLabel(""), "직접·카톡");
  assert.equal(channelLabel("funeral"), "장례식장 페이지");
  assert.equal(channelLabel(""), "직접");
  assert.equal(channelLabel("새채널"), "새채널");
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
      return Response.json({ data: lastWeek ? { pageviews: 30, visitors: 12 } : { pageviews: 87, visitors: 32 } });
    }
    if (by === "requestPath") {
      return Response.json({ data: [
        { requestPath: "/", pageviews: 40, visitors: 25 },
        { requestPath: "/catalog.html", pageviews: 12, visitors: 8 },
        { requestPath: "/funeral/Sh수협장례식장", pageviews: 3, visitors: 2 },
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
      ] });
    }
    throw new Error(`unexpected ${u}`);
  };
}

test("방문: 어제·지난주·장례식장 페이지·많이 본 화면·들어온 곳", async () => {
  const calls = [];
  const [since, until] = kstDay(-1, NOW);
  const [lwSince, lwUntil] = kstDay(-8, NOW);
  const v = await fetchVisits({ env: { VERCEL_ANALYTICS_TOKEN: "tok-test" }, since, until, lwSince, lwUntil, fetchImpl: vercelMock(calls) });
  assert.equal(calls.length, 5);
  for (const u of calls) {
    assert.equal(u.hostname, "api.vercel.com");
    assert.ok(u.searchParams.get("projectId") && u.searchParams.get("teamId"));
  }
  assert.equal(Number(calls[0].searchParams.get("until")), until - 1, "until 은 포함이라 1ms 앞까지");
  assert.equal(v.visitors, 32);
  assert.equal(v.lwVisitors, 12);
  assert.deepEqual(v.funeral, { visitors: 4, pageviews: 9 });
  const text = formatDailyNumbers({ since, visits: v, site: null });
  assert.match(text, /📊 어제 숫자 — 10\/24\(토\)/);
  assert.match(text, /방문 32명 \(지난주 12명\) · 화면 87번/);
  assert.match(text, /장례식장 페이지 4명 · 9번/);
  assert.match(text, /많이 본 화면: 홈 40 · 상품 12 · Sh수협장례식장 3/);
  assert.match(text, /들어온 곳: 직접·카톡 15 · 네이버 10 · 구글 3/, "네이버 두 주소는 합치고 우리 사이트 안 이동은 뺀다");
  assert.doesNotMatch(text, /Others|floweranbu/);
});

test("방문: 토큰 없으면 안내 한 줄, 인증 실패면 확인 한 줄, 멈추면 끊고 실패 한 줄", async () => {
  const [since, until] = kstDay(-1, NOW);
  const missing = await fetchVisits({ env: {}, since, until, lwSince: 0, lwUntil: 1, fetchImpl: () => { throw new Error("부르면 안 됨"); } });
  assert.deepEqual(missing, { missing: true });
  assert.match(formatDailyNumbers({ since, visits: missing }), /토큰을 넣으면/);
  const auth = await fetchVisits({ env: { VERCEL_ANALYTICS_TOKEN: "tok-test" }, since, until, lwSince: 0, lwUntil: 1, fetchImpl: vercelMock([], { status: 403 }) });
  assert.deepEqual(auth, { auth: true });
  assert.match(formatDailyNumbers({ since, visits: auth }), /만료됐는지/);
  const hang = (input, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const t0 = Date.now();
  const failed = await fetchVisits({ env: { VERCEL_ANALYTICS_TOKEN: "tok-test" }, since, until, lwSince: 0, lwUntil: 1, fetchImpl: hang, timeoutMs: 50 });
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(failed, { failed: true });
});

function supabaseMock(seen, { pointsRows = [] } = {}) {
  return async (input, init = {}) => {
    const u = new URL(String(input));
    seen.push(u);
    assert.equal(init.headers.apikey, "svc");
    const table = u.pathname.split("/").pop();
    if (table === "orders" && u.searchParams.get("select").includes("utm_source")) {
      return Response.json([
        { paid_amount: 49000, utm_source: "funeral" },
        { paid_amount: 49000, utm_source: null, referral_source: null },
        { amount: 79000, utm_source: "card" },
      ]);
    }
    if (table === "orders") return Response.json([{ order_id: "a" }]);
    if (table === "cards") return Response.json([{ kind: "f" }, { kind: "f" }, { kind: "w" }]);
    if (table === "profiles") return Response.json([{ user_id: "u1" }]);
    if (table === "points_ledger") return Response.json(pointsRows);
    throw new Error(`unexpected ${u}`);
  };
}

test("주문·부고장/청첩장·새 회원: 취소·환불 중은 빼고, 적립금은 꺼져 있으면 안 묻는다", async () => {
  const seen = [];
  const [since, until] = kstDay(-1, NOW);
  const [lwSince, lwUntil] = kstDay(-8, NOW);
  const site = await fetchSiteNumbers({ supabaseUrl: "https://sb.test", headers: { apikey: "svc" }, since, until, lwSince, lwUntil, env: {}, fetchImpl: supabaseMock(seen) });
  assert.equal(seen.length, 4, "적립금이 꺼져 있으면 points_ledger 를 안 읽는다");
  for (const u of seen.filter((x) => x.pathname.endsWith("/orders"))) {
    assert.equal(u.searchParams.get("cancel_requested_at"), "is.null");
    assert.equal(u.searchParams.get("status"), "neq.canceled");
  }
  assert.deepEqual(seen[0].searchParams.getAll("created_at"), [`gte.${new Date(since).toISOString()}`, `lt.${new Date(until).toISOString()}`]);
  const text = formatDailyNumbers({ since, visits: null, site });
  assert.match(text, /🛒 주문 3건 177,000원 \(지난주 1건\)/);
  assert.match(text, /어디서: (장례식장 페이지 1|직접 1|부고장·청첩장 1)( · (장례식장 페이지 1|직접 1|부고장·청첩장 1)){2}/);
  assert.match(text, /📝 부고장 2 · 청첩장 1 만듦/);
  assert.match(text, /🙋 새 회원 1명/);
  assert.doesNotMatch(text, /적립금/);

  const seen2 = [];
  const on = await fetchSiteNumbers({
    supabaseUrl: "https://sb.test", headers: { apikey: "svc" }, since, until, lwSince, lwUntil, env: { POINTS_MODE: "on" },
    fetchImpl: supabaseMock(seen2, { pointsRows: [{ reason: "사용", amount: -3000 }, { reason: "사용", amount: -1000 }, { reason: "추천", amount: 3000 }, { reason: "추천", amount: 1000 }] }),
  });
  assert.equal(seen2.length, 5);
  assert.match(formatDailyNumbers({ since, visits: null, site: on }), /💳 적립금 사용 2건 4,000원 · 추천 적립 2건/);
});

test("전부 실패해도 throw 하지 않는다", async () => {
  const boom = async () => { throw new Error("network down"); };
  const out = await dailyNumbersSection({ supabaseUrl: "https://sb.test", headers: {}, env: {}, now: NOW, fetchImpl: boom });
  assert.equal(out, "📊 어제 숫자 — 10/24(토)\n👀 방문 숫자는 Vercel 토큰을 넣으면 나와요");
  const out2 = await dailyNumbersSection({ supabaseUrl: "https://sb.test", headers: {}, env: { VERCEL_ANALYTICS_TOKEN: "t" }, now: NOW, fetchImpl: boom });
  assert.match(out2, /방문 숫자를 못 읽었어요/);
  assert.doesNotMatch(out2, /주문|회원/);
});

test("장례식장 페이지의 주문 버튼은 from=funeral-page, 홈 주문서는 그걸 '장례식장 페이지' 채널로 남긴다", () => {
  const gen = fs.readFileSync(path.join(ROOT, "scripts/build-funeral-pages.mjs"), "utf8");
  assert.match(gen, /from: "funeral-page"/);
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(index, /P\("from"\)==="funeral-page"\) window\.AF_CARD_UTM=\{ s:"funeral", m:"page"/);
});
