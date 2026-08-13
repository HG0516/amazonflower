// Shared administrator authentication for the existing serverless functions.
// Supabase signs and expires the access token; this module asks Supabase to
// validate it, then applies a server-only UID/email allowlist.

import crypto from "node:crypto";

const LEGACY_FALLBACK_EMAILS = ["hggod0516@naver.com"];
const VALID_MODES = new Set(["dual", "jwt"]);

function values(name, lower = false) {
  const raw = String(process.env[name] || "");
  const out = raw.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
  return new Set(lower ? out.map((v) => v.toLowerCase()) : out);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (!aa.length || aa.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(aa, bb); } catch { return false; }
}

function bearer(req) {
  const value = req.headers.authorization || req.headers.Authorization || "";
  const match = String(value).match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

function authMode() {
  const configured = String(process.env.ADMIN_AUTH_MODE || "dual").toLowerCase();
  return VALID_MODES.has(configured) ? configured : "dual";
}

function adminLists() {
  const ownerIds = values("ADMIN_OWNER_IDS");
  const staffIds = values("ADMIN_STAFF_IDS");
  const ownerEmails = values("ADMIN_OWNER_EMAILS", true);
  const staffEmails = values("ADMIN_STAFF_EMAILS", true);
  const compatibilityEmails = values("ADMIN_EMAILS", true);

  // Keep the already deployed owner usable during migration. Once either a UID
  // list or an email list is configured on the server, the hard-coded fallback
  // disappears automatically once an owner UID/email is configured.
  if (!ownerIds.size && !ownerEmails.size && !compatibilityEmails.size) {
    for (const email of LEGACY_FALLBACK_EMAILS) ownerEmails.add(email);
  }
  for (const email of compatibilityEmails) ownerEmails.add(email);
  return { ownerIds, staffIds, ownerEmails, staffEmails };
}

function roleFor(user) {
  const { ownerIds, staffIds, ownerEmails, staffEmails } = adminLists();
  const uid = String(user && user.id || "");
  const email = String(user && user.email || "").trim().toLowerCase();
  if (uid && ownerIds.has(uid)) return { role: "owner", allowlist: "uid" };
  if (uid && staffIds.has(uid)) return { role: "staff", allowlist: "uid" };
  if (email && ownerEmails.has(email)) return { role: "owner", allowlist: "email_fallback" };
  if (email && staffEmails.has(email)) return { role: "staff", allowlist: "email_fallback" };
  return null;
}

async function validateSupabaseUser(token, supabaseUrl, serviceKey) {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { ok: false, status: 401, error: "로그인이 만료됐어요. 다시 로그인해주세요." };
    const user = await response.json().catch(() => null);
    if (!user || !user.id) return { ok: false, status: 401, error: "로그인이 만료됐어요. 다시 로그인해주세요." };
    return { ok: true, user };
  } catch {
    // Never fall back to trusting a decoded JWT when the identity provider is
    // unavailable. A dual-mode legacy password may still be checked below.
    return { ok: false, status: 503, error: "로그인 확인이 잠시 지연되고 있어요. 다시 시도해주세요." };
  }
}

export function setAdminHeaders(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

export function requireRole(auth, roles = ["owner", "staff"]) {
  if (!auth || !auth.ok) return { ok: false, status: auth && auth.status || 401, error: auth && auth.error || "로그인이 필요합니다." };
  if (!roles.includes(auth.role)) return { ok: false, status: 403, error: "이 작업은 대표 관리자만 할 수 있어요." };
  return { ok: true };
}

export async function authenticateAdmin(req, body, { supabaseUrl, serviceKey, allowLegacy = true } = {}) {
  if (!supabaseUrl || !serviceKey) return { ok: false, status: 503, error: "관리자 기능이 아직 설정되지 않았습니다." };

  const token = bearer(req);
  let tokenFailure = null;
  if (token) {
    const checked = await validateSupabaseUser(token, supabaseUrl, serviceKey);
    if (checked.ok) {
      const access = roleFor(checked.user);
      if (!access) {
        return { ok: false, status: 403, error: "관리자 권한이 없는 계정이에요.", userId: checked.user.id, authMethod: "supabase" };
      }
      return {
        ok: true,
        role: access.role,
        userId: checked.user.id,
        authMethod: access.allowlist === "uid" ? "supabase_uid" : "supabase_email_fallback",
      };
    }
    tokenFailure = checked;
  }

  const mode = authMode();
  const legacyPassword = process.env.ADMIN_PASSWORD || "";
  if (mode === "dual" && allowLegacy && legacyPassword && safeEqual(body && body.password, legacyPassword)) {
    return { ok: true, role: "owner", userId: null, authMethod: "legacy_password" };
  }

  if (tokenFailure) return tokenFailure;
  return {
    ok: false,
    status: 401,
    error: mode === "jwt" ? "관리자 로그인이 필요합니다." : "관리자 로그인이 필요합니다. 예전 화면은 비밀번호를 다시 확인해주세요.",
  };
}

function cleanAudit(value, max = 100) {
  return String(value == null ? "" : value).replace(/[<>"'`\\\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

export function requestId(req) {
  const supplied = String(req.headers["x-vercel-id"] || req.headers["x-request-id"] || "").trim();
  return cleanAudit(supplied, 100) || crypto.randomUUID();
}

// Logging must never block or replay the business action. The table deliberately
// accepts only a small, non-PII payload (no request body, password, token or photo).
export async function writeAdminAudit({ supabaseUrl, serviceKey, auth, action, resource, targetId, outcome = "success", detail, requestId: rid }) {
  if (!supabaseUrl || !serviceKey) return false;
  // 인터넷에 공개된 관리자 엔드포인트를 아무나 두드려 감사 테이블을 채우는 쓰기 증폭을
  // 막는다. 실제로 검증된 관리자/JWT 사용자(권한 없음 포함)나 서명된 내부 링크만 기록한다.
  if (!auth || (!auth.userId && !auth.ok && auth.authMethod !== "refund_link")) return false;
  const row = {
    actor_user_id: auth && auth.userId || null,
    actor_role: cleanAudit(auth && auth.role || "unknown", 20),
    auth_method: cleanAudit(auth && auth.authMethod || "unknown", 40),
    action: cleanAudit(action, 60),
    resource: cleanAudit(resource, 40),
    target_id: cleanAudit(targetId, 100),
    outcome: cleanAudit(outcome, 20) || "unknown",
    detail: cleanAudit(detail, 240),
    request_id: cleanAudit(rid, 100),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/admin_audit_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    if (!response.ok) console.warn("admin audit write failed", response.status, row.request_id);
    return response.ok;
  } catch {
    console.warn("admin audit write failed", row.request_id);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
