// LOCAL ONLY (stage A27c): loads EVERY admin page in headless Chromium under the Content-Security-Policy read from vercel.json,
// with the REAL pinned Supabase client from admin/vendor, and fails on any CSP violation or missing client. Supabase itself is faked.
// Run: node a27c-csp-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const ROOT = path.resolve(process.argv[2]); const res = []; const chk = (ok, t) => res.push([!!ok, t]);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const hdrs = {}; cfg.headers.find(h => h.source === '/admin/(.*)').headers.forEach(h => { hdrs[h.key] = h.value; });
const CSP = hdrs['Content-Security-Policy'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain' };
const srv = http.createServer((q, s) => { const p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  const h = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }; if (p.startsWith('/admin/')) Object.assign(h, hdrs);
  s.writeHead(200, h); fs.createReadStream(f).pipe(s); });
const FAKE = `(function(){ function ok(d){return {data:d,error:null};}
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});}, onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};} },
   rpc:function(n){ return Promise.resolve(n==='admin_my_access'?ok({active:true,display_name:'Test Admin',roles:['super_admin'],permissions:['listings.moderate','reviews.moderate'],mfa_required:false,mfa_ok:true}):{data:null,error:{code:'XX',message:'fake'}}); } }; })();`;
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const PORT = srv.address().port;
  chk(/script-src 'self'/.test(CSP) && !/unsafe-inline|unsafe-eval/.test(CSP) && /frame-ancestors 'none'/.test(CSP) && !/cdn\.jsdelivr/.test(CSP), 'policy in vercel.json: script-src self only, no unsafe-*, frame-ancestors kept, no CDN');
  const bare = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers.find(h => h.source === '/admin').headers.find(h => h.key === 'Content-Security-Policy').value;
  chk(bare === CSP, 'the /admin and /admin/(.*) rules carry the same policy');
  const vend = path.join(ROOT, 'admin/vendor/supabase-js-2.119.0.umd.js');
  const sums = fs.readFileSync(path.join(ROOT, 'admin/vendor/SHA256SUMS'), 'utf8');
  chk(sums.startsWith(crypto.createHash('sha256').update(fs.readFileSync(vend)).digest('hex')), 'vendor file matches SHA256SUMS');
  const pages = fs.readdirSync(path.join(ROOT, 'admin')).filter(f => f.endsWith('.html'));
  chk(pages.length >= 20 && pages.every(f => { const s = fs.readFileSync(path.join(ROOT, 'admin', f), 'utf8'); return s.includes('/admin/vendor/supabase-js-2.119.0.umd.js') && !/cdn\.jsdelivr|@supabase\/supabase-js@2\//.test(s) && !/<script>/.test(s) && !/\son[a-z]+="/.test(s) && !/\sstyle="/.test(s); }), pages.length + ' admin pages: pinned local client, no CDN, no inline script, handler or style');
  const browser = await chromium.launch();
  for (const real of [false, true]) {
    for (const pg of pages) {
      if (real && pg !== 'login.html') continue;
      const ctx = await browser.newContext(); const page = await ctx.newPage(); const viol = []; const errs = [];
      await page.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', e => window.__v.push(e.violatedDirective + ' ' + e.blockedURI)); });
      page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) viol.push(m.text().slice(0, 160)); });
      page.on('pageerror', e => errs.push(String(e)));
      await page.route('**/*', r => { const u = r.request().url();
        if (u.startsWith('http://127.0.0.1')) { if (!real && u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: FAKE }); return r.continue(); }
        return r.abort(); });           // fonts and Supabase are not reachable here; the point is that nothing is BLOCKED BY THE POLICY
      await page.goto(`http://127.0.0.1:${PORT}/admin/${pg}`, { waitUntil: 'load' }); await page.waitForTimeout(500);
      const v = viol.concat(await page.evaluate(() => window.__v));
      const client = await page.evaluate(() => typeof window.supabase === 'object' && window.supabase !== null);
      if (real) { chk(await page.evaluate(() => typeof window.supabase.from === 'function' && typeof window.supabase.auth.getSession === 'function'), 'login.html with the REAL vendor client: client created under the policy'); }
      chk(v.filter(x => !/fonts\.(googleapis|gstatic)/.test(x)).length === 0 && client && errs.length === 0, (real ? 'REAL client: ' : '') + pg + ': no policy violation, client present, no script error' + (v.length ? ' ' + JSON.stringify(v) : '') + (errs.length ? ' ' + errs[0] : ''));
      await ctx.close();
    }
  }
  // negative control: the policy really blocks what it should
  { const ctx = await browser.newContext(); const page = await ctx.newPage(); const viol = [];
    await page.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', e => window.__v.push(e.violatedDirective)); });
    await page.route('**/*', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort());
    await page.goto(`http://127.0.0.1:${PORT}/admin/help.html`); await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__ran=1'; document.head.appendChild(s); const t = document.createElement('script'); t.src = 'https://cdn.jsdelivr.net/x.js'; document.head.appendChild(t); const i = document.createElement('iframe'); i.src = 'https://example.com'; document.body.appendChild(i); });
    await page.waitForTimeout(400); const v = await page.evaluate(() => ({ v: window.__v, ran: window.__ran === 1 }));
    chk(!v.ran && v.v.filter(x => x.startsWith('script-src')).length >= 2 && v.v.some(x => x.startsWith('frame-src') || x.startsWith('default-src')), 'negative control: injected inline script, CDN script and a frame are all blocked'); await ctx.close(); }
  await browser.close(); srv.close();
  let f = 0; res.forEach(([ok, t], i) => { if (!ok) f++; console.log((ok ? 'PASS ' : 'FAIL ') + (i + 1) + ' ' + t); }); console.log('TOTAL ' + (res.length - f) + ' pass / ' + f + ' fail'); process.exit(f ? 1 : 0);
})();
