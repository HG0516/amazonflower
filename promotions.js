/* ──────────────────────────────────────────────────────────────
   꽃안부 시즌 프로모션 — 오늘 날짜에 맞춰 상단 배너가 자동으로 바뀜
   출처: 꽃안부_시즌캘린더.csv (한국 꽃 수요 캘린더, 128개 시즌 조사)

   사용법(HTML 한 줄):
     <div id="seasonBanner"></div>
     <script src="promotions.js"></script>
     <script>FlowerPromo.render("seasonBanner");</script>

   유지보수:
     - 고정일(어버이날·화이트데이 등)은 MM-DD 범위라 매년 자동.
     - 음력(설·추석)은 해마다 날짜가 바뀌므로 LUNAR에 연도별로 추가/갱신.
   ────────────────────────────────────────────────────────────── */
(function (global) {
  // 고정일/시즌 프로모션 (MM-DD, 매년 반복). priority 높을수록 우선.
  var PROMOS = [
    { id:"newyear",   start:"01-01", end:"01-15", priority:7, emoji:"🎍",
      badge:"신년 인사", title:"승진·취임·새해 인사",
      message:"새해 첫 마음, 품격 있는 축하난으로", cat:"oriental", theme:"#1f6f54" },
    { id:"graduation",start:"01-15", end:"02-28", priority:8, emoji:"🎓",
      badge:"졸업 시즌", title:"졸업 축하 꽃다발 예약",
      message:"프리지아·튤립 졸업 꽃다발 — 새 출발을 응원해요", cat:"bouquet", theme:"#e3a81b" },
    { id:"valentine", start:"02-01", end:"02-14", priority:9, emoji:"💗",
      badge:"발렌타인", title:"발렌타인 꽃+초콜릿",
      message:"사랑을 전하는 가장 향기로운 방법 — 레드 장미 예약중", cat:"bouquet", theme:"#d6336c" },
    { id:"entrance",  start:"02-25", end:"03-10", priority:8, emoji:"🌷",
      badge:"입학 시즌", title:"입학 축하 미니 꽃다발",
      message:"첫 등굣길을 꽃으로 — 아이 손에 쏙 들어오는 사이즈", cat:"bouquet", theme:"#3b9ae1" },
    { id:"whiteday",  start:"03-07", end:"03-14", priority:9, emoji:"🤍",
      badge:"화이트데이", title:"화이트데이 꽃+선물 세트",
      message:"사탕만으론 부족하죠 — 한정 세트 예약", cat:"bouquet", theme:"#c79bd6" },
    { id:"spring_wed",start:"03-15", end:"04-30", priority:6, emoji:"💍",
      badge:"봄 웨딩", title:"봄 웨딩 부케 예약",
      message:"봄빛 신부를 위한 작약·라넌큘러스 부케", cat:"bouquet", theme:"#e7a6b6" },
    { id:"parents",   start:"04-25", end:"05-08", priority:10, emoji:"🌸",
      badge:"어버이날", title:"어버이날 카네이션 예약",
      message:"부모님께 드리는 카네이션 바구니·용돈바구니 — 미리 예약하세요", cat:"basket", theme:"#e8546b" },
    { id:"teacher",   start:"05-09", end:"05-15", priority:8, emoji:"🌿",
      badge:"스승의날", title:"스승의날 감사 꽃",
      message:"가르침에 감사드립니다 — 카네이션·동양란", cat:"basket", theme:"#2f9e6f" },
    { id:"rose",      start:"05-14", end:"05-21", priority:7, emoji:"🌹",
      badge:"성년의날·로즈데이", title:"장미 선물",
      message:"성년의날·로즈데이엔 향기로운 장미 한 다발", cat:"bouquet", theme:"#c0143c" },
    { id:"summer",    start:"06-01", end:"08-20", priority:3, emoji:"🌻",
      badge:"여름꽃", title:"여름 제철 꽃",
      message:"해바라기·수국으로 시원하게 — 더위 안전배송", cat:"basket", theme:"#f2a900" },
    { id:"fall_wed",  start:"09-15", end:"11-15", priority:6, emoji:"💍",
      badge:"가을 웨딩", title:"가을 웨딩 부케 예약",
      message:"연중 최대 웨딩 시즌 — 부케·부토니아 사전상담", cat:"bouquet", theme:"#b5651d" },
    { id:"suneung",   start:"11-10", end:"11-20", priority:7, emoji:"📣",
      badge:"수능", title:"수능 합격 기원 꽃",
      message:"노력한 당신을 응원합니다 — 합격 기원 꽃다발", cat:"bouquet", theme:"#e3a81b" },
    { id:"yearend",   start:"11-20", end:"12-15", priority:6, emoji:"🎀",
      badge:"연말 인사", title:"연말 승진·인사 축하난",
      message:"한 해 감사 인사, 거래처·임원께 품격 있는 난", cat:"oriental", theme:"#1f6f54" },
    { id:"xmas",      start:"12-01", end:"12-25", priority:8, emoji:"🎄",
      badge:"크리스마스", title:"크리스마스 꽃·포인세티아",
      message:"연말 분위기를 화사하게 — 포인세티아·꽃다발", cat:"plant", theme:"#c0392b" }
  ];

  // 음력 기반(설·추석)은 연도별 명시. 매년 새 줄 추가하면 됨.
  var LUNAR = [
    { id:"seollal26", start:"2026-02-03", end:"2026-02-17", priority:10, emoji:"🧧",
      badge:"설 명절", title:"설 효도 선물 예약",
      message:"부모님 댁을 화사하게 — 고급 난·꽃 미리 예약(연휴 배송 마감 주의)", cat:"oriental", theme:"#b5651d" },
    { id:"chuseok26", start:"2026-09-10", end:"2026-09-26", priority:10, emoji:"🌕",
      badge:"추석 한가위", title:"추석 효도 선물 예약",
      message:"마음을 담은 추석 선물 — 호접란·동양란·과일바구니", cat:"oriental", theme:"#b5651d" }
  ];

  // 아무 시즌도 없을 때 기본 배너(상시 수요)
  var DEFAULT = { id:"always", emoji:"💐", badge:"오늘의 꽃",
    title:"생일·기념일 꽃다발 당일배송",
    message:"근조화환 24시간 당일배송 · 맞춤 꽃다발 제작", cat:"", theme:"#7a8b6f" };

  function pad(n){ return (n<10?"0":"")+n; }
  function inRange(mmdd, s, e){
    // 연말→연초 넘어가는 범위(예: 12-20~01-05)도 처리
    return s<=e ? (mmdd>=s && mmdd<=e) : (mmdd>=s || mmdd<=e);
  }

  function pick(date){
    var d = date || new Date();
    var ymd = d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
    var mmdd = pad(d.getMonth()+1)+"-"+pad(d.getDate());
    var best = null;
    // 음력(명시 연도) 우선 검사
    LUNAR.forEach(function(p){
      if (ymd>=p.start && ymd<=p.end && (!best || p.priority>best.priority)) best=p;
    });
    PROMOS.forEach(function(p){
      if (inRange(mmdd, p.start, p.end) && (!best || p.priority>best.priority)) best=p;
    });
    return best || DEFAULT;
  }

  function render(elId, date){
    var el = (typeof elId==="string") ? document.getElementById(elId) : elId;
    if (!el) return;
    var p = pick(date);
    var href = p.cat ? ("catalog.html?cat="+encodeURIComponent(p.cat)) : "catalog.html";
    el.innerHTML =
      '<a href="'+href+'" style="display:flex;align-items:center;gap:8px;justify-content:center;'+
      'text-decoration:none;background:'+p.theme+';color:#fff;padding:9px 14px;border-radius:6px;'+
      'font-size:14px;line-height:1.4;">'+
      '<span style="font-size:16px;">'+p.emoji+'</span>'+
      '<b style="font-weight:700;">'+p.title+'</b>'+
      '<span style="opacity:.92;">— '+p.message+'</span>'+
      '</a>';
    return p;
  }

  global.FlowerPromo = { promos:PROMOS, lunar:LUNAR, pick:pick, render:render };
})(window);
