// bottom-nav.js — 앱형 하단 탭바(전 페이지 공통). footer.js와 같은 주입 방식.
// 규칙: 하단 고정 바는 항상 하나만 → 주문 모드(body.ordering)·주문바(#buyBar.show)면 탭바 자동 숨김.
// z-index 85 → 모달(100)·주문바(90)·설치배너(10000)·계정시트(10002) 모두 아래.
(function () {
  'use strict';

  // 라인 아이콘(Lucide 계열) — 이모지는 기기마다 달라 통일감이 깨짐
  var IC_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/></svg>';
  var IC_FLOWER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M12 21V11"/><path d="M12 11c-3 0-5-2-5-5 3 0 5 2 5 5Z"/><path d="M12 11c3 0 5-2 5-5-3 0-5 2-5 5Z"/></svg>';
  var IC_RECEIPT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3h12v18l-2-1.3L14 21l-2-1.3L10 21l-2-1.3L6 21V3Z"/><path d="M9 8h6M9 12h6"/></svg>';
  var IC_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M6.5 3h3l1.5 5-2 1.3a11 11 0 0 0 5 5l1.3-2 5 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"/></svg>';

  function injectStyles() {
    if (document.getElementById('af-bn-style')) return;
    var css = ''
      + '.af-bn{position:fixed;left:0;right:0;bottom:0;z-index:85;display:flex;'
      + 'background:var(--paper,#fff);border-top:1px solid var(--line,#dcd9cf);'
      + 'padding-bottom:env(safe-area-inset-bottom,0px);'
      + 'font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.06);}'
      + '.af-bn.af-bn-hide{display:none;}'
      + '.af-bn a,.af-bn button{flex:1;background:none;border:none;cursor:pointer;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;'
      + 'min-height:56px;padding:6px 2px;color:var(--ink-faint,#6b6358);text-decoration:none;'
      + 'font-family:inherit;-webkit-tap-highlight-color:transparent;}'
      + '.af-bn a:active,.af-bn button:active{background:var(--line-soft,#eeece4);}'
      + '.af-bn .ic{line-height:1;}'
      + '.af-bn .ic svg{width:24px;height:24px;display:block;}'
      + '.af-bn .lb{font-size:var(--fs-caption);font-weight:700;letter-spacing:.2px;}'
      + '.af-bn .on{color:var(--accent,#1f4733);}'
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
      tab(isHome(), '/', IC_HOME, '홈')
      + tab(isCatalog(), '/catalog.html', IC_FLOWER, '전체상품')
      + '<button type="button" id="af-bn-orders"><span class="ic">' + IC_RECEIPT + '</span><span class="lb">내 주문</span></button>'
      + '<a href="tel:0313143003"><span class="ic">' + IC_PHONE + '</span><span class="lb">전화</span></a>';
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
