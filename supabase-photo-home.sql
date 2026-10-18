-- 꽃안부 사진 위치 맞추기 + 홈 화면 관리 (2026-10-18)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만, 다시 돌려도 안전)
--
-- 이 SQL 을 돌리기 전에도 사이트는 그대로 동작한다. 표가 없으면 손님 화면은 기본 모양 그대로,
-- 관리자 화면은 "아직 준비 안 됨"만 띄운다. 결제 금액과는 아무 관련이 없다.

-- ① 사진 위치 맞추기 — 사진 파일은 그대로 두고 "어디를 중심으로, 얼마나 확대, 꽉 채울지/전체 보일지"만 저장.
--    key = 사진 주소의 경로 부분(예: /photos/모음/congrats/…jpeg, /storage/v1/object/public/gallery/…jpg)
--    코드 안에 들어 있는 원래 사진첩·상품 사진도 이 표로 덮어 고친다(원본은 안 건드림).
create table if not exists public.photo_meta (
  key        text primary key check (char_length(key) between 2 and 400),
  x          real not null default 50 check (x between 0 and 100),      -- 가로 중심 %
  y          real not null default 50 check (y between 0 and 100),      -- 세로 중심 %
  zoom       real not null default 1  check (zoom between 1 and 3),     -- 확대 배율
  fit        text not null default 'cover' check (fit in ('cover','contain')),  -- 꽉 채우기 / 전체 보이기
  hidden     boolean not null default false,                            -- 사진첩에서 숨김(지우지 않음)
  updated_at timestamptz not null default now()
);
alter table public.photo_meta enable row level security;
-- 공개 읽기만. 쓰기 정책 없음 → service 키를 쓰는 /api/admin 만 고칠 수 있다.
drop policy if exists photo_meta_read on public.photo_meta;
create policy photo_meta_read on public.photo_meta for select to anon, authenticated using (true);

-- ② 홈 화면 관리 — 칸 순서·숨김, 맨 위 대표 상품, 시즌 띠. 한 줄(key='home')에 JSON 으로.
create table if not exists public.site_settings (
  key        text primary key check (key in ('home')),
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
drop policy if exists site_settings_read on public.site_settings;
create policy site_settings_read on public.site_settings for select to anon, authenticated using (true);
