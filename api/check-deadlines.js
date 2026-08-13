// api/check-deadlines.js
// 식/발인이 임박했거나 이미 지났는데 아직 '배송완료'가 안 된 주문을 찾아 사장님 텔레그램으로 경고한다.
// Supabase pg_cron 이 주기적으로(예: 30분마다) Authorization 헤더로 이 엔드포인트를 호출한다.
// 보호: CRON_SECRET (Authorization: Bearer <secret>). 미설정/불일치면 401.

import crypto from "node:crypto";

import { askClaude } from "../lib/ai.mjs";
import { notifyPaymentIntentWithLease } from "./confirm-payment.js";
import {
  cancelManualReviewReason,
  fetchJsonWithTimeout,
  isIntentUnavailable,
  isRetryableTossHttpStatus,
  orderHash,
  patchPaymentIntent,
  serviceHeaders,
  upsertPaidOrder,
  verifyCanceledPayment,
  verifyDonePayment,
} from "../lib/payment-integrity.mjs";
import { beginOrderCancellation } from "../lib/order-coordination.mjs";

export const config = { runtime: "nodejs" };

const ALERT_WINDOW_HOURS = 3;  // 행사 N시간 전부터 경고
const GRACE_PAST_HOURS = 24;   // 행사 지났어도 24h까지는 미배송이면 계속 경고(놓침 방지)

function safeEq(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: tag + text, disable_web_page_preview: true }),
      signal: ac.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── 결제 대사·자동복구 ─────────────────────────────────────
// 승인 직후 orders 저장이 실패했거나 브라우저가 끊긴 건을 payment_intents와
// 토스 원장(orderId 조회)으로 다시 맞춘다. 새 API 파일을 만들지 않고 이 크론에 모드를 추가한다.
async function runPaymentReconciliation(SUPABASE_URL, SERVICE_KEY) {
  const reconciliationStartedAt = Date.now();
  const tossSecret = process.env.TOSS_SECRET_KEY;
  if (!tossSecret) return { ok: false, reason: "toss_env_missing" };
  // 정상 confirm 함수가 주문저장·문자까지 끝낼 시간을 준다. 바로 건드리면 크론이
  // 같은 행을 만지는 것을 피하도록 2분 이상 멈춘 건만 복구한다.
  const staleBefore = new Date(Date.now() - 2 * 60000).toISOString();
  const select = [
    "order_id", "state", "expected_amount", "order_data", "order_hash", "payment_key",
    "toss_status", "payment_method", "approved_at", "receipt_url", "paid_at",
    "finalized_at", "notified_at", "alert_sent_at",
    "sms_notified_at", "telegram_notified_at", "sms_alerted_at", "telegram_alerted_at",
    "sms_notice_lease_until", "telegram_notice_lease_until", "sms_alert_lease_until", "telegram_alert_lease_until",
    "confirm_attempt_hash", "confirm_lease_until",
    "last_checked_at", "created_at", "updated_at",
  ].join(",");
  const base = `${SUPABASE_URL}/rest/v1/payment_intents?select=${select}`
    + `&updated_at=lt.${encodeURIComponent(staleBefore)}`
    + `&order=last_checked_at.asc.nullsfirst,updated_at.asc&limit=2`;
  // 외부 사용자가 반복할 수 있는 일반 카드 거절·만료는 운영자 긴급알림 대상이 아니다.
  // 실제로 수동 확인이 필요한 서버 원장 무결성 실패만 엄격한 allowlist로 잡는다.
  const criticalFailedReasons = ["intent_integrity_error"];
  const criticalReasonFilter = criticalFailedReasons.map(encodeURIComponent).join(",");
  let recoveryRows = [], noticeRows = [], cancelRows = [], failedAlertRows = [], manualCancelRows = [];
  try {
    const [recovery, notices, cancellations, failedAlerts, manualCancellations] = await Promise.all([
      fetchJsonWithTimeout(`${base}&state=in.(confirming,paid)&finalized_at=is.null`,
        { headers: serviceHeaders(SERVICE_KEY) }, 3000),
      fetchJsonWithTimeout(`${base}&state=eq.finalized&notified_at=is.null&finalization_error=is.null`,
        { headers: serviceHeaders(SERVICE_KEY) }, 3000),
      fetchJsonWithTimeout(`${base}&state=in.(canceling,canceled)&finalization_error=eq.cancel_order_sync_pending`,
        { headers: serviceHeaders(SERVICE_KEY) }, 3000),
      fetchJsonWithTimeout(`${base}&state=eq.failed&alert_sent_at=is.null&finalization_error=in.(${criticalReasonFilter})`,
        { headers: serviceHeaders(SERVICE_KEY) }, 3000),
      // 수동 취소는 알림 완료 후에도 토스 원장을 계속 확인해야 한다. 관리자가
      // 상점관리자에서 취소를 끝내면 다음 대사가 orders까지 자동 종결한다.
      fetchJsonWithTimeout(`${base}&state=eq.finalized&finalization_error=like.cancel_manual_review_*`,
        { headers: serviceHeaders(SERVICE_KEY) }, 3000),
    ]);
    for (const out of [recovery, notices, cancellations, failedAlerts, manualCancellations]) {
      if (!out.response.ok) {
        if (isIntentUnavailable(out.response.status, out.text)) {
          return { ok: true, skipped: true, reason: "intent_table_unavailable" };
        }
        return { ok: false, reason: "intent_query_failed" };
      }
    }
    recoveryRows = Array.isArray(recovery.data) ? recovery.data : [];
    noticeRows = Array.isArray(notices.data) ? notices.data : [];
    cancelRows = Array.isArray(cancellations.data) ? cancellations.data : [];
    failedAlertRows = Array.isArray(failedAlerts.data) ? failedAlerts.data : [];
    manualCancelRows = Array.isArray(manualCancellations.data) ? manualCancellations.data : [];
  } catch {
    return { ok: false, reason: "intent_query_exception" };
  }

  const basicAuth = Buffer.from(`${tossSecret}:`).toString("base64");
  let recovered = 0, pending = 0, failed = 0, alerted = 0, notified = 0, canceledSynced = 0;

  const lookupToss = async (oid) => {
    try {
      return await fetchJsonWithTimeout(
        `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(oid)}`,
        { headers: { Authorization: `Basic ${basicAuth}` } }, 2500
      );
    } catch { return null; }
  };

  const resumeTossCancellation = async (intent, payment) => {
    if (!payment || !payment.paymentKey || !["DONE", "PARTIAL_CANCELED"].includes(payment.status)) {
      return { payment, permanentStatus: null };
    }
    try {
      const canceled = await fetchJsonWithTimeout(
        `https://api.tosspayments.com/v1/payments/${encodeURIComponent(payment.paymentKey)}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            // 관리자 취소 호출과 같은 키. 함수가 어느 지점에서 종료됐든 한 논리 취소로 재개한다.
            "Idempotency-Key": `cancel-${intent.order_id}`,
          },
          body: JSON.stringify({ cancelReason: "가게 취소(환불)" }),
        }, 3500
      );
      if (canceled.response.ok) return { payment: canceled.data, permanentStatus: null };
      if (!isRetryableTossHttpStatus(canceled.response.status)) {
        return { payment, permanentStatus: canceled.response.status };
      }
    } catch { /* 결과 불명확 → 바로 아래 원장 재조회 */ }
    const looked = await lookupToss(String(intent.order_id || ""));
    return { payment: looked && looked.response.ok ? looked.data : payment, permanentStatus: null };
  };

  const validIntent = (intent) => {
    const oid = String(intent && intent.order_id || "");
    return !!oid && !!intent.order_data
      && intent.order_hash === orderHash(intent.order_data)
      && Number.isInteger(Number(intent.expected_amount)) && Number(intent.expected_amount) > 0;
  };

  const paymentFromIntent = (intent, payment = null) => payment || ({
    orderId: intent.order_id,
    paymentKey: intent.payment_key || null,
    totalAmount: Number(intent.expected_amount),
    status: intent.toss_status || "DONE",
    method: intent.payment_method || null,
    approvedAt: intent.approved_at || intent.paid_at || null,
    receipt: intent.receipt_url ? { url: intent.receipt_url } : null,
  });
  // 공통 helper가 SMS/Telegram을 각각 성공한 뒤에만 개별 *_at을 기록한다.
  // 한 채널만 실패하면 다음 cron은 실패 채널만 다시 보낸다.
  const notifyChannels = async (intent, { critical = false, headline = "", reason = "", tag = "", payment = null, scope = "payment" } = {}) => {
    const result = await notifyPaymentIntentWithLease(
      intent, intent.order_data || {}, paymentFromIntent(intent, payment), reconciliationStartedAt,
      critical, { headline, reason, tag, scope }
    );
    if ((result.sms && result.sms.sent) || (result.telegram && result.telegram.sent)) {
      if (critical) alerted++;
      else notified++;
    }
    return result;
  };

  const patchCanceledOrder = async (intent, payment) => {
    const oid = String(intent.order_id || "");
    const canceledAt = (Array.isArray(payment.cancels) && payment.cancels.length
      && payment.cancels[payment.cancels.length - 1].canceledAt) || new Date().toISOString();
    const doPatch = async (body) => fetchJsonWithTimeout(
      `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&select=order_id`,
      {
        method: "PATCH",
        headers: serviceHeaders(SERVICE_KEY, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(body),
      }, 2200
    );
    let changed = await doPatch({
      status: "canceled", canceled_at: canceledAt, cancel_requested_at: null, payment_status: "CANCELED",
    });
    if (!changed.response.ok && /payment_status.*(column|schema cache)|column.*payment_status/i.test(changed.text)) {
      changed = await doPatch({ status: "canceled", canceled_at: canceledAt, cancel_requested_at: null });
    }
    let matched = changed.response.ok && Array.isArray(changed.data) && changed.data.length > 0;
    if (changed.response.ok && !matched) {
      // 결제 직후 주문 INSERT가 실패한 채 환불된 경우에도 취소 주문 이력을 남긴다.
      const saved = await upsertPaidOrder(SUPABASE_URL, SERVICE_KEY, intent.order_data, payment);
      if (saved.saved) {
        changed = await doPatch({
          status: "canceled", canceled_at: canceledAt, cancel_requested_at: null, payment_status: "CANCELED",
        });
        matched = changed.response.ok && Array.isArray(changed.data) && changed.data.length > 0;
      }
    }
    return matched;
  };

  const closeCancellationForManualReview = async (intent, payment, status) => {
    const oid = String(intent.order_id || "");
    const reason = cancelManualReviewReason(status);
    const now = new Date().toISOString();
    // 자동 취소 호출 큐에서 빼되 주문 hold는 유지한다. 수동 취소가 실제로
    // 끝나기 전 발주·배송사진·브리핑으로 복귀하면 이중 사고가 생긴다.
    const closed = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
      state: "finalized", toss_status: String(payment && payment.status || intent.toss_status || "DONE"),
      finalized_at: intent.finalized_at || now, finalization_error: reason, last_checked_at: now,
      alert_sent_at: null, sms_alerted_at: null, telegram_alerted_at: null,
      sms_alert_lease_until: null, telegram_alert_lease_until: null,
    }, "state=eq.canceling", 2000);
    const current = closed.row || {
      ...intent, state: closed.ok && closed.matched ? "finalized" : intent.state,
      finalization_error: reason, last_checked_at: now,
    };
    await notifyChannels(current, {
      critical: true,
      headline: "환불 자동 재시도 종료 · 수동 확인 필요",
      reason, tag: "환불수동확인", payment, scope: "cancellation",
    });
    return { closed: !!(closed.ok && closed.matched), holdRetained: true, reason };
  };

  const syncCancellation = async (intent, knownPayment = null) => {
    const oid = String(intent.order_id || "");
    if (!validIntent(intent)) {
      failed++;
      await notifyChannels(intent, { critical: true, headline: "환불 복구자료 검증 실패", reason: "intent_integrity_error", tag: "환불자료오류", scope: "cancellation" });
      return;
    }
    const lookup = knownPayment ? { response: { ok: true }, data: knownPayment } : await lookupToss(oid);
    if (!lookup || !lookup.response.ok) {
      pending++;
      await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid,
        { last_checked_at: new Date().toISOString(), finalization_error: "cancel_order_sync_pending" }, "", 1800);
      return;
    }
    let payment = lookup.data || {};
    // 관리자 함수와 동일한 원자 RPC로 hold를 보수한다. 사진 문자 lease가 활성
    // 상태면 이번 실행은 기다리고, 문자 완료/lease 만료 뒤에만 Toss 취소한다.
    if (intent.state === "canceling") {
      const coordinated = await beginOrderCancellation({
        supabaseUrl: SUPABASE_URL,
        serviceKey: SERVICE_KEY,
        orderId: oid,
        paymentKey: payment.paymentKey || intent.payment_key,
        expectedAmount: Number(intent.expected_amount),
        orderData: intent.order_data,
        orderHash: intent.order_hash,
        tossStatus: payment.status || intent.toss_status || "DONE",
        paymentMethod: payment.method || intent.payment_method || null,
        approvedAt: payment.approvedAt || intent.approved_at || null,
        receiptUrl: payment.receipt && payment.receipt.url || intent.receipt_url || null,
        alreadyCanceled: payment.status === "CANCELED",
        allowDelivered: true,
      });
      if (!coordinated.ok || !["started", "already_started", "already_canceled"].includes(coordinated.result)) {
        pending++;
        await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
          last_checked_at: new Date().toISOString(),
          finalization_error: ["photo_notice_busy", "payment_notice_busy"].includes(coordinated.result)
            ? `cancel_waiting_for_${coordinated.result}`
            : "cancel_order_sync_pending",
        }, "", 1600);
        return;
      }
    }
    const valid = payment.orderId === oid
      && Number(payment.totalAmount) === Number(intent.expected_amount)
      && typeof payment.paymentKey === "string" && payment.paymentKey.length > 0
      && (!intent.payment_key || intent.payment_key === payment.paymentKey);
    if (valid && intent.state === "canceling" && ["DONE", "PARTIAL_CANCELED"].includes(payment.status)) {
      const resumed = await resumeTossCancellation(intent, payment);
      payment = resumed.payment || payment;
      if (resumed.permanentStatus) {
        failed++;
        await closeCancellationForManualReview(intent, payment, resumed.permanentStatus);
        return;
      }
    }
    const canceledCheck = verifyCanceledPayment(payment, {
      orderId: oid,
      amount: Number(intent.expected_amount),
      paymentKey: intent.payment_key || payment.paymentKey,
    });
    if (!canceledCheck.ok) {
      failed++;
      await notifyChannels(intent, {
        critical: true,
        headline: payment.status === "DONE" ? "환불 요청 후에도 토스 결제가 DONE입니다" : "환불 원장 검증 실패",
        reason: canceledCheck.reason || payment.status || "payment_mismatch", tag: "환불확인필요", payment,
        scope: "cancellation",
      });
      return;
    }
    const synced = await patchCanceledOrder(intent, payment);
    if (!synced) {
      failed++;
      await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid,
        { state: "canceled", toss_status: "CANCELED", payment_key: payment.paymentKey,
          last_checked_at: new Date().toISOString(), finalization_error: "cancel_order_sync_pending" }, "", 1800);
      await notifyChannels(intent, { critical: true, headline: "환불 완료 후 주문상태 동기화 실패", reason: "cancel_order_sync_pending", tag: "환불동기화실패", payment, scope: "cancellation" });
      return;
    }
    await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
      state: "canceled", toss_status: "CANCELED", payment_key: payment.paymentKey,
      finalized_at: intent.finalized_at || new Date().toISOString(),
      last_checked_at: new Date().toISOString(), finalization_error: null,
    }, "state=in.(canceling,canceled,paid,finalized)", 1800);
    canceledSynced++;
  };

  const recoverPayment = async (intent) => {
    const oid = String(intent.order_id || "");
    if (!validIntent(intent)) {
      failed++;
      const failedPatch = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid,
        { state: "failed", last_checked_at: new Date().toISOString(), finalization_error: "intent_integrity_error" }, "", 1800);
      await notifyChannels(failedPatch.row || intent, { critical: true, headline: "결제 복구자료 검증 실패", reason: "intent_integrity_error", tag: "결제자료오류" });
      return;
    }
    const lookup = await lookupToss(oid);
    if (!lookup || !lookup.response.ok) {
      pending++;
      const old = Date.parse(intent.created_at || "") < Date.now() - 2 * 3600000;
      await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
        state: old && lookup && lookup.response.status === 404 ? "failed" : intent.state,
        last_checked_at: new Date().toISOString(),
        finalization_error: lookup ? `toss_lookup_${lookup.response.status}` : "toss_lookup_exception",
      }, "", 1800);
      return;
    }
    const payment = lookup.data || {};
    if (payment.status === "CANCELED") {
      const canceled = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
        state: "canceled", toss_status: "CANCELED", payment_key: payment.paymentKey || intent.payment_key,
        last_checked_at: new Date().toISOString(), finalization_error: "cancel_order_sync_pending",
      }, "state=in.(confirming,paid)", 1800);
      await syncCancellation(canceled.row || { ...intent, state: "canceled", payment_key: payment.paymentKey }, payment);
      return;
    }
    const expectedKey = intent.payment_key || payment.paymentKey;
    const verified = verifyDonePayment(payment, {
      orderId: oid, amount: Number(intent.expected_amount), paymentKey: expectedKey,
    });
    if (!verified.ok) {
      const terminal = ["ABORTED", "EXPIRED"].includes(payment.status);
      const changed = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
        state: terminal ? "failed" : intent.state,
        toss_status: payment.status || null, last_checked_at: new Date().toISOString(),
        finalization_error: String(verified.reason).slice(0, 240),
      }, "", 1800);
      if (payment.status === "PARTIAL_CANCELED" || payment.status === "DONE") {
        failed++;
        await notifyChannels(changed.row || intent, { critical: true, headline: "토스 결제와 저장된 주문 불일치", reason: verified.reason, tag: "결제불일치", payment });
      } else pending++;
      return;
    }

    const keyFilter = intent.payment_key
      ? `payment_key=eq.${encodeURIComponent(expectedKey)}&state=in.(confirming,paid)`
      : "payment_key=is.null&state=in.(confirming,paid)";
    const paid = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
      state: "paid", payment_key: payment.paymentKey, toss_status: payment.status,
      payment_method: payment.method || null, approved_at: payment.approvedAt || null,
      receipt_url: payment.receipt && payment.receipt.url || null,
      paid_at: payment.approvedAt || new Date().toISOString(),
      confirm_lease_until: null,
      last_checked_at: new Date().toISOString(), finalization_error: null,
    }, keyFilter, 2000);
    if (!paid.ok || !paid.matched) {
      failed++;
      await notifyChannels(intent, { critical: true, headline: "검증된 결제키 원장 저장 실패", reason: "payment_key_store_failed", tag: "결제원장실패", payment });
      return;
    }
    const current = paid.row || { ...intent, payment_key: payment.paymentKey, state: "paid" };
    const saved = await upsertPaidOrder(SUPABASE_URL, SERVICE_KEY, current.order_data, payment);
    if (!saved.saved) {
      failed++;
      const errored = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid,
        { state: "paid", last_checked_at: new Date().toISOString(),
          finalization_error: String(saved.reason || "order_save_failed").slice(0, 240) }, "", 1800);
      await notifyChannels(errored.row || current, { critical: true, headline: "결제 주문 자동복구 실패", reason: saved.reason, tag: "주문복구실패", payment });
      return;
    }
    const final = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid,
      { state: "finalized", finalized_at: new Date().toISOString(), finalization_error: null,
        last_checked_at: new Date().toISOString() },
      `payment_key=eq.${encodeURIComponent(payment.paymentKey)}&state=eq.paid`, 1800);
    if (!final.ok || !final.matched) {
      failed++;
      return;
    }
    recovered++;
    await notifyChannels(final.row || current, { payment });
  };

  const retryNotice = async (intent) => {
    if (!validIntent(intent)) {
      failed++;
      await notifyChannels(intent, { critical: true, headline: "완료 주문 알림자료 검증 실패", reason: "intent_integrity_error", tag: "알림자료오류" });
      return;
    }
    await notifyChannels(intent);
  };

  const retryFailedAlert = async (intent) => {
    await notifyChannels(intent, {
      critical: true,
      headline: "결제 건 수동 확인 필요",
      reason: intent.finalization_error || "payment_recovery_failed",
      tag: "결제확인필요",
    });
  };

  const reconcileManualCancellation = async (intent) => {
    const oid = String(intent && intent.order_id || "");
    const reason = String(intent && intent.finalization_error || "cancel_manual_review_unknown");
    if (!validIntent(intent)) {
      failed++;
      await notifyChannels(intent, { critical: true, headline: "환불 수동확인 자료 검증 실패", reason: "intent_integrity_error", tag: "환불자료오류", scope: "cancellation" });
      return;
    }

    // 이전 배포에서 hold가 풀렸던 수동확인 행도 사진 문자와 같은 잠금 아래
    // 보수한다. holdOnly는 intent의 finalized/manual-review 상태를 바꾸지 않는다.
    const held = await beginOrderCancellation({
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      orderId: oid,
      paymentKey: intent.payment_key,
      expectedAmount: Number(intent.expected_amount),
      orderData: intent.order_data,
      orderHash: intent.order_hash,
      tossStatus: intent.toss_status || "DONE",
      paymentMethod: intent.payment_method || null,
      approvedAt: intent.approved_at || null,
      receiptUrl: intent.receipt_url || null,
      allowDelivered: true,
      holdOnly: true,
    });
    if (!held.ok || held.result !== "held") {
      pending++;
      return;
    }

    const lookup = await lookupToss(oid);
    if (lookup && lookup.response.ok) {
      const payment = lookup.data || {};
      const matches = payment.orderId === oid
        && Number(payment.totalAmount) === Number(intent.expected_amount)
        && typeof payment.paymentKey === "string" && payment.paymentKey.length > 0
        && (!intent.payment_key || intent.payment_key === payment.paymentKey);
      if (matches && payment.status === "CANCELED") {
        await syncCancellation(intent, payment);
        return;
      }
    }

    pending++;
    await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, oid, {
      last_checked_at: new Date().toISOString(),
    }, `state=eq.finalized&finalization_error=eq.${encodeURIComponent(reason)}`, 1800);
    await notifyChannels(intent, {
      critical: true,
      headline: "환불 자동 재시도 종료 · 수동 확인 필요",
      reason, tag: "환불수동확인",
      payment: lookup && lookup.response.ok ? lookup.data : null,
      scope: "cancellation",
    });
  };

  await Promise.all([
    ...recoveryRows.map(recoverPayment),
    ...noticeRows.map(retryNotice),
    ...cancelRows.map((intent) => syncCancellation(intent)),
    ...failedAlertRows.map(retryFailedAlert),
    ...manualCancelRows.map(reconcileManualCancellation),
  ]);

  return {
    ok: true,
    checked: recoveryRows.length + noticeRows.length + cancelRows.length + failedAlertRows.length + manualCancelRows.length,
    recovered, pending, failed, alerted, notified, canceledSynced,
    manualCancelAlerts: manualCancelRows.length,
  };
}

async function recordReconciliationRuntime(SUPABASE_URL, SERVICE_KEY, { startedAt, result = null, error = null }) {
  const now = new Date().toISOString();
  const skipped = !!(result && result.skipped);
  const completed = !!(result && result.ok && !skipped && !error);
  const counts = result && typeof result === "object" ? Object.fromEntries(
    ["checked", "recovered", "pending", "failed", "alerted", "notified", "canceledSynced", "manualCancelAlerts"]
      .filter((key) => Number.isFinite(Number(result[key])))
      .map((key) => [key, Number(result[key])])
  ) : {};
  const row = { name: "payment_reconcile", last_started_at: startedAt };
  // 시작 heartbeat는 과거 성공/실패 판정을 건드리지 않는다. 실제 결과가
  // 나온 뒤에만 오류와 상세를 갱신해야 실행 중 잠깐의 false-green도 없다.
  if (result || error) {
    row.last_error = error
      ? String(error).slice(0, 240)
      : ((!result.ok || skipped)
        ? String(result.reason || (skipped ? "reconciliation_skipped" : "reconciliation_failed")).slice(0, 240)
        : null);
    row.details = {
      ...counts,
      ...(result && result.reason ? { reason: String(result.reason).slice(0, 80) } : {}),
      ...(result && result.skipped ? { skipped: true } : {}),
    };
  }
  if (completed) row.last_success_at = now;
  try {
    const stored = await fetchJsonWithTimeout(
      `${SUPABASE_URL}/rest/v1/first_bundle_runtime?on_conflict=name`,
      {
        method: "POST",
        headers: serviceHeaders(SERVICE_KEY, {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify(row),
      }, 1800
    );
    if (!stored.response.ok) {
      console.error(`payment reconciliation heartbeat write failed: ${stored.response.status}`);
      return { ok: false, reason: "runtime_heartbeat_write_failed", status: stored.response.status };
    }
    return { ok: true, completed, skipped };
  } catch {
    console.error("payment reconciliation heartbeat write exception");
    return { ok: false, reason: "runtime_heartbeat_write_exception" };
  }
}

// ── 애플 Sign in with Apple: Client Secret(JWT) 만료 임박 알림 ──
// 애플 웹 로그인 시크릿(JWT)은 최대 6개월이면 만료된다. 만료되면 애플 로그인이 막히므로,
// 만료 임계일(D-day)에 사장님 텔레그램으로 "재발급하라"고 알린다.
// ⚠️ 재발급하면 아래 APPLE_SECRET_EXPIRY 를 새 만료일로 바꿔야 한다. (재발급 방법: apple-signin.local.md)
const APPLE_SECRET_EXPIRY = "2027-01-03"; // 현재 Supabase에 넣은 애플 client secret(JWT) 만료일 (YYYY-MM-DD, KST)
const APPLE_ALERT_DAYS = [60, 45, 30, 21, 14, 7, 3, 1]; // 이 D-day들에 알림

async function checkAppleSecretExpiry(now) {
  // 30분 크론이라 하루에 한 번만 알리도록 KST 09:00~09:29 창에서만 발송(스팸 방지).
  const kstHour = (now.getUTCHours() + 9) % 24;
  if (kstHour !== 9 || now.getUTCMinutes() >= 30) return;
  const exp = new Date(APPLE_SECRET_EXPIRY + "T00:00:00+09:00");
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
  if (!APPLE_ALERT_DAYS.includes(daysLeft)) return;
  await sendTelegram(
    `🍎 애플 로그인 보안키 만료 D-${daysLeft} (${APPLE_SECRET_EXPIRY})\n`
    + `만료되면 애플 로그인이 막혀요. 6개월짜리 Client Secret(JWT)을 재발급해야 합니다.\n`
    + `재발급: 다운로드 폴더의 AuthKey_*.p8 로 새 JWT 생성 → Supabase Apple provider의 Secret Key 교체.\n`
    + `(간단히: 클로드에게 "애플 시크릿 재발급" 요청 → 명령 한 줄로 새 JWT 생성)`
  );
}

// ── 사장님 브리핑 (아침/점심/저녁) — 미결 주문·오늘 행사·매출 한 통 요약 ──
const BRIEF_META = {
  morning: { emoji: "🌅", label: "아침 브리핑" },
  noon:    { emoji: "☀️", label: "점심 브리핑" },
  evening: { emoji: "🌆", label: "저녁 브리핑" },
};
function kstDayRangeUtc(offsetDays) {
  // KST 자정 기준 [시작,끝) 을 UTC ISO로. offsetDays: 0=오늘, -1=어제, 1=내일
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600000);
  const day = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + offsetDays));
  const start = new Date(day.getTime() - 9 * 3600000);
  return [start.toISOString(), new Date(start.getTime() + 86400000).toISOString()];
}
function kstDT(iso) {
  // 오늘이면 HH:MM, 다른 날이면 M/D HH:MM
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  const now = new Date(Date.now() + 9 * 3600000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const sameDay = d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
  return sameDay ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
}
function briefLine(o) {
  const st = o.status === "ordered" ? "🟡" : o.status === "delivered" ? "✅" : "🔴";
  const when = o.event_at ? kstDT(o.event_at) : (o.event_time || "시간미정");
  const who = [o.recipient_name, o.venue].filter(Boolean).join(" / ") || "받는분 미상";
  return ` ${st} ${when} ${o.product_label || o.product_code || "주문"} — ${who}`;
}

/**
 * 목록 위에 얹을 한 문단 요약. 같은 장소·인접 지역을 묶어 "오늘 이렇게 도시면 됩니다"로 정리한다.
 * 실패하면 null — 브리핑 본문은 그대로 나가야 하므로 절대 막지 않는다.
 * 보내는 건 배송 정보뿐(연락처는 애초에 조회 대상이 아니다).
 */
async function briefingDigest(todayRows) {
  if (todayRows.length < 2) return null; // 1건이면 묶을 것이 없다
  const lines = todayRows
    .map((o) => {
      const when = o.event_at ? kstDT(o.event_at) : (o.event_time || "시간미정");
      return `${when} | ${o.product_label || o.product_code || "주문"} | ${o.venue || "장소미상"} | ${o.recipient_name || ""}`;
    })
    .join("\n");
  const r = await askClaude({
    maxTokens: 400,
    timeoutMs: 8000,
    system:
      "너는 33년 된 꽃집의 배송 일정을 사장님께 정리해 드린다. 사장님은 연세가 있으시니 짧고 분명하게 쓴다.\n" +
      "규칙:\n" +
      "- 같은 장소이거나 가까운 지역이면 묶어서 한 번에 다녀오시라고 알린다.\n" +
      "- 시간이 가장 급한 것을 먼저 말한다.\n" +
      "- 전체 3줄 이내. 각 줄은 한 문장.\n" +
      "- 존댓말. 인사말·머리말·맺음말은 쓰지 않는다.\n" +
      "- 목록에 없는 내용은 절대 지어내지 않는다. 지역이 확실하지 않으면 묶지 않는다.\n" +
      "- 묶을 것도 급한 것도 없으면 빈 문자열만 출력한다.",
    content: `오늘 배송 목록입니다. 시간 | 상품 | 장소 | 받는분 순입니다.\n\n${lines}`,
  });
  if (!r.ok) return null;
  const t = r.text.trim();
  if (!t || t.length > 300) return null; // 길면 요약이 아니다 — 버린다
  return t;
}
async function runBriefing(kind, SUPABASE_URL, sbHeaders) {
  const meta = BRIEF_META[kind];
  const [todayS, todayE] = kstDayRangeUtc(0);
  const [yesterS] = kstDayRangeUtc(-1);
  const [tomorS, tomorE] = kstDayRangeUtc(1);
  const sel = "order_id,status,product_label,product_code,recipient_name,venue,event_at,event_time,created_at,paid_amount,amount";
  let failed = false;
  // count=exact + Content-Range 로 진짜 총 건수 확보(limit에 잘려도 "N건"이 정확하게)
  const get = async (qs, limit) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=${sel}&${qs}&limit=${limit}`, {
        headers: { ...sbHeaders, Prefer: "count=exact" },
      });
      if (!r.ok) { failed = true; return { rows: [], total: 0 }; }
      const rows = (await r.json().catch(() => [])) || [];
      const cr = r.headers.get("content-range") || "";
      const total = parseInt(cr.split("/")[1], 10);
      return { rows, total: Number.isFinite(total) ? total : rows.length };
    } catch { failed = true; return { rows: [], total: 0 }; }
  };
  const loadCurrent = () => Promise.all([
    get(`status=eq.new&cancel_requested_at=is.null&order=event_at.asc.nullslast`, 12),
    get(`event_at=gte.${encodeURIComponent(todayS)}&event_at=lt.${encodeURIComponent(todayE)}&status=neq.canceled&cancel_requested_at=is.null&order=event_at.asc`, 12),
    get(`event_at=gte.${encodeURIComponent(tomorS)}&event_at=lt.${encodeURIComponent(tomorE)}&status=neq.canceled&cancel_requested_at=is.null&order=event_at.asc`, 12),
    kind === "morning"
      ? get(`created_at=gte.${encodeURIComponent(yesterS)}&created_at=lt.${encodeURIComponent(todayS)}&status=neq.canceled&cancel_requested_at=is.null`, 200)
      : get(`created_at=gte.${encodeURIComponent(todayS)}&status=neq.canceled&cancel_requested_at=is.null`, 200),
  ]);
  let [pending, today, tomorrow, sales] = await loadCurrent();
  if (failed) return { sent: false, reason: "query_failed" }; // 데이터가 불완전하면 틀린 브리핑 대신 침묵

  // 목록보다 먼저 읽히도록 요약을 맨 위에. AI가 실패하면 이 줄만 빠지고 나머지는 그대로 나간다.
  // AI를 기다리는 동안 환불이 시작될 수 있으므로, 요약 뒤 원장을 다시 읽고
  // 실제 전송 본문은 두 번째 스냅샷만 사용한다. 대상이 달라졌다면 stale AI
  // 요약은 버린다.
  const digestInput = today.rows.map((o) => o.order_id).sort().join("|");
  let digest = await briefingDigest(today.rows);
  [pending, today, tomorrow, sales] = await loadCurrent();
  if (failed) return { sent: false, reason: "query_failed" };
  const freshDigestInput = today.rows.map((o) => o.order_id).sort().join("|");
  if (digestInput !== freshDigestInput) digest = null;

  const salesSum = sales.rows.reduce((s, o) => s + (Number(o.paid_amount || o.amount) || 0), 0);
  const salesLabel = kind === "morning" ? "어제 매출" : "오늘 매출";
  const quiet = !pending.total && !today.total && !tomorrow.total && !sales.total;
  if (quiet && kind !== "morning") return { sent: false, reason: "quiet" }; // 조용하면 아침에만 알림

  const kstNow = new Date(Date.now() + 9 * 3600000);
  const dateStr = `${kstNow.getUTCMonth() + 1}/${kstNow.getUTCDate()}(${"일월화수목금토"[kstNow.getUTCDay()]})`;
  const L = [`${meta.emoji} ${meta.label} — ${dateStr}`];
  if (digest) L.push(`\n${digest}`);
  if (pending.total) {
    L.push(`\n📋 미결 주문 ${pending.total}건 (아직 발주 전)`);
    for (const o of pending.rows.slice(0, 8)) L.push(briefLine(o));
    if (pending.total > 8) L.push(` … 외 ${pending.total - 8}건 — 관리 화면에서 확인`);
  }
  if (today.total) {
    L.push(`\n🌸 오늘 행사 ${today.total}건 (🔴접수 🟡준비중 ✅완료)`);
    for (const o of today.rows) L.push(briefLine(o));
    if (today.total > today.rows.length) L.push(` … 외 ${today.total - today.rows.length}건`);
  }
  if (kind === "evening" && tomorrow.total) {
    L.push(`\n📅 내일 행사 ${tomorrow.total}건`);
    for (const o of tomorrow.rows) L.push(briefLine(o));
  }
  L.push(`\n💰 ${salesLabel} ${salesSum.toLocaleString()}원 (${sales.total}건)`);
  if (quiet) L.push("\n오늘은 조용해요. 좋은 하루 되세요 🌿");
  const base = (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
  L.push(`\n주문 관리 → ${base}/admin-orders.html`);
  const ok = await sendTelegram(L.join("\n"));
  if (!ok) return { sent: false };

  // 두 번째 snapshot과 Telegram 발송 사이에 환불 hold가 생기면, 환불 중지
  // 메시지 뒤로 stale 브리핑이 도착할 수 있다. 본문에 실제로 실린 운영 주문만
  // 전송 직후 다시 확인해 마지막 메시지를 정정한다. 이 조회보다 늦게 시작된
  // 환불은 admin의 발주중지 메시지가 브리핑 뒤에 도착하므로 순서가 안전하다.
  const operationalRows = [
    ...pending.rows.slice(0, 8),
    ...today.rows,
    ...(kind === "evening" ? tomorrow.rows : []),
  ];
  const labels = new Map(operationalRows.map((o) => [String(o.order_id || ""), o.product_label || o.product_code || "주문"]));
  const trackedIds = [...labels.keys()].filter((id) => /^[A-Za-z0-9._-]{4,64}$/.test(id));
  if (!trackedIds.length) return { sent: true };

  try {
    const idFilter = trackedIds.map(encodeURIComponent).join(",");
    const checked = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?select=order_id,status,cancel_requested_at,canceled_at`
        + `&order_id=in.(${idFilter})`,
      { headers: sbHeaders },
    );
    if (!checked.ok) {
      const correctionSent = await sendTelegram("⚠️ 방금 브리핑의 환불 상태를 재확인하지 못했습니다. 발주 전 관리 화면을 확인해주세요.");
      return { sent: true, postcheck: false, correctionSent };
    }
    const current = await checked.json().catch(() => []);
    const refunding = (Array.isArray(current) ? current : []).filter((o) =>
      o && (o.cancel_requested_at || o.canceled_at || o.status === "canceled")
    );
    if (refunding.length) {
      const shown = refunding.slice(0, 12).map((o) => `- ${labels.get(String(o.order_id || "")) || "주문"} (${o.order_id})`);
      if (refunding.length > shown.length) shown.push(`- 외 ${refunding.length - shown.length}건`);
      const correctionSent = await sendTelegram(
        `⛔ 방금 브리핑에서 아래 주문은 제외하세요. 환불 확인 중이며 발주·배송 금지입니다.\n${shown.join("\n")}`
      );
      return { sent: true, postcheck: true, correctionSent, refundCorrections: refunding.length };
    }
    return { sent: true, postcheck: true };
  } catch {
    const correctionSent = await sendTelegram("⚠️ 방금 브리핑의 환불 상태를 재확인하지 못했습니다. 발주 전 관리 화면을 확인해주세요.");
    return { sent: true, postcheck: false, correctionSent };
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEq(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 모드 분기 — 같은 서버리스 함수에 합쳐 Vercel Hobby 12함수 제한을 지킨다.
  let briefKind = "", mode = "";
  try {
    const params = new URL(req.url, "http://localhost").searchParams;
    briefKind = params.get("briefing") || "";
    mode = params.get("mode") || "";
  } catch {}
  if (mode === "reconcile") {
    const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!URL || !KEY) return res.status(503).json({ error: "supabase env missing" });
    const startedAt = new Date().toISOString();
    const startedHeartbeat = await recordReconciliationRuntime(URL, KEY, { startedAt });
    try {
      const out = await runPaymentReconciliation(URL, KEY);
      const completedHeartbeat = await recordReconciliationRuntime(URL, KEY, { startedAt, result: out });
      if (!startedHeartbeat.ok || !completedHeartbeat.ok) {
        return res.status(502).json({
          ok: false,
          reason: "runtime_heartbeat_write_failed",
          reconciliationOk: !!out.ok,
          heartbeat: { started: !!startedHeartbeat.ok, completed: !!completedHeartbeat.ok },
        });
      }
      return res.status(out.ok ? 200 : 502).json(out);
    } catch (e) {
      console.error("payment reconciliation error:", e.message);
      const failedHeartbeat = await recordReconciliationRuntime(URL, KEY, { startedAt, error: e && e.message || "reconciliation_exception" });
      return res.status(500).json({ error: "reconciliation_failed", heartbeatRecorded: !!failedHeartbeat.ok });
    }
  }

  // 브리핑 모드 — pg_cron이 ?briefing=morning|noon|evening 으로 하루 3번 호출
  if (briefKind && BRIEF_META[briefKind]) {
    const SUPABASE_URL_B = process.env.SUPABASE_URL;
    const SERVICE_KEY_B = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL_B || !SERVICE_KEY_B) return res.status(503).json({ error: "supabase env missing" });
    try {
      const out = await runBriefing(briefKind, SUPABASE_URL_B, { apikey: SERVICE_KEY_B, Authorization: `Bearer ${SERVICE_KEY_B}` });
      return res.status(200).json({ ok: true, briefing: briefKind, ...out });
    } catch (e) {
      console.error("briefing error:", e.message);
      return res.status(500).json({ error: "briefing_failed" });
    }
  }

  // 애플 로그인 시크릿 만료 임박 알림 (배송 체크와 독립 — 실패해도 아래 로직엔 영향 없음)
  try { await checkAppleSecretExpiry(new Date()); } catch (e) { console.error("apple secret check:", e.message); }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "supabase env missing" });
  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  const now = new Date();
  const until = new Date(now.getTime() + ALERT_WINDOW_HOURS * 3600000);
  const floor = new Date(now.getTime() - GRACE_PAST_HOURS * 3600000);

  // 미배송(new) + 아직 경고 안 함 + 행사시각이 [지금-24h, 지금+3h] (지난 미배송도 포함)
  const q = `${SUPABASE_URL}/rest/v1/orders?select=id,product_label,recipient_name,venue,order_type,event_time,event_at`
    + `&status=eq.new&alerted_at=is.null`
    + `&cancel_requested_at=is.null`
    + `&event_at=gte.${encodeURIComponent(floor.toISOString())}`
    + `&event_at=lte.${encodeURIComponent(until.toISOString())}`
    + `&order=event_at.asc`;

  let rows = [];
  try {
    const r = await fetch(q, { headers: sbHeaders });
    if (!r.ok) return res.status(502).json({ error: "query_failed", detail: await r.text().catch(() => "") });
    rows = await r.json();
  } catch (e) {
    return res.status(502).json({ error: "query_exception", detail: e.message });
  }

  let alerted = 0;
  for (const o of rows) {
    // 1) 원자적 선점: alerted_at이 아직 null일 때만 갱신 + 갱신행 반환 → 한 인스턴스만 성공
    let claimed = false;
    const claimedAt = now.toISOString();
    try {
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${o.id}&status=eq.new&alerted_at=is.null&cancel_requested_at=is.null`, {
        method: "PATCH",
        headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ alerted_at: claimedAt }),
      });
      if (cr.ok) {
        const u = await cr.json().catch(() => []);
        claimed = Array.isArray(u) && u.length > 0;
      }
    } catch (e) {
      console.error("claim 실패:", e.message);
    }
    if (!claimed) continue; // 다른 실행이 이미 알림 담당

    const readWarningState = async () => {
      try {
        const current = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(o.id)}`
            + `&select=id,status,cancel_requested_at,canceled_at,alerted_at&limit=1`,
          { headers: sbHeaders },
        );
        if (!current.ok) return null;
        const currentRows = await current.json().catch(() => []);
        return Array.isArray(currentRows) ? (currentRows[0] || null) : null;
      } catch { return null; }
    };
    const isActionable = (current) => {
      const storedClaim = Date.parse(current && current.alerted_at || "");
      const localClaim = Date.parse(claimedAt);
      return !!current
        && current.status === "new"
        && !current.cancel_requested_at
        && !current.canceled_at
        && Number.isFinite(storedClaim)
        && Number.isFinite(localClaim)
        && storedClaim === localClaim;
    };
    const isRefunding = (current) => !!current
      && (!!current.cancel_requested_at || !!current.canceled_at || current.status === "canceled");
    const rollbackClaim = async () => {
      try {
        await fetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(o.id)}`
            + `&status=eq.new&cancel_requested_at=is.null&alerted_at=eq.${encodeURIComponent(claimedAt)}`,
          {
            method: "PATCH",
            headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ alerted_at: null }),
          },
        );
      } catch (e) { console.error("롤백 실패:", e.message); }
    };

    // 선점 직후 환불 hold가 잡혔으면 stale 경고를 보내지 않는다. 조회 실패도
    // 안전하게 침묵하고 다음 cron이 재시도하도록 조건부 롤백한다.
    const stateBeforeSend = await readWarningState();
    if (!isActionable(stateBeforeSend)) {
      await rollbackClaim();
      continue;
    }

    // 2) 선점 성공한 인스턴스만 발송
    const ev = o.event_at ? new Date(o.event_at) : null;
    const diffH = ev ? Math.round((ev.getTime() - now.getTime()) / 3600000) : null;
    const kind = o.order_type === "funeral" ? "발인/조문" : o.order_type === "wedding" ? "예식" : "행사";
    const past = diffH != null && diffH < 0;
    const when = diffH == null ? "" : past ? ` (⏰ 약 ${-diffH}시간 지남!)` : ` (약 ${diffH}시간 후)`;
    const lines = [
      past ? "🚨 이미 지났는데 미배송!" : "⚠️ 미배송 확인 필요!",
      `${o.product_label || "주문"} — ${[o.recipient_name, o.venue].filter(Boolean).join(" / ")}`,
      `${kind} ${o.event_time || ""}${when}`,
      "아직 '배송완료' 처리가 안 됐어요. 확인해주세요.",
    ];
    const ok = await sendTelegram(lines.join("\n"));
    if (ok) {
      alerted++;
      // 전송 중 환불이 시작됐다면 앞선 경고를 명시적으로 무효화한다.
      // 환불이 이 조회 뒤 시작되면 admin의 '발주/배송 중지' 메시지가 뒤따른다.
      const stateAfterSend = await readWarningState();
      if (isRefunding(stateAfterSend)) {
        await sendTelegram(`⛔ 앞선 미배송 경고는 무시하세요. 환불 확인 중입니다.\n주문: ${o.product_label || "주문"}`);
      }
    } else {
      // 발송 실패 → 선점 롤백(다음 cron이 재시도하도록)
      await rollbackClaim();
    }
  }

  return res.status(200).json({ ok: true, checked: rows.length, alerted });
}
