// LOCAL ONLY: headless browser test of admin/bookings.html against a FAKE Supabase. Proves layout and logic, not real data.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = process.argv[2]; const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
const REG = [
  { id: 'b1', status: 'confirmed', payment_status: 'paid', work_stage: 'arrived', amount: 25000, created_at: '2026-11-01T10:00:00Z', customer_name: '<img src=x onerror=window.__xss=1>Ada', tasker_name: 'Tunde', locked: false, disputed: false },
  { id: 'b2', status: 'pending', payment_status: 'unpaid', amount: 8000, created_at: '2026-11-02T10:00:00Z', customer_name: 'Bola', tasker_name: 'Tunde', locked: true, disputed: false },
  { id: 'b3', status: 'completed', payment_status: 'released', amount: 12000, created_at: '2026-10-20T10:00:00Z', customer_name: 'Chi', tasker_name: 'Sade', locked: false, disputed: true },
  { id: 'b4', status: 'cancelled', payment_status: null, amount: null, created_at: '2026-10-10T10:00:00Z', customer_name: 'Dayo', tasker_name: null, locked: false, disputed: false }];
const LOC = [
  { id: 'l1', status: 'confirmed', lt_status: 'needs_reassignment', amount: 15000, created_at: '2026-11-03T10:00:00Z', customer_name: 'Eke', tasker_name: 'Mama Ayo', coordinator_name: 'Coord One' },
  { id: 'l2', status: 'pending', lt_status: 'quote_sent', amount: 9000, created_at: '2026-11-04T10:00:00Z', customer_name: 'Femi', tasker_name: 'Samsole', coordinator_name: 'Coord Two' }];
const TASKS = [
  { id: 't1', title: '<b>Fix my sink</b>', status: 'open', budget: 5000, location: 'Yaba', created_at: '2026-11-05T10:00:00Z', owner_name: 'Gina' },
  { id: 't2', title: 'Paint a wall', status: 'in_progress', budget: 20000, location: 'Lekki', created_at: '2026-11-01T10:00:00Z', owner_name: 'Hassan' }];
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; var REG=${JSON.stringify(REG)}, LOC=${JSON.stringify(LOC)}, TASKS=${JSON.stringify(TASKS)}; window.__calls=[];
  var perms=scn.perms; window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['operations'],permissions:perms,mfa_required:false,mfa_ok:true});
   if(scn.missing && (n==='admin_booking_list'||n==='admin_task_list'||n==='admin_booking_detail')) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(scn.denied && n!=='admin_my_access') return ok({ok:false,error:'You do not have permission to do this.'});
   if(n==='admin_booking_list'){
     var src=a.p_kind==='local'?LOC:REG;
     var rows=src.filter(function(x){ if(a.p_search && (x.customer_name||'').toLowerCase().indexOf(a.p_search.toLowerCase())<0) return false;
       if(a.p_filter==='all') return true; if(a.p_kind==='local') return x.lt_status===a.p_filter; if(a.p_filter==='locked') return x.locked; if(a.p_filter==='disputed') return x.disputed; return x.status===a.p_filter; });
     if(scn.many&&a.p_kind==='regular'){ rows=[]; for(var i=0;i<50;i++) rows.push({id:'m'+(a.p_offset+i),status:'pending',customer_name:'Many '+(a.p_offset+i),created_at:'2026-11-01T10:00:00Z'}); }
     return ok({ok:true,kind:a.p_kind,total:scn.many?120:rows.length,offset:a.p_offset||0,page_size:50,items:rows,
       counts:a.p_kind==='local'?{all:2,needs_reassignment:1,assigned:0,awaiting_tasker_confirmation:0,tasker_confirmed:0,tasker_declined:0,quote_sent:1,quote_approved:0,quote_declined:0}:{all:4,pending:1,confirmed:1,completed:1,cancelled:1,other:0,locked:1,disputed:1}}); }
   if(n==='admin_task_list'){ var tr=TASKS.filter(function(x){return a.p_filter==='all'||x.status===a.p_filter;}); return ok({ok:true,total:tr.length,offset:0,page_size:50,items:tr,counts:{all:2,open:1,in_progress:1,completed:0,cancelled:0,draft:0,other:0}}); }
   if(n==='admin_booking_detail'){
     var loc=/^l/.test(a.p_booking);
     if(scn.partial) return ok({ok:true,booking:{id:a.p_booking,status:'confirmed',customer_name:'Ada',tasker_name:'Tunde',amount:25000,payment_status:'paid',code_attempts:0,locked:false,created_at:'2026-11-01T10:00:00Z'},local:null,timeline:null,payment:null,disputes:null,sections_failed:['timeline','payment','disputes']});
     return ok({ok:true,booking:{id:a.p_booking,status:'confirmed',payment_status:'paid',work_stage:'arrived',amount:25000,scheduled_time:'2026-11-06T09:00:00Z',created_at:'2026-11-01T10:00:00Z',customer_name:'Ada',tasker_name:'Tunde',task_title:'Fix my sink',code_attempts:3,locked:true,dispute_reason:'Work not finished'},
       local:loc?{lt_status:'quote_sent',coordinator_name:'Coord One',original_coordinator_name:'Coord Zero',worker_name:'Mama Ayo'}:null,
       quote:loc?{version:2,service_fee:9000,transport_amount:1000,materials_amount:2000}:null,
       milestones:loc?[{kind:'arrived',created_at:'2026-11-06T09:00:00Z'}]:undefined, exceptions:loc?[{kind:'customer_unreachable',created_at:'2026-11-06T09:30:00Z',resolved_at:null}]:undefined, local_events:loc?[{kind:'assigned',created_at:'2026-11-03T10:00:00Z'}]:undefined,
       timeline:[{kind:'created',created_at:'2026-11-01T10:00:00Z'},{kind:'confirmed',created_at:'2026-11-02T10:00:00Z'}],
       payment:[{status:'held',amount:25000,platform_fee:3000,tasker_amount:22000,created_at:'2026-11-02T10:00:00Z'}],
       disputes:[{status:'open',category:'quality',opened_by_role:'customer',opened_at:'2026-11-07T10:00:00Z'}],sections_failed:[]}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/bookings.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: ['bookings.view'] });
  await page.waitForSelector('#bkBody .ad-row');
  chk(await page.locator('.ad-nav-link', { hasText: 'Bookings and Tasks' }).count() === 1, '1 menu item shown');
  chk(await page.locator('#bkBody .ad-rows .ad-row').count() === 4, '2 four bookings listed');
  chk(await page.evaluate(() => window.__xss) === undefined && (await txt(page, '#bkBody')).includes('<img src=x'), '3 markup in a name shown as plain text, did not run');
  let t = await txt(page, '#bkBody');
  chk(t.includes('1 pending') && t.includes('1 confirmed') && t.includes('1 with the completion code locked'), '4 summary counts shown');
  chk(t.includes('Code locked') && t.includes('Dispute reason') && t.includes('₦25,000'), '5 locked and dispute badges and the amount shown on rows');
  chk((await page.locator('#bkFilter option').allInnerTexts()).length === 8 && (await page.locator('#bkTabs button').allInnerTexts()).join('|') === 'Bookings|Local bookings|Tasks', '6 filter choices and three tabs');
  // filter and search
  await page.locator('#bkFilter').selectOption('locked'); await page.locator('#bkFilters button[type=submit]').click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 1);
  let l = (await calls(page, 'admin_booking_list')).pop(); chk(l.a.p_filter === 'locked' && l.a.p_kind === 'regular' && l.a.p_offset === 0, '7 filter and kind sent to the server');
  await page.locator('#bkFilters button', { hasText: 'Reset' }).click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 4);
  await page.locator('#bkSearch').fill('bola'); await page.locator('#bkFilters button[type=submit]').click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 1);
  l = (await calls(page, 'admin_booking_list')).pop(); chk(l.a.p_search === 'bola', '8 search sent to the server');
  await page.locator('#bkSearch').fill('zzzz'); await page.locator('#bkFilters button[type=submit]').click(); await page.waitForSelector('#bkBody .ad-state');
  chk((await txt(page, '#bkBody')).includes('Nothing matches'), '9 no-results state');
  await page.locator('#bkFilters button', { hasText: 'Reset' }).click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 4);
  // detail
  await page.locator('.ad-row', { hasText: 'Ada' }).click(); await page.waitForSelector('text=Payment held for this booking');
  let d = await txt(page, '#bkBody .ad-split-detail');
  chk(d.includes('Fix my sink') && d.includes('₦25,000') && d.includes('Locked after wrong tries (3)') && d.includes('Work not finished'), '10 booking facts, locked code and dispute reason shown');
  chk(d.includes('₦3,000') && d.includes('₦22,000') && d.includes('never releases, refunds or changes a payment'), '11 payment read only with the no-money note');
  chk(d.includes('quality') && d.includes('Timeline') && d.includes('confirmed'), '12 disputes and timeline shown');
  chk(!/street address:|completion code:\s*\d|0803|\+234/i.test(d) && d.includes('private and are not shown'), '13 no address, code or phone, and the privacy note shown');
  chk(await page.locator('#bkBody .ad-split-detail button:not(.ad-back), #bkBody .ad-split-detail input, #bkBody .ad-split-detail textarea').count() === 0, '14 no action button or input in the detail (read only)');
  chk(await page.locator('#bkBody .ad-split-detail h2', { hasText: 'Local booking' }).count() === 0, '15 no Local panel on a regular booking');
  // local tab
  await page.locator('#bkTabs button', { hasText: 'Local bookings' }).click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 2);
  chk((await calls(page, 'admin_booking_list')).pop().a.p_kind === 'local' && (await page.locator('#bkFilter option').allInnerTexts()).includes('Needs a coordinator'), '16 Local tab asks for kind local and shows Local filters');
  t = await txt(page, '#bkBody'); chk(t.includes('1 need a coordinator') && t.includes('Coordinator: Coord One') && t.includes('Needs a coordinator'), '17 Local queue counts and coordinator shown');
  await page.locator('#bkFilter').selectOption('needs_reassignment'); await page.locator('#bkFilters button[type=submit]').click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 1);
  await page.locator('.ad-row', { hasText: 'Eke' }).click(); await page.waitForSelector('text=Local booking history');
  d = await txt(page, '#bkBody .ad-split-detail');
  chk(d.includes('Mama Ayo') && d.includes('Coord Zero') && d.includes('version 2') && d.includes('₦9,000') && d.includes('never sets or changes a price'), '18 Local detail: worker, first coordinator, quote read only');
  chk(d.includes('customer unreachable') && d.includes('Open') && d.includes('arrived'), '19 on-site steps and problems shown');
  // tasks tab
  await page.locator('#bkTabs button', { hasText: 'Tasks' }).click(); await page.waitForFunction(() => document.querySelectorAll('#bkBody .ad-rows .ad-row').length === 2);
  t = await txt(page, '#bkBody'); chk(t.includes('<b>Fix my sink</b>') && t.includes('Posted by Gina') && t.includes('₦5,000') && await page.locator('#bkBody b').count() === 0, '20 tasks listed, title shown as text');
  chk(await page.locator('#bkBody .ad-split').count() === 0, '21 tasks have no detail panel');
  // no write ever
  const names = await page.evaluate(() => window.__calls.map(c => c.n));
  chk(names.every(n => ['admin_my_access', 'admin_booking_list', 'admin_booking_detail', 'admin_task_list'].includes(n)), '22 only the four read functions were ever called');
  chk(errs.length === 0, '23 no page errors (' + errs.join(';') + ')'); await ctx.close();
  // paging
  ({ page, ctx, errs } = await open(browser, { perms: ['bookings.view'], many: true })); await page.waitForSelector('#bkBody .ad-row');
  chk((await txt(page, '#bkBody')).includes('Showing 1 to 50 of 120'), '24 paging text');
  await page.locator('#bkBody .ad-pager button', { hasText: 'Next' }).click(); await page.waitForFunction(() => document.body.innerText.includes('Showing 51 to 100'));
  chk((await calls(page, 'admin_booking_list')).pop().a.p_offset === 50, '25 next page asks for offset 50'); await ctx.close();
  // partial detail
  ({ page, ctx, errs } = await open(browser, { perms: ['bookings.view'], partial: true })); await page.waitForSelector('#bkBody .ad-row');
  await page.locator('.ad-row', { hasText: 'Ada' }).click(); await page.waitForSelector('text=Some parts could not be read');
  d = await txt(page, '#bkBody .ad-split-detail'); chk(d.includes('timeline') && d.includes('payment status') && d.includes('disputes') && d.includes('Not available'), '26 a failed section is named and shown as not available'); await ctx.close();
  // missing function
  ({ page, ctx, errs } = await open(browser, { perms: ['bookings.view'], missing: true })); await page.waitForSelector('#bkBody .ad-state');
  chk((await txt(page, '#bkBody')).includes('a12a-bookings.sql'), '27 missing function names the file to run'); await ctx.close();
  // denied by the server
  ({ page, ctx, errs } = await open(browser, { perms: ['bookings.view'], denied: true })); await page.waitForSelector('#bkBody .ad-state');
  chk((await txt(page, '#bkBody')).includes('do not have permission'), '28 a server refusal is shown'); await ctx.close();
  // no permission
  ({ page, ctx, errs } = await open(browser, { perms: ['disputes.manage'] })); await page.waitForSelector('#adMain .ad-state');
  chk((await txt(page, '#adMain')).includes('do not have access') && await page.locator('.ad-nav-link', { hasText: 'Bookings and Tasks' }).count() === 0, '29 no permission: access message, menu item hidden');
  chk((await calls(page, 'admin_booking_list')).length === 0, '30 no permission: the list function is never called'); await ctx.close();
  // phone layout
  ({ page, ctx, errs } = await open(browser, { perms: ['bookings.view'] }, 390)); await page.waitForSelector('#bkBody .ad-row');
  await page.locator('.ad-row', { hasText: 'Ada' }).click(); await page.waitForSelector('text=Payment held for this booking');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '31 no sideways scroll at 390px');
  chk(errs.length === 0, '32 no page errors on the phone layout'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1]));
  console.log(bad.length ? `FAILED ${bad.length} of ${results.length}` : `ALL PASS (${results.length})`); process.exit(bad.length ? 1 : 0);
})();
