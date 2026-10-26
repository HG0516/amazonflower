// 부고·청첩장 자동읽기 바로잡기(lib/parse-fix.mjs, 10/26) 시험.
// ① 연도 없는 날짜를 지난해로 읽은 것을 올해·내년으로 옮기는지 ② 고인·상주 같은 이름을 한 칸으로 나누는지
// ③ api/parse-url 이 글과 링크를 같이 읽고, 링크가 안 열려도 글로 채우는지를 본다.
import assert from "node:assert/strict";
import test from "node:test";

import parseUrl from "../api/parse-url.js";
import { fixNames, fixParsed, fixYear, kstToday } from "../lib/parse-fix.mjs";

const TODAY = "2026-10-26";

test("오늘은 KST 날짜", () => {
  assert.equal(kstToday(Date.parse("2026-10-25T15:30:00Z")), "2026-10-26");
  assert.equal(kstToday(Date.parse("2026-10-25T14:30:00Z")), "2026-10-25");
});

test("연도 없는 날짜: 지난해로 읽으면 올해, 60일 넘게 지났으면 내년", () => {
  assert.equal(fixYear("2025-11-14", "11월 14일 토요일 오후 1시 30분", TODAY), "2026-11-14");
  assert.equal(fixYear("2025-10-28", "발인 10월 28일 오전 7시", TODAY), "2026-10-28");
  assert.equal(fixYear("2026-01-09", "1월 9일 낮 12시", TODAY), "2027-01-09");
  // 엊그제 발인은 지난 날 그대로(주문서가 '발인 뒤' 안내를 띄운다)
  assert.equal(fixYear("2025-10-24", "10월 24일 발인", TODAY), "2026-10-24");
});

test("연도가 글에 적혀 있거나 앞날이면 그대로", () => {
  assert.equal(fixYear("2025-11-14", "2025년 11월 14일", TODAY), "2025-11-14");
  assert.equal(fixYear("2025-11-14", "25.11.14 토", TODAY), "2025-11-14");
  assert.equal(fixYear("2025-11-14", "'25년 11월 14일", TODAY), "2025-11-14");
  assert.equal(fixYear("2026-11-14", "11월 14일", TODAY), "2026-11-14");
  assert.equal(fixYear("2027-03-02", "", TODAY), "2027-03-02");
  assert.equal(fixYear("", "11월 14일", TODAY), "");
  assert.equal(fixYear("11월 14일", "", TODAY), "11월 14일");
});

const fun = (rn, cm) => ({ type: "funeral", recipientName: rn, chiefMourner: cm });

test("유족 이름만 있는 부고: 두 칸에 같은 이름이면 상주만 남긴다", () => {
  const a = fixNames(fun("김철수", "김철수"), "[부고] 영업2팀 김철수 과장 부친상. 빈소 안산장례식장 3호실");
  assert.deepEqual([a.recipientName, a.chiefMourner, a.nameCheck], ["", "김철수", "mourner"]);
  const b = fixNames(fun("김철수", "김철수"), "김철수님 모친상 알려드립니다 서울아산병원장례식장 15호");
  assert.deepEqual([b.recipientName, b.chiefMourner, b.nameCheck], ["", "김철수", "mourner"]);
  const c = fixNames(fun("이영희", "이영희"), "이영희 님의 시모상을 알려 드립니다");
  assert.deepEqual([c.recipientName, c.chiefMourner], ["", "이영희"]);
});

test("故·별세 앞 이름이거나 단서가 없으면 고인만 남긴다", () => {
  const a = fixNames(fun("김영수", "김영수"), "[부고] 故 김영수님께서 별세하셨기에 알려드립니다.");
  assert.deepEqual([a.recipientName, a.chiefMourner, a.nameCheck], ["김영수", "", "deceased"]);
  const b = fixNames(fun("김영수", "김영수"), "부고 김영수 시흥장례식장");
  assert.deepEqual([b.recipientName, b.chiefMourner, b.nameCheck], ["김영수", "", "deceased"]);
  // 띄어 쓴 이름·故 붙은 이름도 같은 사람으로 본다
  const c = fixNames(fun("故 손 원", "손원"), "");
  assert.deepEqual([c.recipientName, c.chiefMourner], ["故 손 원", ""]);
  // 본인상은 그 사람이 고인
  const d = fixNames(fun("박민수", "박민수"), "총무팀 박민수 부장 본인상");
  assert.equal(d.chiefMourner, "");
});

test("상주 이름을 고인 칸에 넣었으면 상주 칸으로 옮긴다", () => {
  const a = fixNames(fun("김철수", ""), "영업2팀 김철수 과장 부친상");
  assert.deepEqual([a.recipientName, a.chiefMourner, a.nameCheck], ["", "김철수", "mourner"]);
  const b = fixNames(fun("김영수", ""), "故 김영수님 별세");
  assert.deepEqual([b.recipientName, b.chiefMourner, b.nameCheck], ["김영수", "", undefined]);
});

test("맞게 읽은 부고·청첩장은 건드리지 않는다", () => {
  const src = "손준호의 부친 故 손 원님께서 별세 하셨기에 ▶ 손준호 [아들] 드림 ◀";
  const a = fixNames(fun("손원", "손준호"), src);
  assert.deepEqual([a.recipientName, a.chiefMourner, a.nameCheck], ["손원", "손준호", undefined]);
  const w = fixParsed({ type: "wedding", recipientName: "김민수", groomName: "김민수", chiefMourner: "", date: "2026-11-14" }, "", Date.parse("2026-10-26T03:00:00Z"));
  assert.deepEqual([w.recipientName, w.date, w.nameCheck], ["김민수", "2026-11-14", undefined]);
});

function mockResponse() {
  return {
    headers: new Map(), statusCode: 200, body: undefined,
    setHeader(n, v) { this.headers.set(String(n).toLowerCase(), v); },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
    end() { return this; },
  };
}

async function runParse(body, page) {
  const oldFetch = globalThis.fetch, oldKey = process.env.ANTHROPIC_API_KEY;
  const sent = [];
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      sent.push(JSON.parse(init.body).messages[0].content);
      const out = { type: "funeral", recipientName: "김철수", chiefMourner: "김철수", date: "2025-10-28", time: "08:00" };
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200 });
    }
    return page();
  };
  try {
    const res = mockResponse();
    await parseUrl({ method: "POST", body }, res);
    return { res, sent };
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey;
  }
}

const TEXT = "[부고] 영업2팀 김철수 과장 부친상\n발인 10월 28일 오전 8시\nhttps://bugo.example.test/v/1";

test("글과 링크를 같이 보내면 둘 다 AI 에 넘기고, 결과를 바로잡아 돌려준다", async () => {
  const { res, sent } = await runParse({ url: "https://bugo.example.test/v/1", text: TEXT },
    () => new Response("<html><body><p>빈소 안산장례식장 3호실</p></body></html>", { status: 200 }));
  assert.equal(res.statusCode, 200);
  assert.match(sent[0], /^오늘은 \d{4}-\d{2}-\d{2} 입니다\./);
  assert.match(sent[0], /\[링크 페이지\][\s\S]*안산장례식장 3호실[\s\S]*\[붙여넣은 글\][\s\S]*과장 부친상/);
  assert.equal(res.body.result.recipientName, "");
  assert.equal(res.body.result.chiefMourner, "김철수");
  assert.notEqual(res.body.result.date.slice(0, 4), "2025");
});

test("링크가 안 열려도 붙여넣은 글로 읽는다. 링크만 보냈으면 예전처럼 실패", async () => {
  const fail = () => new Response("nope", { status: 503 });
  const a = await runParse({ url: "https://bugo.example.test/v/1", text: TEXT }, fail);
  assert.equal(a.res.statusCode, 200);
  assert.doesNotMatch(a.sent[0], /\[링크 페이지\]/);
  assert.match(a.sent[0], /\[붙여넣은 글\]/);
  const b = await runParse({ url: "https://bugo.example.test/v/1" }, fail);
  assert.equal(b.res.statusCode, 500);
  assert.equal(b.sent.length, 0);
});
