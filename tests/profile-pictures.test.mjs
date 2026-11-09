// Run: node --test tests/profile-pictures.test.mjs   (no browser needed: tiny fake page)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const UID = "11111111-2222-4333-8444-555555555555", UID2 = "99999999-2222-4333-8444-555555555555";

// ---- a tiny fake page: just the calls the two scripts make ----
function makeNode(attrs = {}, kids = []) {
  const n = { attrs: { ...attrs }, children: [...kids], cls: "", listeners: {},
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); }, remove() { this.parentNode && this.parentNode.removeChild(this); },
    addEventListener(e, f) { this.listeners[e] = f; },
    querySelectorAll(sel) { return this.children.filter((c) => c.tag === "img" && sel === "img:not(.st-logo-ph)" && !/st-logo-ph/.test(c.className || "")); } };
  kids.forEach((k) => (k.parentNode = n)); return n;
}
function setup({ locals = {}, userAvatars = {}, avatarsFn = true }) {
  const spots = [];
  const document = {
    readyState: "complete", body: {},
    createElement: (tag) => Object.assign(makeNode(), { tag, className: "" }),
    querySelectorAll: (sel) => (sel === "[data-avatar-user]:not([data-avatar-done])" ? spots.filter((s) => !("data-avatar-done" in s.attrs)) : []),
    querySelector: (sel) => document.querySelectorAll(sel)[0] || null, addEventListener() {},
  };
  const calls = [];
  const sb = {
    rpc: async (name, args) => {
      calls.push(name);
      if (name === "local_tasker_public_info") {
        return { data: args.p_ids.filter((i) => locals[i]).map((i) => ({ user_id: i, cover_path: "cover/" + i })) };
      }
      if (name === "local_tasker_public_avatars") {
        if (!avatarsFn) return { error: { message: "no such function" } };
        return { data: args.p_ids.filter((i) => locals[i] && locals[i].avatar).map((i) => ({ user_id: i, avatar_path: "av/" + i })) };
      }
      return { error: {} };
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: "https://signed.test/" + p })) }),
      }),
    },
    from: () => ({
      select: () => ({
        in: async (_c, ids) => ({ data: ids.filter((i) => userAvatars[i]).map((i) => ({ id: i, avatar_url: userAvatars[i] })) }),
      }),
    }),
  };
  const ctx = { window: { supabase: sb }, document, MutationObserver: class { observe() {} }, setTimeout, clearTimeout, console };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL("../js/local-tasker-public.js", import.meta.url), "utf8"), ctx);
  const spot = (uid, kind, imgs) => { const n = makeNode({ "data-avatar-user": uid, "data-avatar-kind": kind }, imgs.map((c) => Object.assign(makeNode(), { tag: "img", className: c }))); spots.push(n); return n; };
  return { STLocal: ctx.window.STLocal, spot, calls };
}
const imgs = (n) => n.children.map((c) => c.className + (c.src ? "=" + c.src : ""));

test("Local Tasker tasker card: the cover/service photo is removed and the profile picture is shown", async () => {
  const t = setup({ locals: { [UID]: { avatar: true } } });
  const s = t.spot(UID, "photo", ["st-logo-ph", ""]); s.children[1].src = "https://svc.test/laundry.jpg";
  await t.STLocal.fillAvatars();
  assert.deepEqual(imgs(s), ["st-logo-ph", "=https://signed.test/av/" + UID]);
});

test("Local Tasker with no profile picture yet: no service/cover photo, the StreetTasker mark stays", async () => {
  const t = setup({ locals: { [UID]: { avatar: false } } });
  const s = t.spot(UID, "photo", ["st-logo-ph", ""]); s.children[1].src = "https://svc.test/laundry.jpg";
  await t.STLocal.fillAvatars();
  assert.deepEqual(imgs(s), ["st-logo-ph"]);
});

test("service card chip: Local Tasker gets the profile picture; regular tasker gets the account picture; none = mark stays", async () => {
  const t = setup({ locals: { [UID]: { avatar: true } }, userAvatars: { [UID2]: "https://cdn.test/me.jpg" } });
  const a = t.spot(UID, "chip", ["st-logo-ph"]), b = t.spot(UID2, "chip", ["st-logo-ph"]), c = t.spot("aaaaaaaa-2222-4333-8444-555555555555", "chip", ["st-logo-ph"]);
  await t.STLocal.fillAvatars();
  assert.deepEqual(imgs(a), ["st-logo-ph", "=https://signed.test/av/" + UID]);
  assert.deepEqual(imgs(b), ["st-logo-ph", "=https://cdn.test/me.jpg"]);
  assert.deepEqual(imgs(c), ["st-logo-ph"]);
});

test("regular tasker card photo is never touched", async () => {
  const t = setup({ userAvatars: { [UID2]: "https://cdn.test/me.jpg" } });
  const s = t.spot(UID2, "photo", ["st-logo-ph", ""]); s.children[1].src = "https://svc.test/own.jpg";
  await t.STLocal.fillAvatars();
  assert.deepEqual(imgs(s), ["st-logo-ph", "=https://svc.test/own.jpg"]);
});

test("http (not https) account picture is ignored; a failing avatar function never breaks the page", async () => {
  const t = setup({ locals: { [UID]: {} }, userAvatars: { [UID2]: "http://cdn.test/x.jpg" }, avatarsFn: false });
  const a = t.spot(UID, "chip", ["st-logo-ph"]), b = t.spot(UID2, "chip", ["st-logo-ph"]);
  await t.STLocal.fillAvatars();
  assert.deepEqual(imgs(a), ["st-logo-ph"]); assert.deepEqual(imgs(b), ["st-logo-ph"]);
});

test("a spot is only filled once", async () => {
  const t = setup({ locals: { [UID]: { avatar: true } } });
  const s = t.spot(UID, "chip", ["st-logo-ph"]);
  await t.STLocal.fillAvatars(); await t.STLocal.fillAvatars();
  assert.equal(s.children.length, 2);
});

test("decorate: a Local Tasker row gets the profile picture (or nothing), never the cover", async () => {
  const t = setup({ locals: { [UID]: { avatar: true }, [UID2]: { avatar: false } } });
  const rows = [{ user_id: UID, photo_url: "x" }, { user_id: UID2, photo_url: "y" }];
  await t.STLocal.decorate(rows, ["user_id"], ["photo_url"]);
  assert.equal(rows[0].photo_url, "https://signed.test/av/" + UID); assert.equal(rows[1].photo_url, ""); assert.equal(rows[0].isLocal, true);
});

// ---- the cards themselves (js/ui.js) ----
function loadUi() {
  const ctx = { window: { escapeHtml: (x) => String(x).replace(/</g, "&lt;") }, document: { addEventListener() {} }, console };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8") + "\nthis.stTaskerCard = stTaskerCard; this.stServiceCard = stServiceCard;", ctx);
  return ctx;
}
test("ui.js: Local Tasker cards never print the service photo; others still do; all mark the spot", () => {
  const ui = loadUi();
  const local = ui.stTaskerCard({ home: true, id: UID, user_id: UID, provider_name: "Alayo", isLocal: true, photo: "https://svc.test/laundry.jpg", href: "#" });
  assert.ok(!local.includes("laundry.jpg")); assert.ok(local.includes(`data-avatar-user="${UID}" data-avatar-kind="photo"`));
  const reg = ui.stTaskerCard({ home: true, id: UID2, user_id: UID2, provider_name: "Bo", photo: "https://svc.test/own.jpg", href: "#" });
  assert.ok(reg.includes("own.jpg"));
  const list = ui.stTaskerCard({ id: UID, user_id: UID, provider_name: "Alayo", isLocal: true, photo: "https://svc.test/laundry.jpg", href: "#" });
  assert.ok(!list.includes("laundry.jpg")); assert.ok(list.includes('data-avatar-kind="photo"'));
  const svc = ui.stServiceCard({ home: true, service_name: "Laundry", provider: "Alayo", user_id: UID, price: 8000, unit: "Job", href: "#" });
  assert.ok(svc.includes(`data-avatar-user="${UID}" data-avatar-kind="chip"`));
  assert.ok(!ui.stServiceCard({ home: true, service_name: "Laundry", provider: "Alayo", user_id: "not-a-uuid", href: "#" }).includes("data-avatar-user"));
});
