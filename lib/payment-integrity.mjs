// 결제 승인과 주문 저장 사이를 안전하게 잇는 공용 도구.
// confirm-payment(실시간 승인)와 check-deadlines(사후 대사)가 같은 규칙으로
// Payment/주문 행을 검증하고 저장하도록 한 곳에 둔다.

import crypto from "node:crypto";

const INTENT_TABLE = "payment_intents";
const NEW_ORDER_PAYMENT_COLUMNS = new Set([
  "payment_key", "payment_status", "payment_method", "approved_at", "receipt_url",
]);

export function serviceHeaders(serviceKey, extra = {}) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra };
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function orderHash(orderData) {
  return crypto.createHash("sha256").update(stableStringify(orderData || {})).digest("hex");
}

export function confirmIdempotencyKey(orderId, paymentKey = "") {
  // 토스의 멱등키는 첫 응답을 오래 보관한다. 주문번호만 쓰면 첫 카드 인증 실패가
  // 같은 주문번호의 다음 카드 시도까지 잠그므로, 결제 시도(paymentKey)까지 함께 묶는다.
  // 원문 결제키는 헤더에 노출하지 않고 SHA-256만 사용한다.
  return `kkotanbu-confirm-${crypto.createHash("sha256").update(`confirm-v2:${orderId}:${paymentKey}`).digest("hex")}`;
}

export function paymentAttemptHash(paymentKey = "") {
  // 원문 paymentKey를 승인 전 DB에 남기지 않고, 같은 결제 시도인지만 판별한다.
  return crypto.createHash("sha256").update(`confirm-attempt-v1:${String(paymentKey)}`).digest("hex");
}

export function isRetryableTossHttpStatus(status) {
  const code = Number(status);
  return code === 408 || code === 409 || code === 429 || code >= 500;
}

export function cancelManualReviewReason(status) {
  const code = Number(status);
  return `cancel_manual_review_${Number.isInteger(code) && code >= 400 && code <= 599 ? code : "unknown"}`;
}

export function isIntentUnavailable(status, bodyText = "") {
  const t = String(bodyText || "");
  return /PGRST205|42P01|payment_intents.*(not find|not exist|schema cache)/i.test(t)
    || /relation\s+[^\n]*payment_intents[^\n]*does not exist/i.test(t);
}

export function isMissingPaymentColumns(bodyText = "") {
  const t = String(bodyText || "");
  return [...NEW_ORDER_PAYMENT_COLUMNS].some((c) =>
    new RegExp(`(?:column|field)[^\\n]*${c}|${c}[^\\n]*(?:column|field|schema cache|does not exist)`, "i").test(t)
  );
}

export function isMissingOrderUnique(bodyText = "") {
  return /42P10|no unique or exclusion constraint/i.test(String(bodyText || ""));
}

export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 6000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ac.signal });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { response: r, data, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function getPaymentIntent(supabaseUrl, serviceKey, orderId) {
  if (!supabaseUrl || !serviceKey) return { available: false, reason: "supabase_env_missing", row: null };
  try {
    const { response, data, text } = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/${INTENT_TABLE}?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`,
      { headers: serviceHeaders(serviceKey) },
      2500
    );
    if (!response.ok) {
      if (isIntentUnavailable(response.status, text)) return { available: false, reason: "table_unavailable", row: null };
      return { available: true, error: `intent_read_${response.status}`, detail: text.slice(0, 500), row: null };
    }
    return { available: true, row: Array.isArray(data) && data[0] ? data[0] : null };
  } catch (err) {
    return { available: true, error: "intent_read_exception", detail: err && err.message, row: null };
  }
}

function isPrepareRpcUnavailable(status, bodyText = "") {
  return status === 404 || /PGRST202|create_payment_intent.*(not find|schema cache|does not exist)/i.test(String(bodyText || ""));
}

async function insertPaymentIntentDirect(supabaseUrl, serviceKey, row) {
  try {
    const { response, data, text } = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/${INTENT_TABLE}`,
      {
        method: "POST",
        headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(row),
      },
      3500
    );
    if (response.ok) return { ok: true, row: Array.isArray(data) ? data[0] : data };
    if (isIntentUnavailable(response.status, text)) return { ok: false, unavailable: true, reason: "table_unavailable" };
    return { ok: false, status: response.status, reason: "intent_insert_error", detail: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, reason: "intent_insert_exception", detail: err && err.message };
  }
}

export async function insertPaymentIntent(supabaseUrl, serviceKey, row, { fingerprint = "", allowDirectFallback = true } = {}) {
  // 최신 스키마에서는 SECURITY DEFINER RPC가 IP-HMAC/전체 요청량을 원자적으로 제한한다.
  // SQL보다 코드가 먼저 배포된 짧은 구간에만 직접 INSERT로 호환한다.
  try {
    const { response, data, text } = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/rpc/create_payment_intent`,
      {
        method: "POST",
        headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          p_order_id: row.order_id,
          p_expected_amount: row.expected_amount,
          p_order_data: row.order_data,
          p_order_hash: row.order_hash,
          p_user_id: row.user_id || null,
          p_fingerprint: fingerprint,
          p_expires_at: row.expires_at,
        }),
      },
      3500
    );
    if (response.ok) return { ok: true, row: Array.isArray(data) ? data[0] : data };
    if (/payment_order_id_already_exists/i.test(text)) {
      return { ok: false, status: 409, orderIdConflict: true, reason: "order_id_already_exists" };
    }
    if (/payment_prepare_rate_limited/i.test(text)) {
      return { ok: false, status: 429, rateLimited: true, reason: "prepare_rate_limited" };
    }
    if (!isPrepareRpcUnavailable(response.status, text)) {
      return { ok: false, status: response.status, reason: "intent_rpc_error", detail: text.slice(0, 500) };
    }
  } catch (err) {
    // 네트워크가 불명확할 때 직접 INSERT하면 RPC가 이미 커밋된 경우 제한을 우회할 수 있다.
    return { ok: false, reason: "intent_rpc_exception", detail: err && err.message };
  }
  if (!allowDirectFallback) return { ok: false, unavailable: true, reason: "prepare_rpc_unavailable" };
  return insertPaymentIntentDirect(supabaseUrl, serviceKey, row);
}

export async function patchPaymentIntent(supabaseUrl, serviceKey, orderId, patch, filters = "", timeoutMs = 2200) {
  try {
    const suffix = filters ? `&${filters}` : "";
    const { response, data, text } = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/${INTENT_TABLE}?order_id=eq.${encodeURIComponent(orderId)}${suffix}`,
      {
        method: "PATCH",
        headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      },
      timeoutMs
    );
    if (response.ok) {
      const rows = Array.isArray(data) ? data : [];
      return { ok: true, row: rows[0] || null, matched: rows.length > 0 };
    }
    if (isIntentUnavailable(response.status, text)) return { ok: false, unavailable: true, reason: "table_unavailable" };
    return { ok: false, status: response.status, reason: "intent_patch_error", detail: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, reason: "intent_patch_exception", detail: err && err.message };
  }
}

export function verifyDonePayment(payment, { orderId, amount, paymentKey }) {
  if (!payment || typeof payment !== "object") return { ok: false, reason: "empty_payment" };
  if (payment.orderId !== orderId) return { ok: false, reason: "order_id_mismatch" };
  if (!Number.isInteger(Number(payment.totalAmount)) || Number(payment.totalAmount) !== Number(amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (!payment.paymentKey || payment.paymentKey !== paymentKey) return { ok: false, reason: "payment_key_mismatch" };
  if (payment.status !== "DONE") return { ok: false, reason: `status_${payment.status || "unknown"}` };
  return { ok: true };
}

export function verifyCanceledPayment(payment, { orderId, amount, paymentKey }) {
  if (!payment || typeof payment !== "object") return { ok: false, reason: "empty_payment" };
  if (payment.orderId !== orderId) return { ok: false, reason: "order_id_mismatch" };
  const expected = Number(amount);
  if (!Number.isInteger(expected) || expected <= 0
      || !Number.isInteger(Number(payment.totalAmount)) || Number(payment.totalAmount) !== expected) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (!payment.paymentKey || payment.paymentKey !== paymentKey) return { ok: false, reason: "payment_key_mismatch" };
  if (payment.status !== "CANCELED") return { ok: false, reason: `status_${payment.status || "unknown"}` };
  if (!Number.isInteger(Number(payment.balanceAmount)) || Number(payment.balanceAmount) !== 0) {
    return { ok: false, reason: "balance_not_zero" };
  }
  if (!Array.isArray(payment.cancels) || payment.cancels.length === 0) {
    return { ok: false, reason: "cancel_history_missing" };
  }
  let canceledAmount = 0;
  for (const item of payment.cancels) {
    const value = Number(item && item.cancelAmount);
    if (!Number.isInteger(value) || value <= 0) return { ok: false, reason: "cancel_amount_invalid" };
    canceledAmount += value;
  }
  if (canceledAmount !== expected) return { ok: false, reason: "cancel_amount_mismatch" };
  return { ok: true, canceledAmount };
}

export function publicPayment(payment) {
  return {
    orderId: payment.orderId,
    totalAmount: payment.totalAmount,
    method: payment.method || null,
    approvedAt: payment.approvedAt || null,
    receiptUrl: payment.receipt && payment.receipt.url || null,
  };
}

export function buildOrderRow(order, payment) {
  let eventAt = null;
  const t = String(order.time || "").trim();
  let d = String(order.date || "").trim().replace(/[.\/]/g, "-").replace(/-+$/, "");
  const dm = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dm) {
    d = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
    const dt = new Date(`${d}T${/^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : "00:00"}:00+09:00`);
    if (!Number.isNaN(dt.getTime())) eventAt = dt.toISOString();
  } else {
    d = String(order.date || "").trim();
  }
  return {
    order_id: payment.orderId || null,
    product_label: order.productLabel || null,
    product_code: order.productCode || null,
    amount: Number(payment.totalAmount) || null,
    price: Number(order.price) || null,
    paid_amount: Number(payment.totalAmount) || null,
    discount_points: order.discount_points != null ? (Number(order.discount_points) || 0) : null,
    category: order.category || null,
    order_type: order.type || null,
    recipient_name: order.recipientName || null,
    recipient_phone: order.recipientPhone || null,
    room_info: order.venueDetail || null,
    delivery_time_slot: order.timeSlot || null,
    venue: [order.venue, order.venueDetail].filter(Boolean).join(" ") || null,
    address: order.address || order.venueAddress || null,
    event_date: d || null,
    event_time: t || null,
    event_at: eventAt,
    sender_name: order.senderName || null,
    sender_phone: order.senderPhone || null,
    ribbon: [order.ribbonLeft, order.ribbonRight].filter(Boolean).join(" / ") || null,
    note: order.senderNote || null,
    user_id: order.user_id || null,
    utm_source: String(order.utmSource || "").slice(0, 64) || null,
    utm_medium: String(order.utmMedium || "").slice(0, 64) || null,
    utm_campaign: String(order.utmCampaign || "").slice(0, 64) || null,
    payment_key: payment.paymentKey || null,
    payment_status: payment.status || null,
    payment_method: payment.method || null,
    approved_at: payment.approvedAt || null,
    receipt_url: payment.receipt && payment.receipt.url || null,
    ...(order.buyerType === "corp" && order.corpName ? {
      corp_name: String(order.corpName).slice(0, 60),
      corp_regno: String(order.corpRegNo || "").replace(/\D/g, "").slice(0, 10) || null,
      corp_email: String(order.corpEmail || "").slice(0, 120) || null,
      corp_ceo: String(order.corpCeo || "").slice(0, 40) || null,
      corp_addr: String(order.corpAddr || "").slice(0, 120) || null,
    } : {}),
  };
}

function legacyOrderRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !NEW_ORDER_PAYMENT_COLUMNS.has(key)));
}

async function insertOrder(supabaseUrl, serviceKey, row) {
  const { response, data, text } = await fetchJsonWithTimeout(
    `${supabaseUrl}/rest/v1/orders?on_conflict=order_id`,
    {
      method: "POST",
      headers: serviceHeaders(serviceKey, {
        "Content-Type": "application/json",
        // 주문 전체 행에는 연락처·주소·사진 접근 토큰 등 민감정보가 있다.
        // 서버 내부에서도 불필요하게 돌려받지 않는다.
        Prefer: "resolution=ignore-duplicates,return=minimal",
      }),
      body: JSON.stringify(row),
    },
    3000
  );
  return { ok: response.ok, status: response.status, data, text };
}

async function legacySave(supabaseUrl, serviceKey, row) {
  const headers = serviceHeaders(serviceKey);
  try {
    const check = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(row.order_id)}&select=order_id&limit=1`,
      { headers },
      1800
    );
    if (!check.response.ok) return { saved: false, reason: "legacy_check_error" };
    const exists = Array.isArray(check.data) && check.data.length > 0;
    // 이미 만들어진 주문은 관리자가 주소·일시·메모를 수정했을 수 있다. 재확인 시
    // 봉인 원본 전체를 PATCH하지 않고 기존 행을 그대로 둔다.
    if (exists) return { saved: true, isNew: false, atomic: false, legacy: true };
    const saved = await fetchJsonWithTimeout(`${supabaseUrl}/rest/v1/orders`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    }, 3000);
    if (!saved.response.ok) return { saved: false, reason: "legacy_insert_error", detail: saved.text.slice(0, 500) };
    return { saved: true, isNew: true, atomic: false, legacy: true };
  } catch (err) {
    return { saved: false, reason: "legacy_save_exception", detail: err && err.message };
  }
}

async function patchExistingPayment(supabaseUrl, serviceKey, full) {
  const paymentPatch = Object.fromEntries(Object.entries({
    paid_amount: full.paid_amount,
    payment_key: full.payment_key,
    payment_status: full.payment_status,
    payment_method: full.payment_method,
    approved_at: full.approved_at,
    receipt_url: full.receipt_url,
  }).filter(([, value]) => value !== null && value !== undefined));
  const updated = await fetchJsonWithTimeout(
    `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(full.order_id)}`
      + `&or=(payment_key.is.null,payment_key.eq.${encodeURIComponent(full.payment_key)})&select=order_id`,
    {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(paymentPatch),
    },
    2200
  );
  if (!updated.response.ok) return { saved: false, reason: "order_payment_update_error", text: updated.text };
  return Array.isArray(updated.data) && updated.data.length > 0
    ? { saved: true, atomic: true }
    : { saved: false, reason: "order_payment_key_conflict" };
}

export async function upsertPaidOrder(supabaseUrl, serviceKey, order, payment) {
  if (!supabaseUrl || !serviceKey) return { saved: false, reason: "supabase_env_missing" };
  // 재확인·복구 때 정보가 적은 구버전 payload가 와도 기존 주문의 주소·연락처를
  // null로 덮어쓰지 않는다. INSERT에서는 빠진 칸이 원래처럼 NULL/default가 된다.
  const full = Object.fromEntries(
    Object.entries(buildOrderRow(order, payment)).filter(([, value]) => value !== null && value !== undefined)
  );
  if (!full.order_id) return { saved: false, reason: "missing_order_id" };
  try {
    let compatible = full;
    let out = await insertOrder(supabaseUrl, serviceKey, full);
    if (out.ok) {
      // INSERT가 성공했거나 같은 order_id가 이미 있어 무시된 경우 모두 결제 메타만
      // 제한적으로 동기화한다. 배송지·메모 등 운영상 수정값은 절대 덮어쓰지 않는다.
      return patchExistingPayment(supabaseUrl, serviceKey, full);
    }

    // 배포 순서가 SQL보다 코드가 먼저여도 기존 결제를 막지 않는다.
    if (isMissingPaymentColumns(out.text)) {
      compatible = legacyOrderRow(full);
      const legacy = await legacySave(supabaseUrl, serviceKey, compatible);
      if (!legacy.saved) return legacy;
      // 다른 요청이 방금 최신 컬럼으로 주문을 만들었을 수도 있다. 메타 업데이트를 한 번
      // 시도하되, 실제로 컬럼이 없는 구 스키마라면 legacy 성공을 그대로 인정한다.
      const paymentSync = await patchExistingPayment(supabaseUrl, serviceKey, full);
      if (paymentSync.saved) return paymentSync;
      return paymentSync.text && isMissingPaymentColumns(paymentSync.text) ? legacy : paymentSync;
    }
    // UNIQUE 충돌은 정상 재확인일 수도 있고, 같은 paymentKey가 다른 주문에 붙은
    // 심각한 충돌일 수도 있다. order_id로 기존 결제 메타만 확인한 뒤 제한적으로 갱신한다.
    if (out.status === 409 || /23505|duplicate key|unique constraint/i.test(out.text)) {
      const existing = await fetchJsonWithTimeout(
        `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(full.order_id)}&select=order_id,payment_key&limit=1`,
        { headers: serviceHeaders(serviceKey) },
        1800
      );
      if (!existing.response.ok) {
        if (isMissingPaymentColumns(existing.text)) return legacySave(supabaseUrl, serviceKey, compatible);
        return { saved: false, reason: "existing_order_check_error" };
      }
      const current = Array.isArray(existing.data) ? existing.data[0] : null;
      if (!current) return { saved: false, reason: "payment_key_conflict" };
      if (current.payment_key && current.payment_key !== full.payment_key) {
        return { saved: false, reason: "order_payment_key_conflict" };
      }
      const paymentPatch = Object.fromEntries(Object.entries({
        paid_amount: full.paid_amount,
        payment_key: full.payment_key,
        payment_status: full.payment_status,
        payment_method: full.payment_method,
        approved_at: full.approved_at,
        receipt_url: full.receipt_url,
      }).filter(([, value]) => value !== null && value !== undefined));
      const updated = await fetchJsonWithTimeout(
        `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(full.order_id)}`,
        {
          method: "PATCH",
          headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=minimal" }),
          body: JSON.stringify(paymentPatch),
        },
        2200
      );
      if (updated.response.ok) return { saved: true, inserted: false, atomic: true };
      return { saved: false, reason: "order_payment_update_error" };
    }
    // 예전 helper의 오류 판별과 호환하되 전체행 PATCH는 하지 않는다.
    if (isMissingOrderUnique(out.text)) return legacySave(supabaseUrl, serviceKey, compatible);
    return { saved: false, reason: "order_upsert_error", status: out.status, detail: out.text.slice(0, 500) };
  } catch (err) {
    return { saved: false, reason: "order_upsert_exception", detail: err && err.message };
  }
}
