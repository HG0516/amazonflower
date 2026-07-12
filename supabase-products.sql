-- 꽃안부 상품 편집(override) 설정 — 아버지가 폰에서 '설명·사진·품절'을 직접 바꾸는 기능
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만)
--
-- ⚠️ 가격 컬럼이 없습니다. 판매가는 여전히 products.mjs(결제검증) 단일 소스이며,
--    이 표는 결제 금액에 절대 영향을 주지 않습니다 → 결제와 구조적으로 완전 분리(Phase 1 안전).
--    가격 변경·신상품(Phase 2)은 토스 라이브 후 결제서버 연동으로 별도 추가합니다.

create table if not exists public.product_overrides (
  pc          text primary key,                              -- 상품코드 (products.js 의 pc)
  subtitle    text,                                          -- 한줄설명 (null = 정적 기본값 사용)
  description text,                                           -- 상세설명 (null = 정적 기본값 사용)
  status      text check (status in ('판매중','품절')),        -- null = 정적 기본값 사용
  photos      jsonb,                                          -- ["url", ...] (null = 정적 기본값 사용)
  updated_at  timestamptz not null default now()
);

alter table public.product_overrides enable row level security;

-- 공개 읽기: 카탈로그가 anon 키로 override 를 읽어 정적 상품(products.js) 위에 덮어씀.
-- (쓰기 정책 없음 → service 키를 쓰는 서버 함수 api/product-edit.js 만 수정 가능 = 보안)
drop policy if exists "public read overrides" on public.product_overrides;
create policy "public read overrides"
  on public.product_overrides for select
  using (true);

-- 상품 사진은 기존 'gallery' 버킷(public)을 product/ 경로로 재사용합니다. 새 버킷 불필요.
-- 끝. 저장/수정은 서버 함수(api/product-edit.js)가 service_role 키로만 처리합니다.
