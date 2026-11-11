// LOCAL ONLY: headless browser test of admin/accountant.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a15b2-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var reports=[
   {report_date:'2026-11-11',window_start:'2026-11-10T20:00:00Z',window_end:'2026-11-11T20:00:00Z',jobs_released:2,tasker_kobo:1250050,regular_kobo:1000050,local_kobo:250000,coordinator_kobo:null,platform_kobo:150000,customer_kobo:1400050,status:'to_send'},
   {report_date:'2026-11-10',window_start:'2026-11-09T20:00:00Z',window_end:'2026-11-10T20:00:00Z',jobs_released:0,tasker_kobo:0,regular_kobo:0,local_kobo:0,coordinator_kobo:0,platform_kobo:0,customer_kobo:0,status:'no_release'},
   {report_date:'2026-11-09',window_start:'2026-11-08T20:00:00Z',window_end:'2026-11-09T20:00:00Z',jobs_released:1,tasker_kobo:500000,regular_kobo:500000,local_kobo:0,coordinator_kobo:0,platform_kobo:60000,customer_kobo:560000,status:'sent',sent_kobo:500000,sent_at:'2026-11-09T21:00:00Z'}];
  var entries=[
   {id:3,entry_at:'2026-11-10T10:00:00Z',label:'expense_hosting',title:'Hosting and database',group_name:'Fees and costs',direction:'out',amount_kobo:500000,reference:'INV-1',note:'<img src=x onerror=window.__xss=1>',auto:false,reversed:false},
   {id:2,entry_at:'2026-11-09T10:00:00Z',label:'capital_in',title:'Owner put money in',group_name:'Owner capital',direction:'in',amount_kobo:20000000,auto:false,reversed:false},
   {id:1,entry_at:'2026-11-08T10:00:00Z',label:'platform_commission',title:'Platform commission',group_name:'Platform income',direction:'memo',amount_kobo:60000,booking_ref:'b9',auto:true,reversed:false},
   {id:4,entry_at:'2026-11-07T10:00:00Z',label:'expense_tax',title:'Tax',group_name:'Fees and costs',direction:'out',amount_kobo:1000,auto:false,reversed:true}];
  var perms=scn.perms;
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['accountant'],permissions:perms,mfa_required:false,mfa_ok:true});
   if(scn.down && n!=='admin_my_access') return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_accountant_reports') return ok({ok:true,generated_at:'2026-11-11T20:05:00Z',reports:scn.empty?[]:reports});
   if(n==='admin_accountant_profit') return ok({ok:true,generated_at:'2026-11-11T20:05:00Z',income:[{label:'platform_commission',title:'Platform commission',amount_kobo:60000}],costs:[{label:'expense_hosting',title:'Hosting and database',amount_kobo:500000}],income_kobo:60000,costs_kobo:500000,profit_kobo:-440000,complete:false,missing_cost_entries:['Email service','Domain']});
   if(n==='admin_accountant_ledger'){
     var e=entries.filter(function(x){return !a.p_label||x.label===a.p_label;});
     return ok({ok:true,generated_at:'2026-11-11T20:05:00Z',totals:[{label:'capital_in',title:'Owner put money in',group:'Owner capital',direction:'in',entries:1,amount_kobo:20000000},{label:'capital_repaid',title:'Owner took money back',group:'Owner capital',direction:'out',entries:1,amount_kobo:5000000}],entries:a.p_limit===1?[]:e}); }
   if(n==='admin_accountant_mark_sent'){ if(scn.refuse) return ok({ok:false,error:'This day is already marked as sent.'}); reports[0].status='sent'; reports[0].sent_kobo=a.p_amount_kobo; return ok({ok:true}); }
   if(n==='admin_accountant_record') return ok({ok:true,id:9});
   if(n==='admin_accountant_reverse'){ entries[0].reversed=true; return ok({ok:true,id:10}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/accountant.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
const FULL = ['accounting.view', 'accounting.record', 'accounting.capital'];
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: FULL });
  await page.waitForSelector('#acLedger .ad-table'); await page.waitForSelector('#acReports .ad-table'); await page.waitForSelector('#acProfit .ad-stat');
  chk(await page.locator('.ad-nav-link', { hasText: 'Accountant' }).count() === 1, '1 menu item shown');
  let due = await txt(page, '#acDue');
  chk(due.includes('1 day is waiting') && due.includes('₦12,500.50') && due.includes('does not send anything'), '2 amount waiting shown with the no-send note');
  let rep = await txt(page, '#acReports');
  chk(rep.includes('To send') && rep.includes('Nothing due') && rep.includes('Sent') && rep.includes('₦5,000'), '3 three statuses and the sent amount shown');
  let pr = await txt(page, '#acProfit');
  chk(pr.includes('Profit (not final)') && pr.includes('-₦4,400') && pr.includes('Email service, Domain'), '4 profit marked not final with the missing categories');
  chk((await txt(page, '#acCapital')).includes('₦150,000') && (await txt(page, '#acCapital')).includes('Outstanding'), '5 capital outstanding = put in minus repaid');
  chk(await page.evaluate(() => window.__xss) === undefined && (await txt(page, '#acLedger')).includes('<img src=x'), '6 markup in a note shown as text, did not run');
  let led = await txt(page, '#acLedger');
  chk(led.includes('Reversed') && led.includes('Site') && led.includes('Typed') && led.includes('₦5,000'), '7 ledger shows reversed, site and typed lines');
  chk(await page.locator('#acLedger button', { hasText: 'Reverse' }).count() === 2, '8 reverse offered only on typed, not-reversed lines (hosting, capital)');
  // mark sent: differing amount without reason refused client side, no call made
  await page.locator('#acReports button', { hasText: 'Record as sent' }).click();
  await page.locator('#acReports input').first().fill('1000');
  await page.locator('#acReports button', { hasText: 'I sent this amount' }).click();
  chk((await txt(page, '#acReports .ad-error')).includes('reason') && (await calls(page, 'admin_accountant_mark_sent')).length === 0, '9 different amount without a reason refused before any call');
  await page.locator('#acReports input').first().fill('1000.555');
  await page.locator('#acReports button', { hasText: 'I sent this amount' }).click();
  chk((await txt(page, '#acReports .ad-error')).includes('plain number'), '10 three decimals refused');
  await page.locator('#acReports input').first().fill('12,500.50');
  await page.locator('#acReports button', { hasText: 'I sent this amount' }).click();
  await page.waitForFunction(() => document.querySelector('#acDue').innerText.includes('Nothing is waiting'));
  let ms = (await calls(page, 'admin_accountant_mark_sent'))[0];
  chk(ms && ms.a.p_amount_kobo === 1250050 && ms.a.p_date === '2026-11-11', '11 exact kobo sent (1250050), no float drift');
  // typed entry
  await page.locator('#rLabel').selectOption('expense_other'); await page.locator('#rAmount').fill('2500'); await page.locator('#rNote').fill('short');
  await page.locator('#rSave').click();
  chk((await txt(page, '#rError')).includes('10 characters') && (await calls(page, 'admin_accountant_record')).length === 0, '12 Other expense needs a 10 character note');
  await page.locator('#rNote').fill('Printed flyers for launch'); await page.locator('#rRef').fill('R-77');
  await page.locator('#rSave').click(); await page.waitForFunction(() => window.__calls.some(c => c.n === 'admin_accountant_record'));
  let rc = (await calls(page, 'admin_accountant_record'))[0];
  chk(rc.a.p_label === 'expense_other' && rc.a.p_amount_kobo === 250000 && rc.a.p_reference === 'R-77', '13 typed entry sent with kobo amount, label and reference');
  chk(!(await page.locator('#rLabel option[value=paystack_topup]').count()) && !(await page.locator('#rLabel option[value=reversal]').count()), '14 top-up and reversal labels are not offered in the form');
  // reverse
  await page.locator('#acLedger button', { hasText: 'Reverse' }).first().click();
  await page.locator('#acLedger input').first().fill('short'); await page.locator('#acLedger button', { hasText: 'Add the reversal' }).click();
  chk((await txt(page, '#acLedger .ad-error')).includes('10 characters') && (await calls(page, 'admin_accountant_reverse')).length === 0, '15 reversal needs a 10 character reason');
  await page.locator('#acLedger input').first().fill('Wrong amount typed'); await page.locator('#acLedger button', { hasText: 'Add the reversal' }).click();
  await page.waitForFunction(() => window.__calls.some(c => c.n === 'admin_accountant_reverse'));
  chk((await calls(page, 'admin_accountant_reverse'))[0].a.p_entry === 3, '16 reversal sent for the chosen entry');
  // filters
  await page.locator('#fLabel').selectOption('capital_in'); await page.locator('#acLedForm button[type=submit]').click();
  await page.waitForFunction(() => document.querySelectorAll('#acLedger tbody tr').length === 1);
  let lg = (await calls(page, 'admin_accountant_ledger')).pop(); chk(lg.a.p_label === 'capital_in' && lg.a.p_offset === 0, '17 label filter sent to the server');
  await page.locator('#fFrom').fill('2026-11-01'); await page.locator('#acLedForm button[type=submit]').click(); await page.waitForTimeout(100);
  lg = (await calls(page, 'admin_accountant_ledger')).pop(); chk(lg.a.p_from === '2026-10-31T23:00:00.000Z', '18 date filter uses Nigeria midnight (UTC+1)');
  chk(errs.length === 0, '19 no page errors ' + errs.join('|'));
  await page.screenshot({ path: path.join(ROOT, '..', 'a15b2-1280.png'), fullPage: true });
  await ctx.close();
  // view-only role
  ({ page, ctx, errs } = await open(browser, { perms: ['accounting.view'] }));
  await page.waitForSelector('#acLedger .ad-table');
  chk(await page.locator('#acFormCard').isHidden() && await page.locator('#acReports button', { hasText: 'Record as sent' }).count() === 0 && await page.locator('#acLedger button', { hasText: 'Reverse' }).count() === 0, '20 view-only: no form, no record button, no reverse');
  chk((await txt(page, '#acReports')).includes('needs the Record permission'), '21 view-only told why');
  await ctx.close();
  // record without capital permission
  ({ page, ctx } = await open(browser, { perms: ['accounting.view', 'accounting.record'] }));
  await page.waitForSelector('#acLedger .ad-table');
  chk(await page.locator('#rLabel option[value=capital_in]').count() === 0 && await page.locator('#acLedger button', { hasText: 'Reverse' }).count() === 1, '22 no capital choice and no capital reverse without accounting.capital');
  await ctx.close();
  // no permission
  ({ page, ctx } = await open(browser, { perms: [] })); await page.waitForTimeout(500);
  chk(!(await calls(page, 'admin_accountant_reports')).length && (await page.locator('#acRoot').isHidden()), '23 no accounting.view: page not shown, no data call');
  await ctx.close();
  // functions missing
  ({ page, ctx } = await open(browser, { perms: FULL, down: true })); await page.waitForSelector('#acReports .ad-state');
  chk((await txt(page, '#acReports')).includes('Something went wrong') && !(await txt(page, '#acReports')).includes('₦0'), '24 server down: error state, no invented zero');
  await ctx.close();
  // empty and phone width
  ({ page, ctx, errs } = await open(browser, { perms: FULL, empty: true }, 390)); await page.waitForSelector('#acReports .ad-state');
  chk((await txt(page, '#acDue')).includes('No daily report has been built yet'), '25 empty state');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '26 no sideways scroll at 390px');
  await page.screenshot({ path: path.join(ROOT, '..', 'a15b2-390.png'), fullPage: true });
  await ctx.close(); await browser.close(); srv.close();
  let bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1]));
  console.log(`\n${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);
})();
