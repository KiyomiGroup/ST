-- Rollback of stage 6D-1: removes the two read functions only. Nothing else was created.
drop function if exists public.coordinator_chat_cards(uuid);
drop function if exists public.coordinator_chat_activity(uuid, integer);
