// 배송완료 사진 업로드 + 주문자 보안링크 문자.
// - 기사 링크는 주문·만료시각에 결박된 HMAC이며 사진이 없는 주문에 한 번만 쓸 수 있다.
// - 취소 주문은 사진 업로드로 되살리지 않는다. DB 갱신은 이전 사진 경로까지 조건에 넣은 CAS다.
// - 사진은 AI 재촬영 검사를 통과한 뒤에만 주문에 연결한다.
// - 비회원 조회 토큰 원문은 문자에만 넣고 DB에는 SHA-256 해시만 저장한다.

import crypto from "node:crypto";

import { askClaude, extractJson } from "../lib/ai.mjs";
import { authenticateAdmin, requestId, writeAdminAudit } from "../lib/admin-auth.mjs";
import {
  createGuestAccess,
  getPhotoUploadSecret,
  normalizeOrderPhotoPath,
  verifyLegacyUploadToken,
  verifyUploadToken,
} from "../lib/photo-access.mjs";
import {
  claimOrderPhotoNotice,
  finishOrderPhotoNotice,
} from "../lib/order-coordination.mjs";
import {
  buildDeliveryPhotoText,
  normalizeKoreanMobile,
  sendTransactionalText,
} from "../lib/solapi.mjs";

export const config = { runtime: "nodejs" };

const BUCKET = "order-photos";
const MAX_B64 = 4_000_000;
const MAX_BYTES = 3 * 1024 * 1024;
const ACTIVE_STATUSES = new Set(["new", "ordered", "delivered"]);

function publicBaseUrl() {
  const raw = String(process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !local) return "";
    return u.origin;
  } catch { return ""; }
}

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body && typeof body === "object" ? body : {};
}

function validOrderId(value) {
  const oid = String(value || "").trim();
  return /^[A-Za-z0-9._-]{4,64}$/.test(oid) ? oid : "";
}

function decodeJpeg(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== "string") return { error: "사진이 없습니다.", status: 400 };
  if (imageBase64.length > MAX_B64) return { error: "사진 용량이 큽니다. 더 작게 찍어 올려주세요.", status: 413 };
  let buf;
  try { buf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"); }
  catch { return { error: "사진 데이터를 읽을 수 없습니다.", status: 400 }; }
  if (!buf.length || buf.length > MAX_BYTES) return { error: "사진 용량이 큽니다. (3MB 이하)", status: 413 };
  if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return { error: "JPG 이미지만 올릴 수 있어요.", status: 400 };
  return { buf };
}

async function loadOrder(supabaseUrl, serviceKey, oid) {
  const select = [
    "order_id", "status", "canceled_at", "cancel_requested_at", "completed_photo",
    "photo_notice_status", "photo_notice_lease_until",
    "sender_phone", "orderer_phone", "product_label",
  ].join(",");
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&select=${select}&limit=1`,
      { headers: serviceHeaders(serviceKey) },
    );
    if (!response.ok) return { error: "query_failed" };
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return { error: "query_failed" };
    return rows[0] ? { order: rows[0] } : { missing: true };
  } catch { return { error: "query_failed" }; }
}

async function canceledInPaymentLedger(supabaseUrl, serviceKey, oid) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/payment_intents?order_id=eq.${encodeURIComponent(oid)}&select=state,toss_status&limit=1`,
      { headers: serviceHeaders(serviceKey) },
    );
    if (!response.ok) return true; // 새 안전 묶음에서는 확인 실패 시 사진 작업을 닫는다.
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return true;
    const row = rows[0];
    // canceling은 토스 환불 전 outbox가 선점된 상태다. 결과가 확정될 때까지
    // 새 사진을 올리거나 고객 링크를 발급하지 않아야 한다.
    return !!(row && (["canceling", "canceled"].includes(row.state) || row.toss_status === "CANCELED"));
  } catch { return true; }
}

async function deleteObject(supabaseUrl, serviceKey, path) {
  const safePath = normalizeOrderPhotoPath(path);
  if (!safePath) return false;
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURI(safePath)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey),
    });
    return response.ok || response.status === 404;
  } catch { return false; }
}

async function sendCustomerNotice({ order, guestToken, oid, path, supabaseUrl, serviceKey, leaseUntil }) {
  const phone = normalizeKoreanMobile(order.sender_phone) || normalizeKoreanMobile(order.orderer_phone);
  const base = publicBaseUrl();
  const noticeMode = String(process.env.PHOTO_NOTICE_MODE || "auto").trim().toLowerCase();
  const link = base ? `${base}/delivery-photo.html#t=${guestToken}` : "";
  let result;
  if (noticeMode === "manual") {
    result = { sent: false, reason: "manual_mode", noticeStatus: "skipped" };
  } else if (!phone) {
    result = { sent: false, reason: "invalid_phone", noticeStatus: "skipped" };
  } else if (!base) {
    result = { sent: false, reason: "base_url_invalid", noticeStatus: "failed" };
  } else {
    // fragment는 서버 접근로그와 Referer로 전송되지 않는다. 정적 페이지가 읽은 뒤 즉시 지운다.
    const sent = await sendTransactionalText({
      to: phone,
      text: buildDeliveryPhotoText(link),
      subject: "꽃안부 배송완료",
    });
    result = { ...sent, noticeStatus: sent.sent ? "sent" : "failed" };
  }

  // 네트워크 timeout은 공급자가 접수했는지 알 수 없다. 이때 실패로 끝내 lease를
  // 즉시 풀면 환불/재전송 직후 늦은 배송완료 문자가 도착할 수 있으므로, claim의
  // pending 상태와 lease를 만료까지 유지한다.
  if (!result.sent && result.uncertain) {
    await sendTelegram(
      `⚠️ 고객 배송사진 문자 결과 확인 중 — 주문 ${oid}\n`
      + "중복 전송과 환불 경합 방지를 위해 잠시 뒤 다시 확인해주세요.",
    ).catch(() => {});
    return { status: "pending", sent: false, stateSaved: true, uncertain: true };
  }

  const sentAt = result.sent ? new Date().toISOString() : null;
  const finished = await finishOrderPhotoNotice({
    supabaseUrl,
    serviceKey,
    orderId: oid,
    photoPath: path,
    leaseUntil,
    status: result.noticeStatus,
    notifiedAt: sentAt,
    error: result.sent ? null : result.reason,
  });
  const stateSaved = finished.ok && finished.result === "finished";
  if (!stateSaved) await sendTelegram(`⚠️ 배송사진 알림 상태 저장 실패 — 주문 ${oid}`).catch(() => {});
  if (result.reason === "manual_mode" && link) {
    await sendTelegram(
      `📷 배송완료 사진 고객 전달 필요 — 주문 ${oid}\n고객에게 아래 링크를 문자나 카카오톡으로 보내주세요.\n${link}`,
    ).catch(() => {});
  }
  if (!result.sent && result.noticeStatus !== "skipped") {
    await sendTelegram(`⚠️ 고객 배송사진 문자 전송 실패 — 주문 ${oid}\n관리자 화면에서 다시 보내주세요.`).catch(() => {});
  }
  return {
    status: result.noticeStatus,
    sent: !!result.sent,
    stateSaved,
    // SMS 공급자가 아직 설정되지 않은 초기 운영에는 관리자만 이 값을 받아
    // 주문자에게 카카오톡으로 직접 전달할 수 있다. 기사/고객 API 응답에는 내보내지 않는다.
    ...(result.sent ? {} : { guestToken }),
  };
}

function manualGuestLink(notice) {
  const base = publicBaseUrl();
  const token = notice && notice.guestToken;
  return base && token ? `${base}/delivery-photo.html#t=${token}` : null;
}

export async function refreshGuestAccessAndNotify({ order, oid, path, supabaseUrl, serviceKey }) {
  const guest = createGuestAccess();
  // SOLAPI 요청 timeout(4초)보다 넉넉하게 잡는다. 결과 불명확(network error)이면
  // 이 lease가 끝날 때까지 환불/재전송이 기다리므로 늦은 문자와 겹치지 않는다.
  const leaseUntil = new Date(Date.now() + 9 * 60000).toISOString();
  const claim = await claimOrderPhotoNotice({
    supabaseUrl,
    serviceKey,
    orderId: oid,
    photoPath: path,
    tokenHash: guest.tokenHash,
    accessExpiresAt: guest.expiresAt,
    leaseUntil,
  });
  if (!claim.ok) return { error: claim.reason || "notice_claim_failed" };
  if (claim.result !== "claimed") return { error: claim.result || "notice_claim_failed", leaseUntil: claim.row && claim.row.lease_until };
  return sendCustomerNotice({ order, guestToken: guest.token, oid, path, supabaseUrl, serviceKey, leaseUntil });
}

export default async function handler(req, res) {
  const origin = publicBaseUrl();
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST 요청만 지원합니다." });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "업로드 기능이 아직 설정되지 않았습니다." });

  const body = parseBody(req);
  const oid = validOrderId(body.orderId);
  if (!oid) return res.status(400).json({ error: "주문번호가 올바르지 않습니다." });

  const adminAuth = await authenticateAdmin(req, body, {
    supabaseUrl,
    serviceKey,
    allowLegacy: true,
  });
  const isAdmin = adminAuth.ok;
  const uploadSecret = getPhotoUploadSecret();
  const uploadAuth = verifyUploadToken({
    orderId: oid,
    expiresAt: body.expiresAt,
    token: body.token,
    secret: uploadSecret,
  });
  const legacyUploadAuth = !body.expiresAt
    ? verifyLegacyUploadToken({ orderId: oid, token: body.token })
    : { ok: false, reason: "not_legacy" };

  // 수동 재전송은 기존 관리자 비밀번호 경로만 허용한다. 관리자 인증 통합 뒤에도 이 분기만 교체하면 된다.
  if (body.action === "notify") {
    if (!isAdmin) return res.status(401).json({ error: "권한이 없습니다." });
    const loaded = await loadOrder(supabaseUrl, serviceKey, oid);
    if (loaded.error) return res.status(502).json({ error: "주문을 확인하지 못했습니다. 잠시 후 다시 시도해주세요." });
    if (loaded.missing) return res.status(404).json({ error: "그 주문번호를 찾을 수 없어요." });
    const order = loaded.order;
    const path = normalizeOrderPhotoPath(order.completed_photo);
    if (order.status === "canceled" || order.canceled_at || order.cancel_requested_at || await canceledInPaymentLedger(supabaseUrl, serviceKey, oid)) return res.status(409).json({ error: "취소 중이거나 취소된 주문에는 사진을 보낼 수 없습니다." });
    if (order.status !== "delivered" || !path) return res.status(409).json({ error: "전송할 배송완료 사진이 없습니다." });
    const notice = await refreshGuestAccessAndNotify({ order, oid, path, supabaseUrl, serviceKey });
    if (notice.error === "photo_notice_busy") return res.status(409).json({ error: "이 사진 링크를 이미 보내고 있습니다. 잠시 후 상태를 확인해주세요." });
    if (notice.error === "cancel_in_progress") return res.status(409).json({ error: "취소 중이거나 취소된 주문에는 사진을 보낼 수 없습니다." });
    if (notice.error) return res.status(502).json({ error: "사진 링크를 다시 만들지 못했습니다." });
    return res.status(200).json({
      ok: true,
      notice: { status: notice.status, sent: notice.sent, stateSaved: notice.stateSaved },
      manualLink: manualGuestLink(notice),
    });
  }

  if (!isAdmin && !uploadAuth.ok && !legacyUploadAuth.ok) {
    if (uploadAuth.reason === "secret_missing") return res.status(503).json({ error: "기사 링크 설정이 필요합니다." });
    if (uploadAuth.reason === "expired" || legacyUploadAuth.reason === "legacy_expired") return res.status(410).json({ error: "사진 업로드 링크가 만료되었습니다. 꽃안부에 새 링크를 요청해주세요." });
    return res.status(401).json({ error: "권한이 없습니다. 링크를 다시 확인해주세요." });
  }

  const decoded = decodeJpeg(body.imageBase64);
  if (decoded.error) return res.status(decoded.status).json({ error: decoded.error });

  const loaded = await loadOrder(supabaseUrl, serviceKey, oid);
  if (loaded.error) return res.status(502).json({ error: "주문을 확인하지 못했습니다. 잠시 후 다시 시도해주세요." });
  if (loaded.missing) return res.status(404).json({ error: "그 주문번호를 찾을 수 없어요. 번호를 확인해주세요." });
  const order = loaded.order;
  if (order.status === "canceled" || order.canceled_at || order.cancel_requested_at || await canceledInPaymentLedger(supabaseUrl, serviceKey, oid)) {
    return res.status(409).json({ error: "취소된 주문에는 사진을 올릴 수 없습니다." });
  }
  if (!ACTIVE_STATUSES.has(order.status)) return res.status(409).json({ error: "현재 주문 상태에서는 사진을 올릴 수 없습니다." });

  const originalDbPath = order.completed_photo ? String(order.completed_photo) : "";
  const oldObjectPath = normalizeOrderPhotoPath(originalDbPath);
  if (!isAdmin && originalDbPath) {
    return res.status(409).json({ error: "이미 도착 사진이 등록된 주문입니다. 교체는 꽃안부에 요청해주세요." });
  }
  if (isAdmin && originalDbPath && body.replace !== true) {
    return res.status(409).json({ error: "이미 사진이 있습니다. 교체하려면 확인 후 다시 시도해주세요.", code: "REPLACE_CONFIRM_REQUIRED" });
  }

  const path = `${oid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  let uploadResponse;
  let warn = null;
  try {
    [uploadResponse, warn] = await Promise.all([
      fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
        method: "POST",
        headers: {
          ...serviceHeaders(serviceKey),
          "Content-Type": "image/jpeg",
          "x-upsert": "false",
        },
        body: decoded.buf,
      }),
      inspectPhoto(decoded.buf).catch(() => null),
    ]);
  } catch {
    return res.status(502).json({ error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." });
  }
  if (!uploadResponse.ok) return res.status(502).json({ error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." });

  // 관리자가 명시적으로 강제하지 않은 이상 경고 사진은 주문에 연결하거나 고객에게 보내지 않는다.
  if (warn && !(isAdmin && body.force === true)) {
    await deleteObject(supabaseUrl, serviceKey, path);
    await sendTelegram(`⚠️ 배송사진 재촬영 요청 — 주문 ${oid}\n${warn}`).catch(() => {});
    return res.status(422).json({ error: warn, warn, code: "PHOTO_RETAKE" });
  }

  const nowIso = new Date().toISOString();
  const oldGuard = originalDbPath
    ? `completed_photo=eq.${encodeURIComponent(originalDbPath)}`
    : "completed_photo=is.null";
  let committed = false;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}`
        + `&status=neq.canceled&canceled_at=is.null&cancel_requested_at=is.null&${oldGuard}&select=order_id`,
      {
        method: "PATCH",
        headers: {
          ...serviceHeaders(serviceKey),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          completed_photo: path,
          completed_at: nowIso,
          status: "delivered",
          // 새 사진을 연결하는 순간 이전 사진의 고객 링크를 폐기한다. 실제 새
          // 토큰/lease는 claim_order_photo_notice RPC가 환불 원장과 함께 선점한다.
          photo_access_token_hash: null,
          photo_access_expires_at: null,
          photo_notice_status: "pending",
          photo_notice_photo: path,
          photo_notified_at: null,
          photo_notice_lease_until: null,
        }),
      },
    );
    if (response.ok) {
      const rows = await response.json().catch(() => []);
      committed = Array.isArray(rows) && rows.length === 1;
    }
  } catch { committed = false; }

  if (!committed) {
    await deleteObject(supabaseUrl, serviceKey, path);
    return res.status(409).json({ error: "주문 상태가 바뀌어 사진을 연결하지 못했습니다. 주문을 새로 확인해주세요." });
  }

  // 빠른 실패/운영 가시성을 위한 사전 확인이다. 실제 문자와 환불 시작의
  // 상호배타성은 바로 아래 claim_order_photo_notice RPC가 같은 주문 잠금으로 보장한다.
  if (await canceledInPaymentLedger(supabaseUrl, serviceKey, oid)) {
    await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&completed_photo=eq.${encodeURIComponent(path)}`,
      {
        method: "PATCH",
        headers: { ...serviceHeaders(serviceKey), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ photo_notice_status: "skipped", photo_notify_error: "cancel_in_progress" }),
      },
    ).catch(() => {});
    return res.status(409).json({ error: "환불 절차가 시작되어 고객에게 배송완료 문자를 보내지 않았습니다." });
  }

  if (oldObjectPath && oldObjectPath !== path) {
    const removed = await deleteObject(supabaseUrl, serviceKey, oldObjectPath);
    if (!removed) await sendTelegram(`⚠️ 교체 전 배송사진 정리 실패 — 주문 ${oid}`).catch(() => {});
  }

  const notice = await refreshGuestAccessAndNotify({
    order,
    oid,
    path,
    supabaseUrl,
    serviceKey,
  });
  if (notice.error === "cancel_in_progress") {
    await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&completed_photo=eq.${encodeURIComponent(path)}`,
      {
        method: "PATCH",
        headers: { ...serviceHeaders(serviceKey), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ photo_notice_status: "skipped", photo_notify_error: "cancel_in_progress" }),
      },
    ).catch(() => {});
    return res.status(409).json({ error: "환불 절차가 시작되어 고객에게 배송완료 문자를 보내지 않았습니다." });
  }
  if (notice.error === "photo_notice_busy") {
    // 관리자 재전송이 먼저 lease를 잡은 경우다. 사진 저장은 성공했고 그 한
    // 작업만 문자를 보내므로 업로드 자체를 실패로 보이지 않는다.
    return res.status(200).json({ ok: true, warn: null, notice: { status: "pending", sent: false, stateSaved: true } });
  }
  if (notice.error) {
    await sendTelegram(`⚠️ 배송사진 알림 선점 실패 — 주문 ${oid}\n${notice.error}`).catch(() => {});
    return res.status(502).json({ error: "사진은 저장했지만 고객 알림을 시작하지 못했습니다. 관리자 화면에서 다시 보내주세요." });
  }
  if (isAdmin) {
    await writeAdminAudit({
      supabaseUrl,
      serviceKey,
      auth: adminAuth,
      action: originalDbPath ? "replace" : "upload",
      resource: "order_photo",
      targetId: oid,
      outcome: "success",
      detail: `notice=${notice.status}`,
      requestId: requestId(req),
    });
  }
  return res.status(200).json({
    ok: true,
    warn: null,
    notice: { status: notice.status, sent: notice.sent, stateSaved: notice.stateSaved },
    ...(isAdmin ? { manualLink: manualGuestLink(notice) } : {}),
  });
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: tag + text, disable_web_page_preview: true }),
    });
    return response.ok;
  } catch { return false; }
}

/** 취향이 아니라 현장에서 바로 다시 찍어야 할 명백한 문제만 찾는다. */
async function inspectPhoto(buf) {
  const response = await askClaude({
    maxTokens: 200,
    timeoutMs: 8000,
    system:
      "너는 화환·꽃 배송완료 사진을 검수한다. 기사님이 현장에서 다시 찍어야 할 정도의 문제만 지적한다.\n"
      + "지적할 것: (1) 화환이 넘어졌거나 크게 기울었다 (2) 너무 어둡거나 흔들려 무엇인지 알아볼 수 없다 (3) 리본 글자가 가려지거나 잘렸다 (4) 꽃이나 화환이 사진에 없다.\n"
      + "지적하지 않을 것: 구도, 배경 정리 상태, 조명 취향, 사소한 각도.\n"
      + '문제가 없으면 {"warn":null} 만 출력한다. 있으면 {"warn":"무엇이 문제인지와 어떻게 다시 찍을지 한 문장, 존댓말"} 형식의 JSON만 출력한다. 설명·마크다운 금지.',
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } },
      { type: "text", text: "이 배송완료 사진을 검수해 주세요." },
    ],
  });
  if (!response.ok) return null;
  const parsed = extractJson(response.text);
  return parsed && typeof parsed.warn === "string" && parsed.warn.trim()
    ? parsed.warn.trim().slice(0, 200)
    : null;
}
