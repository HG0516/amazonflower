// 네이버 로그인 뒤 원래 자리로(10/8) — naver-login 이 사이트 안 경로만 쿠키에 두고, naver-callback 이 그걸 redirect_to 에 붙인다.
import assert from "node:assert/strict";
import test from "node:test";
import naverLogin from "../api/naver-login.js";
import naverCallback from "../api/naver-callback.js";

function mockRes() {
  return { headers: {}, statusCode: 200, body: undefined,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, end() { return this; } };
}
function withEnv(values, fn) {
  return async () => {
    const keys = ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PUBLIC_BASE_URL"];
    const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const oldFetch = globalThis.fetch;
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
    try { await fn(); } finally { globalThis.fetch = oldFetch; for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
}
const cookies = (res) => [].concat(res.headers["set-cookie"] || []);

test("naver-login: 돌아갈 자리는 사이트 안 경로만 쿠키에 둔다", withEnv({ NAVER_CLIENT_ID: "cid" }, async () => {
  const res = mockRes();
  await naverLogin({ method: "GET", url: "/api/naver-login?return=%2Fcatalog.html%3Fx%3D1", headers: {} }, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/nid\.naver\.com\/oauth2\.0\/authorize\?/);
  assert.ok(cookies(res).some((c) => /^naver_return=%2Fcatalog\.html%3Fx%3D1; Path=\/; HttpOnly; Secure/.test(c)), cookies(res).join(" | "));
  for (const bad of ["//evil.com", "https://evil.com/", "/api/admin", "javascript:alert(1)", "/x y"]) {
    const r2 = mockRes();
    await naverLogin({ method: "GET", url: "/api/naver-login?return=" + encodeURIComponent(bad), headers: {} }, r2);
    assert.ok(cookies(r2).some((c) => /^naver_return=; /.test(c)), "거부해야 함: " + bad);
  }
}));

const CB_ENV = { NAVER_CLIENT_ID: "cid", NAVER_CLIENT_SECRET: "sec", SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-test-key" };
function cbFetch(seen) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("https://nid.naver.com/oauth2.0/token")) return Response.json({ access_token: "ntok" });
    if (u.startsWith("https://openapi.naver.com/v1/nid/me")) return Response.json({ response: { email: "a@b.c", name: "홍길동" } });
    if (u.endsWith("/auth/v1/admin/users")) return Response.json({ id: "u1" });
    if (u.endsWith("/auth/v1/admin/generate_link")) { seen.push(JSON.parse(opts.body)); return Response.json({ action_link: "https://project.example.test/auth/v1/verify?token=t&type=magiclink" }); }
    throw new Error("unexpected " + u);
  };
}
test("naver-callback: 쿠키의 자리를 redirect_to 에 붙이고, 수상한 값은 홈으로", withEnv(CB_ENV, async () => {
  const seen = [];
  globalThis.fetch = cbFetch(seen);
  const res = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?code=abc&state=deadbeef", headers: { cookie: "naver_state=deadbeef; naver_return=%2Fcatalog.html%3Fx%3D1" } }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "https://project.example.test/auth/v1/verify?token=t&type=magiclink");
  assert.equal(seen[0].options.redirect_to, "https://floweranbu.co.kr/catalog.html?x=1");
  assert.ok(cookies(res).some((c) => /^naver_return=; /.test(c)), "쓴 쿠키는 지운다");
  const res2 = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?code=abc&state=deadbeef", headers: { cookie: "naver_state=deadbeef; naver_return=%2F%2Fevil.com" } }, res2);
  assert.equal(seen[1].options.redirect_to, "https://floweranbu.co.kr");
  const res3 = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?code=abc&state=other", headers: { cookie: "naver_state=deadbeef" } }, res3);
  assert.equal(res3.statusCode, 302, "state 가 다르면 세션 없이 사이트로");
  assert.equal(res3.headers.location, "https://floweranbu.co.kr/#error=naver_state&error_description=state%20mismatch");
  assert.equal(seen.length, 2, "state 가 다르면 Supabase 를 부르지 않는다");
}));

// 실패도 사이트로 #error 를 달아 돌려보낸다(10/18) — auth.js 가 이유를 보여 주고 텔레그램에 보고하게.
test("naver-callback: 실패는 원래 자리 #error 로 돌려보낸다", withEnv({ NAVER_CLIENT_ID: "cid", NAVER_CLIENT_SECRET: "sec", SUPABASE_URL: "https://sb.example", SUPABASE_SERVICE_ROLE_KEY: "svc" }, async () => {
  globalThis.fetch = async () => { throw new Error("부르면 안 됨"); };
  const back = "naver_return=%2Fcatalog.html";
  const r1 = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?error=access_denied&error_description=Canceled+By+User&state=deadbeef", headers: { cookie: "naver_state=deadbeef; " + back } }, r1);
  assert.equal(r1.statusCode, 302);
  assert.equal(r1.headers.location, "https://floweranbu.co.kr/catalog.html#error=access_denied&error_description=Canceled%20By%20User");
  const r2 = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?code=abc&state=deadbeef", headers: {} }, r2);
  assert.equal(r2.headers.location, "https://floweranbu.co.kr/#error=naver_state&error_description=state%20cookie%20missing");
  assert.ok(cookies(r2).some((c) => /^naver_state=; /.test(c)), "쿠키는 지운다");
  globalThis.fetch = async (url) => String(url).includes("/oauth2.0/token") ? Response.json({ access_token: "t" }) : Response.json({ resultcode: "00", response: { name: "홍" } });
  const r3 = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?code=abc&state=deadbeef", headers: { cookie: "naver_state=deadbeef" } }, r3);
  assert.match(r3.headers.location, /#error=naver_no_email&/);
  globalThis.fetch = async () => Response.json({ error: "invalid_request", error_description: "no valid data in session" });
  const r4 = mockRes();
  await naverCallback({ method: "GET", url: "/api/naver-callback?code=abc&state=deadbeef", headers: { cookie: "naver_state=deadbeef" } }, r4);
  assert.match(r4.headers.location, /#error=naver_token&error_description=invalid_request%20no%20valid%20data/);
}));
