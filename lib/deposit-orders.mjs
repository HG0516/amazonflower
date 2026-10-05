// 입금 대기 주문(무통장입금·가상계좌) 공용 도구.
//
// 돈이 아직 안 들어온 주문은 'awaiting_deposit' 상태로 둔다. 마감 경고·브리핑·텔레그램
// '발주 완료' 버튼은 모두 status=new 만 보므로, 입금 전 주문은 자동으로 거기서 빠진다
// (= 돈 안 받고 꽃을 만드는 사고 방지). 입금이 확인될 때만 new(접수)로 넘긴다.
//
//  - 가상계좌: 토스가 입금 웹훅(DEPOSIT_CALLBACK)을 보낸다. 웹훅 본문은 믿지 않고
//    토스 결제 조회 API로 다시 확인한 뒤에만 넘긴다. 웹훅이 유실돼도 30분 크론이 재조회한다.
//    만료 웹훅은 없어서 크론이 기한 지난 주문을 만료 처리한다.
//  - 무통장입금(가게 고정 계좌): 확인 수단이 사람뿐이라 관리자가 '입금 확인'을 누른다.
//
// 이 파일은 payment-integrity.mjs 를 가져다 쓰기만 한다(반대 방향 import 금지 — 순환 방지).

import crypto from "node:crypto";
import { fetchJsonWithTimeout, serviceHeaders, verifyDonePayment, vaSecretHash } from "./payment-integrity.mjs";
import { sendTransactionalText } from "./solapi.mjs";
import { bankName } from "./banks.mjs";
import { compatFetchJson } from "./schema-compat.mjs";

export { bankName };
export const AWAITING = "awaiting_deposit";
export const EXPIRED = "expired";
export const VA_METHOD = "가상계좌";
export const BANK_TRANSFER = "BANK_TRANSFER"; // 손님이 주문서에서 고른 무통장입금
export const MANUAL_BANK = "MANUAL_BANK";     // 사장님이 관리자에서 손으로 넣은 전화·무통장 주문
export const DEPOSIT_HOURS = 24;              // 형구 결정(10/4): 고령 손님이 은행 가는 시간 감안
// 기한이 지난 뒤 이만큼 더 기다렸다 만료 처리한다(은행 처리 지연·시계 차이 흡수).
const EXPIRY_GRACE_MS = 15 * 60 * 1000;

// 가게 고정 입금 계좌 — footer.js·index.html 결제 안내와 같은 값이어야 한다.
export const SHOP_BANK = Object.freeze({ name: "기업은행", account: "169-165982-04-025", holder: "(주)아마존" });

export const virtualAccountEnabled = (env = process.env) => env.VIRTUAL_ACCOUNT_ENABLED === "1";
export const bankTransferEnabled = (env = process.env) => env.BANK_TRANSFER_ENABLED === "1";
// 실시간 계좌이체(토스 TRANSFER) — 승인 즉시 DONE 이라 입금 대기가 없다. 주문서에 버튼을 보일지만 정한다.
export const transferEnabled = (env = process.env) => env.TRANSFER_ENABLED === "1";

export function isWaitingVirtualAccount(payment) {
  return !!(payment && payment.status === "WAITING_FOR_DEPOSIT" && payment.method === VA_METHOD
    && payment.virtualAccount && payment.virtualAccount.accountNumber);
}

// 가상계좌는 승인 직후 DONE 이 아니라 WAITING_FOR_DEPOSIT(계좌 발급)이다.
// 기능이 켜졌을 때만 그것도 정상 승인으로 받는다. 신원(주문번호·금액·결제키) 검사는 그대로다.
export function verifyAcceptedPayment(payment, expected, env = process.env) {
  const v = verifyDonePayment(payment, expected);
  if (v.ok) return v;
  if (v.reason === "status_WAITING_FOR_DEPOSIT" && virtualAccountEnabled(env) && isWaitingVirtualAccount(payment)) {
    return { ok: true, waitingDeposit: true };
  }
  return v;
}

export const secretHash = vaSecretHash;

// ── 시각 표기(한국시간) ──
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function fmtKst(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WD[d.getUTCDay()]}) ${ap} ${h12}시${m ? ` ${m}분` : ""}`;
}
const kstIsoDate = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const base = () => (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
const lookupLink = (oid) => `${base()}/order-lookup.html?o=${encodeURIComponent(oid || "")}`;

// 주문 원장(orders 행)을 문자에 쓸 형태로. 웹훅·크론에는 원래 주문서가 없고 DB 행만 있다.
function rowFacts(row) {
  const place = [row.venue, row.address].filter(Boolean).join(" · ");
  const when = [row.event_date, row.event_time].filter(Boolean).join(" ");
  return { place, when, amount: row.paid_amount || row.amount };
}

// ── 문자·텔레그램 문구 ──────────────────────────────────────────────
export function ownerWaitingText({ orderId, productLabel, amount, place, when, sender, senderPhone, account, dueAt, method, depositorName, cashReceipt }) {
  const L = [];
  L.push(`🕐 ${method === VA_METHOD ? "가상계좌" : "무통장입금"} 입금 대기 — 아직 발주하지 마세요`);
  L.push("입금이 확인되면 '입금 확인' 알림이 따로 갑니다.");
  L.push("");
  L.push(`상품: ${productLabel || "-"}`);
  L.push(`금액: ${won(amount)}`);
  if (when) L.push(`받는 날: ${when}`);
  if (place) L.push(`받는 곳: ${place}`);
  L.push(`주문자: ${[sender, senderPhone].filter(Boolean).join(" ") || "-"}`);
  if (depositorName) L.push(`입금자명: ${depositorName}`);
  if (account) L.push(`입금 계좌: ${account}`);
  if (dueAt) L.push(`입금 기한: ${fmtKst(dueAt)}`);
  if (cashReceipt) L.push(`현금영수증: ${cashReceipt}`);
  L.push(`주문번호: ${orderId}`);
  return L.join("\n");
}

export function customerWaitingText({ orderId, amount, account, dueAt, depositorName, sameDay, method }) {
  const L = [];
  L.push("[꽃안부] 주문이 접수됐어요. 아래 계좌로 입금해 주세요.");
  L.push("");
  L.push(`입금 계좌: ${account}`);
  L.push(`금액: ${won(amount)}`);
  if (depositorName && method !== VA_METHOD) L.push(`입금자명: ${depositorName}`);
  if (dueAt) L.push(`기한: ${fmtKst(dueAt)}까지`);
  L.push("");
  L.push("입금이 확인되면 문자로 알려드리고 그때부터 만들기 시작해요.");
  if (sameDay) L.push("오늘 배송은 입금이 늦어지면 어려울 수 있어 전화드릴게요.");
  L.push(`주문 조회: ${lookupLink(orderId)}`);
  L.push("문의 1577-2286");
  return L.join("\n");
}

export function ownerDepositedText(row) {
  const f = rowFacts(row);
  const today = row.event_date && String(row.event_date).slice(0, 10) === kstIsoDate();
  const L = [];
  L.push("✅ 입금 확인 — 발주하세요");
  if (today) L.push("⚠️ 오늘 배송 주문입니다");
  L.push("");
  L.push(`상품: ${row.product_label || "-"}`);
  L.push(`금액: ${won(f.amount)}`);
  if (f.when) L.push(`받는 날: ${f.when}`);
  if (f.place) L.push(`받는 곳: ${f.place}`);
  if (row.recipient_name) L.push(`받는 분: ${row.recipient_name}`);
  if (row.ribbon) L.push(`리본: ${row.ribbon}`);
  if (row.note) L.push(`요청: ${row.note}`);
  L.push(`주문자: ${[row.sender_name, row.sender_phone].filter(Boolean).join(" ") || "-"}`);
  L.push(`주문번호: ${row.order_id}`);
  return L.join("\n");
}

export function customerDepositedText(row) {
  return [
    "[꽃안부] 입금이 확인됐어요. 정성껏 준비해 보내드릴게요.",
    "배송 후 도착 사진을 이 번호로 보내드립니다.",
    `주문 조회: ${lookupLink(row.order_id)}`,
    "문의 1577-2286",
  ].join("\n");
}

// ── 보내기 ─────────────────────────────────────────────────────────
// 실패해도 주문 상태 전환은 되돌리지 않는다(알림 때문에 원장이 흔들리면 안 된다).
export async function sendOwnerTelegram(text, { orderId = "", withOrderButtons = false } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: "telegram_env_missing" };
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  let reply_markup;
  const cs = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
  if (withOrderButtons && orderId && cs) {
    // order-confirm.js 의 '발주 완료 처리' 버튼과 같은 서명(confirm:<주문번호>).
    const tk = crypto.createHmac("sha256", cs).update("confirm:" + orderId).digest("hex").slice(0, 20);
    reply_markup = { inline_keyboard: [[
      { text: "✅ 발주 완료 처리", url: `${base()}/api/order-confirm?id=${encodeURIComponent(orderId)}&t=${tk}` },
      { text: "📷 완료사진", url: `${base()}/admin-order.html?order=${encodeURIComponent(orderId)}` },
    ]] };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: tag + text, disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }),
      signal: ac.signal,
    });
    return { sent: r.ok };
  } catch {
    return { sent: false, reason: "telegram_exception" };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendCustomerText(phone, text, subject = "꽃안부 안내") {
  try { return await sendTransactionalText({ to: phone, text, subject }); }
  catch { return { sent: false, reason: "exception" }; }
}

// ── 주문 원장 읽기·전환 ─────────────────────────────────────────────
const ROW_BASE = [
  "order_id", "status", "product_label", "amount", "paid_amount", "event_date", "event_time",
  "venue", "address", "recipient_name", "ribbon", "note", "sender_name", "sender_phone", "created_at",
];
const ROW_PAYMENT = ["payment_method", "va_secret_hash", "va_due", "deposited_at", "alerted_at"];

// 결제 칸이 아직 없는 DB(SQL 미적용)에서도 읽히게 두 번 시도한다.
export async function readOrderRow(supabaseUrl, serviceKey, orderId) {
  for (const cols of [[...ROW_BASE, ...ROW_PAYMENT], ROW_BASE]) {
    const out = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=${cols.join(",")}&limit=1`,
      { headers: serviceHeaders(serviceKey) }, 2500,
    );
    if (out.response.ok) return { ok: true, row: Array.isArray(out.data) ? out.data[0] || null : null };
    if (!/42703|PGRST204|does not exist|schema cache/i.test(out.text || "")) return { ok: false, transient: true };
  }
  return { ok: false, transient: true };
}

// from 상태일 때만 to 로 바꾼다(CAS). 웹훅·크론·관리자가 동시에 와도 한 번만 성공한다.
// patch 의 결제 칸이 없는 DB면 상태만 바꾼다.
async function casStatus(supabaseUrl, serviceKey, orderId, from, patch) {
  const url = `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&status=eq.${encodeURIComponent(from)}`;
  const send = (body) => fetchJsonWithTimeout(url, {
    method: "PATCH",
    headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(body),
  }, 2500);
  let out = await send(patch);
  if (!out.response.ok && /42703|PGRST204|does not exist|schema cache/i.test(out.text || "")) {
    out = await send({ status: patch.status });
  }
  if (!out.response.ok) return { ok: false, transient: true };
  const rows = Array.isArray(out.data) ? out.data : [];
  return { ok: true, matched: rows.length > 0, row: rows[0] || null };
}

// 입금 확인 → 접수. 사장님에게 '발주하세요', 손님에게 '입금 확인' 문자.
export async function markDeposited(supabaseUrl, serviceKey, row, extra = {}) {
  const now = new Date().toISOString();
  const cas = await casStatus(supabaseUrl, serviceKey, row.order_id, AWAITING, {
    status: "new", deposited_at: now, ...extra,
  });
  if (!cas.ok) return cas;
  if (!cas.matched) return { ok: true, matched: false };
  const merged = { ...row, ...(cas.row || {}), status: "new" };
  const [telegram, sms] = await Promise.all([
    sendOwnerTelegram(ownerDepositedText(merged), { orderId: row.order_id, withOrderButtons: true }),
    row.sender_phone ? sendCustomerText(row.sender_phone, customerDepositedText(merged), "꽃안부 입금 확인") : Promise.resolve({ sent: false, reason: "no_phone" }),
  ]);
  return { ok: true, matched: true, notified: { telegram: !!telegram.sent, sms: !!sms.sent } };
}

// ── 가상계좌: 토스 원장을 기준으로 주문 상태를 맞춘다 ─────────────────
// 웹훅(source="webhook")과 크론(source="cron")이 같은 함수를 쓴다.
// 반환: { ok, action, retry } — retry=true 면 웹훅에 500 을 돌려 토스가 다시 보내게 한다.
export async function settleVirtualAccountOrder({ supabaseUrl, serviceKey, secretKey, orderId, webhookSecret = null, now = Date.now() }) {
  const read = await readOrderRow(supabaseUrl, serviceKey, orderId);
  if (!read.ok) return { ok: false, action: "db_read_failed", retry: true };
  const row = read.row;

  const auth = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
  let toss;
  try {
    toss = await fetchJsonWithTimeout(
      `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`,
      { headers: { Authorization: auth } }, 3000,
    );
  } catch {
    return { ok: false, action: "toss_unreachable", retry: true };
  }
  if (toss.response.status === 404) return { ok: true, action: "toss_not_found" };
  if (!toss.response.ok) return { ok: false, action: "toss_error", retry: toss.response.status >= 500 || toss.response.status === 429 };
  const pay = toss.data || {};
  if (pay.orderId !== orderId || pay.method !== VA_METHOD) return { ok: true, action: "not_virtual_account" };

  if (!row) {
    // 토스엔 입금된 가상계좌가 있는데 주문 원장에 없다 — 돈만 받고 주문이 없는 상태. 사람이 봐야 한다.
    if (pay.status === "DONE") {
      await sendOwnerTelegram(`🚨 가상계좌 입금은 됐는데 주문 원장에 없어요\n주문번호: ${orderId}\n금액: ${won(pay.totalAmount)}\n토스 상점관리자에서 확인해 주세요.`);
      return { ok: true, action: "orphan_alerted" };
    }
    return { ok: true, action: "order_not_found" };
  }
  const expectAmount = Number(row.paid_amount || row.amount);
  if (Number(pay.totalAmount) !== expectAmount) {
    await sendOwnerTelegram(`🚨 가상계좌 금액이 주문과 달라요 — 자동 처리 중단\n주문번호: ${orderId}\n주문 ${won(expectAmount)} / 토스 ${won(pay.totalAmount)}`);
    return { ok: true, action: "amount_mismatch" };
  }
  // 웹훅 비밀값은 승인 응답에만 온다. 저장해 뒀으면 대조한다(토스 재조회와 이중 확인).
  if (webhookSecret != null && row.va_secret_hash && secretHash(webhookSecret) !== row.va_secret_hash) {
    return { ok: true, action: "secret_mismatch" };
  }

  if (pay.status === "DONE") {
    if (row.status === AWAITING || row.status === EXPIRED) {
      const from = row.status;
      const extra = { payment_status: "DONE", approved_at: pay.approvedAt || null, receipt_url: pay.receipt && pay.receipt.url || null };
      const res = from === AWAITING
        ? await markDeposited(supabaseUrl, serviceKey, row, extra)
        : await (async () => {
          // 기한 만료로 닫았는데 뒤늦게 입금이 확인된 드문 경우 — 접수로 되살리고 따로 알린다.
          const cas = await casStatus(supabaseUrl, serviceKey, orderId, EXPIRED, { status: AWAITING });
          if (!cas.ok || !cas.matched) return cas;
          await sendOwnerTelegram(`⚠️ 기한 지나 닫았던 주문에 입금이 확인됐어요 — 접수로 되살립니다\n주문번호: ${orderId}`);
          return markDeposited(supabaseUrl, serviceKey, { ...row, status: AWAITING }, extra);
        })();
      if (!res.ok) return { ok: false, action: "transition_failed", retry: true };
      return { ok: true, action: res.matched ? "deposited" : "already_handled" };
    }
    return { ok: true, action: "already_deposited" };
  }

  if (pay.status === "WAITING_FOR_DEPOSIT") {
    // 입금 오류(일부 은행)로 DONE → WAITING 이 되돌아온 경우. 배송을 멈춰야 한다.
    if (row.status === "new" && row.deposited_at) {
      const cas = await casStatus(supabaseUrl, serviceKey, orderId, "new", { status: AWAITING, payment_status: "WAITING_FOR_DEPOSIT" });
      if (!cas.ok) return { ok: false, action: "revert_failed", retry: true };
      if (cas.matched) await sendOwnerTelegram(`⚠️ 은행에서 입금이 취소됐어요 — 발주·배송 멈추세요\n주문번호: ${orderId}\n입금 대기로 되돌렸습니다.`);
      return { ok: true, action: cas.matched ? "reverted" : "already_handled" };
    }
    if (["ordered", "delivered"].includes(row.status) && row.deposited_at) {
      await sendOwnerTelegram(`🚨 이미 발주·배송한 주문의 입금이 은행에서 취소됐어요\n주문번호: ${orderId}\n손님께 연락이 필요합니다.`);
      return { ok: true, action: "reverted_after_fulfilment" };
    }
    if (row.status === AWAITING) {
      const due = Date.parse(pay.virtualAccount && pay.virtualAccount.dueDate || row.va_due || "");
      if (Number.isFinite(due) && now > due + EXPIRY_GRACE_MS) {
        const cas = await casStatus(supabaseUrl, serviceKey, orderId, AWAITING, { status: EXPIRED });
        if (!cas.ok) return { ok: false, action: "expire_failed", retry: true };
        if (cas.matched) await sendOwnerTelegram(`⌛ 입금 기한이 지나 주문을 닫았어요(발주 X)\n${row.product_label || ""} ${won(expectAmount)}\n주문번호: ${orderId}`);
        return { ok: true, action: cas.matched ? "expired" : "already_handled" };
      }
    }
    return { ok: true, action: "still_waiting" };
  }

  if (["CANCELED", "ABORTED", "EXPIRED"].includes(pay.status) && row.status === AWAITING) {
    const cas = await casStatus(supabaseUrl, serviceKey, orderId, AWAITING, { status: EXPIRED });
    if (!cas.ok) return { ok: false, action: "close_failed", retry: true };
    if (cas.matched) await sendOwnerTelegram(`⌛ 가상계좌 결제가 토스에서 닫혔어요(${pay.status}) — 발주 X\n주문번호: ${orderId}`);
    return { ok: true, action: cas.matched ? "closed" : "already_handled" };
  }
  return { ok: true, action: "no_change" };
}

// 토스 웹훅 본문: { createdAt, secret, status, transactionKey, orderId } — paymentKey 없음.
// 본문은 신호로만 쓰고, 상태는 토스 조회로 확정한다. 잘못된 본문엔 200(재전송 막기), 일시 오류엔 500.
export async function handleDepositWebhook(body, { supabaseUrl, serviceKey, secretKey }) {
  const orderId = body && typeof body.orderId === "string" ? body.orderId : "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) return { status: 200, json: { ok: true, ignored: "bad_body" } };
  if (!supabaseUrl || !serviceKey || !secretKey) return { status: 500, json: { ok: false } };
  const secret = typeof body.secret === "string" ? body.secret.slice(0, 100) : null;
  const out = await settleVirtualAccountOrder({ supabaseUrl, serviceKey, secretKey, orderId, webhookSecret: secret });
  if (!out.ok && out.retry) return { status: 500, json: { ok: false } };
  return { status: 200, json: { ok: true } };
}

// ── 30분 크론 ──
// 가상계좌 입금 대기: 토스 재조회(웹훅 유실 보정·만료). 무통장 입금 대기: 기한 지나면 사장님에게 한 번 알림.
export async function reconcileDepositOrders({ supabaseUrl, serviceKey, secretKey, now = Date.now() }) {
  const out = { virtualAccount: 0, transitions: [], bankReminders: 0, skipped: false };
  // 결제 칸이 없는 옛 DB 에서도 무통장 기한 알림은 돌게 대비책을 거친다(lib/schema-compat).
  const q = await compatFetchJson(
    `${supabaseUrl}/rest/v1/orders?status=eq.${AWAITING}&cancel_requested_at=is.null&select=order_id,payment_method,created_at,va_due,alerted_at,product_label,amount,paid_amount,sender_name,sender_phone&order=created_at.asc&limit=40`,
    { headers: serviceHeaders(serviceKey) }, 3000,
  );
  if (!q.response.ok) {
    // 결제 칸이 없는 DB면 입금 대기 주문도 있을 수 없다(기능이 SQL 뒤에 켜진다).
    out.skipped = true;
    return out;
  }
  const rows = Array.isArray(q.data) ? q.data : [];
  for (const r of rows) {
    if (r.payment_method === VA_METHOD) {
      if (!secretKey) continue;
      out.virtualAccount++;
      const res = await settleVirtualAccountOrder({ supabaseUrl, serviceKey, secretKey, orderId: r.order_id, now });
      if (res.action && !["still_waiting", "no_change"].includes(res.action)) out.transitions.push(`${r.order_id}:${res.action}`);
      continue;
    }
    // 결제 칸이 없는 DB 에선 payment_method 가 비어 온다 — 무통장은 주문번호 AFB 로 알아본다.
    if (r.payment_method === BANK_TRANSFER || r.payment_method === MANUAL_BANK || (!r.payment_method && /^AFB/.test(r.order_id || ""))) {
      const created = Date.parse(r.created_at || "");
      if (r.alerted_at || !Number.isFinite(created) || now < created + DEPOSIT_HOURS * 3600000) continue;
      // 무통장은 자동으로 닫지 않는다 — 입금됐는데 사장님이 아직 못 누른 것일 수 있다.
      const claim = await fetchJsonWithTimeout(
        `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(r.order_id)}&status=eq.${AWAITING}&alerted_at=is.null`,
        { method: "PATCH", headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
          body: JSON.stringify({ alerted_at: new Date(now).toISOString() }) }, 2500,
      );
      if (claim.response.ok && Array.isArray(claim.data) && claim.data.length) {
        out.bankReminders++;
        await sendOwnerTelegram(
          `⏰ 무통장 입금 기한(${DEPOSIT_HOURS}시간)이 지난 주문이 있어요\n${r.product_label || ""} ${won(r.paid_amount || r.amount)}\n`
          + `주문자: ${[r.sender_name, r.sender_phone].filter(Boolean).join(" ")}\n주문번호: ${r.order_id}\n`
          + "통장을 확인해 입금됐으면 관리자에서 '입금 확인', 아니면 '주문 취소'를 눌러주세요.",
        );
      }
    }
  }
  return out;
}
