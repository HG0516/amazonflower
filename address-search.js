// address-search.js — 주소 찾기: 다음(카카오) 우편번호 창 + 주문서에서 치는 동안 추천
// 사용: openPostcode('af_address')  ← 주문 폼 주소칸 옆 '주소 검색' 버튼. card-make.html 의 openPostcode('w_addr') 도 같다.
// 모바일 팝업 차단을 피해 embed(레이어/모달) 방식 사용.
// 주문서(#af_address, #af_venue)에서는 치는 동안 칸 아래에 추천을 띄운다(10/26~27).
//  · 주소칸: 도로명주소 API(서버 action:"addr"). 동네만 쳐도 시·군·구까지 맞춰져 먼 지역 배송비가 빠지지 않는다.
//  · 장소칸: 장례식장 1,117곳(data/funeral-homes.json) + 도로명주소 API 의 건물 이름(예식장·성당 등). 고르면 주소까지 채운다.
//  · 주소를 고르면, 비어 있는 장소칸에 그 주소의 장례식장(목록)이나 건물 이름을 넣는다.
// 고르면 input.value 를 채우고 'input' 이벤트를 보낸다 → 기존 oninput="order.address=this.value"·배송비 계산이 그대로 동작.
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 고른 주소 모양: '도로명 (동, 건물)'. 우편번호는 꽃 배달에 안 써서 빼고 동 이름을 붙였다(10/27 형구).
  function dongOf(name, road) {
    name = String(name || '');
    return /[동가]$/.test(name) && road.indexOf(name) < 0 ? name : '';
  }
  function fmt(road, dong, bd) {
    var x = [];
    if (dong) x.push(dong);
    if (bd && road.indexOf(bd) < 0 && x.indexOf(bd) < 0) x.push(bd);
    return road + (x.length ? ' (' + x.join(', ') + ')' : '');
  }
  // 우리가 값을 넣을 때 보내는 input 이벤트로 다시 추천을 찾지 않게 잠깐 막는다.
  var muted = false;
  function put(input, v, picked) {
    if (!input) return;
    input.value = v;
    if (picked) input.setAttribute('data-picked', v); else input.removeAttribute('data-picked');
    muted = true;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } finally { muted = false; }
  }
  // 친 말 중 찾을 부분. 고른 주소(뒤에 동·호수를 이어 친 것 포함)와 예전 '[우편번호] …' 값은 '' → 새로 찾으면 빈 검색창.
  function queryOf(v, input) {
    v = String(v || '').trim();
    if (/^\[\d{5}\]/.test(v)) return '';
    var p = input && input.getAttribute && input.getAttribute('data-picked');
    if (p && v.indexOf(p) === 0) return '';
    return v.slice(0, 60);
  }

  // ── 장례식장 목록(공공데이터 1,117곳, 처음 쓸 때 한 번만 받는다) ──
  var homesP = null;
  function homes() {
    if (!homesP) homesP = fetch('/data/funeral-homes.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); }).then(function (j) { return (j && j.items) || []; })
      .catch(function () { homesP = null; return []; });
    return homesP;
  }
  function nm(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
  // 주소 비교용: 우편번호·괄호를 빼고, 시·도 이름(서울/서울특별시처럼 쓰는 법이 갈린다)을 떼고 붙여 쓴다.
  function addrKey(a) {
    var t = String(a || '').replace(/^\[\d{5}\]\s*/, '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/);
    return t.length > 2 ? t.slice(1).join('') : '';
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
        var road = data.roadAddress || data.jibunAddress || data.address || '';
        var bd = data.buildingName || '';
        put(targetInput, fmt(road, dongOf(data.bname, road), bd), true);
        closeModal();
        if (targetInput) {
          afterAddr(targetInput, road, bd);
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
    var q = queryOf(targetInput.value, targetInput);
    ensureScript(function () { showModal(q); });
  };

  // 주소를 고른 뒤: 장소칸이 비어 있으면 그 주소의 장례식장 이름(목록)이나 건물 이름(예식장·성당 등)을 넣는다.
  function afterAddr(input, road, bd) {
    if (!input || input.id !== 'af_address') return;
    var v = document.getElementById('af_venue');
    if (!v || v.value.trim()) return;
    var k = addrKey(road);
    homes().then(function (list) {
      if (v.value.trim()) return;
      var hit = k ? list.filter(function (h) { return addrKey(h.a) === k; }) : [];
      if (hit.length === 1) put(v, hit[0].n, false);
      else if (bd) put(v, bd, false);
    });
  }

  function addrSearch(q) {
    return fetch('/api/parse-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addr', q: q }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.ok && j.items) || []; })
      .catch(function () { return []; });
  }

  // ── 치는 동안 추천(주소칸·장소칸) ──
  var HINT = '동·호수는 찾은 뒤 이어서 적어 주세요';
  var S = {};
  function st(input) { return S[input.id] || (S[input.id] = { timer: null, seq: 0, items: [] }); }
  function sugBox(input, make) {
    var f = input.closest('.af-field');
    if (!f) return null;
    var b = f.querySelector('.af-addr-sug');
    if (!b && make) {
      b = document.createElement('div');
      b.className = 'af-addr-sug';
      (input.closest('.af-input-wrap') || input).insertAdjacentElement('afterend', b);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 누르는 동안 칸 포커스를 뺏지 않게
      b.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-i]');
        if (btn) pick(input, +btn.getAttribute('data-i'));
      });
    }
    return b;
  }
  function sugHide(input) {
    var b = input && sugBox(input, false);
    if (b) { b.style.display = 'none'; b.innerHTML = ''; }
    if (input) st(input).items = [];
  }
  function sugShow(input, items) {
    var b = sugBox(input, true);
    if (!b) return;
    st(input).items = items;
    b.innerHTML = items.map(function (it, i) {
      var title, sub;
      if (it.kind === 'home') { title = esc(it.n); sub = it.a; }
      else if (it.kind === 'bld') { title = esc(it.bd); sub = it.road; }
      else { title = esc(it.road) + (it.bd ? ' <span>' + esc(it.bd) + '</span>' : ''); sub = it.jibun; }
      return '<button type="button" data-i="' + i + '"><b>' + title + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
    }).join('');
    b.style.display = 'block';
    if (input.id === 'af_address') {
      var h = input.closest('.af-field').querySelector('.addr-hint');
      if (h) h.textContent = '맞는 주소를 누르면 들어가요';
    }
  }
  function pick(input, i) {
    var it = st(input).items[i];
    if (!it) return;
    sugHide(input);
    var addr = document.getElementById('af_address');
    if (it.kind === 'addr') {
      put(input, fmt(it.road, dongOf(it.emd, it.road), it.bd), true);
      afterAddr(input, it.road, it.bd);
      input.focus();
      try { var n = input.value.length; input.setSelectionRange(n, n); } catch (e) {}
      return;
    }
    // 장소칸에서 고름: 장소 이름 + 주소까지. 다음은 빈소·홀 칸으로.
    if (it.kind === 'home') { put(input, it.n, false); put(addr, it.a, true); }
    else { put(input, it.bd, false); put(addr, fmt(it.road, dongOf(it.emd, it.road), ''), true); }
    var nx = document.getElementById('af_venueDetail');
    if (nx && !nx.value) nx.focus();
  }
  function venueItems(q) {
    var k = nm(q);
    return Promise.all([homes(), addrSearch(q)]).then(function (r) {
      var hs = r[0].filter(function (h) { return nm(h.n).indexOf(k) >= 0; })
        .sort(function (a, b) { return (nm(a.n).indexOf(k) === 0 ? 0 : 1) - (nm(b.n).indexOf(k) === 0 ? 0 : 1) || a.n.length - b.n.length; })
        .slice(0, 5).map(function (h) { return { kind: 'home', n: h.n, a: h.a }; });
      var seen = {};
      hs.forEach(function (h) { seen[nm(h.n)] = 1; });
      var bs = r[1].filter(function (x) { return x.bd && !seen[nm(x.bd)] && (seen[nm(x.bd)] = 1); })
        .slice(0, 4).map(function (x) { return { kind: 'bld', bd: x.bd, road: x.road, emd: x.emd }; });
      return hs.concat(bs);
    });
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || (t.id !== 'af_address' && t.id !== 'af_venue')) return;
    if (e.key === 'Escape') { sugHide(t); return; }
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (st(t).items.length) { e.preventDefault(); pick(t, 0); return; }
    if (t.id !== 'af_address' || !queryOf(t.value, t)) return;
    e.preventDefault();
    window.openPostcode('af_address');
  }, true);
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (muted || !t || (t.id !== 'af_address' && t.id !== 'af_venue')) return;
    var isAddr = t.id === 'af_address';
    if (isAddr && t.getAttribute('data-picked') && t.value.indexOf(t.getAttribute('data-picked')) !== 0) t.removeAttribute('data-picked');
    var q = isAddr ? queryOf(t.value, t) : String(t.value || '').trim().slice(0, 40);
    if (isAddr) {
      var f = t.closest('.af-field'), h = f && f.querySelector('.addr-hint');
      if (h) h.textContent = q ? '주소 검색을 누르면 이 주소로 바로 찾아요' : HINT;
    }
    var s = st(t);
    clearTimeout(s.timer);
    if (q.length < 2) { sugHide(t); return; }
    s.timer = setTimeout(function () {
      var seq = ++s.seq;
      (isAddr ? addrSearch(q).then(function (items) { return items.map(function (x) { x.kind = 'addr'; return x; }); }) : venueItems(q))
        .then(function (items) {
          if (seq !== s.seq) return;   // 최신 입력만
          if (items.length && document.activeElement === t) sugShow(t, items); else sugHide(t);
        });
    }, 350);
  });
  // 칸을 떠나면 닫는다.
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || (t.id !== 'af_address' && t.id !== 'af_venue')) return;
    setTimeout(function () { if (document.activeElement !== t) sugHide(t); }, 250);
  });
})();
