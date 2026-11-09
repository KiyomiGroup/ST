// LOCAL ONLY: headless browser test of admin/coordinators.html against a FAKE Supabase. Proves layout and logic, not real data.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.argv[2]; const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
const ALL = ['coordinators.view', 'coordinators.manage', 'coordinators.assign', 'coordinators.applications.review'];
const C = [
  { user_id: 'c1', name: 'Coord One', email: 'c1@x.com', status: 'active', created_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-11-08T10:00:00Z', tier: 1, capacity: 2, workers: 2, published: 1, bookings_total: 3, is_me: false },
  { user_id: 'c2', name: 'Coord Two', email: 'c2@x.com', status: 'active', created_at: '2026-10-02T10:00:00Z', last_sign_in_at: null, tier: 2, capacity: 10, workers: 0, published: 0, bookings_total: 0, is_me: false },
  { user_id: 'me', name: 'My own coordinator', email: 'me@x.com', status: 'active', created_at: '2026-09-02T10:00:00Z', tier: 1, capacity: 10, workers: 1, published: 0, bookings_total: 0, is_me: true },
  { user_id: 'c4', name: 'Old One', email: 'c4@x.com', status: 'deactivated', created_at: '2026-08-02T10:00:00Z', tier: 1, capacity: 10, workers: 0, published: 0, bookings_total: 0, is_me: false }];
const APPS = [
  { id: 'a1', full_name: '<img src=x onerror=window.__xss=1>Ada', email: 'ada@x.com', phone: '0801', state: 'Lagos', city: 'Ikeja', tasker_count: 8, area_sqm: 50000, can_meet_taskers: true, can_explain: true, explain_text: '<b>bold</b> a worker', status: 'new', created_at: '2026-11-07T10:00:00Z', code_state: 'issued', answers: { trades: ['plumber', 'tiler'], ref_name: 'Ref One', consent: true, years_in_area: '5' } },
  { id: 'a2', full_name: 'Bola', email: 'b@x.com', status: 'approved', created_at: '2026-11-01T10:00:00Z', answers: {} }];
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; var C=${JSON.stringify(C)}, APPS=${JSON.stringify(APPS)}; window.__calls=[];
  var perms=scn.perms; window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['operations'],permissions:perms,mfa_required:false,mfa_ok:true});
   if(scn.missing && n.indexOf('admin_coordinator')===0) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_coordinator_overview') return ok({ok:true,coordinators:C,unassigned:[{tasker_user_id:'u1',name:'Loose Tasker',status:'draft',areas:'Yaba'}],can_assign:perms.indexOf('coordinators.assign')>-1,can_manage:perms.indexOf('coordinators.manage')>-1,can_review:perms.indexOf('coordinators.applications.review')>-1});
   if(n==='admin_coordinator_workers') return ok({ok:true,workers:a.p_coordinator==='c1'?[{tasker_user_id:'t1',name:'Worker A',status:'published',areas:'Ikeja',bookings:2,assigned_at:'2026-10-05T10:00:00Z'},{tasker_user_id:'t2',name:'Worker B',status:'draft',areas:null,bookings:0}]:[]});
   if(n==='admin_coordinator_applications') return ok({ok:true,applications:APPS.filter(function(x){return !a.p_status||x.status===a.p_status;})});
   if(n==='admin_coordinator_application_approve') return ok({ok:true,link:'https://streettasker.com/coordinator-test.html?t=SECRET123'});
   if(n==='admin_coordinator_application_reject') return ok({ok:true});
   if(n==='admin_coordinator_code_create') return ok({ok:true,code:'CODE-ABC-999'});
   if(n==='admin_coordinator_assign_local_tasker') return ok(scn.capFull?{ok:false,error:'That coordinator has no free place on their plan. Nothing was changed.'}:{ok:true,kind:a.p_tasker==='u1'?'assigned':'moved'});
   if(n==='admin_coordinator_deactivate') return ok({ok:false,workers:2,open_bookings:0,error:'This coordinator still looks after 2 Local Tasker(s) and 0 open booking(s). Move the Local Taskers first. Nothing was changed.'});
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/coordinators.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText(); let PORT;
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  // ---- full permissions, desktop
  let { page, ctx, errs } = await open(browser, { perms: ALL });
  await page.waitForSelector('#coBody .ad-row');
  chk(await page.locator('#coTabs button').count() === 3, '1 three tabs for a full admin');
  chk(await page.locator('.ad-nav-link', { hasText: 'Coordinators' }).count() === 1, '2 menu item shown');
  chk(await page.locator('#coBody .ad-rows .ad-row').count() === 4, '3 four coordinators listed');
  await page.locator('.ad-row', { hasText: 'Coord One' }).click(); await page.waitForSelector('text=Worker A');
  chk((await txt(page, '#coBody .ad-split-detail')).includes('2 of 2 places'), '4 detail shows places used');
  chk(await page.locator('button', { hasText: 'Move' }).count() === 2, '5 Move buttons for two workers');
  await page.locator('button', { hasText: 'Move' }).first().click();
  const opts = await page.locator('.ad-inline-form select option').allInnerTexts();
  chk(opts.some(o => o.includes('Coord Two (0 of 10 places)')), '6 target list has Coord Two with free places');
  chk(!opts.some(o => o.includes('Coord One')) && !opts.some(o => o.includes('My own')) && !opts.some(o => o.includes('Old One')), '7 target list leaves out current, own and deactivated coordinators');
  await page.locator('.ad-inline-form select').selectOption('c2'); await page.locator('.ad-inline-form textarea').fill('short');
  await page.locator('.ad-inline-form button[type=submit]').click(); chk((await txt(page, '.ad-inline-form .ad-error')).includes('at least 10'), '8 short reason stopped on the page');
  chk(!(await page.evaluate(() => window.__calls.some(c => c.n === 'admin_coordinator_assign_local_tasker'))), '9 nothing sent when invalid');
  await page.locator('.ad-inline-form textarea').fill('Balancing the workload'); await page.locator('.ad-inline-form button[type=submit]').click(); await page.waitForSelector('.ad-toast');
  const call = await page.evaluate(() => window.__calls.filter(c => c.n === 'admin_coordinator_assign_local_tasker')[0]);
  chk(call && call.a.p_tasker === 't1' && call.a.p_coordinator === 'c2' && call.a.p_reason === 'Balancing the workload', '10 move sent the right arguments');
  chk(await page.evaluate(() => window.__calls.filter(c => c.n === 'admin_coordinator_overview').length) >= 2, '11 list reloaded after the move');
  // deactivate two-press
  await page.locator('.ad-row', { hasText: 'Coord One' }).click(); await page.waitForSelector('text=Deactivate this coordinator');
  await page.locator('textarea').last().fill('Retiring this one'); await page.locator('button', { hasText: /^Deactivate$/ }).click();
  chk(await page.locator('button', { hasText: 'Press again to confirm' }).count() === 1, '12 deactivate needs a second press');
  chk(!(await page.evaluate(() => window.__calls.some(c => c.n === 'admin_coordinator_deactivate'))), '13 first press sends nothing');
  await page.locator('button', { hasText: 'Press again to confirm' }).click(); await page.waitForSelector('text=still looks after 2');
  chk(true, '14 server refusal text shown to the admin');
  // own and deactivated coordinators
  await page.locator('.ad-row', { hasText: 'My own coordinator' }).click(); await page.waitForSelector('text=your own coordinator account');
  chk(await page.locator('button', { hasText: 'Move' }).count() === 0 && await page.locator('text=Deactivate this coordinator').count() === 0, '15 own coordinator: no Move, no Deactivate');
  await page.locator('.ad-row', { hasText: 'Old One' }).click(); await page.waitForTimeout(100);
  chk(await page.locator('text=Deactivate this coordinator').count() === 0, '16 already deactivated: no Deactivate');
  // applications
  await page.locator('#coTabs button', { hasText: 'Applications' }).click(); await page.waitForSelector('#coBody .ad-row');
  chk(await page.locator('#coBody .ad-rows .ad-row').count() === 1, '17 only the New application listed by default');
  await page.locator('#coBody .ad-row').click(); await page.waitForSelector('text=Their answers');
  chk(await page.evaluate(() => window.__xss) === undefined, '18 markup in the applicant name did not run');
  chk((await txt(page, '#coBody .ad-split-detail')).includes('<img src=x'), '19 applicant name shown as plain text');
  chk((await txt(page, '#coBody .ad-split-detail')).includes('plumber, tiler') && !(await txt(page, '#coBody .ad-split-detail')).includes('Consent'), '20 answers shown, consent flag hidden');
  chk((await txt(page, '#coBody .ad-split-detail')).includes('A sign-up code was issued'), '21 code state shown');
  await page.locator('button', { hasText: 'Approve and get the test link' }).click(); await page.waitForSelector('.ad-secretbox');
  chk((await page.locator('.ad-secretbox input').inputValue()).includes('SECRET123'), '22 test link shown in a copy box');
  const appr = await page.evaluate(() => window.__calls.filter(c => c.n === 'admin_coordinator_application_approve')[0]);
  chk(appr && appr.a.p_application === 'a1' && appr.a.p_days === null, '23 approve sent id and default days');
  await page.locator('#coTabs button', { hasText: 'Workload' }).click(); await page.waitForSelector('meter');
  chk(await page.locator('meter').count() === 4, '24 workload meters');
  await page.locator('#coTabs button', { hasText: 'Applications' }).click(); await page.waitForSelector('#coBody .ad-row');
  await page.locator('#coBody .ad-tabs button', { hasText: 'All' }).click(); await page.waitForSelector('#coBody .ad-rows li:nth-child(2) .ad-row');
  chk(await page.locator('#coBody .ad-rows .ad-row').count() === 2, '25 All filter lists both');
  await page.locator('#coBody .ad-row', { hasText: 'Bola' }).click(); await page.waitForSelector('text=shown only once');
  chk(await page.locator('.ad-split-detail button', { hasText: 'Approve' }).count() === 0, '26 no decision buttons for an approved application');
  await page.locator('summary', { hasText: 'Create a sign-up code' }).click(); await page.locator('details input[type=text]').first().fill('For Chidi'); await page.locator('details button[type=submit]').click(); await page.waitForSelector('details .ad-secretbox');
  chk((await page.locator('details .ad-secretbox input').inputValue()) === 'CODE-ABC-999', '27 code shown once in a copy box');
  await page.locator('#coTabs button', { hasText: 'Workload' }).click(); await page.waitForSelector('text=Loose Tasker');
  await page.locator('button', { hasText: /^Assign$/ }).click(); await page.locator('.ad-inline-form select').selectOption('c2'); await page.locator('.ad-inline-form textarea').fill('First placement for this worker'); await page.locator('.ad-inline-form button[type=submit]').click(); await page.waitForSelector('.ad-toast');
  const as = await page.evaluate(() => window.__calls.filter(c => c.n === 'admin_coordinator_assign_local_tasker').pop());
  chk(as.a.p_tasker === 'u1', '28 first assignment sent');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '29 no sideways scroll at 1280');
  chk(errs.length === 0, '30 no page errors: ' + errs.join('|')); await ctx.close();
  // ---- capacity refusal from the server is shown
  ({ page, ctx, errs } = await open(browser, { perms: ALL, capFull: true })); await page.waitForSelector('#coBody .ad-row');
  await page.locator('.ad-row', { hasText: 'Coord One' }).click(); await page.waitForSelector('text=Worker A'); await page.locator('button', { hasText: 'Move' }).first().click();
  await page.locator('.ad-inline-form select').selectOption('c2'); await page.locator('.ad-inline-form textarea').fill('Trying a full coordinator'); await page.locator('.ad-inline-form button[type=submit]').click(); await page.waitForSelector('.ad-inline-form .ad-error:not([hidden])');
  chk((await txt(page, '.ad-inline-form .ad-error')).includes('no free place'), '31 capacity refusal text shown');
  await ctx.close();
  // ---- view-only (verification-like)
  ({ page, ctx, errs } = await open(browser, { perms: ['coordinators.view'] })); await page.waitForSelector('#coBody .ad-row');
  chk(await page.locator('#coTabs button').count() === 2 && await page.locator('#coTabs button', { hasText: 'Applications' }).count() === 0, '32 view-only: no Applications tab');
  await page.locator('.ad-row', { hasText: 'Coord One' }).click(); await page.waitForSelector('text=Worker A');
  chk(await page.locator('button', { hasText: 'Move' }).count() === 0 && await page.locator('text=Deactivate this coordinator').count() === 0, '33 view-only: no Move, no Deactivate');
  await ctx.close();
  // ---- review-only
  ({ page, ctx, errs } = await open(browser, { perms: ['coordinators.applications.review'] })); await page.waitForSelector('#coBody .ad-row');
  chk(await page.locator('#coTabs button').count() === 1, '34 review-only: only Applications');
  chk(!(await page.evaluate(() => window.__calls.some(c => c.n === 'admin_coordinator_overview'))), '35 review-only never calls the coordinator list');
  chk(await page.locator('summary', { hasText: 'Create a sign-up code' }).count() === 0, '36 no code creator without coordinators.manage');
  await ctx.close();
  // ---- nothing
  ({ page, ctx, errs } = await open(browser, { perms: ['disputes.manage'] })); await page.waitForSelector('.ad-state');
  chk((await txt(page, '#adMain')).includes('do not have access'), '37 no permission: access message'); chk(await page.locator('.ad-nav-link', { hasText: 'Coordinators' }).count() === 0, '38 menu item hidden'); await ctx.close();
  // ---- function missing
  ({ page, ctx, errs } = await open(browser, { perms: ALL, missing: true })); await page.waitForSelector('.ad-state--error');
  chk((await txt(page, '#adMain')).includes('a9-coordinators.sql'), '39 missing function: tells the owner which file to run'); await ctx.close();
  // ---- phone
  ({ page, ctx, errs } = await open(browser, { perms: ALL }, 390)); await page.waitForSelector('#coBody .ad-row');
  chk(await page.locator('.ad-split-detail').first().isHidden(), '40 phone: list first, detail hidden');
  await page.locator('.ad-row', { hasText: 'Coord One' }).click(); await page.waitForSelector('text=Worker A');
  chk(await page.locator('.ad-split-list').first().isHidden() && await page.locator('.ad-back').first().isVisible(), '41 phone: detail shown with a Back button');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '42 phone: no sideways scroll (detail)');
  await page.locator('.ad-back').first().click(); await page.locator('#coTabs button', { hasText: 'Workload' }).click(); await page.waitForSelector('meter');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '43 phone: no sideways scroll (workload cards)');
  await page.locator('#coTabs button', { hasText: 'Applications' }).click(); await page.waitForSelector('#coBody .ad-row'); await page.locator('#coBody .ad-row').click(); await page.waitForSelector('text=Their answers');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '44 phone: no sideways scroll (application)');
  chk(errs.length === 0, '45 phone: no page errors'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach((r, i) => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1]));
  console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
