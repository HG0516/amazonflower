// 청첩장 자동읽기 주간 점검(10/28). 업체마다 대표 링크 하나를 실제 사이트(/api/parse-url)에 넣어
// 이름·날짜·예식장이 다 나오는지 본다. 하나라도 비면 exit 1 → GitHub 가 실패 메일을 보내고,
// 서버도 같은 링크를 "자동읽기 못 함"으로 텔레그램에 알린다(api/parse-url.js notifyMiss).
// 업체가 사이트를 바꾸면 여기서 먼저 깨진다. 새 업체를 맞추면 LINKS 에 한 줄 더한다.
// 실행: node scripts/check-invite-links.mjs [https://floweranbu.co.kr]
const BASE = process.argv[2] || process.env.CHECK_BASE || "https://floweranbu.co.kr";

export const LINKS = [
  ["데어무드", "https://theirmood.com/card/1x4ImI5tyA"],
  ["바른손 M카드", "https://barunsonmcard.com/preview/15"],
  ["바른손 레터비", "https://letterb.barunsoncard.com/sample-Classic-Frame"],
  ["보자기카드", "https://bojagicard.com/sample201"],
  ["보자기카드 미리보기", "https://bojagicard.com/mcard/popup.php?ecard=sample201"],
  ["살롱드레터", "https://salondeletter.com/w/sample1_2"],
  ["메리필름", "https://meri.kr/demo"],
  ["몽글", "https://monggeul.com/demo/classic-white"],
  ["링크메리", "https://www.linkmarry.com/sample"],
  ["비비드보우즈", "https://vividvows.co.kr/card/sample-1"],
  ["달팽(옛 보안 서버)", "https://dalpeng.com/tulip"],
  ["직접 만든 청첩장(스크립트)", "https://bong-yul-invitation.netlify.app/"],
  ["직접 만든 청첩장(github.io)", "https://strutive07.github.io/"],
];

async function one([name, url]) {
  try {
    const r = await fetch(`${BASE}/api/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => ({}));
    const x = j.result || {};
    const miss = [!x.recipientName && "이름", !x.date && "날짜", !x.venueName && "예식장"].filter(Boolean);
    if (!r.ok || !j.ok) return { name, url, bad: `실패 ${r.status} ${j.error || ""}`.trim() };
    return { name, url, bad: miss.length ? `빈 칸: ${miss.join("·")}` : "", got: `${x.recipientName} / ${x.date} ${x.time || ""} / ${x.venueName}` };
  } catch (e) {
    return { name, url, bad: `오류 ${e.message}` };
  }
}

const rows = [];
for (const l of LINKS) rows.push(await one(l));   // 한 번에 몰지 않게 하나씩
for (const r of rows) console.log(`${r.bad ? "✗" : "✓"} ${r.name}: ${r.bad || r.got}${r.bad ? `\n    ${r.url}` : ""}`);
const bad = rows.filter((r) => r.bad);
console.log(`\n${rows.length - bad.length}/${rows.length} 통과`);
process.exit(bad.length ? 1 : 0);
