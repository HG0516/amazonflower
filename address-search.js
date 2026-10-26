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
      + 'background:#1f4733;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;'
      + 'padding:10px 14px;cursor:pointer;font-family:inherit;}'
      + '.addr-search-btn:active{opacity:.85;}'
      + '.af-addr-overlay{position:fixed;inset:0;z-index:10001;background:rgba(31,29,24,.55);'
      + 'display:none;align-items:center;justify-content:center;padding:16px;}'
      + '.af-addr-modal{background:#fff;border-radius:10px;width:100%;max-width:420px;height:80vh;max-height:560px;'
      + 'display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);}'
      + '.af-addr-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;'
      + 'border-bottom:1px solid #eeece4;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;}'
      + '.af-addr-head span{font-size:16px;font-weight:700;color:#1f1d18;}'
      + '.af-addr-close{background:transparent;border:none;color:#9e9a8f;font-size:26px;line-height:1;cursor:pointer;padding:4px 8px;margin:-4px;}'
      + '.af-addr-box{flex:1;min-height:0;}'
      + '.af-addr-sug{display:none;margin-top:6px;border:1px solid var(--line,#e4e1d8);border-radius:8px;background:var(--paper,#fff);overflow:hidden;}'
      + '.af-addr-sug button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line-soft,#eeece4);'
      + 'padding:10px 12px;cursor:pointer;font-family:inherit;color:var(--ink,#1f1d18);}'
      + '.af-addr-sug button:last-child{border-bottom:0;}'
      + '.af-addr-sug b{display:block;font-size:15px;font-weight:700;word-break:keep-all;}'
      + '.af-addr-sug b span{font-weight:400;color:var(--ink-faint,#8a857a);}'
      + '.af-addr-sug small{display:block;font-size:13px;color:var(--ink-faint,#8a857a);margin-top:2px;}';
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

  // 주소칸에 이미 친 말(예: '화양동 46-5')로 바로 찾는다. 전엔 검색창이 빈 채로 열려 같은 말을 또 쳐야 했다(10/26 형구).
  // 이미 찾아 넣은 주소([우편번호]로 시작)는 새로 찾으려는 것으로 보고 빈 검색창을 연다.
  function queryOf(v) {
    v = String(v || '').trim();
    return /^\[\d{5}\]/.test(v) ? '' : v.slice(0, 60);
  }

  // 주소칸에 넣는 모양. 다음 검색 창과 치는 동안 뜨는 추천이 같은 모양을 쓴다(위 queryOf 가 [우편번호]로 '고른 주소'를 알아본다).
  function fmt(zip, road, bd) {
    return (zip ? '[' + zip + '] ' : '') + road + (bd ? ' (' + bd + ')' : '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function closeModal() {
    var ov = document.getElementById('af-addr-overlay');
    if (ov) ov.style.display = 'none';
  }

  function showModal(q) {
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
    var pc = new daum.Postcode({
      oncomplete: function (data) {
        var full = fmt(data.zonecode, data.roadAddress || data.jibunAddress || data.address || '', data.buildingName);
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
    });
    if (q) pc.embed(box, { q: q }); else pc.embed(box);
  }

  // 버튼 모양도 이 스타일에 들어 있다 → 첫 클릭 전에도 보이게 처음부터 넣는다(전엔 회색 기본 버튼으로 보였음, 10/19).
  injectStyles();

  // 전역 노출
  window.openPostcode = function (inputId) {
    targetInput = document.getElementById(inputId);
    if (!targetInput) return;
    var q = queryOf(targetInput.value);
    ensureScript(function () { showModal(q); });
  };

  // 주문서 주소칸(#af_address)
  //  · 치는 동안 실제 주소를 아래에 띄운다(서버 action:"addr" → 도로명주소 API). 키가 없거나 실패하면 아무것도 안 뜨고 위 버튼을 쓴다.
  //  · 엔터(키보드 '다음'): 추천이 떠 있으면 첫 줄을 고르고, 아니면 친 말로 주소 검색 창을 연다.
  var HINT = '동·호수는 찾은 뒤 이어서 적어 주세요';
  var sugTimer = null, sugSeq = 0, sugItems = [];
  function sugBox(input, make) {
    var f = input.closest('.af-field');
    if (!f) return null;
    var b = f.querySelector('.af-addr-sug');
    if (!b && make) {
      b = document.createElement('div');
      b.className = 'af-addr-sug';
      (input.closest('.af-input-wrap') || input).insertAdjacentElement('afterend', b);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 누르는 동안 주소칸 포커스를 뺏지 않게
      b.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-i]');
        if (btn) sugPick(input, +btn.getAttribute('data-i'));
      });
    }
    return b;
  }
  function sugHide(input) {
    var b = input && sugBox(input, false);
    if (b) { b.style.display = 'none'; b.innerHTML = ''; }
    sugItems = [];
  }
  function sugShow(input, items) {
    var b = sugBox(input, true);
    if (!b) return;
    sugItems = items;
    b.innerHTML = items.map(function (it, i) {
      return '<button type="button" data-i="' + i + '"><b>' + esc(it.road) + (it.bd ? ' <span>' + esc(it.bd) + '</span>' : '') + '</b>'
        + (it.jibun ? '<small>' + esc(it.jibun) + '</small>' : '') + '</button>';
    }).join('');
    b.style.display = 'block';
    var h = input.closest('.af-field').querySelector('.addr-hint');
    if (h) h.textContent = '맞는 주소를 누르면 들어가요';
  }
  function sugPick(input, i) {
    var it = sugItems[i];
    if (!it) return;
    input.value = fmt(it.zip, it.road, it.bd);
    sugHide(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));   // order.address·배송비 계산이 그대로 따라온다
    input.focus();
    try { var n = input.value.length; input.setSelectionRange(n, n); } catch (e) {}
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || t.id !== 'af_address') return;
    if (e.key === 'Escape') { sugHide(t); return; }
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (sugItems.length) { e.preventDefault(); sugPick(t, 0); return; }
    if (!queryOf(t.value)) return;
    e.preventDefault();
    window.openPostcode('af_address');
  }, true);
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.id !== 'af_address') return;
    var q = queryOf(t.value);
    var f = t.closest('.af-field'), h = f && f.querySelector('.addr-hint');
    if (h) h.textContent = q ? '주소 검색을 누르면 이 주소로 바로 찾아요' : HINT;
    clearTimeout(sugTimer);
    if (q.length < 2) { sugHide(t); return; }
    sugTimer = setTimeout(function () {
      var seq = ++sugSeq;
      fetch('/api/parse-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addr', q: q }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (seq !== sugSeq) return;   // 최신 입력만
          if (j && j.ok && j.items && j.items.length && document.activeElement === t && queryOf(t.value)) sugShow(t, j.items);
          else sugHide(t);
        })
        .catch(function () { if (seq === sugSeq) sugHide(t); });
    }, 350);
  });
  // 칸을 떠나면 닫는다. 목록을 누르는 동안 먼저 닫히지 않게 조금 늦춘다.
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || t.id !== 'af_address') return;
    setTimeout(function () { if (document.activeElement !== t) sugHide(t); }, 250);
  });
})();
