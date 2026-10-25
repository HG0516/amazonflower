// va.js — 방문 집계(Vercel Web Analytics, 2026-10-25 형구). 쿠키를 쓰지 않는다.
//
// 붙이는 화면: 손님이 보는 화면만(홈·상품·장례식장 페이지·부고장/청첩장 만들기 등). 페이지마다 <script src="/va.js"> 로 붙인다.
// 붙이지 않는 화면: 관리자·배송기사·도착 사진·부고장/청첩장 열람. 열람 수는 cards.views 로 이미 세고,
// 무료 요금제는 한 달 5만 건이 넘으면 수집이 멈춰서 한 사람이 여러 번 여는 열람 화면은 빼 둔다.
// 아래 SKIP 은 실수로 붙였을 때를 위한 두 번째 그물.
// 주소에 토큰·전화가 실려 오는 화면이 있어서 쿼리는 KEEP 칸만 남긴다.
// 가족·직원 폰은 ?va=0 으로 한 번 열면 그 기기는 안 센다(?va=1 로 되돌림). 관리자 화면을 연 기기는 admin-auth.js 가 끈다.
(function () {
  if (window.__afVa) return;
  window.__afVa = 1;

  var KEEP = ["utm_source", "utm_medium", "utm_campaign", "item", "cat"];
  var SKIP = /^\/(admin|deliver|c\/|card\.html|offline|og_card)/;
  var OFF = "af_va_off";

  function clean(raw) {
    try {
      var u = new URL(raw);
      if (SKIP.test(u.pathname)) return null;
      var q = new URLSearchParams();
      KEEP.forEach(function (k) { var v = u.searchParams.get(k); if (v) q.set(k, v.slice(0, 64)); });
      var s = q.toString();
      // 장례식장 페이지는 한글 주소라, 통계 화면에서 %EC%88… 대신 이름으로 보이게 풀어서 보낸다.
      var p = u.pathname;
      try { p = decodeURI(p); } catch (e) {}
      return u.origin + p + (s ? "?" + s : "");
    } catch (e) {
      return null;
    }
  }

  try {
    var m = /[?&]va=([01])(&|$)/.exec(location.search);
    if (m) { if (m[1] === "0") localStorage.setItem(OFF, "1"); else localStorage.removeItem(OFF); }
  } catch (e) {}

  function off() {
    try { return !!localStorage.getItem(OFF); } catch (e) { return false; }
  }

  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va("beforeSend", function (e) {
    if (!e || off()) return null;
    var url = clean(e.url);
    if (!url) return null;
    e.url = url;
    return e;
  });

  var s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
})();
