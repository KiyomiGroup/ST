-- =====================================================================
-- Rollback for w2a-tables.sql.  Run it only AFTER rolling back any later withdrawal SQL (w2d, w2c, w2b),
-- because those functions call withdrawal_fee / withdrawal_limits and read these tables. The database
-- cannot warn you about that (function bodies are not tracked), so the ORDER is your job.
--
-- SAFETY: it NEVER deletes withdrawal or ledger rows.
--   * public.withdrawals and public.withdrawal_bank_accounts are dropped ONLY IF THEY ARE EMPTY.
--     If they hold rows they are kept (a notice says so) together with their protective triggers.
--   * It does not touch any wallet_transactions row.
--   * It does NOT put back a CHECK constraint that w2a-tables.sql dropped from wallet_transactions or
--     notifications (the dropped definition was printed when you ran it). Nothing depends on it.
-- =====================================================================
begin;

drop index if exists public.wallet_tx_withdrawal_once;
drop index if exists public.wallet_tx_withdrawal_refund_once;

do $$
declare n_wd bigint := 0; n_ba bigint := 0; wd_gone boolean := true;
begin
  if to_regclass('public.withdrawals') is not null then
    execute 'select count(*) from public.withdrawals' into n_wd;
    if n_wd = 0 then
      execute 'drop table public.withdrawals';
    else
      wd_gone := false;
      raise notice 'KEPT public.withdrawals: it holds % row(s) of money records. Nothing was deleted.', n_wd;
    end if;
  end if;

  if to_regclass('public.withdrawal_bank_accounts') is not null then
    execute 'select count(*) from public.withdrawal_bank_accounts' into n_ba;
    if n_ba = 0 and wd_gone then
      execute 'drop table public.withdrawal_bank_accounts';
    else
      raise notice 'KEPT public.withdrawal_bank_accounts (% row(s), or withdrawals still point at it). Nothing was deleted.', n_ba;
    end if;
  end if;
end $$;

-- helper functions: dropped only when nothing uses them any more
do $$
declare f text;
begin
  foreach f in array array['public.withdrawal_fee(numeric)', 'public.withdrawal_limits()',
                           'public._withdrawal_before_update()', 'public._wba_before_update()'] loop
    begin
      execute format('drop function if exists %s', f);
    exception when dependent_objects_still_exist then
      raise notice 'KEPT function % because a kept table or a later withdrawal file still uses it.', f;
    end;
  end loop;
end $$;

commit;
