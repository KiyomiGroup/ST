// LOCAL ONLY: headless browser test of admin/payouts.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a17-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var W=[{reference:'wd-a',user_id:'u1',name:'<img src=x onerror=window.__xss=1>Ada',status:'processing',amount:5000,fee:50,net_amount:4950,bank_name:'GTB',account_last4:'6789',transfer_code:'TRF_1',failure_reason:null,created_at:'2026-11-11T10:00:00Z',age_minutes:95,stuck:true,anomaly:false},
         {reference:'wd-b',user_id:'u2',name:'Bola',status:'failed',amount:2000,fee:50,net_amount:1950,bank_name:'Zenith',account_last4:'1111',failure_reason:'ANOMALY: failure reported after a successful payout. Check Paystack by hand.',created_at:'2026-11-10T10:00:00Z',age_minutes:1500,stuck:false,anomaly:true}];
  var L=[{id:'l1',booking_id:'b1',release_key:'final',name:'Mama Ayo',status:'queued',amount:8000,base_amount:9000,fee_total:1000,transfer_fee:null,send_amount:null,attempts:0,release_after:'2026-11-11T08:00:00Z',created_at:'2026-11-11T07:00:00Z',bank_name:'GTB',account_last4:'1234',account_status:'verified',overdue:true},
         {id:'l2',booking_id:'b2',release_key:'final',name:'Samsole',status:'paid',amount:4000.5,base_amount:4500,fee_total:500,send_amount:3900,attempts:2,created_at:'2026-11-08T07:00:00Z',bank_name:null,account_last4:null,overdue:false}];
  var perms=scn.perms;
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['finance'],permissions:perms,mfa_required:false,mfa_ok:true});
   if(scn.down && n!=='admin_my_access') return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_payouts_overview') return ok(scn.quiet?{ok:true,generated_at:'2026-11-11T12:00:00Z',regular:{counts:{},total:0,in_flight_amount:0,in_flight_count:0,stuck:0,anomalies:0,paid_amount:0,fees_amount:0,wallet_balance_total:0,wallet_pending_total:0,wallets_with_balance:0},local:{counts:{},total:0,in_flight_amount:0,in_flight_count:0,overdue:0,needs_review:0,paid_amount:0}}
     :{ok:true,generated_at:'2026-11-11T12:00:00Z',regular:{counts:{processing:1,failed:1,success:3},total:5,in_flight_amount:5000,in_flight_count:1,stuck:1,anomalies:1,paid_amount:29850,fees_amount:150,wallet_balance_total:123456.5,wallet_pending_total:200,wallets_with_balance:4},local:{counts:{queued:1,paid:1},total:2,in_flight_amount:8000,in_flight_count:1,overdue:1,needs_review:0,paid_amount:3900}});
   if(n==='admin_withdrawal_list'){ var r=scn.quiet?[]:W.filter(function(x){return a.p_filter==='all'||(a.p_filter==='stuck'&&x.stuck)||(a.p_filter==='anomaly'&&x.anomaly)||x.status===a.p_filter;}); return ok({ok:true,filter:a.p_filter,offset:a.p_offset,page_size:25,total:r.length,items:r}); }
   if(n==='admin_local_payout_list'){ var q=scn.quiet?[]:L.filter(function(x){return a.p_filter==='all'||(a.p_filter==='overdue'&&x.overdue)||x.status===a.p_filter;}); return ok({ok:true,filter:a.p_filter,offset:a.p_offset,page_size:25,total:q.length,items:q}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/payouts.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: ['payouts.view'] });
  await page.waitForSelector('#poRegList .ad-table'); await page.waitForSelector('#poLocList .ad-table'); await page.waitForSelector('#poRegSummary .ad-stat');
  chk(await page.locator('.ad-nav-link', { hasText: 'Earnings and payouts' }).count() === 1, '1 menu item shown');
  let al = await txt(page, '#poAlerts');
  chk(al.includes('Needs attention') && al.includes('after 15 minutes') && al.includes('ANOMALY') && al.includes('30 minutes after they were due'), '2 stuck, anomaly and overdue warnings shown');
  let rs = await txt(page, '#poRegSummary');
  chk(rs.includes('₦123,456.5') && rs.includes('₦5,000') && rs.includes('₦29,850'), '3 wallet total, in flight and sent amounts shown in naira');
  chk(await page.evaluate(() => window.__xss) === undefined && (await txt(page, '#poRegList')).includes('<img src=x'), '4 markup in a name shown as text, did not run');
  let rl = await txt(page, '#poRegList');
  chk(rl.includes('Stuck 1 h') && rl.includes('Anomaly') && rl.includes('GTB ••••6789'), '5 stuck and anomaly flags, bank shown as last four only');
  chk(!rl.includes('0123456789') && !rl.includes('RCP_'), '6 no full account number or recipient code');
  await page.locator('#poRegList button', { hasText: 'Details' }).first().click();
  const w = await page.evaluate(() => { const d = document.querySelector('#poRegList .ad-detail dd'); return d ? d.getBoundingClientRect().width : 0; });
  chk(w > 150 && (await txt(page, '#poRegList .ad-detail')).includes('TRF_1'), '7 details open full width with the transfer code (dd ' + Math.round(w) + 'px)');
  await page.locator('#poRegTabs button', { hasText: 'Anomalies' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#poRegList tbody tr:not(.ad-detail-row)').length === 1);
  chk((await calls(page, 'admin_withdrawal_list')).pop().a.p_filter === 'anomaly', '8 tab sends its filter to the server');
  let ll = await txt(page, '#poLocList');
  chk(ll.includes('Overdue') && ll.includes('2 attempts') && ll.includes('No account on file') && ll.includes('₦4,000.5'), '9 Local list: overdue, attempts, missing account, decimals kept');
  await page.locator('#poLocTabs button', { hasText: 'Overdue' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#poLocList tbody tr:not(.ad-detail-row)').length === 1);
  chk((await calls(page, 'admin_local_payout_list')).pop().a.p_filter === 'overdue', '10 Local tab sends its filter');
  const btns = await page.locator('#poRoot button:not(.ad-tabs button)').allInnerTexts();
  chk(!btns.some(b => /send|retry|refund|pay now|approve|reverse|delete/i.test(b)), '11 no money-moving or changing button anywhere: ' + [...new Set(btns)].join('|'));
  chk(errs.length === 0, '12 no page errors ' + errs.join('|'));
  await page.screenshot({ path: path.join(ROOT, '..', 'a17-1280.png'), fullPage: false });
  await ctx.close();
  ({ page, ctx } = await open(browser, { perms: [] })); await page.waitForTimeout(500);
  chk(!(await calls(page, 'admin_payouts_overview')).length && await page.locator('#poRoot').isHidden(), '13 no payouts.view: page not shown, no data call');
  await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['payouts.view'], down: true })); await page.waitForSelector('#poRegList .ad-state');
  chk((await txt(page, '#poRegList')).includes('Something went wrong') && !(await txt(page, '#poAlerts')).includes('Nothing is stuck'), '14 server down: error shown, never "nothing is stuck"');
  await ctx.close();
  ({ page, ctx, errs } = await open(browser, { perms: ['payouts.view'], quiet: true }, 390)); await page.waitForSelector('#poRegList .ad-state');
  chk((await txt(page, '#poAlerts')).includes('Nothing is stuck') && (await txt(page, '#poRegList')).includes('No withdrawals yet'), '15 quiet state');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '16 no sideways scroll at 390px');
  await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['payouts.view'] }, 390)); await page.waitForSelector('#poRegList .ad-table');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '17 no sideways scroll at 390px with data');
  await page.screenshot({ path: path.join(ROOT, '..', 'a17-390.png'), fullPage: false });
  await ctx.close(); await browser.close(); srv.close();
  let bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1]));
  console.log(`\n${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);
})();
