// LOCAL ONLY: headless browser test of admin/transactions.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a17-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var T=[{source:'payment_intents',id:'t1',reference:'PI-1',kind:'job',amount_kobo:1250050,status:'paid',occurred_at:'2026-11-10T10:00:00Z',booking_ref:'abcd1234',recon:'matched',party_name:'<img src=x onerror=window.__xss=1>Ada'},
         {source:'payment_intents',id:'t2',reference:'URG-1',kind:'urgent_fee',amount_kobo:50000,status:'paid',occurred_at:'2026-11-09T10:00:00Z',recon:'unverified',party_name:'Bola'},
         {source:'payment_intents',id:'t3',reference:'PI-3',kind:'subscription',amount_kobo:300000,status:'paid',occurred_at:'2026-11-08T10:00:00Z',recon:'needs_review',review_reason:'Paid subscription with no receipt.',party_name:'Chi'},
         {source:'job_refunds',id:'t4',reference:'RF-1',kind:'refund',amount_kobo:100000,status:'recorded',occurred_at:'2026-11-07T10:00:00Z',recon:'unverified',refund_note:'Recorded by support after a dispute.'}];
  var D=[{id:'d1',reference:'DN-1',source:'paystack',status:'paid',amount_kobo:1000000,donor_name:'Zed',donor_email:'z***@mail.com',paid_at:'2026-11-06T10:00:00Z',created_at:'2026-11-06T09:00:00Z',receipt_sent:false,no_receipt:true,stuck:false},
         {id:'d2',reference:'DN-2',source:'bank_transfer',status:'flagged',amount_kobo:50000,donor_name:null,donor_email:null,created_at:'2026-11-05T09:00:00Z',flag_reason:'Odd',receipt_sent:false}];
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['finance'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.down) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_transactions_overview') return ok(scn.quiet?{ok:true,generated_at:'2026-11-11T12:00:00Z',total:0,kinds:{},needs_review:0,unverified_urgent:0,pending_rows:0,failed_rows:0}
     :{ok:true,generated_at:'2026-11-11T12:00:00Z',total:4,kinds:{job:{rows:1,paid_rows:1,paid_kobo:1250050},urgent_fee:{rows:1,paid_rows:1,paid_kobo:50000},subscription:{rows:1,paid_rows:1,paid_kobo:300000},refund:{rows:1,paid_rows:1,paid_kobo:100000}},needs_review:1,unverified_urgent:1,pending_rows:0,failed_rows:0});
   if(n==='admin_transaction_list'){ var r=scn.quiet?[]:T.filter(function(x){return (a.p_kind==='all'||x.kind===a.p_kind)&&(a.p_status==='all'||(a.p_status==='review'&&x.recon==='needs_review')||(a.p_status==='paid'&&(x.status==='paid'||x.status==='recorded')));}); return ok({ok:true,kind:a.p_kind,status:a.p_status,offset:a.p_offset,page_size:25,total:r.length,total_kobo:r.reduce(function(s,x){return s+x.amount_kobo;},0),items:r}); }
   if(n==='admin_donation_list'){ var q=scn.quiet?[]:D.filter(function(x){return a.p_filter==='all'||(a.p_filter==='flagged'&&x.status==='flagged')||(a.p_filter==='no_receipt'&&x.no_receipt)||x.status===a.p_filter;}); return ok({ok:true,filter:a.p_filter,offset:a.p_offset,page_size:25,total:q.length,counts:{paid:1,paid_kobo:1000000,flagged:1,stuck:0,no_receipt:1},items:q}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/transactions.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: ['transactions.view', 'donations.view'] });
  await page.waitForSelector('#txList .ad-table'); await page.waitForSelector('#dnList .ad-table'); await page.waitForSelector('#txSummary .ad-stat');
  chk(await page.locator('.ad-nav-link', { hasText: 'Transactions' }).count() === 1, '1 menu item shown');
  chk((await page.locator('#txList tbody tr:not(.ad-detail-row)').count()) === 4, '2 four payments listed');
  chk((await txt(page, '#txList')).includes('₦12,500.50'), '3 amount exact from kobo');
  chk((await txt(page, '#txList')).includes('Urgent fee') && (await txt(page, '#txList')).includes('Unverified'), '4 urgent fee labelled and unverified');
  chk((await txt(page, '#txSummary')).includes('Never added into one total') && !/Total money/i.test(await txt(page, '#txSummary')), '5 kinds kept apart, no grand total');
  chk((await txt(page, '#txAlerts')).includes('1 record(s) need a look') && (await txt(page, '#txAlerts')).includes('urgent fee'), '6 needs-attention banner');
  chk(await page.evaluate(() => window.__xss !== 1) && (await txt(page, '#txList')).includes('<img'), '7 name shown as text, not HTML');
  chk(await page.locator('#txRoot button', { hasText: /refund|retry|reconcile|mark|approve|resend|delete/i }).filter({ hasNotText: /Refund recorded/ }).count() === 0, '8 no action button');
  await page.locator('#txList .btn', { hasText: 'Details' }).nth(2).click(); await page.waitForSelector('#txList .ad-detail .ad-dl');
  chk((await txt(page, '#txList .ad-detail:not(:empty)')).includes('no receipt'), '9 detail says why it needs a look');
  await page.locator('#txStatus button', { hasText: 'Needs review' }).click(); await page.waitForTimeout(100);
  chk((await page.locator('#txList tbody tr:not(.ad-detail-row)').count()) === 1, '10 review filter');
  await page.locator('#txKinds button', { hasText: 'Gift card' }).click(); await page.waitForTimeout(100);
  chk(await page.locator('#txList .ad-state').count() === 1, '11 no-results state');
  const c = await calls(page, 'admin_transaction_list'); chk(c.some(x => x.a.p_kind === 'gift_card' && x.a.p_status === 'review'), '12 filters sent to server');
  chk((await txt(page, '#dnList')).includes('z***@mail.com') && !(await txt(page, '#dnList')).includes('@mail.com)@'), '13 donor email masked');
  chk((await txt(page, '#dnSummary')).includes('Receipt not sent'), '14 donation counts shown');
  await page.locator('#dnTabs button', { hasText: 'Flagged' }).click(); await page.waitForTimeout(100);
  chk((await page.locator('#dnList tbody tr:not(.ad-detail-row)').count()) === 1, '15 donation filter');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '16 no sideways scroll at 1280');
  chk(errs.length === 0, '17 no page errors ' + errs.join('|')); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['transactions.view', 'donations.view'] }, 390)); await page.waitForSelector('#txList .ad-table');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '18 no sideways scroll at 390'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['transactions.view'] })); await page.waitForSelector('#txList .ad-table');
  chk(await page.locator('#dnCard').isHidden() && (await calls(page, 'admin_donation_list')).length === 0, '19 no donations.view: donations hidden, not requested'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['donations.view'] })); await page.waitForSelector('#dnList .ad-table');
  chk((await calls(page, 'admin_transaction_list')).length === 0 && (await calls(page, 'admin_transactions_overview')).length === 0, '20 donations only: payments not requested'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['transactions.view'], quiet: true })); await page.waitForSelector('#txList .ad-state');
  chk((await txt(page, '#txAlerts')).includes('Nothing needs a look'), '21 quiet state'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['transactions.view'], down: true })); await page.waitForSelector('#txList .ad-state--error, #txAlerts .ad-state--error');
  chk(!(await txt(page, '#txAlerts')).includes('Nothing needs a look'), '22 server down never says nothing needs a look'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['payouts.view'] })); await page.waitForTimeout(600);
  chk(await page.locator('#txRoot').isHidden(), '23 no permission: page stays hidden'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1])); console.log(bad.length ? bad.length + ' FAILED' : 'ALL ' + results.length + ' PASSED'); process.exit(bad.length ? 1 : 0);
})();
