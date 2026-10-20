-- 챙길 사람 수첩(10/20) — 기념일 표에 받는 분 주소·연락처·태어난 해를 더한다. /my '챙길 사람' 탭.
-- recipient = 누구(어머니), label = 무슨 날(생신·결혼기념일·기일). 예전 행(label='어머니 생신')도 그대로 보인다.
-- 이 SQL 전에도 화면은 돌아간다(주소·전화·태어난 해 칸만 저장이 안 된다).
alter table public.anniversaries add column if not exists birth_year smallint check (birth_year between 1900 and 2100);
alter table public.anniversaries add column if not exists phone text not null default '';
alter table public.anniversaries add column if not exists addr  text not null default '';
-- 'ask' = '생일 알려줘' 링크로 본인이 적어 준 것(서버 /api/parse-url askreply 가 넣는다)
alter table public.anniversaries add column if not exists via   text not null default '';
create index if not exists anniversaries_user on public.anniversaries (user_id);
