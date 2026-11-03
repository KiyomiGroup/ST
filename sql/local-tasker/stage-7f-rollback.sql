-- StreetTasker Local Tasker: STAGE 7F rollback. Puts the one line back in the five functions, then drops the helper.
-- Does not touch any row (no withdrawal, bank account or ledger row is deleted). A coordinator who already saved a bank
-- account or has a withdrawal keeps them; after this rollback the coordinator simply cannot start a NEW one.
do $$
declare
  v_old constant text := 'if not public.is_wallet_owner(p_user) then';
  v_new constant text := 'if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then';
  v_name text; v_oid oid; v_def text;
begin
  foreach v_name in array array['withdrawal_create', 'bank_account_add', 'bank_account_set_default', 'bank_account_remove', 'bank_account_set_recipient'] loop
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_name;
    if v_oid is null then continue; end if;
    v_def := pg_get_functiondef(v_oid);
    if position(v_old in v_def) > 0 then execute replace(v_def, v_old, v_new); end if;
  end loop;
end $$;
drop function if exists public.is_wallet_owner(uuid);
