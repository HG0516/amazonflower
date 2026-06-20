-- 꽃안부 갤러리 업로드용 Supabase 설정
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만)

-- 1) 갤러리 아이템 테이블
create table if not exists public.gallery_items (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('plant','orchid','basket','congrats','condolence')),
  name        text not null,
  sub         text,
  color       text,
  photo_url   text not null,
  visible     boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.gallery_items enable row level security;

-- 2) 공개 읽기: '보이는' 아이템만 anon 키로 읽기 허용. (쓰기 정책 없음 → service 키 쓰는 서버 함수만 추가/수정 가능)
drop policy if exists "public read visible items" on public.gallery_items;
create policy "public read visible items"
  on public.gallery_items for select
  using (visible = true);

-- 3) 사진 저장용 Storage 버킷 (공개 읽기)
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do update set public = true;

drop policy if exists "public read gallery objects" on storage.objects;
create policy "public read gallery objects"
  on storage.objects for select
  using (bucket_id = 'gallery');

-- 끝. 업로드/삽입은 서버 함수(api/gallery-add.js)가 service_role 키로 처리하므로
-- 별도 쓰기 정책은 두지 않습니다(보안).
