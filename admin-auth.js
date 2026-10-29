// Common login guard and authenticated fetch for every administrator page.
// Uses the site's existing Supabase session; no password or access token is
// copied into localStorage by this code (Supabase owns its rotating session).
(function () {
  "use strict";

  try { localStorage.removeItem("af_admin_pw"); } catch (_) {}
  // 관리자 화면을 연 기기는 방문 집계(va.js)에서 뺀다 — 가족·직원 방문이 손님 숫자에 섞이지 않게.
  try { localStorage.setItem("af_va_off", "1"); } catch (_) {}

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
      ".af-admin-gate h2{font-size:22px;margin:8px 0;color:#1f1d18}.af-admin-gate p{font-size:15px;line-height:1.65;color:#5a564d;margin:0 0 16px;white-space:pre-line;word-break:break-all;}" +
      ".af-admin-login,.af-admin-retry{width:100%;min-height:52px;border:0;border-radius:10px;background:#1f4733;color:#fff;font:800 17px inherit;padding:13px;cursor:pointer;margin-top:8px;}" +
      ".af-admin-logout{background:transparent;border:0;color:#7a766c;font:600 14px inherit;padding:15px;cursor:pointer;}" +
      ".af-admin-who{font-size:12px;color:#7a766c;text-align:right;padding:8px 14px 0;max-width:680px;margin:0 auto;}" +
      ".af-admin-out{background:transparent;border:0;color:#1f4733;font:700 12px inherit;text-decoration:underline;padding:6px 2px;cursor:pointer;}" +
      ".af-admin-nav{display:flex;gap:6px;overflow-x:auto;padding:8px 14px 2px;max-width:680px;margin:0 auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}" +
      ".af-admin-nav::-webkit-scrollbar{display:none}" +
      ".af-admin-nav a{flex:0 0 auto;min-height:36px;display:inline-flex;align-items:center;padding:0 12px;border:1px solid #dcd9cf;border-radius:999px;background:#fff;color:#3d3a33;font:700 13px -apple-system,'Apple SD Gothic Neo',sans-serif;text-decoration:none;white-space:nowrap;}" +
      ".af-admin-nav a.on{background:#1f4733;border-color:#1f4733;color:#fff;}";
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
      (canLogout ? '<button class="af-admin-logout" type="button">네이버 계정 바꾸기</button>' : "") + "</div>";
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

  function login(switchAccount) {
    if (!client) return location.reload();
    var provider = desiredProvider();
    if (provider === "naver") {
      try { sessionStorage.setItem("af_admin_return", location.pathname + location.search); } catch (_) {}
      location.href = "/api/naver-login?" + (switchAccount === true ? "switch=1&" : "") + "return=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    var options = { redirectTo: location.href };
    if (provider === "kakao") options.scopes = "profile_nickname";
    client.auth.signInWithOAuth({ provider: provider, options: options }).then(function (result) {
      if (result.error) gate("로그인을 시작하지 못했어요", "잠시 후 다시 시도해주세요.", "다시 시도", login, false);
    });
  }

  // 10/18 형구: 관리 화면에 로그아웃이 없었다. 로그아웃만 하고 로그인 버튼 화면으로 둔다(바로 다시 로그인하지 않게).
  function logout() {
    if (!client) return location.reload();
    client.auth.signOut().then(function () {
      session = null; access = null;
      var w = document.getElementById("af-admin-who");
      if (w) w.remove();
      gate("로그아웃했어요", "다시 쓰려면 아래 버튼으로 로그인해주세요.", "네이버로 관리자 로그인", login, false);
    });
  }

  function logoutAndLogin() {
    if (!client) return location.reload();
    client.auth.signOut().then(function () { session = null; access = null; login(true); });
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
    // 10/18 형구: 어느 네이버 계정으로 들어왔는지 보이고, 잘못 들어왔으면 바로 바꿀 수 있게.
    var mail = session && session.user && session.user.email || "";
    el.textContent = (access.role === "owner" ? "대표 관리자" : "운영 관리자") + (mail ? " " + mail : "") + "로 로그인됨 · ";
    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "af-admin-out";
    sw.textContent = "네이버 계정 바꾸기";
    sw.onclick = logoutAndLogin;
    el.appendChild(sw);
    el.appendChild(document.createTextNode(" · "));
    var out = document.createElement("button");
    out.type = "button";
    out.className = "af-admin-out";
    out.textContent = "로그아웃";
    out.onclick = logout;
    el.appendChild(out);
    document.body.insertBefore(el, document.body.firstChild);
    nav(el);
  }

  // 관리자 화면끼리 오가는 메뉴(10/18). 예전엔 화면마다 주소를 외워야 했다. 운영 관리자는 주문만.
  var MENU = [
    ["/admin-orders.html", "주문", "staff"],
    ["/admin-sent.html", "보낸 꽃 사진", "staff"],
    ["/admin-photos.html", "사진 위치·숨김", "owner"],
    ["/admin.html", "사진 올리기", "owner"],
    ["/admin-products.html", "상품", "owner"],
    ["/admin-site.html", "홈 화면 순서", "owner"],
    ["/admin-home.html", "홈 배송 사진", "owner"],
    ["/admin-pay.html", "결제 링크", "owner"],
    ["/admin-setup.html", "설정 점검", "owner"],
  ];
  function nav(after) {
    if (document.getElementById("af-admin-nav")) return;
    var bar = document.createElement("nav");
    bar.id = "af-admin-nav";
    bar.className = "af-admin-nav";
    var here = location.pathname.replace(/\/$/, "") || "/admin.html";
    MENU.forEach(function (m) {
      if (m[2] === "owner" && access.role !== "owner") return;
      var a = document.createElement("a");
      a.href = m[0];
      a.textContent = m[1];
      if (here === m[0] || here + ".html" === m[0]) { a.className = "on"; a.setAttribute("aria-current", "page"); }
      bar.appendChild(a);
    });
    after.insertAdjacentElement("afterend", bar);
    var on = bar.querySelector(".on"); if (on && on.scrollIntoView) try { on.scrollIntoView({ block: "nearest", inline: "center" }); } catch (_) {}
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
      // 10/18: 아버지 계정이 목록에 없을 때 어떤 이메일로 들어왔는지 보여 줘야 관리자 목록(ADMIN_OWNER_EMAILS)에 넣을 수 있다.
      var mail = session && session.user && session.user.email || "";
      gate("관리자 권한이 없어요", (mail ? "로그인한 계정: " + mail + "\n" : "") + "이 계정을 관리자로 등록하거나, 등록된 관리자 계정으로 다시 로그인해주세요.", null, null, true);
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
