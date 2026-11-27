// 보낸 꽃 슬라이드(11/27, 형구 시안 D · "잘 도착했구나" 느낌으로) — 관리 화면 '보낸 꽃 사진'에서 공개(status=shown)한 실제 배송 사진.
//  [data-sent-flow]            → 홈: 작은 사진이 왼쪽으로 천천히 흐르는 띠(D-1). 사진 3장 미만이면 칸을 숨긴 채 둔다.
//  [data-sent-slide="분류"]    → 안내 페이지 맨 위: 그 분류 사진이 3.5초마다 한 장씩 넘어감(D-2). 2장 미만이면 원래 상품 사진 그대로.
// 공개 칸만 anon 으로 읽는다(catalog.html loadSentPhotos 와 같은 질의). 근조 사진엔 지역을 적지 않는다.
(function () {
  var NAME = { congrats: "축하화환", condolence: "근조화환", orchid: "난", plant: "화분", basket: "꽃바구니", bouquet: "꽃다발" };
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function day(v) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(v.shot_on || ""); return m ? +m[1] + "/" + +m[2] : ""; }
  function title(v) { return v.title || NAME[v.category] || "보낸 꽃"; }
  function place(v) { return v.place || (v.category === "condolence" ? "빈소" : /결혼|화혼/.test(v.title || "") ? "예식장" : /개업|이전|화분|plant|orchid/.test((v.title || "") + v.category) ? "매장" : "행사장"); }
  function where(v) { return v.category === "condolence" ? "" : v.area || ""; }
  function link(v) { return v.product_code ? "/catalog.html?item=" + encodeURIComponent(v.product_code) : v.category ? "/catalog.html?cat=" + encodeURIComponent(v.category) : "/catalog.html"; }
  function okUrl(u) { return /^https:\/\/[a-z0-9.-]+\/storage\/v1\/object\/public\/gallery\//.test(u || "") || /^\/photos\//.test(u || ""); }

  function css() {
    if (document.getElementById("sent-strip-css")) return;
    var s = document.createElement("style"); s.id = "sent-strip-css";
    s.textContent =
      "@keyframes sfFlow{from{transform:translateX(0)}to{transform:translateX(-50%)}}" +
      ".sf-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.sf-h h2{margin:0;font-size:17px}.sf-h a{font-size:14px;font-weight:700;white-space:nowrap;color:var(--accent,#1f4733);text-decoration:none}" +
      ".sf-p{margin:3px 0 10px;font-size:13.5px;color:var(--ink-faint,#8a857a)}" +
      ".sf-v{overflow:hidden;margin:0 -16px;padding:0 16px}.sf-t{display:flex;gap:10px;width:max-content;animation:sfFlow var(--sf-d,60s) linear infinite}" +
      ".sf-v:hover .sf-t,.sf-v:active .sf-t{animation-play-state:paused}" +
      ".sf-c{flex:0 0 132px;text-decoration:none;color:inherit}.sf-c img{display:block;width:132px;aspect-ratio:3/4;object-fit:cover;border-radius:12px;background:#eee}" +
      ".sf-c{position:relative}.sf-ok{position:absolute;left:6px;top:6px;padding:2px 8px;border-radius:999px;background:var(--accent,#1f4733);color:#fff;font-size:11.5px;font-style:normal;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.25)}" +
      ".sf-c span{display:block;margin-top:5px;font-size:12.5px;font-weight:800;color:var(--accent,#1f4733);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sf-c small{display:block;font-size:12px;color:var(--ink-faint,#8a857a)}" +
      "@media (prefers-reduced-motion:reduce){.sf-t{animation:none;width:auto;overflow-x:auto}}" +
      ".ss{position:relative;margin-top:14px;border-radius:16px;overflow:hidden;background:#eee}" +
      ".ss-t{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch}.ss-t::-webkit-scrollbar{display:none}" +
      ".ss-t a{flex:0 0 100%;scroll-snap-align:start;position:relative;display:block;text-decoration:none;color:#fff}" +
      ".ss-t img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}" +
      "@media (min-width:600px){.ss-t img{aspect-ratio:16/10}}" +
      ".ss-cap{position:absolute;left:0;right:0;bottom:0;padding:36px 14px 12px;background:linear-gradient(transparent,rgba(10,20,15,.78))}" +
      ".ss-cap small{display:block;font-size:12.5px;font-weight:700;opacity:.9}.ss-cap b{font-size:16px}" +
      ".ss-tag{position:absolute;left:10px;top:10px;padding:5px 11px;border-radius:999px;background:var(--accent,#1f4733);box-shadow:0 1px 5px rgba(0,0,0,.25);color:#fff;font-size:12px;font-weight:800}" +
      ".ss-d{display:flex;justify-content:center;gap:6px;margin-top:9px}.ss-d i{width:8px;height:8px;border-radius:4px;background:#cfcabd;transition:width .2s}.ss-d i.on{width:20px;background:var(--accent,#1f4733)}";
    document.head.appendChild(s);
  }

  function flow(el, rows) {
    var l = rows.slice(0, 16);
    if (l.length < 3) return;
    var card = function (v) {
      var cap = [day(v), place(v) + " 도착"].filter(Boolean).join(" · ");
      return '<a class="sf-c" href="' + esc(link(v)) + '"><i class="sf-ok">✓ 도착</i><img src="' + esc(v.photo_url) + '" alt="' + esc(place(v)) + '에 도착한 ' + esc(title(v)) + '" loading="lazy" width="132" height="176"><span>' + esc(cap) + "</span><small>" + esc(title(v)) + "</small></a>";
    };
    el.innerHTML = '<div class="sf-h"><h2>오늘도 잘 도착했어요</h2><a href="/catalog.html">꽃 고르러 가기 ›</a></div>' +
      '<p class="sf-p">배송하고 바로 찍은 도착 사진이에요. 주문하시면 이렇게 사진으로 알려 드려요. (리본 이름은 가렸어요)</p>' +
      '<div class="sf-v"><div class="sf-t" style="--sf-d:' + l.length * 4 + 's">' + l.concat(l).map(card).join("") + "</div></div>";
    // 두 번째 묶음은 흐름을 잇기 위한 복사본 — 읽는 기계엔 숨긴다
    var cs = el.querySelectorAll(".sf-c"); for (var i = l.length; i < cs.length; i++) { cs[i].setAttribute("aria-hidden", "true"); cs[i].tabIndex = -1; }
    el.hidden = false;
  }

  function slide(el, rows) {
    var cat = el.getAttribute("data-sent-slide");
    var l = rows.filter(function (v) { return !cat || v.category === cat; }).slice(0, 10);
    if (l.length < 2) return;
    el.innerHTML = '<div class="ss"><div class="ss-t">' + l.map(function (v, i) {
      var top = [day(v), where(v)].filter(Boolean).join(" · ");
      return '<a href="' + esc(link(v)) + '"><img src="' + esc(v.photo_url) + '" alt="꽃안부가 보낸 ' + esc(title(v)) + '"' + (i ? ' loading="lazy"' : "") + ' width="720" height="540"><span class="ss-cap"><small>' + esc(title(v)) + (top ? " · " + esc(top) : "") + "</small><b>" + esc(place(v)) + "에 잘 도착했어요</b></span></a>";
    }).join("") + '</div><span class="ss-tag">✓ 도착 확인 사진</span></div><div class="ss-d" aria-hidden="true">' + l.map(function (_, i) { return "<i" + (i ? "" : ' class="on"') + "></i>"; }).join("") + "</div>";
    var t = el.querySelector(".ss-t"), dots = el.querySelectorAll(".ss-d i"), n = l.length, timer = null;
    var at = function () { return Math.round(t.scrollLeft / Math.max(1, t.clientWidth)); };
    t.addEventListener("scroll", function () { var k = at(); for (var i = 0; i < dots.length; i++) dots[i].className = i === k ? "on" : ""; }, { passive: true });
    var stop = function () { if (timer) { clearInterval(timer); timer = null; } };
    if (!still) {
      timer = setInterval(function () { if (document.hidden) return; var k = (at() + 1) % n; t.scrollTo({ left: k * t.clientWidth, behavior: k ? "smooth" : "auto" }); }, 3500);
      ["touchstart", "pointerdown", "wheel"].forEach(function (e) { t.addEventListener(e, stop, { passive: true }); });
    }
  }

  function run() {
    var flows = document.querySelectorAll("[data-sent-flow]"), slides = document.querySelectorAll("[data-sent-slide]");
    if (!flows.length && !slides.length) return;
    var S = window.SUPA;
    var get = function (u, h) { return fetch(u, h ? { headers: h } : undefined).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }); };
    // 관리 화면에서 공개한 사진 + 형구가 보내 준 사진(photos/sent/list.json, 리본 이름 가린 것)
    Promise.all([
      S && S.url && S.anon ? get(S.url + "/rest/v1/sent_photos?select=photo_url,product_code,category,title,area,shot_on&status=eq.shown&order=sort.asc,shot_on.desc,created_at.desc&limit=60", { apikey: S.anon, Authorization: "Bearer " + S.anon }) : [],
      get("/photos/sent/list.json"),
    ])
      .then(function (r) { return [].concat(Array.isArray(r[0]) ? r[0] : [], Array.isArray(r[1]) ? r[1] : []); })
      .then(function (rows) {
        rows = rows.filter(function (v) { return v && okUrl(v.photo_url); });
        if (!rows.length) return;
        css();
        for (var i = 0; i < flows.length; i++) flow(flows[i], rows);
        for (var j = 0; j < slides.length; j++) slide(slides[j], rows);
      })
      .catch(function () { /* 못 불러와도 원래 화면 그대로 */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
