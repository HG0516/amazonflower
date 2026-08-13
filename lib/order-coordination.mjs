// 주문 단위의 외부 작업(배송사진 문자·환불 시작)을 같은 DB 잠금 아래 조정한다.
// 실제 상호배타성은 supabase-first-bundle.sql의 coordination RPC가 보장한다.

import { fetchJsonWithTimeout, serviceHeaders } from "./payment-integrity.mjs";

function firstResult(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === "object" ? data : null;
}

async function callCoordinationRpc(supabaseUrl, serviceKey, name, body, timeoutMs = 2500) {
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: "supabase_env_missing" };
  try {
    const { response, data, text } = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: /PGRST202|42883|does not exist|schema cache/i.test(String(text || ""))
          ? "coordination_rpc_unavailable"
          : "coordination_rpc_failed",
      };
    }
    const row = firstResult(data);
    if (!row || typeof row.result !== "string") return { ok: false, reason: "coordination_rpc_invalid_response" };
    return { ok: true, result: row.result, row };
  } catch (error) {
    return { ok: false, reason: "coordination_rpc_exception", detail: error && error.message };
  }
}

export function claimOrderPhotoNotice({
  supabaseUrl,
  serviceKey,
  orderId,
  photoPath,
  tokenHash,
  accessExpiresAt,
  leaseUntil,
}) {
  return callCoordinationRpc(supabaseUrl, serviceKey, "claim_order_photo_notice", {
    p_order_id: orderId,
    p_photo_path: photoPath,
    p_token_hash: tokenHash,
    p_access_expires_at: accessExpiresAt,
    p_lease_until: leaseUntil,
  });
}

export function finishOrderPhotoNotice({
  supabaseUrl,
  serviceKey,
  orderId,
  photoPath,
  leaseUntil,
  status,
  notifiedAt = null,
  error = null,
}) {
  return callCoordinationRpc(supabaseUrl, serviceKey, "finish_order_photo_notice", {
    p_order_id: orderId,
    p_photo_path: photoPath,
    p_lease_until: leaseUntil,
    p_notice_status: status,
    p_notified_at: notifiedAt,
    p_error: error,
  });
}

// api/admin.js의 환불 시작점에서 사용한다. 이 RPC가 성공하기 전에는 Toss
// cancel API를 호출하면 안 된다. `photo_notice_busy`면 문자 lease가 끝난 뒤 재시도한다.
export function beginOrderCancellation({
  supabaseUrl,
  serviceKey,
  orderId,
  paymentKey,
  expectedAmount,
  orderData,
  orderHash,
  tossStatus,
  paymentMethod = null,
  approvedAt = null,
  receiptUrl = null,
  alreadyCanceled = false,
  allowDelivered = false,
  holdOnly = false,
}) {
  return callCoordinationRpc(supabaseUrl, serviceKey, "begin_order_cancellation", {
    p_order_id: orderId,
    p_payment_key: paymentKey,
    p_expected_amount: expectedAmount,
    p_order_data: orderData,
    p_order_hash: orderHash,
    p_toss_status: tossStatus,
    p_payment_method: paymentMethod,
    p_approved_at: approvedAt,
    p_receipt_url: receiptUrl,
    p_already_canceled: alreadyCanceled,
    p_allow_delivered: allowDelivered,
    p_hold_only: holdOnly,
  });
}
