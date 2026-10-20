// 홈 시작 칸 검색 규칙(10/20, home-search.js) — docs/시안/홈검색-2026-10/검색규칙.html 의 예시 표 그대로.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../products.js", import.meta.url), "utf8"), ctx);
vm.runInNewContext(fs.readFileSync(new URL("../home-search.js", import.meta.url), "utf8"), ctx);
const S = ctx.window.AF_SEARCH;
const P = ctx.window.PRODUCTS;

test("링크: 글과 섞여 있어도 첫 링크만 뽑는다", () => {
  assert.equal(S.extractUrl("[부고] 故 홍길동님께서 별세하셨기에 알려드립니다. https://bugo.example.com/a/123?x=1 삼가 고인의 명복을"), "https://bugo.example.com/a/123?x=1");
  assert.equal(S.extractUrl("청첩장 보내요 (https://m.wedding.example/abc)."), "https://m.wedding.example/abc");
  assert.equal(S.extractUrl("어머니 칠순"), "");
  assert.equal(S.analyze("모바일 청첩장 https://m.card.example/x 입니다", P).kind, "link");
});

test("가격 읽기", () => {
  const p = (t) => { const r = S.parsePrice(t); return r && [r.min, r.max]; };
  assert.deepEqual(p("꽃다발 5만원"), [50000, 59999]);
  assert.deepEqual(p("5만원대"), [50000, 59999]);
  assert.deepEqual(p("화환 10만원"), [100000, 149999]);
  assert.deepEqual(p("50000"), [50000, 59999]);
  assert.deepEqual(p("5,0000원"), [50000, 59999]);
  assert.deepEqual(p("7만원 이하"), [0, 70000]);
  assert.deepEqual(p("7만 미만"), [0, 69999]);
  assert.deepEqual(p("10만원 이상"), [100000, 0]);
  assert.deepEqual(p("5~7만"), [50000, 70000]);
  assert.deepEqual(p("5만에서 7만"), [50000, 70000]);
  assert.equal(S.parsePrice("3월 5일 오후 2시"), null);
  assert.equal(S.parsePrice("어머니 칠순"), null);
});

test("판단 순서: 예시 표", () => {
  const a = (t) => JSON.parse(JSON.stringify(S.analyze(t, P)));   // vm 안 배열은 다른 realm 이라 값으로 바꿔 비교
  assert.equal(a("").kind, "empty");
  assert.deepEqual([a("꽃다발").kind, a("꽃다발").cats.join()], ["product", "bouquet"]);
  const b = a("꽃다발 5만원");
  assert.deepEqual([b.kind, b.cats.join(), b.min, b.max], ["product", "bouquet", 50000, 59999]);
  assert.deepEqual(a("화환 10만원").cats.sort(), ["condolence", "congrats"]);
  assert.deepEqual(a("근조화환").cats, ["condolence"]);
  assert.deepEqual([a("7만원 이하").kind, a("7만원 이하").max], ["product", 70000]);
  assert.deepEqual(a("개업 화분").cats, ["plant"]);
  assert.equal(a("부고").kind, "occasion");
  assert.equal(a("어머니 칠순").kind, "occasion");
  assert.equal(a("거래처 개업").kind, "occasion");
  assert.equal(a("꽃다빌").kind, "other");
  assert.equal(a("봄마중").kind, "product");
  // 링크 없는 부고 문자는 사연으로(이름·날짜 속 숫자·글자를 상품으로 읽지 않는다)
  assert.equal(a("[부고] 故 홍길동님 별세 발인 3월 5일 오전 7시 서울성모병원 장례식장 1호실").kind, "occasion");
});

test("상품 맞추기: 싼 순서, 가격 없으면 가까운 것", () => {
  const m = S.match(S.analyze("꽃다발 5만원", P), P);
  assert.ok(m.items.length > 0 && !m.near);
  assert.ok(m.items.every((p) => p.cat === "bouquet" && p.price >= 50000 && p.price <= 59999));
  for (let i = 1; i < m.items.length; i++) assert.ok(m.items[i - 1].price <= m.items[i].price);
  const near = S.match(S.analyze("꽃다발 1만원", P), P);
  assert.equal(near.near, true);
  assert.equal(near.items.length, 3);
  const band = S.match(S.analyze("꽃다발", P), P, "7만대");
  assert.ok(band.items.every((p) => p.band === "7만대" && p.cat === "bouquet"));
});

test("전체상품 주소와 제목", () => {
  const b = S.analyze("꽃다발 5만원", P);
  assert.equal(S.catalogUrl(b), "/catalog.html?cats=bouquet&min=50000&max=59999");
  assert.equal(S.catalogUrl(b, "7만대"), "/catalog.html?cats=bouquet&band=" + encodeURIComponent("7만대"));
  assert.equal(S.catalogUrl(S.analyze("꽃다빌", P)), "/catalog.html?q=" + encodeURIComponent("꽃다빌"));
  assert.equal(S.label(b), "꽃다발 · 5만원대");
  assert.equal(S.label(S.analyze("화환 10만원", P)), "화환 · 10만원대");
  assert.equal(S.label(S.analyze("7만원 이하", P)), "7만원 이하");
});
