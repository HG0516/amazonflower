# 아마존플라워 화환 주문 웹사이트

경기 시흥시 신천3길 23 · 축하/근조화환 주문 사이트.
청첩장·부고 링크를 AI가 분석해 자동으로 정보를 채우고, 토스페이먼츠로 결제하면 사장님께 주문 알림 문자가 갑니다.

## 파일 구성

```
amazonflower/
├── index.html               # 프론트 (단일 파일)
├── api/
│   ├── parse-url.js          # URL/텍스트 → Claude API 파싱
│   └── confirm-payment.js    # 토스 결제 승인 + 금액검증 + 사장님 문자
├── vercel.json
├── .env.example              # 환경변수 목록
└── .gitignore
```

## 동작 흐름

1. 고객이 청첩장/부고 **URL 붙여넣기** 또는 **직접 입력**
2. 서버(`parse-url.js`)가 페이지를 가져와 Claude API로 날짜·장소·받는분 추출
3. 청첩장이면 신랑/신부 측 선택 → 관계 선택 → AI 추천 가격대 표시
4. 화환 선택(축하/근조 × 5·7·10·15만원, 추천 상품 태그)
5. 토스페이먼츠 결제위젯 v2로 결제 (카카오페이/네이버페이/토스페이/카드)
6. 결제 승인 시 **금액 위변조 검증** 후 **사장님 두 분께만** 문자 발송
   - 문자엔 발주 복붙용 정보 + **원문(URL/텍스트)** 포함 → 사장님이 더블체크
   - 화환 제작/배송 하청 업체에는 자동 발송하지 않음 (사장님이 직접 발주)

## 배포 (Vercel)

1. 이 폴더 전체를 GitHub `HG0516/amazonflower` 저장소에 push
   ```
   git add .
   git commit -m "화환 주문 사이트 구현"
   git push
   ```
2. [vercel.com](https://vercel.com) → New Project → 이 저장소 Import → Deploy
3. Vercel 프로젝트 **Settings → Environment Variables** 에 아래 키 입력 (`.env.example` 참고)
   - `ANTHROPIC_API_KEY` — 발급 완료된 키
   - `TOSS_SECRET_KEY` — 처음엔 토스 **테스트 시크릿 키**(`test_sk_...`)
   - `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER` — 문자 발송용 (나중에)
   - `OWNER_PHONE_1`, `OWNER_PHONE_2` — 사장님(어머니) 번호
4. 환경변수 입력 후 **Redeploy** (변경사항 반영)

## 키 발급 안내

### 토스페이먼츠 (테스트 → 라이브)
- 개발자센터에서 가맹점 심사 없이 **테스트 키** 즉시 발급 가능
- 현재 `index.html`에는 토스 공개 테스트 클라이언트 키가 들어 있습니다
- 실제 운영 전환 시:
  1. `index.html`의 `TOSS_CLIENT_KEY`를 **라이브 클라이언트 키**로 교체
  2. Vercel 환경변수 `TOSS_SECRET_KEY`를 **라이브 시크릿 키**로 교체

### 솔라피 (문자/알림톡)
- [solapi.com](https://solapi.com) 가입 → API Key/Secret 발급
- 발신번호 사전 등록 필요 (`SOLAPI_SENDER`)
- 카카오 알림톡은 채널 개설 + 템플릿 심사(영업일 1~2일) 후 사용 가능. 처음엔 문자(SMS/LMS)로 시작 권장
- **키 미설정이어도 결제는 정상 동작**하며 알림만 생략됩니다 (초기 테스트 안전장치)

## 보안 메모 (중요)

- `ANTHROPIC_API_KEY`, `TOSS_SECRET_KEY`, 솔라피 키는 **모두 서버(api/)에서만** 사용 — 프론트에 절대 없음
- `index.html`에 들어가는 토스 키는 **공개되어도 되는 클라이언트 키**뿐
- 결제 금액은 프론트 값을 믿지 않고 서버에서 상품코드 기준 정가와 대조 검증
- `.env`는 `.gitignore`에 포함 — 키를 깃에 커밋하지 마세요

## 테스트 결제 방법

토스 테스트 모드에서는 실제 출금 없이 결제 흐름을 전부 테스트할 수 있습니다.
결제창에서 테스트용 카드/간편결제를 선택하면 됩니다. (토스 개발자 문서의 테스트 카드번호 참고)
