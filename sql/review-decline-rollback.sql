-- Undo sql/review-decline.sql (the pop-up then relies on this browser's saved "No thanks" only).
drop function if exists public.decline_review(uuid);
drop table if exists public.review_declines;
