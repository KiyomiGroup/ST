// LOCAL ONLY: headless browser test of admin/transactions.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a17-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });

function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var S=[{id:'s1',service_name:'<img src=x onerror=window.__xss=1>Plumbing',category:'Plumbing',tasker_name:'Ada',price:5000,price_max:8000,rate_unit:'per job',listing_status:'active',available:true,is_main:true,created_at:'2026-11-01T10:00:00Z',description:'Fixes pipes'},
         {id:'s2',service_name:'Hair braiding',category:'Beauty',tasker_name:'Bola',price:15000,listing_status:'paused',available:false,created_at:'2026-10-20T10:00:00Z'}];
  var R=[{id:'r1',rating:5,comment:'Great',reviewer_name:'Chi',reviewer_role:'customer',reviewee_name:'Ada',reviewee_role:'tasker',created_at:'2026-11-02T10:00:00Z',booking_ref:'abcd1234'},
         {id:'r2',rating:1,comment:'Late',reviewer_name:'Dee',reviewer_role:'customer',reviewee_name:'Bola',reviewee_role:'tasker',created_at:'2026-11-01T10:00:00Z',booking_ref:'ffff0000'}];
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['support'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.down) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_service_list'){ var q=(a.p_search||'').toLowerCase(); var r=S.filter(function(x){return (a.p_filter==='all'||x.listing_status===a.p_filter||(a.p_filter==='unavailable'&&x.available===false))&&(!q||(x.service_name+x.category+x.tasker_name).toLowerCase().indexOf(q)>-1);}); return ok({ok:true,filter:a.p_filter,offset:a.p_offset,page_size:25,total:r.length,counts:{total:2,active:1,paused:1,unavailable:1},categories:[{category:'Plumbing',n:1},{category:'Beauty',n:1}],items:r}); }
   if(n==='admin_review_list'){ var r2=R.filter(function(x){return a.p_filter==='all'||(a.p_filter==='low'&&x.rating<=2)||(a.p_filter==='comment'&&x.comment);}); return ok({ok:true,filter:a.p_filter,offset:a.p_offset,page_size:25,total:r2.length,counts:{total:2,average:3,low:1,with_comment:2,by_rating:{1:1,5:1}},items:r2}); }
   if(n==='admin_flagged_user_list') return ok({ok:true,filter:a.p_filter,offset:0,page_size:25,total:1,counts:{flagged:1,warned:0},items:[{id:'u1',name:'Eve',role:'tasker',contact_violations:3,is_flagged:true,flagged_reason:'Shared a number',created_at:'2026-10-01T10:00:00Z'}]});
   if(n==='admin_community_list') return ok(a.p_kind==='posts'?{ok:true,kind:'posts',offset:0,page_size:25,total:1,comments_total:0,items:[{id:'p1',author:'Fay',text:'Hello world',has_image:true,likes:2,comment_count:0,created_at:'2026-11-03T10:00:00Z'}]}:{ok:true,kind:'comments',offset:0,page_size:25,total:0,comments_total:0,items:[]});
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, pg, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/${pg}.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
const noAction = (p, root) => p.locator(root + ' button', { hasText: /hide|restore|delete|remove|clear|suspend|approve|flag user|escalate/i }).filter({ hasNotText: /Hide details/ }).count();
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, 'services', { perms: ['listings.moderate'] });
  await page.waitForSelector('#svList .ad-table');
  chk(await page.locator('.ad-nav-link', { hasText: 'Services' }).count() === 1, '1 menu item shown');
  chk((await page.locator('#svList tbody tr:not(.ad-detail-row)').count()) === 2, '2 two listings');
  chk(await page.evaluate(() => window.__xss !== 1) && (await txt(page, '#svList')).includes('<img'), '3 name shown as text, not HTML');
  chk((await txt(page, '#svSummary')).includes('Paused') && (await txt(page, '#svCats')).includes('Plumbing: 1'), '4 counts and categories shown');
  chk((await txt(page, '#svList')).includes('₦5,000 to ₦8,000'), '5 price range');
  chk(await noAction(page, '#svRoot') === 0, '6 no hide or restore button');
  await page.locator('#svTabs button', { hasText: 'Paused' }).click(); await page.waitForTimeout(100);
  chk((await page.locator('#svList tbody tr:not(.ad-detail-row)').count()) === 1, '7 filter works');
  await page.fill('#svSearch', 'zzz'); await page.click('#svGo'); await page.waitForTimeout(100);
  chk(await page.locator('#svList .ad-state').count() === 1, '8 no-results state');
  chk((await calls(page, 'admin_service_list')).some(x => x.a.p_search === 'zzz' && x.a.p_filter === 'paused'), '9 search and filter sent to server');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '10 no sideways scroll at 1280');
  chk(errs.length === 0, '11 no page errors ' + errs.join('|')); await ctx.close();
  ({ page, ctx } = await open(browser, 'services', { perms: ['taskers.view'] }, 390)); await page.waitForSelector('#svList .ad-table');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '12 taskers.view works; no sideways scroll at 390'); await ctx.close();
  ({ page, ctx, errs } = await open(browser, 'reviews', { perms: ['reviews.moderate', 'trust.flags.view', 'community.moderate'] }));
  await page.waitForSelector('#rvList .ad-table');
  chk(await page.locator('#rvTabs button').count() === 4, '13 four sections');
  chk((await page.locator('#rvList tbody tr:not(.ad-detail-row)').count()) === 2 && (await txt(page, '#rvSummary')).includes('Average'), '14 reviews and summary');
  await page.locator('#rvSub button', { hasText: 'Low' }).click(); await page.waitForTimeout(100);
  chk((await page.locator('#rvList tbody tr:not(.ad-detail-row)').count()) === 1, '15 low filter');
  await page.locator('#rvTabs button', { hasText: 'Flagged users' }).click(); await page.waitForSelector('#rvList .ad-table');
  chk((await txt(page, '#rvList')).includes('Eve') && !/@|\d{8,}/.test(await txt(page, '#rvList')), '16 flagged user shown, no contact data');
  await page.locator('#rvTabs button', { hasText: 'Community posts' }).click(); await page.waitForSelector('#rvList .ad-table');
  chk((await txt(page, '#rvList')).includes('Hello world') && (await txt(page, '#rvList')).includes('has a picture'), '17 post shown');
  await page.locator('#rvTabs button', { hasText: 'Comments' }).click(); await page.waitForSelector('#rvList .ad-state');
  chk(await page.locator('#rvList .ad-state').count() === 1, '18 empty comments state');
  chk(await noAction(page, '#rvRoot') === 0, '19 no action buttons');
  chk(errs.length === 0, '20 no page errors ' + errs.join('|')); await ctx.close();
  ({ page, ctx } = await open(browser, 'reviews', { perms: ['community.moderate'] })); await page.waitForSelector('#rvList .ad-table');
  chk(await page.locator('#rvTabs button').count() === 2 && (await calls(page, 'admin_review_list')).length === 0 && (await calls(page, 'admin_flagged_user_list')).length === 0, '21 only permitted sections shown and requested'); await ctx.close();
  ({ page, ctx } = await open(browser, 'reviews', { perms: ['reviews.moderate'], down: true })); await page.waitForSelector('#rvList .ad-state--error');
  chk(await page.locator('#rvList .ad-state--error').count() === 1, '22 server down shows an error, not an empty list'); await ctx.close();
  ({ page, ctx } = await open(browser, 'services', { perms: ['payouts.view'] })); await page.waitForTimeout(600);
  chk(await page.locator('#svRoot').isHidden(), '23 no permission: page stays hidden'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1])); console.log(bad.length ? bad.length + ' FAILED' : 'ALL ' + results.length + ' PASSED'); process.exit(bad.length ? 1 : 0);
})();
