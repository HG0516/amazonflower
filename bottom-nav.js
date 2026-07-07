// bottom-nav.js — 앱형 하단 탭바(전 페이지 공통). footer.js와 같은 주입 방식.
// 규칙: 하단 고정 바는 항상 하나만 → 주문 모드(body.ordering)·주문바(#buyBar.show)면 탭바 자동 숨김.
// z-index 85 → 모달(100)·주문바(90)·설치배너(10000)·계정시트(10002) 모두 아래.
(function () {
  'use strict';

  function injectStyles() {
    if (document.getElementById('af-bn-style')) return;
    var css = ''
      + '.af-bn{position:fixed;left:0;right:0;bottom:0;z-index:85;display:flex;'
      + 'background:var(--paper,#fff);border-top:1px solid var(--line,#d9d3c4);'
      + 'padding-bottom:env(safe-area-inset-bottom,0px);'
      + 'font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.06);}'
      + '.af-bn.af-bn-hide{display:none;}'
      + '.af-bn a,.af-bn button{flex:1;background:none;border:none;cursor:pointer;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;'
      + 'min-height:56px;padding:6px 2px;color:var(--ink-faint,#6b6358);text-decoration:none;'
      + 'font-family:inherit;-webkit-tap-highlight-color:transparent;}'
      + '.af-bn a:active,.af-bn button:active{background:var(--line-soft,#ebe6da);}'
      + '.af-bn .ic{font-size:21px;line-height:1;}'
      + '.af-bn .lb{font-size:11.5px;font-weight:700;letter-spacing:.2px;}'
      + '.af-bn .on{color:var(--accent,#2d4a38);}'
      + 'body.af-nav-on{padding-bottom:calc(58px + env(safe-area-inset-bottom,0px));}';
    var s = document.createElement('style');
    s.id = 'af-bn-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function isHome() {
    var p = location.pathname;
    return p === '/' || p === '' || p === '/index.html';
  }
  function isCatalog() { return location.pathname === '/catalog.html'; }

  // '내 주문' — 로그인 여부는 afOpenAuth가 판단(회원=계정시트, 비회원=로그인시트).
  // auth.js 없는 페이지(웨딩 등)는 홈으로 보내 주문 시트를 열게 한다.
  function goMyOrders() {
    if (typeof window.afOpenAuth === 'function') window.afOpenAuth();
    else location.href = '/?reorder=1';
  }

  function tab(active, href, ico, label) {
    return '<a class="' + (active ? 'on' : '') + '" href="' + href + '"'
      + (active ? ' aria-current="page"' : '')
      + '><span class="ic">' + ico + '</span><span class="lb">' + label + '</span></a>';
  }

  function render() {
    injectStyles();
    if (document.querySelector('.af-bn')) return;
    var nav = document.createElement('nav');
    nav.className = 'af-bn';
    nav.setAttribute('aria-label', '하단 메뉴');
    nav.innerHTML =
      tab(isHome(), '/', '🏠', '홈')
      + tab(isCatalog(), '/catalog.html', '🌸', '전체상품')
      + '<button type="button" id="af-bn-orders"><span class="ic">📦</span><span class="lb">내 주문</span></button>'
      + '<a href="tel:0313143003"><span class="ic">📞</span><span class="lb">전화</span></a>';
    document.body.appendChild(nav);
    document.body.classList.add('af-nav-on');

    var ob = document.getElementById('af-bn-orders');
    if (ob) ob.onclick = goMyOrders;

    // 주문 모드/주문바와 배타(고정 바는 하나만)
    function sync() {
      var bb = document.getElementById('buyBar');
      // 고정 바는 항상 하나만: 주문모드·주문바·PWA 설치배너 중 하나라도 있으면 탭바 숨김
      var hide = document.body.classList.contains('ordering')
        || (bb && bb.classList.contains('show'))
        || document.body.classList.contains('af-pwa-open');
      nav.classList.toggle('af-bn-hide', !!hide);
      document.body.classList.toggle('af-nav-on', !hide);
    }
    sync();
    try {
      var mo = new MutationObserver(sync);
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      var bb = document.getElementById('buyBar');
      if (bb) mo.observe(bb, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
