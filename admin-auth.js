// Common login guard and authenticated fetch for every administrator page.
// Uses the site's existing Supabase session; no password or access token is
// copied into localStorage by this code (Supabase owns its rotating session).
(function () {
  "use strict";

  try { localStorage.removeItem("af_admin_pw"); } catch (_) {}

  var READY_TIMEOUT = 12000;
  var client = null;
  var session = null;
  var access = null;
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function addStyle() {
    if (document.getElementById("af-admin-auth-style")) return;
    var style = document.createElement("style");
    style.id = "af-admin-auth-style";
    style.textContent =
      ".af-admin-gate{position:fixed;inset:0;z-index:10050;background:#f7f4ee;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;}" +
      ".af-admin-gate-card{width:100%;max-width:430px;background:#fff;border:1px solid #dcd9cf;border-radius:16px;padding:26px 20px;text-align:center;box-shadow:0 10px 35px rgba(31,29,24,.08);}" +
      ".af-admin-gate h2{font-size:22px;margin:8px 0;color:#1f1d18}.af-admin-gate p{font-size:15px;line-height:1.65;color:#5a564d;margin:0 0 16px;}" +
      ".af-admin-login,.af-admin-retry{width:100%;min-height:52px;border:0;border-radius:10px;background:#1f4733;color:#fff;font:800 17px inherit;padding:13px;cursor:pointer;margin-top:8px;}" +
      ".af-admin-logout{background:transparent;border:0;color:#7a766c;font:600 14px inherit;padding:15px;cursor:pointer;}" +
      ".af-admin-who{font-size:12px;color:#7a766c;text-align:right;padding:8px 14px 0;max-width:680px;margin:0 auto;}";
    document.head.appendChild(style);
  }

  function gate(title, message, button, onClick, canLogout) {
    addStyle();
    var old = document.getElementById("af-admin-gate");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "af-admin-gate";
    el.className = "af-admin-gate";
    el.innerHTML = '<div class="af-admin-gate-card"><div style="font-size:44px">🌸</div><h2></h2><p></p>' +
      (button ? '<button class="af-admin-login" type="button"></button>' : "") +
      (canLogout ? '<button class="af-admin-logout" type="button">다른 계정으로 로그인</button>' : "") + "</div>";
    el.querySelector("h2").textContent = title;
    el.querySelector("p").textContent = message;
    if (button) {
      var main = el.querySelector(".af-admin-login");
      main.textContent = button;
      main.onclick = onClick;
    }
    if (canLogout) el.querySelector(".af-admin-logout").onclick = logoutAndLogin;
    document.body.appendChild(el);
    return el;
  }

  function removeGate() {
    var el = document.getElementById("af-admin-gate");
    if (el) el.remove();
  }

  function desiredProvider() {
    // Existing shop owner account uses Naver. A page/deployment may override this
    // with data-admin-provider after its UID has been added to the server allowlist.
    return (document.documentElement.getAttribute("data-admin-provider") || "naver").toLowerCase();
  }

  function login() {
    if (!client) return location.reload();
    var provider = desiredProvider();
    if (provider === "naver") {
      try { sessionStorage.setItem("af_admin_return", location.pathname + location.search); } catch (_) {}
      location.href = "/api/naver-login";
      return;
    }
    var options = { redirectTo: location.href };
    if (provider === "kakao") options.scopes = "profile_nickname";
    client.auth.signInWithOAuth({ provider: provider, options: options }).then(function (result) {
      if (result.error) gate("로그인을 시작하지 못했어요", "잠시 후 다시 시도해주세요.", "다시 시도", login, false);
    });
  }

  function logoutAndLogin() {
    if (!client) return location.reload();
    client.auth.signOut().then(function () { session = null; access = null; login(); });
  }

  async function token(forceRefresh) {
    if (!client) return "";
    if (forceRefresh) {
      var refreshed = await client.auth.refreshSession().catch(function () { return null; });
      session = refreshed && refreshed.data && refreshed.data.session || null;
    } else {
      var current = await client.auth.getSession().catch(function () { return null; });
      session = current && current.data && current.data.session || null;
    }
    return session && session.access_token || "";
  }

  async function rawSessionCheck(forceRefresh) {
    var jwt = await token(forceRefresh);
    if (!jwt) return { ok: false, status: 401, data: { error: "로그인이 필요합니다." } };
    var response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + jwt },
      cache: "no-store",
      body: JSON.stringify({ resource: "session", action: "check" }),
    });
    var data = await response.json().catch(function () { return {}; });
    return { ok: response.ok, status: response.status, data: data };
  }

  function who() {
    if (!access || document.getElementById("af-admin-who")) return;
    var el = document.createElement("div");
    el.id = "af-admin-who";
    el.className = "af-admin-who";
    el.textContent = (access.role === "owner" ? "대표 관리자" : "운영 관리자") + "로 로그인됨";
    document.body.insertBefore(el, document.body.firstChild);
  }

  async function checkAccess() {
    var first = await rawSessionCheck(false);
    if (!first.ok && first.status === 401 && session) first = await rawSessionCheck(true);
    if (first.ok) {
      access = first.data;
      if (document.documentElement.getAttribute("data-admin-role") === "owner" && access.role !== "owner") {
        gate("대표 관리자만 열 수 있어요", "가격·결제·환불 관련 화면은 대표 관리자 계정으로 로그인해주세요.", null, null, true);
        readyResolve(null);
        return;
      }
      removeGate();
      who();
      if (access.role !== "owner") {
        Array.prototype.forEach.call(document.querySelectorAll("[data-owner-only]"), function (el) { el.style.display = "none"; });
      }
      readyResolve(access);
      try { document.dispatchEvent(new CustomEvent("af-admin-ready", { detail: access })); } catch (_) {}
      return;
    }
    if (first.status === 403) {
      gate("관리자 권한이 없어요", "등록된 관리자 계정으로 다시 로그인해주세요.", null, null, true);
    } else {
      gate("관리자 로그인이 필요해요", "한 번 로그인하면 이 휴대폰에서 계속 사용할 수 있어요.", "네이버로 관리자 로그인", login, false);
    }
    readyResolve(null);
  }

  async function adminFetch(url, options) {
    options = options || {};
    await Promise.race([ready, new Promise(function (resolve) { setTimeout(resolve, READY_TIMEOUT); })]);
    var jwt = await token(false);
    if (!jwt) {
      gate("로그인이 풀렸어요", "다시 로그인한 뒤 작업을 계속해주세요.", "다시 로그인", login, false);
      return new Response(JSON.stringify({ error: "관리자 로그인이 필요합니다." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    var headers = new Headers(options.headers || {});
    headers.set("Authorization", "Bearer " + jwt);
    var request = Object.assign({}, options, { headers: headers, cache: "no-store" });
    var response = await fetch(url, request);
    if (response.status === 401) {
      jwt = await token(true);
      if (jwt) {
        headers.set("Authorization", "Bearer " + jwt);
        response = await fetch(url, Object.assign({}, options, { headers: headers, cache: "no-store" }));
      }
    }
    if (response.status === 401 || response.status === 403) {
      var denied = await response.clone().json().catch(function () { return {}; });
      gate(response.status === 403 ? "이 작업 권한이 없어요" : "로그인이 풀렸어요", denied.error || "다시 로그인해주세요.", response.status === 401 ? "다시 로그인" : null, login, true);
    }
    return response;
  }

  window.afAdmin = {
    ready: ready,
    fetch: adminFetch,
    get role() { return access && access.role || null; },
    can: function (required) { return !!access && (access.role === "owner" || required === "staff"); },
    logout: logoutAndLogin,
  };

  addStyle();
  gate("관리자 확인 중", "잠시만 기다려주세요.", null, null, false);

  function start() {
    if (!window.SUPA || !window.SUPA.url || !window.SUPA.anon || !window.supabase || !window.supabase.createClient) {
      gate("로그인 설정을 불러오지 못했어요", "인터넷 연결을 확인하고 다시 열어주세요.", "새로고침", function () { location.reload(); }, false);
      readyResolve(null);
      return;
    }
    client = window.supabase.createClient(window.SUPA.url, window.SUPA.anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange(function (_event, next) { session = next || null; });
    checkAccess();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
