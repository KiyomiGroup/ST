'use strict';
/* ============================================================
   STREETTASKER — server/task-share-core.js
   Builds the shareable task link  https://streettasker.com/t/<task id>

   Two things come out of here:
     1. A tiny HTML page for link crawlers (WhatsApp, Facebook, X, Telegram, iMessage...).
        Crawlers do not run JavaScript, so the preview text has to be in the HTML itself.
        A real person who opens the link is sent on to task-details.html?id=<id> straight away.
     2. A 1200x630 preview picture: the task photo (or the category illustration when there is no photo)
        with the StreetTasker logo on it.   /t/<id>/image.png

   Used by netlify/functions/task-share.js (Netlify) and api/task-share.js (Vercel). Only one of them runs.
   The task is read with the PUBLIC anon key, so only what the database lets a signed-out visitor read can show up.
   Drafts and closed tasks get the plain StreetTasker preview, never their details.
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ftoiqbacutnbjnztguts.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0b2lxYmFjdXRuYmpuenRndXRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzM1MTIsImV4cCI6MjA4ODY0OTUxMn0.SD8O8ncF6JaxCukI0ho60SJUTKuiDsDZb54QwjCvHb0';
const SITE = (process.env.SITE_URL || 'https://streettasker.com').replace(/\/+$/, '');

const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const ILLUSTRATIONS = ['assembly', 'cleaning', 'delivery', 'gardening', 'moving', 'photography', 'repairs', 'tutoring'];
const IMG_W = 1200, IMG_H = 630;
const MINT = { r: 238, g: 255, b: 241, alpha: 1 };   /* --color-primary-soft */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '\u2026' : s;
}

function naira(n) {
  const v = Number(n);
  return isFinite(v) && v > 0 ? '\u20a6' + Math.round(v).toLocaleString('en-NG') : '';
}

async function loadTask(id) {
  if (!ID_OK.test(id || '')) return null;
  try {
    const url = SUPABASE_URL + '/rest/v1/tasks?select=id,title,budget,status,category,photo_urls&id=eq.' + encodeURIComponent(id) + '&limit=1';
    const r = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const rows = await r.json();
    const t = Array.isArray(rows) ? rows[0] : null;
    if (!t || String(t.status || 'open').toLowerCase() !== 'open') return null;   /* drafts, closed, done: no details */
    return t;
  } catch (e) { return null; }
}

function firstPhoto(t) {
  let p = t && t.photo_urls;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = []; } }
  const u = Array.isArray(p) ? p.find((x) => /^https:\/\//i.test(x || '')) : '';
  return u || '';
}

/* The wording the owner asked for:
   title:        I need a tasker for [task] for [budget]
   description:  Apply as a tasker or post your own task on StreetTasker. */
function copyFor(t) {
  if (!t) {
    return {
      title: 'StreetTasker \u2014 Hire trusted local taskers',
      description: 'Apply as a tasker or post your own task on StreetTasker.',
    };
  }
  const what = clip(t.title, 90);
  const money = naira(t.budget);
  return {
    title: 'I need a tasker for ' + what + (money ? ' for ' + money : ''),
    description: 'Apply as a tasker or post your own task on StreetTasker.',
  };
}

function renderHtml(id, t) {
  const c = copyFor(t);
  const page = SITE + '/t/' + encodeURIComponent(id);
  const image = t ? page + '/image.png' : SITE + '/images/og-image.png';
  const dest = SITE + '/task-details.html?id=' + encodeURIComponent(id);
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<title>' + esc(c.title) + '</title>\n' +
    '<meta name="description" content="' + esc(c.description) + '" />\n' +
    '<link rel="canonical" href="' + esc(page) + '" />\n' +
    '<meta property="og:type" content="website" />\n' +
    '<meta property="og:site_name" content="StreetTasker" />\n' +
    '<meta property="og:title" content="' + esc(c.title) + '" />\n' +
    '<meta property="og:description" content="' + esc(c.description) + '" />\n' +
    '<meta property="og:url" content="' + esc(page) + '" />\n' +
    '<meta property="og:image" content="' + esc(image) + '" />\n' +
    '<meta property="og:image:width" content="' + IMG_W + '" />\n' +
    '<meta property="og:image:height" content="' + IMG_H + '" />\n' +
    '<meta name="twitter:card" content="summary_large_image" />\n' +
    '<meta name="twitter:title" content="' + esc(c.title) + '" />\n' +
    '<meta name="twitter:description" content="' + esc(c.description) + '" />\n' +
    '<meta name="twitter:image" content="' + esc(image) + '" />\n' +
    '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '" />\n' +
    '</head><body><p><a href="' + esc(dest) + '">Open this task on StreetTasker</a></p>\n' +
    '<script>location.replace(' + JSON.stringify(dest).replace(/</g, '\\u003c') + ');</script></body></html>';
}

async function grab(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/* 1200x630 PNG: task photo (cover fit) or illustration on a mint panel, with a white badge holding the logo.
   No text is drawn here, so no fonts are needed on the server. */
async function renderImage(t) {
  const sharp = require('sharp');
  let base;
  const photoUrl = firstPhoto(t);
  if (photoUrl) {
    try {
      base = await sharp(await grab(photoUrl)).rotate().resize(IMG_W, IMG_H, { fit: 'cover' }).toBuffer();
    } catch (e) { base = null; }
  }
  if (!base) {
    const cat = String((t && t.category) || '').toLowerCase();
    const art = ILLUSTRATIONS.find((n) => cat.indexOf(n) !== -1) || 'cleaning';
    const svg = await grab(SITE + '/images/illustrations/' + art + '.svg');
    const illo = await sharp(svg, { density: 300 }).resize({ height: 460, width: 700, fit: 'inside' }).png().toBuffer();
    base = await sharp({ create: { width: IMG_W, height: IMG_H, channels: 3, background: MINT } })
      .composite([{ input: illo, gravity: 'centre' }]).png().toBuffer();
  }
  const logo = await sharp(await grab(SITE + '/images/logo-nav.svg'), { density: 300 }).resize({ width: 300 }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  const padX = 36, padY = 28;
  const bw = lm.width + padX * 2, bh = lm.height + padY * 2;
  const badge = await sharp({ create: { width: bw, height: bh, channels: 4, background: WHITE } })
    .composite([{ input: logo, left: padX, top: padY }])
    .png().toBuffer();
  const mask = Buffer.from('<svg width="' + bw + '" height="' + bh + '"><rect width="' + bw + '" height="' + bh + '" rx="' + Math.round(bh / 2) + '"/></svg>');
  const round = await sharp(badge).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(base).composite([{ input: round, left: 48, top: 48 }]).png({ compressionLevel: 9 }).toBuffer();
}

/* One entry point for both hosts. Returns { status, headers, body, isBinary }. */
async function handle({ id, img }) {
  const t = await loadTask(id);
  if (img) {
    try {
      const body = await renderImage(t);
      return { status: 200, isBinary: true, body, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } };
    } catch (e) {
      console.error('[task-share] image failed:', e && e.message);
      return { status: 302, body: '', headers: { Location: SITE + '/images/og-image.png', 'Cache-Control': 'public, max-age=300' } };
    }
  }
  return { status: 200, body: renderHtml(id || '', t), headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } };
}

module.exports = { handle, renderHtml, copyFor, loadTask, firstPhoto, naira };
