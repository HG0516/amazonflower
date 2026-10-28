// 부고·청첩장 자동읽기 바로잡기(lib/parse-fix.mjs, 10/26) 시험.
// ① 연도 없는 날짜를 지난해로 읽은 것을 올해·내년으로 옮기는지 ② 고인·상주 같은 이름을 한 칸으로 나누는지
// ③ api/parse-url 이 글과 링크를 같이 읽고, 링크가 안 열려도 글로 채우는지를 본다.
import assert from "node:assert/strict";
import test from "node:test";

import parseUrl from "../api/parse-url.js";
import { crossCheck, fixNames, fixParsed, fixYear, kstToday, matchHome, pageToText, ruleDeceased, ruleOuts, sameArea, scriptHangul, scriptUrls } from "../lib/parse-fix.mjs";

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

const FUNERAL_OUT = { type: "funeral", recipientName: "김철수", chiefMourner: "김철수", date: "2025-10-28", time: "08:00" };
async function runParse(body, page, out = FUNERAL_OUT) {
  const oldFetch = globalThis.fetch, oldKey = process.env.ANTHROPIC_API_KEY;
  const sent = [];
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      sent.push(JSON.parse(init.body).messages[0].content);
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
    () => new Response("<html><body><p>빈소 안산장례식장 3호실, 발인 10월 28일 오전 8시</p></body></html>", { status: 200 }));
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

test("상주 명단: 이름·관계만 남기고 숫자는 버린다, 장례식 아니면 빈 목록", () => {
  const j = fixParsed({ type: "funeral", recipientName: "손원", chiefMourner: "손준호", mourners: [
    { rel: "배우자", name: "유옥자" }, { rel: "아들", name: "손준호 010-1234-5678" }, { rel: "딸", name: "손유진" },
    { rel: "아들", name: "손준호" }, { rel: "제", name: "손" }, null, { rel: "계좌", name: "123-45-6789" },
  ] }, "");
  assert.deepEqual(j.mourners, [{ rel: "배우자", name: "유옥자" }, { rel: "아들", name: "손준호" }, { rel: "딸", name: "손유진" }]);
  assert.deepEqual(fixParsed({ type: "wedding", mourners: [{ rel: "아들", name: "김민수" }] }, "").mourners, []);
  assert.deepEqual(fixParsed({ type: "funeral" }, "").mourners, []);
});

// ── 링크 페이지 읽기·교차 확인(10/26). 사이트 모양만 본뜬 가짜 이름이다. ──

test("미리보기 요약(og:description)과 페이지 안 데이터까지 읽는다", () => {
  const a = pageToText(`<html><head><title>부고 - 홍길동 별세</title>
    <meta property="og:description" content="홍길동 별세 | 백병원장례식장 특실 | 발인 2026.10.28(수) 22:00">
    <meta name="description" content="홍길동 별세 | 백병원장례식장 특실 | 발인 2026.10.28(수) 22:00"></head>
    <body><div>&#9776; 메뉴 &#127808; 화환 보내기</div></body></html>`);
  assert.match(a.text, /^\[페이지 요약\]\n부고 - 홍길동 별세\n홍길동 별세 \| 백병원장례식장 특실 \| 발인 2026\.10\.28\(수\) 22:00\n\n\[본문\]/);
  assert.equal((a.text.match(/백병원장례식장 특실/g) || []).length, 1, "같은 요약은 한 번만");
  assert.match(a.text, /☰ 메뉴/);
  const b = pageToText(`<div id="app"></div><script>window.__D={"deceasedName":"홍길동","hallName":"시흥장례식장",
    "hallRoom":"3호실","burialDatetime":"2026-10-28 07:00","theme":"dark","token":"abc123"}</script>`);
  assert.match(b.text, /\[페이지 데이터\]\ndeceasedName: 홍길동\nhallName: 시흥장례식장\nhallRoom: 3호실\nburialDatetime: 2026-10-28 07:00$/);
  assert.ok(b.hangul >= 8);
  assert.ok(pageToText(`<html><head><title>의전나라</title></head><body><div id="app"></div><script src="/assets/index.js"></script></body></html>`).hangul < 8);
});

test("태그 꼬리표(data-page)에 데이터를 넣는 청첩장도 읽는다(더모드, 10/28)", () => {
  const page = JSON.stringify({ props: { card: { weddingDate: { date: "2026-11-07", hour: 12, minute: 0 },
    location: { roadAddress: "서울 강남구 테헤란로 521", hallName: "그랜드 인터컨티넨탈 서울 파르나스", floorName: "5층 그랜드 볼룸" },
    groom: { maleGivenName: "김태용" }, theme: "rose" } } }).replace(/"/g, "&quot;");
  const a = pageToText(`<html><head><title>소중한 분들을 초대합니다</title>
    <meta property="og:description" content="태용♡지윤의 모바일 청첩장"></head>
    <body><div id="app" data-page="${page}"></div></body></html>`);
  assert.match(a.text, /date: 2026-11-07\nhour: 12\nminute: 0\nroadAddress: 서울 강남구 테헤란로 521\nhallName: 그랜드 인터컨티넨탈 서울 파르나스\nfloorName: 5층 그랜드 볼룸\nmaleGivenName: 김태용$/);
  assert.doesNotMatch(a.text, /theme/);
});

test("결혼식 받는 분 이름에 하트 같은 꾸밈 글자를 남기지 않는다(10/28)", () => {
  const w = (o) => fixParsed({ type: "wedding", date: "", ...o }, "", Date.parse("2026-10-28T03:00:00Z")).recipientName;
  assert.equal(w({ recipientName: "김현수 ♥ 김도연", groomName: "김현수", brideName: "김도연" }), "김현수·김도연");
  assert.equal(w({ recipientName: "김태용, 노지윤", groomName: "김태용", brideName: "노지윤" }), "김태용·노지윤");
  assert.equal(w({ recipientName: "태용♡지윤", groomName: "", brideName: "" }), "태용·지윤");
  assert.equal(w({ recipientName: "김현수", groomName: "♥김현수", brideName: "" }), "김현수");
  assert.equal(fixParsed({ type: "funeral", recipientName: "홍길동", date: "" }, "", Date.parse("2026-10-28T03:00:00Z")).recipientName, "홍길동");
});

test("숨은 입력칸(바른손 M카드)도 읽고 전화번호 칸은 버린다(10/28)", () => {
  const a = pageToText(`<html><head><title>BarunsonMcard 모바일 초대장</title></head><body>
    <input type="hidden" id="Groom_Name" match="신랑명" value="이 준 서">
    <input type="hidden" id="Groom_Phone" value="010-1234-5678">
    <input type="hidden" id="WeddingDate" match="예식일자" value="2025-10-18" />
    <input type="hidden" id="WeddingMin" match="예식분" value="30" />
    <input type="hidden" id="Weddinghall_Name" match="예식장이름" value="바른컨벤션센터">
    <input type="hidden" id="Weddinghall_Address" match="예식장주소" value="서울시 중구 을지로 3가 296-13">
    <input type="text" id="memo" value="보이는 칸">
  </body></html>`);
  assert.match(a.text, /Groom_Name\(신랑명\): 이 준 서\nWeddingDate\(예식일자\): 2025-10-18\nWeddingMin\(예식분\): 30\nWeddinghall_Name\(예식장이름\): 바른컨벤션센터\nWeddinghall_Address\(예식장주소\): 서울시 중구 을지로 3가 296-13/);
  assert.doesNotMatch(a.text, /010-1234|보이는 칸/);
});

test("직접 만든 청첩장: 같은 사이트 스크립트를 골라 한글 문자열만 뽑는다(10/28)", () => {
  const html = `<script src="https://cdn.tailwindcss.com"></script><script type="module" src="/assets/index-KULm.js"></script>
    <script src="/.netlify/scripts/rum"></script><script src="/js/jquery.min.js"></script>`;
  assert.deepEqual(scriptUrls(html, "https://bong.netlify.app/"), ["https://bong.netlify.app/assets/index-KULm.js"]);
  const t = scriptHangul(`const a={g:"김철수",h:'토미스퀘어가든',x:"theme-dark",n:\`화훼 화환은
정중히 사양합니다.\`,u:"\\uc778\\ub3d935\\uae38 46"};`);
  assert.equal(t, "김철수\n토미스퀘어가든\n화훼 화환은 정중히 사양합니다.\n인동35길 46");
});

test("발인 줄을 규칙으로 읽는다(부고장마다 다른 모양)", () => {
  const t = "2026-10-26";
  const one = (s) => ruleOuts(s, t)[0] || null;
  assert.deepEqual(one("발인 2026.10.26(월) 22:00"), { date: "2026-10-26", time: "22:00" });
  assert.deepEqual(one("빈소: 낙원장례식장 5호실 | 발인: 2026.09.26 07:00"), { date: "2026-09-26", time: "07:00" });
  assert.deepEqual(one("입관일 2026년 10월 27일(화) 10시 30분 발인일 2026년 10월 28일(수) 09시 00분 발인까지 2일 남았습니다"), { date: "2026-10-28", time: "09:00" });
  assert.deepEqual(one("발인 10월 28일 오전 7시"), { date: "2026-10-28", time: "07:00" });
  assert.deepEqual(one("■ 발인 : 2025년 02월 26일(수) 05시 20분"), { date: "2025-02-26", time: "05:20" });
  assert.deepEqual(one("발인 12월 3일 저녁 7시 30분"), { date: "2026-12-03", time: "19:30" });
  assert.deepEqual(one("△발인 : 2023년 10월 18일(수)"), { date: "2023-10-18", time: "" });
  assert.equal(one("발인 3일 (032)890-3180"), null);
  assert.equal(one("발인까지 2일 남았습니다"), null);
});

test("故 뒤 이름을 읽는다", () => {
  assert.equal(ruleDeceased("故 손 원님께서 별세"), "손 원");
  assert.equal(ruleDeceased("故 임미자님 부고"), "임미자");
  assert.equal(ruleDeceased("故김영수 권사 소천"), "김영수");
  assert.equal(ruleDeceased("故 남궁민수님의 명복을"), "남궁민수");
  assert.equal(ruleDeceased("영업2팀 김철수 과장 부친상"), "");
});

const HOMES = [
  { n: "시흥장례식장", a: "경기도 시흥시 비둘기공원7길 50", t: "031-000-0000" },
  { n: "시민장례식장", a: "경기도 안산시 단원구 원포공원1로 31", t: "031-000-0001" },
  { n: "시민장례식장", a: "전북특별자치도 전주시 완산구 용머리로 100", t: "063-000-0000" },
  { n: "서울아산병원 장례식장", a: "서울특별시 송파구 올림픽로43길 88", t: "02-0000-0000" },
];

test("장례식장 목록과 맞춰 본다: 같은 이름이 여럿이면 주소의 시·군·구로 고른다", () => {
  assert.equal(matchHome("서울아산병원장례식장", "", HOMES).t, "02-0000-0000");
  assert.equal(matchHome("시민장례식장", "", HOMES), null);
  assert.equal(matchHome("시민장례식장", "전북 전주시 완산구 용머리로", HOMES).t, "063-000-0000");
  assert.equal(matchHome("아산", "", HOMES), null, "너무 짧은 이름은 맞추지 않는다");
  assert.ok(sameArea("서울특별시 송파구 올림픽로43길 88", "서울 송파구 풍납동"));
  assert.ok(!sameArea("경기도 시흥시 비둘기공원7길", "서울특별시 강남구 테헤란로"));
});

const T = "2026-10-26";
const fj = (o) => ({ type: "funeral", recipientName: "", chiefMourner: "", date: "", time: "", venueName: "", venueAddress: "", ...o });

test("교차 확인: 글에 적힌 발인을 따르고, 두 곳이 다르면 확인을 부탁한다", () => {
  const a = crossCheck(fj({ date: "2026-10-27", time: "10:30" }), "입관 2026.10.27 10:30 발인 2026.10.28 09:00", T, []);
  assert.deepEqual([a.date, a.time, a.check], ["2026-10-28", "09:00", []]);
  const b = crossCheck(fj({ date: "2026-10-28", time: "07:00" }),
    "[링크 페이지]\n발인 2026.10.28(수) 09:00\n\n[붙여넣은 글]\n발인 10월 28일 오전 7시", T, []);
  assert.deepEqual([b.date, b.time, b.check], ["2026-10-28", "09:00", ["발인"]]);
  const c = crossCheck(fj({ date: "2026-10-28", time: "09:00" }), "[페이지 요약]\n발인 2026.10.28 09:00\n\n[본문]\n발인일 2026년 10월 28일 09시 00분", T, []);
  assert.deepEqual(c.check, [], "같은 발인이 여러 번 적힌 건 문제 아님");
});

test("교차 확인: 고인 이름을 채우거나 다르면 확인, 장례식장 주소를 채우거나 지역이 다르면 확인", () => {
  const a = crossCheck(fj({ chiefMourner: "김철수" }), "故 김영수님 별세. 김철수 과장 부친상", T, []);
  assert.deepEqual([a.recipientName, a.check], ["김영수", []]);
  const b = crossCheck(fj({ recipientName: "김영자" }), "故 김영수님 별세", T, []);
  assert.deepEqual(b.check, ["고인"]);
  const c = crossCheck(fj({ venueName: "시흥장례식장" }), "", T, HOMES);
  assert.deepEqual([c.venueAddress, c.check], ["경기도 시흥시 비둘기공원7길 50", []]);
  const d = crossCheck(fj({ venueName: "시흥 장례식장", venueAddress: "서울특별시 강남구 테헤란로 1" }), "", T, HOMES);
  assert.deepEqual(d.check, ["장소"]);
  const w = crossCheck({ type: "wedding", date: "2026-11-14" }, "발인 2026.10.28", T, HOMES);
  assert.equal(w.date, "2026-11-14", "결혼식은 건드리지 않는다");
});

test("빈 화면만 오는 링크: 글이 없으면 캡처·문자 안내, 글이 있으면 글로 읽는다", async () => {
  const spa = () => new Response(`<html><head><title>의전나라</title></head><body><div id="app"></div></body></html>`, { status: 200 });
  const a = await runParse({ url: "https://fd.example.test/share/1" }, spa);
  assert.equal(a.res.statusCode, 422);
  assert.equal(a.res.body.code, "thin");
  assert.match(a.res.body.error, /캡처/);
  assert.equal(a.sent.length, 0);
  const b = await runParse({ url: "https://fd.example.test/share/1", text: TEXT }, spa);
  assert.equal(b.res.statusCode, 200);
  assert.doesNotMatch(b.sent[0], /의전나라/);
});

test("서버가 장례식장 목록을 읽어 주소를 채운다", async () => {
  const out = { type: "funeral", recipientName: "홍길동", chiefMourner: "홍철수", venueName: "21C한일병원장례식장", venueAddress: "", date: "", time: "" };
  const page = () => new Response("<html><body>故 홍길동님 부고. 빈소 21C한일병원장례식장 2호실. 상주 홍철수</body></html>", { status: 200 });
  const { res } = await runParse({ url: "https://bugo.example.test/v/2" }, page, out);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.result.venueAddress, /^경상남도 거제시/);
});
