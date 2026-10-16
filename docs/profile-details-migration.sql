-- Edit Profile pages: extra profile details.
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- taskers.profile_details  : headline, years_experience, experience_note, price_note, next_opening,
--                            coverage { radius_km, areas[] }, offers[], services[], portfolio[],
--                            certifications[], emergency { enabled, text }
-- users.profile_details    : tagline, preferences[], categories[]   (customers)
--
-- The existing row-level-security policies that let a person update their own users / taskers
-- row already cover these columns. Public profile pages read them with the same select access
-- they already use for these tables.

alter table public.taskers add column if not exists profile_details jsonb not null default '{}'::jsonb;
alter table public.users   add column if not exists profile_details jsonb not null default '{}'::jsonb;
