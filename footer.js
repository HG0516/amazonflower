// footer.js — 전자상거래법 필수 표시(사업자정보) + 정책 링크 공통 푸터.
//              + 유입경로(UTM) 기록: 전 페이지에 로드되는 유일한 공통 스크립트라 여기에 둔다.
// [필수] 아래 BIZ 의 빈 항목([])을 실제 값으로 채우세요(법적 필수). 빈 값은 화면에 노출되지 않습니다.
(function () {
  'use strict';

  // ── 유입경로 기록 (전 페이지) ──
  // 예전엔 index.html 안에만 있어서, 인스타·지도 링크를 catalog 로 걸면 유입이 집계에서 통째로 사라졌다.
  // 마지막 유입 기준 30일 보관 → 결제 시 주문에 실려 관리자 '📊 통계'의 채널별 집계가 된다.
  try {
    var q = new URLSearchParams(location.search);
    var src = q.get('utm_source');
    if (src) {
      localStorage.setItem('af_utm', JSON.stringify({
        s: src.slice(0, 64),
        m: (q.get('utm_medium') || '').slice(0, 64),
        c: (q.get('utm_campaign') || '').slice(0, 64),
        t: Date.now()
      }));
    }
  } catch (_e) {}
  var BIZ = {
    company: '꽃안부 · 주식회사 아마존',
    owner: '권점숙',              // 대표자명
    bizNo: '234-86-00344',        // 사업자등록번호
    mailOrderNo: '제2026-경기시흥-1357호',   // 통신판매업 신고번호
    addr: '경기 시흥시 신천3길 23, 103호',
    tel: '031-314-3003',
    email: '',                    // [필수] 고객문의 이메일 — 정해지면 채우기
    privacyOfficer: '권점숙',     // 개인정보 보호책임자(대표자)
    insta: 'amazonflower3003'     // 인스타 계정(@ 없이) — 푸터 링크
  };

  function row(label, val) { return val ? '<span class="af-ft-i"><b>' + label + '</b> ' + val + '</span>' : ''; }

  function injectStyles() {
    if (document.getElementById('af-ft-style')) return;
    var css = ''
      + '.af-footer{margin-top:40px;border-top:1px solid #e5e0d4;background:#f3efe6;color:#7a766c;'
      + 'font-size:var(--fs-caption);line-height:1.9;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;}'
      + '.af-footer .af-ft-wrap{max-width:560px;margin:0 auto;padding:22px 20px calc(28px + env(safe-area-inset-bottom,0px));}'
      + '.af-footer .af-ft-name{font-weight:800;color:#1f1d18;font-size:var(--fs-sub);margin-bottom:6px;}'
      + '.af-footer .af-ft-tel{display:block;font-size:18px;font-weight:700;color:#1f1d18;text-decoration:none;margin:2px 0 10px;letter-spacing:0.3px;}'
      + '.af-footer .af-ft-i{display:inline-block;margin-right:12px;}'
      + '.af-footer .af-ft-links{margin-top:10px;}'
      + '.af-footer .af-ft-links a{color:#1f4733;font-weight:700;text-decoration:none;margin-right:14px;}'
      + '.af-footer .af-ft-insta{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:7px 12px;'
      + 'border:1px solid #dcd9cf;border-radius:999px;color:#1f1d18;text-decoration:none;font-size:var(--fs-caption);font-weight:700;}'
      + '.af-footer .af-ft-insta svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;flex-shrink:0;}'
      + '.af-footer .af-ft-insta:active{opacity:.7;}'
      + '.af-footer .af-ft-policy{margin-top:10px;font-size:var(--fs-caption);color:#9e9a8f;}'
      + '.af-footer .af-ft-origin{margin-top:10px;font-size:var(--fs-caption);}'
      + '.af-footer .af-ft-origin>summary{color:#1f4733;font-weight:700;cursor:pointer;list-style:revert;}'
      + '.af-footer .af-ft-origin-body{margin-top:8px;overflow-x:auto;}'
      + '.af-footer .af-ft-origin table{width:100%;border-collapse:collapse;font-size:var(--fs-caption);line-height:1.6;}'
      + '.af-footer .af-ft-origin th{text-align:left;vertical-align:top;white-space:nowrap;padding:4px 8px 4px 0;color:#1f1d18;font-weight:700;}'
      + '.af-footer .af-ft-origin td{vertical-align:top;padding:4px 0;border-bottom:1px solid #e5e0d4;}'
      + '.af-footer .af-ft-origin p{margin-top:8px;font-size:var(--fs-caption);color:#9e9a8f;line-height:1.7;}';
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
      + (BIZ.tel ? '<a class="af-ft-tel" href="tel:' + BIZ.tel.replace(/[^0-9]/g, '') + '">전화 주문·문의 ' + BIZ.tel + '</a>' : '')
      + info
      + '<div class="af-ft-links"><a href="/wedding.html">웨딩 부케</a><a href="/terms.html">이용약관</a><a href="/privacy.html">개인정보처리방침</a><a href="/#corporate">법인·단체 주문</a><a href="sms:0313143003?body=%5B%EB%8F%99%EB%84%A4%EA%BD%83%EC%A7%91%20%ED%8C%8C%ED%8A%B8%EB%84%88%20%EB%AC%B8%EC%9D%98%5D%20%EC%83%81%ED%98%B8%3A%20%2F%20%EC%A7%80%EC%97%AD%3A%20%2F%20%EC%97%B0%EB%9D%BD%EC%B2%98%3A">동네꽃집 파트너</a><a href="tel:' + (BIZ.tel || '').replace(/[^0-9]/g, '') + '">전화 주문</a></div>'
      // 인스타 — 제작 사진이 쌓여 있는데 지금껏 홈에서 가는 길이 없었다. 전 페이지 푸터에 한 줄.
      + '<a class="af-ft-insta" href="https://instagram.com/' + BIZ.insta + '" target="_blank" rel="noopener">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none"/></svg>'
      + '<span>인스타그램 @' + BIZ.insta + ' — 오늘 만든 꽃 보기</span></a>'
      + '<details class="af-ft-origin"><summary>원산지 표시 (농수산물 원산지 표시제)</summary>'
      + '<div class="af-ft-origin-body"><table><tbody>'
      + '<tr><th>국산</th><td>장미·국화·카네이션·백합·튤립·글라디올러스·거베라·아이리스·프리지아·카라·안개꽃·관엽식물·동양란·서양란·분재·다육선인장, 부자재(화분·화병·꽃바구니·꽃상자·포장재·리본 등)</td></tr>'
      + '<tr><th>중국·대만</th><td>장미·국화·카네이션·거베라·골든볼·다알리아·금어초·르네브·미스터블루·메리골드·대국·소철·스타치스·스토크·풍품소국·시네신스·천일홍·백합·튤립·프리지아·해바라기·후룩스·석죽·관엽식물·동양란·서양란·분재·다육선인장, 부자재 등</td></tr>'
      + '<tr><th>베트남</th><td>장미·카네이션·관엽식물·동양란·서양란, 부자재 등</td></tr>'
      + '<tr><th>일본</th><td>백합·프리저브드</td></tr>'
      + '<tr><th>아르헨티나</th><td>스티파</td></tr>'
      + '<tr><th>동남아·파키스탄</th><td>카네이션·관엽식물, 부자재 등 (말레이시아·인도네시아·태국·필리핀·파키스탄)</td></tr>'
      + '<tr><th>콜롬비아·코스타리카</th><td>카네이션·수국·레몬잎·프리저브드·골든볼·다알리아·부바르디아·라넌큘러스·아스틸베·아이리스·안개·카라·튤립</td></tr>'
      + '<tr><th>호주</th><td>브로니아·그레빌리아·유칼립투스</td></tr>'
      + '<tr><th>에티오피아</th><td>장미·안개·백묘국</td></tr>'
      + '<tr><th>이스라엘</th><td>옐엔지움·목화</td></tr>'
      + '<tr><th>네덜란드</th><td>브바르디아·다알리아·라넌큘러스·튤립</td></tr>'
      + '<tr><th>이탈리아·스페인</th><td>라그라스 · 프리저브드</td></tr>'
      + '<tr><th>남아공</th><td>버질리아·울부시·왁스플라워·만다린믹스·부케믹스·핑쿠션·방크샤</td></tr>'
      + '</tbody></table>'
      + '<p>생화·계절꽃·그린소재 — 국내산 및 수입산 / 부자재 — 수입산. 모든 상품은 배송지역 인근 제작업체와 꽃 수급 상황에 따라 원산지가 달라질 수 있으며, 배송되는 상품의 포장재·영수증·배송장·스티커 등에 원산지를 표시하여 발송합니다. 계절·수급에 따라 사진과 일부 다를 수 있으며 같은 등급 이상으로 제작합니다.</p>'
      + '</div></details>'
      + '<details class="af-ft-origin"><summary>배송 안내 · 추가 배송비</summary><div class="af-ft-origin-body"><p>'
      + '· 배송 가능 시간 — 평일 09:00~19:00 · 토요일 09:00~18:00 · 일요일/공휴일 예약주문.<br>'
      + '· 평일 18시 · 주말(토·일) 16시까지 들어온 주문은 당일 배송, 이후 주문은 확인되어 순차 배송됩니다. 인터넷 주문은 24시간 접수하며 희망 배달일시를 기재하실 수 있습니다.<br>'
      + '· 국내 전지역 당일(3~4시간 내) 배송됩니다. <b>읍·면·리 단위, 도서·산간, 외곽 지역은 추가 배송비(5,000~30,000원)가 발생하거나 배송이 어려울 수 있으며, 주문 접수 후 개별 안내드립니다.</b><br>'
      + '· 어버이날·스승의날·화이트데이 등 특정 기념일에는 주문 폭주로 시간 지정이 어렵고 배송이 다소 지연될 수 있습니다.'
      + '</p></div></details>'
      + '<details class="af-ft-origin"><summary>상품 유의사항</summary><div class="af-ft-origin-body"><p>'
      + '· 실제 상품과 사진은 계절 및 지역에 따라 다소 차이가 있을 수 있습니다.<br>'
      + '· 계절·지역에 따라 상품 구성 소재(꾸밈식물·계절꽃)가 달라지거나 가격에 차이가 있을 수 있습니다.<br>'
      + '· 바구니·화환·포장 등 실제 배송되는 상품이 상품 이미지와 다를 수 있으며, 대체 시 동급 이상으로 제작합니다.<br>'
      + '· 홈페이지 모든 이미지는 상품의 이해를 돕기 위한 참고용 사진이며, 화분·꽃바구니 등의 데코레이션(꾸밈식물·포장)은 사진 촬영용입니다.<br>'
      + '· 발렌타인데이·화이트데이·어버이날·스승의날 등 특정 기념일에는 주문 폭주로 상품 모양이 다소 달라질 수 있습니다.'
      + '</p></div></details>'
      + '<details class="af-ft-origin"><summary>취소 · 교환 · 환불 안내</summary><div class="af-ft-origin-body"><p>'
      + '· 주문 취소는 전화(031-314-3003)로 문의해 주시면 친절히 안내해 드립니다.<br>'
      + '· 생화 특성상 주문 접수 즉시 제작되어, 제작이 시작된 후에는 취소·환불이 어렵습니다. (제작 전에는 전액 환불 가능)<br>'
      + '· 예약 주문·특수 상품(파란장미·백장미 등 재고가 없어 별도 주문한 상품)은 취소가 불가할 수 있으며 원가·배송비가 발생할 수 있습니다.<br>'
      + '· 상품에 명백한 하자·오배송이 있는 경우 수령 당일 사진과 함께 연락 주시면 재제작 또는 환불해 드립니다.<br>'
      + '· ★ 꽃은 생물인 관계로 정당한 사유에 한해 배송 당일에만 환불 및 교환 요청이 가능합니다 ★'
      + '</p></div></details>'
      + '<div class="af-ft-policy">신선식품 특성상 제작·발송 후 단순변심에 의한 교환·환불은 제한될 수 있습니다. '
      + '상품 하자·오배송은 수령 직후 사진과 함께 연락 주시면 재제작 또는 환불해 드립니다. 자세한 내용은 이용약관을 확인해주세요.</div>'
      + '<div class="af-ft-policy">© ' + BIZ.company + '. 1993년부터 한 송이의 마음을 전합니다.</div>'
      + '</div>';
    document.body.appendChild(f);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
