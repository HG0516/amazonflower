// 주소 추천(api/parse-url action:"addr"): 키가 없으면 조용히 빈 목록, 있으면 도로명주소 API 결과를 짧게 돌려준다.
import assert from "node:assert/strict";
import test from "node:test";
import parseUrl from "../api/parse-url.js";

function mockResponse() {
  return {
    statusCode: 200, body: undefined,
    setHeader() {}, status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; }, end() { return this; },
  };
}
async function run(q, { key = "test-juso", reply } = {}) {
  const oldFetch = globalThis.fetch, oldKey = process.env.JUSO_API_KEY;
  const urls = [];
  if (key) process.env.JUSO_API_KEY = key; else delete process.env.JUSO_API_KEY;
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify(reply), { status: 200 }); };
  try {
    const res = mockResponse();
    await parseUrl({ method: "POST", body: { action: "addr", q } }, res);
    return { body: res.body, urls };
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.JUSO_API_KEY; else process.env.JUSO_API_KEY = oldKey;
  }
}
const OK = { results: { common: { errorCode: "0", totalCount: "1" }, juso: [
  { roadAddrPart1: "서울특별시 광진구 아차산로27길 29", jibunAddr: "서울특별시 광진구 화양동 46-5", zipNo: "05019", bdNm: "", emdNm: "화양동" },
] } };

test("키가 없으면 밖으로 묻지 않고 빈 목록", async () => {
  const { body, urls } = await run("화양동 46-5", { key: "" });
  assert.deepEqual(body, { ok: true, items: [], skip: true, why: "nokey" });
  assert.equal(urls.length, 0);
});

test("결과를 도로명·지번·우편번호로 줄여 돌려준다", async () => {
  const { body, urls } = await run("화양동 46-5", { reply: OK });
  assert.equal(body.ok, true);
  assert.deepEqual(body.items, [{ road: "서울특별시 광진구 아차산로27길 29", jibun: "서울특별시 광진구 화양동 46-5", zip: "05019", bd: "", emd: "화양동" }]);
  assert.match(urls[0], /^https:\/\/business\.juso\.go\.kr\/addrlink\/addrLinkApi\.do\?/);
  assert.equal(new URL(urls[0]).searchParams.get("keyword"), "화양동 46-5");
  assert.equal(new URL(urls[0]).searchParams.get("resultType"), "json");
});

test("API 가 거절하는 특수문자·예약어는 빼고 묻는다", async () => {
  const { urls } = await run("화양동<46> select 5%", { reply: OK });
  assert.equal(new URL(urls[0]).searchParams.get("keyword"), "화양동 46 5");
});

test("너무 짧거나 API 오류면 빈 목록(주문은 그대로)", async () => {
  assert.deepEqual((await run("화", { reply: OK })).body.items, []);
  const err = await run("화양동", { reply: { results: { common: { errorCode: "E0001", errorMessage: "승인되지 않은 KEY" } } } });
  assert.deepEqual(err.body, { ok: true, items: [], skip: true, why: "juso:E0001 승인되지 않은 KEY" });
});

// 지정 상품만 들어가는 곳(regions.js venueRule = 약관 목록)
import fs from "node:fs";
import vm from "node:vm";
const ctx = { globalThis: {} }; ctx.window = ctx.globalThis;
vm.runInNewContext(fs.readFileSync(new URL("../regions.js", import.meta.url), "utf8"), ctx);
const venueRule = ctx.globalThis.venueRule;

test("꽃을 가려 받는 곳을 장소·주소 글로 알아본다", () => {
  assert.equal(venueRule("명동성당 서울특별시 중구 명동길 74", false).k, "nowreath");
  assert.equal(venueRule("서울특별시 강남구 언주로 564", false).k, "nowreath");
  assert.equal(venueRule("수원시연화장 경기도 수원시 팔달구", true).k, "objet");
  assert.equal(venueRule("기장 원자력병원 부산광역시 기장군 장안읍", true).k, "objet");
  assert.equal(venueRule("리베라컨벤션 경상남도 창원시 마산회원구", false).k, "ownrice");
});

test("이름이 비슷한 다른 곳에는 걸지 않는다", () => {
  assert.equal(venueRule("원자력병원장례식장 서울특별시 노원구 노원로 75", true), null);   // 서울 원자력병원은 목록에 없다
  assert.equal(venueRule("아데라움 서울특별시 강남구 언주로65길 30 (역삼동)", false), null);
  assert.equal(venueRule("더조은장례식장 서울특별시", true), null);
  assert.equal(venueRule("서울특별시 마포구 고령로 1", true), null);
});

test("지역 전체 규칙(거창·여수 등)은 근조 주문에만", () => {
  assert.deepEqual({ ...venueRule("경상남도 거창군 거창읍 중앙로 1", true) }, { k: "objet", n: "거창", area: true });
  assert.equal(venueRule("경상남도 거창군 거창읍 중앙로 1", false), null);
  assert.equal(venueRule("전남광주통합특별시 여수시 시청로 1", true).k, "objet");
});
