-- 꽃안부 꽃집 페이지 2단계 (2026-11-05) — 꽃집·화원 사장님이 가입해 자기 페이지·주문을 관리한다.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만, 다시 돌려도 안전)
--
-- 이 SQL 을 돌리기 전에도 사이트는 그대로 동작한다: /f/<slug> 는 data/shops/<slug>.json 파일로 계속 보이고,
-- 사장님 화면 저장만 "표가 아직 없어요"로 막힌다. 결제·주문(orders) 표는 바꾸지 않는다.
--
-- 원칙(기존 표들과 같음)
--  · 손님(anon)은 '운영 중' 가게와 '보이는' 상품의 공개 칸만 읽는다.
--  · 쓰기는 전부 서버(service_role)만. 사장님 확인은 서버가 로그인 토큰 → shops.owner_user_id 로 한다.
--    웹과 앞으로 낼 휴대폰 앱이 같은 서버 주소를 부르므로, 화면이 늘어도 표·권한은 그대로다.
--  · 꽃집 꽃값은 받지 않는다(돈 칸은 사장님이 '입금 확인'을 누르는 기록뿐). 화환만 orders 에 있다.

-- 1) 가게 ─────────────────────────────────────────────
create table if not exists public.shops (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),   -- 주소 /f/<slug>
  kind           text not null default 'florist' check (kind in ('florist', 'hwawon')),  -- 1인 꽃집 / 화원(화환 제작처)
  status         text not null default 'pending' check (status in ('pending', 'active', 'paused', 'closed')),
  owner_user_id  uuid references auth.users(id) on delete set null,
  name           text not null check (char_length(name) between 1 and 30),
  profile        jsonb not null default '{}'::jsonb,  -- tagline·area·tags·hours{open,close}·unmanned·kakao·phone·address·insta·hero
  cats           jsonb not null default '[]'::jsonb,  -- [{id,label}]
  blocks         jsonb not null default '{}'::jsonb,  -- {order,night,cls,wreath} 켜고 끄기
  classes        jsonb not null default '[]'::jsonb,  -- [{name,when}]
  -- 사장님만(서버만) 보는 칸
  biz_no         text,                                -- 사업자번호(숫자만). 처음 30곳은 눈으로 확인 후 승인
  biz_name       text,
  settle_bank    text,                                -- 소개비·제작비 받을 계좌
  settle_account text,
  settle_holder  text,
  wreath_area    text[] not null default '{}',        -- 화원: 화환 받을 수 있는 지역(시·구)
  admin_note     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  approved_at    timestamptz
);
create index if not exists shops_owner on public.shops (owner_user_id);
create index if not exists shops_kind_status on public.shops (kind, status);

-- 2) 상품 ─────────────────────────────────────────────
create table if not exists public.shop_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  cat         text not null default '',
  name        text not null check (char_length(name) between 1 and 30),
  descr       text not null default '',
  price_text  text not null default '',               -- "55,000원부터" 처럼 사장님이 쓴 그대로(우리가 계산하지 않음)
  photos      text[] not null default '{}',           -- shop-photos 버킷 공개 주소
  state       text not null default 'on' check (state in ('on', 'soldout', 'reserve', 'hidden')),
  soldout_on  date,                                   -- state=soldout 인 날(다음 날 자동으로 on 처럼 보임)
  pinned      boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists shop_items_shop on public.shop_items (shop_id, pinned desc, sort);

-- 3) 손님 주문서 · 전화 주문 (꽃집 꽃. 돈은 가게가 직접 받음) ──────────
create table if not exists public.shop_requests (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  source          text not null default 'web' check (source in ('web', 'phone')),
  status          text not null default 'new' check (status in ('new', 'confirmed', 'making', 'ready', 'delivering', 'done', 'canceled')),
  detail          jsonb not null default '{}'::jsonb,  -- kind·occasion·budget·colors·how·memo·address 등 주문서 그대로
  want_date       date,
  want_time       text,
  customer_name   text,
  customer_phone  text,
  customer_user_id uuid references auth.users(id) on delete set null,
  deposit_amount  int,
  deposit_paid_at timestamptz,                         -- 사장님이 '입금 확인'을 누른 때
  ready_photo     text,                                -- 완성 사진(shop-photos)
  view_token_hash text,                                -- 손님 '주문 상태' 링크 열쇠(해시만 저장)
  driver_token_hash text,                              -- 기사님 링크 열쇠(해시만, 하루짜리)
  driver_expires_at timestamptz,
  delivered_photo text,                                -- 기사님 도착 사진
  owner_note      text
);
create index if not exists shop_requests_shop on public.shop_requests (shop_id, status, want_date);

-- 4) 화환 발주 (꽃안부 orders → 화원) ────────────────────────
create table if not exists public.wreath_dispatch (
  id            uuid primary key default gen_random_uuid(),
  order_id      text not null,                         -- public.orders.order_id
  shop_id       uuid not null references public.shops(id) on delete restrict,
  status        text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'done', 'canceled')),
  fee           int not null check (fee >= 0),         -- 제작비(화원이 받는 돈)
  deadline_at   timestamptz,
  snapshot      jsonb not null default '{}'::jsonb,    -- 받는 곳·리본·상품 이름(발주 때 복사. 주문이 바뀌어도 화원 화면은 그대로)
  offered_at    timestamptz not null default now(),
  answered_at   timestamptz,
  done_at       timestamptz,
  delivered_photo text,
  settle_month  text                                   -- 'YYYY-MM'
);
create unique index if not exists wreath_dispatch_live on public.wreath_dispatch (order_id) where status in ('offered', 'accepted', 'done');
create index if not exists wreath_dispatch_shop on public.wreath_dispatch (shop_id, status, offered_at desc);

-- 5) 단골 손님 · 가게별 도장 ───────────────────────────────
create table if not exists public.shop_customers (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  name          text,
  phone         text,
  stamps        int not null default 0 check (stamps >= 0),
  annivs        jsonb not null default '[]'::jsonb,    -- [{label,md:"03-14"}] 손님이 직접 넣은 기념일
  notify_ok     boolean not null default false,        -- 그 가게 알림(기념일·소식) 받기 동의
  notify_ok_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (shop_id, user_id)
);

create table if not exists public.shop_stamp_log (
  id          bigserial primary key,
  customer_id uuid not null references public.shop_customers(id) on delete cascade,
  delta       int not null,
  reason      text,                                    -- 'request:<id>' · 'gift' · 'owner'
  created_at  timestamptz not null default now()
);

-- 6) 알림 받을 기기 (웹 푸시는 기존 push_subscriptions 를 쓰고, 앱 토큰을 여기 둔다) ──
create table if not exists public.app_push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  token      text not null unique,                      -- Expo 푸시 토큰
  created_at timestamptz not null default now()
);

-- 권한 ────────────────────────────────────────────────
alter table public.shops            enable row level security;
alter table public.shop_items       enable row level security;
alter table public.shop_requests    enable row level security;
alter table public.wreath_dispatch  enable row level security;
alter table public.shop_customers   enable row level security;
alter table public.shop_stamp_log   enable row level security;
alter table public.app_push_tokens  enable row level security;

revoke all on public.shops, public.shop_items, public.shop_requests, public.wreath_dispatch,
              public.shop_customers, public.shop_stamp_log, public.app_push_tokens from anon, authenticated;

-- 손님 화면: 운영 중 가게의 공개 칸만
drop policy if exists shops_public_read on public.shops;
create policy shops_public_read on public.shops for select to anon, authenticated using (status = 'active');
grant select (id, slug, kind, status, name, profile, cats, blocks, classes) on public.shops to anon, authenticated;

drop policy if exists shop_items_public_read on public.shop_items;
create policy shop_items_public_read on public.shop_items for select to anon, authenticated
  using (state <> 'hidden' and exists (select 1 from public.shops s where s.id = shop_id and s.status = 'active'));
grant select (id, shop_id, cat, name, descr, price_text, photos, state, soldout_on, pinned, sort) on public.shop_items to anon, authenticated;

-- 나머지 표(주문서·화환 발주·단골·도장·앱 토큰)는 공개 정책 없음 → 서버만.

-- 사진 저장소: 공개 읽기(가게 사진·상품 사진). 올리기는 서버만(사장님 확인 뒤). 5MB, 사진만.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-photos', 'shop-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 고친 시각 자동
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists shops_touch on public.shops;
create trigger shops_touch before update on public.shops for each row execute function public.touch_updated_at();
drop trigger if exists shop_items_touch on public.shop_items;
create trigger shop_items_touch before update on public.shop_items for each row execute function public.touch_updated_at();
drop trigger if exists shop_requests_touch on public.shop_requests;
create trigger shop_requests_touch before update on public.shop_requests for each row execute function public.touch_updated_at();

-- 끝. 확인(anon 키로): GET /rest/v1/shops?select=slug,name → [] (운영 중 가게가 아직 없으면 빈 목록)
--                  GET /rest/v1/shop_requests → 401/42501 (손님이 못 읽어야 정상)
