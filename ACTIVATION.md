# 꽃안부 앱 — 활성화 체크리스트

기능별 코드와 SQL을 같은 단계 순서로 반영해야 합니다. **운영 결제 중에는 순서를 바꾸지 마세요.**
(키·비밀값은 절대 이 레포(공개)에 넣지 말고 Supabase/Vercel 대시보드에만 넣으세요.)

---

## 0. 1차 안전 묶음 (운영 결제·환불·배송사진)

1. Supabase SQL Editor에서 **`supabase-first-bundle.sql`** 전체 실행
2. Vercel Production 환경변수에 `.env.example`의 1차 묶음 항목 설정
   - 첫 배포는 `PAYMENT_INTENTS_REQUIRED=0`, `ADMIN_AUTH_MODE=dual`
   - 문자 계정 준비 전에는 `PHOTO_NOTICE_MODE=manual`
3. 새 코드 배포 후 보호된 결제 대사 endpoint를 1회 실행하고 성공 heartbeat 확인
4. **`supabase-first-bundle-activate.sql`** 실행 → 5~10분 후
   `first_bundle_readiness()`의 `active_ready=true` 확인
5. 배포 전에 열려 있던 결제창의 최대 유효시간(2시간)이 지난 뒤
   `PAYMENT_INTENTS_REQUIRED=1`로 전환
6. 사장님 Supabase 로그인과 UID allowlist를 확인한 뒤 `ADMIN_AUTH_MODE=jwt`로 전환
7. `node scripts/audit-first-bundle.mjs`가 exit 0인지 최종 확인

> 환불은 꽃안부 관리자 화면에서 시작해야 outbox·발주중지·자동복구가 함께 기록됩니다.
> 토스 상점관리자에서 바로 취소하는 것은 관리 화면이 **수동 취소 확인**을 안내한 건에만 사용하세요.

---

## 1. 로그인 — Supabase → Authentication → Providers
각 provider 키는 해당 개발자센터에서 발급 (자세한 절차는 [SETUP-AUTH.md](SETUP-AUTH.md)).
공통 콜백: `https://ivlfwlbwiijhmwsfljzz.supabase.co/auth/v1/callback`

- [ ] **카카오** (무료): 토글 ON + REST API 키 + Client Secret → Save
- [ ] **구글** (무료): 토글 ON + Client ID + Client Secret → Save
- [ ] **애플** (선택, Apple Developer $99/년): 토글 ON + Service ID/Key → Save
- [ ] **네이버** (무료, 아래 4·5번): Supabase 설정 아님 — 백엔드로 처리

## 2. DB — Supabase → SQL Editor
- [ ] **`supabase-auth.sql` 전체 RUN** — orders.user_id + RLS, ordered_at, completed_photo/at,
      비공개 버킷 order-photos, anniversaries, push_subscriptions 까지 한 번에.

## 3. URL Configuration — Supabase → Authentication → URL Configuration
- [ ] **Site URL**: `https://floweranbu.co.kr`
- [ ] **Redirect URLs** 추가: `https://floweranbu.co.kr`, `https://floweranbu.co.kr/**`

## 4. Vercel 환경변수 — Settings → Environment Variables
- [ ] `VAPID_PRIVATE_KEY` = (별도 전달한 private 키 — 기념일 푸시 서명용)
- [ ] `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` = (네이버 로그인 쓸 때)
- (기존 유지: `ANTHROPIC_API_KEY`, `TOSS_SECRET_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `CRON_SECRET`, `TELEGRAM_*`, `OWNER_PHONE_*`)

## 5. 네이버 로그인 (선택) — developers.naver.com
- [ ] 애플리케이션 등록 → 사용 API: **네이버 로그인** (이메일·이름 동의)
- [ ] **Callback URL**: `https://floweranbu.co.kr/api/naver-callback`
- [ ] Client ID/Secret → 위 4번 Vercel 환경변수에

## 6. 기념일 푸시 자동 발송 — Supabase → SQL Editor
- [ ] Database → Extensions 에서 **pg_cron, pg_net 활성화**
- [ ] **`supabase-cron.sql`** 의 `<CRON_SECRET>` 을 실제 값으로 바꿔 RUN
      (기존 check-deadlines cron 도 같은 방식)

---

## 확인 (위 완료 후)
- 좌상단 **로그인** → 카카오/네이버/구글 → `🌸 이름` 으로 바뀜
- **내 주문** 목록 · **다시 주문**(원탭 재주문) · **🎂 기념일** 등록 · **🔔 알림 켜기**
- 사장님: 텔레그램 주문 알림의 **[발주 완료]** · **[완료사진]** 버튼
- 손님: 배송 후 **내 주문에 완료사진** 표시

> ⚠️ `amazonflower` 레포는 **PUBLIC 유지 필수** (Vercel 무료플랜은 private 배포 차단).
> 기획서·키는 절대 이 레포에 두지 마세요.
