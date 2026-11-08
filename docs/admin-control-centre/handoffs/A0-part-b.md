# Stage A0 part B: Introspect the live database (2026-11-07) - DONE

1. **Objective.** Replace every guess about the live database with fact, so A1 can be written without inventing schema.
2. **Done.** Read the 15 CSV results the owner pasted (blocks 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17) and wrote them into `ARCHITECTURE.md` Part B. Replaced every UNVERIFIED in `01` and every VERIFY in `02`. Corrected `00-PLAN.md`. Recorded the owner's answers (admin email, no reference screens). Nothing was executed against Supabase by the AI. No page was built. No SQL (other than the new optional read-only file) was written. No test was run.
3. **Files inspected.** The 15 CSVs, `ST-Real-Main` snapshot (grep for coordinator code and support usage), `admin-A0-partA` and `admin-A0-handoff` zips.
4. **Files created.** `docs/admin-control-centre/handoffs/A0-part-b.md`, `sql/admin/a0-followup.sql` (read-only, **not run**).
5. **Files modified.** `ADMIN-HANDOFF.md`, `docs/admin-control-centre/ARCHITECTURE.md`, `IMPLEMENTATION-STATUS.md`, `00-PLAN.md`, `01-WHAT-NEEDS-ADMIN.md`, `02-SCREEN-SPECS.md`, `03-OWNER-DECISIONS.md`. No site file was touched.
6. **Database changes.** None.
7. **RLS and grants.** None.
8. **Functions.** None.
9. **Components reused.** None.
10. **Decisions made.** (a) A1 may start now; the follow-up queries are optional and only block A9, A12, A16, A26. (b) The "10-worker limit" is already enforced as per-tier capacity in trigger `coordinator_assignments_guard`; A9 reuses it. (c) No separate coordinator Codes screen. (d) Admin hide is a NEW column or table, never a new `services.listing_status` value. (e) A1 also adds the first Super Admin to `support_staff`, which has 0 rows. (f) A new security stage S1 (secret rotation) is separate from the admin build. Rests on D-A3 and D-A5 (answered) and D-A14, D-A16 (answered by the data).
11. **Tests.** None run.
12. **Security notes.** **Critical:** the pasted results exposed a `service_role` key (in the `push-notifications` trigger on `notifications`), an `x-push-secret`, and a cron `x-cron-secret`. Details and the six other findings are in `ARCHITECTURE.md` Part C items 6 to 12. None fixed here.
13. **Backward compatibility.** No site file changed.
14. **Outstanding issues.** Unknown after A0: enum types, bucket list, source of `platform_fee_rate()`, `coordinator_tier_terms()`, `coordinator_capacity()`, permission checks of the three existing `admin_*` coordinator functions and `gift_admin_*`, `bookings.status` values, exact counts for tables shown as -1, whether admin@streettasker.com exists in Auth. All are read by `sql/admin/a0-followup.sql`.
15. **Config the owner must set.** None for A1. For S1: rotate the three secrets (owner decides).
16. **Owner status.** Nothing to apply or deploy from this stage.
17. **NEXT STAGE.** A1 (see `ADMIN-HANDOFF.md`).
18. **What you do now.**
   1. Read the security alert (Part C item 6). Tell me whether you want stage S1 (rotation) done before or after A1.
   2. Say "go" for A1.
   3. Optional, later: run `sql/admin/a0-followup.sql` block by block and send the results.

## Notes for another Claude session
- Never copy a secret from the owner's results into any file. The three secrets are not in this pack.
- Do not invent schema. If a name is not in `ARCHITECTURE.md` Part B, it is unknown.
- Silence from the owner means "applied or deployed", never "tested".
