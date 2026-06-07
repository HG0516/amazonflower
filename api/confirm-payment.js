// api/confirm-payment.js
// 토스페이먼츠 결제 승인 + 금액 위변조 검증 + 사장님(어머니) 두 분께 문자 알림.
// 보안: TOSS_SECRET_KEY, SOLAPI 키는 이 서버 함수 안에서만 사용된다. 프론트에 절대 노출 금지.
//
// 알림 정책 (중요):
//  - 알림은 사장님(OWNER_PHONE_1, OWNER_PHONE_2)에게만 발송한다.
//  - 화환 제작/배송 하청 업체에게는 절대 자동 발송하지 않는다. (마진/단가 노출 방지, 사장님 검수 단계 보존)
//  - 사장님이 주문을 직접 확인하고 본인 판단으로 거래처에 발주한다.
//  - 알림 문자에는 발주 복붙용 정리 정보 + 원문(URL/텍스트)을 함께 담아 사장님이 더블체크할 수 있게 한다.

export const config = {
  runtime: "nodejs",
};

const TOSS_CONFIRM_URL = "https://api.tosspayments.com/v1/payments/confirm";
const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";

// 화환 상품 정가 (서버에서 금액 위변조를 검증하기 위한 신뢰 가능한 가격표)
// 프론트가 보낸 금액을 그대로 믿지 않고, orderId/상품코드 기준으로 서버가 다시 확인한다.
const PRODUCT_PRICES = {
  // 축하화환 (등급제 4단계)
  congrats_g1: 59000,   // 일반형 (3단 기본)
  congrats_g2: 79000,   // 중급형 (3단 풍성)
  congrats_g3: 99000,   // 고급형 (3단 고급)
  congrats_g4: 129000,  // 최고급형 (4단 특대)
  // 근조화환 (등급제 4단계)
  condolence_c1: 59000, // 일반형 (3단 기본)
  condolence_c2: 79000, // 중급형 (3단 풍성)
  condolence_c3: 99000, // 고급형 (3단 고급)
  condolence_c4: 129000,// 최고급형 (4단 특대)
  // 동양란·서양란 ※ 임시 정찰가 — 확정 시 index.html/catalog.html 과 같이 수정
  orchid_o1: 69000,     // 동양란 기본
  orchid_o2: 99000,     // 동양란 고급
  orchid_o3: 79000,     // 서양란(호접란) 기본
  orchid_o4: 119000,    // 서양란(호접란) 고급
  // 관엽식물 ※ 임시 정찰가
  plant_p1: 59000,      // 일반형 (테이블)
  plant_p2: 79000,      // 중급형 (개업 표준)
  plant_p3: 99000,      // 고급형 (중대형)
  plant_p4: 129000,     // 특대형 (로비급)
  // 꽃바구니·꽃다발 ※ 임시 정찰가
  basket_b1: 49000,     // 꽃다발 기본
  basket_b2: 69000,     // 꽃다발 고급
  basket_b3: 59000,     // 꽃바구니 기본
  basket_b4: 89000,     // 꽃바구니 고급
};

// 마음 얹기(토핑) 정가 — index.html 의 TOPPINGS 와 반드시 일치시킬 것 (※ 임시 가격)
const TOPPING_PRICES = {
  top_rice: 20000,    // 쌀 10kg
  top_ribbon: 10000,  // 금박 고급 리본
  top_pot: 20000,     // 도자기 분 업그레이드
  top_plaque: 10000,  // 나무 명패
  top_more: 20000,    // 더 풍성하게
  top_wine: 30000,    // 와인 동봉
  top_card: 5000,     // 손글씨 카드
};
const TOPPING_LABELS = {
  top_rice: "쌀 10kg 얹기",
  top_ribbon: "금박 고급 리본",
  top_pot: "도자기 분 업그레이드",
  top_plaque: "나무 명패",
  top_more: "더 풍성하게",
  top_wine: "와인 동봉",
  top_card: "손글씨 카드",
};

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
    const basePrice = PRODUCT_PRICES[productCode];
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
      const tp = TOPPING_PRICES[t];
      if (tp == null) {
        return res
          .status(400)
          .json({ error: "알 수 없는 추가 옵션입니다.", topping: t });
      }
      toppingSum += tp;
    }
    const expectedPrice = basePrice + toppingSum;
    if (Number(amount) !== expectedPrice) {
      console.error(
        `금액 불일치: 요청 ${amount} vs 정가 ${expectedPrice} (${productCode} + [${toppings.join(",")}])`
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
      // 토스가 거절한 경우 (이미 처리됨, 금액 불일치, 만료 등)
      console.error("토스 승인 실패:", confirmRes.status, payment);
      return res.status(confirmRes.status).json({
        error: payment.message || "결제 승인에 실패했습니다.",
        code: payment.code,
      });
    }

    // ── 3. 사장님(어머니) 두 분께 알림 (하청 X) ───────────
    const orderInfo = {
      ...(order || {}),
      productLabel:
        (order && order.productLabel) ||
        PRODUCT_LABELS[productCode] ||
        productCode,
    };
    const notifyResult = await notifyOwners(orderInfo, payment);

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
      notified: notifyResult,
    });
  } catch (err) {
    console.error("confirm-payment error:", err);
    return res
      .status(500)
      .json({ error: err.message || "알 수 없는 오류가 발생했습니다." });
  }
}
