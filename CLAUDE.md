# 꽃안부 (amazonflower) — 작업 규칙

- **작업 종료 시 자동으로 `main`에 commit+push**한다(확인 없이). GitHub: `HG0516/amazonflower`.
- **배포**: `main` 에 push 하면 Vercel 이 자동 배포한다(1~3분, 2026-11-24 확인). `npx vercel --prod` 는 이 맥에 Vercel 로그인이 없어 안 된다.
- 수정 끝나면 배포 후 라이브 사이트를 열어 확인한다.
