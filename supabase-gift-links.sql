-- 주소 없는 꽃 선물(11/2 시안 docs/시안/주소없는선물-2026-11). 형구가 "적용해" 한 뒤에만 운영 DB에 넣는다.
-- 손님 브라우저는 이 표를 직접 못 읽는다. 서버(lib/gift.mjs)가 서비스 키로만 읽고 쓴다.
create table if not exists public.gift_links (
  code              text primary key,
  order_id          text unique,
  status            text not null default 'waiting' check (status in ('waiting','filled','declined','canceled','expired')),
  recipient_name    text not null,
  recipient_phone   text not null,
  sender_name       text not null,
  message           text,
  product_label     text,
  product_photo     text,
  expires_at        timestamptz not null,
  address           text,
  address_detail    text,
  delivery_note     text,
  filled_phone      text,
  deliver_date      date,
  deliver_slot      text,
  extra_fee         integer not null default 0,
  consent_at        timestamptz,
  filled_at         timestamptz,
  created_at        timestamptz not null default now()
);
alter table public.gift_links enable row level security;
create index if not exists gift_links_waiting_idx on public.gift_links (expires_at) where status = 'waiting';
