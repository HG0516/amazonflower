// photo-meta.js — 관리자 '사진 위치 맞추기'(/admin-photos.html)에서 정한 값을 손님 화면 사진에 입힌다.
// 사진 파일은 그대로 두고 중심(x·y %)·확대·꽉채움/전체보임만 photo_meta 표에서 읽어 <img> 에 스타일로 얹는다.
// 사진첩 카드(.gcard)는 숨김도 따른다. 표가 없거나(supabase-photo-home.sql 전) 실패하면 아무것도 안 한다.
// 그리는 코드(catalog·index)를 하나도 안 고치려고, 새로 생기는 <img> 를 지켜보다 맞는 게 있으면 입힌다.
(function () {
  'use strict';
  var META = null;

  // 사진 주소 → 표의 key. 주소 앞부분(도메인)·?쿼리·인코딩 차이를 없앤 경로만 쓴다(관리자 화면과 같은 규칙).
  function keyOf(src) {
    try { return decodeURIComponent(new URL(src, location.href).pathname); } catch (e) { return ''; }
  }
  window.afPhotoKey = keyOf;

  function apply(img) {
    if (!META || !img || !img.getAttribute) return;
    var src = img.getAttribute('src'); if (!src) return;
    var m = META[keyOf(src)];
    if (!m) return;
    if (m.hidden) {
      var card = img.closest('.gcard');
      if (card) { card.style.display = 'none'; return; }
    }
    var pos = m.x + '% ' + m.y + '%';
    img.style.objectFit = m.fit === 'contain' ? 'contain' : 'cover';
    img.style.objectPosition = pos;
    img.style.padding = m.fit === 'contain' ? '' : '0';   // 화환 목록은 기본 여백이 있다 → 꽉 채우기로 정하면 여백도 뺀다
    if (m.zoom > 1) { img.style.transform = 'scale(' + m.zoom + ')'; img.style.transformOrigin = pos; }
    else { img.style.transform = ''; }
  }
  function applyAll(root) {
    var list = (root || document).querySelectorAll ? (root || document).querySelectorAll('img') : [];
    for (var i = 0; i < list.length; i++) apply(list[i]);
  }

  function start() {
    if (!window.SUPA || !SUPA.url || !SUPA.anon) return;
    fetch(SUPA.url + '/rest/v1/photo_meta?select=key,x,y,zoom,fit,hidden', { headers: { apikey: SUPA.anon, Authorization: 'Bearer ' + SUPA.anon } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return;
        META = {};
        rows.forEach(function (r) { if (r && r.key) META[r.key] = r; });
        applyAll(document);
        new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var mu = muts[i];
            if (mu.type === 'attributes') { apply(mu.target); continue; }
            for (var j = 0; j < mu.addedNodes.length; j++) {
              var n = mu.addedNodes[j];
              if (n.nodeType !== 1) continue;
              if (n.tagName === 'IMG') apply(n); else applyAll(n);
            }
          }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      })
      .catch(function () {});
  }
  // defer 로 읽혀 supabase-config.js 보다 먼저 돌 수 있다 → 모든 defer 가 끝난 DOMContentLoaded 에서 시작
  if (document.readyState === 'complete') start(); else document.addEventListener('DOMContentLoaded', start);
})();
