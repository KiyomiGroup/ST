\set ON_ERROR_STOP on
set app.perm = 'payouts.view';
select (admin_payouts_overview()->'regular'->>'stuck') = '1' as stuck_1, (admin_payouts_overview()->'regular'->>'anomalies') = '1' as anomaly_1,
       (admin_payouts_overview()->'regular'->>'in_flight_amount')::numeric = 8000 as inflight_8000,
       (admin_payouts_overview()->'regular'->>'wallet_balance_total')::numeric = 5000 as wallets_5000,
       (admin_payouts_overview()->'local'->>'overdue') = '1' as overdue_1,
       (admin_payouts_overview()->'local'->>'paid_amount')::numeric = 3900 as local_paid_3900;
select (admin_withdrawal_list('stuck',0)->>'total') = '1' as list_stuck_1, (admin_withdrawal_list('all',0)->>'total') = '4' as list_all_4,
       (admin_withdrawal_list('bogus',0)->>'filter') = 'all' as bad_filter_all,
       (admin_withdrawal_list('all',0)::text not like '%0123456789%') as no_full_account, (admin_withdrawal_list('all',0)::text like '%Ada Tasker%') as name_shown;
select (admin_local_payout_list('overdue',0)->>'total') = '1' as local_overdue_1, (admin_local_payout_list('all',0)::text like '%Mama Ayo%') as local_name,
       (admin_local_payout_list('all',0)::text not like '%RCP_secret%') as no_recipient_code, (admin_local_payout_list('all',0)::text like '%1234%') as last4_shown;
set app.perm = 'other';
do $$ begin begin perform admin_payouts_overview(); raise exception 'should have refused'; exception when sqlstate '42501' then null; end;
 begin perform admin_withdrawal_list(); raise exception 'should have refused'; exception when sqlstate '42501' then null; end;
 begin perform admin_local_payout_list(); raise exception 'should have refused'; exception when sqlstate '42501' then null; end; end $$;
select 'permission refused ok' as r;
