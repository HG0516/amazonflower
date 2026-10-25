// lib/points.mjs — 적립금 쓰기·추천인 (2026-10-25 형구 결정, SQL = supabase-points-referral.sql)
//
// 켜고 끄기는 Vercel 설정값 하나로 한다(코드 배포 없이).
//   POINTS_MODE          off(기본) · owner(POINTS_TEST_EMAILS 또는 ADMIN_OWNER_EMAILS 회원만) · on(모든 회원)
//   POINTS_EXCLUDE_CATS  적립금을 못 쓰는 상품 분류, 쉼표로(예: condolence,congrats). 비우면 전부 가능.
// 금액 규칙은 여기 한 곳. 화면은 /api/confirm-payment?config 의 points 로 같은 값을 받아 보여 주고,
// 서버가 승인 전에 다시 본다. 차감·반환·추천 보상은 DB 함수가 한 번에(두 번 안 들어가게) 한다.

import { fetchJsonWithTimeout, serviceHeaders } from "./payment-integrity.mjs";

export const POINTS_RULES = Object.freeze({
  minOrder: 30000,     // 이 금액 이상 주문에만
  maxUse: 3000,        // 한 주문에 최대
  unit: 1000,          // 1,000원 단위
  referJoin: 1000,     // 추천·매장 링크로 가입하면 더 주는 금액(가입 2,000 + 1,000)
  referReward: 3000,   // 친구 첫 주문이 배송되고 7일 지나면 추천한 사람에게
});

export function pointsMode(env = process.env) {
  const m = String(env.POINTS_MODE || "").trim().toLowerCase();
  return m === "on" || m === "owner" ? m : "off";
}

export function pointsExcludedCats(env = process.env) {
  return String(env.POINTS_EXCLUDE_CATS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function testerEmails(env) {
  return String(env.POINTS_TEST_EMAILS || env.ADMIN_OWNER_EMAILS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// owner 모드: 시험하는 사람(형구) 계정만. 손님에게 켜기 전 실결제·환불을 직접 해 보는 단계.
export function pointsAllowedFor(user, env = process.env) {
  const mode = pointsMode(env);
  if (mode === "off" || !user || !user.id) return false;
  if (mode === "on") return true;
  return !!user.email && testerEmails(env).includes(String(user.email).toLowerCase());
}

export function pointsConfig(env = process.env) {
  return { mode: pointsMode(env), ...POINTS_RULES, exclude: pointsExcludedCats(env) };
}

/** 이 주문에 이만큼 쓸 수 있는지. 금액 대조(결제액 + 적립금 = 상품값)는 부르는 쪽이 따로 한다. */
export function checkPointsUse({ use, total, balance, buyerType, customPay, bank, cats = [], exclude = [] }) {
  const n = Number(use);
  const R = POINTS_RULES;
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "적립금 금액이 올바르지 않아요." };
  if (customPay) return { ok: false, error: "맞춤 결제 링크에는 적립금을 쓸 수 없어요." };
  if (bank) return { ok: false, error: "적립금은 카드·간편결제에서만 쓸 수 있어요." };
  if (buyerType === "corp") return { ok: false, error: "계산서를 받는 법인 주문에는 적립금을 쓸 수 없어요." };
  if (cats.some((c) => c && exclude.includes(c))) return { ok: false, error: "이 상품에는 적립금을 쓸 수 없어요." };
  if (n % R.unit) return { ok: false, error: `적립금은 ${R.unit.toLocaleString()}원 단위로 쓸 수 있어요.` };
  if (n > R.maxUse) return { ok: false, error: `적립금은 한 주문에 ${R.maxUse.toLocaleString()}원까지 쓸 수 있어요.` };
  if (!(Number(total) >= R.minOrder)) return { ok: false, error: `적립금은 ${R.minOrder.toLocaleString()}원 이상 주문에 쓸 수 있어요.` };
  if (!(Number(balance) >= n)) return { ok: false, error: "적립금이 모자라요. 주문을 처음부터 다시 해 주세요." };
  if (n >= Number(total)) return { ok: false, error: "적립금 금액이 올바르지 않아요." };
  return { ok: true, use: n };
}

async function rpc(supabaseUrl, serviceKey, name, args, timeoutMs = 2500) {
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: "supabase_env_missing" };
  try {
    const out = await fetchJsonWithTimeout(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
      body: JSON.stringify(args || {}),
    }, timeoutMs);
    if (!out.response.ok) return { ok: false, reason: `rpc_${out.response.status}` };
    return { ok: true, data: out.data };
  } catch {
    return { ok: false, reason: "rpc_exception" };
  }
}

export async function readPointsBalance(supabaseUrl, serviceKey, userId) {
  if (!supabaseUrl || !serviceKey || !userId) return null;
  try {
    const out = await fetchJsonWithTimeout(
      `${supabaseUrl}/rest/v1/points_balance?user_id=eq.${encodeURIComponent(userId)}&select=balance&limit=1`,
      { headers: serviceHeaders(serviceKey) }, 2200,
    );
    if (!out.response.ok) return null;
    const row = Array.isArray(out.data) ? out.data[0] : null;
    return row ? Number(row.balance) || 0 : 0;
  } catch {
    return null;
  }
}

const USE_ERRORS = {
  insufficient: "적립금이 모자라요. 주문을 처음부터 다시 해 주세요.",
  phone_used: "이 전화번호로는 다른 계정에서 이미 적립금을 썼어요. 적립금 없이 다시 주문해 주세요.",
  bad: "적립금 정보가 맞지 않아요. 주문을 처음부터 다시 해 주세요.",
};

// 토스 승인 직전에 부른다. 실패면 승인하지 않는다(돈이 빠져나가기 전).
export async function reservePoints(supabaseUrl, serviceKey, { userId, orderId, amount, phone }) {
  if (!userId) return { ok: false, error: "적립금은 로그인해야 쓸 수 있어요." };
  const out = await rpc(supabaseUrl, serviceKey, "use_points", {
    p_user: userId, p_order: orderId, p_amount: Number(amount) || 0, p_phone: String(phone || ""),
  });
  if (!out.ok) return { ok: false, error: "적립금을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", reason: out.reason };
  const r = String(out.data || "");
  if (r === "ok" || r === "already") return { ok: true, result: r };
  return { ok: false, result: r, error: USE_ERRORS[r] || USE_ERRORS.bad };
}

// 승인 실패 직후. 실패해도 5분 점검(points_reconcile)이 다시 돌려준다.
export async function restorePoints(supabaseUrl, serviceKey, orderId) {
  const out = await rpc(supabaseUrl, serviceKey, "restore_points", { p_order: orderId }, 2000);
  return out.ok ? { ok: true, result: String(out.data || "") } : out;
}

export async function reconcilePoints(supabaseUrl, serviceKey) {
  const out = await rpc(supabaseUrl, serviceKey, "points_reconcile", {}, 8000);
  return out.ok ? { ok: true, ...(out.data && typeof out.data === "object" ? out.data : {}) } : out;
}
