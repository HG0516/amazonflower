-- 기념일 D-7 푸시 자동 발송 — Supabase pg_cron 이 매일 1회 /api/check-anniversaries 를 호출.
-- (check-deadlines 와 동일한 방식)
--
-- 사전 준비:
--   1) Supabase → Database → Extensions 에서 pg_cron, pg_net 활성화
--   2) 아래 <CRON_SECRET> 을 Vercel 환경변수 CRON_SECRET 과 '똑같은 값'으로 바꿔서 RUN
--
-- 스케줄: 매일 UTC 00:00 = 한국시간 09:00 (원하면 조정)

select cron.schedule(
  'kkotanbu-anniversaries-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://amazonflower.vercel.app/api/check-anniversaries',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
  $$
);

-- 해제하려면: select cron.unschedule('kkotanbu-anniversaries-daily');
-- 등록 확인:  select * from cron.job;

-- ── 사장님 브리핑 3회/일 (2026-07-17 등록됨 — 기록용) ──
-- orders.canceled_at 컬럼도 같은 날 추가됨: alter table orders add column if not exists canceled_at timestamptz;
-- KST 08:00 / 12:30 / 18:00 = UTC 23:00(전날) / 03:30 / 09:00
-- select cron.schedule('briefing-morning', '0 23 * * *', $$ select net.http_post(url := 'https://amazonflower.vercel.app/api/check-deadlines?briefing=morning', headers := jsonb_build_object('Authorization','Bearer <CRON_SECRET>')) $$);
-- select cron.schedule('briefing-noon',    '30 3 * * *', $$ select net.http_post(url := 'https://amazonflower.vercel.app/api/check-deadlines?briefing=noon',    headers := jsonb_build_object('Authorization','Bearer <CRON_SECRET>')) $$);
-- select cron.schedule('briefing-evening', '0 9 * * *',  $$ select net.http_post(url := 'https://amazonflower.vercel.app/api/check-deadlines?briefing=evening', headers := jsonb_build_object('Authorization','Bearer <CRON_SECRET>')) $$);
