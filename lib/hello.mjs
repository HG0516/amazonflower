// lib/hello.mjs — 꽃 인사 링크 미리보기(카톡·문자). /hello?s=… 를 봇이 열면 보낸 분 이름·그날 꽃 사진으로 og 태그를 채운다.
// 사람은 바로 /hello.html?… 로 넘긴다. 아래 꽃·인사 목록은 hello.html 과 같아야 한다(test/hello.test.mjs 가 맞춰 본다).
// 카카오 키(KAKAO_JS_KEY)가 없을 때도 미리보기에 '○○님이 꽃 인사를 보냈어요'가 보이게 하려는 것(11/3 형구).

export const FLOWERS=[
  {key:"rose",name:"장미",say:"붉은 장미는 사랑, 분홍은 고마움을 뜻한다고 전해져요"},
  {key:"tulip",name:"튤립",say:"봄에 가장 먼저 마음을 전하는 꽃이라고들 해요"},
  {key:"carnation",name:"카네이션",say:"감사와 사랑을 전하는 꽃으로 오래 쓰여 왔어요"},
  {key:"orchid",name:"호접란",say:"나비가 날아오는 모습을 닮아 좋은 소식이 찾아온다는 뜻으로 전해져요"},
  {key:"sunflower",name:"해바라기",say:"한결같이 한 곳을 바라보는 마음을 뜻한대요"},
  {key:"hydrangea",name:"수국",say:"여러 송이가 모여 한 덩이가 되어 진심을 뜻한다고 전해져요"},
  {key:"gerbera",name:"거베라",say:"언제나 밝게 웃는 마음을 닮았다고 해요"}
];
export const SEASONS={
  "봄":{flower:"tulip",tint:"#fdf1f2",g:["꽃 피는 봄입니다. 나들이 가세요.","춘곤증 조심하세요. 낮잠은 괜찮습니다.","봄바람이 셉니다. 모자 잘 붙드세요."]},
  "여름":{flower:"hydrangea",tint:"#eef5f9",g:["더위 조심하세요. 물 많이 드세요.","에어컨 끄지 마세요. 전기세보다 건강입니다.","복날입니다. 닭은 드셨습니까."]},
  "가을":{flower:"sunflower",tint:"#fbf2e6",g:["하늘이 높습니다. 고개 한번 드세요.","환절기입니다. 겉옷 챙기세요.","단풍 구경은 다녀오셨습니까."]},
  "겨울":{flower:"orchid",tint:"#eef1f5",g:["날이 찹니다. 내복 챙기세요.","빙판길 조심하세요. 천천히 가셔도 됩니다.","감기 조심하세요."]}
};
// 1단계 네 가지. 생신·힘내세요·명절·내 사진은 반응을 본 뒤에 연다(시안 '순서').
export const SITS=[
  {k:"daily",t:"오늘의 꽃",g:["좋은 아침입니다","오늘도 건강하세요","좋은 하루 보내세요","식사 잘 챙기세요","평안한 밤 되세요"]},
  {k:"fun",t:"웃긴 안부",g:["약 드셨습니까. 꽃은 물만 먹어도 됩니다.","허리 펴세요. 꽃도 보고 있습니다.","꽃은 밥을 안 줘도 됩니다. 사람은 먹어야 합니다.","오늘 안 웃으시면 꽃이 먼저 웃습니다.","자식 걱정 그만하시고 꽃이나 보세요.","전화 한 통이면 됩니다. 꽃은 말을 못 합니다."]},
  {k:"season",t:"계절 인사"},
  {k:"thanks",t:"고마움",flower:"hydrangea",label:"고마운 분께",g:["늘 고맙습니다","덕분에 잘 지냅니다","별일 없으시지요","보고 싶습니다"]}
];

const BASE = () => "https://floweranbu.co.kr";
const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const byKey = (k) => FLOWERS.find((f) => f.key === k) || FLOWERS[0];
const sitOf = (k) => SITS.find((x) => x.k === k) || SITS[0];
function parseYmd(s) { const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s || ""); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; }
function kstToday() { const d = new Date(Date.now() + 9 * 3600e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
function seasonOf(t) { const md = t.mo * 100 + t.d; return md >= 1107 || md < 204 ? "겨울" : md < 505 ? "봄" : md < 807 ? "여름" : "가을"; }
function flowerOfDay(t) { const n = Math.floor(Date.UTC(t.y, t.mo - 1, t.d) / 864e5); return FLOWERS[((n % FLOWERS.length) + FLOWERS.length) % FLOWERS.length]; }

/** 링크 값 → 미리보기에 쓸 제목·설명·꽃. hello.html 의 resolve() 와 같은 규칙. */
export function helloView(q = {}) {
  const S = sitOf(q.s);
  const day = parseYmd(q.d) || kstToday();
  let f = flowerOfDay(day);
  let list = S.g || [];
  if (S.k === "season") { const X = SEASONS[seasonOf(day)]; f = byKey(X.flower); list = X.g; }
  if (S.flower) f = byKey(S.flower);
  const gi = parseInt(q.g, 10);
  const line = clean(q.m, 24) || (gi >= 0 && gi < list.length ? list[gi] : "");
  const who = clean(q.n, 10);
  const title = who ? `${who}님이 꽃 인사를 보냈어요` : "꽃 인사가 도착했어요";
  const desc = (line ? `"${line}" · ` : "") + `오늘의 꽃 ${f.name}. 눌러서 꽃말을 보고 나도 보내 보세요.`;
  return { title, desc, flower: f, line, who };
}

/** 봇에게는 og 태그만, 사람에게는 바로 /hello.html 로. search 는 '?s=…' 원래 쿼리(hello=1 은 빼고). */
export function renderHelloOg(q, search, bot) {
  const v = helloView(q);
  const dest = "/hello.html" + search;
  const img = `${BASE()}/photos/hello/${v.flower.key}.jpg`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${H(v.title)}</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="꽃안부"><meta property="og:url" content="${H(BASE() + "/hello" + search)}">
<meta property="og:title" content="${H(v.title)}"><meta property="og:description" content="${H(v.desc)}">
<meta property="og:image" content="${H(img)}"><meta property="og:image:width" content="900"><meta property="og:image:height" content="700">
<meta name="twitter:card" content="summary_large_image">${bot ? "" : `<meta http-equiv="refresh" content="0; url=${H(dest)}">
<script>location.replace(${JSON.stringify(dest).replace(/</g, "\\u003c")}+location.hash);</script>`}</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;"><p>${H(v.title)}</p><p><a href="${H(dest)}">열기</a></p></body></html>`;
}
