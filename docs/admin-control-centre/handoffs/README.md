# Stage handoffs

One file per finished stage, named by its stage ID: `A0.md`, `A1.md`, ... (the stage table is in `../00-PLAN.md`). Write the file at the end of the session, before the zip.

## Template (copy this)

# Stage <ID>: <title>  (date)
1. **Objective.**
2. **Done.** What now exists. Say "written", "run on scratch Postgres", "run in browser with stubbed Supabase" or "run on production by the owner". Never say more than what happened.
3. **Files inspected.**
4. **Files created.**
5. **Files modified.** For existing site files, say exactly what changed and confirm nothing else did.
6. **Database changes.** SQL file names, in the order the owner runs them. Rollback file names.
7. **RLS and grants.**
8. **Functions** (SQL and Edge), with their permission and whether they need an approval id.
9. **Components reused** (existing classes, helpers, functions).
10. **Decisions made** (and which owner decision IDs they rest on).
11. **Tests.** What was run, where, and the **actual result**. What was NOT run.
12. **Security notes.**
13. **Backward compatibility.** Which existing pages and flows were checked.
14. **Outstanding issues and known limits.**
15. **Config the owner must set** (secrets, function deploy settings such as Verify JWT).
16. **Owner status.** Applied? Deployed? Per the owner's no-error convention or confirmed?
17. **NEXT STAGE** and exactly what it must read first.
18. **What you do now** (numbered, SQL editor and dashboard only).
