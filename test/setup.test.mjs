// 설정 점검(10/7) — 키를 넣기 전에 코드 쪽을 먼저 맞춰 둔 것.
//  - 판정(lib/setup-status.mjs): 값은 절대 안 내보내고 있다/없다만
//  - 배송 사진: 문자 키가 없으면 PHOTO_NOTICE_MODE 를 안 넣어도 '직접 전달'(텔레그램에 손님 링크)
//  - 관리자 설정 점검·시험 문자(api/admin.js resource "setup"), 공개 확인(api/order-meta ?setup=1)
import assert from "node:assert/strict";
import test from "node:test";

import { setupStatus, publicSetup, photoNoticeEffective, smsConfigured } from "../lib/setup-status.mjs";
import { refreshGuestAccessAndNotify } from "../api/order-photo.js";
import admin from "../api/admin.js";
import orderMeta from "../api/order-meta.js";

const SECRETS = {
  SOLAPI_API_KEY: "NCSKEYVALUE123", SOLAPI_API_SECRET: "SECRETVALUE456", SOLAPI_SENDER: "031-314-3003",
  OWNER_PHONE_1: "010-1234-5678", OWNER_PHONE_2: "", ADMIN_PASSWORD: "pw-should-not-leak",
  TELEGRAM_BOT_TOKEN: "tg-token", TELEGRAM_CHAT_ID: "chat", KAKAO_JS_KEY: "0123456789abcdef0123456789abcdef",
  VAPID_PRIVATE_KEY: "vapid-private", NAVER_CLIENT_ID: "nid", NAVER_CLIENT_SECRET: "nsecret",
  ADMIN_OWNER_IDS: "uuid-a, uuid-b", PAYMENT_INTENTS_REQUIRED: "1", TRANSFER_ENABLED: "1",
};

function withEnv(values, fn) {
  return async () => {
    const keys = new Set([...Object.keys(values), ...Object.keys(SECRETS), "PHOTO_NOTICE_MODE", "PUBLIC_BASE_URL", "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_AUTH_MODE", "BANK_TRANSFER_ENABLED", "VIRTUAL_ACCOUNT_ENABLED", "LIVE_PRICING", "ADMIN_STAFF_IDS"]);
    const old = Object.fromEntries([...keys].map((k) => [k, process.env[k]]));
    const oldFetch = globalThis.fetch;
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
    try { await fn(); } finally {
      globalThis.fetch = oldFetch;
      for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}
function mockRes() {
  return {
    headers: {}, statusCode: 200, body: undefined,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
    send(v) { this.body = v; return this; },
    end() { return this; },
  };
}

test("setupStatus: 있다/없다만 — 키·번호·비밀번호 값은 어디에도 안 나온다", () => {
  const s = setupStatus(SECRETS);
  const text = JSON.stringify(s) + JSON.stringify(publicSetup(SECRETS));
  for (const v of ["NCSKEYVALUE123", "SECRETVALUE456", "0313143003", "031-314-3003", "01012345678", "010-1234-5678", "pw-should-not-leak", "tg-token", "0123456789abcdef", "vapid-private", "nsecret", "uuid-a"]) {
    assert.equal(text.includes(v), false, `값이 새면 안 됨: ${v}`);
  }
  assert.equal(s.sms.ready, true);
  assert.equal(s.sms.ownerPhones, 1);
  assert.equal(s.admin.ownerIds, 2);
  assert.equal(s.admin.mode, "dual");
  assert.equal(s.admin.password, true);
  assert.equal(s.payment.intentsRequired, true);
  assert.equal(s.kakaoShare, true);
  assert.equal(s.push.vapid, true);
  assert.deepEqual(publicSetup(SECRETS), { sms: true, photoNotice: "sms", kakaoShare: true, transfer: true, bankTransfer: false });
  const empty = setupStatus({});
  assert.equal(empty.sms.ready, false);
  assert.equal(empty.photoNotice.effective, "manual");
  assert.equal(empty.kakaoShare, false);
  assert.equal(setupStatus({ KAKAO_JS_KEY: "not-a-key" }).kakaoShare, false);
});

test("photoNoticeEffective: 키 없으면 직접 전달, 있으면 문자, 스위치가 이긴다", () => {
  assert.equal(photoNoticeEffective({}), "manual");
  assert.equal(photoNoticeEffective({ SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SOLAPI_SENDER: "0313143003" }), "sms");
  assert.equal(photoNoticeEffective({ SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s" }), "manual", "발신번호가 없으면 문자 못 보냄");
  assert.equal(photoNoticeEffective({ PHOTO_NOTICE_MODE: "manual", SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SOLAPI_SENDER: "1" }), "manual");
  assert.equal(photoNoticeEffective({ PHOTO_NOTICE_MODE: "solapi" }), "sms");
  assert.equal(smsConfigured({ SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SOLAPI_SENDER: "---" }), false);
});

test("배송 사진: 문자 키가 없고 PHOTO_NOTICE_MODE 도 없으면 실패 대신 사장님께 손님 링크", withEnv({
  PUBLIC_BASE_URL: "https://floweranbu.example.test", TELEGRAM_BOT_TOKEN: "telegram-test", TELEGRAM_CHAT_ID: "chat-test",
}, async () => {
  let solapiCalls = 0;
  const telegram = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.pathname === "/rest/v1/rpc/claim_order_photo_notice") return Response.json([{ result: "claimed", lease_until: body.p_lease_until }]);
    if (url.pathname === "/rest/v1/rpc/finish_order_photo_notice") {
      assert.equal(body.p_notice_status, "skipped");
      assert.equal(body.p_error, "manual_mode");
      return Response.json([{ result: "finished", lease_until: null }]);
    }
    if (url.hostname === "api.solapi.com") { solapiCalls++; return Response.json({}); }
    if (url.hostname === "api.telegram.org") { telegram.push(body.text || ""); return Response.json({ ok: true }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const oid = "AF-20990101-PHOTO-AUTO";
  const result = await refreshGuestAccessAndNotify({
    order: { sender_phone: "01012345678" }, oid, path: `${oid}/photo.jpg`,
    supabaseUrl: "https://project.example.test", serviceKey: "service-test-key",
  });
  assert.equal(result.status, "skipped");
  assert.equal(solapiCalls, 0);
  assert.equal(telegram.length, 1, "실패 경고 없이 링크 안내 한 통만");
  assert.match(telegram[0], /고객 전달 필요[\s\S]*delivery-photo\.html#t=/);
  assert.ok(result.guestToken);
}));

const ADMIN_ENV = {
  SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  ADMIN_PASSWORD: "legacy-pw", ADMIN_AUTH_MODE: "dual",
};
const adminReq = (body) => ({ method: "POST", url: "/api/admin", headers: {}, body: { password: "legacy-pw", ...body } });

test("관리자 설정 점검: 대표 관리자만, 값 없이 상태만", withEnv({ ...ADMIN_ENV, SOLAPI_API_KEY: "NCSKEYVALUE123" }, async () => {
  globalThis.fetch = async () => new Response(null, { status: 201 });   // 감사 기록
  const res = mockRes();
  await admin(adminReq({ resource: "setup", action: "check" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.setup.sms.apiKey, true);
  assert.equal(res.body.setup.sms.ready, false);
  assert.equal(res.body.me.role, "owner");
  assert.equal(JSON.stringify(res.body).includes("NCSKEYVALUE123"), false);
  assert.equal(JSON.stringify(res.body).includes("legacy-pw"), false);
  const denied = mockRes();
  await admin({ method: "POST", url: "/api/admin", headers: {}, body: { resource: "setup", action: "check", password: "wrong" } }, denied);
  assert.equal(denied.statusCode, 401);
}));

test("시험 문자: 사장님 번호로 한 통, 번호 없으면 400", withEnv({
  ...ADMIN_ENV, SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SOLAPI_SENDER: "0313143003", OWNER_PHONE_1: "010-1234-5678",
}, async () => {
  const sent = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "api.solapi.com") {
      assert.match(options.headers.Authorization, /^HMAC-SHA256 apiKey=k, date=\S+, salt=[a-f0-9]{64}, signature=[a-f0-9]{64}$/);
      sent.push(JSON.parse(options.body).messages);
      return Response.json({ groupInfo: { count: { registeredSuccess: 1, registeredFailed: 0 } } });
    }
    return new Response(null, { status: 201 });
  };
  const res = mockRes();
  await admin(adminReq({ resource: "setup", action: "sms-test" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].to, "01012345678");
  assert.equal(sent[0][0].from, "0313143003");
  assert.match(sent[0][0].text, /시험 문자/);
  delete process.env.OWNER_PHONE_1;
  const res2 = mockRes();
  await admin(adminReq({ resource: "setup", action: "sms-test" }), res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(sent.length, 1);
}));

test("공개 확인 /api/order-meta?setup=1: 손님 기능 켜짐만, 보안 설정·값은 없음", withEnv({ ...SECRETS }, async () => {
  const res = mockRes();
  await orderMeta({ method: "GET", url: "/api/order-meta?setup=1", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["bankTransfer", "kakaoShare", "photoNotice", "sms", "transfer"]);
  assert.equal(res.body.sms, true);
  assert.equal(JSON.stringify(res.body).includes("pw-should-not-leak"), false);
}));
