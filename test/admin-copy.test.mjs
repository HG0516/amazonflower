// 관리 화면 '발주 복사'(admin-orders.html afOrderText): 협력 꽃집에 넘길 글에 금액·주문자 번호가 빠지고 순서가 맞는지.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../admin-orders.html", import.meta.url), "utf8");
const body = html.split("// AF_ORDER_TEXT_START")[1].split("// AF_ORDER_TEXT_END")[0];
const SLOT = html.match(/const SLOT_LABEL = (\{[^}]*\});/)[1];
const afOrderText = new Function(`const SLOT_LABEL=${SLOT};${body}; return afOrderText;`)();

test("결혼 축하화환: 엄마가 보내던 순서, 금액·주문자 번호 없음", () => {
  const txt = afOrderText({
    product_label: "축하 보통", amount: 49000, order_type: "wedding",
    recipient_name: "노○○(노○○)", event_date: "2026-11-07", event_time: "11:00", delivery_time_slot: "custom",
    venue: "그랜드 인터컨티넨탈 서울 파르나스 5층 그랜드 볼룸", address: "서울 강남구 테헤란로 521",
    sender_name: "보내는분", sender_phone: "010-0000-0000",
    ribbon: "○○화재 ○○○ 지점장 / 결혼을 진심으로 축하합니다", note: "[예식 12:00]",
  });
  assert.equal(txt, [
    "축하 보통",
    "11월 7일(토) 11:00까지 · 예식 12:00",
    "받는 분ㆍ노○○(노○○)",
    "장소ㆍ그랜드 인터컨티넨탈 서울 파르나스 5층 그랜드 볼룸",
    "주소ㆍ서울 강남구 테헤란로 521",
    "리본ㆍ결혼을 진심으로 축하합니다",
    "보내는 분ㆍ○○화재 ○○○ 지점장",
  ].join("\n"));
  assert.ok(!/49,000|010-0000/.test(txt));
});

test("근조: 고인, 당일중, 요청은 그대로, 예전 우편번호는 뺀다", () => {
  const txt = afOrderText({
    product_label: "근조 특대", order_type: "funeral", recipient_name: "김○○",
    event_date: "2026-10-30", delivery_time_slot: "today", event_time: "",
    venue: "○○장례식장 301호", address: "[12345] 경북 문경시 당교3길 25",
    ribbon: "(주)○○ 대표 ○○○ / 삼가 故人(고인)의 冥福(명복)을 빕니다", note: "[발인 10/31 07:00] 빈소 확인 부탁",
  });
  assert.match(txt, /^근조 특대\n10월 30일\(금\) 당일중 · 발인 10\/31 07:00\n고인ㆍ김○○\n/);
  assert.match(txt, /주소ㆍ경북 문경시 당교3길 25/);
  assert.match(txt, /요청ㆍ빈소 확인 부탁$/);
});

test("상주와 원문 링크(10/29): 메모 표시에서 꺼내 줄로, 링크는 맨 끝", () => {
  const txt = afOrderText({
    product_label: "근조 보통", order_type: "funeral", recipient_name: "손○○",
    event_date: "2026-10-27", event_time: "당일중",
    venue: "문경제일병원장례식장 301호", address: "경북 문경시 당교3길 25",
    ribbon: "(주)○○시스템 ○○○ / 삼가 故人(고인)의 冥福(명복)을 빕니다",
    note: "[발인 10/29 06:00] [상주 아들 손○○] [원문 https://www.wooribugo4.com/page/funeral/view.php?uri=AbC==] 빈소 확인",
  });
  assert.equal(txt, [
    "근조 보통",
    "10월 27일(화) 당일중 · 발인 10/29 06:00",
    "고인ㆍ손○○",
    "상주ㆍ아들 손○○",
    "장소ㆍ문경제일병원장례식장 301호",
    "주소ㆍ경북 문경시 당교3길 25",
    "리본ㆍ삼가 故人(고인)의 冥福(명복)을 빕니다",
    "보내는 분ㆍ(주)○○시스템 ○○○",
    "요청ㆍ빈소 확인",
    "부고장ㆍhttps://www.wooribugo4.com/page/funeral/view.php?uri=AbC==",
  ].join("\n"));
});
