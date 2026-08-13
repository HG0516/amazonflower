import crypto from "node:crypto";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";

export function normalizeKoreanMobile(value) {
  const phone = String(value || "").replace(/\D/g, "");
  return /^01[016789]\d{7,8}$/.test(phone) ? phone : "";
}

function authHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** 단일 거래성 문자. 비밀값·전화번호·본문은 반환값이나 로그에 싣지 않는다. */
export async function sendTransactionalText({
  to,
  text,
  subject = "꽃안부 안내",
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 4000,
}) {
  const apiKey = String(env.SOLAPI_API_KEY || "");
  const apiSecret = String(env.SOLAPI_API_SECRET || "");
  const sender = String(env.SOLAPI_SENDER || "").replace(/\D/g, "");
  const recipient = normalizeKoreanMobile(to);
  if (!recipient) return { sent: false, reason: "invalid_phone" };
  if (!apiKey || !apiSecret || !sender) return { sent: false, reason: "env_missing" };

  const body = String(text || "").trim();
  if (!body) return { sent: false, reason: "empty_text" };
  const type = Buffer.byteLength(body, "utf8") > 90 ? "LMS" : "SMS";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(SOLAPI_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(apiKey, apiSecret),
      },
      body: JSON.stringify({
        messages: [{
          to: recipient,
          from: sender,
          text: body,
          type,
          ...(type === "LMS" ? { subject: String(subject || "꽃안부 안내").slice(0, 40) } : {}),
        }],
      }),
      signal: controller.signal,
    });
    // HTTP 2xx에도 registeredFailed가 있을 수 있다. 본문은 판정 후 폐기하고
    // 전화번호·문자 원문·failedMessageList는 반환/로그에 남기지 않는다.
    if (!response.ok) return {
      sent: false, reason: "provider_error", status: response.status,
      ...(response.status === 408 || response.status === 429 || response.status >= 500 ? { uncertain: true } : {}),
    };
    const data = await response.json().catch(() => null);
    const info = data && data.groupInfo || {};
    const count = info.count || data && data.count || {};
    const failed = Number(count.registeredFailed || 0);
    const success = Number(count.registeredSuccess || 0);
    if (!data) return { sent: false, reason: "provider_response_invalid", uncertain: true };
    const hasSuccess = Object.prototype.hasOwnProperty.call(count, "registeredSuccess");
    const hasFailed = Object.prototype.hasOwnProperty.call(count, "registeredFailed");
    if (!hasSuccess || !hasFailed) {
      return { sent: false, reason: "provider_response_invalid", uncertain: true };
    }
    if (failed !== 0 || !Number.isFinite(success) || success < 1) {
      return { sent: false, reason: "provider_rejected" };
    }
    return { sent: true, type };
  } catch {
    return { sent: false, reason: "network_error", uncertain: true };
  } finally {
    clearTimeout(timer);
  }
}

export function buildDeliveryPhotoText(link) {
  return [
    "[꽃안부] 배송을 완료했습니다.",
    `도착 사진 확인: ${String(link || "")}`,
    "사진 링크는 30일 동안 열립니다.",
    "문의 031-314-3003",
  ].join("\n");
}
