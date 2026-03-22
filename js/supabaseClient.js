'use strict';

// ⚠️  REPLACE THESE WITH YOUR REAL VALUES FROM supabase.com/dashboard
// Project Settings → API → Project URL and anon/public key
const SUPABASE_URL      = 'https://ftoiqbacutnbjnztguts.supabase.co';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_REAL_ANON_KEY_HERE';
// Real key looks like: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOi...

(function initSupabaseClient() {
  if (typeof window.supabase !== 'undefined' && typeof window.supabase.from === 'function') return;

  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'PASTE_YOUR_REAL_ANON_KEY_HERE') {
    console.error('[StreetTasker] ❌ Supabase anon key is missing! Go to supabase.com/dashboard → Project Settings → API → copy the anon/public key');
    return;
  }

  if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
    console.error('[StreetTasker] Supabase CDN script not loaded.');
    return;
  }

  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  console.log('[StreetTasker] Supabase client initialized ✓');
})();
