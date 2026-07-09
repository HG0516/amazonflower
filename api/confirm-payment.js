// api/confirm-payment.js
// 토스페이먼츠 결제 승인 + 금액 위변조 검증 + 사장님(어머니) 두 분께 문자 알림.
// 보안: TOSS_SECRET_KEY, SOLAPI 키는 이 서버 함수 안에서만 사용된다. 프론트에 절대 노출 금지.
//
// 알림 정책 (중요):
//  - 알림은 사장님(OWNER_PHONE_1, OWNER_PHONE_2)에게만 발송한다.
//  - 화환 제작/배송 하청 업체에게는 절대 자동 발송하지 않는다. (마진/단가 노출 방지, 사장님 검수 단계 보존)
//  - 사장님이 주문을 직접 확인하고 본인 판단으로 거래처에 발주한다.
//  - 알림 문자에는 발주 복붙용 정리 정보 + 원문(URL/텍스트)을 함께 담아 사장님이 더블체크할 수 있게 한다.

import { priceOf, TOPPINGS as TOPPINGS_SRC, PRODUCTS } from "../products.mjs";

export const config = {
  runtime: "nodejs",
};

const TOSS_CONFIRM_URL = "https://api.tosspayments.com/v1/payments/confirm";
const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";

// 상품 정가·토핑 = products.mjs 단일 소스에서 읽는다 (하드코딩 제거, 프롬프트2).
//  - priceOf(code): 신규 개별상품(PL-001 등)과 구 티어코드(plant_p2 등) 모두 정가 반환 → 하위호환.
//  - 금액 위변조 검증은 프론트가 보낸 금액을 믿지 않고 이 정가와 대조한다.
const TOPPING_LABELS = Object.fromEntries(
  Object.entries(TOPPINGS_SRC).map(([k, v]) => [k, v.nm])
);

const PRODUCT_LABELS = {
  congrats_g1: "축하화환 일반형 (AF-G01)",
  congrats_g2: "축하화환 중급형 (AF-G02)",
  congrats_g3: "축하화환 고급형 (AF-G03)",
  congrats_g4: "축하화환 최고급형 (AF-G04)",
  condolence_c1: "근조화환 일반형 (AF-C01)",
  condolence_c2: "근조화환 중급형 (AF-C02)",
  condolence_c3: "근조화환 고급형 (AF-C03)",
  condolence_c4: "근조화환 최고급형 (AF-C04)",
  orchid_o1: "동양란 기본 (AF-O01)",
  orchid_o2: "동양란 고급 (AF-O02)",
  orchid_o3: "서양란(호접란) 기본 (AF-O03)",
  orchid_o4: "서양란(호접란) 고급 (AF-O04)",
  plant_p1: "관엽식물 일반형 (AF-P01)",
  plant_p2: "관엽식물 중급형 (AF-P02)",
  plant_p3: "관엽식물 고급형 (AF-P03)",
  plant_p4: "관엽식물 특대형 (AF-P04)",
  basket_b1: "꽃다발 기본 (AF-B01)",
  basket_b2: "꽃다발 고급 (AF-B02)",
  basket_b3: "꽃바구니 기본 (AF-B03)",
  basket_b4: "꽃바구니 고급 (AF-B04)",
};

// ── 솔라피 HMAC-SHA256 서명 (Node crypto) ───────────────────────────────
import crypto from "crypto";

function buildSolapiAuthHeader(apiKey, apiSecret) {
  const dateTime = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(dateTime + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

// 사장님께 보낼 문자 본문 구성 (발주 복붙용 + 원문 대조용)
// 프론트 order 객체의 실제 키(venue, ribbonLeft/Right, senderName/Phone, src)를 우선 사용하고,
// 혹시 모를 구버전 키(venueName, ribbonText, ordererName...)도 함께 지원한다.
function buildOwnerMessage(order, payment) {
  const lines = [];
  lines.push("[새 주문] 꽃안부");
  lines.push("");
  lines.push(`상품: ${order.productLabel || "-"}`);
  if (order.quantity && Number(order.quantity) > 1) lines.push(`수량: ${order.quantity}개`);
  const tops = Array.isArray(order.toppings) ? order.toppings : [];
  if (tops.length) {
    lines.push(`얹기: ${tops.map((t) => TOPPING_LABELS[t] || t).join(" · ")}`);
  }
  lines.push(`결제금액: ${Number(payment.totalAmount).toLocaleString()}원`);
  if (order.recipientName) lines.push(`받는분: ${order.recipientName}`);
  const venueName = order.venue || order.venueName;
  if (venueName) {
    let place = venueName;
    if (order.venueDetail) place += ` ${order.venueDetail}`;
    lines.push(`장소: ${place}`);
  }
  const addr = order.address || order.venueAddress;
  if (addr) lines.push(`주소: ${addr}`);
  if (order.date) lines.push(`일시: ${order.date}${order.time ? " " + order.time : ""}`);
  if (order.delivReq) lines.push(`배송요청: ${order.delivReq}`);
  if (order.entrancePw) lines.push(`공동현관: ${order.entrancePw}`);
  const ribbon =
    order.ribbonText ||
    [order.ribbonLeft, order.ribbonRight].filter(Boolean).join(" / ");
  if (ribbon) lines.push(`리본문구: ${ribbon}`);
  if (order.senderNote) lines.push(`부탁: ${order.senderNote}`);
  lines.push("");
  const orderer = order.senderName || order.ordererName;
  const ordererPhone = order.senderPhone || order.ordererPhone;
  lines.push(`주문자: ${orderer || "-"} ${ordererPhone || ""}`.trim());
  if (order.buyerType === "corp" && order.corpName) {
    lines.push(`법인: ${order.corpName} (${order.corpRegNo || "-"}) 계산서→${order.corpEmail || "-"}`);
  }
  lines.push(`주문번호: ${payment.orderId}`);

  // ── 원문 대조용 ──
  lines.push("");
  lines.push("─ 원문(대조용) ─");
  const srcUrl = order.sourceUrl || (typeof order.src === "string" && /^https?:\/\//i.test(order.src) ? order.src : "");
  const srcText = order.sourceText || (!srcUrl ? order.src : "");
  if (srcUrl) {
    lines.push(srcUrl);
  }
  if (srcText) {
    // 너무 길면 잘라서 담는다 (전체 원문은 주문 데이터/관리자에서 확인)
    const t = String(srcText).replace(/\s+/g, " ").trim();
    lines.push(t.length > 600 ? t.slice(0, 600) + " …(이하 생략)" : t);
  }
  if (!srcUrl && !srcText) {
    lines.push("(원문 없음 - 직접 입력 주문)");
  }

  return lines.join("\n");
}

async function notifyOwners(order, payment) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const sender = process.env.SOLAPI_SENDER; // 사전 등록된 발신번호
  const owner1 = process.env.OWNER_PHONE_1;
  const owner2 = process.env.OWNER_PHONE_2;

  // 키/번호가 없으면 알림은 건너뛰되 결제는 정상 완료로 처리 (초기 테스트 안전장치)
  if (!apiKey || !apiSecret || !sender) {
    console.warn("SOLAPI 환경변수 미설정 → 사장님 알림 생략");
    return { sent: false, reason: "solapi_env_missing" };
  }

  const recipients = [owner1, owner2].filter(
    (p) => p && String(p).trim()
  );
  if (recipients.length === 0) {
    console.warn("OWNER_PHONE 미설정 → 사장님 알림 생략");
    return { sent: false, reason: "owner_phone_missing" };
  }

  const textBody = buildOwnerMessage(order, payment);
  // 90바이트 초과 시 LMS(장문)로. 한글 포함이라 거의 항상 LMS가 됨.
  const byteLen = Buffer.byteLength(textBody, "utf8");
  const msgType = byteLen > 90 ? "LMS" : "SMS";

  const messages = recipients.map((to) => ({
    to: String(to).replace(/[^0-9]/g, ""),
    from: String(sender).replace(/[^0-9]/g, ""),
    text: textBody,
    type: msgType,
    ...(msgType === "LMS" ? { subject: "꽃안부 새 주문" } : {}),
  }));

  try {
    const authHeader = buildSolapiAuthHeader(apiKey, apiSecret);
    const res = await fetch(SOLAPI_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("SOLAPI 발송 실패:", res.status, data);
      return { sent: false, reason: "solapi_error", detail: data };
    }
    return { sent: true, count: recipients.length };
  } catch (err) {
    console.error("SOLAPI 발송 예외:", err);
    return { sent: false, reason: "solapi_exception", detail: err.message };
  }
}

// 사장님께 텔레그램으로도 주문 알림 (문자와 같은 본문). 봇 토큰/챗id 없으면 생략(결제는 정상).
// TELEGRAM_BOT_TOKEN(BotFather), TELEGRAM_CHAT_ID(개인/그룹), PROJECT_TAG(선택) 를 Vercel env에 설정.
async function notifyTelegram(order, payment) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("텔레그램 환경변수 미설정 → 텔레그램 알림 생략");
    return { sent: false, reason: "telegram_env_missing" };
  }
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  const text = tag + buildOwnerMessage(order, payment);
  // 발주 누락방지: '발주 완료 처리' 버튼. 누르면 status=ordered 가 되어 마감 경고 대상에서 빠진다.
  let reply_markup;
  const oid = payment.orderId || "";
  const cs = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
  if (oid && cs) {
    const tk = crypto.createHmac("sha256", cs).update("confirm:" + oid).digest("hex").slice(0, 20);
    const base = process.env.PUBLIC_BASE_URL || "https://amazonflower.vercel.app";
    reply_markup = { inline_keyboard: [[
      { text: "✅ 발주 완료 처리", url: `${base}/api/order-confirm?id=${encodeURIComponent(oid)}&t=${tk}` },
      { text: "📷 완료사진", url: `${base}/admin-order?order=${encodeURIComponent(oid)}` }
    ]] };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      console.error("텔레그램 발송 실패:", res.status, data);
      return { sent: false, reason: "telegram_error", detail: data };
    }
    return { sent: true };
  } catch (err) {
    console.error("텔레그램 발송 예외:", err);
    return { sent: false, reason: "telegram_exception", detail: err.message };
  }
}

// 로그인 사용자 식별 — Authorization: Bearer <access_token> 을 Supabase로 검증해 user.id 반환.
// 없거나 검증 실패면 null(비회원 주문). 프론트가 보낸 값을 믿지 않고 서버가 토큰을 직접 검증한다.
async function getUserId(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u.id : null;
  } catch (e) {
    return null;
  }
}

// 주문을 Supabase orders에 저장 — 배송사진 회신·마감알림의 토대. 실패해도 결제엔 영향 없음.
// (개인정보 포함 → RLS로 공개읽기 차단된 테이블, service_role 로만 기록)
async function saveOrder(order, payment) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn("Supabase env 미설정 → 주문 저장 생략");
    return { saved: false, reason: "supabase_env_missing" };
  }
  // 식/발인 시각 계산 (date:YYYY-MM-DD, time:HH:MM, 한국시간)
  // YYYY.MM.DD / YYYY/MM/DD / 한자리 월·일도 정규화해 조용한 누락 방지
  let eventAt = null;
  const t = String(order.time || "").trim();
  let d = String(order.date || "").trim().replace(/[.\/]/g, "-").replace(/-+$/, "");
  const dm = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dm) {
    d = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
    const dt = new Date(`${d}T${/^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : "00:00"}:00+09:00`);
    if (!isNaN(dt.getTime())) eventAt = dt.toISOString();
  } else {
    d = String(order.date || "").trim(); // 정규화 실패 시 원본 보존
  }
  const row = {
    order_id: payment.orderId || null,
    product_label: order.productLabel || null,
    product_code: order.productCode || null,
    amount: Number(payment.totalAmount) || null,
    price: Number(order.price) || null,                 // 상품 정가(단가)
    paid_amount: Number(payment.totalAmount) || null,   // 실제 결제금액
    discount_points: Number(order.discount_points) || 0,
    category: order.category || null,
    order_type: order.type || null,
    recipient_name: order.recipientName || null,
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
    // 유입 채널(전단 QR·검색광고 성과 집계) — 클라이언트가 localStorage에 담아 보낸 값
    utm_source: String(order.utmSource || "").slice(0, 64) || null,
    utm_medium: String(order.utmMedium || "").slice(0, 64) || null,
    utm_campaign: String(order.utmCampaign || "").slice(0, 64) || null,
  };
  try {
    // 멱등: 같은 order_id 가 이미 저장돼 있으면 재삽입·재알림 안 함(isNew:false)
    if (row.order_id) {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(row.order_id)}&select=order_id&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      if (chk.ok) {
        const exist = await chk.json().catch(() => []);
        if (Array.isArray(exist) && exist.length) {
          return { saved: true, isNew: false, reason: "duplicate" };
        }
      }
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.error("주문 저장 실패:", r.status, await r.text().catch(() => ""));
      return { saved: false, reason: "insert_error" };
    }
    return { saved: true, isNew: true };
  } catch (err) {
    console.error("주문 저장 예외:", err);
    return { saved: false, reason: "exception", detail: err.message };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return res
      .status(500)
      .json({ error: "서버에 TOSS_SECRET_KEY가 설정되지 않았습니다." });
  }

  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    body = body || {};

    const { paymentKey, orderId, amount, order } = body;

    if (!paymentKey || !orderId || amount == null) {
      return res
        .status(400)
        .json({ error: "paymentKey, orderId, amount가 필요합니다." });
    }

    // ── 1. 금액 위변조 검증 ──────────────────────────────
    // 프론트가 보낸 amount를 그대로 믿지 않는다.
    // order.productCode 기준 정가와 대조한다.
    const productCode = order && order.productCode;
    const basePrice = priceOf(productCode);
    if (basePrice == null) {
      return res
        .status(400)
        .json({ error: "알 수 없는 상품입니다.", productCode });
    }
    // 토핑 합산 (중복 제거 + 알 수 없는 코드 거부)
    const toppings = Array.isArray(order && order.toppings)
      ? [...new Set(order.toppings)]
      : [];
    let toppingSum = 0;
    for (const t of toppings) {
      const tp = TOPPINGS_SRC[t] ? TOPPINGS_SRC[t].price : null;
      if (tp == null) {
        return res
          .status(400)
          .json({ error: "알 수 없는 추가 옵션입니다.", topping: t });
      }
      toppingSum += tp;
    }
    // 수량(같은 상품 여러 개). 정수 1~99만 허용.
    const qty = parseInt(order && order.quantity, 10);
    const quantity = Number.isFinite(qty) && qty >= 1 && qty <= 99 ? qty : 1;
    if (order && order.quantity != null && !(Number.isFinite(qty) && qty >= 1 && qty <= 99)) {
      return res.status(400).json({ error: "수량이 올바르지 않습니다." });
    }
    const expectedPrice = (basePrice + toppingSum) * quantity;
    if (Number(amount) !== expectedPrice) {
      console.error(
        `금액 불일치: 요청 ${amount} vs 정가 ${expectedPrice} (${productCode} x${quantity} + [${toppings.join(",")}])`
      );
      return res.status(400).json({
        error: "결제 금액이 상품 가격과 일치하지 않습니다.",
      });
    }

    // ── 2. 토스 결제 승인 ────────────────────────────────
    const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");
    const confirmRes = await fetch(TOSS_CONFIRM_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });

    const payment = await confirmRes.json();

    if (!confirmRes.ok) {
      // 이미 승인된 결제(완료화면 새로고침·뒤로가기 재진입) → 오류가 아님.
      // 기존 결제를 조회해 '완료'로 응답하고, 재저장·재알림은 하지 않는다(중복 주문/중복 문자 방지).
      if (payment.code === "ALREADY_PROCESSED_PAYMENT") {
        try {
          const look = await fetch(
            `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`,
            { headers: { Authorization: `Basic ${basicAuth}` } }
          );
          if (look.ok) {
            const pay2 = await look.json();
            return res.status(200).json({
              ok: true,
              alreadyDone: true,
              payment: {
                orderId: pay2.orderId,
                totalAmount: pay2.totalAmount,
                method: pay2.method,
                approvedAt: pay2.approvedAt,
                receiptUrl: pay2.receipt && pay2.receipt.url,
              },
            });
          }
        } catch (_e) {}
        // 조회 실패해도 재출금은 없으므로 최소한 완료로 처리
        return res.status(200).json({ ok: true, alreadyDone: true, payment: { orderId } });
      }
      // 그 외 거절 (금액 불일치·만료 등)
      console.error("토스 승인 실패:", confirmRes.status, payment);
      return res.status(confirmRes.status).json({
        error: payment.message || "결제 승인에 실패했습니다.",
        code: payment.code,
      });
    }

    // ── 3. 사장님(어머니) 두 분께 알림 (하청 X) ───────────
    const userId = await getUserId(req);
    const orderInfo = {
      ...(order || {}),
      productLabel:
        (order && order.productLabel) ||
        PRODUCT_LABELS[productCode] ||
        (PRODUCTS.find((p) => p.pc === productCode) || {}).name ||
        productCode,
      user_id: userId,
    };
    // 저장을 먼저(멱등) — 같은 주문이 이미 있으면 문자·텔레그램 재발송을 건너뛴다(중복 알림 방지).
    // 저장은 실패해도 결제엔 영향 없음.
    const saveResult = await saveOrder(orderInfo, payment);
    const isDuplicate = saveResult && saveResult.isNew === false;
    let smsResult = null, telegramResult = null;
    if (!isDuplicate) {
      [smsResult, telegramResult] = await Promise.all([
        notifyOwners(orderInfo, payment),
        notifyTelegram(orderInfo, payment),
      ]);
    }

    // 알림 실패해도 결제는 성공 처리 (결제는 이미 승인됨)
    return res.status(200).json({
      ok: true,
      payment: {
        orderId: payment.orderId,
        totalAmount: payment.totalAmount,
        method: payment.method,
        approvedAt: payment.approvedAt,
        receiptUrl: payment.receipt && payment.receipt.url,
      },
      notified: { sms: smsResult, telegram: telegramResult },
      saved: saveResult,
    });
  } catch (err) {
    console.error("confirm-payment error:", err);
    return res
      .status(500)
      .json({ error: err.message || "알 수 없는 오류가 발생했습니다." });
  }
}
