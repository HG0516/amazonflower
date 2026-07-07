# 소셜 로그인 설정 가이드 (카카오 · 네이버 · 구글 · 애플)

로그인 **코드는 이미 다 들어가 있습니다**(`auth.js` + `api/naver-*`).
아래처럼 **키만 넣으면 그 provider 버튼이 자동으로 나타납니다.**

> 🔑 **핵심 동작(2026-07 변경):** 로그인 모달은 이제 **실제로 연결된 provider만** 버튼으로 보여줍니다.
> - 카카오/구글/애플 → Supabase에서 켜져 있으면(`/auth/v1/settings`) 자동 노출
> - 네이버 → Vercel에 `NAVER_CLIENT_ID` env가 있으면(`/api/naver-login?check`) 자동 노출
> - 따라서 아래 설정을 하나 끝낼 때마다 **코드 수정 없이** 해당 버튼이 새로 뜹니다.

## 📊 현재 상태 (2026-07-07 기준)

| 버튼 | 상태 | 남은 작업 |
|---|---|---|
| **카카오** | ✅ 연결됨 | 없음 (동작 중) |
| **네이버** | ❌ 미설정 | 네이버 앱 등록 + Vercel env 3개 |
| **구글** | ❌ 미설정 | Google Cloud OAuth + Supabase 활성 |
| **애플** | ❌ 미설정 | Apple Developer($99/년) + Supabase 활성 |

> Supabase 프로젝트: **ivlfwlbwiijhmwsfljzz**
> Supabase 콜백(Redirect) URL — 카카오·구글·애플에 똑같이 등록:
> **`https://ivlfwlbwiijhmwsfljzz.supabase.co/auth/v1/callback`**

---

## 0. Supabase 공통 설정 (1번만)

1. [supabase.com](https://supabase.com) → 프로젝트 `ivlfwlbwiijhmwsfljzz` → **Authentication → URL Configuration**
2. **Site URL**: `https://amazonflower.vercel.app`
3. **Redirect URLs**에 추가(Add URL):
   - `https://amazonflower.vercel.app`
   - `https://amazonflower.vercel.app/**`
   - (로컬 테스트 시) `http://localhost:*`

---

## 1. 카카오 로그인 (무료) — ✅ 이미 완료

### 카카오 개발자센터
1. [developers.kakao.com](https://developers.kakao.com) 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름: 꽃안부)
2. **앱 키**에서 **REST API 키** 복사 → (Supabase의 *Client ID* 칸에 넣을 값)
3. **카카오 로그인 → 활성화 ON**
4. **카카오 로그인 → Redirect URI** 등록:
   `https://ivlfwlbwiijhmwsfljzz.supabase.co/auth/v1/callback`
5. **카카오 로그인 → 동의항목**: 닉네임(profile_nickname) 필수, 카카오계정(이메일) 선택동의 권장
6. **보안 → Client Secret**: 코드 생성 → **활성화 ON** → 코드 복사 (Supabase의 *Client Secret*)

### Supabase
7. **Authentication → Providers → Kakao** → Enable ON
8. **REST API 키** → *Client IDs*, **Client Secret** → *Client Secret* 붙여넣기 → Save

---

## 2. 네이버 로그인 (무료) — ❌ 남은 작업

네이버는 Supabase가 지원하지 않아서 **백엔드로 직접 처리**합니다(`api/naver-login.js`, `api/naver-callback.js`). 코드는 이미 있고, **키만 Vercel에 넣으면** 됩니다.

### 네이버 개발자센터
1. [developers.naver.com](https://developers.naver.com) 로그인 → **Application → 애플리케이션 등록**
2. 애플리케이션 이름: 꽃안부, 사용 API: **네이버 로그인**
3. **제공 정보 선택**: **회원이름·이메일 주소**를 필수/추가로 체크 (이메일이 있어야 계정 생성됨)
4. **서비스 URL**: `https://amazonflower.vercel.app`
5. **Callback URL**: `https://amazonflower.vercel.app/api/naver-callback`
6. 등록 후 **Client ID**, **Client Secret** 복사

### Vercel 환경변수 (Settings → Environment Variables, Production)
아래 3개를 넣습니다. (`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`는 이미 있을 수 있음)
```
NAVER_CLIENT_ID=네이버_Client_ID
NAVER_CLIENT_SECRET=네이버_Client_Secret
SUPABASE_URL=https://ivlfwlbwiijhmwsfljzz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=(Supabase Project Settings → API 의 service_role 키)
```
> env를 넣은 뒤 **재배포**해야 반영됩니다. 반영되면 `/api/naver-login?check=1` 이 `{"configured":true}` 를 반환하고, 로그인 모달에 **네이버 버튼이 자동으로 뜹니다.**

---

## 3. 구글 로그인 (무료) — ❌ 남은 작업

### Google Cloud Console
1. [console.cloud.google.com](https://console.cloud.google.com) → 프로젝트 생성(꽃안부)
2. **APIs & Services → OAuth consent screen** → External → 앱 이름·이메일 입력 → 저장
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs**: `https://ivlfwlbwiijhmwsfljzz.supabase.co/auth/v1/callback`
4. 생성된 **Client ID**, **Client Secret** 복사

### Supabase
5. **Authentication → Providers → Google** → Enable ON
6. Client ID / Client Secret 붙여넣기 → Save
> Save 되는 즉시 `/auth/v1/settings` 의 `google` 이 `true` 가 되고, 로그인 모달에 **구글 버튼이 자동으로 뜹니다.**

---

## 4. 애플 로그인 (유료) — ❌ 남은 작업

> ⚠️ **Apple Developer Program 가입($99/년)** 이 있어야 합니다. 없으면 이 항목은 건너뛰세요(다른 3개로 충분).

### Apple Developer
1. [developer.apple.com](https://developer.apple.com) → **Certificates, IDs & Profiles**
2. **Identifiers → App ID(또는 Services ID)** 생성 → **Sign in with Apple** 활성화
3. **Services ID** 의 **Return URLs**: `https://ivlfwlbwiijhmwsfljzz.supabase.co/auth/v1/callback`
4. **Keys → Sign in with Apple** 키 생성 → **Key(.p8)**, **Key ID**, **Team ID** 확보
5. Supabase가 요구하는 **Client Secret(JWT)** 을 위 값들로 생성 (Supabase 문서의 애플 가이드 참고)

### Supabase
6. **Authentication → Providers → Apple** → Enable ON → Services ID / Secret 입력 → Save
> Save 되면 `apple` 이 `true` 가 되어 **애플 버튼이 자동으로 뜹니다.**

---

## 5. 확인 방법
- `amazonflower.vercel.app` 접속 → 좌상단 **로그인** 칩 → 모달에 **연결된 provider 버튼만** 보임.
- 로그인 → 좌상단이 `🌸 이름` 으로 바뀌면 성공.
- provider 활성 상태 직접 확인:
  - 카카오/구글/애플: `https://ivlfwlbwiijhmwsfljzz.supabase.co/auth/v1/settings` (external 항목)
  - 네이버: `https://amazonflower.vercel.app/api/naver-login?check=1`

> ⚠️ 이 레포는 **public**입니다. 실제 키는 **코드에 넣지 말고** Supabase 대시보드/ Vercel 환경변수에만 넣으세요. `auth.js`가 쓰는 anon 키는 공개돼도 안전(RLS 보호)합니다.
