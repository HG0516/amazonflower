# 꽃안부 앱 — 활성화 체크리스트

코드는 전부 배포돼 있습니다. **아래만 하면 모든 기능이 동작합니다.**
(키·비밀값은 절대 이 레포(공개)에 넣지 말고 Supabase/Vercel 대시보드에만 넣으세요.)

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
- [ ] **Site URL**: `https://amazonflower.vercel.app`
- [ ] **Redirect URLs** 추가: `https://amazonflower.vercel.app`, `https://amazonflower.vercel.app/**`

## 4. Vercel 환경변수 — Settings → Environment Variables
- [ ] `VAPID_PRIVATE_KEY` = (별도 전달한 private 키 — 기념일 푸시 서명용)
- [ ] `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` = (네이버 로그인 쓸 때)
- (기존 유지: `ANTHROPIC_API_KEY`, `TOSS_SECRET_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `CRON_SECRET`, `TELEGRAM_*`, `OWNER_PHONE_*`)

## 5. 네이버 로그인 (선택) — developers.naver.com
- [ ] 애플리케이션 등록 → 사용 API: **네이버 로그인** (이메일·이름 동의)
- [ ] **Callback URL**: `https://amazonflower.vercel.app/api/naver-callback`
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
