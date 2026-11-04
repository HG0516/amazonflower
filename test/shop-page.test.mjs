// 꽃집 페이지 1단계(/f/<slug>, f.html + data/shops/*.json) — 서버·DB 없이 파일로만.
//  - 가게 파일: 이름·주소(slug) 규칙, 사진 파일이 실제로 있는지, 카톡 링크는 pf.kakao.com 만
//  - 검색에 안 잡히게: robots.txt 에 /f/ 막음 + noindex
//  - 화환 버튼은 꽃안부 주문으로 가고 유입 꼬리표(utm_source=shop)를 단다. 꽃집 꽃값은 받지 않는다(결제 코드 없음)
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const shopsDir = path.join(root, "data/shops");

test("가게 파일 형식", () => {
  const files = fs.readdirSync(shopsDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1);
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(shopsDir, f), "utf8"));
    assert.equal(s.slug + ".json", f, "파일 이름 = slug");
    assert.match(s.slug, /^[a-z0-9-]{1,40}$/);
    assert.ok(s.name && s.name.length <= 30, "가게 이름");
    if (s.kakao) assert.match(s.kakao, /^https:\/\/pf\.kakao\.com\/[A-Za-z0-9_]+(\/chat)?$/);
    const imgs = [s.hero, ...(s.menu || []).map((m) => m.img)].filter(Boolean);
    for (const img of imgs) {
      assert.ok(img.startsWith("/"), "사진은 / 로 시작");
      assert.ok(fs.existsSync(path.join(root, decodeURIComponent(img))), "사진 없음: " + img);
    }
    const catIds = new Set((s.cats || []).map((c) => c.id));
    for (const m of s.menu || []) assert.ok(catIds.has(m.cat), "메뉴 종류가 cats 에 없음: " + m.name);
  }
});

test("주소 규칙과 검색 막기", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.ok(v.rewrites.some((r) => r.source === "/f/:slug" && r.destination === "/f.html"));
  const robots = read("robots.txt");
  const star = robots.split(/\n\s*\n/).find((b) => b.includes("User-agent: *"));
  assert.ok(star.includes("Disallow: /f/"), "검색 로봇 규칙에 /f/ 막기");
  assert.match(read("f.html"), /<meta name="robots" content="noindex,nofollow">/);
});

test("화환은 꽃안부 주문 + 유입 꼬리표, 꽃값 결제 없음", () => {
  const h = read("f.html");
  assert.match(h, /utm_source=shop&utm_medium=page&utm_campaign=/);
  assert.match(h, /\/\?worder=funeral&amp;/);
  assert.doesNotMatch(h, /tosspayments|requestPayment|confirm-payment/i);
  // 사용자 입력·가게 파일 값은 esc() 를 거쳐 넣는다
  assert.match(h, /var esc=function/);
});
