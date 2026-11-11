// LOCAL ONLY: headless browser test of admin/verification.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a17-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var I=[{id:'i1',user_id:'u1',subject_kind:'tasker_regular',name:'<img src=x onerror=window.__xss=1>Ada',status:'REVIEW_REQUIRED',provider_status:'In Review',environment:'live',reason_codes:['FACE_MISMATCH'],provider_session_id:'s1',updated_at:'2026-11-11T10:00:00Z',attempts:2},
         {id:'i2',user_id:'u2',subject_kind:'customer',name:'Bola',status:'VERIFIED',environment:'sandbox',updated_at:'2026-11-10T10:00:00Z',attempts:1},
         {id:'i3',user_id:'u3',subject_kind:'tasker_local',name:'Mama Ayo',status:'RESUBMIT_REQUESTED',environment:'live',updated_at:'2026-11-09T10:00:00Z',attempts:1}];
  var M={pending:['PENDING','IN_PROGRESS'],review:['REVIEW_REQUIRED'],resubmit:['RESUBMIT_REQUESTED'],failed:['FAILED'],verified:['VERIFIED'],unfinished:['NOT_STARTED','EXPIRED','ABANDONED']};
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['verification'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.down) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_verification_overview') return ok(scn.quiet?{ok:true,generated_at:'2026-11-11T12:00:00Z',total:0,by_status:{},by_kind:{},sandbox_rows:0,waiting_review:0,webhook_events:0,events_rejected:0,events_unprocessed:0,consents_active:0,consents_revoked:0,takedowns_open:0,gate:{gate_customers:false,lockdown_enabled:false}}
     :{ok:true,generated_at:'2026-11-11T12:00:00Z',total:3,by_status:{REVIEW_REQUIRED:1,VERIFIED:1,RESUBMIT_REQUESTED:1},by_kind:{tasker_regular:1,customer:1,tasker_local:1},sandbox_rows:1,waiting_review:2,webhook_events:46,events_rejected:1,events_unprocessed:0,consents_active:9,consents_revoked:1,takedowns_open:0,gate:{gate_customers:true,lockdown_enabled:false}});
   if(n==='admin_verification_list'){ var r=scn.quiet?[]:I.filter(function(x){return (a.p_kind==='all'||x.subject_kind===a.p_kind)&&(a.p_filter==='all'||M[a.p_filter].indexOf(x.status)>=0);}); return ok({ok:true,filter:a.p_filter,kind:a.p_kind,offset:a.p_offset,page_size:25,total:r.length,items:r}); }
   if(n==='admin_verification_detail') return ok({ok:true,verification:{id:a.p_id,user_id:'u1',subject_kind:'tasker_regular',provider:'didit',provider_session_id:'s1',environment:'live',status:'REVIEW_REQUIRED',provider_status:'In Review',reason_codes:['FACE_MISMATCH'],liveness_ok:true,face_match_ok:false,document_ok:true,nin_database_match:'partial_match',created_at:'2026-11-10T10:00:00Z'},
     attempts:[{id:'i0',status:'FAILED',subject_kind:'tasker_regular',created_at:'2026-11-09T10:00:00Z'},{id:'i1',status:'REVIEW_REQUIRED',subject_kind:'tasker_regular',created_at:'2026-11-10T10:00:00Z'}],
     events:[{event_id:'e1',webhook_type:'status.updated',provider_status:'In Review',outcome:'applied',received_at:'2026-11-10T10:05:00Z',processed_at:'2026-11-10T10:05:01Z'}],
     consents:[{consent_version:'v2',method:'in_app',recorded_at:'2026-11-10T09:00:00Z',revoked_at:null}],takedowns:[]});
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/verification.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: ['verification.view'] });
  await page.waitForSelector('#ivList .ad-table'); await page.waitForSelector('#ivSummary .ad-stat');
  chk(await page.locator('.ad-nav-link', { hasText: 'Identity verification' }).count() === 1, '1 menu item shown');
  chk((await page.locator('#ivList tbody tr:not(.ad-detail-row)').count()) === 3, '2 three rows listed');
  chk((await txt(page, '#ivAlerts')).includes('2 check(s) need a person'), '3 needs-attention banner');
  chk((await txt(page, '#ivAlerts')).includes('rejected'), '4 rejected provider message shown');
  chk((await txt(page, '#ivSummary')).includes('Customer gate: on'), '5 gate shown, not editable');
  chk(await page.locator('#ivRoot button', { hasText: /verif(y|ied)|approve|retry|mark|reset|delete/i }).filter({ hasNot: page.locator('.nope') }).evaluateAll(b => b.filter(x => !/Review required|Verified$/.test(x.textContent) || /mark|approve|retry/i.test(x.textContent)).length) === 0, '6 no action button');
  chk(await page.evaluate(() => window.__xss !== 1) && (await txt(page, '#ivList')).includes('<img'), '7 name shown as text, not HTML');
  chk((await txt(page, '#ivList')).includes('Additional information'), '8 resubmit shown as Additional information');
  chk((await txt(page, '#ivList')).includes('Test'), '9 sandbox row flagged');
  await page.locator('#ivList .btn', { hasText: 'Details' }).first().click(); await page.waitForSelector('.ad-detail .ad-dl');
  const dt = await txt(page, '.ad-detail');
  chk(dt.includes('Not passed') && dt.includes('Partial match') && dt.includes('FACE_MISMATCH'), '10 detail shows checks, NIN word, reason codes');
  chk(dt.includes('All attempts') && dt.includes('Consent') && dt.includes('status.updated'), '11 attempts, consent, events shown');
  chk(!/id[_ ]number|date of birth|photo/i.test(dt.replace('Person id', '')), '12 no ID number, birth date or photo field');
  await page.locator('#ivTabs button', { hasText: 'Review required' }).click(); await page.waitForTimeout(100);
  chk((await page.locator('#ivList tbody tr:not(.ad-detail-row)').count()) === 1, '13 review tab filters');
  const c = await calls(page, 'admin_verification_list'); chk(c.some(x => x.a.p_filter === 'review'), '14 filter sent to server');
  await page.locator('#ivKinds button', { hasText: 'Customers' }).click(); await page.waitForTimeout(100);
  chk(await page.locator('#ivList .ad-state').count() === 1, '15 no-results state for review + customers');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '16 no sideways scroll at 1280');
  chk(errs.length === 0, '17 no page errors ' + errs.join('|')); await ctx.close();
  ({ page, ctx, errs } = await open(browser, { perms: ['verification.view'] }, 390));
  await page.waitForSelector('#ivList .ad-table');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '18 no sideways scroll at 390'); await ctx.close();
  ({ page, ctx, errs } = await open(browser, { perms: ['verification.view'], quiet: true }));
  await page.waitForSelector('#ivList .ad-state');
  chk((await txt(page, '#ivAlerts')).includes('No check is waiting'), '19 quiet state says nothing waiting'); await ctx.close();
  ({ page, ctx, errs } = await open(browser, { perms: ['verification.view'], down: true }));
  await page.waitForSelector('#ivList .ad-state--error, #ivAlerts .ad-state--error');
  chk(!(await txt(page, '#ivAlerts')).includes('No check is waiting'), '20 server down never says nothing is waiting'); await ctx.close();
  ({ page, ctx, errs } = await open(browser, { perms: ['payouts.view'] }));
  await page.waitForTimeout(600);
  chk(await page.locator('#ivRoot').isHidden(), '21 no permission: page stays hidden'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1])); console.log(bad.length ? bad.length + ' FAILED' : 'ALL ' + results.length + ' PASSED'); process.exit(bad.length ? 1 : 0);
})();
