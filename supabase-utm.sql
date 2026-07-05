-- 유입 채널 집계용 컬럼 (프롬프트 9)
-- utm_*: 주문 시점의 유입 채널(전단 QR = ?utm_source=flyer 등) — confirm-payment가 기록
-- referral_source: 결제완료 화면 1탭 설문(검색/지인/전단·현수막/기타) — api/order-meta 가 기록
alter table public.orders add column if not exists utm_source      text;
alter table public.orders add column if not exists utm_medium      text;
alter table public.orders add column if not exists utm_campaign    text;
alter table public.orders add column if not exists referral_source text;

-- 주간 채널 리포트 예시(참고용):
-- select coalesce(utm_source, referral_source, '직접방문') as 채널, count(*) as 주문수, sum(paid_amount) as 매출
-- from orders where created_at > now() - interval '7 days' group by 1 order by 2 desc;
