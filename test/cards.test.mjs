// 무료 부고장·청첩장 정식판(lib/cards.mjs · api/order-meta.js) — 가짜 Supabase(PostgREST)로 확인.
//  - 만들기: 수정 키는 해시만 저장, 표 없으면 fallback(긴 링크), 한 곳에서 한 시간 12개까지
//  - 조문 글: 링크 금지 · 10분 5개 · 닫힌 안내/글 안 받는 안내는 거절
//  - 고치기·숨기기·닫기는 수정 키가 맞아야, 종류(부고↔청첩장)는 못 바꿈
//  - 기간 지나면 내용·글을 지운다(열람 때 + 크론)
//  - 카톡 미리보기 봇에겐 넘기는 코드를 빼고, 사람은 card.html?c= 로 보낸다
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import {
  sanitizeCard, cardExpiry, renderOgHtml, isPreviewBot, editHash,
  handleCardPost, handleCardGet, cleanupExpiredCards,
} from "../lib/cards.mjs";
import orderMeta from "../api/order-meta.js";

const ENV = { SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-test-key", CRON_SECRET: "cron" };
const FUTURE = new Date(Date.now() + 5 * 86400000).toISOString();
const PAST = new Date(Date.now() - 3600000).toISOString();
const FUN = { k: "f", name: "김영수", venue: "시화병원 장례식장", room: "3호실", outDate: "2026-10-08", out: "08:00", m: [{ r: "장남", n: "김민준" }] };

// 아주 작은 가짜 PostgREST: [메서드, 경로 정규식, (url, opts, body) => {status, body|text}]
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url: u, body });
    for (const [m, re, h] of routes) {
      if (m === method && re.test(u)) {
        const out = h(u, opts, body) || {};
        const status = out.status || 200;
        const text = [204, 205, 304].includes(status) ? null : (out.text != null ? out.text : JSON.stringify(out.body === undefined ? [] : out.body));
        return new Response(text, { status, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("[]", { status: 200 });
  };
  fn.calls = calls;
  return fn;
}
function withFetch(f, run) {
  return async () => {
    const old = globalThis.fetch;
    globalThis.fetch = f;
    try { await run(f); } finally { globalThis.fetch = old; }
  };
}
const MISSING = { status: 404, text: JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.cards' in the schema cache" }) };
const row = (over = {}) => ({ id: "Ab3xK9q", kind: "f", data: { ...FUN }, edit_hash: editHash("right-key"), views: 3, expires_at: FUTURE, closed_at: null, ...over });
const req = (ip = "1.2.3.4") => ({ headers: { "x-forwarded-for": ip } });

// ── 내용 정리 ──
test("sanitizeCard: 모르는 칸은 버리고, 필수 칸이 없으면 거절", () => {
  const r = sanitizeCard({ ...FUN, evil: "<script>", theme: "neon", m: [{ r: "장남", n: "김민준" }, { r: "차남", n: "" }], acc: [{ who: "장남", bank: "국민", no: "123-45" }, { no: "" }], noWreath: true, msg: "첫 줄\n둘째 줄" });
  assert.equal(r.ok, true);
  assert.equal(r.data.evil, undefined);
  assert.equal(r.data.theme, "mono");
  assert.deepEqual(r.data.m, [{ r: "장남", n: "김민준" }]);
  assert.equal(r.data.acc.length, 1);
  assert.equal(r.data.noWreath, 1);
  assert.equal(r.data.msg, "첫 줄\n둘째 줄", "인사말 줄바꿈은 살린다");
  assert.equal(sanitizeCard({ k: "f", name: "김영수" }).ok, false, "장례식장 없으면 거절");
  assert.equal(sanitizeCard({ k: "w", g: "민준", b: "서연", venue: "웨딩홀" }).ok, false, "예식 날짜 없으면 거절");
  assert.equal(sanitizeCard({ k: "x" }).ok, false);
  const w = sanitizeCard({ k: "w", g: "민준", b: "서연", date: "2026-11-01", venue: "웨딩홀", photo: "javascript:alert(1)" });
  assert.equal(w.ok, true);
  assert.equal(w.data.photo, "", "사진은 https 주소만");
  const big = sanitizeCard({ ...FUN, acc: Array.from({ length: 30 }, () => ({ who: "가".repeat(99), bank: "나", no: "1".repeat(99) })), msg: "다".repeat(900), m: Array.from({ length: 40 }, () => ({ r: "장남", n: "마".repeat(99) })) });
  assert.equal(big.ok, true, "칸마다 길이를 잘라 담는다");
  assert.equal(big.data.msg.length, 400);
  assert.equal(big.data.acc.length, 10);
  assert.equal(big.data.m.length, 15);
  assert.equal(big.data.m[0].n.length, 30);
  assert.ok(Buffer.byteLength(JSON.stringify(big.data)) <= 8000);
});

test("cardExpiry: 부고 발인+7일 · 청첩장 예식+30일, 한국시간 그날 밤 11:59:59", () => {
  const now = Date.parse("2026-10-06T03:00:00Z");
  assert.equal(cardExpiry({ k: "f", outDate: "2026-10-08" }, now), "2026-10-15T14:59:59.000Z");
  assert.equal(cardExpiry({ k: "w", date: "2026-11-01" }, now), "2026-12-01T14:59:59.000Z");
  assert.equal(cardExpiry({ k: "f", outDate: "2020-01-01" }, now), new Date(now + 86400000).toISOString(), "지난 날짜여도 최소 하루는 열린다");
  assert.equal(cardExpiry({ k: "w", date: "2030-01-01" }, now), new Date(now + 400 * 86400000).toISOString(), "너무 먼 날짜는 400일까지");
});

// ── 미리보기 HTML ──
test("renderOgHtml: 제목은 이스케이프, 봇은 머물고 사람은 card.html?c= 로", () => {
  const data = { ...FUN, name: "<b>김</b>" };
  const human = renderOgHtml({ id: "Ab3xK9q", data });
  assert.match(human, /og:title" content="\[부고\] 故 &lt;b&gt;김&lt;\/b&gt; 님 별세"/);
  assert.match(human, /og:image" content="https:\/\/floweranbu\.co\.kr\/og\/card-f-mono\.png"/);
  assert.match(human, /location\.replace\("https:\/\/floweranbu\.co\.kr\/card\.html\?c=Ab3xK9q"\)/);
  assert.doesNotMatch(human, /<b>김/);
  const bot = renderOgHtml({ id: "Ab3xK9q", data, bot: true });
  assert.doesNotMatch(bot, /refresh|location\.replace/, "봇에겐 넘기는 코드가 없어야 미리보기가 안 바뀐다");
  const map = renderOgHtml({ id: "Ab3xK9q", data: FUN, go: "map" });
  assert.match(map, /map\.kakao\.com\/link\/search\/%EC%8B%9C%ED%99%94/);
  assert.match(renderOgHtml({ id: "Ab3xK9q", data: null, closed: true }), /종료된 안내/);
});

test("isPreviewBot: 카톡 스크랩·페북·네이버는 봇, 카톡 인앱 브라우저는 사람", () => {
  assert.equal(isPreviewBot("kakaotalk-scrap/1.0; +https://devtalk.kakao.com/"), true);
  assert.equal(isPreviewBot("facebookexternalhit/1.1"), true);
  assert.equal(isPreviewBot("Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)"), true);
  assert.equal(isPreviewBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5"), false);
  assert.equal(isPreviewBot("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36"), false);
});

// ── 만들기 ──
test("만들기: 표가 없으면 503 fallback(만들기 화면이 긴 링크로)", withFetch(fakeFetch([["GET", /\/cards\?/, () => MISSING]]), async () => {
  const r = await handleCardPost({ action: "create", data: FUN }, req(), ENV);
  assert.equal(r.status, 503);
  assert.equal(r.body.fallback, true);
}));

test("만들기: 수정 키는 해시만 저장하고 짧은 링크를 돌려준다", withFetch(fakeFetch([
  ["GET", /\/cards\?ip_hash=/, () => ({ body: [] })],
  ["POST", /\/rest\/v1\/cards$/, () => ({ status: 201, text: "" })],
]), async (f) => {
  const r = await handleCardPost({ action: "create", data: { ...FUN, evil: 1 } }, req(), ENV);
  assert.equal(r.status, 200);
  assert.match(r.body.id, /^[A-Za-z0-9]{7}$/);
  assert.equal(r.body.url, `https://floweranbu.co.kr/c/${r.body.id}`);
  const ins = f.calls.find((c) => c.method === "POST");
  assert.equal(ins.body.edit_hash, crypto.createHash("sha256").update(`card-edit:${r.body.key}`).digest("hex"));
  assert.equal(JSON.stringify(ins.body).includes(r.body.key), false, "키 원문은 저장하지 않는다");
  assert.equal(ins.body.data.evil, undefined);
  assert.match(ins.body.ip_hash, /^[a-f0-9]{32}$/);
  assert.equal(ins.body.ip_hash.includes("1.2.3.4"), false);
}));

test("만들기: 한 곳에서 한 시간 12개까지", withFetch(fakeFetch([
  ["GET", /\/cards\?ip_hash=/, () => ({ body: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` })) })],
]), async (f) => {
  const r = await handleCardPost({ action: "create", data: FUN }, req(), ENV);
  assert.equal(r.status, 429);
  assert.equal(f.calls.some((c) => c.method === "POST"), false);
}));

// ── 조문 글 ──
const cardRoutes = (r, extra = []) => [
  ["GET", /\/cards\?id=eq\./, () => ({ body: r ? [r] : [] })],
  ...extra,
];
test("조문 글: 링크·도배·닫힌 안내·글 안 받는 안내는 거절, 정상 글은 저장", async () => {
  await withFetch(fakeFetch(cardRoutes(row())), async () => {
    const r = await handleCardPost({ action: "comment", id: "Ab3xK9q", name: "이웃", body: "자세히는 www.spam.com" }, req(), ENV);
    assert.equal(r.status, 400);
  })();
  await withFetch(fakeFetch(cardRoutes(row(), [["GET", /\/card_comments\?card_id=.*ip_hash=/, () => ({ body: [1, 2, 3, 4, 5].map((id) => ({ id })) })]])), async (f) => {
    const r = await handleCardPost({ action: "comment", id: "Ab3xK9q", name: "이웃", body: "삼가 고인의 명복을 빕니다" }, req(), ENV);
    assert.equal(r.status, 429);
    assert.equal(f.calls.some((c) => c.method === "POST"), false);
  })();
  await withFetch(fakeFetch(cardRoutes(row({ expires_at: PAST }))), async () => {
    const r = await handleCardPost({ action: "comment", id: "Ab3xK9q", name: "이웃", body: "명복을 빕니다" }, req(), ENV);
    assert.equal(r.status, 410);
  })();
  await withFetch(fakeFetch(cardRoutes(row({ data: { ...FUN, noComment: 1 } }))), async () => {
    const r = await handleCardPost({ action: "comment", id: "Ab3xK9q", name: "이웃", body: "명복을 빕니다" }, req(), ENV);
    assert.equal(r.status, 403);
  })();
  await withFetch(fakeFetch(cardRoutes(row(), [
    ["GET", /\/card_comments\?card_id=.*ip_hash=/, () => ({ body: [] })],
    ["POST", /\/card_comments$/, (u, o, b) => ({ status: 201, body: [{ id: 9, ...b, created_at: "2026-10-06T00:00:00Z" }] })],
  ])), async (f) => {
    const r = await handleCardPost({ action: "comment", id: "Ab3xK9q", name: " 이웃 ", body: "삼가 고인의 명복을 빕니다\n힘내세요" }, req(), ENV);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.comment, { id: 9, name: "이웃", body: "삼가 고인의 명복을 빕니다\n힘내세요", created_at: "2026-10-06T00:00:00Z" });
    assert.equal(r.body.comment.ip_hash, undefined, "ip_hash 는 손님에게 안 돌려준다");
    const ins = f.calls.find((c) => c.method === "POST");
    assert.equal(ins.body.card_id, "Ab3xK9q");
  })();
});

// ── 수정 키가 있어야 하는 일 ──
test("고치기: 키가 틀리면 403, 종류는 못 바꾸고, 맞으면 정리된 내용으로 저장", async () => {
  await withFetch(fakeFetch(cardRoutes(row())), async (f) => {
    const r = await handleCardPost({ action: "update", id: "Ab3xK9q", key: "wrong", data: FUN }, req(), ENV);
    assert.equal(r.status, 403);
    assert.equal(f.calls.some((c) => c.method === "PATCH"), false);
  })();
  await withFetch(fakeFetch(cardRoutes(row())), async () => {
    const r = await handleCardPost({ action: "update", id: "Ab3xK9q", key: "right-key", data: { k: "w", g: "a", b: "b", date: "2026-11-01", venue: "v" } }, req(), ENV);
    assert.equal(r.status, 400);
  })();
  await withFetch(fakeFetch(cardRoutes(row(), [["PATCH", /\/cards\?id=eq\.Ab3xK9q&edit_hash=eq\./, () => ({ status: 204 })]])), async (f) => {
    const r = await handleCardPost({ action: "update", id: "Ab3xK9q", key: "right-key", data: { ...FUN, room: "특실", hack: 1 } }, req(), ENV);
    assert.equal(r.status, 200);
    const patch = f.calls.find((c) => c.method === "PATCH");
    assert.equal(patch.body.data.room, "특실");
    assert.equal(patch.body.data.hack, undefined);
    assert.ok(patch.body.expires_at, "발인이 바뀌면 닫히는 날도 다시 셈");
  })();
});

test("관리: 키가 맞으면 숨긴 글까지 보여주고, 닫기는 내용·글을 지운다", async () => {
  await withFetch(fakeFetch(cardRoutes(row(), [["GET", /\/card_comments\?card_id=eq\.Ab3xK9q&select=/, () => ({ body: [{ id: 1, name: "a", body: "b", hidden: true }] })]])), async (f) => {
    const r = await handleCardPost({ action: "manage", id: "Ab3xK9q", key: "right-key" }, req(), ENV);
    assert.equal(r.status, 200);
    assert.equal(r.body.views, 3);
    assert.equal(r.body.comments.length, 1);
    assert.ok(f.calls.some((c) => /card_comments\?card_id=eq\.Ab3xK9q&select=/.test(c.url) && !/hidden=eq\.false/.test(c.url)), "관리 화면은 숨긴 글도 받는다");
  })();
  await withFetch(fakeFetch(cardRoutes(row())), async (f) => {
    const r = await handleCardPost({ action: "close", id: "Ab3xK9q", key: "right-key" }, req(), ENV);
    assert.equal(r.status, 200);
    const patch = f.calls.find((c) => c.method === "PATCH");
    assert.equal(patch.body.data, null);
    assert.ok(patch.body.closed_at);
    assert.ok(f.calls.some((c) => c.method === "DELETE" && /card_comments\?card_id=eq\.Ab3xK9q/.test(c.url)));
  })();
  await withFetch(fakeFetch(cardRoutes(row())), async (f) => {
    const r = await handleCardPost({ action: "hide", id: "Ab3xK9q", key: "nope", commentId: 1 }, req(), ENV);
    assert.equal(r.status, 403);
    assert.equal(f.calls.some((c) => c.method === "PATCH"), false);
  })();
});

// ── 보기 ──
test("보기: 열린 안내는 내용·글(숨긴 글 빼고)·조회수, 기간 지난 안내는 410 + 그 자리에서 지움", async () => {
  await withFetch(fakeFetch(cardRoutes(row(), [["GET", /\/card_comments\?/, () => ({ body: [{ id: 2, name: "이웃", body: "명복을 빕니다" }] })]])), async (f) => {
    const r = await handleCardGet({ card: "Ab3xK9q", json: "1" }, { ...ENV, KAKAO_JS_KEY: "0123456789abcdef0123456789abcdef" });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.name, "김영수");
    assert.equal(r.json.comments.length, 1);
    assert.equal(r.json.kakaoKey, "0123456789abcdef0123456789abcdef");
    assert.equal(r.json.edit_hash, undefined);
    assert.ok(f.calls.some((c) => /card_comments\?.*hidden=eq\.false/.test(c.url)));
    assert.ok(f.calls.some((c) => /rpc\/card_touch/.test(c.url)));
  })();
  await withFetch(fakeFetch(cardRoutes(row({ expires_at: PAST }))), async (f) => {
    const r = await handleCardGet({ card: "Ab3xK9q", json: "1" }, ENV);
    assert.equal(r.status, 410);
    assert.equal(r.json.closed, true);
    assert.equal(r.json.data, undefined);
    assert.ok(f.calls.some((c) => c.method === "PATCH"), "기간 지난 걸 처음 연 순간 지운다");
  })();
  await withFetch(fakeFetch(cardRoutes(null)), async () => {
    assert.equal((await handleCardGet({ card: "Zz9yX8w", json: "1" }, ENV)).status, 404);
    assert.equal((await handleCardGet({ card: "../etc", json: "1" }, ENV)).status, 400);
  })();
});

test("준비 확인: 표가 있으면 ready, 없으면 false · 카카오 키는 32자리 16진수만", async () => {
  await withFetch(fakeFetch([["GET", /\/cards\?select=id/, () => ({ body: [] })]]), async () => {
    const r = await handleCardGet({ card: "ready", json: "1" }, { ...ENV, KAKAO_JS_KEY: "not-a-key" });
    assert.deepEqual(r.json, { ready: true, kakaoKey: "" });
  })();
  await withFetch(fakeFetch([["GET", /\/cards\?select=id/, () => MISSING]]), async () => {
    const r = await handleCardGet({ card: "ready", json: "1" }, ENV);
    assert.equal(r.json.ready, false);
  })();
});

test("크론: 기간 지난 안내를 모두 닫는다 · 표가 없으면 건너뜀", async () => {
  await withFetch(fakeFetch([["GET", /\/cards\?expires_at=lt\./, () => ({ body: [{ id: "Aaaaaa1" }, { id: "Bbbbbb2" }] })]]), async (f) => {
    const r = await cleanupExpiredCards(ENV);
    assert.equal(r.closed, 2);
    assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 2);
    assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 2);
  })();
  await withFetch(fakeFetch([["GET", /\/cards\?/, () => MISSING]]), async () => {
    assert.deepEqual(await cleanupExpiredCards(ENV), { skipped: "no_table" });
  })();
});

// ── api/order-meta.js 연결 ──
function mockRes() {
  return {
    headers: {}, statusCode: 200, body: undefined,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
    send(v) { this.body = v; return this; },
  };
}
test("order-meta: /c/<id> 는 미리보기 HTML(봇이면 넘기지 않음) + 검색 막기 헤더", async () => {
  const old = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    await withFetch(fakeFetch(cardRoutes(row())), async () => {
      const res = mockRes();
      await orderMeta({ method: "GET", url: "/api/order-meta?card=Ab3xK9q", headers: { "user-agent": "kakaotalk-scrap/1.0" } }, res);
      assert.equal(res.statusCode, 200);
      assert.match(res.headers["content-type"], /text\/html/);
      assert.match(res.headers["x-robots-tag"], /noindex/);
      assert.match(res.body, /og:title" content="\[부고\] 故 김영수 님 별세"/);
      assert.doesNotMatch(res.body, /location\.replace/);
      const res2 = mockRes();
      await orderMeta({ method: "GET", url: "/api/order-meta?card=Ab3xK9q", headers: { "user-agent": "Mozilla/5.0 KAKAOTALK 10.4.5" } }, res2);
      assert.match(res2.body, /location\.replace/);
    })();
    await withFetch(fakeFetch([]), async () => {
      const res = mockRes();
      await orderMeta({ method: "POST", url: "/api/order-meta", headers: {}, body: { type: "card", action: "comment", id: "x" } }, res);
      assert.equal(res.statusCode, 400);
    })();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
});
