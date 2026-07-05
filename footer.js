// footer.js — 전자상거래법 필수 표시(사업자정보) + 정책 링크 공통 푸터.
// ⚠️ 아래 BIZ 의 빈 항목([])을 실제 값으로 채우세요(법적 필수). 빈 값은 화면에 노출되지 않습니다.
(function () {
  'use strict';
  var BIZ = {
    company: '꽃안부 · 주식회사 아마존',
    owner: '권점숙',              // 대표자명
    bizNo: '234-86-00344',        // 사업자등록번호
    mailOrderNo: '',              // ⚠️통신판매업 신고번호 — 신고 후 '제0000-경기시흥-0000호' 채우기(실결제 오픈 전 필수)
    addr: '경기 시흥시 신천3길 23, 103호',
    tel: '031-314-3003',
    email: '',                    // ⚠️고객문의 이메일 — 정해지면 채우기
    privacyOfficer: '권점숙'      // 개인정보 보호책임자(대표자)
  };

  function row(label, val) { return val ? '<span class="af-ft-i"><b>' + label + '</b> ' + val + '</span>' : ''; }

  function injectStyles() {
    if (document.getElementById('af-ft-style')) return;
    var css = ''
      + '.af-footer{margin-top:40px;border-top:1px solid #e5e0d4;background:#f3efe6;color:#7a766c;'
      + 'font-size:12px;line-height:1.9;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;}'
      + '.af-footer .af-ft-wrap{max-width:560px;margin:0 auto;padding:22px 20px calc(28px + env(safe-area-inset-bottom,0px));}'
      + '.af-footer .af-ft-name{font-weight:800;color:#1f1d18;font-size:13px;margin-bottom:6px;}'
      + '.af-footer .af-ft-i{display:inline-block;margin-right:12px;}'
      + '.af-footer .af-ft-links{margin-top:10px;}'
      + '.af-footer .af-ft-links a{color:#2d4a38;font-weight:700;text-decoration:none;margin-right:14px;}'
      + '.af-footer .af-ft-policy{margin-top:10px;font-size:11.5px;color:#9e9a8f;}';
    var s = document.createElement('style'); s.id = 'af-ft-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function render() {
    injectStyles();
    if (document.querySelector('.af-footer')) return;
    var info = [
      row('대표', BIZ.owner),
      row('사업자등록번호', BIZ.bizNo),
      row('통신판매업신고', BIZ.mailOrderNo),
      row('주소', BIZ.addr),
      row('전화', BIZ.tel),
      row('이메일', BIZ.email),
      row('개인정보 보호책임자', BIZ.privacyOfficer)
    ].filter(Boolean).join('');
    var f = document.createElement('footer');
    f.className = 'af-footer';
    f.innerHTML =
      '<div class="af-ft-wrap">'
      + '<div class="af-ft-name">' + BIZ.company + '</div>'
      + info
      + '<div class="af-ft-links"><a href="/wedding.html">웨딩 부케</a><a href="/terms.html">이용약관</a><a href="/privacy.html">개인정보처리방침</a><a href="/#corporate">법인·단체 주문</a><a href="sms:0313143003?body=%5B%EB%8F%99%EB%84%A4%EA%BD%83%EC%A7%91%20%ED%8C%8C%ED%8A%B8%EB%84%88%20%EB%AC%B8%EC%9D%98%5D%20%EC%83%81%ED%98%B8%3A%20%2F%20%EC%A7%80%EC%97%AD%3A%20%2F%20%EC%97%B0%EB%9D%BD%EC%B2%98%3A">동네꽃집 파트너</a><a href="tel:' + (BIZ.tel || '').replace(/[^0-9]/g, '') + '">전화 주문</a></div>'
      + '<div class="af-ft-policy">원산지: 생화 국내산(품목별 상세 표기) · 계절·수급에 따라 사진과 일부 다를 수 있으며 같은 등급 이상으로 제작합니다.</div>'
      + '<div class="af-ft-policy">신선식품 특성상 제작·발송 후 단순변심에 의한 교환·환불은 제한될 수 있습니다. '
      + '상품 하자·오배송은 수령 직후 사진과 함께 연락 주시면 재제작 또는 환불해 드립니다. 자세한 내용은 이용약관을 확인해주세요.</div>'
      + '<div class="af-ft-policy">© ' + BIZ.company + '. 1993년부터 한 송이의 마음을 전합니다.</div>'
      + '</div>';
    document.body.appendChild(f);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
