// regions.js — 배송 지역 판정 (추가 배송비 · 배송 불가)
//
// 원장: 이용약관의 "[ 배송비 추가 지역 ]" 텍스트. 그 텍스트는 사람이 읽는 용도로만 있었고
// 코드는 전혀 몰라서, 손님은 원거리인 줄 모르고 주문하고 사장님이 뒤늦게 전화해야 했다.
// 사장님 말: "다른 지방에 전화했는데 주문을 안 받아줄 수도 있어서 전화하는 거고,
//            그래서 추가비용을 받는 거고, 뻐팅기는 경우가 많다."
// → 그래서 이 파일은 '금액을 자동으로 물리는' 게 아니라 '미리 알려주고 확정 대상으로 표시'한다.
//   실제 수락 여부와 금액은 사장님이 확인해 안내한다(약관 문구와 동일).
//
// ⚠️ api/ 밖에 두는 정적 파일이다(Vercel 12함수 제한).
// ⚠️ 지역 사정은 바뀐다. 고칠 때는 이 파일과 index.html 약관 텍스트를 함께 고칠 것.

(function (global) {
  // level: 1=1만원 · 2=1~2만원 · 3=2만원 · 4=기타(금액 미정)
  // prov: 시·도 힌트(같은 이름이 다른 도에도 있어 잘못 걸리는 걸 막는다. 예: 강원 고성 vs 경남 고성)
  // also: 주소에 함께 있어야 하는 말(예: 안동 풍산면만 해당)
  const EXTRA = [
    // 경기
    { n: "연천", prov: ["경기"], level: 1 },
    { n: "가평", prov: ["경기"], level: 1 },
    { n: "양평", prov: ["경기"], level: 1 },
    { n: "의정부", prov: ["경기"], level: 1 },
    { n: "양주", prov: ["경기"], level: 1 },
    { n: "포천", prov: ["경기"], level: 1 },
    // 인천
    { n: "운서동", prov: ["인천"], level: 2 },
    { n: "영종도", prov: ["인천"], level: 3 },
    { n: "영종", prov: ["인천"], level: 3 },
    // 강원
    { n: "영월", prov: ["강원"], level: 1 },
    { n: "원주", prov: ["강원"], level: 1 },
    { n: "삼척", prov: ["강원"], level: 1 },
    { n: "철원", prov: ["강원"], level: 1 },
    { n: "양구", prov: ["강원"], level: 1 },
    { n: "속초", prov: ["강원"], level: 1 },
    { n: "인제", prov: ["강원"], level: 1 },
    { n: "양양", prov: ["강원"], level: 1 },
    { n: "홍천", prov: ["강원"], level: 1 },
    { n: "강릉", prov: ["강원"], level: 1 },
    { n: "동해", prov: ["강원"], level: 1 },
    { n: "춘천", prov: ["강원"], level: 1 },
    { n: "횡성", prov: ["강원"], level: 2 },
    { n: "고성", prov: ["강원"], level: 3 },   // 경남 고성과 구분하려고 도 힌트를 반드시 본다
    { n: "화천", prov: ["강원"], level: 3 },
    { n: "평창", prov: ["강원"], level: 3 },
    { n: "정선", prov: ["강원"], level: 3 },
    // 충북
    { n: "영동", prov: ["충청북", "충북"], level: 1 },
    { n: "오창읍", prov: ["충청북", "충북"], level: 1 },
    { n: "내수읍", prov: ["충청북", "충북"], level: 1 },
    { n: "괴산", prov: ["충청북", "충북"], level: 1 },
    { n: "단양", prov: ["충청북", "충북"], level: 1 },
    { n: "보은", prov: ["충청북", "충북"], level: 3 },
    { n: "진천", prov: ["충청북", "충북"], level: 3 },
    { n: "증평", prov: ["충청북", "충북"], level: 3 },
    // 충남
    { n: "청양", prov: ["충청남", "충남"], level: 1 },
    { n: "논산", prov: ["충청남", "충남"], level: 1 },
    // 전북
    { n: "무주", prov: ["전라북", "전북"], level: 1 },
    { n: "진안", prov: ["전라북", "전북"], level: 1 },
    { n: "장수", prov: ["전라북", "전북"], level: 1 },
    { n: "남원", prov: ["전라북", "전북"], level: 1 },
    { n: "순창", prov: ["전라북", "전북"], level: 1 },
    { n: "완주", prov: ["전라북", "전북"], level: 1 },
    { n: "고창", prov: ["전라북", "전북"], level: 1 },
    { n: "임실", prov: ["전라북", "전북"], level: 1 },
    // 전남
    { n: "곡성", prov: ["전라남", "전남"], level: 1 },
    { n: "장흥", prov: ["전라남", "전남"], level: 1 },
    { n: "진도", prov: ["전라남", "전남"], level: 1 },
    { n: "해남", prov: ["전라남", "전남"], level: 1 },
    { n: "나주", prov: ["전라남", "전남"], level: 1 },
    { n: "광양", prov: ["전라남", "전남"], level: 1 },
    { n: "보성", prov: ["전라남", "전남"], level: 1 },
    { n: "완도", prov: ["전라남", "전남"], level: 1 },
    { n: "영암", prov: ["전라남", "전남"], level: 1 },
    { n: "구례", prov: ["전라남", "전남"], level: 1 },
    { n: "고흥", prov: ["전라남", "전남"], level: 3 },
    // 경북 (원장에 울주·대구 달성이 경북 항목으로 들어가 있어 실제 행정구역 기준으로 도 힌트를 잡았다)
    { n: "울주", prov: ["울산"], level: 1 },
    { n: "의성", prov: ["경상북", "경북"], level: 1 },
    { n: "영양", prov: ["경상북", "경북"], level: 1 },
    { n: "군위", prov: ["경상북", "경북", "대구"], level: 1 },
    { n: "청송", prov: ["경상북", "경북"], level: 1 },
    { n: "고령", prov: ["경상북", "경북"], level: 1 },
    { n: "영천", prov: ["경상북", "경북"], level: 1 },
    { n: "문경", prov: ["경상북", "경북"], level: 1 },
    { n: "상주", prov: ["경상북", "경북"], level: 1 },
    { n: "영주", prov: ["경상북", "경북"], level: 1 },
    { n: "영덕", prov: ["경상북", "경북"], level: 1 },
    { n: "풍산", prov: ["경상북", "경북"], also: "안동", level: 1 },
    { n: "풍전", prov: ["경상북", "경북"], also: "안동", level: 1 },
    { n: "달성", prov: ["대구"], level: 1 },
    { n: "경주", prov: ["경상북", "경북"], level: 1, part: true },
    { n: "울진", prov: ["경상북", "경북"], level: 3 },
    // 경남
    { n: "의령", prov: ["경상남", "경남"], level: 1 },
    { n: "산청", prov: ["경상남", "경남"], level: 1 },
    { n: "하동", prov: ["경상남", "경남"], level: 1 },
    { n: "합천", prov: ["경상남", "경남"], level: 3 },
    { n: "밀양", prov: ["경상남", "경남"], level: 3 },
    // 부산
    { n: "강서", prov: ["부산"], level: 4 },
    { n: "기장", prov: ["부산"], level: 4 },
    { n: "정관", prov: ["부산"], level: 4, part: true },
    // 제주
    { n: "서귀포", prov: ["제주"], level: 2 },
    { n: "제주시", prov: ["제주"], level: 2, part: true },
  ];

  // 배송이 어려운 곳. 막지는 않고 '확정 필요'로 표시해 사장님이 판단하도록 한다.
  // 대부도는 원장에서 경기(배송 불가)와 인천(2만원 추가)에 서로 다르게 적혀 있다.
  // 같은 곳이므로 조심스러운 쪽(배송 불가)을 따랐다.
  const BLOCKED = [
    { n: "공룡알화석지", prov: [] },
    { n: "대부도", prov: [] },
    { n: "대부북동", prov: [] },
    { n: "대부남동", prov: [] },
    { n: "옹진", prov: ["인천"] },
    { n: "임계면", prov: ["강원"] },
    { n: "변산반도", prov: [] },
    { n: "변산면", prov: ["전라북", "전북"] },
    { n: "땅끝마을", prov: [] },
    { n: "소록도", prov: [] },
    { n: "신안", prov: ["전라남", "전남"] },
    { n: "감포읍", prov: ["경상북", "경북"] },
  ];

  const LEVEL_LABEL = {
    1: "약 1만원",
    2: "약 1~2만원",
    3: "약 2만원",
    4: "별도",
  };

  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  // 지역명이 다른 낱말 안에 파묻혀 걸리는 걸 막는다(예: 건물명 '영월빌딩').
  // 행정구역 꼬리(시·군·구·읍·면·동·리)나 공백/끝이 뒤따를 때만 인정한다.
  function nameHit(addr, n) {
    if (/[읍면동리시군구]$/.test(n)) return addr.indexOf(n) >= 0;
    // 도로명(…로/…길)도 인정한다 — '공룡알화석지로' 처럼 지명이 길 이름에만 남는 곳이 있다.
    // 도 힌트가 함께 걸려 있어서 다른 도의 같은 이름 길에는 걸리지 않는다.
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(esc + "(?:시|군|구|읍|면|동|리|로|길|가|\\s|$)").test(addr);
  }

  function provHit(addr, provs) {
    if (!provs || !provs.length) return true;
    for (let i = 0; i < provs.length; i++) if (addr.indexOf(provs[i]) >= 0) return true;
    return false;
  }

  function match(addr, r) {
    if (!nameHit(addr, r.n)) return false;
    if (!provHit(addr, r.prov)) return false;
    if (r.also && addr.indexOf(r.also) < 0) return false;
    return true;
  }

  /**
   * 주소 한 줄을 보고 배송 지역 성격을 알려준다.
   * @returns {null|{blocked:boolean, level:number, name:string, label:string, part:boolean, note:string}}
   *          해당 없으면 null (= 기본 배송권역, 추가비용 없음)
   */
  function regionCheck(address) {
    const addr = norm(address);
    if (addr.length < 4) return null;   // 주소를 치는 중에 헛걸리지 않게

    for (let i = 0; i < BLOCKED.length; i++) {
      if (match(addr, BLOCKED[i])) {
        return {
          blocked: true,
          level: 0,
          name: BLOCKED[i].n,
          label: "",
          part: false,
          note: "배송이 어려울 수 있는 지역이에요. 주문은 받아드리고, 사장님이 배송 가능한지 확인해 연락드립니다. 어려우면 전액 환불해 드립니다.",
        };
      }
    }

    // 여러 개 걸리면 비용이 큰 쪽을 택한다(작게 안내했다가 나중에 더 받는 일이 없게).
    let best = null;
    for (let i = 0; i < EXTRA.length; i++) {
      if (!match(addr, EXTRA[i])) continue;
      if (!best || EXTRA[i].level > best.level) best = EXTRA[i];
    }
    if (!best) return null;

    return {
      blocked: false,
      level: best.level,
      name: best.n,
      label: LEVEL_LABEL[best.level] || "별도",
      part: !!best.part,
      note: "",
    };
  }

  global.regionCheck = regionCheck;
  global.REGION_DATA = { EXTRA: EXTRA, BLOCKED: BLOCKED };
})(typeof window !== "undefined" ? window : globalThis);
