// scripts/build-guide.mjs
// 꽃 선물 묻고 답하기(/guide/, 11/27). 손님이 "챗GPT 보고 왔다"고 해서, AI 검색이 그대로 따다 쓸 수 있게
// 질문 하나에 페이지 하나, 첫 문단에 바로 답을 적는다. 화면에 보이는 질문만 FAQPage 데이터에 넣는다.
//
// 가격·이름·사진은 products.mjs 에서 읽는다(본문의 [[상품코드]] → "49,000원"). 리본 문구는 주문서(index.html 의 RIBBON)에
// 있는 것만 쓴다 — 없으면 멈춘다. 마감·배송비·환불·사진 문자 같은 규칙은 faq.html(build-ai.mjs FAQ)과 같은 말만 쓴다.
// 손으로 guide/*.html 을 고치지 말고 여기를 고쳐 다시 돌릴 것.
// 실행: node scripts/build-guide.mjs   → guide/index.html, guide/<slug>.html

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTS } from "../products.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
export const UPDATED = "2026-11-27";
const UTM = "utm_source=guide";

const RIBBON = (() => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = html.match(/const RIBBON = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error("index.html 에서 RIBBON 을 못 찾았어요");
  return vm.runInNewContext("(" + m[1] + ")");
})();
const RIBBON_ALL = new Set(Object.values(RIBBON).flatMap((g) => Object.entries(g).filter(([k]) => k !== "tones").flatMap(([, l]) => l)));

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n) => n.toLocaleString("ko-KR") + "원";
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const onSale = PRODUCTS.filter((p) => p.status !== "품절" && p.price > 0);
const prod = (pc) => { const p = onSale.find((x) => x.pc === pc); if (!p) throw new Error(`판매 중인 상품이 아니에요: ${pc}`); return p; };
const byCat = (c) => onSale.filter((p) => p.cat === c).sort((a, b) => a.price - b.price || a.pc.localeCompare(b.pc));
const minOf = (c) => won(byCat(c)[0].price);
const maxOf = (c) => { const l = byCat(c); return won(l[l.length - 1].price); };
const label = (p) => (p.subtitle ? `${p.name} (${p.subtitle})` : p.name) + (p.cat === "orchid" && p.sub ? ` · ${p.sub}` : "");
// 주문서에 있는 리본 문구만 쓴다.
const rb = (t) => { if (!RIBBON_ALL.has(t)) throw new Error(`주문서에 없는 리본 문구: ${t}`); return t; };
// 본문 [[WC-01]] → 가격. {{condolence:min}} / {{condolence:max}} / {{condolence:n}} → 분류 최저·최고가·개수.
const fill = (s) => s
  .replace(/\[\[([A-Z]{2}-\d{2,3})\]\]/g, (_, pc) => won(prod(pc).price))
  .replace(/\{\{(\w+):(min|max|n)\}\}/g, (_, c, k) => (k === "min" ? minOf(c) : k === "max" ? maxOf(c) : String(byCat(c).length)));
const plain = (html) => fill(html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const FUNERAL = `/?worder=funeral&${UTM}`;
const order = (pc) => `/?pc=${encodeURIComponent(pc)}&${UTM}`;
const tel = '<a class="nw" href="tel:15772286">1577-2286</a>';

// 마감·사진 문자·배송비·취소는 faq.html 과 같은 문장.
const Q_TODAY = ["오늘 받을 수 있나요?", `평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 그보다 늦으면 다음 날 보내 드려요. 급하면 ${tel}으로 전화 주세요.`];
const Q_PHOTO = ["도착했는지 알 수 있나요?", "배송하고 바로 도착 사진을 문자로 보내 드려요."];
const Q_FEE = ["배송비가 따로 있나요?", "상품 가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역은 1만 원에서 3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요."];
const Q_BILL = ["회사 이름으로 보내고 계산서를 받을 수 있나요?", `주문서에서 법인·단체를 펼쳐 사업자 정보를 넣으면 계산서를 발행해 드려요. 자주 보내는 회사는 후불과 월 정산 거래처로 등록할 수 있어요(${tel}).`];
const Q_SAME = ["사진과 똑같이 오나요?", "계절과 꽃 수급에 따라 사진과 조금 다를 수 있어요. 그럴 때는 같은 등급 이상으로 만들어 드려요."];
// 주문서 규칙(index.html): 리본 왼쪽 = 보내는 분, 오른쪽 = 문구(직접 적어도 됨). 꽃다발·꽃바구니엔 메시지 카드(무료, 150자).
// 받는 날짜·도착 시간(당일중·오전중·오후중·상세시간)을 고를 수 있다. '사장님께 부탁' 칸(예: 향이 약한 꽃으로).
const Q_RIBBON_SIDE = ["리본에는 무엇이 들어가나요?", "화환 양쪽에 리본이 달려요. 왼쪽에는 보내는 분 이름, 오른쪽에는 인사 문구가 들어가요. 오른쪽 문구는 주문서에서 고르거나 직접 적어도 돼요."];
const Q_CARD = ["카드를 넣을 수 있나요?", "꽃다발과 꽃바구니에는 메시지 카드를 넣어 드려요. 추가 비용은 없고 150자까지 적을 수 있어요."];
const Q_DATE = ["받는 날짜와 시간을 정할 수 있나요?", "주문서에서 받는 날짜와 도착 시간(당일중, 오전중, 오후중, 정확한 시각)을 고를 수 있어요. 오늘 받으려면 평일 18시, 주말 16시까지 주문해 주세요."];
const Q_SPLIT = ["여럿이 돈을 모았는데 결제를 나눠 할 수 있나요?", "결제는 한 번에 한 분이 해 주세요. 모은 돈은 결제하신 분께 따로 보내 주시면 돼요."];
const rbl = (list) => `<ul>${list.map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`;
// 카드 문구는 새로 쓴 짧은 예시 — 화면에 '예시'라고 붙인다.
const card = (t) => `“${esc(t)}” <small>(예시)</small>`;

export const GUIDES = [
  {
    slug: "funeral-timing", short: "근조화환 보내는 시기",
    q: "장례식장에 근조화환은 언제까지 보내야 하나요?",
    title: "장례식장에 근조화환은 언제까지 보내야 하나요? | 꽃안부",
    a: `근조화환은 발인 전에 빈소에 도착해야 해요. 발인이 끝나면 빈소를 정리해서 화환을 둘 곳이 없어지니, 부고를 받으면 되도록 빨리 보내는 게 좋아요. 꽃안부는 평일 18시, 주말 16시까지 주문하면 오늘 도착하고, 발인이 내일 아침이라면 ${tel}으로 전화 주시면 발인 전에 닿도록 바로 보내 드려요.`,
    sections: [
      ["부고를 받으면 되도록 빨리 보내요", `<p>장례는 며칠 안에 끝나요. 빈소를 차린 날이나 다음 날 도착하면 조문 오는 분들이 오가는 동안 화환이 빈소를 지켜요. 늦어도 발인 전날까지는 도착하게 보내는 게 마음이 편해요.</p>`],
      ["오늘 도착 마감 시간", `<p>평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 그보다 늦으면 다음 날 보내 드려요. 마감이 지났는데 발인이 가깝다면 주문서 대신 ${tel}으로 전화 주세요.</p>`],
      ["주문할 때 필요한 것", `<ul><li>장례식장 이름 (주소는 몰라도 돼요)</li><li>고인 성함과 상주 이름</li><li>빈소 호실 (몰라도 돼요. 사장님이 장례식장에 확인해서 보내 드려요)</li></ul><p>부고장 링크나 캡처 사진만 있다면 꽃안부 첫 화면 칸에 붙여 넣어 주세요. 고인 성함, 장례식장, 발인 시간을 읽어 주문서를 채워 드려요.</p>`],
    ],
    faq: [
      ["발인이 내일 아침이에요.", `전화(${tel})로 주문해 주세요. 발인 전에 닿도록 바로 보내 드려요.`],
      ["장례식장 빈소 호실을 몰라도 되나요?", "비워 두셔도 돼요. 사장님이 장례식장에 확인해서 보내 드려요."],
      Q_PHOTO,
    ],
    items: ["WC-01", "WC-04", "WC-02"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-price", "funeral-ribbon", "cant-attend-funeral", "business-condolence"],
  },
  {
    slug: "funeral-price", short: "근조화환 가격",
    q: "근조화환 가격은 얼마가 적당한가요?",
    title: "근조화환 가격은 얼마가 적당한가요? | 꽃안부",
    a: "근조화환은 정해진 금액이 없고, 보내는 분과 고인·유족과의 사이에 맞춰 고르면 돼요. 꽃안부 근조화환은 {{condolence:min}}부터 {{condolence:max}}까지 {{condolence:n}}가지이고, 모든 가격에 기본 배송비가 들어 있어요. 개인이 보낼 때는 기본형도 충분하고, 회사나 단체 이름으로 보낼 때는 한두 단계 큰 것을 고르기도 해요.",
    sections: [
      ["꽃안부 근조화환 가격", `<p>아래 가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역만 1만~3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요.</p>`, "condolence"],
      ["어떻게 고르면 좋을까요?", `<ul><li>개인이 마음을 전할 때: 근조 보통([[WC-01]])이나 근조 일반1호([[WC-04]])</li><li>회사·거래처·단체 이름으로 보낼 때: 근조 일반2호([[WC-05]])나 근조 스페셜([[WC-02]])</li><li>여럿이 함께 보내거나 더 크게 하고 싶을 때: 근조 특대([[WC-06]])</li></ul><p>금액보다 발인 전에 제때 도착하는 게 더 중요해요.</p>`],
    ],
    faq: [Q_FEE, Q_BILL, Q_SAME],
    items: [],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-timing", "funeral-ribbon", "business-condolence", "group-wreath"],
  },
  {
    slug: "funeral-ribbon", short: "근조화환 리본 문구",
    q: "근조화환 리본 문구는 어떻게 쓰나요?",
    title: "근조화환 리본 문구는 어떻게 쓰나요? | 꽃안부",
    a: `근조화환에는 리본이 두 줄 달려요. 한 줄에는 '${rb("삼가 故人(고인)의 冥福(명복)을 빕니다")}' 같은 위로 문구를, 다른 한 줄에는 '주식회사 ○○ 대표이사 ○○○'처럼 보내는 분 이름을 적어요. 꽃안부 주문서에서 문구를 고르거나, 받는 분과의 관계를 적으면 맞는 문구를 골라 드려요.`,
    sections: [
      ["가장 많이 쓰는 문구", `<ul>${RIBBON.funeral.formal.map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`],
      ["회사·거래처 이름으로 보낼 때", `<ul>${["謹弔 (근조)", "삼가 弔意(조의)를 표합니다", "고인의 명복을 빌며 깊은 위로를 전합니다"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`],
      ["보내는 분 이름은 이렇게 적어요", `<ul><li>주식회사 ○○ 대표이사 ○○○</li><li>○○주식회사 임직원 일동</li><li>○○팀 일동</li><li>○○고등학교 ○회 동창 일동</li><li>○○○ (개인 이름)</li></ul><p>더 많은 문구는 <a href="/ribbon/condolence">근조화환 리본 문구 모음</a>에서 눌러 복사할 수 있어요.</p>`],
    ],
    faq: [
      ["한자로 꼭 써야 하나요?", `꼭 그렇지는 않아요. '${rb("고인의 명복을 빌며 깊은 위로를 전합니다")}', '${rb("마음 깊이 애도하며 위로를 전합니다")}'처럼 한글 문구도 있어요.`],
      ["리본 문구는 어떻게 정하나요?", `주문서에서 고르거나, 받는 분과의 관계를 적으면 맞는 문구를 골라 드려요. 보내는 분 이름도 리본에 들어가요. 많이 쓰는 문구는 <a href="/ribbon/">리본 문구 모음</a>에 모아 뒀어요.`],
      ["회사 이름으로 보낼 때는 어떻게 쓰나요?", `위로 문구는 '${rb("謹弔 (근조)")}'나 '${rb("삼가 弔意(조의)를 표합니다")}'를 쓰고, 이름 줄에는 '○○주식회사 임직원 일동'이나 '주식회사 ○○ 대표이사 ○○○'처럼 적어요.`],
    ],
    items: ["WC-01", "WC-04"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-timing", "business-condolence", "group-wreath", "funeral-price"],
  },
  {
    slug: "wreath-or-money", short: "화환과 조의금",
    q: "화환과 조의금, 둘 다 해야 하나요?",
    title: "화환과 조의금, 둘 다 해야 하나요? | 꽃안부",
    a: "꼭 둘 다 해야 하는 건 아니에요. 직접 조문할 때는 조의금으로, 조문하기 어렵거나 회사·단체 이름으로 마음을 전할 때는 근조화환으로 하는 경우가 많아요. 가까운 사이라면 둘 다 하기도 하고, 어느 쪽이든 정성이 전해지면 충분해요.",
    sections: [
      ["근조화환이 잘 맞을 때", `<ul><li>멀리 있거나 일정 때문에 직접 조문하기 어려울 때</li><li>회사, 거래처, 동창회처럼 여럿의 이름으로 마음을 전할 때</li><li>빈소에 위로의 뜻이 눈에 보이게 남았으면 할 때</li></ul>`],
      ["조의금이 잘 맞을 때", `<ul><li>직접 빈소에 가서 조문할 때</li><li>유족이 화환을 받지 않겠다고 미리 알렸을 때</li></ul>`],
      ["유족이 화환을 사양했다면", `<p>부고에 화환을 정중히 사양한다는 말이 있다면 그 뜻을 따르는 게 좋아요. 꽃안부 무료 부고장에도 화환 보내기 칸이 있는데, 유족이 이 칸을 끌 수 있어요.</p>`],
    ],
    faq: [
      ["조문을 못 가는데 화환만 보내도 되나요?", "괜찮아요. 직접 가기 어려울 때 근조화환으로 마음을 전해도 돼요. 리본에 보내는 분 이름이 들어가서 유족이 누가 보냈는지 알 수 있어요."],
      ["부고장 링크만 있는데 주문할 수 있나요?", "링크나 캡처 사진을 꽃안부 첫 화면 칸에 넣으면 고인 성함, 장례식장, 발인 시간을 읽어 주문서를 채워 드려요. 채워진 내용을 한 번 보고 결제하시면 돼요."],
      Q_PHOTO,
    ],
    items: ["WC-01", "WC-04"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["cant-attend-funeral", "funeral-timing", "funeral-price", "funeral-ribbon"],
  },
  {
    slug: "girlfriend-flowers", short: "여자친구 꽃 선물",
    q: "여자친구에게 꽃 선물, 무엇을 보내면 좋을까요?",
    title: "여자친구에게 꽃 선물, 무엇을 보내면 좋을까요? | 꽃안부",
    a: "생일, 기념일, 사과, 고백처럼 마음을 전하는 날에는 손에 들기 좋은 꽃다발이 가장 무난해요. 꽃안부에서는 빨간장미 온마음([[BQ-007]]), 분홍장미 발그레([[BQ-006]]), 분홍튤립 봄마중([[BQ-004]])을 추천해요. 회사나 집으로 보낼 수 있고, 카드 문구를 넣을 수 있어요.",
    sections: [
      ["어떤 꽃다발을 고를까요?", `<ul><li>마음을 분명하게 전하고 싶을 때: 빨간장미 온마음([[BQ-007]])</li><li>부드럽고 사랑스러운 느낌: 분홍장미 발그레([[BQ-006]])</li><li>가볍게 깜짝 선물: 분홍튤립 봄마중([[BQ-004]])</li></ul><p>꽃다발은 {{bouquet:min}}부터 {{bouquet:max}}까지 {{bouquet:n}}가지가 있어요.</p>`],
      ["보내기 전에 준비할 것", `<ul><li>받는 분 이름과 연락처</li><li>받을 곳 주소 (회사나 집)</li><li>카드에 넣을 짧은 한마디</li></ul><p>도착하면 사진을 문자로 보내 드려서, 잘 받았는지 바로 알 수 있어요.</p>`],
    ],
    faq: [
      ["회사로 보내도 되나요?", "네, 회사나 집 어디로든 보낼 수 있어요. 받는 분 이름과 연락처를 적어 주세요."],
      Q_TODAY,
      Q_SAME,
    ],
    items: ["BQ-007", "BQ-006", "BQ-004"],
    cta: ["꽃다발 보러 가기", "/prices?utm_source=guide#bouquet", "bouquet"],
    related: ["birthday-flowers", "anniversary-flowers", "proposal-bouquet", "graduation-bouquet"],
  },
  {
    slug: "parents-birthday", short: "부모님 생신 꽃",
    q: "부모님 생신 꽃 선물, 무엇이 좋을까요?",
    title: "부모님 생신 꽃 선물 추천 | 무엇이 좋을까요? | 꽃안부",
    a: "부모님 생신에는 꽃병을 따로 준비하지 않아도 되는 꽃바구니가 무난해요. 꽃안부에서는 카네이션 연지곤지([[BS-013]])와 카네이션백합 꽃단장([[BS-014]])을 추천해요. 용돈을 함께 드리려면 특대 용돈바구니 복바구니([[BS-004]])나 용돈꽃다발 복주머니([[BQ-001]])를 골라요.",
    sections: [
      ["꽃바구니가 좋은 까닭", `<p>꽃바구니는 받는 분이 꽃병을 따로 준비하지 않아도 돼요. 그대로 거실이나 식탁에 두면 돼서 부모님께 드리기 편해요. 어버이날이나 환갑에도 잘 어울려요.</p>`],
      ["용돈을 함께 드리고 싶다면", `<ul><li>복바구니 (특대 용돈바구니, [[BS-004]])</li><li>복주머니 (용돈꽃다발, [[BQ-001]])</li></ul>`],
      ["리본·카드 문구 예시", `<ul>${["생신을 진심으로 축하합니다", "건강과 행복이 가득하시길", "늘 건강하시고 행복하세요", "사랑과 감사를 담아"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul><p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [
      ["멀리 사시는 부모님께도 보낼 수 있나요?", "전국으로 보내요. 거리가 먼 일부 지역은 1만 원에서 3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요."],
      Q_TODAY,
      Q_PHOTO,
    ],
    items: ["BS-013", "BS-014", "BS-004", "BQ-001"],
    cta: ["꽃바구니 보러 가기", "/prices?utm_source=guide#basket", "basket"],
    related: ["parents-70th", "birthday-flowers", "anniversary-flowers", "same-day-delivery"],
  },
  {
    slug: "opening-gift", short: "개업 선물",
    q: "개업 선물로 화환·식물·난 중 무엇이 좋을까요?",
    title: "개업 선물로 화환·식물·난 중 무엇이 좋을까요? | 꽃안부",
    a: "오래 두고 보는 선물을 원하면 관엽식물이 가장 무난해요. 개업 당일 매장 앞을 환하게 꾸며 주고 싶다면 축하화환이나 쌀화환을, 사무실이나 병원처럼 차분한 곳이라면 난도 잘 어울려요. 꽃안부 관엽식물은 금전수([[PL-003]]), 녹보수([[PL-009]]), 스투키([[PL-019]])를 추천해요.",
    sections: [
      ["한눈에 비교", `<dl class="kv cmp"><dt>관엽식물</dt><dd>매장 안에 오래 두고 봐요. {{plant:min}}부터</dd><dt>축하화환</dt><dd>개업 당일 매장 앞에 세워요. 쌀화환도 있어요. {{congrats:min}}부터</dd><dt>난</dt><dd>사무실·병원·카운터에 두기 좋아요. {{orchid:min}}부터</dd></dl>`],
      ["관엽식물", `<p>금전수([[PL-003]]부터), 녹보수([[PL-009]]부터), 스투키([[PL-019]]부터)를 추천해요. 공간이 넓다면 높이 1m가 넘는 큰 화분도 있어요.</p>`],
      ["축하화환·쌀화환", `<p>매장 앞에 세울 화환은 축하 보통([[WG-01]])이나 쌀화환 10kg([[WG-06]])을 추천해요.</p>`],
      ["리본 문구", `<ul>${["祝 開業 (축 개업)", "번창을 기원합니다", "새로운 출발을 축하합니다", "祝 發展 (축 발전)"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul><p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [Q_TODAY, Q_BILL, Q_FEE],
    items: ["PL-003", "PL-009", "PL-019", "WG-01", "WG-06"],
    cta: ["개업 화분 보러 가기", "/prices?utm_source=guide#plant", "plant"],
    related: ["opening-plant", "clinic-opening", "rice-wreath", "promotion-orchid"],
  },
  {
    slug: "promotion-orchid", short: "승진·취임 난",
    q: "승진·취임 축하 난은 어떻게 보내나요?",
    title: "승진·취임 축하 난 보내는 법 | 꽃안부",
    a: "승진·취임·영전을 축하할 때는 난을 많이 보내요. 꽃안부에서는 호접란([[OR-008]]부터)이 무난하고, 리본에는 '祝 昇進(축 승진)' 같은 축하 문구와 보내는 분의 직함·이름을 적어요. 받는 분 이름과 연락처, 회사 주소를 알면 바로 주문할 수 있어요.",
    sections: [
      ["호접란과 동양란", `<ul><li>호접란(서양란): 꽃이 크고 화사해서 축하 자리에 잘 어울려요. [[OR-008]]부터</li><li>동양란: 철골소심([[OR-003]]), 황룡금([[OR-007]]) 등. 잎이 단정해 사무실에 두기 좋아요.</li></ul><p>난은 {{orchid:min}}부터 {{orchid:max}}까지 {{orchid:n}}가지가 있어요.</p>`],
      ["리본 문구", `<ul>${["祝 昇進 (축 승진)", "祝 榮轉 (축 영전)", "祝 就任 (축 취임)", "진심으로 축하드립니다"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`],
      ["보내는 분 이름 적는 법", `<ul><li>주식회사 ○○ 대표이사 ○○○</li><li>○○팀 일동</li><li>○○○ (개인 이름)</li></ul><p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [
      ["언제 보내면 좋나요?", "소식을 들은 뒤 되도록 빨리 보내는 게 좋아요. 취임식처럼 날이 정해져 있다면 그 전에 닿게 보내요. 평일 18시, 주말 16시까지 주문하면 오늘 도착해요."],
      Q_BILL,
      Q_PHOTO,
    ],
    items: ["OR-008", "OR-009", "OR-003", "OR-007"],
    cta: ["축하 난 보러 가기", "/prices?utm_source=guide#orchid", "orchid"],
    related: ["retirement-flowers", "clinic-opening", "opening-gift", "business-condolence"],
  },
  // ── 2차(11/27): 보내는 까닭 전부 — 슬픈 날·기쁜 날·회사·가족·친구 모임 ──
  {
    slug: "same-day-delivery", short: "오늘 꽃 배달",
    q: "오늘 꽃 배달 되나요?",
    title: "오늘 꽃 배달 되나요? 당일 꽃배달 마감 시간 | 꽃안부",
    a: "네, 평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 전국으로 보내고, 가격에 기본 배송비가 들어 있어요. 마감이 지났거나 아주 급하면 1577-2286으로 전화 주세요.",
    sections: [
      ["오늘 도착 마감", `<dl class="kv cmp"><dt>평일</dt><dd>18시까지 주문하면 오늘 도착</dd><dt>주말</dt><dd>16시까지 주문하면 오늘 도착</dd><dt>그 뒤</dt><dd>다음 날 보내 드려요. 급하면 ${tel}으로 전화 주세요.</dd></dl>`],
      ["전국 어디든 보내요", `<p>상품 가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역은 1만 원에서 3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요. 일부 섬과 외진 곳은 배송이 어려워서 주문서가 먼저 알려 드려요.</p>`],
      ["도착 시간 고르기", `<p>주문서에서 받는 날짜와 도착 시간을 골라요. 당일중, 오전중, 오후중, 정확한 시각 가운데 고를 수 있어요. 근조화환은 지금 빈소로, 결혼식 축하화환은 예식 1시간 전에 닿도록 잡혀요.</p>`],
    ],
    faq: [
      ["전국 어디든 보내 주나요?", "전국으로 보내요. 일부 섬과 외진 곳은 배송이 어려워서, 주소를 넣으면 주문서가 먼저 알려 드려요."],
      Q_FEE,
      Q_PHOTO,
    ],
    items: ["WC-01", "WG-01", "BQ-004", "BS-001"],
    cta: ["지금 주문하기", `/?${UTM}`, "condolence"],
    related: ["funeral-timing", "birthday-flowers", "opening-plant", "wedding-wreath"],
  },
  {
    slug: "opening-plant", short: "개업 화분",
    q: "개업 화분, 어떤 게 좋아요?",
    title: "개업 화분 추천 | 화환과 무엇이 다른가요? | 꽃안부",
    a: "개업 화분은 매장 안에 오래 두는 선물이라 금전수([[PL-003]]부터), 녹보수([[PL-009]]부터), 스투키([[PL-019]]부터) 같은 관엽식물이 무난해요. 개업 당일 매장 앞을 환하게 꾸미는 건 축하화환이고, 오래 남는 건 화분이에요. 거래처 개업이라면 높이 1m가 넘는 큰 화분에 회사 이름을 리본으로 달아 보내기도 해요.",
    who: [
      ["가족", "매장 안에 두기 좋은 금전수나 스투키. 리본 오른쪽에 '" + rb("번창을 기원합니다") + "'."],
      ["친구·모임", "크지 않은 화분이 부담이 없어요. 여럿이 모았다면 리본 왼쪽에 '○○ 친구 일동'처럼 적어요."],
      ["회사·거래처", "큰 화분이나 축하화환. 리본 오른쪽에 '" + rb("祝 開業 (축 개업)") + "'이나 '" + rb("祝 發展 (축 발전)") + "', 왼쪽에 '주식회사 ○○ 대표이사 ○○○'. 계산서를 받을 수 있어요."],
    ],
    sections: [
      ["화분과 화환, 무엇이 다른가요?", `<dl class="kv cmp"><dt>관엽 화분</dt><dd>매장 안에 오래 두고 봐요. {{plant:min}}부터</dd><dt>축하화환</dt><dd>개업 날 매장 앞에 세워요. {{congrats:min}}부터</dd><dt>난</dt><dd>카운터나 사무실에 두기 좋아요. {{orchid:min}}부터</dd></dl>`],
      ["크기로 고르기", `<ul><li>카운터·선반에 두는 작은 화분: 금전수([[PL-003]]), 녹보수([[PL-009]]), 스투키([[PL-019]])</li><li>바닥에 세우는 큰 화분(높이 약 1m 넘음): 녹보수 150cm([[PL-010]]), 파키라 150cm([[PL-040]]), 해피트리 160cm([[PL-042]])</li></ul><p>관엽식물은 {{plant:min}}부터 {{plant:max}}까지 {{plant:n}}가지가 있어요.</p>`],
      ["리본 문구", `${rbl(["祝 開業 (축 개업)", "祝 發展 (축 발전)", "번창을 기원합니다", "새로운 출발을 축하합니다"])}<p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [Q_DATE, Q_BILL, Q_RIBBON_SIDE],
    items: ["PL-003", "PL-009", "PL-019", "PL-010", "PL-042"],
    cta: ["개업 화분 보러 가기", "/prices?utm_source=guide#plant", "plant"],
    related: ["opening-gift", "clinic-opening", "rice-wreath", "group-wreath"],
  },
  {
    slug: "wedding-wreath", short: "결혼식 화환",
    q: "결혼식 화환은 언제, 어디로 보내나요?",
    title: "결혼식 화환 언제·어디로 보내나요? 신랑측·신부측 문구 | 꽃안부",
    a: "결혼식 축하화환은 예식장으로 보내고, 예식 1시간 전에 도착하게 잡아요. 꽃안부 주문서에 예식장과 예식 시간을 넣으면 도착 시간이 그렇게 잡혀요. 리본은 신랑 쪽이면 '祝 結婚(축 결혼)', 신부 쪽이면 '祝 華婚(축 화혼)'을 많이 써요.",
    who: [
      ["가족·친지", "리본 오른쪽에 '" + rb("祝 結婚 (축 결혼)") + "'(신랑 쪽) 또는 '" + rb("祝 華婚 (축 화혼)") + "'(신부 쪽), 왼쪽에 보내는 분 이름."],
      ["친구·모임", "'" + rb("결혼을 진심으로 축하합니다") + "'처럼 한글 문구도 좋아요. 왼쪽에 '신랑 친구 일동'이나 '○○고등학교 ○회 동창 일동'."],
      ["회사·거래처", "'" + rb("祝 結婚 (축 결혼)") + "'이나 '" + rb("새로운 출발을 진심으로 축하합니다") + "', 왼쪽에 '주식회사 ○○ 대표이사 ○○○'이나 '○○팀 일동'."],
    ],
    sections: [
      ["언제 도착하나요?", `<p>예식 1시간 전에 도착하게 잡아요. 주문서에 예식 날짜와 시간을 넣으면 자동으로 맞춰져요. 청첩장 링크나 캡처를 첫 화면 칸에 넣으면 두 분 이름, 예식장, 예식 시간을 읽어 주문서를 채워 드려요.</p>`],
      ["어디로 보내나요?", `<p>예식장으로 보내요. 홀 이름을 알면 적어 주세요. 일부 예식장은 쌀화환만 받거나 그곳에서 파는 쌀화환만 받아요. 그런 곳이면 주문서가 알려 드리고, 담당자가 따로 연락드려요.</p>`],
      ["축하화환 가격", `<p>모든 가격에 기본 배송비가 들어 있어요.</p>`, "congrats"],
    ],
    faq: [
      ["신랑 쪽과 신부 쪽 문구가 다른가요?", "신랑 쪽에 보내면 祝 結婚(축 결혼), 신부 쪽에 보내면 祝 華婚(축 화혼)을 많이 써요. 꽃안부 주문서에서 신랑 측·신부 측을 고르면 맞춰 바꿔 드려요."],
      Q_RIBBON_SIDE,
      Q_PHOTO,
    ],
    items: [],
    cta: ["결혼 축하화환 보내기", `/?worder=wedding&${UTM}`, "congrats"],
    related: ["rice-wreath", "group-wreath", "business-condolence", "same-day-delivery"],
  },
  {
    slug: "rice-wreath", short: "쌀화환",
    q: "쌀화환은 무엇이고 언제 보내나요?",
    title: "쌀화환은 무엇이고 언제 보내나요? | 꽃안부",
    a: "쌀화환은 축하화환에 쌀을 함께 올려 보내는 화환이에요. 행사가 끝나면 쌀은 혼주나 상주께 전해져요. 꽃안부 축하 쌀화환 10kg은 [[WG-06]]이고, 결혼식이나 개업처럼 축하 자리에 보내요.",
    sections: [
      ["언제 보내나요?", `<p>결혼식장이나 개업한 곳처럼 축하화환을 보내는 자리에 보내요. 리본도 축하화환처럼 왼쪽에 보내는 분, 오른쪽에 인사 문구가 들어가요.</p>`],
      ["쌀화환만 받는 곳도 있어요", `<p>일부 예식장, 성당, 장례식장은 쌀화환만 받거나 그곳에서 파는 쌀화환만 받아요. 그런 곳으로 보내면 주문서가 알려 드리고, 담당자가 따로 연락드려요. 장례식장에 쌀화환을 보내고 싶다면 ${tel}으로 먼저 물어봐 주세요.</p>`],
      ["리본 문구", `${rbl(["祝 結婚 (축 결혼)", "祝 華婚 (축 화혼)", "祝 開業 (축 개업)", "축하합니다"])}`],
    ],
    faq: [
      ["쌀은 얼마나 들어가나요?", "꽃안부 축하 쌀화환은 쌀 10kg짜리예요([[WG-06]])."],
      Q_DATE,
      Q_BILL,
    ],
    items: ["WG-06", "WG-01", "WG-03"],
    cta: ["쌀화환 주문하기", order("WG-06"), "congrats"],
    related: ["wedding-wreath", "opening-plant", "opening-gift", "group-wreath"],
  },
  {
    slug: "graduation-bouquet", short: "졸업식 꽃다발",
    q: "졸업식 꽃다발은 언제 주문하나요?",
    title: "졸업식 꽃다발 언제 주문하나요? | 꽃안부",
    a: "졸업식 꽃다발은 졸업식 날짜가 정해지면 미리 주문하고, 받는 날짜를 졸업식 날이나 그 전날로 골라 두면 마음이 편해요. 졸업식이 몰리는 1~2월에는 며칠 일찍 주문하는 게 좋아요. 꽃안부 꽃다발은 {{bouquet:min}}부터이고, 평일 18시·주말 16시까지 주문하면 오늘 도착해요.",
    who: [
      ["가족", "손에 들고 사진 찍기 좋은 꽃다발. 카드에 " + card("졸업 축하해. 그동안 정말 애썼어.")],
      ["연인", "분홍장미 발그레나 빨간장미 온마음. 카드에 " + card("졸업 축하해. 앞으로도 곁에서 응원할게.")],
      ["친구·모임", "부담 없는 분홍튤립 봄마중이나 거베라 다발."],
    ],
    sections: [
      ["어디로 받나요?", `<p>졸업식장은 사람이 많아 받는 분을 찾기 어려울 수 있어요. 집으로 미리 받아 들고 가거나, 받는 분 연락처를 꼭 적어 주세요.</p>`],
      ["받는 날짜와 시간 고르기", `<p>주문서에서 받는 날짜와 도착 시간(오전중, 오후중, 정확한 시각)을 고를 수 있어요. 졸업식 날 아침에 들고 가려면 전날 받는 것도 방법이에요.</p>`],
    ],
    faq: [Q_DATE, Q_CARD, Q_SAME],
    items: ["BQ-004", "BQ-002", "BQ-005", "BQ-006", "BQ-007"],
    cta: ["꽃다발 보러 가기", "/prices?utm_source=guide#bouquet", "bouquet"],
    related: ["birthday-flowers", "girlfriend-flowers", "same-day-delivery", "parents-birthday"],
  },
  {
    slug: "birthday-flowers", short: "생일 꽃 배달",
    q: "생일 꽃 배달, 무엇을 보낼까요?",
    title: "생일 꽃 배달, 무엇을 보낼까요? 꽃다발·꽃바구니 추천 | 꽃안부",
    a: "손에 들려 드리고 싶으면 꽃다발, 받는 곳에 그대로 두게 하려면 꽃바구니가 좋아요. 연인에게는 장미 꽃다발, 부모님께는 카네이션 꽃바구니, 친구·동료에게는 꽃바구니 고마움([[BS-001]])이나 해바라기 햇살가득([[BS-008]])을 추천해요. 꽃다발과 꽃바구니에는 메시지 카드를 무료로 넣어 드려요.",
    who: [
      ["가족", "꽃병이 필요 없는 꽃바구니. 카네이션 연지곤지([[BS-013]]). 리본·카드에 '" + rb("생신을 진심으로 축하합니다") + "'."],
      ["연인", "빨간장미 온마음([[BQ-007]])이나 분홍장미 발그레([[BQ-006]]). 카드에 " + card("생일 축하해. 사랑해.")],
      ["친구·모임", "고마움([[BS-001]])이나 햇살가득([[BS-008]]). 카드에 " + card("생일 축하해요. 늘 건강하고 행복하세요.")],
      ["회사·거래처", "직원이나 거래처 담당자에게는 꽃바구니. 자주 보내는 회사는 거래처로 등록하면 직원 생일 꽃을 명단으로 맡길 수 있어요(" + tel + ")."],
    ],
    sections: [
      ["꽃다발과 꽃바구니", `<dl class="kv cmp"><dt>꽃다발</dt><dd>손에 들려 드리기 좋아요. {{bouquet:min}}부터</dd><dt>꽃바구니</dt><dd>꽃병 없이 그대로 둬요. {{basket:min}}부터</dd></dl>`],
      ["생일 당일에 맞추기", `<p>받는 날짜와 도착 시간을 고를 수 있어요. 오늘 받으려면 평일 18시, 주말 16시까지 주문해 주세요. 도착하면 사진을 문자로 보내 드려요.</p>`],
    ],
    faq: [Q_CARD, Q_TODAY, Q_SAME],
    items: ["BQ-007", "BQ-006", "BS-013", "BS-001", "BS-008"],
    cta: ["생일 꽃 고르기", "/prices?utm_source=guide#basket", "bouquet"],
    related: ["girlfriend-flowers", "parents-birthday", "anniversary-flowers", "same-day-delivery"],
  },
  {
    slug: "anniversary-flowers", short: "기념일 꽃",
    q: "결혼기념일·100일 꽃 선물, 무엇이 좋을까요?",
    title: "결혼기념일·100일 꽃 선물 추천 | 꽃안부",
    a: "결혼기념일이나 100일처럼 둘만의 날에는 장미 꽃다발이 가장 무난해요. 꽃안부에서는 빨간장미 온마음([[BQ-007]])과 분홍장미 발그레([[BQ-006]])를 추천하고, 집에 오래 두고 보려면 홍백장미 꽃바구니 도란도란([[BS-015]])도 좋아요. 받는 날짜와 시간을 기념일에 맞춰 고를 수 있어요.",
    who: [
      ["연인", "100일·1주년에는 분홍장미 발그레나 빨간장미 온마음. 카드에 " + card("우리 100일 축하해. 고마워.")],
      ["가족", "결혼기념일에는 배우자에게 꽃바구니 도란도란([[BS-015]])이나 함박웃음([[BS-005]]). 부모님 결혼기념일에는 자녀 이름으로 꽃바구니를 보내기도 해요. 카드에 " + card("결혼기념일 축하드려요. 늘 건강하세요.")],
    ],
    sections: [
      ["날짜와 시간 맞추기", `<p>주문서에서 받는 날짜와 도착 시간을 골라요. 회사로 보낸다면 근무 시간 안에, 집으로 보낸다면 받는 분이 집에 있는 시간으로 골라요. 오늘 받으려면 평일 18시, 주말 16시까지 주문해 주세요.</p>`],
      ["색으로 고르고 싶다면", `<p>주문서 '사장님께 부탁' 칸에 '분홍 위주로'처럼 적어 주세요.</p>`],
    ],
    faq: [Q_CARD, Q_DATE, Q_PHOTO],
    items: ["BQ-007", "BQ-006", "BS-015", "BS-005"],
    cta: ["꽃다발 보러 가기", "/prices?utm_source=guide#bouquet", "bouquet"],
    related: ["proposal-bouquet", "girlfriend-flowers", "birthday-flowers", "same-day-delivery"],
  },
  {
    slug: "proposal-bouquet", short: "프로포즈 꽃다발",
    q: "프로포즈 꽃다발은 어떻게 고르나요?",
    title: "프로포즈 꽃다발 고르기 | 꽃안부",
    a: "프로포즈에는 마음을 분명하게 전하는 빨간장미 꽃다발이 가장 무난해요. 꽃안부에서는 빨간장미 온마음([[BQ-007]])을 추천하고, 부드러운 느낌을 원하면 분홍장미 발그레([[BQ-006]])나 수국장미 뭉게구름([[BQ-011]])도 좋아요. 직접 건네려면 받을 곳을 본인 주소로 하고 도착 시간을 넉넉히 앞당겨 잡으세요.",
    who: [
      ["연인", "빨간장미 온마음([[BQ-007]]). 카드에 " + card("앞으로의 모든 날을 함께하고 싶어요.")],
    ],
    sections: [
      ["직접 건네고 싶다면", `<p>받을 곳을 본인 집이나 회사로 하고, 프로포즈 전에 넉넉히 받을 수 있게 도착 시간을 골라요. 식당이나 카페로 받으려면 그곳에 미리 말해 두세요.</p>`],
      ["꽃다발이 도착하게 하고 싶다면", `<p>받는 분 이름과 연락처, 주소를 적고 도착 시간을 정확한 시각으로 골라요. 도착하면 사진을 문자로 보내 드려요.</p>`],
    ],
    faq: [Q_DATE, Q_CARD, Q_SAME],
    items: ["BQ-007", "BQ-006", "BQ-011"],
    cta: ["꽃다발 보러 가기", "/prices?utm_source=guide#bouquet", "bouquet"],
    related: ["anniversary-flowers", "girlfriend-flowers", "birthday-flowers", "same-day-delivery"],
  },
  {
    slug: "parents-70th", short: "칠순·환갑 꽃",
    q: "칠순·환갑에는 어떤 꽃을 보내나요?",
    title: "칠순·환갑 꽃바구니와 용돈 꽃다발 | 꽃안부",
    a: "칠순이나 환갑에는 잔치 자리나 집에 그대로 둘 수 있는 꽃바구니가 무난해요. 크게 하고 싶으면 큰바구니 함박웃음([[BS-005]])이나 꽃잔치([[BS-006]])를, 용돈을 함께 드리려면 특대 용돈바구니 복바구니([[BS-004]])나 용돈꽃다발 복주머니([[BQ-001]])를 골라요. 리본이나 카드에는 '생신을 진심으로 축하합니다' 같은 문구를 적어요.",
    who: [
      ["가족", "자녀들 이름으로 큰바구니나 복바구니. 리본에 '" + rb("생신을 진심으로 축하합니다") + "'이나 '" + rb("늘 건강하시고 행복하세요") + "', 왼쪽에 '자녀 일동'처럼 적어요."],
      ["친구·모임", "친구 부모님 칠순에는 꽃바구니 연지곤지([[BS-013]])나 꽃단장([[BS-014]]). 리본에 '" + rb("건강과 행복이 가득하시길") + "'."],
      ["회사·거래처", "임직원 부모님 칠순에 회사 이름으로 꽃바구니를 보내기도 해요. 계산서를 받을 수 있어요."],
    ],
    sections: [
      ["용돈을 함께 드리려면", `<ul><li>복바구니 (특대 용돈바구니, [[BS-004]])</li><li>복주머니 (용돈꽃다발, [[BQ-001]])</li></ul>`],
      ["잔치 자리로 보내려면", `<p>식당이나 행사장 이름과 주소, 잔치 시간을 적어 주세요. 받는 날짜와 도착 시간을 고를 수 있어요.</p>`],
      ["리본·카드 문구", `${rbl(["생신을 진심으로 축하합니다", "건강과 행복이 가득하시길", "늘 건강하시고 행복하세요", "사랑과 감사를 담아"])}<p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [Q_DATE, Q_CARD, Q_FEE],
    items: ["BS-005", "BS-006", "BS-004", "BQ-001", "BS-013"],
    cta: ["꽃바구니 보러 가기", "/prices?utm_source=guide#basket", "basket"],
    related: ["parents-birthday", "birthday-flowers", "group-wreath", "retirement-flowers"],
  },
  {
    slug: "retirement-flowers", short: "퇴임 꽃",
    q: "정년퇴임·퇴임 꽃 선물은 무엇이 좋을까요?",
    title: "정년퇴임·퇴임 꽃 선물 추천 | 꽃다발·난·꽃바구니 | 꽃안부",
    a: "퇴임식에서 직접 건넬 거라면 꽃다발, 사무실로 보낼 거라면 난, 댁으로 보낼 거라면 꽃바구니가 무난해요. 꽃안부 꽃다발은 {{bouquet:min}}부터, 난은 {{orchid:min}}부터, 꽃바구니는 {{basket:min}}부터예요. 리본이나 카드에는 '진심으로 축하드립니다', '늘 건강하시고 행복하세요' 같은 문구를 적어요.",
    who: [
      ["가족", "퇴임하는 부모님께는 댁으로 큰 꽃바구니. 카드에 " + card("그동안 정말 수고 많으셨어요. 사랑해요.")],
      ["회사·거래처", "퇴임식장이나 사무실로 난. 리본 오른쪽에 '" + rb("진심으로 축하드립니다") + "', 왼쪽에 '○○팀 일동'이나 '주식회사 ○○ 대표이사 ○○○'. 계산서를 받을 수 있어요."],
      ["친구·모임", "동기들이 모아 꽃다발이나 꽃바구니. 카드에 " + card("그동안 수고 많으셨습니다. 늘 건강하세요.")],
    ],
    sections: [
      ["무엇을 고를까요?", `<dl class="kv cmp"><dt>꽃다발</dt><dd>퇴임식에서 직접 건넬 때</dd><dt>난</dt><dd>사무실이나 퇴임식장으로 보낼 때</dd><dt>꽃바구니</dt><dd>댁으로 보낼 때</dd></dl>`],
      ["리본 문구", rbl(["진심으로 축하드립니다", "늘 건강하시고 행복하세요", "사랑과 감사를 담아", "늘 꽃길만 걸으시길 바랍니다"])],
    ],
    faq: [Q_BILL, Q_DATE, Q_RIBBON_SIDE],
    items: ["BQ-011", "BQ-007", "OR-008", "OR-007", "BS-005"],
    cta: ["축하 난 보러 가기", "/prices?utm_source=guide#orchid", "orchid"],
    related: ["promotion-orchid", "group-wreath", "parents-70th", "business-condolence"],
  },
  {
    slug: "clinic-opening", short: "병원 개원·사무실 이전",
    q: "병원 개원·사무실 이전 선물은 무엇이 좋을까요?",
    title: "병원 개원·사무실 이전 선물 추천 | 꽃안부",
    a: "병원 개원이나 사무실 이전에는 오래 두고 보는 관엽식물이나 난이 무난해요. 로비나 대기실에는 해피트리([[PL-042]])나 파키라([[PL-040]]) 같은 큰 화분을, 진료실이나 카운터에는 호접란([[OR-008]]부터)이나 스투키([[PL-019]])가 어울려요. 리본에는 '祝 發展(축 발전)'이나 '새로운 출발을 축하합니다'가 잘 어울리고, 오른쪽 문구는 직접 적어도 돼요.",
    who: [
      ["가족·친구", "작은 화분이나 호접란. 리본에 '" + rb("새로운 출발을 축하합니다") + "'."],
      ["회사·거래처", "큰 화분이나 난에 '" + rb("祝 發展 (축 발전)") + "'이나 '" + rb("번창을 기원합니다") + "', 왼쪽에 '주식회사 ○○ 대표이사 ○○○'. 계산서를 받을 수 있어요."],
    ],
    sections: [
      ["놓을 자리로 고르기", `<ul><li>로비·대기실 바닥: 해피트리 160cm([[PL-042]]), 파키라 150cm([[PL-040]]), 녹보수 150cm([[PL-010]])</li><li>카운터·진료실: 호접란([[OR-008]]), 스투키([[PL-019]]), 금전수([[PL-003]])</li></ul>`],
      ["리본 문구", `${rbl(["祝 發展 (축 발전)", "번창을 기원합니다", "새로운 출발을 축하합니다", "祝 開業 (축 개업)"])}<p>리본 오른쪽 문구는 주문서에서 직접 고쳐 적을 수 있어요.</p>`],
    ],
    faq: [Q_BILL, Q_DATE, Q_RIBBON_SIDE],
    items: ["PL-042", "PL-040", "PL-010", "OR-008", "PL-019"],
    cta: ["관엽식물 보러 가기", "/prices?utm_source=guide#plant", "plant"],
    related: ["opening-plant", "opening-gift", "promotion-orchid", "business-condolence"],
  },
  {
    slug: "hospital-visit", short: "병문안 꽃",
    q: "병문안 꽃, 보내도 되나요?",
    title: "병문안 꽃, 보내도 되나요? | 꽃안부",
    a: "생화를 병실에 들이지 못하게 하는 병원이 있어서, 보내기 전에 병원에 먼저 확인하는 게 좋아요. 받을 수 있다면 향이 약한 꽃바구니가 무난하고, 주문서 '사장님께 부탁' 칸에 '향이 약한 꽃으로'라고 적어 주세요. 병원에서 받기 어렵다면 퇴원한 뒤 댁으로 보내는 방법도 있어요.",
    who: [
      ["가족·친구", "작은 꽃바구니. 카드에 '빠른 쾌유를 빕니다.'처럼 짧게."],
      ["회사·거래처", "직원이나 거래처 분 병문안에는 꽃바구니를 회사 이름으로. 카드에 " + card("빠른 쾌유를 빕니다. ○○팀 일동")],
    ],
    sections: [
      ["보내기 전에 확인할 것", `<ul><li>그 병원이 생화를 받는지 (병원에 먼저 물어보세요)</li><li>입원한 병동과 호실, 받는 분 이름과 연락처</li></ul>`],
      ["어떤 꽃이 좋나요?", `<p>꽃병 없이 그대로 둘 수 있는 꽃바구니가 편해요. 꽃바구니는 {{basket:min}}부터예요.</p>`],
    ],
    faq: [Q_CARD, Q_TODAY, Q_PHOTO],
    items: ["BS-003", "BS-009", "BS-012"],
    cta: ["꽃바구니 보러 가기", "/prices?utm_source=guide#basket", "basket"],
    related: ["birth-congrats", "birthday-flowers", "same-day-delivery", "parents-birthday"],
  },
  {
    slug: "birth-congrats", short: "출산 축하 꽃",
    q: "출산 축하 꽃은 어떻게 보내나요?",
    title: "출산 축하 꽃 선물 | 꽃안부",
    a: "출산 축하 꽃은 꽃병 없이 그대로 둘 수 있는 꽃바구니가 무난해요. 산부인과나 산후조리원은 생화를 받지 않는 곳이 있으니 먼저 확인하고, 어렵다면 집으로 돌아간 뒤에 보내요. 꽃안부 꽃바구니는 {{basket:min}}부터이고, 메시지 카드를 무료로 넣어 드려요.",
    who: [
      ["가족", "꽃바구니 봄소풍([[BS-003]])이나 버들강아지([[BS-012]]). 카드에 " + card("우리 집에 온 아기를 환영해요. 고생 많았어요.")],
      ["친구·모임", "친구들이 모아 꽃바구니를. 카드에 " + card("출산 축하해. 푹 쉬고 몸조리 잘해.")],
      ["회사·거래처", "직원 출산에 회사 이름으로 꽃바구니. 카드에 " + card("출산을 진심으로 축하드립니다. ○○팀 일동")],
    ],
    sections: [
      ["보내기 전에 확인할 것", `<ul><li>산부인과·산후조리원이 생화를 받는지</li><li>받는 분 이름과 연락처, 받을 곳 주소</li></ul><p>향이 걱정되면 주문서 '사장님께 부탁' 칸에 '향이 약한 꽃으로'라고 적어 주세요.</p>`],
    ],
    faq: [Q_CARD, Q_DATE, Q_SAME],
    items: ["BS-003", "BS-012", "BS-009", "BQ-010"],
    cta: ["꽃바구니 보러 가기", "/prices?utm_source=guide#basket", "basket"],
    related: ["hospital-visit", "birthday-flowers", "group-wreath", "same-day-delivery"],
  },
  {
    slug: "business-condolence", short: "회사 이름 근조화환",
    q: "거래처·회사 이름으로 근조화환은 어떻게 보내나요?",
    title: "거래처·회사 이름으로 근조화환 보내기 | 리본 표기·계산서 | 꽃안부",
    a: "리본 왼쪽에 '주식회사 ○○ 대표이사 ○○○'나 '○○주식회사 임직원 일동'처럼 회사 이름을, 오른쪽에 '謹弔(근조)'나 '삼가 弔意(조의)를 표합니다' 같은 문구를 적어 보내요. 꽃안부 주문서에서 법인·단체를 펼쳐 사업자 정보를 넣으면 계산서를 발행해 드려요. 자주 보내는 회사는 후불과 월 정산 거래처로 등록할 수 있어요.",
    who: [
      ["회사 대표 이름", "왼쪽: '주식회사 ○○ 대표이사 ○○○'. 오른쪽: '" + rb("謹弔 (근조)") + "'."],
      ["임직원 모두", "왼쪽: '○○주식회사 임직원 일동'. 오른쪽: '" + rb("삼가 弔意(조의)를 표합니다") + "'."],
      ["부서·팀", "왼쪽: '○○팀 일동'. 오른쪽: '" + rb("고인의 명복을 빌며 깊은 위로를 전합니다") + "'."],
    ],
    sections: [
      ["계산서와 정산", `<ul><li>주문서에서 법인·단체를 펼쳐 사업자 정보를 넣으면 계산서를 발행해 드려요.</li><li>자주 보내는 회사는 후불과 월 정산 거래처로 등록할 수 있어요(${tel}).</li></ul>`],
      ["주문할 때 필요한 것", `<p>장례식장 이름, 고인 성함, 상주 이름이면 돼요. 빈소 호실은 몰라도 돼요. 사장님이 장례식장에 확인해서 보내 드려요. 부고장 링크나 캡처를 첫 화면 칸에 넣으면 주문서를 채워 드려요.</p>`],
      ["근조화환 가격", `<p>모든 가격에 기본 배송비가 들어 있어요.</p>`, "condolence"],
    ],
    faq: [
      Q_BILL,
      ["리본 문구를 같이 정해 줄 수 있나요?", `주문서에 '직장 상사 어머님 상'처럼 어떤 사이인지 적으면 문구를 골라 드려요. 고민되시면 ${tel}으로 전화 주세요. 같이 정해 드려요.`],
      ["발인이 내일 아침이에요.", `전화(${tel})로 주문해 주세요. 발인 전에 닿도록 바로 보내 드려요.`],
    ],
    items: [],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-ribbon", "funeral-price", "group-wreath", "cant-attend-funeral"],
  },
  {
    slug: "group-wreath", short: "여럿이 모아 보내는 화환",
    q: "친구·동기들이 돈을 모아 화환을 보낼 때는 어떻게 하나요?",
    title: "친구·동기들이 돈 모아 화환 보내기 | 리본 '○○ 일동' 쓰는 법 | 꽃안부",
    a: "여럿이 돈을 모았다면 한 분이 대표로 주문하고, 리본 왼쪽에 '○○고등학교 ○회 동창 일동'이나 '○○ 동기 일동'처럼 모임 이름을 적어요. 결제는 대표 한 분이 하고, 모은 돈은 그분께 따로 보내 주시면 돼요. 장례식장에는 근조화환, 결혼식장과 개업한 곳에는 축하화환을 보내요.",
    who: [
      ["친구 부모님 상", "근조화환. 왼쪽 '○○고등학교 ○회 동창 일동', 오른쪽 '" + rb("삼가 故人(고인)의 冥福(명복)을 빕니다") + "'."],
      ["친구 결혼", "축하화환. 왼쪽 '신랑 친구 일동', 오른쪽 '" + rb("결혼을 진심으로 축하합니다") + "'."],
      ["친구 개업", "축하화환이나 화분. 왼쪽 '○○ 동기 일동', 오른쪽 '" + rb("번창을 기원합니다") + "'."],
      ["회사 동료", "왼쪽 '○○팀 일동'. 회사 돈으로 보낸다면 계산서를 받을 수 있어요."],
    ],
    sections: [
      ["리본 이름 이렇게 적어요", `<ul><li>○○고등학교 ○회 동창 일동</li><li>○○대학교 ○○과 ○○학번 동기 일동</li><li>○○팀 일동</li><li>신랑 친구 일동</li></ul><p>이름을 다 적고 싶다면 리본 왼쪽에 직접 적어도 돼요. 고민되면 ${tel}으로 물어봐 주세요.</p>`],
      ["누가 주문하나요?", `<p>대표 한 분이 주문하고 결제해요. 회원가입 없이 주문할 수 있어서, 처음 쓰는 분도 바로 주문할 수 있어요. 도착하면 사진을 문자로 보내 드리니, 그 사진을 단톡방에 올려 모두에게 알리면 돼요.</p>`],
    ],
    faq: [Q_SPLIT, Q_RIBBON_SIDE, Q_PHOTO],
    items: ["WC-01", "WC-04", "WG-01", "WG-03"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["cant-attend-funeral", "wedding-wreath", "funeral-ribbon", "opening-plant"],
  },
  {
    slug: "cant-attend-funeral", short: "조문을 못 갈 때",
    q: "조문을 못 갈 때는 어떻게 하나요?",
    title: "조문을 못 갈 때 어떻게 하나요? 화환·조의금·위로 문자 | 꽃안부",
    a: "직접 조문하기 어렵다면 근조화환을 보내 마음을 전할 수 있어요. 발인 전에 빈소에 닿게 보내야 하고, 꽃안부는 평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 부고에 조의금 계좌가 있다면 조의금을 보내고, 상주께 짧은 위로 문자를 함께 드리면 좋아요.",
    sections: [
      ["근조화환 보내기", `<p>장례식장 이름, 고인 성함, 상주 이름이면 돼요. 부고장 링크나 캡처를 꽃안부 첫 화면 칸에 넣으면 주문서를 채워 드려요. 리본 왼쪽에 보내는 분 이름이 들어가서 유족이 누가 보냈는지 알 수 있어요.</p>`],
      ["위로 문자 예시", `<ul><li>${card("삼가 고인의 명복을 빕니다. 직접 찾아뵙지 못해 죄송합니다.")}</li><li>${card("깊은 위로의 마음을 전합니다. 힘든 시간 잘 보내시길 바랍니다.")}</li></ul>`],
      ["발인이 가까울 때", `<p>발인이 끝나면 화환을 받을 수 없어요. 발인이 내일 아침이라면 주문서 대신 ${tel}으로 전화 주세요. 발인 전에 닿도록 바로 보내 드려요.</p>`],
    ],
    faq: [
      ["조문을 못 가는데 화환만 보내도 되나요?", "괜찮아요. 직접 가기 어려울 때 근조화환으로 마음을 전해도 돼요. 리본에 보내는 분 이름이 들어가서 유족이 누가 보냈는지 알 수 있어요."],
      ["장례식장 빈소 호실을 몰라도 되나요?", "비워 두셔도 돼요. 사장님이 장례식장에 확인해서 보내 드려요."],
      Q_PHOTO,
    ],
    items: ["WC-01", "WC-04", "WC-02"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["wreath-or-money", "funeral-timing", "group-wreath", "business-condolence"],
  },
];

// 첫 화면 묶음. 한 질문이 여러 묶음에 들어가도 된다.
export const GROUPS = [
  ["슬픈 날", ["funeral-timing", "funeral-price", "funeral-ribbon", "wreath-or-money", "cant-attend-funeral", "hospital-visit"]],
  ["기쁜 날", ["same-day-delivery", "wedding-wreath", "rice-wreath", "graduation-bouquet", "birth-congrats", "opening-plant", "opening-gift"]],
  ["회사·거래처", ["business-condolence", "opening-plant", "clinic-opening", "promotion-orchid", "retirement-flowers"]],
  ["가족·연인", ["parents-birthday", "parents-70th", "birthday-flowers", "anniversary-flowers", "proposal-bouquet", "girlfriend-flowers"]],
  ["친구·모임", ["group-wreath", "birthday-flowers", "graduation-bouquet", "wedding-wreath"]],
];

const CSS = `:root{--paper:#fff;--bg:#f7f6f2;--ink:#1f1d18;--soft:#5a564d;--faint:#8a857a;--line:#e4e1d8;--accent:#1f4733}
@media (prefers-color-scheme:dark){:root{--paper:#202124;--bg:#17181a;--ink:#eceae4;--soft:#c4c0b6;--faint:#a5a197;--line:#2c2d30;--accent:#7fc29b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;word-break:keep-all;overflow-wrap:anywhere}
a{color:var(--accent)}.w{max-width:720px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:14px}.top a{text-decoration:none;font-weight:700}
h1{margin:18px 0 6px;font-size:25px;line-height:1.35}.lead{margin:0;color:var(--soft)}
.box{margin-top:16px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.kv{display:grid;grid-template-columns:76px 1fr;gap:6px 10px;margin:0;font-size:15px}.kv dt{color:var(--faint)}.kv dd{margin:0}
h2{margin:28px 0 2px;font-size:19px}.cd{margin:0 0 8px;color:var(--soft);font-size:14px}
ul.it{list-style:none;margin:8px 0 0;padding:0;border-top:1px solid var(--line)}
ul.it li{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
ul.it img{width:64px;height:64px;border-radius:10px;object-fit:cover;background:#eee;flex:0 0 auto;display:block}
ul.it .nm{flex:1;min-width:0}ul.it .nm b{display:block;font-size:15px;font-weight:600}ul.it .nm span{font-size:16px;font-weight:800}
ul.it .buy{flex:0 0 auto;padding:9px 14px;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:700;text-decoration:none}
.qa{margin-top:10px}.qa h3{font-size:17px;margin:18px 0 4px}.qa p{margin:0;color:var(--soft)}
.go{display:block;margin-top:22px;padding:15px;border-radius:14px;background:var(--accent);color:#fff;text-align:center;font-size:16px;font-weight:800;text-decoration:none}
.foot{margin-top:30px;font-size:13px;color:var(--faint)}.nw{white-space:nowrap}
.by{margin:4px 0 0;font-size:13px;color:var(--faint)}
.ans{margin-top:14px;font-size:17px;line-height:1.75}.ans p{margin:0}
.sec p{margin:6px 0 0;color:var(--soft)}.sec ul{margin:6px 0 0;padding-left:20px;color:var(--soft)}.sec li{margin:2px 0}
.cmp{grid-template-columns:84px 1fr;margin-top:8px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.cmp dt{color:var(--ink);font-weight:700}
ul.gl{list-style:none;margin:8px 0 0;padding:0;border-top:1px solid var(--line)}ul.gl li{padding:14px 0;border-bottom:1px solid var(--line)}
ul.gl a{display:block;font-size:17px;font-weight:700;text-decoration:none}ul.gl p{margin:4px 0 0;color:var(--soft);font-size:15px}
.rel{margin-top:26px;font-size:15px}.rel a{display:block;padding:6px 0}
.wh{grid-template-columns:96px 1fr;gap:10px 12px}.wh dd{color:var(--soft)}.sec small{color:var(--faint)}
.top1{margin-top:16px}.top1 a{display:block;padding:14px 16px;border-radius:14px;background:var(--paper);border:1px solid var(--line);text-decoration:none;font-weight:700;font-size:17px}.top1 span{display:block;margin-top:2px;color:var(--soft);font-weight:400;font-size:15px}
h2.gh{margin:30px 0 0}`;

const SHOP_LINE = "꽃안부 · 주식회사 아마존 · 대표 권점숙 · 사업자등록번호 234-86-00344 · 통신판매업 제2026-경기시흥-1357호 · 경기 시흥시 신천3길 23, 103호 · 1577-2286 · amazonflower@naver.com";
const topBar = `<div class="top"><a href="/">꽃안부</a><a href="tel:1577-2286">전화 1577-2286</a></div>`;
const byline = `<p class="by">꽃안부 · 1993년부터 경기 시흥 꽃집 · <time datetime="${UPDATED}">${UPDATED}</time> 확인</p>`;
const foot = (more) => `<p class="foot">${more}<br>${esc(SHOP_LINE)}</p>`;

function head(title, desc, canon, extra) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="꽃안부">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}">
<meta property="og:image" content="${BASE}/og_preview.png">
<meta property="article:modified_time" content="${UPDATED}">
<meta name="theme-color" content="#1f4733">
<link rel="icon" href="/favicon.ico">
<style>${CSS}</style>
${extra}
<script src="/va.js?v=20261025a" defer></script>
</head>`;
}

const itemRow = (p) => `<li>${p.photos && p.photos[0] ? `<a href="/catalog.html?item=${encodeURIComponent(p.pc)}"><img src="${esc(p.photos[0])}" alt="${esc(label(p))}" loading="lazy" width="64" height="64"></a>` : ""}<div class="nm"><b><a href="/catalog.html?item=${encodeURIComponent(p.pc)}" style="color:inherit;text-decoration:none">${esc(label(p))}</a></b><span>${won(p.price)}</span></div><a class="buy" href="${esc(order(p.pc))}">주문</a></li>`;
const itemList = (list) => (list.length ? `<ul class="it">${list.map(itemRow).join("")}</ul>` : "");
const crumbs = (extra) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "꽃안부", item: BASE + "/" },
  { "@type": "ListItem", position: 2, name: "꽃 선물 묻고 답하기", item: BASE + "/guide/" },
  ...(extra ? [{ "@type": "ListItem", position: 3, name: extra[0], item: extra[1] }] : []) ] });

export function guideHtml(g) {
  const url = `${BASE}/guide/${g.slug}`;
  const answer = plain(g.a);
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", url, inLanguage: "ko", dateModified: UPDATED,
    publisher: { "@type": "Florist", "@id": BASE + "/#shop", name: "꽃안부" },
    mainEntity: [[g.q, g.a], ...g.faq].map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) };
  const sections = g.sections.map(([h, body, cat]) => `<section class="sec"><h2>${esc(h)}</h2>${fill(body)}${cat ? itemList(byCat(cat)) : ""}</section>`).join("\n");
  const picks = g.items.length ? `<section class="sec"><h2>꽃안부에서 고르기</h2><p>사진을 누르면 크게 보이고, 주문을 누르면 그 상품으로 주문서가 열려요.</p>${itemList(g.items.map(prod))}</section>` : "";
  const rel = g.related.map((s) => { const x = GUIDES.find((y) => y.slug === s); if (!x) throw new Error(`${g.slug}: 없는 질문 ${s}`); return `<a href="/guide/${x.slug}">${esc(x.q)}</a>`; }).join("");
  const who = g.who ? `<section class="sec"><h2>누구에게 보내나요</h2><dl class="kv cmp wh">${g.who.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${fill(v)}</dd>`).join("")}</dl></section>` : "";
  const from = byCat(g.cta[2])[0];
  return head(g.title, answer, url, ld(faq) + "\n" + ld(crumbs([g.q, url]))) + `
<body><div class="w">
${topBar}
<h1>${esc(g.q)}</h1>
${byline}
<div class="box ans"><p>${fill(g.a)}</p></div>
${who}
${sections}
${picks}
<section class="qa"><h2>더 궁금한 것</h2>${g.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${fill(a)}</p>`).join("\n")}</section>
<a class="go" href="${esc(g.cta[1])}">${esc(g.cta[0])}${from ? ` · ${won(from.price)}부터` : ""}</a>
<div class="rel"><b>이어서 보면 좋은 질문</b>${rel}</div>
${foot(`<a href="/guide/">꽃 선물 묻고 답하기</a> · <a href="/prices">전체 상품 가격</a> · <a href="/faq">자주 묻는 것</a> · <a href="/ribbon/">리본 문구 모음</a>`)}
</div></body></html>
`;
}

export function guideIndexHtml() {
  const url = `${BASE}/guide/`;
  const title = "꽃 선물 묻고 답하기 | 근조화환·개업 화분·결혼식 화환·생일 꽃 | 꽃안부";
  const desc = "근조화환·장례식장 화환부터 개업 화분, 결혼식 화환, 생일·기념일·졸업식 꽃다발, 칠순 꽃바구니, 승진·퇴임 난, 친구들이 모아 보내는 화환까지 꽃 보낼 때 자주 묻는 질문에 짧게 답했어요.";
  for (const [, l] of GROUPS) for (const s of l) if (!GUIDES.some((g) => g.slug === s)) throw new Error("묶음에 없는 질문 " + s);
  for (const g of GUIDES) if (!GROUPS.some(([, l]) => l.includes(g.slug))) throw new Error("어느 묶음에도 없는 질문 " + g.slug);
  const first = (g) => esc(plain(g.a).split(/(?<=요\.)\s/)[0]);
  const list = { "@context": "https://schema.org", "@type": "ItemList", name: "꽃 선물 묻고 답하기", numberOfItems: GUIDES.length,
    itemListElement: GUIDES.map((g, i) => ({ "@type": "ListItem", position: i + 1, name: g.q, url: `${BASE}/guide/${g.slug}` })) };
  const sd = GUIDES.find((g) => g.slug === "same-day-delivery");
  return head(title, desc, url, ld(list) + "\n" + ld(crumbs())) + `
<body><div class="w">
${topBar}
<h1>꽃 선물 묻고 답하기</h1>
${byline}
<p class="lead" style="margin-top:10px">슬픈 날, 기쁜 날, 회사 일로, 가족과 친구에게. 꽃을 보낼 때 많이 묻는 질문에 짧게 답했어요. 더 궁금한 건 ${tel}으로 전화 주세요.</p>
<div class="top1"><a href="/guide/${sd.slug}">${esc(sd.q)}<span>${first(sd)}</span></a></div>
${GROUPS.map(([name, l]) => `<h2 class="gh">${esc(name)}</h2><ul class="gl">${l.map((s) => GUIDES.find((g) => g.slug === s)).map((g) => `<li><a href="/guide/${g.slug}">${esc(g.q)}</a><p>${first(g)}</p></li>`).join("")}</ul>`).join("\n")}
<a class="go" href="/prices">전체 상품 가격 보기</a>
${foot(`<a href="/">처음으로</a> · <a href="/faq">자주 묻는 것</a> · <a href="/ribbon/">리본 문구 모음</a> · <a href="/funeral/">전국 장례식장 근조화환</a>`)}
</div></body></html>
`;
}

export function buildGuide() {
  const out = { "guide/index.html": guideIndexHtml() };
  for (const g of GUIDES) out[`guide/${g.slug}.html`] = guideHtml(g);
  fs.mkdirSync(path.join(ROOT, "guide"), { recursive: true });
  for (const [f, s] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, f), s);
  return Object.keys(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("묻고 답하기 페이지 생성 → " + buildGuide().join(", "));
}
