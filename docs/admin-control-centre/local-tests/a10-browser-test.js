// LOCAL ONLY: headless browser test of admin/local-taskers.html against a FAKE Supabase. Proves layout and logic, not real data.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.argv[2]; const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
const ALL = ['local_taskers.view', 'local_taskers.manage', 'coordinators.assign'];
const COORDS = [{ user_id: 'c1', name: 'Coord One', workers: 2, capacity: 2, is_me: false }, { user_id: 'c2', name: 'Coord Two', workers: 0, capacity: 10, is_me: false }, { user_id: 'me', name: 'My own coordinator', workers: 1, capacity: 10, is_me: true }];
const ITEMS = [
  { tasker_user_id: 't1', name: '<img src=x onerror=window.__xss=1>Mama Ayo', status: 'published', areas: 'Ikeja', coordinator_id: 'c1', coordinator_name: 'Coord One', identity_verified: true, bookings: 2, needs_republish: true },
  { tasker_user_id: 't2', name: 'Samsole', status: 'draft', areas: 'Yaba', coordinator_id: null, coordinator_name: null, identity_verified: false, bookings: 0, needs_republish: false },
  { tasker_user_id: 't3', name: 'Retired Rita', status: 'inactive', areas: null, coordinator_id: null, coordinator_name: null, identity_verified: true, bookings: 1, needs_republish: false },
  { tasker_user_id: 't4', name: 'Own Care Ola', status: 'published', areas: 'Lekki', coordinator_id: 'me', coordinator_name: 'My own coordinator', identity_verified: true, bookings: 0, needs_republish: false }];
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; var COORDS=${JSON.stringify(COORDS)}, ITEMS=${JSON.stringify(ITEMS)}; window.__calls=[];
  var perms=scn.perms; window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function has(p){return perms.indexOf(p)>-1;}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['operations'],permissions:perms,mfa_required:false,mfa_ok:true});
   if(scn.missing && n.indexOf('admin_local_tasker')===0) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_local_tasker_list'){
     var rows=ITEMS.filter(function(x){ if(a.p_search && x.name.toLowerCase().indexOf(a.p_search.toLowerCase())<0) return false;
       if(a.p_filter==='published') return x.status==='published'; if(a.p_filter==='unassigned') return !x.coordinator_id && x.status!=='inactive'; return true; });
     if(scn.many){ rows=[]; for(var i=0;i<50;i++) rows.push({tasker_user_id:'m'+(a.p_offset+i),name:'Many '+(a.p_offset+i),status:'draft',areas:'',coordinator_id:null,identity_verified:false,bookings:0}); }
     return ok({ok:true,total:scn.many?120:rows.length,offset:a.p_offset||0,page_size:50,items:rows,counts:{all:4,published:2,not_published:1,inactive:1,unassigned:1,unverified:1,needs_republish:1},coordinators:COORDS,can_manage:has('local_taskers.manage'),can_assign:has('coordinators.assign')}); }
   if(n==='admin_local_tasker_detail'){
     var it=ITEMS.filter(function(x){return x.tasker_user_id===a.p_tasker;})[0];
     if(scn.partial) return ok({ok:true,profile:{tasker_user_id:it.tasker_user_id,name:it.name,status:it.status,areas:it.areas,skills:['plumbing'],phone_hint:'ending 567',in_my_care:false,needs_republish:false},coordinator:null,history:null,identity:null,services:null,photos:null,consents:null,bookings:null,payouts:null,payout_accounts:null,sections_failed:['services','payouts'],can_manage:true,can_assign:true});
     return ok({ok:true,profile:{tasker_user_id:it.tasker_user_id,name:it.name,status:it.status,areas:it.areas,skills:['plumbing','tiling'],availability_notes:'weekdays',phone_hint:'ending 567',published_at:'2026-11-01T10:00:00Z',created_at:'2026-10-20T10:00:00Z',needs_republish:it.needs_republish,in_my_care:it.coordinator_id==='me'},
      coordinator:it.coordinator_id?{coordinator_id:it.coordinator_id,name:it.coordinator_name,coordinator_status:'active',assigned_at:'2026-10-21T10:00:00Z'}:null,
      history:it.coordinator_id?[{name:it.coordinator_name,assigned_at:'2026-10-21T10:00:00Z',ended_at:null},{name:'Old Coordinator',assigned_at:'2026-10-01T10:00:00Z',ended_at:'2026-10-21T10:00:00Z',end_reason:'Moved'}]:[],
      identity:{status:it.identity_verified?'VERIFIED':'PENDING'},
      services:[{service_name:'Plumbing repair',category:'handyman',price:15000,rate_unit:'/job',available:true,is_main:true},{service_name:'Tiling',price:9000,rate_unit:'/m2',available:false}],
      photos:{portfolio:2,profile_picture:1,removed:1},consents:[{purpose:'photos',method:'in_person',created_at:'2026-10-22T10:00:00Z',revoked_at:null}],
      bookings:[{booking_id:'b1',lt_status:'tasker_confirmed',booking_status:'confirmed',created_at:'2026-10-25T10:00:00Z'}],
      payouts:[{status:'paid',amount:12000,created_at:'2026-10-30T10:00:00Z'}],payout_accounts:[{bank_name:'Some Bank',last4:'6789',status:'active'}],sections_failed:[],can_manage:has('local_taskers.manage'),can_assign:has('coordinators.assign')}); }
   if(n==='admin_coordinator_assign_local_tasker') return ok(scn.capFull?{ok:false,error:'That coordinator has no free place on their plan. Nothing was changed.'}:{ok:true,kind:a.p_tasker==='t2'?'assigned':'moved'});
   if(n==='admin_local_tasker_unpublish') return ok({ok:true,status:'ready'});
   if(n==='admin_local_tasker_deactivate') return ok(a.p_tasker==='t1'?{ok:false,open_bookings:1,error:'This Local Tasker still has 1 open booking(s). Let them finish or be cancelled first. Nothing was changed.'}:{ok:true,status:'inactive'});
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/local-taskers.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: ALL });
  await page.waitForSelector('#ltBody .ad-row');
  chk(await page.locator('.ad-nav-link', { hasText: 'Local Taskers' }).count() === 1, '1 menu item shown');
  chk(await page.locator('#ltBody .ad-rows .ad-row').count() === 4, '2 four Local Taskers listed');
  chk(await page.evaluate(() => window.__xss) === undefined && (await txt(page, '#ltBody')).includes('<img src=x'), '3 markup in a name shown as plain text, did not run');
  chk((await txt(page, '#ltBody')).includes('1 not published yet') && (await txt(page, '#ltBody')).includes('1 with no coordinator'), '4 summary counts shown');
  chk((await txt(page, '#ltBody')).includes('Changed since publishing'), '5 the changed-since-publishing hint shows on the row');
  chk((await page.locator('#ltFilter option').allInnerTexts()).length === 8 && (await page.locator('#ltCoord option').allInnerTexts()).some(o => o.includes('Coord Two')), '6 filter choices and coordinators in the filter');
  // filter + search
  await page.locator('#ltFilter').selectOption('unassigned'); await page.locator('#ltFilters button[type=submit]').click(); await page.waitForSelector('#ltBody .ad-rows .ad-row');
  let l = (await calls(page, 'admin_local_tasker_list')).pop(); chk(l.a.p_filter === 'unassigned' && l.a.p_offset === 0, '7 filter sent to the server, offset reset');
  chk(await page.locator('#ltBody .ad-rows .ad-row').count() === 1, '8 only the unassigned worker shown');
  await page.locator('#ltFilters button', { hasText: 'Reset' }).click(); await page.waitForFunction(() => document.querySelectorAll('#ltBody .ad-rows .ad-row').length === 4);
  await page.locator('#ltSearch').fill('samsole'); await page.locator('#ltFilters button[type=submit]').click(); await page.waitForFunction(() => document.querySelectorAll('#ltBody .ad-rows .ad-row').length === 1);
  l = (await calls(page, 'admin_local_tasker_list')).pop(); chk(l.a.p_search === 'samsole', '9 search sent to the server');
  await page.locator('#ltSearch').fill('zzzz'); await page.locator('#ltFilters button[type=submit]').click(); await page.waitForSelector('#ltBody .ad-state');
  chk((await txt(page, '#ltBody')).includes('No Local Taskers match'), '10 no-results state');
  await page.locator('#ltFilters button', { hasText: 'Reset' }).click(); await page.waitForFunction(() => document.querySelectorAll('#ltBody .ad-rows .ad-row').length === 4);
  // detail
  await page.locator('.ad-row', { hasText: 'Mama Ayo' }).click(); await page.waitForSelector('text=Services and prices (read only)');
  let d = await txt(page, '#ltBody .ad-split-detail');
  chk(d.includes('ending 567') && !/0803|\+234/.test(d), '11 phone shown only as a masked hint');
  chk(d.includes('₦15,000') && d.includes('Plumbing repair') && d.includes('Main, Live') && d.includes('Paused'), '12 services and prices shown');
  chk(await page.locator('#ltBody .ad-split-detail input[type=number], #ltBody .ad-split-detail input[name*=price]').count() === 0, '13 no price input anywhere');
  chk(d.includes('Verified') && d.includes('Worker agreed') && d.includes('confirmed') && d.includes('₦12,000') && d.includes('ending 6789'), '14 identity, booking, payout and last four shown');
  chk(d.includes('2 portfolio, 1 profile picture, 1 removed') && d.includes('photos') && d.includes('in_person'), '15 photo counts and consent shown');
  chk(d.includes('Old Coordinator') && d.includes('Moved'), '16 assignment history shown');
  chk(d.includes('Workers must agree to each job'), '17 the rules note is displayed');
  chk(await page.locator('#ltBody .ad-split-detail h2', { hasText: /Move to another coordinator|Unpublish|Deactivate/ }).count() === 3, '18 move, unpublish and deactivate panels for a published worker');
  // move
  const sel = page.locator('.ad-split-detail select'); const opts = await sel.locator('option').allInnerTexts();
  chk(opts.some(o => o.includes('Coord Two (0 of 10 places)')) && !opts.some(o => o.includes('Coord One')) && !opts.some(o => o.includes('My own')), '19 move list: others only, with places');
  await sel.selectOption('c2'); const forms = page.locator('.ad-split-detail form');
  await forms.nth(0).locator('textarea').fill('short'); await forms.nth(0).locator('button[type=submit]').click();
  chk((await txt(page, '.ad-split-detail .ad-error:not([hidden])')).includes('at least 10') && (await calls(page, 'admin_coordinator_assign_local_tasker')).length === 0, '20 short reason stopped on the page, nothing sent');
  await forms.nth(0).locator('textarea').fill('Balancing the workload'); await forms.nth(0).locator('button[type=submit]').click(); await page.waitForSelector('.ad-toast');
  let a = (await calls(page, 'admin_coordinator_assign_local_tasker'))[0]; chk(a && a.a.p_tasker === 't1' && a.a.p_coordinator === 'c2' && a.a.p_reason === 'Balancing the workload', '21 move calls the A9 function with the right arguments');
  await page.waitForFunction(() => window.__calls.filter(c => c.n === 'admin_local_tasker_list').length >= 6);
  // unpublish: two presses
  await page.waitForSelector('.ad-split-detail h2:has-text("Unpublish")');
  let up = page.locator('.ad-split-detail form').nth(1); await up.locator('textarea').fill('Complaint under review now'); await up.locator('button[type=submit]').click();
  chk(await page.locator('button', { hasText: 'Press again to confirm' }).count() === 1 && (await calls(page, 'admin_local_tasker_unpublish')).length === 0, '22 unpublish needs a second press, first press sends nothing');
  await page.locator('button', { hasText: 'Press again to confirm' }).click(); await page.waitForFunction(() => window.__calls.some(c => c.n === 'admin_local_tasker_unpublish'));
  let u = (await calls(page, 'admin_local_tasker_unpublish'))[0]; chk(u.a.p_tasker === 't1' && u.a.p_reason === 'Complaint under review now', '23 unpublish sent the right arguments');
  // deactivate: server refusal shown
  await page.waitForSelector('.ad-split-detail h2:has-text("Deactivate")');
  let de = page.locator('.ad-split-detail form').last(); await de.locator('textarea').fill('Moved away, no longer working'); await de.locator('button[type=submit]').click(); await de.locator('button', { hasText: 'Press again to confirm' }).click();
  await page.waitForSelector('.ad-split-detail .ad-error:not([hidden])'); chk((await txt(page, '.ad-split-detail .ad-error:not([hidden])')).includes('open booking'), '24 server refusal text shown to the admin');
  // first assignment for the worker with no coordinator
  await page.locator('.ad-row', { hasText: 'Samsole' }).click(); await page.waitForSelector('.ad-split-detail h2:has-text("Place with a coordinator")');
  chk(await page.locator('.ad-split-detail h2', { hasText: 'Unpublish' }).count() === 0, '25 not published: no Unpublish panel');
  await page.locator('.ad-split-detail select').selectOption('c2'); await page.locator('.ad-split-detail form').first().locator('textarea').fill('First placement for this worker'); await page.locator('.ad-split-detail form').first().locator('button[type=submit]').click(); await page.waitForSelector('.ad-toast');
  a = (await calls(page, 'admin_coordinator_assign_local_tasker')).pop(); chk(a.a.p_tasker === 't2', '26 first assignment sent through the same function');
  // inactive and own care
  await page.locator('.ad-row', { hasText: 'Retired Rita' }).click(); await page.waitForSelector('.ad-split-detail h1, .ad-split-detail h2'); await page.waitForTimeout(100);
  chk(await page.locator('.ad-split-detail form').count() === 0, '27 deactivated worker: no action forms');
  await page.locator('.ad-row', { hasText: 'Own Care Ola' }).click(); await page.waitForSelector('text=your own coordinator account');
  chk(await page.locator('.ad-split-detail form').count() === 0, '28 worker in the admin\'s own care: no action forms, explained');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '29 no sideways scroll at 1280');
  chk(errs.length === 0, '30 no page errors: ' + errs.join('|')); await ctx.close();
  // paging
  ({ page, ctx, errs } = await open(browser, { perms: ALL, many: true })); await page.waitForSelector('#ltBody .ad-row');
  chk(await page.locator('#ltBody .ad-pager').count() === 1 && await page.locator('.ad-pager button', { hasText: 'Previous' }).isDisabled(), '31 pager shown, Previous disabled on page 1');
  await page.locator('.ad-pager button', { hasText: 'Next' }).click(); await page.waitForFunction(() => window.__calls.some(c => c.n === 'admin_local_tasker_list' && c.a.p_offset === 50));
  chk(true, '32 Next asks the server for offset 50'); await page.waitForSelector('text=Showing 51 to 100 of 120'); chk(true, '33 range text correct'); await ctx.close();
  // partial detail
  ({ page, ctx, errs } = await open(browser, { perms: ALL, partial: true })); await page.waitForSelector('#ltBody .ad-row'); await page.locator('.ad-row', { hasText: 'Samsole' }).click(); await page.waitForSelector('text=Some parts could not be read');
  d = await txt(page, '#ltBody .ad-split-detail'); chk(d.includes('services, payout records'), '34 a section that failed is named, the rest still shows'); await ctx.close();
  // view only
  ({ page, ctx, errs } = await open(browser, { perms: ['local_taskers.view'] })); await page.waitForSelector('#ltBody .ad-row'); await page.locator('.ad-row', { hasText: 'Mama Ayo' }).click(); await page.waitForSelector('text=Services and prices (read only)');
  chk(await page.locator('.ad-split-detail form').count() === 0, '35 view-only: no action forms'); await ctx.close();
  // manage but not assign
  ({ page, ctx, errs } = await open(browser, { perms: ['local_taskers.view', 'local_taskers.manage'] })); await page.waitForSelector('#ltBody .ad-row'); await page.locator('.ad-row', { hasText: 'Mama Ayo' }).click(); await page.waitForSelector('text=Services and prices (read only)');
  chk(await page.locator('.ad-split-detail h2', { hasText: 'Move to another coordinator' }).count() === 0 && await page.locator('.ad-split-detail h2', { hasText: 'Unpublish' }).count() === 1, '36 manage without assign: no Move panel, Unpublish present'); await ctx.close();
  // no permission, missing
  ({ page, ctx, errs } = await open(browser, { perms: ['disputes.manage'] })); await page.waitForSelector('.ad-state');
  chk((await txt(page, '#adMain')).includes('do not have access') && await page.locator('.ad-nav-link', { hasText: 'Local Taskers' }).count() === 0, '37 no permission: access message, menu item hidden');
  chk(!(await page.evaluate(() => window.__calls.some(c => c.n === 'admin_local_tasker_list'))), '38 no permission: the list function is never called'); await ctx.close();
  ({ page, ctx, errs } = await open(browser, { perms: ALL, missing: true })); await page.waitForSelector('.ad-state--error');
  chk((await txt(page, '#adMain')).includes('a10-local-taskers.sql'), '39 missing function: names the file to run'); await ctx.close();
  // phone
  ({ page, ctx, errs } = await open(browser, { perms: ALL }, 390)); await page.waitForSelector('#ltBody .ad-row');
  chk(await page.locator('.ad-split-detail').first().isHidden(), '40 phone: list first, detail hidden');
  await page.locator('.ad-row', { hasText: 'Mama Ayo' }).click(); await page.waitForSelector('text=Services and prices (read only)');
  chk(await page.locator('.ad-split-list').first().isHidden() && await page.locator('.ad-back').first().isVisible(), '41 phone: detail with a Back button');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '42 phone: no sideways scroll (detail)');
  await page.locator('.ad-back').first().click(); chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '43 phone: no sideways scroll (list and filters)');
  chk(errs.length === 0, '44 phone: no page errors'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1]));
  console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
