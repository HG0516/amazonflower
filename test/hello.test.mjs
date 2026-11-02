// 꽃 인사: 링크 미리보기(lib/hello.mjs)의 꽃·인사 목록이 화면(hello.html)과 같아야 한다.
// 다르면 카톡 미리보기와 열어 본 카드의 꽃·문구가 어긋난다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { FLOWERS, SEASONS, SITS, helloView, renderHelloOg } from "../lib/hello.mjs";

const html = fs.readFileSync(new URL("../hello.html", import.meta.url), "utf8");
const block = html.slice(html.indexOf("var FLOWERS="), html.indexOf("var SERIF="));
const page = {};
vm.runInNewContext(block + ";out.FLOWERS=FLOWERS;out.SEASONS=SEASONS;out.SITS=SITS;", { out: page });

test("꽃·계절·상황 목록이 hello.html 과 같다", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(page.FLOWERS)), FLOWERS);
  assert.deepEqual(JSON.parse(JSON.stringify(page.SEASONS)), SEASONS);
  assert.deepEqual(JSON.parse(JSON.stringify(page.SITS)), SITS);
});

test("미리보기 제목에 보낸 분 이름, 설명에 한마디와 그날 꽃", () => {
  const v = helloView({ s: "fun", m: "엄마 사랑해요", n: "막내", d: "20261101" });
  assert.equal(v.title, "막내님이 꽃 인사를 보냈어요");
  assert.match(v.desc, /엄마 사랑해요/);
  assert.equal(v.flower.key, "orchid");
  assert.equal(helloView({ s: "daily", d: "20261103" }).title, "꽃 인사가 도착했어요");
  assert.equal(helloView({ s: "thanks", g: "0", d: "20261103" }).line, "늘 고맙습니다");
});

test("봇은 og 만 받고 사람은 /hello.html 로 넘어간다, 글은 이스케이프", () => {
  const q = { s: "daily", n: "<b>x</b>", d: "20261103" };
  const bot = renderHelloOg(q, "?s=daily&d=20261103", true);
  assert.match(bot, /og:image" content="https:\/\/floweranbu\.co\.kr\/photos\/hello\/\w+\.jpg"/);
  assert.doesNotMatch(bot, /location\.replace/);
  assert.doesNotMatch(bot, /<b>x<\/b>/);
  const human = renderHelloOg(q, "?s=daily&d=20261103", false);
  assert.match(human, /location\.replace\("\/hello\.html\?s=daily&d=20261103"\+location\.hash\)/);
});
