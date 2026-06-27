// address-search.js — 다음(카카오) 우편번호 주소검색 (무료, 키 불필요)
// 사용: openPostcode('af_address')  ← 주문 폼 주소칸 옆 '주소 검색' 버튼에서 호출.
// 모바일 팝업 차단을 피해 embed(레이어/모달) 방식 사용.
// 선택 시 input.value 채우고 'input' 이벤트를 디스패치 → 기존 oninput="order.address=this.value" 가 그대로 동작(스코프 안전).
(function () {
  'use strict';
  var POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  var targetInput = null;

  function injectStyles() {
    if (document.getElementById('af-addr-style')) return;
    var css = ''
      + '.addr-search-btn{margin-top:8px;display:inline-flex;align-items:center;gap:6px;'
      + 'background:#2d4a38;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;'
      + 'padding:10px 14px;cursor:pointer;font-family:inherit;}'
      + '.addr-search-btn:active{opacity:.85;}'
      + '.af-addr-overlay{position:fixed;inset:0;z-index:10001;background:rgba(31,29,24,.55);'
      + 'display:none;align-items:center;justify-content:center;padding:16px;}'
      + '.af-addr-modal{background:#fff;border-radius:10px;width:100%;max-width:420px;height:80vh;max-height:560px;'
      + 'display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);}'
      + '.af-addr-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;'
      + 'border-bottom:1px solid #ebe6da;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;}'
      + '.af-addr-head span{font-size:16px;font-weight:700;color:#1f1d18;}'
      + '.af-addr-close{background:transparent;border:none;color:#9e9a8f;font-size:26px;line-height:1;cursor:pointer;padding:4px 8px;margin:-4px;}'
      + '.af-addr-box{flex:1;min-height:0;}';
    var s = document.createElement('style');
    s.id = 'af-addr-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensureScript(cb) {
    if (window.daum && window.daum.Postcode) { cb(); return; }
    var existing = document.getElementById('af-daum-postcode');
    if (existing) { existing.addEventListener('load', cb); return; }
    var s = document.createElement('script');
    s.id = 'af-daum-postcode';
    s.src = POSTCODE_SRC;
    s.onload = cb;
    s.onerror = function () { alert('주소 검색을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); };
    document.head.appendChild(s);
  }

  function closeModal() {
    var ov = document.getElementById('af-addr-overlay');
    if (ov) ov.style.display = 'none';
  }

  function showModal() {
    injectStyles();
    var overlay = document.getElementById('af-addr-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'af-addr-overlay';
      overlay.className = 'af-addr-overlay';
      overlay.innerHTML =
        '<div class="af-addr-modal">'
        + '<div class="af-addr-head"><span>주소 검색</span>'
        + '<button class="af-addr-close" aria-label="닫기">&times;</button></div>'
        + '<div id="af-addr-box" class="af-addr-box"></div>'
        + '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector('.af-addr-close').onclick = closeModal;
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    }
    overlay.style.display = 'flex';

    var box = document.getElementById('af-addr-box');
    box.innerHTML = '';
    new daum.Postcode({
      oncomplete: function (data) {
        var addr = data.roadAddress || data.jibunAddress || data.address || '';
        if (data.buildingName) addr += ' (' + data.buildingName + ')';
        var full = (data.zonecode ? '[' + data.zonecode + '] ' : '') + addr;
        if (targetInput) {
          targetInput.value = full;
          // 기존 oninput="order.address=this.value" 를 그대로 트리거
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        closeModal();
        if (targetInput) {
          targetInput.focus();
          // 상세주소(동/호) 직접 입력하도록 커서를 끝에
          var v = targetInput.value;
          try { targetInput.setSelectionRange(v.length, v.length); } catch (e) {}
        }
      },
      onclose: function () { /* 사용자가 닫음 */ },
      width: '100%',
      height: '100%'
    }).embed(box);
  }

  // 전역 노출
  window.openPostcode = function (inputId) {
    targetInput = document.getElementById(inputId);
    if (!targetInput) return;
    ensureScript(showModal);
  };
})();
