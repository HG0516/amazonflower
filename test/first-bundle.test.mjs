import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import confirmPayment, { notifyOwners, notifyPaymentIntentWithLease } from "../api/confirm-payment.js";
import admin from "../api/admin.js";
import checkDeadlines from "../api/check-deadlines.js";
import orderConfirm from "../api/order-confirm.js";
import orderPhoto, { refreshGuestAccessAndNotify } from "../api/order-photo.js";
import orderPhotoView from "../api/order-photo-view.js";
import {
  authenticateAdmin,
  requireRole,
} from "../lib/admin-auth.mjs";
import {
  cancelManualReviewReason,
  confirmIdempotencyKey,
  isRetryableTossHttpStatus,
  orderHash,
  paymentAttemptHash,
  stableStringify,
  verifyCanceledPayment,
  verifyDonePayment,
} from "../lib/payment-integrity.mjs";
import {
  createGuestAccess,
  hashGuestToken,
  normalizeOrderPhotoPath,
  signUploadToken,
  verifyLegacyUploadToken,
  verifyUploadToken,
} from "../lib/photo-access.mjs";
import { beginOrderCancellation } from "../lib/order-coordination.mjs";
import { priceOf } from "../products.mjs";

function mockResponse() {
  return {
    headers: new Map(),
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; },
  };
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("payment hash and idempotency key are deterministic", () => {
  const a = { amount: 78000, recipient: { name: "김안부", phone: "01012345678" } };
  const b = { recipient: { phone: "01012345678", name: "김안부" }, amount: 78000 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(orderHash(a), orderHash(b));
  assert.equal(confirmIdempotencyKey("FA-20260814-ABCD", "pay_one"), confirmIdempotencyKey("FA-20260814-ABCD", "pay_one"));
  assert.notEqual(confirmIdempotencyKey("FA-20260814-ABCD", "pay_one"), confirmIdempotencyKey("FA-20260814-ABCD", "pay_two"));
  assert.notEqual(confirmIdempotencyKey("FA-20260814-ABCD", "pay_one"), confirmIdempotencyKey("FA-20260814-EFGH", "pay_one"));
});

test("Toss result must match the sealed order exactly", () => {
  const payment = {
    orderId: "FA-20260814-ABCD",
    paymentKey: "pay_test_123",
    totalAmount: 78000,
    status: "DONE",
  };
  assert.deepEqual(
    verifyDonePayment(payment, { orderId: payment.orderId, paymentKey: payment.paymentKey, amount: 78000 }),
    { ok: true },
  );
  assert.equal(verifyDonePayment(payment, { orderId: payment.orderId, paymentKey: payment.paymentKey, amount: 79000 }).reason, "amount_mismatch");
  assert.equal(verifyDonePayment({ ...payment, status: "CANCELED" }, { orderId: payment.orderId, paymentKey: payment.paymentKey, amount: 78000 }).ok, false);
});

test("a Toss cancellation is trusted only with exact identity, zero balance, and full cancel history", () => {
  const canceled = {
    orderId: "AF-20990101-CANCEL-VERIFY", paymentKey: "pay_cancel_verify",
    totalAmount: 78000, balanceAmount: 0, status: "CANCELED",
    cancels: [{ cancelAmount: 78000 }],
  };
  assert.deepEqual(verifyCanceledPayment(canceled, {
    orderId: canceled.orderId, paymentKey: canceled.paymentKey, amount: 78000,
  }), { ok: true, canceledAmount: 78000 });
  assert.equal(verifyCanceledPayment({ ...canceled, status: "DONE" }, {
    orderId: canceled.orderId, paymentKey: canceled.paymentKey, amount: 78000,
  }).ok, false);
  assert.equal(verifyCanceledPayment({ ...canceled, balanceAmount: 78000 }, {
    orderId: canceled.orderId, paymentKey: canceled.paymentKey, amount: 78000,
  }).ok, false);
  assert.equal(verifyCanceledPayment({ ...canceled, cancels: [] }, {
    orderId: canceled.orderId, paymentKey: canceled.paymentKey, amount: 78000,
  }).ok, false);
});

test("Toss retryability and manual-review reasons separate permanent cancel failures", () => {
  assert.equal(isRetryableTossHttpStatus(408), true);
  assert.equal(isRetryableTossHttpStatus(409), true);
  assert.equal(isRetryableTossHttpStatus(429), true);
  assert.equal(isRetryableTossHttpStatus(500), true);
  assert.equal(isRetryableTossHttpStatus(400), false);
  assert.equal(isRetryableTossHttpStatus(403), false);
  assert.equal(cancelManualReviewReason(403), "cancel_manual_review_403");
});

test("customer confirmation SMS does not depend on owner phone configuration", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let sentBody = null;
  try {
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    delete process.env.OWNER_PHONE_1;
    delete process.env.OWNER_PHONE_2;
    globalThis.fetch = async (_input, options = {}) => {
      sentBody = JSON.parse(options.body);
      return Response.json({ groupInfo: { count: { registeredSuccess: 1, registeredFailed: 0 } } });
    };
    const result = await notifyOwners(
      { productLabel: "축하화환", senderPhone: "01012345678" },
      { orderId: "AF-SMS-CUSTOMER", totalAmount: 78000 },
    );
    assert.equal(result.sent, true);
    assert.equal(result.ownerCount, 0);
    assert.equal(result.customerCount, 1);
    assert.equal(sentBody.messages.length, 1);
    assert.equal(sentBody.messages[0].to, "01012345678");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("SOLAPI HTTP success is not accepted when a recipient registration failed", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    process.env.OWNER_PHONE_1 = "01099998888";
    delete process.env.OWNER_PHONE_2;
    globalThis.fetch = async () => Response.json({
      groupInfo: { count: { registeredSuccess: 1, registeredFailed: 1 } },
      failedMessageList: [{ to: "must-not-be-logged" }],
    });
    const result = await notifyOwners(
      { productLabel: "축하화환", senderPhone: "01012345678" },
      { orderId: "AF-SMS-PARTIAL", totalAmount: 78000 },
    );
    assert.equal(result.sent, false);
    assert.equal(result.reason, "solapi_recipient_rejected");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("payment notifications retry only the channel that did not succeed", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SOLAPI_API_KEY", "SOLAPI_API_SECRET",
    "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const intent = {
    order_id: "AF-NOTIFY-RETRY", state: "finalized", expected_amount: 78000,
    notified_at: null, sms_notified_at: null, telegram_notified_at: null,
    updated_at: "2099-01-01T00:00:00.000Z",
  };
  let smsCalls = 0, telegramCalls = 0, telegramShouldFail = true;
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    process.env.OWNER_PHONE_1 = "01099998888";
    delete process.env.OWNER_PHONE_2;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/payment_intents" && String(options.method).toUpperCase() === "PATCH") {
        Object.assign(intent, JSON.parse(options.body));
        return Response.json([intent]);
      }
      if (url.hostname === "api.solapi.com") {
        smsCalls++;
        return Response.json({ groupInfo: { count: { registeredSuccess: 2, registeredFailed: 0 } } });
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return Response.json(telegramShouldFail ? { ok: false } : { ok: true }, { status: telegramShouldFail ? 400 : 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const order = { productLabel: "축하화환", senderPhone: "01012345678" };
    const payment = { orderId: intent.order_id, totalAmount: 78000, status: "DONE" };
    await notifyPaymentIntentWithLease(intent, order, payment, Date.now(), false);
    assert.ok(intent.sms_notified_at);
    assert.equal(intent.telegram_notified_at, null);
    assert.equal(intent.notified_at, null);
    assert.equal(smsCalls, 1);
    assert.equal(telegramCalls, 1);

    telegramShouldFail = false;
    await notifyPaymentIntentWithLease(intent, order, payment, Date.now(), false);
    assert.ok(intent.telegram_notified_at);
    assert.ok(intent.notified_at);
    assert.equal(smsCalls, 1, "successful SMS must not be sent again");
    assert.equal(telegramCalls, 2);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("concurrent notification workers acquire only one per-channel lease", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SOLAPI_API_KEY", "SOLAPI_API_SECRET",
    "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const stored = {
    order_id: "AF-NOTIFY-RACE", state: "finalized", expected_amount: 78000,
    notified_at: null, sms_notified_at: null, telegram_notified_at: null,
    telegram_notice_lease_until: null,
  };
  let telegramCalls = 0;
  let releaseTelegram;
  let announceTelegram;
  const telegramGate = new Promise((resolve) => { releaseTelegram = resolve; });
  const telegramStarted = new Promise((resolve) => { announceTelegram = resolve; });
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    delete process.env.SOLAPI_API_KEY;
    delete process.env.SOLAPI_API_SECRET;
    delete process.env.SOLAPI_SENDER;
    delete process.env.OWNER_PHONE_1;
    delete process.env.OWNER_PHONE_2;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        if (patch.telegram_notice_lease_until) {
          const leaseIsFree = !stored.telegram_notified_at
            && (!stored.telegram_notice_lease_until
              || Date.parse(stored.telegram_notice_lease_until) < Date.now());
          if (!leaseIsFree) return Response.json([]);
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        if (patch.telegram_notified_at) {
          const expectedLease = String(url.searchParams.get("telegram_notice_lease_until") || "").replace(/^eq\./, "");
          if (stored.telegram_notified_at || stored.telegram_notice_lease_until !== expectedLease) {
            return Response.json([]);
          }
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        if (patch.notified_at) {
          if (stored.notified_at) return Response.json([]);
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        throw new Error(`unexpected intent patch ${options.body}`);
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        announceTelegram();
        await telegramGate;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const snapshot = { ...stored };
    const order = { productLabel: "축하화환", senderPhone: "01012345678" };
    const payment = { orderId: stored.order_id, totalAmount: 78000, status: "DONE" };
    const first = notifyPaymentIntentWithLease({ ...snapshot }, order, payment, Date.now(), false);
    await telegramStarted;
    const second = await notifyPaymentIntentWithLease({ ...snapshot }, order, payment, Date.now(), false);
    assert.equal(second.deferred, true);
    assert.equal(telegramCalls, 1, "the second worker must not send the same Telegram notice");
    releaseTelegram();
    await first;
    assert.ok(stored.telegram_notified_at);
    assert.ok(stored.notified_at);
    assert.equal(telegramCalls, 1);
  } finally {
    releaseTelegram();
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("uncertain payment SMS and Telegram results retain their leases", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SOLAPI_API_KEY", "SOLAPI_API_SECRET",
    "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const stored = {
    order_id: "AF-NOTIFY-UNCERTAIN", state: "finalized", expected_amount: 78000,
    notified_at: null, sms_notified_at: null, telegram_notified_at: null,
    sms_notice_lease_until: null, telegram_notice_lease_until: null,
  };
  let smsCalls = 0, telegramCalls = 0;
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    delete process.env.OWNER_PHONE_1;
    delete process.env.OWNER_PHONE_2;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        for (const field of ["sms_notice_lease_until", "telegram_notice_lease_until"]) {
          if (patch[field]) {
            assert.equal(url.searchParams.get("state"), "eq.finalized");
            assert.equal(url.searchParams.get("finalization_error"), "is.null");
            if (stored[field] && Date.parse(stored[field]) > Date.now()) return Response.json([]);
            Object.assign(stored, patch);
            return Response.json([{ ...stored }]);
          }
          if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] === null) {
            assert.fail(`uncertain result must not clear ${field}`);
          }
        }
        if (patch.notified_at) assert.fail("aggregate notice must not be marked after uncertain sends");
        throw new Error(`unexpected intent patch ${options.body}`);
      }
      if (url.hostname === "api.solapi.com") {
        smsCalls++;
        return Response.json({ message: "temporary upstream error" }, { status: 500 });
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const order = { productLabel: "축하화환", senderPhone: "01012345678" };
    const payment = { orderId: stored.order_id, totalAmount: 78000, status: "DONE" };
    const first = await notifyPaymentIntentWithLease({ ...stored }, order, payment, Date.now(), false);
    assert.equal(first.sms.uncertain, true);
    assert.equal(first.telegram.uncertain, true);
    assert.ok(Date.parse(stored.sms_notice_lease_until) > Date.now() + 8 * 60000);
    assert.ok(Date.parse(stored.telegram_notice_lease_until) > Date.now() + 8 * 60000);

    const second = await notifyPaymentIntentWithLease({ ...stored }, order, payment, Date.now(), false);
    assert.equal(second.deferred, true);
    assert.equal(smsCalls, 1);
    assert.equal(telegramCalls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("payment notice and refund holds are mutually exclusive in both start orders", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SOLAPI_API_KEY", "SOLAPI_API_SECRET",
    "SOLAPI_SENDER", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-PAY-NOTICE-RACE";
  const orderData = { productLabel: "축하화환", senderPhone: "01012345678" };
  const stored = {
    order_id: oid, state: "finalized", finalization_error: null,
    notified_at: null, telegram_notified_at: null, telegram_notice_lease_until: null,
  };
  let cancelRequested = false, telegramCalls = 0;
  let releaseTelegram;
  let announceTelegram;
  const telegramGate = new Promise((resolve) => { releaseTelegram = resolve; });
  const telegramStarted = new Promise((resolve) => { announceTelegram = resolve; });
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    delete process.env.SOLAPI_API_KEY;
    delete process.env.SOLAPI_API_SECRET;
    delete process.env.SOLAPI_SENDER;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        if (patch.telegram_notice_lease_until) {
          const wantsFinalized = url.searchParams.get("state") === "eq.finalized"
            && url.searchParams.get("finalization_error") === "is.null";
          if (!wantsFinalized || stored.state !== "finalized" || stored.finalization_error !== null
              || (stored.telegram_notice_lease_until && Date.parse(stored.telegram_notice_lease_until) > Date.now())) {
            return Response.json([]);
          }
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        if (patch.telegram_notified_at) {
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        if (patch.notified_at) {
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        throw new Error(`unexpected intent patch ${options.body}`);
      }
      if (url.pathname === "/rest/v1/rpc/begin_order_cancellation" && method === "POST") {
        if (stored.telegram_notice_lease_until && Date.parse(stored.telegram_notice_lease_until) > Date.now()) {
          return Response.json([{ result: "payment_notice_busy", lease_until: stored.telegram_notice_lease_until }]);
        }
        cancelRequested = true;
        stored.state = "canceling";
        stored.finalization_error = "cancel_order_sync_pending";
        return Response.json([{ result: "started", lease_until: null }]);
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        announceTelegram();
        await telegramGate;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const payment = { orderId: oid, paymentKey: "pay_notice_race", totalAmount: 78000, status: "DONE" };
    const sending = notifyPaymentIntentWithLease({ ...stored }, orderData, payment, Date.now(), false);
    await telegramStarted;
    const args = {
      supabaseUrl: "https://project.example.test", serviceKey: "service-test-key",
      orderId: oid, paymentKey: payment.paymentKey, expectedAmount: payment.totalAmount,
      orderData, orderHash: orderHash(orderData), tossStatus: "DONE",
    };
    const busy = await beginOrderCancellation(args);
    assert.equal(busy.result, "payment_notice_busy");
    assert.equal(cancelRequested, false);

    releaseTelegram();
    await sending;
    stored.telegram_notice_lease_until = null;
    const started = await beginOrderCancellation(args);
    assert.equal(started.result, "started");

    // 이미 hold가 먼저 생긴 뒤 stale reconcile snapshot이 와도 state CAS에서
    // claim을 잃어 외부 신규주문 알림을 보내지 않는다.
    stored.telegram_notified_at = null;
    stored.notified_at = null;
    const stale = await notifyPaymentIntentWithLease({
      ...stored, state: "finalized", finalization_error: null,
    }, orderData, payment, Date.now(), false);
    assert.equal(stale.deferred, true);
    assert.equal(telegramCalls, 1);
  } finally {
    releaseTelegram();
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("cancellation critical alerts can claim canceling rows but payment alerts cannot", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const stored = {
    order_id: "AF-20990101-CANCEL-ALERT", state: "canceling",
    finalization_error: "cancel_order_sync_pending", alert_sent_at: null,
    telegram_alerted_at: null, telegram_alert_lease_until: null,
  };
  let telegramCalls = 0;
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        if (patch.telegram_alerted_at) {
          const expectedLease = String(url.searchParams.get("telegram_alert_lease_until") || "").replace(/^eq\./, "");
          if (stored.telegram_alert_lease_until !== expectedLease) return Response.json([]);
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        if (patch.alert_sent_at) {
          Object.assign(stored, patch);
          return Response.json([{ ...stored }]);
        }
        const filter = url.searchParams.get("state");
        const errorFilter = url.searchParams.get("finalization_error");
        const allowed = filter === "in.(canceling,canceled,finalized)" && errorFilter === "not.is.null";
        if (!allowed || !["canceling", "canceled", "finalized"].includes(stored.state) || !stored.finalization_error) {
          return Response.json([]);
        }
        Object.assign(stored, patch);
        return Response.json([{ ...stored }]);
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const order = { productLabel: "축하화환" };
    const payment = { orderId: stored.order_id, paymentKey: "pay_cancel_alert", totalAmount: 78000, status: "DONE" };
    const stalePaymentAlert = await notifyPaymentIntentWithLease({ ...stored }, order, payment, Date.now(), true, {
      tag: "결제확인필요", scope: "payment",
    });
    assert.equal(stalePaymentAlert.deferred, true);
    assert.equal(telegramCalls, 0);

    const cancellationAlert = await notifyPaymentIntentWithLease({ ...stored }, order, payment, Date.now(), true, {
      tag: "환불확인필요", scope: "cancellation",
    });
    assert.equal(cancellationAlert.telegram.sent, true);
    assert.equal(telegramCalls, 1);
    assert.ok(stored.telegram_alerted_at);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("driver upload link is order-bound, expiring, and tamper evident", () => {
  const nowMs = Date.UTC(2026, 7, 14, 0, 0, 0);
  const expiresAt = Math.floor(nowMs / 1000) + 3600;
  const secret = "photo-test-secret-with-enough-entropy";
  const token = signUploadToken("FA-20260814-ABCD", expiresAt, secret);
  assert.equal(verifyUploadToken({ orderId: "FA-20260814-ABCD", expiresAt, token, secret, nowMs }).ok, true);
  assert.equal(verifyUploadToken({ orderId: "FA-20260814-EFGH", expiresAt, token, secret, nowMs }).ok, false);
  assert.equal(verifyUploadToken({ orderId: "FA-20260814-ABCD", expiresAt, token: token.slice(0, -1) + "x", secret, nowMs }).ok, false);
  assert.equal(verifyUploadToken({ orderId: "FA-20260814-ABCD", expiresAt, token, secret, nowMs: nowMs + 3601_000 }).reason, "expired");
  const legacyToken = crypto.createHmac("sha256", "legacy-cron-secret").update("photo:FA-20260814-ABCD").digest("hex").slice(0, 24);
  assert.equal(verifyLegacyUploadToken({ orderId: "FA-20260814-ABCD", token: legacyToken, env: { CRON_SECRET: "legacy-cron-secret" }, nowMs }).ok, true);
  assert.equal(verifyLegacyUploadToken({ orderId: "FA-20260814-ABCD", token: legacyToken, env: { CRON_SECRET: "legacy-cron-secret" }, nowMs: Date.parse("2026-08-22T00:00:00+09:00") }).reason, "legacy_expired");
});

test("guest photo access stores only a one-way hash and normalizes safe paths", () => {
  const access = createGuestAccess({ nowMs: 0, ttlSeconds: 60 });
  assert.match(access.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(access.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(hashGuestToken(access.token), access.tokenHash);
  assert.notEqual(access.token, access.tokenHash);
  assert.equal(normalizeOrderPhotoPath("orders/FA-1/photo.jpg"), "orders/FA-1/photo.jpg");
  assert.equal(normalizeOrderPhotoPath("https://example.supabase.co/storage/v1/object/public/order-photos/orders%2FFA-1%2Fphoto.jpg?token=x"), "orders/FA-1/photo.jpg");
  assert.equal(normalizeOrderPhotoPath("../secret.jpg"), null);
  assert.equal(normalizeOrderPhotoPath("https://evil.example/secret.jpg"), null);
});

test("administrator bearer token is server validated and role constrained", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = {
    ADMIN_AUTH_MODE: process.env.ADMIN_AUTH_MODE,
    ADMIN_OWNER_IDS: process.env.ADMIN_OWNER_IDS,
    ADMIN_STAFF_IDS: process.env.ADMIN_STAFF_IDS,
    ADMIN_OWNER_EMAILS: process.env.ADMIN_OWNER_EMAILS,
    ADMIN_STAFF_EMAILS: process.env.ADMIN_STAFF_EMAILS,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  try {
    process.env.ADMIN_AUTH_MODE = "jwt";
    process.env.ADMIN_OWNER_IDS = "owner-uid";
    process.env.ADMIN_STAFF_IDS = "staff-uid";
    process.env.ADMIN_OWNER_EMAILS = "";
    process.env.ADMIN_STAFF_EMAILS = "";
    process.env.ADMIN_EMAILS = "";
    process.env.ADMIN_PASSWORD = "legacy-test-password";
    globalThis.fetch = async (_url, options = {}) => {
      const bearer = String(options.headers && options.headers.Authorization || "");
      if (bearer === "Bearer owner-token") return new Response(JSON.stringify({ id: "owner-uid", email: "owner@example.test" }), { status: 200 });
      if (bearer === "Bearer staff-token") return new Response(JSON.stringify({ id: "staff-uid", email: "staff@example.test" }), { status: 200 });
      if (bearer === "Bearer customer-token") return new Response(JSON.stringify({ id: "customer-uid", email: "customer@example.test" }), { status: 200 });
      return new Response("{}", { status: 401 });
    };
    const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
    const config = { supabaseUrl: "https://project.example.test", serviceKey: "service-test-key" };

    const owner = await authenticateAdmin(req("owner-token"), {}, config);
    const staff = await authenticateAdmin(req("staff-token"), {}, config);
    const customer = await authenticateAdmin(req("customer-token"), {}, config);
    const legacy = await authenticateAdmin(req(""), { password: "legacy-test-password" }, config);
    assert.equal(owner.role, "owner");
    assert.equal(staff.role, "staff");
    assert.equal(customer.status, 403);
    assert.equal(legacy.ok, false, "jwt mode must reject the legacy password");
    assert.equal(requireRole(staff, ["owner"]).status, 403);
    assert.equal(requireRole(owner, ["owner"]).ok, true);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("prepared payment survives confirmation retry and creates one logical order", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENT_INTENTS_REQUIRED",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const intents = new Map();
  const orders = new Map();
  let tossConfirmCalls = 0;
  try {
    process.env.TOSS_SECRET_KEY = "test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PAYMENT_INTENTS_REQUIRED = "1";
    for (const key of envKeys.slice(4)) delete process.env[key];

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/rpc/create_payment_intent" && method === "POST") {
        const args = JSON.parse(options.body);
        if (intents.has(args.p_order_id)) return Response.json({ code: "23505" }, { status: 409 });
        const row = {
          order_id: args.p_order_id,
          state: "prepared",
          expected_amount: args.p_expected_amount,
          order_data: args.p_order_data,
          order_hash: args.p_order_hash,
          user_id: args.p_user_id,
          expires_at: args.p_expires_at,
          payment_key: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        intents.set(row.order_id, row);
        return Response.json(row);
      }
      if (url.pathname === "/rest/v1/payment_intents") {
        const oid = url.searchParams.get("order_id")?.replace(/^eq\./, "");
        if (method === "GET") return Response.json(oid && intents.has(oid) ? [intents.get(oid)] : []);
        if (method === "POST") {
          const row = JSON.parse(options.body);
          if (intents.has(row.order_id)) return Response.json({ code: "23505" }, { status: 409 });
          intents.set(row.order_id, { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          return Response.json([intents.get(row.order_id)], { status: 201 });
        }
        if (method === "PATCH") {
          const row = oid && intents.get(oid);
          const paymentKeyFilter = url.searchParams.get("payment_key");
          const notifiedFilter = url.searchParams.get("notified_at");
          const alertFilter = url.searchParams.get("alert_sent_at");
          const matches = row
            && (!paymentKeyFilter || paymentKeyFilter !== "is.null" || !row.payment_key)
            && (!notifiedFilter || notifiedFilter !== "is.null" || !row.notified_at)
            && (!alertFilter || alertFilter !== "is.null" || !row.alert_sent_at);
          if (!matches) return Response.json([]);
          Object.assign(row, JSON.parse(options.body));
          return Response.json([row]);
        }
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") {
        tossConfirmCalls++;
        const body = JSON.parse(options.body);
        return Response.json({
          orderId: body.orderId,
          paymentKey: body.paymentKey,
          totalAmount: body.amount,
          status: "DONE",
          method: "카드",
          approvedAt: "2026-08-14T10:00:00+09:00",
          receipt: { url: "https://receipt.example.test/one" },
        });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname.startsWith("/v1/payments/orders/") && method === "GET") {
        const oid = decodeURIComponent(url.pathname.split("/").pop());
        return Response.json({
          orderId: oid,
          paymentKey: "pay_retry_one",
          totalAmount: priceOf("congrats_g1"),
          status: "DONE",
          method: "카드",
          approvedAt: "2026-08-14T10:00:00+09:00",
          receipt: { url: "https://receipt.example.test/one" },
        });
      }
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        const oid = url.searchParams.get("order_id")?.replace(/^eq\./, "");
        return Response.json(oid && orders.has(oid) ? [{ order_id: oid }] : []);
      }
      if (url.pathname === "/rest/v1/orders" && method === "POST") {
        const row = JSON.parse(options.body);
        if (!orders.has(row.order_id)) orders.set(row.order_id, { ...row });
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const oid = url.searchParams.get("order_id")?.replace(/^eq\./, "");
        const row = oid && orders.get(oid);
        if (!row) return Response.json([]);
        Object.assign(row, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const orderId = "AF-20990101-ABCD1234";
    const amount = priceOf("congrats_g1");
    assert.ok(Number.isInteger(amount) && amount > 0);
    const order = {
      productCode: "congrats_g1",
      productLabel: "축하화환",
      category: "wreath",
      type: "wedding",
      quantity: 1,
      address: "경기 시흥시 신천3길 23",
      venue: "꽃안부웨딩홀",
      venueDetail: "1층",
      recipientName: "김안부",
      date: "2099-01-01",
      timeSlot: "오전",
      senderName: "이꽃",
      senderPhone: "01012345678",
    };

    const prepareRes = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: { action: "prepare", orderId, amount, order } }, prepareRes);
    assert.equal(prepareRes.statusCode, 200);
    assert.equal(prepareRes.body.prepared, true);

    for (let retry = 0; retry < 2; retry++) {
      const confirmRes = mockResponse();
      await confirmPayment({ method: "POST", headers: {}, body: { paymentKey: "pay_retry_one", orderId, amount } }, confirmRes);
      assert.equal(confirmRes.statusCode, 200);
      assert.equal(confirmRes.body.needsReconciliation, false);
      assert.equal(confirmRes.body.integrity, "intent");
      assert.equal(typeof confirmRes.body.saved, "boolean");
      assert.equal(JSON.stringify(confirmRes.body).includes(order.senderPhone), false, "payment response must not expose order PII");
    }
    assert.equal(orders.size, 1, "atomic upsert must keep one order row");
    assert.equal(intents.get(orderId).state, "finalized");
    assert.equal(tossConfirmCalls, 1, "a finalized retry must query Toss instead of posting approval again");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("prepare refuses legacy order-id collisions, lookup failures, and an RPC collision race", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENT_INTENTS_REQUIRED",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const orderId = "AF-20990101-LEGACY01";
  const amount = priceOf("congrats_g1");
  const order = {
    productCode: "congrats_g1", productLabel: "축하화환", category: "wreath", type: "wedding",
    quantity: 1, address: "경기 시흥시 신천3길 23", venue: "꽃안부웨딩홀", venueDetail: "1층",
    recipientName: "김안부", date: "2099-01-01", timeSlot: "오전", senderName: "이꽃", senderPhone: "01012345678",
  };
  let orderLookupStatus = 200;
  let existingOrder = true;
  let rpcCalls = 0;
  try {
    process.env.TOSS_SECRET_KEY = "test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PAYMENT_INTENTS_REQUIRED = "1";
    for (const key of envKeys.slice(4)) delete process.env[key];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([]);
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        return orderLookupStatus === 200
          ? Response.json(existingOrder ? [{ order_id: orderId }] : [])
          : Response.json({ message: "temporary database error" }, { status: orderLookupStatus });
      }
      if (url.pathname === "/rest/v1/rpc/create_payment_intent" && method === "POST") {
        rpcCalls++;
        return Response.json({ code: "23505", message: "payment_order_id_already_exists" }, { status: 409 });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const collided = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: { action: "prepare", orderId, amount, order } }, collided);
    assert.equal(collided.statusCode, 409);
    assert.equal(rpcCalls, 0, "an existing legacy order must never reach intent creation");

    orderLookupStatus = 500;
    const uncertain = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: { action: "prepare", orderId, amount, order } }, uncertain);
    assert.equal(uncertain.statusCode, 503);
    assert.equal(rpcCalls, 0, "an uncertain collision check must fail closed before intent creation");

    orderLookupStatus = 200;
    existingOrder = false;
    const raced = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: { action: "prepare", orderId, amount, order } }, raced);
    assert.equal(raced.statusCode, 409);
    assert.equal(rpcCalls, 1, "the RPC must catch an order inserted after the preflight check");

    // SQL 적용 직전에 열린 구형 결제창의 callback도 과거 orders와 겹치면
    // legacy 승인으로 내려가지 않고 출금 전에 중단해야 한다.
    existingOrder = true;
    const legacyCallback = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: {
      paymentKey: "pay_legacy_collision", orderId, amount, order,
    } }, legacyCallback);
    assert.equal(legacyCallback.statusCode, 409);
    assert.equal(rpcCalls, 1, "a legacy callback collision must stop before intent creation or Toss approval");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a permanent Toss cancel rejection closes automatic retries but retains the order hold", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_AUTH_MODE",
    "ADMIN_OWNER_IDS", "REFUND_LINK_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-CANCEL4X";
  const amount = 78000;
  const paymentKey = "pay_cancel_permanent";
  const sealed = { productLabel: "축하화환", productCode: "congrats_g1" };
  const intent = {
    order_id: oid, state: "finalized", expected_amount: amount,
    order_data: sealed, order_hash: orderHash(sealed), payment_key: paymentKey,
    toss_status: "DONE", finalized_at: "2098-12-31T00:00:00.000Z", finalization_error: null,
    telegram_alerted_at: null,
  };
  const order = {
    order_id: oid, status: "new", product_label: "축하화환", product_code: "congrats_g1",
    paid_amount: amount, amount, cancel_requested_at: null,
  };
  let cancelPosts = 0, auditWrites = 0, telegramCalls = 0;
  try {
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.ADMIN_AUTH_MODE = "jwt";
    process.env.ADMIN_OWNER_IDS = "owner-uid";
    delete process.env.REFUND_LINK_SECRET;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/auth/v1/user" && method === "GET") {
        return Response.json({ id: "owner-uid", email: "owner@example.test" });
      }
      if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json([{ ...order }]);
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        if (url.searchParams.get("cancel_requested_at") === "is.null" && order.cancel_requested_at) return Response.json([]);
        Object.assign(order, patch);
        return Response.json([{ order_id: oid }]);
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([{ ...intent }]);
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const stateFilter = url.searchParams.get("state");
        if (stateFilter === "eq.canceling" && intent.state !== "canceling") return Response.json([]);
        if (stateFilter === "eq.finalized" && intent.state !== "finalized") return Response.json([]);
        Object.assign(intent, JSON.parse(options.body));
        return Response.json([{ ...intent }]);
      }
      if (url.pathname === "/rest/v1/rpc/begin_order_cancellation" && method === "POST") {
        const body = JSON.parse(options.body);
        assert.equal(body.p_order_id, oid);
        assert.equal(body.p_order_hash, intent.order_hash);
        intent.state = body.p_already_canceled ? "canceled" : "canceling";
        intent.payment_key = body.p_payment_key;
        intent.toss_status = body.p_already_canceled ? "CANCELED" : body.p_toss_status;
        intent.finalization_error = "cancel_order_sync_pending";
        order.cancel_requested_at ||= new Date().toISOString();
        return Response.json([{
          result: body.p_already_canceled ? "already_canceled" : "started",
          lease_until: null,
        }]);
      }
      if (url.pathname === "/rest/v1/admin_audit_logs" && method === "POST") {
        auditWrites++;
        return new Response("", { status: 201 });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        return Response.json({ orderId: oid, paymentKey, totalAmount: amount, status: "DONE" });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/${paymentKey}/cancel`) {
        cancelPosts++;
        return Response.json({ code: "NOT_CANCELABLE", message: "permanent rejection" }, { status: 403 });
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await admin({
      method: "POST", headers: { authorization: "Bearer owner-token", origin: "https://amazonflower.vercel.app" },
      body: { resource: "order", action: "cancel", orderId: oid, reason: "주문 취소" },
    }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(cancelPosts, 1);
    assert.equal(intent.state, "finalized");
    assert.equal(intent.finalization_error, "cancel_manual_review_403");
    assert.ok(order.cancel_requested_at, "manual review must keep fulfillment blocked");
    assert.equal(telegramCalls, 2, "refund hold and permanent-failure review are both announced");
    assert.ok(auditWrites >= 1);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a Toss cancel HTTP 200 without a verified full cancellation stays pending", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_AUTH_MODE",
    "ADMIN_OWNER_IDS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-CANCEL-BAD200";
  const amount = 78000;
  const paymentKey = "pay_cancel_bad_200";
  const orderData = { productLabel: "축하화환", productCode: "congrats_g1" };
  const intent = {
    order_id: oid, state: "finalized", expected_amount: amount,
    order_data: orderData, order_hash: orderHash(orderData), payment_key: paymentKey,
    toss_status: "DONE", finalization_error: null,
  };
  const order = { order_id: oid, status: "new", product_label: "축하화환", cancel_requested_at: null };
  let tossLookups = 0, cancelPosts = 0, canceledOrderPatches = 0;
  try {
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.ADMIN_AUTH_MODE = "jwt";
    process.env.ADMIN_OWNER_IDS = "owner-uid";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/auth/v1/user" && method === "GET") return Response.json({ id: "owner-uid", email: "owner@example.test" });
      if (url.pathname === "/rest/v1/orders" && method === "GET") return Response.json([{ ...order }]);
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        canceledOrderPatches++;
        Object.assign(order, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([{ ...intent }]);
      if (url.pathname === "/rest/v1/rpc/begin_order_cancellation" && method === "POST") {
        intent.state = "canceling";
        intent.finalization_error = "cancel_order_sync_pending";
        order.cancel_requested_at = new Date().toISOString();
        return Response.json([{ result: "started", lease_until: null }]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        tossLookups++;
        return Response.json({ orderId: oid, paymentKey, totalAmount: amount, balanceAmount: amount, status: "DONE" });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/${paymentKey}/cancel`) {
        cancelPosts++;
        return Response.json({ orderId: oid, paymentKey, totalAmount: amount, balanceAmount: amount, status: "DONE" });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await admin({
      method: "POST", headers: { authorization: "Bearer owner-token", origin: "https://amazonflower.vercel.app" },
      body: { resource: "order", action: "cancel", orderId: oid, reason: "주문 취소" },
    }, res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.pending, true);
    assert.equal(cancelPosts, 1);
    assert.equal(tossLookups, 2, "an invalid 2xx cancel body is followed by one ledger verification");
    assert.equal(intent.state, "canceling");
    assert.ok(order.cancel_requested_at);
    assert.equal(canceledOrderPatches, 0, "an unverified refund must never mark the order canceled");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("refund-pending orders cannot be reactivated from admin or the Telegram order button", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_AUTH_MODE",
    "ADMIN_OWNER_IDS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-HOLD001";
  const cancelRequestedAt = "2099-01-01T00:00:00.000Z";
  let statusPatchCalls = 0;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.ADMIN_AUTH_MODE = "jwt";
    process.env.ADMIN_OWNER_IDS = "owner-uid";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/auth/v1/user" && method === "GET") {
        return Response.json({ id: "owner-uid", email: "owner@example.test" });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        statusPatchCalls++;
        assert.equal(url.searchParams.get("cancel_requested_at"), "is.null");
        return Response.json([]);
      }
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        assert.match(url.searchParams.get("select") || "", /cancel_requested_at/);
        return Response.json([{ status: "new", ordered_at: null, cancel_requested_at: cancelRequestedAt }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const adminRes = mockResponse();
    await admin({
      method: "POST",
      headers: { authorization: "Bearer owner-token", origin: "https://amazonflower.vercel.app" },
      body: { resource: "order", action: "status", orderId: oid, status: "ordered" },
    }, adminRes);
    assert.equal(adminRes.statusCode, 409);
    assert.match(adminRes.body.error, /환불 처리 중/);

    const token = crypto.createHmac("sha256", process.env.CRON_SECRET)
      .update(`confirm:${oid}`).digest("hex").slice(0, 20);
    const telegramRes = mockResponse();
    await orderConfirm({
      method: "GET", headers: {}, url: `/api/order-confirm?id=${oid}&t=${token}`,
    }, telegramRes);
    assert.equal(telegramRes.statusCode, 400);
    assert.match(String(telegramRes.body), /환불 처리 중인 주문/);
    assert.equal(statusPatchCalls, 2);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("reopening an ordered job clears the old deadline-alert marker", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_AUTH_MODE", "ADMIN_OWNER_IDS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let patched = null;
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.ADMIN_AUTH_MODE = "jwt";
    process.env.ADMIN_OWNER_IDS = "owner-uid";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/auth/v1/user" && method === "GET") {
        return Response.json({ id: "owner-uid", email: "owner@example.test" });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        patched = JSON.parse(options.body);
        return Response.json([{ order_id: "AF-20990101-REOPEN", product_label: "축하화환", ...patched }]);
      }
      if (url.pathname === "/rest/v1/admin_audit_logs" && method === "POST") return new Response("", { status: 201 });
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await admin({
      method: "POST", headers: { authorization: "Bearer owner-token", origin: "https://amazonflower.vercel.app" },
      body: { resource: "order", action: "status", orderId: "AF-20990101-REOPEN", status: "new" },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(patched, { status: "new", alerted_at: null });
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("refund-pending orders reject admin photo, driver-link, and invoice mutations", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_AUTH_MODE", "ADMIN_OWNER_IDS", "PHOTO_UPLOAD_SECRET"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-HOLD002";
  let orderReads = 0, invoicePatches = 0, storageCalls = 0;
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.ADMIN_AUTH_MODE = "jwt";
    process.env.ADMIN_OWNER_IDS = "owner-uid";
    process.env.PHOTO_UPLOAD_SECRET = "photo-test-secret-with-enough-entropy";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/auth/v1/user" && method === "GET") {
        return Response.json({ id: "owner-uid", email: "owner@example.test" });
      }
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        orderReads++;
        return Response.json([{
          order_id: oid, status: "new", canceled_at: null,
          cancel_requested_at: "2099-01-01T00:00:00.000Z", completed_photo: `${oid}/done.jpg`,
        }]);
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        invoicePatches++;
        assert.equal(url.searchParams.get("cancel_requested_at"), "is.null");
        return Response.json([]);
      }
      if (url.pathname.startsWith("/storage/")) {
        storageCalls++;
        return Response.json({ signedURL: "/must-not-happen" });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const req = (body) => ({
      method: "POST", headers: { authorization: "Bearer owner-token", origin: "https://amazonflower.vercel.app" }, body,
    });
    const photoRes = mockResponse();
    await admin(req({ resource: "order", action: "photo", orderId: oid }), photoRes);
    assert.equal(photoRes.statusCode, 409);

    const linkRes = mockResponse();
    await admin(req({ resource: "order", action: "link", orderId: oid }), linkRes);
    assert.equal(linkRes.statusCode, 409);

    const invoiceRes = mockResponse();
    await admin(req({ resource: "corp", action: "invoice", order_id: oid, issued: true }), invoiceRes);
    assert.equal(invoiceRes.statusCode, 409);
    assert.equal(orderReads, 2);
    assert.equal(invoicePatches, 1);
    assert.equal(storageCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("briefings and delivery warnings exclude refund-pending orders at query and claim time", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID", "ANTHROPIC_API_KEY",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let briefingQueries = 0, warningQueries = 0, warningClaims = 0, telegramCalls = 0;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    delete process.env.ANTHROPIC_API_KEY;

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        briefingQueries++;
        assert.equal(url.searchParams.get("cancel_requested_at"), "is.null");
        return Response.json([], { headers: { "Content-Range": "0/0" } });
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected briefing fetch ${method} ${url}`);
    };
    const briefRes = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?briefing=morning",
    }, briefRes);
    assert.equal(briefRes.statusCode, 200);
    assert.equal(briefingQueries, 8, "briefing re-reads orders after the AI wait before sending");

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        warningQueries++;
        assert.equal(url.searchParams.get("cancel_requested_at"), "is.null");
        return Response.json([{
          id: 71, product_label: "축하화환", recipient_name: "김안부", venue: "꽃안부홀",
          order_type: "wedding", event_time: "12:00", event_at: new Date().toISOString(),
        }]);
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        warningClaims++;
        assert.equal(url.searchParams.get("cancel_requested_at"), "is.null");
        assert.equal(url.searchParams.get("status"), "eq.new");
        return Response.json([]);
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected warning fetch ${method} ${url}`);
    };
    const warningRes = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines",
    }, warningRes);
    assert.equal(warningRes.statusCode, 200);
    assert.equal(warningQueries, 1);
    assert.equal(warningClaims, 1);
    assert.equal(warningRes.body.alerted, 0);
    assert.equal(telegramCalls, 1, "only the empty morning briefing is sent; a lost warning claim sends nothing");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a normal ordered transition after a delivery warning is never mislabeled as a refund", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const order = {
    id: 72, status: "new", cancel_requested_at: null, canceled_at: null, alerted_at: null,
    product_label: "축하화환", recipient_name: "김안부", venue: "꽃안부홀",
    order_type: "wedding", event_time: "12:00", event_at: new Date().toISOString(),
  };
  let telegramCalls = 0;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        if (url.searchParams.get("alerted_at") === "is.null") return Response.json([{ ...order }]);
        // PostgREST may serialize the same timestamptz with +00:00 instead of Z.
        const serialized = order.alerted_at ? order.alerted_at.replace(/Z$/, "+00:00") : order.alerted_at;
        return Response.json([{ ...order, alerted_at: serialized }]);
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        Object.assign(order, JSON.parse(options.body));
        return Response.json([{ ...order }]);
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        // 운영자가 경고를 보고 정상 발주완료 처리한 상황.
        order.status = "ordered";
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" }, url: "/api/check-deadlines",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.alerted, 1);
    assert.equal(telegramCalls, 1, "ordered is a normal resolution, not a refund correction");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a refund started while a briefing is sent gets an immediate correction", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "ANTHROPIC_API_KEY"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const row = {
    order_id: "AF-20990101-BRIEF-RACE", status: "new", cancel_requested_at: null, canceled_at: null,
    product_label: "축하화환", product_code: "congrats_g1", recipient_name: "김안부",
    venue: "꽃안부홀", event_at: new Date().toISOString(), event_time: "12:00", created_at: new Date().toISOString(),
    paid_amount: 78000, amount: 78000,
  };
  const telegramBodies = [];
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        if (url.searchParams.get("order_id")?.startsWith("in.")) return Response.json([{ ...row }]);
        const isPending = url.searchParams.get("status") === "eq.new";
        return Response.json(isPending ? [{ ...row }] : [], {
          headers: { "Content-Range": isPending ? "0-0/1" : "0/0" },
        });
      }
      if (url.hostname === "api.telegram.org") {
        const body = JSON.parse(options.body);
        telegramBodies.push(body.text);
        if (telegramBodies.length === 1) row.cancel_requested_at = new Date().toISOString();
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?briefing=morning",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sent, true);
    assert.equal(res.body.refundCorrections, 1);
    assert.equal(telegramBodies.length, 2);
    assert.match(telegramBodies[1], /방금 브리핑.*환불 확인 중.*발주·배송 금지/s);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a skipped reconciliation records detail without advancing last_success_at", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["CRON_SECRET", "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const heartbeatRows = [];
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/first_bundle_runtime" && method === "POST") {
        heartbeatRows.push(JSON.parse(options.body));
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") {
        return Response.json({ code: "PGRST205", message: "table payment_intents was not found" }, { status: 404 });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?mode=reconcile",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.skipped, true);
    assert.equal(heartbeatRows.length, 2);
    assert.equal(Object.hasOwn(heartbeatRows[0], "last_success_at"), false);
    assert.equal(Object.hasOwn(heartbeatRows[0], "last_error"), false, "a start marker must preserve the previous failure until real success");
    assert.equal(Object.hasOwn(heartbeatRows[1], "last_success_at"), false);
    assert.equal(heartbeatRows[1].last_error, "intent_table_unavailable");
    assert.deepEqual(heartbeatRows[1].details, { reason: "intent_table_unavailable", skipped: true });
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a runtime heartbeat write failure is visible in the reconciliation cron response", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["CRON_SECRET", "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let heartbeatWrites = 0, intentQueries = 0;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/first_bundle_runtime" && method === "POST") {
        heartbeatWrites++;
        return Response.json({ message: "write failed" }, { status: 500 });
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") {
        intentQueries++;
        return Response.json([]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?mode=reconcile",
    }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, "runtime_heartbeat_write_failed");
    assert.equal(res.body.reconciliationOk, true);
    assert.deepEqual(res.body.heartbeat, { started: false, completed: false });
    assert.equal(heartbeatWrites, 2);
    assert.equal(intentQueries, 5);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("reconciliation recovers a DONE payment whose key was not stored before function exit", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "CRON_SECRET", "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-RECOVER1";
  const orderData = {
    productCode: "congrats_g1", productLabel: "축하화환", price: priceOf("congrats_g1"),
    quantity: 1, toppings: [], address: "경기 시흥시 신천3길 23",
    venue: "꽃안부웨딩홀", senderName: "이꽃", senderPhone: "01012345678",
  };
  const intent = {
    order_id: oid, state: "confirming", expected_amount: priceOf("congrats_g1"),
    order_data: orderData, order_hash: orderHash(orderData), payment_key: null,
    finalized_at: null, notified_at: null, alert_sent_at: null, last_checked_at: null,
    created_at: "2098-12-31T00:00:00.000Z", updated_at: "2098-12-31T00:00:00.000Z",
  };
  const orders = new Map();
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") {
        const state = url.searchParams.get("state") || "";
        return Response.json(state === "in.(confirming,paid)" ? [intent] : []);
      }
      if (url.pathname === "/rest/v1/first_bundle_runtime" && method === "POST") {
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const expectedUpdated = url.searchParams.get("updated_at")?.replace(/^eq\./, "");
        const wantsNullKey = url.searchParams.get("payment_key") === "is.null";
        if ((expectedUpdated && expectedUpdated !== intent.updated_at) || (wantsNullKey && intent.payment_key)) {
          return Response.json([]);
        }
        Object.assign(intent, JSON.parse(options.body));
        return Response.json([intent]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        return Response.json({
          orderId: oid, paymentKey: "pay_recovered", totalAmount: priceOf("congrats_g1"),
          status: "DONE", method: "카드", approvedAt: "2099-01-01T09:00:00+09:00",
          receipt: { url: "https://receipt.example.test/recovered" },
        });
      }
      if (url.pathname === "/rest/v1/orders" && method === "POST") {
        const row = JSON.parse(options.body);
        if (!orders.has(row.order_id)) orders.set(row.order_id, row);
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const row = orders.get(oid);
        if (!row) return Response.json([]);
        Object.assign(row, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?mode=reconcile",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.recovered, 1);
    assert.equal(intent.payment_key, "pay_recovered");
    assert.equal(intent.state, "finalized");
    assert.equal(orders.size, 1);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("reconciliation stops retrying a permanent Toss cancel rejection and retains the hold", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "CRON_SECRET", "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-CRON4XX";
  const amount = 78000;
  const paymentKey = "pay_cron_cancel_permanent";
  const orderData = { productLabel: "축하화환", productCode: "congrats_g1" };
  const intent = {
    order_id: oid, state: "canceling", expected_amount: amount, order_data: orderData,
    order_hash: orderHash(orderData), payment_key: paymentKey, toss_status: "DONE",
    finalized_at: "2098-12-31T00:00:00.000Z", finalization_error: "cancel_order_sync_pending",
    alert_sent_at: null, sms_alerted_at: null, telegram_alerted_at: null,
    sms_alert_lease_until: null, telegram_alert_lease_until: null,
    last_checked_at: null, created_at: "2098-12-31T00:00:00.000Z", updated_at: "2098-12-31T00:00:00.000Z",
  };
  const order = { order_id: oid, cancel_requested_at: "2099-01-01T00:00:00.000Z" };
  let cancelPosts = 0, telegramCalls = 0;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    delete process.env.SOLAPI_API_KEY;
    delete process.env.SOLAPI_API_SECRET;
    delete process.env.SOLAPI_SENDER;
    delete process.env.OWNER_PHONE_1;
    delete process.env.OWNER_PHONE_2;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/first_bundle_runtime" && method === "POST") {
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") {
        const state = url.searchParams.get("state") || "";
        const error = url.searchParams.get("finalization_error") || "";
        return Response.json(state === "in.(canceling,canceled)" && error === "eq.cancel_order_sync_pending"
          ? [{ ...intent }] : []);
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        const stateFilter = url.searchParams.get("state");
        if (stateFilter === "eq.canceling" && intent.state !== "canceling") return Response.json([]);
        if (stateFilter === "eq.finalized" && intent.state !== "finalized") return Response.json([]);
        Object.assign(intent, patch);
        return Response.json([{ ...intent }]);
      }
      if (url.pathname === "/rest/v1/rpc/begin_order_cancellation" && method === "POST") {
        const body = JSON.parse(options.body);
        assert.equal(body.p_order_hash, intent.order_hash);
        assert.equal(body.p_hold_only, false);
        intent.state = body.p_already_canceled ? "canceled" : "canceling";
        intent.toss_status = body.p_already_canceled ? "CANCELED" : body.p_toss_status;
        intent.finalization_error = "cancel_order_sync_pending";
        order.cancel_requested_at ||= new Date().toISOString();
        return Response.json([{
          result: body.p_already_canceled ? "already_canceled" : "started",
          lease_until: null,
        }]);
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        Object.assign(order, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        return Response.json({ orderId: oid, paymentKey, totalAmount: amount, status: "DONE" });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/${paymentKey}/cancel`) {
        cancelPosts++;
        return Response.json({ code: "NOT_CANCELABLE" }, { status: 403 });
      }
      if (url.hostname === "api.telegram.org") {
        telegramCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?mode=reconcile",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(cancelPosts, 1);
    assert.equal(intent.state, "finalized");
    assert.equal(intent.finalization_error, "cancel_manual_review_403");
    assert.ok(order.cancel_requested_at, "manual review must keep fulfillment blocked");
    assert.equal(telegramCalls, 1);
    assert.equal(res.body.failed, 1);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("manual-review reconciliation detects a later dashboard cancellation and closes the order", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "CRON_SECRET", "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-MANUAL1";
  const amount = 78000;
  const paymentKey = "pay_manual_canceled";
  const orderData = { productLabel: "축하화환", productCode: "congrats_g1" };
  const intent = {
    order_id: oid, state: "finalized", expected_amount: amount, order_data: orderData,
    order_hash: orderHash(orderData), payment_key: paymentKey, toss_status: "DONE",
    finalized_at: "2098-12-31T00:00:00.000Z", finalization_error: "cancel_manual_review_403",
    notified_at: "2098-12-31T00:00:00.000Z", alert_sent_at: "2099-01-01T00:00:00.000Z",
    sms_alerted_at: "2099-01-01T00:00:00.000Z", telegram_alerted_at: "2099-01-01T00:00:00.000Z",
    last_checked_at: "2098-12-31T00:00:00.000Z", created_at: "2098-12-31T00:00:00.000Z",
    updated_at: "2098-12-31T00:00:00.000Z",
  };
  const order = { order_id: oid, status: "new", cancel_requested_at: null };
  let tossLookups = 0, cancelPosts = 0;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.TOSS_SECRET_KEY = "toss-test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    for (const key of envKeys.slice(4)) delete process.env[key];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/first_bundle_runtime" && method === "POST") {
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") {
        const state = url.searchParams.get("state") || "";
        const error = url.searchParams.get("finalization_error") || "";
        return Response.json(state === "eq.finalized" && error === "like.cancel_manual_review_*"
          ? [{ ...intent }] : []);
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        Object.assign(intent, JSON.parse(options.body));
        return Response.json([{ ...intent }]);
      }
      if (url.pathname === "/rest/v1/rpc/begin_order_cancellation" && method === "POST") {
        const body = JSON.parse(options.body);
        assert.equal(body.p_hold_only, true);
        assert.equal(body.p_order_hash, intent.order_hash);
        order.cancel_requested_at ||= new Date().toISOString();
        return Response.json([{ result: "held", lease_until: null }]);
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        Object.assign(order, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        tossLookups++;
        return Response.json({
          orderId: oid, paymentKey, totalAmount: amount, balanceAmount: 0, status: "CANCELED",
          cancels: [{ cancelAmount: amount, canceledAt: "2099-01-01T03:00:00+09:00" }],
        });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname.endsWith("/cancel")) {
        cancelPosts++;
        return Response.json({}, { status: 500 });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await checkDeadlines({
      method: "GET", headers: { authorization: "Bearer cron-test-secret" },
      url: "/api/check-deadlines?mode=reconcile",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(tossLookups, 1);
    assert.equal(cancelPosts, 0, "manual-review reconciliation only observes; it never repeats cancellation");
    assert.equal(order.status, "canceled");
    assert.equal(order.cancel_requested_at, null);
    assert.equal(intent.state, "canceled");
    assert.equal(intent.finalization_error, null);
    assert.equal(res.body.canceledSynced, 1);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("a confirming retry looks up the old DONE payment before approving a new key", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENT_INTENTS_REQUIRED",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-OLDPAY1";
  const amount = priceOf("congrats_g1");
  const orderData = {
    productCode: "congrats_g1", productLabel: "축하화환", price: amount,
    quantity: 1, toppings: [], address: "경기 시흥시 신천3길 23", venue: "꽃안부웨딩홀",
    senderName: "이꽃", senderPhone: "01012345678",
  };
  const intent = {
    order_id: oid, state: "confirming", expected_amount: amount,
    order_data: orderData, order_hash: orderHash(orderData), payment_key: null,
    confirm_attempt_hash: paymentAttemptHash("pay_old_done"),
    confirm_lease_until: new Date(Date.now() + 60000).toISOString(),
    expires_at: new Date(Date.now() + 600000).toISOString(), created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), notified_at: null, alert_sent_at: null,
  };
  let confirmPosts = 0;
  const orders = new Map();
  try {
    process.env.TOSS_SECRET_KEY = "test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PAYMENT_INTENTS_REQUIRED = "1";
    for (const key of envKeys.slice(4)) delete process.env[key];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([intent]);
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        Object.assign(intent, JSON.parse(options.body));
        return Response.json([intent]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        return Response.json({
          orderId: oid, paymentKey: "pay_old_done", totalAmount: amount, status: "DONE",
          method: "카드", approvedAt: "2099-01-01T08:00:00+09:00",
        });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") {
        confirmPosts++;
        return Response.json({}, { status: 500 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "POST") {
        const row = JSON.parse(options.body);
        if (!orders.has(row.order_id)) orders.set(row.order_id, row);
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const row = orders.get(oid);
        if (!row) return Response.json([]);
        Object.assign(row, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: {
      paymentKey: "pay_old_done", orderId: oid, amount,
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payment.orderId, oid);
    assert.equal(confirmPosts, 0, "the retry must not risk a second approval");
    assert.equal(intent.payment_key, "pay_old_done");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("an expired confirming lease resumes only the same payment attempt after a Toss 404", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENT_INTENTS_REQUIRED",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-LEASE01";
  const amount = priceOf("congrats_g1");
  const paymentKey = "pay_same_crashed_attempt";
  const orderData = {
    productCode: "congrats_g1", productLabel: "축하화환", price: amount,
    quantity: 1, toppings: [], address: "경기 시흥시 신천3길 23", venue: "꽃안부웨딩홀",
    senderName: "이꽃", senderPhone: "01012345678",
  };
  const intent = {
    order_id: oid, state: "confirming", expected_amount: amount,
    order_data: orderData, order_hash: orderHash(orderData), payment_key: null,
    confirm_attempt_hash: paymentAttemptHash(paymentKey),
    confirm_lease_until: new Date(Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 600000).toISOString(), created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), notified_at: null, alert_sent_at: null,
  };
  const orders = new Map();
  let confirmPosts = 0, lookupCalls = 0;
  try {
    process.env.TOSS_SECRET_KEY = "test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PAYMENT_INTENTS_REQUIRED = "1";
    for (const key of envKeys.slice(4)) delete process.env[key];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([{ ...intent }]);
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        const stateFilter = url.searchParams.get("state");
        const attemptFilter = url.searchParams.get("confirm_attempt_hash");
        const leaseFilter = url.searchParams.get("confirm_lease_until");
        if (stateFilter === "eq.confirming" && intent.state !== "confirming") return Response.json([]);
        if (attemptFilter && attemptFilter.replace(/^eq\./, "") !== intent.confirm_attempt_hash) return Response.json([]);
        if (leaseFilter && Date.parse(intent.confirm_lease_until) > Date.parse(leaseFilter.replace(/^lte\./, ""))) return Response.json([]);
        Object.assign(intent, patch);
        return Response.json([{ ...intent }]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        lookupCalls++;
        return Response.json({ code: "NOT_FOUND" }, { status: 404 });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") {
        confirmPosts++;
        return Response.json({
          orderId: oid, paymentKey, totalAmount: amount, status: "DONE", method: "카드",
          approvedAt: "2099-01-01T08:00:00+09:00",
        });
      }
      if (url.pathname === "/rest/v1/orders" && method === "POST") {
        const row = JSON.parse(options.body);
        if (!orders.has(row.order_id)) orders.set(row.order_id, row);
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const row = orders.get(oid);
        if (!row) return Response.json([]);
        Object.assign(row, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: { paymentKey, orderId: oid, amount } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(lookupCalls, 1);
    assert.equal(confirmPosts, 1);
    assert.equal(intent.payment_key, paymentKey);
    assert.equal(intent.state, "finalized");
    assert.equal(intent.confirm_lease_until, null);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("an active confirming lease never repeats the Toss approval POST", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENT_INTENTS_REQUIRED"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-LEASE02";
  const amount = priceOf("congrats_g1");
  const paymentKey = "pay_active_lease";
  const orderData = { productCode: "congrats_g1", price: amount };
  const intent = {
    order_id: oid, state: "confirming", expected_amount: amount, order_data: orderData,
    order_hash: orderHash(orderData), payment_key: null, confirm_attempt_hash: paymentAttemptHash(paymentKey),
    confirm_lease_until: new Date(Date.now() + 60000).toISOString(),
    expires_at: new Date(Date.now() + 600000).toISOString(), created_at: new Date().toISOString(),
  };
  let confirmPosts = 0;
  try {
    process.env.TOSS_SECRET_KEY = "test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PAYMENT_INTENTS_REQUIRED = "1";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([intent]);
      if (url.hostname === "api.tosspayments.com" && url.pathname === `/v1/payments/orders/${oid}`) {
        return Response.json({ code: "NOT_FOUND" }, { status: 404 });
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") {
        confirmPosts++;
        return Response.json({}, { status: 500 });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const res = mockResponse();
    await confirmPayment({ method: "POST", headers: {}, body: { paymentKey, orderId: oid, amount } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.pending, true);
    assert.equal(res.body.code, "PAYMENT_CONFIRM_IN_PROGRESS");
    assert.equal(confirmPosts, 0);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("concurrent confirmations for one prepared order allow only one Toss approval POST", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "TOSS_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYMENT_INTENTS_REQUIRED",
    "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "OWNER_PHONE_1", "OWNER_PHONE_2",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-RACE001";
  const amount = priceOf("congrats_g1");
  const orderData = {
    productCode: "congrats_g1", productLabel: "축하화환", price: amount, quantity: 1, toppings: [],
    address: "경기 시흥시 신천3길 23", venue: "꽃안부웨딩홀", senderName: "이꽃", senderPhone: "01012345678",
  };
  const intent = {
    order_id: oid, state: "prepared", expected_amount: amount,
    order_data: orderData, order_hash: orderHash(orderData), payment_key: null,
    expires_at: new Date(Date.now() + 600000).toISOString(), created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), notified_at: null, alert_sent_at: null,
  };
  let confirmPosts = 0;
  let releaseConfirm;
  const confirmGate = new Promise((resolve) => { releaseConfirm = resolve; });
  const orders = new Map();
  try {
    process.env.TOSS_SECRET_KEY = "test-secret";
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PAYMENT_INTENTS_REQUIRED = "1";
    for (const key of envKeys.slice(4)) delete process.env[key];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([{ ...intent }]);
      if (url.pathname === "/rest/v1/payment_intents" && method === "PATCH") {
        const stateFilter = url.searchParams.get("state") || "";
        if (stateFilter === "in.(prepared,failed)" && intent.state !== "prepared" && intent.state !== "failed") {
          return Response.json([]);
        }
        Object.assign(intent, JSON.parse(options.body));
        return Response.json([{ ...intent }]);
      }
      if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") {
        confirmPosts++;
        const body = JSON.parse(options.body);
        await confirmGate;
        return Response.json({
          orderId: oid, paymentKey: body.paymentKey, totalAmount: amount, status: "DONE",
          method: "카드", approvedAt: "2099-01-01T08:00:00+09:00",
        });
      }
      if (url.pathname === "/rest/v1/orders" && method === "POST") {
        const row = JSON.parse(options.body);
        if (!orders.has(row.order_id)) orders.set(row.order_id, row);
        return new Response("", { status: 201 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const row = orders.get(oid);
        if (!row) return Response.json([]);
        Object.assign(row, JSON.parse(options.body));
        return Response.json([{ order_id: oid }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const req = (paymentKey) => ({ method: "POST", headers: {}, body: { paymentKey, orderId: oid, amount } });
    const firstRes = mockResponse(), secondRes = mockResponse();
    const first = confirmPayment(req("pay_race_first"), firstRes);
    // first request reaches Toss and waits; second sees confirming and must not POST.
    await new Promise((resolve) => setImmediate(resolve));
    const second = confirmPayment(req("pay_race_second"), secondRes);
    await new Promise((resolve) => setImmediate(resolve));
    releaseConfirm();
    await Promise.all([first, second]);
    assert.equal(confirmPosts, 1);
    assert.equal(firstRes.statusCode, 200);
    assert.equal(secondRes.statusCode, 409);
    assert.equal(secondRes.body.code, "PAYMENT_ATTEMPT_MISMATCH");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("driver photo link is one-use and guest photo proxy enforces delivered state", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "PHOTO_UPLOAD_SECRET",
    "ADMIN_AUTH_MODE", "ADMIN_PASSWORD", "ANTHROPIC_API_KEY", "SOLAPI_API_KEY",
    "SOLAPI_API_SECRET", "SOLAPI_SENDER", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oid = "AF-20990101-PHOTO1";
  const order = {
    order_id: oid,
    status: "new",
    canceled_at: null,
    cancel_requested_at: null,
    completed_photo: null,
    photo_notice_lease_until: null,
    sender_phone: null,
    orderer_phone: null,
    product_label: "축하화환",
  };
  let storageWrites = 0;
  try {
    process.env.SUPABASE_URL = "https://project.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.PHOTO_UPLOAD_SECRET = "photo-test-secret-with-enough-entropy";
    process.env.ADMIN_AUTH_MODE = "jwt";
    for (const key of envKeys.slice(5)) delete process.env[key];

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        return Response.json([order]);
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") {
        return Response.json([]);
      }
      if (url.pathname === "/rest/v1/rpc/claim_order_photo_notice" && method === "POST") {
        const body = JSON.parse(options.body);
        if (order.cancel_requested_at || order.canceled_at || order.status === "canceled") {
          return Response.json([{ result: "cancel_in_progress", lease_until: null }]);
        }
        if (order.photo_notice_lease_until && Date.parse(order.photo_notice_lease_until) > Date.now()) {
          return Response.json([{ result: "photo_notice_busy", lease_until: order.photo_notice_lease_until }]);
        }
        Object.assign(order, {
          photo_access_token_hash: body.p_token_hash,
          photo_access_expires_at: body.p_access_expires_at,
          photo_notice_status: "pending",
          photo_notice_photo: body.p_photo_path,
          photo_notice_lease_until: body.p_lease_until,
        });
        return Response.json([{ result: "claimed", lease_until: body.p_lease_until }]);
      }
      if (url.pathname === "/rest/v1/rpc/finish_order_photo_notice" && method === "POST") {
        const body = JSON.parse(options.body);
        if (order.photo_notice_lease_until !== body.p_lease_until) {
          return Response.json([{ result: "lease_lost", lease_until: order.photo_notice_lease_until }]);
        }
        Object.assign(order, {
          photo_notice_status: body.p_notice_status,
          photo_notified_at: body.p_notified_at,
          photo_notice_lease_until: null,
        });
        return Response.json([{ result: "finished", lease_until: null }]);
      }
      if (url.pathname.startsWith("/storage/v1/object/order-photos/") && method === "POST") {
        storageWrites++;
        return new Response("", { status: 200 });
      }
      if (url.pathname.startsWith("/storage/v1/object/order-photos/") && method === "DELETE") {
        return new Response("", { status: 200 });
      }
      if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
        const patch = JSON.parse(options.body);
        if (patch.completed_photo) Object.assign(order, patch);
        return Response.json([{ order_id: oid }]);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = signUploadToken(oid, expiresAt, process.env.PHOTO_UPLOAD_SECRET);
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString("base64");
    const uploadRes = mockResponse();
    await orderPhoto({
      method: "POST",
      headers: {},
      body: { orderId: oid, expiresAt, token, imageBase64: `data:image/jpeg;base64,${jpeg}` },
    }, uploadRes);
    assert.equal(uploadRes.statusCode, 200);
    assert.equal(uploadRes.body.notice.status, "skipped");
    assert.equal(order.status, "delivered");
    assert.match(order.completed_photo, new RegExp(`^${oid}/`));

    const replayRes = mockResponse();
    await orderPhoto({
      method: "POST",
      headers: {},
      body: { orderId: oid, expiresAt, token, imageBase64: `data:image/jpeg;base64,${jpeg}` },
    }, replayRes);
    assert.equal(replayRes.statusCode, 409);
    assert.equal(storageWrites, 1, "replayed driver link must not create another object");

    const guest = createGuestAccess({ ttlSeconds: 3600 });
    order.photo_access_token_hash = guest.tokenHash;
    order.photo_access_expires_at = guest.expiresAt;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.pathname === "/rest/v1/orders" && method === "GET") {
        const requested = url.searchParams.get("photo_access_token_hash")?.replace(/^eq\./, "");
        return Response.json(requested === guest.tokenHash ? [{
          completed_photo: order.completed_photo,
          status: order.status,
          canceled_at: order.canceled_at,
          photo_access_expires_at: order.photo_access_expires_at,
          order_id: oid,
        }] : []);
      }
      if (url.pathname === "/rest/v1/payment_intents" && method === "GET") return Response.json([]);
      if (url.pathname.startsWith("/storage/v1/object/order-photos/") && method === "GET") {
        return new Response(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]), { status: 200, headers: { "Content-Length": "4" } });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const viewRes = mockResponse();
    await orderPhotoView({ method: "POST", headers: {}, body: { token: guest.token } }, viewRes);
    assert.equal(viewRes.statusCode, 200);
    assert.equal(viewRes.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.isBuffer(viewRes.body), true);

    order.canceled_at = new Date().toISOString();
    const canceledRes = mockResponse();
    await orderPhotoView({ method: "POST", headers: {}, body: { token: guest.token } }, canceledRes);
    assert.equal(canceledRes.statusCode, 404, "canceled orders must never serve a delivery photo");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("initial photo notice and manual resend share one atomic lease", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PUBLIC_BASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const state = { lease: null, tokenHash: null };
  let smsCalls = 0;
  let releaseSms;
  let announceSms;
  const smsGate = new Promise((resolve) => { releaseSms = resolve; });
  const smsStarted = new Promise((resolve) => { announceSms = resolve; });
  try {
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    process.env.PUBLIC_BASE_URL = "https://floweranbu.example.test";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.pathname === "/rest/v1/rpc/claim_order_photo_notice") {
        if (state.lease && Date.parse(state.lease) > Date.now()) {
          return Response.json([{ result: "photo_notice_busy", lease_until: state.lease }]);
        }
        state.lease = body.p_lease_until;
        state.tokenHash = body.p_token_hash;
        return Response.json([{ result: "claimed", lease_until: state.lease }]);
      }
      if (url.pathname === "/rest/v1/rpc/finish_order_photo_notice") {
        if (state.lease !== body.p_lease_until) return Response.json([{ result: "lease_lost", lease_until: state.lease }]);
        state.lease = null;
        return Response.json([{ result: "finished", lease_until: null }]);
      }
      if (url.hostname === "api.solapi.com") {
        smsCalls++;
        announceSms();
        await smsGate;
        return Response.json({ groupInfo: { count: { registeredSuccess: 1, registeredFailed: 0 } } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const args = {
      order: { sender_phone: "01012345678" },
      oid: "AF-20990101-PHOTO-RACE-A",
      path: "AF-20990101-PHOTO-RACE-A/photo.jpg",
      supabaseUrl: "https://project.example.test",
      serviceKey: "service-test-key",
    };
    const first = refreshGuestAccessAndNotify(args);
    await smsStarted;
    const firstTokenHash = state.tokenHash;
    const second = await refreshGuestAccessAndNotify(args);
    assert.equal(second.error, "photo_notice_busy");
    assert.equal(state.tokenHash, firstTokenHash, "losing resend must not rotate the link token");
    assert.equal(smsCalls, 1, "only the lease owner may call SOLAPI");
    releaseSms();
    const sent = await first;
    assert.equal(sent.sent, true);
    assert.equal(sent.stateSaved, true);
    assert.equal(state.lease, null);
  } finally {
    releaseSms();
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("refund start cannot cross an active photo-notice lease", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PUBLIC_BASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const state = { lease: null, cancelRequested: false, intentState: "finalized" };
  let releaseSms;
  let announceSms;
  const smsGate = new Promise((resolve) => { releaseSms = resolve; });
  const smsStarted = new Promise((resolve) => { announceSms = resolve; });
  try {
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    process.env.PUBLIC_BASE_URL = "https://floweranbu.example.test";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.pathname === "/rest/v1/rpc/claim_order_photo_notice") {
        if (state.cancelRequested || state.intentState === "canceling") {
          return Response.json([{ result: "cancel_in_progress", lease_until: null }]);
        }
        if (state.lease && Date.parse(state.lease) > Date.now()) {
          return Response.json([{ result: "photo_notice_busy", lease_until: state.lease }]);
        }
        state.lease = body.p_lease_until;
        return Response.json([{ result: "claimed", lease_until: state.lease }]);
      }
      if (url.pathname === "/rest/v1/rpc/finish_order_photo_notice") {
        if (state.lease !== body.p_lease_until) return Response.json([{ result: "lease_lost", lease_until: state.lease }]);
        state.lease = null;
        return Response.json([{ result: "finished", lease_until: null }]);
      }
      if (url.pathname === "/rest/v1/rpc/begin_order_cancellation") {
        if (state.lease && Date.parse(state.lease) > Date.now()) {
          return Response.json([{ result: "photo_notice_busy", lease_until: state.lease }]);
        }
        state.cancelRequested = true;
        state.intentState = "canceling";
        return Response.json([{ result: "started", lease_until: null }]);
      }
      if (url.hostname === "api.solapi.com") {
        announceSms();
        await smsGate;
        return Response.json({ groupInfo: { count: { registeredSuccess: 1, registeredFailed: 0 } } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const oid = "AF-20990101-PHOTO-RACE-B";
    const send = refreshGuestAccessAndNotify({
      order: { sender_phone: "01012345678" }, oid,
      path: `${oid}/photo.jpg`, supabaseUrl: "https://project.example.test", serviceKey: "service-test-key",
    });
    await smsStarted;
    const orderData = { productLabel: "축하화환" };
    const cancellationArgs = {
      supabaseUrl: "https://project.example.test", serviceKey: "service-test-key",
      orderId: oid, paymentKey: "pay_photo_race", expectedAmount: 78000,
      orderData, orderHash: orderHash(orderData), tossStatus: "DONE",
    };
    const blocked = await beginOrderCancellation(cancellationArgs);
    assert.equal(blocked.result, "photo_notice_busy");
    assert.equal(state.intentState, "finalized", "busy result must not create a canceling outbox");
    assert.equal(state.cancelRequested, false);

    releaseSms();
    await send;
    const started = await beginOrderCancellation(cancellationArgs);
    assert.equal(started.result, "started");
    assert.equal(state.intentState, "canceling");
    assert.equal(state.cancelRequested, true);
  } finally {
    releaseSms();
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("an uncertain SOLAPI result keeps the photo lease instead of racing refund or resend", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PUBLIC_BASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let lease = null;
  let finishCalls = 0;
  try {
    process.env.SOLAPI_API_KEY = "api-test";
    process.env.SOLAPI_API_SECRET = "secret-test";
    process.env.SOLAPI_SENDER = "0313143003";
    process.env.PUBLIC_BASE_URL = "https://floweranbu.example.test";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.pathname === "/rest/v1/rpc/claim_order_photo_notice") {
        lease = body.p_lease_until;
        return Response.json([{ result: "claimed", lease_until: lease }]);
      }
      if (url.pathname === "/rest/v1/rpc/finish_order_photo_notice") {
        finishCalls++;
        return Response.json([{ result: "finished", lease_until: null }]);
      }
      if (url.hostname === "api.solapi.com") return Response.json({ message: "temporary upstream error" }, { status: 500 });
      throw new Error(`unexpected fetch ${url}`);
    };

    const oid = "AF-20990101-PHOTO-UNCERTAIN";
    const result = await refreshGuestAccessAndNotify({
      order: { sender_phone: "01012345678" },
      oid,
      path: `${oid}/photo.jpg`,
      supabaseUrl: "https://project.example.test",
      serviceKey: "service-test-key",
    });
    assert.equal(result.status, "pending");
    assert.equal(result.uncertain, true);
    assert.equal(finishCalls, 0, "an ambiguous provider result must not release the lease early");
    assert.ok(Date.parse(lease) > Date.now() + 8 * 60000);
    assert.equal(result.guestToken, undefined, "manual fallback must not create a possible duplicate send");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});

test("manual photo notice mode never calls SOLAPI and gives the owner a forwardable link", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ["PHOTO_NOTICE_MODE", "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER", "PUBLIC_BASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let solapiCalls = 0;
  let telegramText = "";
  try {
    process.env.PHOTO_NOTICE_MODE = "manual";
    process.env.SOLAPI_API_KEY = "configured-but-disabled";
    process.env.SOLAPI_API_SECRET = "configured-but-disabled";
    process.env.SOLAPI_SENDER = "0313143003";
    process.env.PUBLIC_BASE_URL = "https://floweranbu.example.test";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test";
    process.env.TELEGRAM_CHAT_ID = "chat-test";
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.pathname === "/rest/v1/rpc/claim_order_photo_notice") {
        return Response.json([{ result: "claimed", lease_until: body.p_lease_until }]);
      }
      if (url.pathname === "/rest/v1/rpc/finish_order_photo_notice") {
        assert.equal(body.p_notice_status, "skipped");
        assert.equal(body.p_error, "manual_mode");
        return Response.json([{ result: "finished", lease_until: null }]);
      }
      if (url.hostname === "api.solapi.com") {
        solapiCalls++;
        return Response.json({});
      }
      if (url.hostname === "api.telegram.org") {
        telegramText = body.text || "";
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const oid = "AF-20990101-PHOTO-MANUAL";
    const result = await refreshGuestAccessAndNotify({
      order: { sender_phone: "01012345678" }, oid, path: `${oid}/photo.jpg`,
      supabaseUrl: "https://project.example.test", serviceKey: "service-test-key",
    });
    assert.equal(result.status, "skipped");
    assert.equal(solapiCalls, 0);
    assert.match(telegramText, /delivery-photo\.html#t=/);
    assert.ok(result.guestToken, "admin fallback must still be available");
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv(oldEnv);
  }
});
