// pwa-install.js — '홈 화면에 추가' 설치 유도
// Android/Chrome: beforeinstallprompt 캡처 → 커스텀 배너 → prompt()
// iOS/Safari: 이벤트 미지원 → 공유 메뉴 안내 시트
// 이미 설치된 앱(standalone)·결제 진행 중에는 표시하지 않음. 닫으면 7일간 숨김.
(function () {
  'use strict';

  // 이미 설치된 앱에서는 아무것도 하지 않음
  var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
  if (isStandalone) return;

  // 결제 결과 처리 중에는 방해하지 않음
  try {
    if (new URLSearchParams(location.search).get('payresult')) return;
  } catch (e) {}

  var DISMISS_KEY = 'af_pwa_dismiss';
  var WEEK = 7 * 24 * 60 * 60 * 1000;
  var dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (dismissedAt && (Date.now() - dismissedAt) < WEEK) return;

  var deferredPrompt = null;

  function injectStyles() {
    if (document.getElementById('af-pwa-style')) return;
    var css = ''
      + '.af-pwa{position:fixed;left:0;right:0;bottom:0;z-index:10000;'
      + 'background:#fff;border-top:1px solid #dcd9cf;box-shadow:0 -4px 24px rgba(0,0,0,.12);'
      + 'padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px));'
      + 'transform:translateY(110%);transition:transform .35s cubic-bezier(.2,.8,.2,1);'
      + 'font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",sans-serif;}'
      + '.af-pwa.show{transform:translateY(0);}'
      + '.af-pwa-inner{max-width:560px;margin:0 auto;display:flex;align-items:center;gap:12px;}'
      + '.af-pwa-ico{width:46px;height:46px;border-radius:11px;flex:0 0 auto;}'
      + '.af-pwa-txt{flex:1;min-width:0;}'
      + '.af-pwa-tt{font-size:15px;font-weight:700;color:#1f1d18;}'
      + '.af-pwa-ds{font-size:12.5px;color:#5a564d;margin-top:2px;line-height:1.5;}'
      + '.af-pwa-btn{flex:0 0 auto;background:#1f4733;color:#fff;border:none;border-radius:8px;'
      + 'font-size:15px;font-weight:700;padding:11px 16px;cursor:pointer;font-family:inherit;}'
      + '.af-pwa-x{flex:0 0 auto;background:transparent;border:none;color:#9e9a8f;font-size:22px;'
      + 'line-height:1;cursor:pointer;padding:6px;margin:-6px -4px -6px 0;}'
      + '.af-pwa-steps{font-size:13.5px;color:#1f1d18;line-height:1.9;margin-top:8px;}'
      + '.af-pwa-steps b{color:#1f4733;}'
      + 'body.af-pwa-open{padding-bottom:120px;}';
    var s = document.createElement('style');
    s.id = 'af-pwa-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function remove(el) {
    if (!el) return;
    document.body.classList.remove('af-pwa-open');
    el.classList.remove('show');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
  }

  // 주문/결제 진행 중이면 설치 배너를 띄우지 않는다(하단 CTA·결제버튼을 가리지 않게)
  function orderInProgress() {
    if (document.body.classList.contains('ordering')) return true;
    var pc = document.getElementById('payCard');
    var cc = document.getElementById('confirmCard');
    if (pc && !pc.classList.contains('hidden')) return true;
    if (cc && !cc.classList.contains('hidden')) return true;
    return false;
  }

  function dismiss(el) {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
    remove(el);
  }

  function showAndroidBanner() {
    injectStyles();
    if (document.getElementById('af-pwa-banner')) return;
    if (orderInProgress()) return;
    var bar = document.createElement('div');
    bar.id = 'af-pwa-banner';
    bar.className = 'af-pwa';
    bar.innerHTML =
      '<div class="af-pwa-inner">'
      + '<img class="af-pwa-ico" src="/icons/icon-192.png" alt="꽃안부" />'
      + '<div class="af-pwa-txt">'
      + '<div class="af-pwa-tt">꽃안부 앱으로 더 빠르게</div>'
      + '<div class="af-pwa-ds">홈 화면에 추가하면 앱처럼 한 번에 열려요.</div>'
      + '</div>'
      + '<button class="af-pwa-btn" id="af-pwa-add">설치</button>'
      + '<button class="af-pwa-x" id="af-pwa-close" aria-label="닫기">&times;</button>'
      + '</div>';
    document.body.appendChild(bar);
    document.body.classList.add('af-pwa-open');
    requestAnimationFrame(function () { bar.classList.add('show'); });

    document.getElementById('af-pwa-close').onclick = function () { dismiss(bar); };
    document.getElementById('af-pwa-add').onclick = function () {
      if (!deferredPrompt) { dismiss(bar); return; }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        dismiss(bar);
      });
    };
  }

  function showIosGuide() {
    injectStyles();
    if (document.getElementById('af-pwa-banner')) return;
    if (orderInProgress()) return;
    var bar = document.createElement('div');
    bar.id = 'af-pwa-banner';
    bar.className = 'af-pwa';
    bar.innerHTML =
      '<div class="af-pwa-inner">'
      + '<img class="af-pwa-ico" src="/icons/icon-192.png" alt="꽃안부" />'
      + '<div class="af-pwa-txt">'
      + '<div class="af-pwa-tt">홈 화면에 추가하기</div>'
      + '<div class="af-pwa-steps">아래 공유 버튼 <b>⬆️</b> → <b>‘홈 화면에 추가’</b>를 누르세요.</div>'
      + '</div>'
      + '<button class="af-pwa-x" id="af-pwa-close" aria-label="닫기">&times;</button>'
      + '</div>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add('show'); });
    document.getElementById('af-pwa-close').onclick = function () { dismiss(bar); };
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    // 페이지 진입 직후보다 살짝 뒤에 (덜 침습적)
    setTimeout(showAndroidBanner, 1500);
  });

  // iOS Safari 감지 (beforeinstallprompt 미지원)
  var ua = navigator.userAgent || '';
  var isIos = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  var isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|android/i.test(ua);
  if (isIos && isSafari) {
    setTimeout(showIosGuide, 2500);
  }

  // 설치 완료되면 배너를 영구히 숨긴다(다시 권유 안 함)
  window.addEventListener('appinstalled', function () {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 3153600000000)); } catch (e) {}
    var bar = document.getElementById('af-pwa-banner');
    if (bar) remove(bar);
  });
})();
