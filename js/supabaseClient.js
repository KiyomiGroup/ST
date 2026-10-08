'use strict';

const SUPABASE_URL      = 'https://ftoiqbacutnbjnztguts.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0b2lxYmFjdXRuYmpuenRndXRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzM1MTIsImV4cCI6MjA4ODY0OTUxMn0.SD8O8ncF6JaxCukI0ho60SJUTKuiDsDZb54QwjCvHb0';

(function initSupabaseClient() {
  if (typeof window.supabase !== 'undefined' && typeof window.supabase.from === 'function') return;
  if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
    console.error('[StreetTasker] Supabase CDN not loaded.');
    return;
  }
  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // A page can set window.__ST_SKIP_URL_SESSION__ = true first (redeem.html does: its ?code= is a gift card, not a sign-in code)
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: window.__ST_SKIP_URL_SESSION__ !== true },
  });
  console.log('[StreetTasker] Supabase client initialized ✓');
})();
