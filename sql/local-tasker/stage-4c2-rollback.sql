-- Rolls back stage 4C-2 (drops the one function). Data is untouched. Safe to run twice.
drop function if exists public.local_tasker_public_cards(int);
