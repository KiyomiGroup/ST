'use strict';
/* ============================================================
   STREETTASKER — server/referral-share-core.js
   Builds the shareable referral link  https://streettasker.com/r/<CODE>

   What a link crawler (WhatsApp, Facebook, X, Telegram, iMessage...) sees:
     title:        Earn money or get things done on StreetTasker
     description:  tasker code    -> Use my code CODE to get a premium account.
                   customer code  -> Use my code CODE to get gift cards.
     image:        /r/<CODE>/image.png  (the StreetTasker logo on a mint panel, 1200x630)
   A real person who opens the link is sent on to signup.html?ref=<CODE>, so referral-capture.js works unchanged.

   Which wording is used comes from the database function public.referral_code_programme(code) (sql/referral-code-programme.sql),
   callable with the public anon key. It returns only 'tasker' or 'customer'. If it fails, the neutral wording is used.
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ftoiqbacutnbjnztguts.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0b2lxYmFjdXRuYmpuenRndXRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzM1MTIsImV4cCI6MjA4ODY0OTUxMn0.SD8O8ncF6JaxCukI0ho60SJUTKuiDsDZb54QwjCvHb0';
const SITE = (process.env.SITE_URL || 'https://streettasker.com').replace(/\/+$/, '');

const CODE_OK = /^ST[A-Z0-9]{6}$/;
const IMG_W = 1200, IMG_H = 630;
const MINT = { r: 238, g: 255, b: 241, alpha: 1 };   /* --color-primary-soft */

const TITLE = 'Earn money or get things done on StreetTasker';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function cleanCode(raw) {
  const c = String(raw || '').trim().toUpperCase();
  return CODE_OK.test(c) ? c : '';
}

async function loadProgramme(code) {
  if (!code) return '';
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/referral_code_programme', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
    });
    if (!r.ok) return '';
    const v = await r.json();
    return v === 'tasker' || v === 'customer' ? v : '';
  } catch (e) { return ''; }
}

/* tasker's code -> premium account; customer's code -> gift cards */
function copyFor(code, programme) {
  if (!code) return { title: TITLE, description: 'Apply as a tasker or post your own task on StreetTasker.' };
  const lead = 'Use my code ' + code;
  if (programme === 'tasker') return { title: TITLE, description: lead + ' to get a premium account.' };
  if (programme === 'customer') return { title: TITLE, description: lead + ' to get gift cards.' };
  return { title: TITLE, description: lead + ' when you join StreetTasker.' };
}

function renderHtml(code, programme) {
  const c = copyFor(code, programme);
  const page = SITE + '/r/' + encodeURIComponent(code);
  const image = code ? page + '/image.png' : SITE + '/images/og-image.png';
  const dest = SITE + '/signup.html' + (code ? '?ref=' + encodeURIComponent(code) : '');
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<title>' + esc(c.title) + '</title>\n' +
    '<meta name="description" content="' + esc(c.description) + '" />\n' +
    '<meta name="robots" content="noindex" />\n' +
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
    '</head><body><p><a href="' + esc(dest) + '">Join StreetTasker</a></p>\n' +
    '<script>location.replace(' + JSON.stringify(dest).replace(/</g, '\\u003c') + ');</script></body></html>';
}

async function grab(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/* 1200x630 PNG: the logo, large and centred on the brand mint. No text is drawn, so no fonts are needed on the server. */
async function renderImage() {
  const sharp = require('sharp');
  const logo = await sharp(await grab(SITE + '/images/logo-nav.svg'), { density: 400 })
    .resize({ width: 760, height: 300, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: IMG_W, height: IMG_H, channels: 3, background: MINT } })
    .composite([{ input: logo, gravity: 'centre' }]).png({ compressionLevel: 9 }).toBuffer();
}

/* One entry point for the host adapter. Returns { status, headers, body, isBinary }. */
async function handle({ code, img }) {
  const c = cleanCode(code);
  if (img) {
    try {
      const body = await renderImage();
      return { status: 200, isBinary: true, body, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } };
    } catch (e) {
      console.error('[referral-share] image failed:', e && e.message);
      return { status: 302, body: '', headers: { Location: SITE + '/images/og-image.png', 'Cache-Control': 'public, max-age=300' } };
    }
  }
  const programme = await loadProgramme(c);
  return { status: 200, body: renderHtml(c, programme), headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } };
}

module.exports = { handle, renderHtml, copyFor, cleanCode, loadProgramme };
