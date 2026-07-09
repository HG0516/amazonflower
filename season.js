// season.js — 시즌 자동 배너. 오늘 날짜가 시즌 기간이면 첫 화면 상단에 안내를 띄운다.
// (기간/문구는 자유롭게 수정. 5월 어버이날이 핵심 대목)
(function () {
  'use strict';
  var SEASONS = [
    { from: '04-20', to: '05-08', title: '🌸 어버이날 카네이션·꽃다발 예약', desc: '5월 8일 어버이날 — 미리 예약하면 당일 걱정 없어요.' },
    { from: '05-09', to: '05-15', title: '🌷 스승의날 꽃', desc: '감사한 마음을 꽃으로 — 5월 15일.' },
    { from: '02-01', to: '02-28', title: '🎓 졸업·입학 꽃다발', desc: '졸업·입학 시즌 꽃다발·꽃바구니 예약 받습니다.' },
    { from: '12-18', to: '12-31', title: '🎄 연말 감사 꽃', desc: '한 해 마무리, 고마운 분께 꽃으로 인사 전하세요.' }
  ];
  function mmdd(d) { return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var today = mmdd(new Date());
  var s = null;
  for (var i = 0; i < SEASONS.length; i++) { if (today >= SEASONS[i].from && today <= SEASONS[i].to) { s = SEASONS[i]; break; } }
  if (!s) return;
  function render() {
    var host = document.querySelector('.wrap') || document.body;
    if (document.getElementById('af-season')) return;
    var el = document.createElement('div');
    el.id = 'af-season';
    el.style.cssText = 'background:#1f4733;color:#fff;border-radius:8px;padding:12px 16px;margin:12px 0;text-align:center;';
    el.innerHTML = '<div style="font-weight:800;font-size:15px;">' + s.title + '</div>'
      + '<div style="font-size:13px;opacity:.92;margin-top:2px;">' + s.desc + '</div>';
    host.insertBefore(el, host.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
