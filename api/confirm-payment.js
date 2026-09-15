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
import {
  confirmIdempotencyKey,
  fetchJsonWithTimeout,
  getPaymentIntent,
  insertPaymentIntent,
  orderHash,
  patchPaymentIntent,
  paymentAttemptHash,
  publicPayment,
  serviceHeaders,
  upsertPaidOrder,
  verifyDonePayment,
} from "../lib/payment-integrity.mjs";

// ── 신규상품(CU-)·토핑 가격 DB 조회 (LIVE_PRICING 킬스위치 뒤) ──
// static-first: 정적 priceOf/TOPPINGS가 값을 주면 DB를 절대 안 봄(정적 106·legacy 무조회 = 심사 무영향).
// LIVE_PRICING 미설정 시 DB 경로 전면 봉쇄 → 오늘과 바이트 동일. 카드심사 통과 후에만 ON.
async function resolveBasePrice(productCode) {
  const stat = priceOf(productCode);
  if (stat != null) return { price: stat, label: null };
  if (!process.env.LIVE_PRICING) return { price: null, label: null };
  if (!/^CU-\d{4}$/.test(productCode || "")) return { price: null, label: null };
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return { price: null, label: null };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(
      `${URL}/rest/v1/product_overrides?pc=eq.${encodeURIComponent(productCode)}&is_custom=eq.true&active=eq.true&select=price,name&limit=1`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: ac.signal });
    if (!r.ok) return { price: null, label: null };
    const row = (await r.json().catch(() => []))[0];
    if (!row || !Number.isInteger(row.price) || row.price < 0) return { price: null, label: null };
    return { price: row.price, label: row.name || null };
  } catch { return { price: null, label: null }; }
  finally { clearTimeout(t); }
}
async function resolveToppingPrices(codes) {
  const map = {};
  for (const c of codes) if (TOPPINGS_SRC[c]) map[c] = TOPPINGS_SRC[c].price;
  if (!codes.length || !process.env.LIVE_PRICING) return map;
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return map;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
  try {
    const inList = codes.map(encodeURIComponent).join(",");
    const r = await fetch(
      `${URL}/rest/v1/topping_overrides?code=in.(${inList})&select=code,price`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: ac.signal });
    if (r.ok) for (const o of (await r.json().catch(() => []))) {
      if (o && Number.isInteger(o.price) && o.price >= 0) map[o.code] = o.price;
    }
  } catch { /* DB장애 → 정적 유지. 변경분은 프론트값과 !== 로 안전 거절 */ }
  finally { clearTimeout(t); }
  return map;
}

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
  // 확인이 필요한 건은 맨 위에 세운다 — 놓치면 손님이 기다리다 사고가 난다.
  // 안 되는 건이면 아래 '💸 결제취소(환불)' 버튼으로 바로 전액 환불하시면 됩니다.
  const tags = Array.isArray(order.confirmTags) ? order.confirmTags.filter(Boolean).slice(0, 4) : [];
  if (tags.length) lines.push(`⚠️ 확인 필요 — ${tags.map((t) => String(t).slice(0, 10)).join(" · ")}`);
  lines.push("");
  lines.push(`상품: ${order.productLabel || "-"}`);
  if (order.quantity && Number(order.quantity) > 1) lines.push(`수량: ${order.quantity}개`);
  const tops = Array.isArray(order.toppings) ? order.toppings : [];
  if (tops.length) {
    lines.push(`얹기: ${tops.map((t) => TOPPING_LABELS[t] || t).join(" · ")}`);
  }
  lines.push(`결제금액: ${Number(payment.totalAmount).toLocaleString()}원`);
  if (order.recipientName) lines.push(`받는분: ${order.recipientName}`);
  if (order.recipientPhone) lines.push(`받는분 연락처: ${order.recipientPhone}`);
  if (order.chiefMourner) lines.push(`상주: ${order.chiefMourner}`);
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

// 손님이 받는 주문 확인 문자. 사장님용과 달리 원가·내부 메모는 절대 넣지 않는다.
// 근조에는 판촉·축하 표현을 쓰지 않는다.
function buildCustomerMessage(order, payment) {
  const isFuneral = order.type === "funeral";
  const L = [];
  L.push("[꽃안부] 주문이 접수되었습니다.");
  L.push("");
  L.push(`상품: ${order.productLabel || "-"}${Number(order.quantity) > 1 ? ` ${order.quantity}개` : ""}`);
  const place = [order.venue, order.venueDetail].filter(Boolean).join(" ") || order.address || "";
  if (place) L.push(`받는 곳: ${place}`);
  if (order.recipientName) L.push(`받는 분: ${order.recipientName}`);
  if (order.date) L.push(`받는 날: ${order.date}${order.time ? ` ${order.time}` : ""}`);
  L.push(`결제금액: ${Number(payment.totalAmount).toLocaleString()}원`);
  L.push(`주문번호: ${payment.orderId}`);
  L.push("");
  // 확인이 필요한 건은 손님도 미리 알아야 기다리지 않는다.
  const tags = Array.isArray(order.confirmTags) ? order.confirmTags.filter(Boolean) : [];
  if (tags.length) {
    L.push("※ 배송 시간·지역 확인이 필요한 주문이에요. 사장님이 확인 후 연락드리며, 어려우면 전액 환불해 드립니다.");
    L.push("");
  }
  L.push(isFuneral ? "정성껏 준비해 시간 맞춰 전해 드리겠습니다." : "배송 후 도착 사진을 이 번호로 보내드립니다.");
  // 주문 상태·영수증을 손님이 스스로 다시 볼 수 있는 길. 완료 화면을 닫으면
  // 전화로 물어야 했던 것을 이 링크 한 줄이 대신한다(연락처 뒷 4자리로 본인 확인).
  const _base = (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
  L.push(`주문 조회: ${_base}/order-lookup.html?o=${encodeURIComponent(payment.orderId || "")}`);
  L.push("문의 031-314-3003");
  return L.join("\n");
}

// ── 배송정보 검사 ────────────────────────────────────────────
// 화면(index.html afValidateOrder)과 같은 기준. 한쪽만 고치면 갈라지므로 규칙이 바뀌면 둘 다 고칠 것.
// 맞춤 결제(관리자 발급 링크)는 사장님이 이미 배송 정보를 아는 건이라 호출하지 않는다.
function missingDelivery(order) {
  const has = (v) => !!String(v == null ? "" : v).trim();
  const o = order || {};
  const isWreath = o.category === "wreath";
  const isFuneral = o.type === "funeral";

  if (!has(o.address) && !has(o.venue) && !has(o.venueAddress)) return "받는 곳 주소가 비어 있습니다.";

  if (isWreath) {
    // 화환은 빈소·홀이나 상주로도 찾아간다(장례식장 안내데스크가 확인해 준다).
    if (!has(o.recipientName) && !has(o.venueDetail) && !has(o.chiefMourner))
      return isFuneral ? "받는 분(고인 성함)이나 빈소·홀이 비어 있습니다." : "받는 분이나 홀이 비어 있습니다.";
  } else {
    // 사람에게 직접 가는 꽃다발·관엽·난은 이름이 없으면 건넬 수가 없다.
    if (!has(o.recipientName)) return "받는 분 성함이 비어 있습니다.";
  }

  if (!has(o.date)) return "받는 날짜가 비어 있습니다.";
  const d = String(o.date).trim().replace(/[.\/]/g, "-");
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(d)) return "받는 날짜 형식이 올바르지 않습니다.";
  // 한국시간 기준 오늘 (서버는 UTC로 도는 경우가 많아 +9시간 보정)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayIso = kst.toISOString().slice(0, 10);
  const iso = d.split("-").map((s, i) => (i ? s.padStart(2, "0") : s)).join("-");
  if (iso < todayIso) return "지난 날짜로는 주문할 수 없습니다.";

  if (!has(o.timeSlot) && !has(o.time)) return "도착 시간이 비어 있습니다.";
  return null;
}

export async function notifyOwners(order, payment, { includeCustomer = true, includeOwners = true } = {}) {
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

  const recipients = [...new Set((includeOwners ? [owner1, owner2] : [])
    .map((p) => String(p || "").replace(/[^0-9]/g, ""))
    .filter((p) => /^01[016789]\d{7,8}$/.test(p)))];

  const textBody = buildOwnerMessage(order, payment);

  const mk = (to, text, subject) => {
    const len = Buffer.byteLength(text, "utf8");
    const t = len > 90 ? "LMS" : "SMS";
    return {
      to: String(to).replace(/[^0-9]/g, ""),
      from: String(sender).replace(/[^0-9]/g, ""),
      text,
      type: t,
      ...(t === "LMS" ? { subject } : {}),
    };
  };

  const messages = recipients.map((to) => mk(to, textBody, "꽃안부 새 주문"));

  // 손님에게도 한 통 — 여태 사장님 두 분에게만 갔다. 손님은 토스 결제영수증만 받는데
  // 거기엔 '어디로 언제 무엇을' 이 없어서, 주문 내용을 나중에 확인할 방법이 없었다.
  const buyerPhone = String(order.senderPhone || order.ordererPhone || "").replace(/[^0-9]/g, "");
  if (includeCustomer && /^01[016789]\d{7,8}$/.test(buyerPhone) && !recipients.some((p) => String(p).replace(/[^0-9]/g, "") === buyerPhone)) {
    messages.push(mk(buyerPhone, buildCustomerMessage(order, payment), "꽃안부 주문 확인"));
  }
  if (messages.length === 0) {
    console.warn("주문 알림 수신번호 미설정 → 문자 알림 생략");
    return { sent: false, reason: "recipient_phone_missing" };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const authHeader = buildSolapiAuthHeader(apiKey, apiSecret);
    const res = await fetch(SOLAPI_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ messages }),
      signal: ac.signal,
    });
    if (!res.ok) {
      // 공급자 응답에는 전화번호·문자 원문이 포함될 수 있어 로그나 고객 응답에 싣지 않는다.
      console.error("SOLAPI 발송 실패:", res.status);
      return {
        sent: false, reason: "solapi_error", status: res.status,
        ...(res.status === 408 || res.status === 429 || res.status >= 500 ? { uncertain: true } : {}),
      };
    }
    // send-many/detail은 HTTP 2xx에도 개별 등록 실패를 담을 수 있다.
    // 판정에 필요한 개수만 읽고 failedMessageList·전화·본문은 반환/로그하지 않는다.
    const data = await res.json().catch(() => null);
    const count = data && data.groupInfo && data.groupInfo.count || data && data.count || {};
    const failed = Number(count.registeredFailed || 0);
    const accepted = Number(count.registeredSuccess || 0);
    if (!data) {
      console.error("SOLAPI 응답 확인 불가");
      return { sent: false, reason: "solapi_response_invalid", uncertain: true };
    }
    const hasAccepted = Object.prototype.hasOwnProperty.call(count, "registeredSuccess");
    const hasFailed = Object.prototype.hasOwnProperty.call(count, "registeredFailed");
    if (!hasAccepted || !hasFailed) {
      console.error("SOLAPI 응답 형식 확인 불가");
      return { sent: false, reason: "solapi_response_invalid", uncertain: true };
    }
    if (failed !== 0 || !Number.isFinite(accepted) || accepted < messages.length) {
      console.error("SOLAPI 수신자 등록 실패");
      return { sent: false, reason: "solapi_recipient_rejected" };
    }
    return { sent: true, count: messages.length, ownerCount: recipients.length, customerCount: messages.length - recipients.length };
  } catch (err) {
    console.error("SOLAPI 발송 예외");
    // timeout/network 단절은 공급자가 이미 접수했는지 알 수 없다. 호출자는
    // notification lease를 만료까지 유지해 즉시 중복 발송하지 않는다.
    return { sent: false, reason: "solapi_exception", uncertain: true };
  } finally {
    clearTimeout(timer);
  }
}

// 사장님께 텔레그램으로도 주문 알림 (문자와 같은 본문). 봇 토큰/챗id 없으면 생략(결제는 정상).
// TELEGRAM_BOT_TOKEN(BotFather), TELEGRAM_CHAT_ID(개인/그룹), PROJECT_TAG(선택) 를 Vercel env에 설정.
export async function notifyTelegram(order, payment) {
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
    const base = process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr";
    const rows = [[
      { text: "✅ 발주 완료 처리", url: `${base}/api/order-confirm?id=${encodeURIComponent(oid)}&t=${tk}` },
      { text: "📷 완료사진", url: `${base}/admin-order.html?order=${encodeURIComponent(oid)}` }
    ]];
    // 환불 버튼 — 전용 시크릿(REFUND_LINK_SECRET)이 있을 때만. 토큰=주문+발급월 결박(당월·전월만 유효).
    const rs = process.env.REFUND_LINK_SECRET;
    if (rs) {
      const d = new Date(Date.now() + 9 * 3600000);
      const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const ck = crypto.createHmac("sha256", rs).update(`cancel:${oid}:${ym}`).digest("hex").slice(0, 24);
      rows.push([{ text: "💸 결제취소(환불)", url: `${base}/api/order-confirm?mode=cancel&id=${encodeURIComponent(oid)}&t=${ck}` }]);
    }
    reply_markup = { inline_keyboard: rows };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      // Telegram 오류 응답이 주문 본문을 되돌려줄 수 있으므로 상태코드만 남긴다.
      console.error("텔레그램 발송 실패:", res.status);
      return {
        sent: false, reason: !data ? "telegram_response_invalid" : "telegram_error", status: res.status,
        ...(res.status === 408 || res.status === 429 || res.status >= 500 || (res.ok && !data)
          ? { uncertain: true } : {}),
      };
    }
    return { sent: true };
  } catch (err) {
    console.error("텔레그램 발송 예외");
    return { sent: false, reason: "telegram_exception", uncertain: true };
  } finally {
    clearTimeout(timer);
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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${m[1]}` },
      signal: ac.signal,
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u.id : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// orders.order_id UNIQUE가 적용된 뒤에는 원자적 upsert. SQL보다 코드가 먼저 배포돼도
// 공용 도구가 기존 GET→POST/PATCH 저장법으로 잠시 폴백한다.
async function saveOrder(order, payment) {
  return upsertPaidOrder(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    order,
    payment
  );
}

const intentsRequired = () => process.env.PAYMENT_INTENTS_REQUIRED === "1";
const validOrderId = (v) => /^[A-Za-z0-9_-]{6,64}$/.test(String(v || ""));
const INTENT_TTL_MS = 30 * 60 * 1000;
const ORDER_PAYLOAD_MAX_BYTES = 20000;
const SEALED_ORDER_MAX_BYTES = 14000;

const ORDER_TEXT_LIMITS = Object.freeze({
  productCode: 64, productLabel: 120, category: 40, type: 40,
  recipientName: 80, recipientPhone: 32, chiefMourner: 120,
  groomName: 80, brideName: 80,
  venue: 200, venueName: 200, venueDetail: 160, address: 300, venueAddress: 300,
  date: 24, time: 24, timeSlot: 60,
  senderName: 80, senderPhone: 32, ordererName: 80, ordererPhone: 32,
  ribbonLeft: 240, ribbonRight: 240, ribbonText: 480,
  senderNote: 1000, delivReq: 500, entrancePw: 100,
  buyerType: 20, corpName: 80, corpRegNo: 24, corpCeo: 60, corpAddr: 240, corpEmail: 160,
  src: 2000, sourceUrl: 1000, sourceText: 2000,
  utmSource: 64, utmMedium: 64, utmCampaign: 64,
});

function canonicalOrder(raw) {
  const safe = {};
  for (const [key, max] of Object.entries(ORDER_TEXT_LIMITS)) {
    if (raw[key] == null || raw[key] === "") continue;
    if (!["string", "number"].includes(typeof raw[key])) {
      return { ok: false, error: "주문 정보 형식이 올바르지 않습니다." };
    }
    const value = String(raw[key]).trim();
    if (value.length > max) return { ok: false, error: `${key} 항목이 너무 깁니다.` };
    if (value) safe[key] = value;
  }
  if (raw.customPay) safe.customPay = true;
  if (raw.quantity != null) safe.quantity = Number(raw.quantity);
  if (Array.isArray(raw.toppings)) safe.toppings = raw.toppings.slice(0, 20).map(String);
  if (Array.isArray(raw.confirmTags)) {
    safe.confirmTags = raw.confirmTags.slice(0, 4).map((v) => String(v).trim().slice(0, 40)).filter(Boolean);
  }
  return { ok: true, order: safe };
}

function prepareFingerprint(req) {
  const headers = req && req.headers || {};
  const forwarded = headers["x-vercel-forwarded-for"] || headers["x-forwarded-for"] || headers["x-real-ip"] || "unknown";
  const client = String(forwarded).split(",")[0].trim().slice(0, 128) || "unknown";
  const secret = process.env.PAYMENT_RATE_LIMIT_SECRET || process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
  return crypto.createHmac("sha256", secret).update(`prepare:${client}`).digest("hex");
}

function intentExpired(intent) {
  const explicit = Date.parse(intent && intent.expires_at || "");
  if (Number.isFinite(explicit)) return explicit <= Date.now();
  const created = Date.parse(intent && intent.created_at || "");
  return !Number.isFinite(created) || created + INTENT_TTL_MS <= Date.now();
}

// payment_intent 적용 전에 만들어진 과거 orders와 새 주문번호가 겹치면,
// 신규 결제가 기존 배송지·상품 행에 붙을 수 있다. 새 intent가 아직 없을 때만
// 기존 orders를 확인하고, 조회 실패도 '없음'으로 간주하지 않는다.
async function checkExistingOrderId(orderId) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return { ok: false, reason: "supabase_env_missing" };
  try {
    const out = await fetchJsonWithTimeout(
      `${URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id&limit=1`,
      { headers: serviceHeaders(KEY) },
      2200,
    );
    if (!out.response.ok) return { ok: false, reason: `order_collision_read_${out.response.status}` };
    return { ok: true, exists: Array.isArray(out.data) && out.data.length > 0 };
  } catch {
    return { ok: false, reason: "order_collision_read_exception" };
  }
}

async function validateOrderRequest(req, orderId, amount, order) {
  if (!validOrderId(orderId)) return { ok: false, status: 400, error: "주문번호가 올바르지 않습니다." };
  const nAmount = Number(amount);
  if (!Number.isInteger(nAmount) || nAmount <= 0 || nAmount > 100000000) {
    return { ok: false, status: 400, error: "결제 금액이 올바르지 않습니다." };
  }
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return { ok: false, status: 400, error: "주문 정보가 필요합니다." };
  }
  try {
    if (Buffer.byteLength(JSON.stringify(order), "utf8") > ORDER_PAYLOAD_MAX_BYTES) {
      return { ok: false, status: 413, error: "주문 정보가 너무 큽니다." };
    }
  } catch {
    return { ok: false, status: 400, error: "주문 정보를 읽을 수 없습니다." };
  }

  const productCode = order.productCode;
  const isCustom = !!order.customPay;
  let customLabel = null;
  let authoritativePrice = null;
  let sealedToppings = [];
  let sealedQuantity = 1;
  if (isCustom) {
    const secret = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
    const given = String(order.payToken || "");
    const requestedLabel = String(order.productLabel || "맞춤 주문").normalize("NFC").trim().slice(0, 40) || "맞춤 주문";
    const expect = secret
      ? crypto.createHmac("sha256", secret).update(`pay:v2:${orderId}:${nAmount}:${requestedLabel}`).digest("hex").slice(0, 32)
      : "";
    const legacyExpect = secret
      ? crypto.createHmac("sha256", secret).update(`pay:${orderId}:${nAmount}`).digest("hex").slice(0, 32)
      : "";
    const goodV2 = expect.length === 32 && given.length === expect.length
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expect));
    const goodLegacy = !goodV2 && legacyExpect.length === 32 && given.length === legacyExpect.length
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(legacyExpect));
    if (!goodV2 && !goodLegacy) {
      console.error(`맞춤결제 서명 불일치: orderId=${orderId}`);
      return { ok: false, status: 400, error: "결제 링크가 유효하지 않거나 금액이 바뀌었습니다." };
    }
    // 구형 링크는 label이 서명되지 않았으므로 고객 URL 값을 절대 신뢰하지 않는다.
    customLabel = goodV2 ? requestedLabel : "맞춤 주문 (기존 링크)";
  } else {
    const { price: basePrice, label } = await resolveBasePrice(productCode);
    customLabel = label;
    authoritativePrice = basePrice;
    if (basePrice == null) return { ok: false, status: 400, error: "알 수 없는 상품입니다." };
    const toppings = Array.isArray(order.toppings) ? [...new Set(order.toppings)] : [];
    sealedToppings = toppings;
    const tPrices = await resolveToppingPrices(toppings);
    let toppingSum = 0;
    for (const t of toppings) {
      const tp = (t in tPrices) ? tPrices[t] : null;
      if (tp == null) return { ok: false, status: 400, error: "알 수 없는 추가 옵션입니다." };
      toppingSum += tp;
    }
    const qty = parseInt(order.quantity, 10);
    const quantity = Number.isFinite(qty) && qty >= 1 && qty <= 99 ? qty : 1;
    sealedQuantity = quantity;
    if (order.quantity != null && !(Number.isFinite(qty) && qty >= 1 && qty <= 99)) {
      return { ok: false, status: 400, error: "수량이 올바르지 않습니다." };
    }
    const expectedPrice = (basePrice + toppingSum) * quantity;
    if (nAmount !== expectedPrice) {
      console.error(`금액 불일치: orderId=${orderId} expected=${expectedPrice}`);
      return { ok: false, status: 400, error: "결제 금액이 상품 가격과 일치하지 않습니다." };
    }
    const missing = missingDelivery(order);
    if (missing) {
      console.error(`배송정보 누락으로 승인 거절: orderId=${orderId}`);
      return { ok: false, status: 400, error: missing };
    }
  }

  const canonical = canonicalOrder(order);
  if (!canonical.ok) return { ok: false, status: 400, error: canonical.error };
  const userId = await getUserId(req);
  const authLabel =
    customLabel
    || PRODUCT_LABELS[productCode]
    || (PRODUCTS.find((p) => p.pc === productCode) || {}).name
    || productCode
    || "맞춤 결제";
  // HMAC은 이 요청을 검증할 때만 필요하다. 허용 필드만 새 객체로 구성해 임의 JSON과
  // 재사용 가능한 서명값이 결제 원장에 들어가지 않게 한다.
  const safeOrder = {
    ...canonical.order,
    productLabel: String(authLabel).slice(0, 120),
    price: isCustom ? nAmount : authoritativePrice,
    quantity: isCustom ? 1 : sealedQuantity,
    toppings: isCustom ? [] : sealedToppings,
    user_id: userId,
  };
  delete safeOrder.payToken;
  if (Buffer.byteLength(JSON.stringify(safeOrder), "utf8") > SEALED_ORDER_MAX_BYTES) {
    return { ok: false, status: 413, error: "주문 정보가 너무 큽니다." };
  }
  return {
    ok: true,
    amount: nAmount,
    isCustom,
    orderInfo: { ...safeOrder, productLabel: authLabel, user_id: userId },
  };
}

async function prepareIntent(req, orderId, amount, order) {
  const checked = await validateOrderRequest(req, orderId, amount, order);
  if (!checked.ok) return checked;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hash = orderHash(checked.orderInfo);
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS).toISOString();
  const found = await getPaymentIntent(SUPABASE_URL, SERVICE_KEY, orderId);
  if (!found.available) {
    if (intentsRequired()) return { ok: false, status: 503, error: "결제 준비 저장소를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." };
    return { ok: true, prepared: false, legacy: true };
  }
  if (found.error) return { ok: false, status: 503, error: "결제 준비 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };
  if (found.row) {
    if (Number(found.row.expected_amount) !== checked.amount || found.row.order_hash !== hash) {
      return { ok: false, status: 409, error: "이미 다른 내용으로 사용된 주문번호입니다. 다시 시도해주세요." };
    }
    if (["paid", "finalized", "canceling", "canceled"].includes(found.row.state)) {
      return { ok: false, status: 409, error: "이미 처리된 주문입니다. 새 주문으로 다시 시도해주세요." };
    }
    if (intentExpired(found.row)) {
      if (found.row.state === "confirming" || found.row.payment_key) {
        return { ok: false, status: 409, error: "이전 결제 결과를 확인하고 있습니다. 주문번호로 문의해주세요." };
      }
      const refreshed = await patchPaymentIntent(SUPABASE_URL, SERVICE_KEY, orderId, {
        state: "prepared", expires_at: expiresAt, finalization_error: null, last_checked_at: null,
        confirm_attempt_hash: null, confirm_lease_until: null,
      }, "state=in.(prepared,failed)&payment_key=is.null");
      if (!refreshed.ok || !refreshed.matched) {
        return { ok: false, status: 503, error: "결제 준비 정보를 갱신하지 못했습니다. 잠시 후 다시 시도해주세요." };
      }
    }
    return { ok: true, prepared: true, reused: true };
  }
  const oldOrder = await checkExistingOrderId(orderId);
  if (!oldOrder.ok) {
    return { ok: false, status: 503, error: "주문번호 중복을 확인하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  if (oldOrder.exists) {
    return { ok: false, status: 409, error: "이미 사용된 주문번호입니다. 새 주문으로 다시 시도해주세요." };
  }
  const created = await insertPaymentIntent(SUPABASE_URL, SERVICE_KEY, {
    order_id: orderId,
    state: "prepared",
    expected_amount: checked.amount,
    order_data: checked.orderInfo,
    order_hash: hash,
    user_id: checked.orderInfo.user_id || null,
    expires_at: expiresAt,
  }, { fingerprint: prepareFingerprint(req), allowDirectFallback: !intentsRequired() });
  if (created.ok) return { ok: true, prepared: true };
  if (created.orderIdConflict) {
    return { ok: false, status: 409, error: "이미 사용된 주문번호입니다. 새 주문으로 다시 시도해주세요." };
  }
  if (created.rateLimited) return { ok: false, status: 429, error: "결제 준비 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." };
  if (created.unavailable && !intentsRequired()) return { ok: true, prepared: false, legacy: true };
  // 같은 order_id의 동시 prepare라면 한 쪽 INSERT가 충돌할 수 있다. 승자 행을 다시 확인한다.
  const raced = await getPaymentIntent(SUPABASE_URL, SERVICE_KEY, orderId);
  if (raced.row && Number(raced.row.expected_amount) === checked.amount && raced.row.order_hash === hash) {
    return { ok: true, prepared: true, reused: true };
  }
  return { ok: false, status: 503, error: "결제 준비 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };
}

// SQL 적용 직전 이미 열려 있던 결제창도, 테이블이 지금 사용 가능하면 승인 전에
// 즉석 intent를 만들어 자동복구 대상에 포함한다.
async function createRecoveryIntent(req, orderId, checked) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldOrder = await checkExistingOrderId(orderId);
  if (!oldOrder.ok) return { ok: false, unsafe: true, reason: oldOrder.reason };
  if (oldOrder.exists) return { ok: false, orderIdConflict: true };
  const row = {
    order_id: orderId,
    state: "prepared",
    expected_amount: checked.amount,
    order_data: checked.orderInfo,
    order_hash: orderHash(checked.orderInfo),
    user_id: checked.orderInfo.user_id || null,
    expires_at: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
  };
  const made = await insertPaymentIntent(URL, KEY, row, {
    fingerprint: prepareFingerprint(req),
    allowDirectFallback: !intentsRequired(),
  });
  if (made.ok) return { ok: true, intent: made.row || row };
  if (made.orderIdConflict) return { ok: false, orderIdConflict: true };
  const raced = await getPaymentIntent(URL, KEY, orderId);
  if (raced.row && Number(raced.row.expected_amount) === checked.amount
      && raced.row.order_hash === row.order_hash) return { ok: true, intent: raced.row };
  return { ok: false, unavailable: made.unavailable, rateLimited: made.rateLimited, unsafe: true };
}

async function markIntentConfirming(intent, paymentKey, { resume = false } = {}) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const now = new Date().toISOString();
  const attemptHash = paymentAttemptHash(paymentKey);
  const leaseUntil = new Date(Date.now() + 2 * 60000).toISOString();
  const filter = resume
    ? `state=eq.confirming&payment_key=is.null&confirm_attempt_hash=eq.${attemptHash}`
      + `&confirm_lease_until=lte.${encodeURIComponent(now)}`
    : "state=in.(prepared,failed)&payment_key=is.null";
  const marked = await patchPaymentIntent(URL, KEY, intent.order_id, {
    state: "confirming", confirm_attempt_hash: attemptHash, confirm_lease_until: leaseUntil,
    last_checked_at: now, finalization_error: null,
  }, filter);
  if (!marked.ok) {
    return { ok: false, status: 503, error: "결제 확인 정보를 저장하지 못했습니다. 결제되지 않았으니 잠시 후 다시 시도해주세요." };
  }
  if (!marked.matched) {
    // 다른 요청이 같은 주문의 승인권을 먼저 가져갔다. paymentKey를 저장하지 않으므로
    // 이 요청은 토스 승인 POST를 절대 보내지 않고 원장 대사만 기다린다.
    return { ok: false, contended: true, status: 409,
      error: "다른 결제 확인 요청을 처리하고 있습니다. 잠시 후 같은 화면에서 다시 확인해주세요." };
  }
  return { ok: true, intent: marked.row || {
    ...intent, state: "confirming", confirm_attempt_hash: attemptHash, confirm_lease_until: leaseUntil,
  } };
}

async function storeVerifiedPayment(intent, payment) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (intent.payment_key && intent.payment_key !== payment.paymentKey) {
    return { ok: false, conflict: true };
  }
  const verifiedAttemptHash = paymentAttemptHash(payment.paymentKey);
  if (intent.confirm_attempt_hash && intent.confirm_attempt_hash !== verifiedAttemptHash) {
    return { ok: false, conflict: true };
  }
  // 완료 상태는 흡수 상태다. 재확인 요청이 updated_at을 흔들면 알림 lease를 두 요청이
  // 동시에 얻을 수 있으므로, 토스 원장 검증 뒤에도 행을 다시 쓰지 않는다.
  if (intent.state === "finalized" && intent.payment_key === payment.paymentKey) {
    return { ok: true, intent };
  }
  const filter = intent.payment_key
    ? `payment_key=eq.${encodeURIComponent(payment.paymentKey)}&state=in.(confirming,paid,finalized)`
    : "payment_key=is.null&state=in.(prepared,confirming,failed,paid)"
      + (intent.confirm_attempt_hash ? `&confirm_attempt_hash=eq.${verifiedAttemptHash}` : "");
  const stored = await patchPaymentIntent(URL, KEY, intent.order_id, {
    state: intent.state === "finalized" ? "finalized" : "paid",
    payment_key: payment.paymentKey,
    toss_status: payment.status,
    payment_method: payment.method || null,
    approved_at: payment.approvedAt || null,
    receipt_url: payment.receipt && payment.receipt.url || null,
    paid_at: payment.approvedAt || new Date().toISOString(),
    confirm_lease_until: null,
    last_checked_at: new Date().toISOString(),
    finalization_error: null,
  }, filter);
  if (stored.ok && stored.matched) return { ok: true, intent: stored.row || intent };
  if (!stored.ok) return { ok: false, reason: stored.reason };
  const latest = await getPaymentIntent(URL, KEY, intent.order_id);
  if (latest.row && latest.row.payment_key === payment.paymentKey
      && ["paid", "finalized"].includes(latest.row.state)) {
    return { ok: true, intent: latest.row };
  }
  return { ok: false, conflict: true };
}

async function lookupVerifiedPayment(basicAuth, orderId, amount, paymentKey) {
  let last = null;
  for (const delay of [0, 250]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const out = await fetchJsonWithTimeout(
        `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`,
        { headers: { Authorization: `Basic ${basicAuth}` } },
        2000
      );
      last = out;
      if (out.response.ok) {
        const verified = verifyDonePayment(out.data, { orderId, amount, paymentKey });
        if (verified.ok) return { ok: true, payment: out.data, recovered: true };
        if (/^status_(CANCELED|PARTIAL_CANCELED|ABORTED|EXPIRED)$/.test(verified.reason)) {
          return { ok: false, status: 409, code: "PAYMENT_NOT_DONE", reason: verified.reason };
        }
      }
    } catch (err) {
      last = { error: err && err.message };
    }
  }
  return { ok: false, status: 503, code: "PAYMENT_CONFIRM_UNCERTAIN", reason: last && (last.text || last.error) };
}

async function lookupExistingPayment(basicAuth, orderId, amount) {
  try {
    const out = await fetchJsonWithTimeout(
      `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`,
      { headers: { Authorization: `Basic ${basicAuth}` } }, 2200
    );
    if (out.response.status === 404) return { ok: true, found: false };
    if (!out.response.ok) return { ok: false, pending: true, status: 503 };
    const payment = out.data;
    if (!payment || payment.orderId !== orderId || Number(payment.totalAmount) !== Number(amount)) {
      return { ok: false, conflict: true, status: 409 };
    }
    if (payment.status === "DONE" && payment.paymentKey) {
      return { ok: true, found: true, payment };
    }
    return { ok: false, terminal: true, status: 409, tossStatus: payment.status || "UNKNOWN" };
  } catch {
    // 이미 승인됐을 가능성을 배제하지 못했으면 새 승인 POST를 보내지 않는다.
    return { ok: false, pending: true, status: 503 };
  }
}

async function confirmOrRecoverPayment(secretKey, paymentKey, orderId, amount) {
  const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");
  let out = null;
  try {
    out = await fetchJsonWithTimeout(TOSS_CONFIRM_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
        "Idempotency-Key": confirmIdempotencyKey(orderId, paymentKey),
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    }, 4500);
  } catch (err) {
    console.error(`토스 승인 응답 불명확: orderId=${orderId}`);
    return lookupVerifiedPayment(basicAuth, orderId, amount, paymentKey);
  }

  if (out.response.ok) {
    const verified = verifyDonePayment(out.data, { orderId, amount, paymentKey });
    if (verified.ok) return { ok: true, payment: out.data, recovered: false };
    console.error(`토스 승인 응답 검증 실패: orderId=${orderId} reason=${verified.reason}`);
    return lookupVerifiedPayment(basicAuth, orderId, amount, paymentKey);
  }

  const code = out.data && out.data.code;
  const ambiguous = code === "ALREADY_PROCESSED_PAYMENT"
    || code === "IDEMPOTENT_REQUEST_PROCESSING"
    || out.response.status === 408
    || out.response.status === 409
    || out.response.status === 429
    || out.response.status >= 500;
  if (ambiguous) return lookupVerifiedPayment(basicAuth, orderId, amount, paymentKey);
  return {
    ok: false,
    status: out.response.status,
    code,
    // 공급자 원문은 예상치 못한 내부값을 포함할 수 있어 고객 응답으로 전달하지 않는다.
    error: "결제 승인에 실패했습니다. 결제수단을 확인한 뒤 다시 시도해주세요.",
  };
}

async function orderExists(orderId) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return false;
  try {
    const out = await fetchJsonWithTimeout(
      `${URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id&limit=1`,
      { headers: serviceHeaders(KEY) }, 4000
    );
    return out.response.ok && Array.isArray(out.data) && out.data.length > 0;
  } catch { return false; }
}

export async function notifyCriticalPayment(order, payment, reason, headline = "결제는 완료됐지만 주문 DB 저장 실패") {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: "telegram_env_missing" };
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  const text = `${tag}🚨 ${String(headline || "결제 확인 필요").slice(0, 100)}\n즉시 주문번호로 확인해주세요. (${String(reason || "unknown").slice(0, 80)})\n\n${buildOwnerMessage(order, payment)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: ac.signal,
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data && data.ok === true) return { sent: true };
    return {
      sent: false,
      reason: !data ? "telegram_response_invalid" : "telegram_error",
      status: r.status,
      ...(r.status === 408 || r.status === 429 || r.status >= 500 || (r.ok && !data)
        ? { uncertain: true } : {}),
    };
  } catch { return { sent: false, reason: "telegram_exception", uncertain: true }; }
  finally { clearTimeout(timer); }
}

// notified_at/alert_sent_at은 "보내기 전 선점" 값이 아니라 실제 발송 성공 시각이다.
// 채널별 lease는 공급자 timeout의 중복 전송을 막기 위해 9분 뒤 reconcile이 다시 시도한다.
export async function notifyPaymentIntentWithLease(intent, order, payment, requestStartedAt, critical = false, criticalMeta = {}) {
  const aggregateField = critical ? "alert_sent_at" : "notified_at";
  const smsField = critical ? "sms_alerted_at" : "sms_notified_at";
  const telegramField = critical ? "telegram_alerted_at" : "telegram_notified_at";
  const smsLeaseField = critical ? "sms_alert_lease_until" : "sms_notice_lease_until";
  const telegramLeaseField = critical ? "telegram_alert_lease_until" : "telegram_notice_lease_until";
  if (!intent || Date.now() - requestStartedAt > 19000) {
    return { sms: null, telegram: null, deferred: true };
  }
  const buyerPhone = String(order.senderPhone || order.ordererPhone || "").replace(/[^0-9]/g, "");
  const ownerPhones = [process.env.OWNER_PHONE_1, process.env.OWNER_PHONE_2]
    .map((p) => String(p || "").replace(/[^0-9]/g, ""))
    .filter((p) => /^01[016789]\d{7,8}$/.test(p));
  const smsProvider = !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER);
  const smsEnabled = smsProvider && (critical ? ownerPhones.length > 0 : /^01[016789]\d{7,8}$/.test(buyerPhone));
  const telegramEnabled = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const smsMissing = smsEnabled && !intent[smsField];
  const telegramMissing = telegramEnabled && !intent[telegramField];
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const leaseNow = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 9 * 60000).toISOString();
  const claimStateFilter = critical
    ? (criticalMeta.scope === "cancellation"
      ? "state=in.(canceling,canceled,finalized)&finalization_error=not.is.null"
      : "state=not.in.(canceling,canceled)")
    : "state=eq.finalized&finalization_error=is.null";
  const claimChannel = (sentField, leaseField, needed) => needed
    ? patchPaymentIntent(URL, KEY, intent.order_id, {
        [leaseField]: leaseUntil,
        last_checked_at: leaseNow,
      }, `${sentField}=is.null&or=(${leaseField}.is.null,${leaseField}.lt.${encodeURIComponent(leaseNow)})&${claimStateFilter}`, 1800)
    : Promise.resolve({ ok: true, matched: false, skipped: true });
  const [smsClaim, telegramClaim] = await Promise.all([
    claimChannel(smsField, smsLeaseField, smsMissing),
    claimChannel(telegramField, telegramLeaseField, telegramMissing),
  ]);
  // timeout/불명확 결과를 소유권 획득으로 간주하지 않는다.
  const ownsSms = smsMissing && smsClaim.ok && smsClaim.matched;
  const ownsTelegram = telegramMissing && telegramClaim.ok && telegramClaim.matched;
  const tagged = critical ? {
    ...order,
    confirmTags: [criticalMeta.tag || "결제확인필요", ...(Array.isArray(order.confirmTags) ? order.confirmTags : [])],
  } : order;
  const [sms, telegram] = await Promise.all([
    ownsSms
      // 일반 주문 SMS는 고객 확인용 단일 수신자로 보낸다. 사장님 발주
      // 알림은 텔레그램이 담당해, 사장님 번호 하나의 거절 때문에 고객
      // 문자까지 반복 전송되는 것을 막는다. critical 사고만 사장님 SMS를 쓴다.
      ? notifyOwners(tagged, payment, { includeCustomer: !critical, includeOwners: critical })
      : Promise.resolve(null),
    ownsTelegram
      ? (critical
        ? notifyCriticalPayment(tagged, payment, criticalMeta.reason || "manual_review", criticalMeta.headline)
        : notifyTelegram(tagged, payment))
      : Promise.resolve(null),
  ]);
  const now = new Date().toISOString();
  const finishChannel = async (sentField, leaseField, owns, outcome) => {
    if (!owns) return { done: false, skipped: true };
    if (outcome && outcome.uncertain) {
      // 공급자가 접수했을 수도 있으므로 lease를 그대로 둔다. 만료 전에는
      // 다른 worker가 같은 고객문자/발주 Telegram을 다시 보낼 수 없다.
      return { done: false, uncertain: true };
    }
    if (!(outcome && outcome.sent)) {
      // 명시적 실패는 lease를 즉시 반납한다. 함수 종료처럼 결과를 모르는 경우는
      // 이 코드에 도달하지 않아 2분 뒤 자동 만료된다.
      await patchPaymentIntent(URL, KEY, intent.order_id, { [leaseField]: null },
        `${sentField}=is.null&${leaseField}=eq.${encodeURIComponent(leaseUntil)}`, 1600);
      return { done: false };
    }
    const marked = await patchPaymentIntent(URL, KEY, intent.order_id, {
      [sentField]: now, [leaseField]: null,
    }, `${sentField}=is.null&${leaseField}=eq.${encodeURIComponent(leaseUntil)}`, 1800);
    return { done: marked.ok && marked.matched };
  };
  const [smsFinish, telegramFinish] = await Promise.all([
    finishChannel(smsField, smsLeaseField, ownsSms, sms),
    finishChannel(telegramField, telegramLeaseField, ownsTelegram, telegram),
  ]);
  const smsDone = !smsEnabled || !!intent[smsField] || smsFinish.done;
  const telegramDone = !telegramEnabled || !!intent[telegramField] || telegramFinish.done;
  if (smsDone && telegramDone && !intent[aggregateField]) {
    await patchPaymentIntent(URL, KEY, intent.order_id, { [aggregateField]: now }, `${aggregateField}=is.null`, 1600);
  }
  return { sms, telegram, deferred: (smsMissing && !ownsSms) || (telegramMissing && !ownsTelegram) };
}

export default async function handler(req, res) {
  const requestStartedAt = Date.now();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

    const { action, paymentKey, orderId, amount, order } = body;

    // ── 0. 결제 전 주문 원본 저장 ─────────────────────────
    // 브라우저 sessionStorage가 사라지거나 승인 직후 함수가 죽어도 이 행으로 주문을 복구한다.
    if (action === "prepare") {
      if (!orderId || amount == null || !order) return res.status(400).json({ error: "orderId, amount, order가 필요합니다." });
      const prepared = await prepareIntent(req, orderId, amount, order);
      return res.status(prepared.ok ? 200 : (prepared.status || 500)).json(prepared.ok
        ? { ok: true, prepared: prepared.prepared, legacy: !!prepared.legacy, reused: !!prepared.reused }
        : { error: prepared.error });
    }

    if (!paymentKey || !orderId || amount == null) {
      return res.status(400).json({ error: "paymentKey, orderId, amount가 필요합니다." });
    }
    if (typeof paymentKey !== "string" || paymentKey.length > 200 || !validOrderId(orderId)) {
      return res.status(400).json({ error: "결제 정보가 올바르지 않습니다." });
    }
    const nAmount = Number(amount);
    if (!Number.isInteger(nAmount) || nAmount <= 0) return res.status(400).json({ error: "결제 금액이 올바르지 않습니다." });

    // ── 1. 준비된 주문을 서버 원본으로 사용 ────────────────
    const intentRead = await getPaymentIntent(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      orderId
    );
    let intent = null;
    let orderInfo = null;
    let legacy = false;
    if (intentRead.available && intentRead.error) {
      return res.status(503).json({ error: "결제 준비 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." });
    }
    if (intentRead.row) {
      intent = intentRead.row;
      if (Number(intent.expected_amount) !== nAmount
          || !intent.order_data
          || intent.order_hash !== orderHash(intent.order_data)) {
        console.error(`결제 준비정보 검증 실패: orderId=${orderId}`);
        return res.status(409).json({ error: "저장된 주문과 결제 정보가 일치하지 않습니다." });
      }
      if (intent.state === "canceled") return res.status(409).json({ error: "이미 취소된 주문입니다." });
      if (intent.state === "canceling") return res.status(409).json({ error: "환불을 처리하고 있습니다. 잠시 후 주문번호로 확인해주세요." });
      orderInfo = intent.order_data;
    } else {
      // SQL 적용 전·배포 직후의 이미 열린 결제창은 종전 검증으로 살린다.
      // PAYMENT_INTENTS_REQUIRED=1은 충분한 전환시간 뒤에만 켠다.
      if (intentsRequired()) {
        return res.status(409).json({ error: "결제 준비 정보가 만료됐습니다. 처음부터 다시 주문해주세요." });
      }
      const checked = await validateOrderRequest(req, orderId, nAmount, order);
      if (!checked.ok) return res.status(checked.status || 400).json({ error: checked.error });
      orderInfo = checked.orderInfo;
      if (intentRead.available) {
        const recoveredIntent = await createRecoveryIntent(req, orderId, checked);
        if (recoveredIntent.ok) intent = recoveredIntent.intent;
        else if (recoveredIntent.orderIdConflict) {
          return res.status(409).json({ error: "이미 사용된 주문번호입니다. 새 주문으로 다시 시도해주세요." });
        } else {
          // intent 테이블이 보이는데 복구 행을 만들지 못했다면 legacy로 승인하지 않는다.
          // 결제 전이므로 fail-close하면 과거 orders 오염과 승인 후 복구 불가를 모두 피한다.
          return res.status(recoveredIntent.rateLimited ? 429 : 503).json({
            error: recoveredIntent.rateLimited
              ? "결제 확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
              : "결제 복구 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
          });
        }
      } else legacy = true;
    }

    // ── 2. 토스 승인 (멱등키) + 승인불명확 시 orderId 원장조회 ──
    let confirmed;
    const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");
    if (intent) {
      if (intent.payment_key && intent.payment_key !== paymentKey) {
        return res.status(409).json({ error: "주문과 결제 정보가 일치하지 않습니다." });
      }
      const requestedAttemptHash = paymentAttemptHash(paymentKey);
      if (intent.state === "confirming" && intent.confirm_attempt_hash
          && intent.confirm_attempt_hash !== requestedAttemptHash) {
        return res.status(409).json({
          error: "이 주문번호에서 다른 결제 시도가 이미 진행됐습니다. 새 주문으로 다시 시도해주세요.",
          code: "PAYMENT_ATTEMPT_MISMATCH",
        });
      }
      const alreadyVerified = ["paid", "finalized"].includes(intent.state) || !!intent.payment_key;
      const expired = intentExpired(intent);
      if (alreadyVerified || expired) {
        // 이미 처리된 건과 만료 경계 건은 승인 POST를 반복하지 않고 토스 원장만 조회한다.
        confirmed = await lookupVerifiedPayment(basicAuth, orderId, nAmount, paymentKey);
        if (!confirmed.ok && expired && !alreadyVerified) {
          return res.status(410).json({ error: "결제 확인 시간이 만료됐습니다. 주문번호로 문의해주세요.", code: "PAYMENT_INTENT_EXPIRED" });
        }
      } else {
        let approvalClaimed = false;
        if (intent.state === "confirming") {
          // 이전 함수가 토스 승인 직후 끊겼을 수 있다. 새 paymentKey를 승인하기 전에
          // orderId 원장을 먼저 봐서 기존 DONE을 복구하고 중복결제를 막는다.
          const existing = await lookupExistingPayment(basicAuth, orderId, nAmount);
          if (existing.ok && existing.found) {
            if (paymentAttemptHash(existing.payment.paymentKey) !== requestedAttemptHash) {
              return res.status(409).json({
                error: "이전 결제와 현재 결제 정보가 다릅니다. 주문번호로 문의해주세요.",
                code: "PAYMENT_ATTEMPT_MISMATCH",
              });
            }
            confirmed = { ok: true, payment: existing.payment, recovered: true };
          } else if (!existing.ok) {
            const terminal = existing.terminal;
            return res.status(existing.status || 503).json({
              error: terminal
                ? "이전 결제가 종료된 주문입니다. 새 주문번호로 다시 시도해주세요."
                : "이전 결제 결과를 확인하고 있습니다. 잠시 후 같은 화면에서 다시 확인해주세요.",
              code: terminal ? "PREVIOUS_PAYMENT_TERMINAL" : "PAYMENT_CONFIRM_UNCERTAIN",
              pending: !terminal,
            });
          } else {
            if (!intent.confirm_attempt_hash) {
              // 스키마 전환 전 confirming 행은 어떤 paymentKey 시도였는지 증명할 수 없다.
              // 토스에 DONE이 보일 때만 복구하고, 404면 새 승인을 절대 보내지 않는다.
              return res.status(409).json({
                error: "이전 결제 시도를 안전하게 확인할 수 없습니다. 새 주문으로 다시 시도해주세요.",
                code: "PAYMENT_ATTEMPT_UNKNOWN",
              });
            }
            // orderId 원장이 404라도, 직전 승인 POST가 아직 전파되는 중일 수 있다.
            // 같은 paymentKey 해시의 2분 lease가 끝난 뒤 CAS로 단 한 요청만 승인을 재개한다.
            const leaseEnd = Date.parse(intent.confirm_lease_until || "");
            if (!Number.isFinite(leaseEnd) || leaseEnd > Date.now()) {
              return res.status(409).json({
                error: "이전 결제 결과를 확인하고 있습니다. 잠시 후 같은 화면에서 다시 확인해주세요.",
                code: "PAYMENT_CONFIRM_IN_PROGRESS", pending: true,
              });
            }
            const reclaimed = await markIntentConfirming(intent, paymentKey, { resume: true });
            if (!reclaimed.ok) return res.status(reclaimed.status || 503).json({
              error: reclaimed.error,
              code: reclaimed.contended ? "PAYMENT_CONFIRM_IN_PROGRESS" : "PAYMENT_CONFIRM_STORE_FAILED",
              pending: !!reclaimed.contended,
            });
            intent = reclaimed.intent || intent;
            approvalClaimed = true;
          }
        }
        // 검증되지 않은 paymentKey는 저장하지 않는다. confirming 상태만 먼저 남겨 함수가
        // 승인 직후 종료돼도 cron이 orderId로 토스 원장을 조회할 수 있게 한다.
        if (!confirmed) {
          if (!approvalClaimed) {
            const marked = await markIntentConfirming(intent, paymentKey);
            if (!marked.ok) return res.status(marked.status || 503).json({
              error: marked.error,
              code: marked.contended ? "PAYMENT_CONFIRM_IN_PROGRESS" : "PAYMENT_CONFIRM_STORE_FAILED",
              pending: !!marked.contended,
            });
            intent = marked.intent || intent;
          }
          confirmed = await confirmOrRecoverPayment(secretKey, paymentKey, orderId, nAmount);
        }
      }
    } else {
      confirmed = await confirmOrRecoverPayment(secretKey, paymentKey, orderId, nAmount);
    }
    if (!confirmed.ok) {
      if (intent) {
        await patchPaymentIntent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, orderId, {
          state: confirmed.code === "PAYMENT_CONFIRM_UNCERTAIN" ? "confirming" : "failed",
          last_checked_at: new Date().toISOString(),
          finalization_error: String(confirmed.code || confirmed.reason || "confirm_failed").slice(0, 240),
          ...(confirmed.code === "PAYMENT_CONFIRM_UNCERTAIN" ? {} : { confirm_lease_until: null }),
        }, "state=in.(prepared,confirming,failed)&payment_key=is.null", 1800);
      }
      const pending = confirmed.code === "PAYMENT_CONFIRM_UNCERTAIN";
      return res.status(confirmed.status || 502).json({
        error: pending
          ? "결제 결과를 확인하고 있습니다. 같은 화면에서 잠시 후 다시 시도하거나 주문번호로 문의해주세요."
          : (confirmed.error || "결제 승인을 확인하지 못했습니다."),
        code: confirmed.code,
        pending,
      });
    }
    const payment = confirmed.payment;

    // 토스가 원장이다. 여기부터 DB가 실패해도 고객에게 결제 실패라고 거짓말하지 않는다.
    let ledgerStored = !intent;
    if (intent) {
      const stored = await storeVerifiedPayment(intent, payment);
      ledgerStored = stored.ok;
      if (stored.ok) intent = stored.intent || intent;
      else console.error(`결제 intent paid 기록 실패: orderId=${orderId}`);
    }

    // 외부망이 느린 요청은 Vercel 30초 hard-kill 전에 즉시 성공을 돌려준다. 서버 원본과
    // orderId가 남아 있으므로 reconcile이 주문 저장·알림을 이어서 수행한다.
    if (intent && Date.now() - requestStartedAt > 17000) {
      return res.status(200).json({
        ok: true,
        alreadyDone: !!confirmed.recovered,
        payment: publicPayment(payment),
        notified: { sms: false, telegram: false },
        saved: false,
        needsReconciliation: true,
        manualRecovery: false,
        integrity: "intent",
      });
    }

    const existedBefore = legacy ? await orderExists(orderId) : false;
    const saveResult = await saveOrder(orderInfo, payment);
    let smsResult = null, telegramResult = null;
    let finalized = !intent || intent.state === "finalized";

    if (saveResult.saved) {
      if (intent && ledgerStored && !finalized) {
        const finalPatch = await patchPaymentIntent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, orderId, {
          state: "finalized", finalized_at: new Date().toISOString(), finalization_error: null,
        }, `payment_key=eq.${encodeURIComponent(payment.paymentKey)}&state=eq.paid`, 2200);
        finalized = finalPatch.ok && finalPatch.matched;
        if (finalized) intent = finalPatch.row || intent;
        else console.error(`결제 intent finalize 기록 실패: orderId=${orderId}`);
      }
      if (intent && finalized) {
        const notice = await notifyPaymentIntentWithLease(intent, orderInfo, payment, requestStartedAt, false);
        smsResult = notice.sms;
        telegramResult = notice.telegram;
      } else if (legacy && !existedBefore) {
        [smsResult, telegramResult] = await Promise.all([
          notifyOwners(orderInfo, payment),
          notifyTelegram(orderInfo, payment),
        ]);
      }
    } else {
      console.error(`결제 완료 후 주문 저장 실패: orderId=${orderId} reason=${saveResult.reason || "unknown"}`);
      if (intent) {
        const errorPatch = await patchPaymentIntent(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, orderId, {
          state: "paid", finalization_error: String(saveResult.reason || "order_save_failed").slice(0, 240),
          last_checked_at: new Date().toISOString(),
        }, ledgerStored ? `payment_key=eq.${encodeURIComponent(payment.paymentKey)}` : "", 1800);
        if (errorPatch.ok && errorPatch.matched) intent = errorPatch.row || intent;
        const alert = await notifyPaymentIntentWithLease(intent, orderInfo, payment, requestStartedAt, true, {
          reason: saveResult.reason,
          headline: "결제는 완료됐지만 주문 DB 저장 실패",
        });
        smsResult = alert.sms;
        telegramResult = alert.telegram;
      } else {
        // intent 테이블 자체가 없는 전환구간은 cron 복구가 불가능하므로 이 응답에서 반드시 알린다.
        const criticalOrder = {
          ...orderInfo,
          confirmTags: ["결제완료·DB저장실패", ...(Array.isArray(orderInfo.confirmTags) ? orderInfo.confirmTags : [])],
        };
        [smsResult, telegramResult] = await Promise.all([
          notifyOwners(criticalOrder, payment),
          notifyCriticalPayment(criticalOrder, payment, saveResult.reason),
        ]);
      }
    }

    const needsReconciliation = !!intent && (!saveResult.saved || !ledgerStored || !finalized);
    const manualRecovery = !intent && !saveResult.saved;
    return res.status(200).json({
      ok: true,
      alreadyDone: !!confirmed.recovered,
      payment: publicPayment(payment),
      // 고객에게 내부 공급자 오류·전화번호·채팅 정보가 새지 않게 성공 여부만 공개한다.
      notified: { sms: !!(smsResult && smsResult.sent), telegram: !!(telegramResult && telegramResult.sent) },
      saved: !!saveResult.saved,
      needsReconciliation,
      manualRecovery,
      integrity: intent ? "intent" : "legacy",
    });
  } catch (err) {
    console.error("confirm-payment error:", err && err.name || "unknown");
    return res.status(500).json({ error: "결제 확인 중 오류가 발생했습니다. 주문번호로 문의해주세요." });
  }
}
