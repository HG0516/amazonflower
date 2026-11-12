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
      ".af-admin-out{background:transparent;border:0;color:#1f4733;font-weight:700;font-size:12px;font-family:inherit;text-decoration:underline;padding:6px 2px;cursor:pointer;}" +
      // 관리자 공통 틀(11/2 시안 관리자-2026-11). 컴퓨터: 왼쪽 메뉴 + 위 검색. 휴대폰: 위 검색 + 아래 탭 넷(더보기에 나머지).
      ".afs-top{position:sticky;top:0;z-index:40;background:#f7f4ee;border-bottom:1px solid #e7e3d8;padding:8px 14px;display:flex;gap:10px;align-items:center;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;}" +
      ".afs-brand{font-weight:800;font-size:16px;color:#1f4733;white-space:nowrap;text-decoration:none;}" +
      ".afs-q{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:42px;padding:0 12px;border:1px solid #dcd9cf;border-radius:10px;background:#fff;}" +
      ".afs-q input{flex:1;min-width:0;border:0;outline:0;background:none;font-size:15px;font-family:inherit;color:#1f1d18;}" +
      ".afs-q svg{flex:0 0 auto;color:#7a766c}" +
      ".afs-new{display:none;white-space:nowrap;font-weight:700;font-size:13px;color:#fff;background:#c0503f;border-radius:999px;padding:5px 11px;text-decoration:none;}" +
      ".afs-new.show{display:none}" +
      ".afs-side{display:none}" +
      ".afs-tabs{position:fixed;left:0;right:0;bottom:0;z-index:45;display:grid;grid-template-columns:repeat(var(--n,4),1fr);background:#fff;border-top:1px solid #dcd9cf;padding-bottom:env(safe-area-inset-bottom,0px);font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;}" +
      ".afs-tabs a,.afs-tabs button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:58px;border:0;background:none;color:#5a564d;font-weight:700;font-size:12px;font-family:inherit;text-decoration:none;cursor:pointer;}" +
      ".afs-tabs .on{color:#1f4733}" +
      ".afs-tabs .on svg{stroke-width:2.4}" +
      ".afs-badge{position:absolute;top:6px;left:calc(50% + 6px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#c0503f;color:#fff;font-size:11px;font-weight:800;line-height:18px;text-align:center;}" +
      ".afs-badge:empty{display:none}" +
      ".afs-more{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.4);display:none;align-items:flex-end;}" +
      ".afs-more.open{display:flex}" +
      ".afs-sheet{width:100%;max-height:85vh;overflow:auto;background:#f7f4ee;border-radius:16px 16px 0 0;padding:14px 16px calc(18px + env(safe-area-inset-bottom,0px));font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;}" +
      ".afs-g{font-size:12px;font-weight:700;color:#7a766c;margin:14px 4px 6px;}" +
      ".afs-g:first-child{margin-top:2px}" +
      ".afs-list a{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 12px;border-radius:10px;color:#1f1d18;font-weight:600;font-size:15px;text-decoration:none;}" +
      ".afs-list a.on{background:#e8f1ea;color:#14311f;font-weight:800;}" +
      ".afs-list a svg{flex:0 0 auto;color:#5a564d}" +
      ".afs-list a.on svg{color:#1f4733}" +
      ".afs-list a small{margin-left:auto;font-size:12px;color:#7a766c;font-weight:500}" +
      ".afs-who{margin-top:14px;padding:12px 4px 0;border-top:1px solid #e7e3d8;font-size:12.5px;color:#5a564d;line-height:1.6;word-break:break-all;}" +
      ".afs-who b{display:block;color:#1f1d18;font-size:13.5px}" +
      ".af-shell{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px)) !important;}" +
      ".af-shell .toast{bottom:calc(76px + env(safe-area-inset-bottom,0px)) !important;}" +
      // 화면 제목은 메뉴 이름과 같다. 옛 화면 안 이동 링크는 틀의 메뉴로 대신한다.
      ".af-shell .navlink,.af-shell .backlink{display:none !important}" +
      "@media (min-width:1000px){" +
        ".af-shell{padding-left:236px !important;padding-bottom:40px !important;}" +
        ".af-shell .toast{bottom:22px !important;left:calc(50% + 118px) !important;}" +
        ".afs-tabs,.afs-more,.afs-top .afs-brand{display:none !important}" +
        ".afs-top{padding:10px 28px;}" +
        ".afs-q{max-width:520px}" +
        ".afs-new.show{display:inline-block}" +
        ".afs-side{display:flex;flex-direction:column;position:fixed;left:0;top:0;bottom:0;width:236px;z-index:41;background:#fff;border-right:1px solid #e7e3d8;padding:18px 12px 14px;overflow:auto;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;}" +
        ".afs-side .afs-brand{display:block;padding:0 12px 6px;font-size:17px}" +
        ".afs-side .afs-list a{min-height:42px;font-size:14.5px}" +
        ".afs-side .afs-who{margin-top:auto}" +
      "}";
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

  // 관리자 메뉴(11/2 새 틀). 세 묶음. 운영 관리자는 staff 줄만 본다. tab = 휴대폰 아래 탭에 나오는 것.
  var GROUPS = [
    ["주문", [
      ["/admin-orders.html", "주문 관리", "staff", "list", "주문"],
      ["/admin-pay.html", "전화 주문", "owner", "phone", "전화 주문"],
      ["/admin-sent.html", "보낸 꽃 사진", "staff", "camera", "사진"],
      ["/admin-shops.html", "꽃집·화원", "owner", "flower"],
    ]],
    ["사이트 꾸미기", [
      ["/admin-products.html", "상품", "owner", "box"],
      ["/admin-site.html", "홈 화면 순서", "owner", "rows"],
      ["/admin-home.html", "홈 배송 사진", "owner", "home"],
      ["/admin-photos.html", "사진 위치·숨김", "owner", "eye"],
      ["/admin.html", "사진 올리기", "owner", "up"],
    ]],
    ["그 밖", [
      ["/admin-partner.html", "파트너 QR", "owner", "qr"],
      ["/hello", "꽃 인사", "owner", "flower", null, "손님 화면"],
      ["/admin-setup.html", "설정 점검", "owner", "gear"],
    ]],
  ];
  // 메뉴에 없는 화면은 가까운 메뉴에 불을 켠다(주문 하나 사진 올리기 → 보낸 꽃 사진).
  var ALIAS = { "/admin-order.html": "/admin-sent.html" };
  var ICON = {
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    rows: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2"/>',
    flower: '<circle cx="12" cy="9" r="2.5"/><path d="M12 6.5c0-3 3-3 3 0M14.5 9c3 0 3 3 0 3M12 11.5c0 3-3 3-3 0M9.5 9c-3 0-3-3 0-3"/><path d="M12 12v9M12 17c-2-2-4-2-5-1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  };
  function svg(k, size) {
    return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[k] || "") + "</svg>";
  }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function herePath() {
    var p = location.pathname.replace(/\/$/, "") || "/admin.html";
    if (!/\.html$/.test(p) && p.indexOf("/admin") === 0) p += ".html";
    return ALIAS[p] || p;
  }
  function allowed() {
    var out = [];
    GROUPS.forEach(function (g) {
      var items = g[1].filter(function (m) { return m[2] === "staff" || access.role === "owner"; });
      if (items.length) out.push([g[0], items]);
    });
    return out;
  }
  function listHtml(groups, here) {
    return groups.map(function (g) {
      return '<div class="afs-g">' + esc(g[0]) + '</div><div class="afs-list">' + g[1].map(function (m) {
        var ext = m[0].indexOf("/admin") !== 0;
        return '<a href="' + m[0] + '"' + (here === m[0] ? ' class="on" aria-current="page"' : "") + (ext ? ' target="_blank" rel="noopener"' : "") + ">" +
          svg(m[3]) + "<span>" + esc(m[1]) + "</span>" + (m[5] ? "<small>" + esc(m[5]) + "</small>" : "") +
          (m[0] === "/admin-orders.html" ? ' <small class="afs-cnt" data-afs-badge></small>' : "") + "</a>";
      }).join("") + "</div>";
    }).join("");
  }
  function whoHtml() {
    // 10/18 형구: 어느 네이버 계정으로 들어왔는지 보이고, 잘못 들어왔으면 바로 바꿀 수 있게.
    var mail = session && session.user && session.user.email || "";
    return '<div class="afs-who"><b>' + (access.role === "owner" ? "대표 관리자" : "운영 관리자") + "</b>" + esc(mail) +
      '<br><button type="button" class="af-admin-out" data-afs="switch">네이버 계정 바꾸기</button> · <button type="button" class="af-admin-out" data-afs="out">로그아웃</button></div>';
  }
  function wireWho(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-afs]"), function (b) {
      b.onclick = b.getAttribute("data-afs") === "out" ? logout : logoutAndLogin;
    });
  }
  function shell() {
    if (!access || document.getElementById("afs-top")) return;
    var here = herePath(), groups = allowed();
    var q = "";
    try { q = new URLSearchParams(location.search).get("q") || ""; } catch (_) {}
    document.body.classList.add("af-shell");

    // 위: 검색창 하나로 주문번호·이름·전화번호를 찾는다. 주문 관리 화면이면 그 자리에서 거르고, 다른 화면이면 주문 관리로 간다.
    var top = document.createElement("div");
    top.id = "afs-top";
    top.className = "afs-top";
    top.innerHTML = '<a class="afs-brand" href="/admin-orders.html">꽃안부 관리</a>' +
      '<form class="afs-q" role="search">' + svg("search", 18) + '<input type="search" name="q" enterkeyhint="search" autocomplete="off" placeholder="주문번호, 이름, 전화번호로 찾기" aria-label="주문 찾기"></form>' +
      '<a class="afs-new" href="/admin-orders.html" data-afs-new></a>';
    var input = top.querySelector("input");
    input.value = q;
    var onOrders = here === "/admin-orders.html";
    top.querySelector("form").onsubmit = function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (onOrders) { emitSearch(v); input.blur(); }
      else location.href = "/admin-orders.html" + (v ? "?q=" + encodeURIComponent(v) : "");
    };
    if (onOrders) input.addEventListener("input", function () { emitSearch(input.value.trim()); });
    document.body.insertBefore(top, document.body.firstChild);

    // 컴퓨터: 왼쪽 메뉴
    var side = document.createElement("aside");
    side.className = "afs-side";
    side.setAttribute("aria-label", "관리자 메뉴");
    side.innerHTML = '<a class="afs-brand" href="/admin-orders.html">꽃안부 관리</a>' + listHtml(groups, here) + whoHtml();
    wireWho(side);
    document.body.appendChild(side);

    // 휴대폰: 아래 탭(주문·전화 주문·사진·더보기). 나머지는 더보기 시트에.
    var tabs = [];
    groups.forEach(function (g) { g[1].forEach(function (m) { if (m[4]) tabs.push(m); }); });
    var bar = document.createElement("nav");
    bar.className = "afs-tabs";
    bar.setAttribute("aria-label", "관리자 메뉴");
    bar.style.setProperty("--n", String(tabs.length + 1));
    var inTabs = tabs.some(function (m) { return m[0] === here; });
    bar.innerHTML = tabs.map(function (m) {
      return '<a href="' + m[0] + '"' + (here === m[0] ? ' class="on" aria-current="page"' : "") + ">" + svg(m[3], 22) + esc(m[4]) +
        (m[0] === "/admin-orders.html" ? '<span class="afs-badge" data-afs-badge></span>' : "") + "</a>";
    }).join("") + '<button type="button"' + (inTabs ? "" : ' class="on"') + ">" + svg("more", 22) + "더보기</button>";
    var more = document.createElement("div");
    more.className = "afs-more";
    more.innerHTML = '<div class="afs-sheet" role="dialog" aria-label="전체 메뉴">' + listHtml(groups, here) + whoHtml() + "</div>";
    more.onclick = function (e) { if (e.target === more) more.classList.remove("open"); };
    wireWho(more);
    bar.querySelector("button").onclick = function () { more.classList.add("open"); };
    document.body.appendChild(bar);
    document.body.appendChild(more);
  }
  var lastQ = null;
  function emitSearch(v) {
    if (v === lastQ) return;
    lastQ = v;
    try { document.dispatchEvent(new CustomEvent("af-admin-search", { detail: v })); } catch (_) {}
  }
  // 주문 관리가 새 주문 수를 알려 주면 메뉴 옆 숫자와 위 "새 주문 N건"을 바꾼다.
  function setNewCount(n) {
    n = Number(n) || 0;
    Array.prototype.forEach.call(document.querySelectorAll("[data-afs-badge]"), function (el) { el.textContent = n ? String(n) : ""; });
    var a = document.querySelector("[data-afs-new]");
    if (a) { a.textContent = n ? "새 주문 " + n + "건" : ""; a.classList.toggle("show", !!n); }
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
      shell();
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
    setNewCount: setNewCount,
    get query() { try { return new URLSearchParams(location.search).get("q") || ""; } catch (_) { return ""; } },
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
