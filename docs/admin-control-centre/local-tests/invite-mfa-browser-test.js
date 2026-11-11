// LOCAL ONLY: headless browser test of the authenticator step on admin/accept-invite.html against a FAKE Supabase.
// Run: node invite-mfa-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[]; window.__redirect=null;
  var QR='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>';
  function ok(d){return {data:d,error:null};}
  window.supabase={ auth:{
    getSession:function(){ return Promise.resolve({data:{session:scn.nosession?null:{user:{id:'me'}}}}); },
    updateUser:function(a){ window.__calls.push({n:'updateUser'}); return Promise.resolve(scn.samepw?{data:null,error:{message:'New password should be different from the old password.'}}:ok({})); },
    signOut:function(){ window.__calls.push({n:'signOut'}); return Promise.resolve({}); },
    mfa:{ listFactors:function(){ return Promise.resolve(ok({totp:scn.hasFactor?[{id:'f0',status:'verified'}]:[],all:[]})); },
      enroll:function(a){ window.__calls.push({n:'enroll'}); return Promise.resolve(ok({id:'f1',totp:{qr_code:QR,secret:'JBSWY3DPEHPK3PXP'}})); },
      unenroll:function(){ return Promise.resolve(ok({})); },
      challengeAndVerify:function(a){ window.__calls.push({n:'verify',a:a}); if(a.code==='123456') window.name=JSON.stringify(a); return Promise.resolve(a.code==='123456'?ok({}):{data:null,error:{message:'Invalid TOTP code entered'}}); } } },
   rpc:function(n){ window.__calls.push({n:n}); return Promise.resolve(n==='admin_my_access'?ok({active:!scn.notadmin,display_name:'New Admin',roles:['accountant'],permissions:[],mfa_required:scn.mfaRequired!==false,mfa_ok:false}):{data:null,error:{message:'unknown'}}); } };
  })();`;
}
let PORT;
async function open(browser, scn) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/accept-invite.html`); return { page, ctx, errs };
}
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
async function pw(page) { await page.fill('#aiPw1', 'a-long-password-123'); await page.fill('#aiPw2', 'a-long-password-123'); await page.click('#aiBtn'); }
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  // 1 normal: password then authenticator step; wrong code stays; right code leaves for the admin area
  let { page, ctx, errs } = await open(browser, {});
  await page.waitForSelector('#aiForm:not([hidden])'); await pw(page);
  await page.waitForSelector('#aiEnrol:not([hidden])');
  chk(await page.locator('#aiForm').isHidden() && (await page.locator('#aiSecret').innerText()) === 'JBSWY3DPEHPK3PXP' && await page.locator('#aiQr').getAttribute('src') !== null, '1 after the password the authenticator step shows the QR and set-up key');
  chk((await calls(page, 'enroll')).length === 1 && page.url().includes('accept-invite'), '2 stays on the invite page until the code is proven');
  await page.fill('#aiCode', '000000'); await page.click('#aiEnrolBtn');
  await page.waitForSelector('#aiMsg:not([hidden])');
  chk((await page.locator('#aiMsg').innerText()).includes('did not work') && page.url().includes('accept-invite'), '3 a wrong code is refused and nobody is let in');
  await page.fill('#aiCode', '123 456'); await Promise.all([page.waitForURL('**/admin/index.html', { timeout: 5000 }).catch(() => null), page.click('#aiEnrolBtn')]);
  await page.waitForTimeout(300);
  const v = { a: JSON.parse(await page.evaluate(() => window.name) || '{}') };
  chk(v.a.code === '123456' && v.a.factorId === 'f1', '4 the right code (spaces removed) is sent for the new factor');
  chk(page.url().includes('/admin/index.html') || (await page.evaluate(() => location.pathname)).includes('index'), '5 then goes to the admin area');
  chk(errs.length === 0, '6 no page errors ' + errs.join('|')); await ctx.close();
  // 2 two-step not required: straight to the admin area, no enrol
  ({ page, ctx } = await open(browser, { mfaRequired: false })); await page.waitForSelector('#aiForm:not([hidden])');
  await Promise.all([page.waitForURL('**/admin/index.html', { timeout: 5000 }).catch(() => null), pw(page)]);
  chk((await calls(page, 'enroll')).length === 0, '7 two-step not required: no set-up step'); await ctx.close();
  // 3 already has an authenticator: no enrol again
  ({ page, ctx } = await open(browser, { hasFactor: true })); await page.waitForSelector('#aiForm:not([hidden])');
  await Promise.all([page.waitForURL('**/admin/index.html', { timeout: 5000 }).catch(() => null), pw(page)]);
  chk((await calls(page, 'enroll')).length === 0, '8 already has an authenticator app: not asked again'); await ctx.close();
  // 4 not an admin: signed out, no enrol
  ({ page, ctx } = await open(browser, { notadmin: true })); await page.waitForSelector('#aiForm:not([hidden])'); await pw(page);
  await page.waitForSelector('#aiMsg:not([hidden])');
  chk((await calls(page, 'signOut')).length === 1 && (await calls(page, 'enroll')).length === 0, '9 a login that is not an admin is signed out and never offered set-up'); await ctx.close();
  // 5 reload after password saved ("same password") carries on to set-up
  ({ page, ctx } = await open(browser, { samepw: true })); await page.waitForSelector('#aiForm:not([hidden])'); await pw(page);
  await page.waitForSelector('#aiEnrol:not([hidden])'); chk(true, '10 reload after the password was saved still reaches the set-up step'); await ctx.close();
  // 6 no session (expired link)
  ({ page, ctx } = await open(browser, { nosession: true })); await page.waitForSelector('#aiMsg:not([hidden])', { timeout: 8000 });
  chk(await page.locator('#aiForm').isHidden() && await page.locator('#aiEnrol').isHidden(), '11 expired link: no form and no set-up'); await ctx.close();
  await browser.close(); srv.close();
  let bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1]));
  console.log(`\n${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);
})();
