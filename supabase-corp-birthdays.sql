-- 거래처 직원 생일 명단(10/20) — corp.html 에서 엑셀로 올린다. 서버(service role)만 읽고 쓴다.
-- 매일 09시 /api/check-anniversaries 가 7일 뒤 생일을 찾아 사장님 텔레그램으로 알린다.
create table if not exists public.corp_birthdays (
  id          bigint generated always as identity primary key,
  corp_regno  text    not null check (corp_regno ~ '^[0-9]{10}$'),
  name        text    not null,
  month       smallint not null check (month between 1 and 12),
  day         smallint not null check (day between 1 and 31),
  lunar       boolean not null default false,
  addr        text    not null default '',
  phone       text    not null default '',
  budget      integer not null default 0,
  msg         text    not null default '',
  notified_on date,
  created_at  timestamptz not null default now()
);
create index if not exists corp_birthdays_regno on public.corp_birthdays (corp_regno);
create index if not exists corp_birthdays_md on public.corp_birthdays (month, day);
alter table public.corp_birthdays enable row level security;
-- 정책 없음: anon·회원은 못 읽는다(직원 이름·주소·전화가 들어 있다). service role 만.
