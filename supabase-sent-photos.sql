-- 꽃안부 보낸 꽃 사진 (2026-10-29)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만, 다시 돌려도 안전)
--
-- 아버지가 텔레그램 주문 알림 방에 올린 사진, 관리 화면에서 올린 사진, 배송완료 사진이 후보함(pending)에 모이고
-- 관리자가 리본 이름을 가린 뒤 [공개]를 누르면 상품 화면 '실제로 보낸 모습'과 전체 상품 '보낸 꽃'에 보인다.
-- 이 SQL 을 돌리기 전에도 사이트는 그대로 동작한다(관리 화면만 "표가 아직 없어요"). 결제·주문과는 관계없다.
-- 원본 사진은 비공개 order-photos 버킷의 sent-raw/ 아래에 둔다(새 버킷 없음).

create table if not exists public.sent_photos (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'shown', 'hidden')),
  source        text not null default 'admin' check (source in ('telegram', 'admin', 'order')),
  raw_path      text,          -- 비공개 원본(order-photos 버킷 안 경로). 리본 이름이 그대로 보이는 사진
  photo_url     text,          -- 공개본(gallery 버킷 sent/). 리본 가린 뒤 [공개] 때 채워진다
  order_id      text,
  product_code  text,
  category      text check (category is null or category in ('congrats', 'condolence', 'orchid', 'plant', 'basket', 'bouquet')),
  title         text,
  area          text,          -- 축하만 구·시까지. 근조는 비움
  shot_on       date,
  note          text,          -- 텔레그램에 같이 쓴 글. 관리자만 본다
  tg_message_id bigint,
  tg_group      text,
  sort          int not null default 999
);

create unique index if not exists sent_photos_tg_msg on public.sent_photos (tg_message_id) where tg_message_id is not null;
create unique index if not exists sent_photos_order on public.sent_photos (order_id) where source = 'order';
create index if not exists sent_photos_shown on public.sent_photos (status, shot_on desc);

alter table public.sent_photos enable row level security;

-- 손님 화면: 공개된 줄만, 공개해도 되는 칸만 읽는다. 쓰기 정책 없음 → service 키를 쓰는 서버만 쓴다.
drop policy if exists sent_photos_read on public.sent_photos;
create policy sent_photos_read on public.sent_photos for select to anon, authenticated
  using (status = 'shown' and photo_url is not null);

revoke all on public.sent_photos from anon, authenticated;
grant select (id, created_at, status, photo_url, product_code, category, title, area, shot_on, sort)
  on public.sent_photos to anon, authenticated;
