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
  { roadAddrPart1: "서울특별시 광진구 아차산로27길 29", jibunAddr: "서울특별시 광진구 화양동 46-5", zipNo: "05019", bdNm: "" },
] } };

test("키가 없으면 밖으로 묻지 않고 빈 목록", async () => {
  const { body, urls } = await run("화양동 46-5", { key: "" });
  assert.deepEqual(body, { ok: true, items: [], skip: true, why: "nokey" });
  assert.equal(urls.length, 0);
});

test("결과를 도로명·지번·우편번호로 줄여 돌려준다", async () => {
  const { body, urls } = await run("화양동 46-5", { reply: OK });
  assert.equal(body.ok, true);
  assert.deepEqual(body.items, [{ road: "서울특별시 광진구 아차산로27길 29", jibun: "서울특별시 광진구 화양동 46-5", zip: "05019", bd: "" }]);
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
