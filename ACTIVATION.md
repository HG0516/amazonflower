# 꽃안부 앱 — 활성화 체크리스트

기능별 코드와 SQL을 같은 단계 순서로 반영해야 합니다. **운영 결제 중에는 순서를 바꾸지 마세요.**
(키·비밀값은 절대 이 레포(공개)에 넣지 말고 Supabase/Vercel 대시보드에만 넣으세요.)

---

## 0. 1차 안전 묶음 (운영 결제·환불·배송사진)

1. Supabase SQL Editor에서 **`supabase-first-bundle.sql`** 전체 실행
2. Vercel Production 환경변수에 `.env.example`의 1차 묶음 항목 설정
   - 첫 배포는 `PAYMENT_INTENTS_REQUIRED=0`, `ADMIN_AUTH_MODE=dual`
   - ~~문자 계정 준비 전에는 `PHOTO_NOTICE_MODE=manual`~~ → 10/7부터 **안 넣어도 됨**: 문자 키가 없으면 자동으로 직접 전달(사장님 텔레그램에 손님 링크)
3. 새 코드 배포 후 보호된 결제 대사 endpoint를 1회 실행하고 성공 heartbeat 확인
4. **`supabase-first-bundle-activate.sql`** 실행 → 5~10분 후
   `first_bundle_readiness()`의 `active_ready=true` 확인
5. 배포 전에 열려 있던 결제창의 최대 유효시간(2시간)이 지난 뒤
   `PAYMENT_INTENTS_REQUIRED=1`로 전환
6. 사장님 Supabase 로그인과 UID allowlist를 확인한 뒤 `ADMIN_AUTH_MODE=jwt`로 전환
   - 10/7 확인: 관리자 화면(admin-auth.js)은 이미 네이버 로그인만 쓰고 비밀번호를 안 보낸다 → **바로 jwt + `ADMIN_PASSWORD` 삭제 가능**.
     목록(ADMIN_OWNER_IDS 등)이 비어 있으면 lib/admin-auth.mjs 의 기본 대표 계정(형구 네이버)이 대표 관리자.
     ADMIN_OWNER_IDS 를 넣을 땐 **형구 UID 도 꼭 함께**(넣는 순간 기본 계정이 빠진다) — UID 는 /admin-setup.html 에서 복사.
7. `node scripts/audit-first-bundle.mjs`가 exit 0인지 최종 확인

> 환불은 꽃안부 관리자 화면에서 시작해야 outbox·발주중지·자동복구가 함께 기록됩니다.
> 토스 상점관리자에서 바로 취소하는 것은 관리 화면이 **수동 취소 확인**을 안내한 건에만 사용하세요.

> **설정 점검 화면**(10/7): https://floweranbu.co.kr/admin-setup.html (대표 관리자) — 키·스위치가 들어갔는지 '있다/없다'만,
> 문자 시험 발송 버튼, 내 계정 UID 복사. 밖에서 보는 확인: `GET /api/order-meta?setup=1`(손님 기능 켜짐만).
> 환경변수를 바꾼 뒤에는 **Redeploy** 해야 반영된다.

---

## 0-2. 무통장입금·가상계좌 (2026-10-04 코드 배포, 스위치는 꺼진 채)

**0번(1차 안전 묶음 SQL)이 먼저다.** 그게 없으면 관리자 주문 목록부터 안 열린다.

1. Supabase SQL Editor 에서 **`supabase-deposit-orders.sql`** 전체 실행 → 맨 아래 `deposit_ready=true`
2. **무통장입금 켜기**: Vercel Production 환경변수 `BANK_TRANSFER_ENABLED=1` → Redeploy
   - 10/5부터 **SQL 없이도 동작**(lib/schema-compat 대비책 + 주문번호 AFB 로 식별). 1번 SQL 은 가상계좌·결제수단 표시용.
   - 주문서 결제 단계에 '무통장입금'이 나타난다. 주문은 '입금 대기'로 들어오고, 사장님이
     통장 확인 후 주문 관리에서 **💰 입금 확인**을 누르면 접수로 넘어간다.
   - 24시간 지나도 입금 확인이 안 되면 사장님 텔레그램에 한 번 알림(자동으로 닫지 않음).
3. **가상계좌 켜기** — 순서 중요:
   1. 토스 개발자센터 → 웹훅 → **라이브 상점(MID)** 선택 → 추가
      URL `https://floweranbu.co.kr/api/confirm-payment?hook=deposit`, 이벤트 **DEPOSIT_CALLBACK** 만
   2. (권장) 테스트 상점에서 먼저: Vercel Preview 에 테스트 키 + `VIRTUAL_ACCOUNT_ENABLED=1`,
      개발자센터 테스트 거래내역의 **입금처리** 버튼으로 웹훅까지 확인
   3. Vercel Production `VIRTUAL_ACCOUNT_ENABLED=1` → Redeploy
   4. 라이브 1,000원 맞춤 결제 링크로 가상계좌 발급 → 실제 입금 → '입금 확인' 텔레그램 확인
      → 환불은 **토스 상점관리자**에서(손님 환불 계좌 필요, 사이트 '결제취소'는 가상계좌를 막아둠)
4. 끄기: 환경변수를 지우고 Redeploy. 이미 발급된 가상계좌의 입금은 스위치와 무관하게 계속 처리된다.

## 0-3. 실시간 계좌이체 (2026-10-05 코드 배포, 스위치는 꺼진 채)

SQL 필요 없음. 승인되면 바로 결제 완료(DONE)라 카드와 같은 길로 '접수'된다(입금 대기 없음).

1. 토스 상점관리자 → 이용정보 → 결제·부가서비스 에서 **계좌이체**가 '사용'인지 확인
   (계약이 안 돼 있으면 결제창이 열리지 않는다 — 토스 1544-7772).
2. Vercel Production 환경변수 `TRANSFER_ENABLED=1` → Redeploy
   - 주문서 결제 단계와 맞춤 결제 링크에 '실시간 계좌이체'가 나타나고, 상품 화면 결제수단 칩에 '계좌이체'가 붙는다.
3. 라이브 1,000원 맞춤 결제 링크로 계좌이체 → 완료 화면 '현금영수증' 버튼 확인 → 환불
   (0번 SQL 적용 전엔 토스 상점관리자에서, 적용 뒤엔 사이트 '결제취소'로).
- **에스크로(구매안전)**: 손님이 결제창에서 고르면 사장님 문자·텔레그램에 '🛡 구매안전(에스크로)' 줄이 붙는다.
  배달 뒤 **토스 상점관리자에서 '배송 완료'를 등록해야 정산**된다(등록 후 손님이 3영업일 안에 확정하지 않으면 자동 확정).
  확정 전엔 부분취소가 안 되고 전액 취소만 된다.
- 현금영수증: 개인은 '소득공제'가 골라진 채 결제창이 열린다(손님이 바꿀 수 있음).
  **법인·계산서 손님은 현금영수증을 내지 않는다** — 계산서가 나가므로 같은 거래에 증빙이 두 번 생기지 않게. 가상계좌도 같다.
- 끄기: 환경변수를 지우고 Redeploy.

---

## 0-4. 가입 적립 2,000원 (2026-10-05 아버지 결정, 화면 문구는 배포됨)

Supabase SQL Editor 에서 **`supabase-signup-2000.sql`** 전체 실행 → 맨 아래 `min_total`·`max_total` 이 둘 다 2000.
- 새 가입자: 트리거가 2,000P. 기존 가입자(1,000P)와 이 SQL 전에 가입한 사람: 차액 1,000P 를 '가입'으로 한 번 더
  (reason 칸 check 제약 때문에 새 사유를 못 씀 — 10/6 '가입 추가'로 한 번 실패, 그때는 전부 되돌려짐).
- ⚠️ 적립금 **사용**(결제에서 깎기)은 아직 없다 — 쌓이기만 한다(내 적립금 화면에 '곧 열려요' 안내).

---

## 0-5. 적립금 쓰기·추천인 (2026-10-25 형구 결정, 코드 배포 · 스위치는 꺼진 채)

규칙(lib/points.mjs): 3만 원 이상 주문에 한 번 3,000원까지·1,000원 단위, 카드·간편결제·계좌이체·가상계좌만(무통장·법인 계산서·맞춤 링크 제외),
같은 전화번호로 다른 계정이 이미 쓴 적 있으면 거절. 추천 링크(`?ref=코드`)·매장 문자(`?ref=shop`)로 가입하면 1,000원 더,
친구 첫 주문(3만 원 이상)이 배송되고 7일 지나면 추천한 사람 3,000원(30일 5명·1년 3만 원, 같은 전화·주소는 제외).

1. Supabase SQL Editor 에서 `supabase-points-referral.sql` 실행 → 맨 아래 `points_ready = true`.
2. Vercel: `POINTS_MODE=owner` + `POINTS_TEST_EMAILS=<형구 로그인 이메일>` → Redeploy.
   화환에도 쓴다(10/25 형구 결정, 10/6 아버지 "할인코드는 화환 제외"를 바꿈) → `POINTS_EXCLUDE_CATS` 는 비워 둔다.
   화환 49,000원에 3,000원을 쓰면 남는 돈이 약 12,500원 → 9,500원. 다시 빼려면 `POINTS_EXCLUDE_CATS=condolence,congrats`.
3. 시험할 폰에서 `https://floweranbu.co.kr/?pointstest=1` 을 한 번 연다(그 브라우저에만 적립금 칸이 보임, 끄기는 `?pointstest=0`).
   화면 표시용일 뿐이고, 실제로 쓸 수 있는지는 서버가 `POINTS_TEST_EMAILS` 로 다시 막는다.
4. 3만 원 넘는 상품을 로그인해서 '적립금 쓰기' 체크 → 결제 → 관리자에서 환불 → 5분 안에 적립금이 돌아오는지(내 정보 잔액).
5. 문제없으면 `POINTS_MODE=on` → Redeploy. 끌 때는 `owner` 로(돌려주기·추천 보상 점검은 계속 돈다). `off` 는 점검까지 멈춘다.

## 0-6. 방문 집계·아침 '어제 숫자' (2026-10-25)
- 방문 집계: `va.js`(Vercel Web Analytics, 쿠키 없음). Vercel 프로젝트 → Analytics → **Enable** 은 10/25 형구가 눌렀다. 끄면 숫자만 멈추고 화면은 그대로.
- 아침 8시 브리핑 아래 '어제 숫자'(lib/daily-numbers.mjs): 주문·어디서·부고장/청첩장·새 회원은 바로 나온다.
- 방문 숫자까지 넣으려면: vercel.com → 계정 Settings → **Tokens** → Create(Scope = 꽃안부 팀, 만료 1년) →
  프로젝트 Settings → Environment Variables 에 `VERCEL_ANALYTICS_TOKEN`(Production) 으로 붙여 넣기 → 다시 배포.
  채팅·코드에 붙이지 않는다. 만료되면 브리핑에 '토큰이 만료됐는지 확인' 줄이 뜬다.
- 가족·직원 폰은 `https://floweranbu.co.kr/?va=0` 을 한 번 열면 집계에서 빠진다(관리자 화면을 연 기기는 자동).

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
