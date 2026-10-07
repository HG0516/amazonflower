// 로그인 실패 보고(10/7) — auth.js 가 돌려받은 #error 를 api/order-meta 가 사장님 텔레그램으로 보낸다.
//  - 값은 자르고 링크는 지운다, 늘 200, 같은 곳 10분 3번까지만, 텔레그램 미설정이면 조용히
import assert from "node:assert/strict";
import test from "node:test";
import orderMeta from "../api/order-meta.js";

function mockRes() {
  return { headers: {}, statusCode: 200, body: undefined,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
}
function withEnv(values, fn) {
  return async () => {
    const keys = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
    const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const oldFetch = globalThis.fetch;
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
    try { await fn(); } finally { globalThis.fetch = oldFetch; for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
}
const req = (body, ip) => ({ method: "POST", url: "/api/order-meta", headers: { "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 (iPhone) KAKAOTALK 10.4.5" }, body });

test("로그인 실패 보고: 텔레그램에 제공자·오류·설명(자른 것)만, 링크는 지움", withEnv({ TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_CHAT_ID: "chat" }, async () => {
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => { if (String(url).includes("api.telegram.org")) { sent.push(JSON.parse(opts.body).text); return Response.json({ ok: true }); } throw new Error("unexpected " + url); };
  const res = mockRes();
  await orderMeta(req({ type: "auth-error", provider: "kakao", error: "server_error", code: "unexpected_failure", description: "Error getting user email from external provider see https://evil.example/x <script>alert(1)</script> " + "가".repeat(500), page: "/" }, "10.0.0.1"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /로그인 실패 보고 — kakao/);
  assert.match(sent[0], /server_error \/ unexpected_failure/);
  assert.match(sent[0], /Error getting user email/);
  assert.equal(sent[0].includes("evil.example"), false);
  assert.ok(sent[0].length < 700, "설명은 300자에서 자른다");
  assert.match(sent[0], /KAKAOTALK/);
  const res2 = mockRes();
  await orderMeta(req({ type: "auth-error", provider: "hacker", error: "x" }, "10.0.0.2"), res2);
  assert.match(sent[1], /— 모름/);
}));

test("로그인 실패 보고: 같은 곳 10분 3번까지, 텔레그램 없으면 조용히 200", withEnv({ TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_CHAT_ID: "chat" }, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ok: true }); };
  for (let i = 0; i < 5; i++) { const r = mockRes(); await orderMeta(req({ type: "auth-error", provider: "google", error: "access_denied" }, "10.0.0.9"), r); assert.equal(r.statusCode, 200); if (i >= 3) assert.equal(r.body.muted, true); }
  assert.equal(calls, 3);
  delete process.env.TELEGRAM_BOT_TOKEN;
  const r = mockRes();
  await orderMeta(req({ type: "auth-error", provider: "apple", error: "x" }, "10.0.0.10"), r);
  assert.equal(r.statusCode, 200);
  assert.equal(calls, 3);
}));
