-- 파트너 명단(10/22) — site_settings 는 key='home' 만 받게 막혀 있어서 admin-partner.html 의 key='partners' 저장이 거절된다.
-- supabase-photo-home.sql 다음에 실행. 여러 번 실행해도 된다. 표는 누구나 읽으므로 명단엔 메모·연락처를 두지 않는다(api/admin.js).
alter table public.site_settings drop constraint if exists site_settings_key_check;
alter table public.site_settings add constraint site_settings_key_check check (key in ('home', 'partners'));
