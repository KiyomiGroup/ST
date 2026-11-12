// LOCAL ONLY: headless browser test of admin/revenue.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a16-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var Z={kobo:0,rows:0};
  var STREAMS=scn.quiet?{regular_commission:Z,local_commission:Z,subscription:Z,coordinator_plan:Z,withdrawal_fee:Z,coordinator_share:Z}
   :{regular_commission:{kobo:25000050,rows:4},local_commission:{kobo:30000,rows:1},subscription:{kobo:300000,rows:1},coordinator_plan:{kobo:500050,rows:1},withdrawal_fee:{kobo:0,rows:0},coordinator_share:{kobo:50000,rows:1}};
  var SER=[{period:'2026-10-26',regular_commission:0,local_commission:0,subscription:0,coordinator_plan:0,withdrawal_fee:0,coordinator_share:0},
           {period:'2026-11-02',regular_commission:60000,local_commission:0,subscription:300000,coordinator_plan:500050,withdrawal_fee:0,coordinator_share:0},
           {period:'2026-11-09',regular_commission:24940050,local_commission:30000,subscription:0,coordinator_plan:0,withdrawal_fee:0,coordinator_share:50000}];
  var ITEMS=[{occurred_at:'2026-11-10T09:00:00Z',amount_kobo:12000050,reference:'<img src=x onerror=window.__xss=1>',booking_ref:'aaaa1111',note:'Platform fee on a job done by a Regular Tasker.'},
             {occurred_at:'2026-11-02T09:00:00Z',amount_kobo:60000,reference:'w2',booking_ref:'bbbb2222',note:'Platform fee on a job done by a Regular Tasker.'}];
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['finance'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.down) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_revenue_report'){
     if(scn.refuse) return ok({ok:false,error:'Choose a range of 400 days or less.'});
     var from=a.p_from||'2026-10-26', to=a.p_to||'2026-11-12';
     return ok({ok:true,generated_at:'2026-11-12T12:00:00Z',bucket:a.p_bucket,from:from,to:to,timezone:'Africa/Lagos',streams:STREAMS,series:scn.quiet?SER.map(function(x){return Object.assign({},x);}):SER,held:{kobo:350025,rows:2}}); }
   if(n==='admin_revenue_list'){ var it=a.p_offset>0?[]:ITEMS; return ok({ok:true,stream:a.p_stream,from:a.p_from,to:a.p_to,offset:a.p_offset,page_size:25,total:ITEMS.length,total_kobo:12060050,items:it}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/revenue.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: ['revenue.view'] });
  await page.waitForSelector('#rvSummary .ad-stat'); await page.waitForSelector('#rvSeries .ad-table');
  chk(await page.locator('.ad-nav-link', { hasText: 'Revenue and commissions' }).count() === 1, '1 menu item shown');
  const sum = await txt(page, '#rvSummary');
  chk(sum.includes('₦250,000.50') && /₦300(\s|$)/.test(sum) && sum.includes('₦3,000') && sum.includes('₦5,000.50'), '2 exact amounts from kobo in each box');
  chk(await page.locator('#rvSummary .ad-stat').count() === 7, '3 five platform boxes + memo + held = 7, each apart');
  chk(sum.includes('Local Tasker jobs are not in this box') && sum.includes('Paystack bills its own transfer cost'), '4 definitions printed under the numbers');
  chk(!/grand total|total revenue|all income/i.test(sum.replace('never added into one total','')) && sum.includes('never added into one total'), '5 no grand total, says so');
  chk(sum.includes('Coordinator share (not platform income)'), '6 coordinator share labelled as not platform income');
  chk(sum.includes('Commission held, not earned yet') && sum.includes('₦3,500.25'), '7 held commission shown apart');
  const rowsTxt = await page.locator('#rvSeries tbody tr').allInnerTexts();
  chk(rowsTxt.length === 3 && rowsTxt[0].includes('Week of 9 Nov 2026') && rowsTxt[2].includes('Week of 26 Oct 2026'), '8 series newest first, week labels');
  chk(await page.locator('#rvRoot button', { hasText: /refund|adjust|export|approve|delete|reconcile|mark|pay/i }).count() === 0, '9 no action button');
  chk(await page.locator('#rvFrom').inputValue() === '2026-10-26' && await page.locator('#rvTo').inputValue() === '2026-11-12', '10 server default range shown in the date boxes');
  chk(await page.locator('#rvSummary button', { hasText: 'Show rows' }).nth(4).isDisabled(), '11 box with 0 records has Show rows disabled');
  await page.locator('#rvSummary button', { hasText: 'Show rows' }).first().click(); await page.waitForSelector('#rvRows .ad-table');
  chk((await txt(page, '#rvRowsTitle')).includes('Regular Tasker commission'), '12 rows panel named for the box');
  chk(await page.evaluate(() => window.__xss !== 1) && (await txt(page, '#rvRows')).includes('<img'), '13 reference shown as text, not HTML');
  const lc = await calls(page, 'admin_revenue_list'); chk(lc.length === 1 && lc[0].a.p_stream === 'regular_commission' && lc[0].a.p_from === '2026-10-26', '14 list asks for that stream and range');
  chk((await txt(page, '#rvRowsCount')).includes('₦120,600.50'), '15 list total shown');
  await page.selectOption('#rvBucket', 'month'); await page.fill('#rvFrom', '2026-09-01'); await page.fill('#rvTo', '2026-11-12'); await page.locator('#rvFilters button[type=submit]').click(); await page.waitForTimeout(150);
  const rc = await calls(page, 'admin_revenue_report'); const last = rc[rc.length - 1];
  chk(last.a.p_bucket === 'month' && last.a.p_from === '2026-09-01' && last.a.p_to === '2026-11-12', '16 bucket and dates sent to the server');
  chk(await page.locator('#rvRowsCard').isHidden(), '17 rows panel closes when the report changes');
  await page.locator('#rvReset').click(); await page.waitForTimeout(150);
  const r2 = await calls(page, 'admin_revenue_report'); const l2 = r2[r2.length - 1]; chk(l2.a.p_bucket === 'week' && l2.a.p_from === null && l2.a.p_to === null, '18 reset sends week and no dates');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '19 no sideways scroll at 1280');
  chk(errs.length === 0, '20 no page errors ' + errs.join('|')); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['revenue.view'] }, 390)); await page.waitForSelector('#rvSeries .ad-table');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '21 no sideways scroll at 390'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['revenue.view'], quiet: true })); await page.waitForSelector('#rvSummary .ad-stat');
  chk((await txt(page, '#rvAlerts')).includes('Nothing was earned in this period') && (await txt(page, '#rvSummary')).includes('₦0'), '22 quiet period says so'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['revenue.view'], refuse: true })); await page.waitForSelector('#rvSummary .ad-state--error');
  chk((await txt(page, '#rvSummary')).includes('400 days') && !(await txt(page, '#rvRoot')).includes('Nothing was earned'), '23 server refusal shown, never "nothing earned"'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['revenue.view'], down: true })); await page.waitForSelector('#rvSummary .ad-state--error');
  chk(!(await txt(page, '#rvRoot')).includes('Nothing was earned'), '24 server down never says nothing was earned'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['transactions.view'] })); await page.waitForTimeout(600);
  chk(await page.locator('#rvRoot').isHidden() && (await calls(page, 'admin_revenue_report')).length === 0, '25 no revenue.view: page hidden, nothing requested'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1])); console.log(bad.length ? bad.length + ' FAILED' : 'ALL ' + results.length + ' PASSED'); process.exit(bad.length ? 1 : 0);
})();
