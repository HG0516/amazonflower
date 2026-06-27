# 소셜 로그인 설정 가이드 (카카오 · 구글)

로그인 **코드는 이미 다 들어가 있습니다**(`auth.js`). 아래처럼 **키만 Supabase에 넣으면 즉시 켜집니다.**
키가 없으면 로그인 버튼만 안내 메시지를 띄울 뿐, 기존 사이트/결제는 그대로 동작합니다.

> Supabase 프로젝트: **ivlfwlbwiijhmwsfljzz**
> Supabase 콜백(Redirect) URL — 카카오·구글 양쪽에 똑같이 등록:
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

## 1. 카카오 로그인 (무료)

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

## 2. 구글 로그인 (무료)

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

---

## 3. 확인
- `amazonflower.vercel.app` 접속 → 좌상단 **로그인** 칩 → **카카오/구글** 버튼 → 로그인 → 좌상단에 `🌸 이름`으로 바뀌면 성공.

## 다음 단계 (코드 예정)
- 로그인 사용자와 주문 연결(`orders.user_id`) → **내 주문 / 원탭 재주문**
- 기념일 등록 → **D-7 푸시 알림** (웹푸시)
- 네이버 로그인(Supabase 미지원 → 백엔드 커스텀), 애플 로그인(Apple Developer $99/년)

> ⚠️ 이 레포는 **public**입니다(Vercel 무료 플랜이 private 배포를 막아서). 실제 키는 **여기 코드에 넣지 말고 Supabase 대시보드에만** 넣으세요. `auth.js`가 쓰는 anon 키는 공개돼도 안전(RLS 보호)합니다.
