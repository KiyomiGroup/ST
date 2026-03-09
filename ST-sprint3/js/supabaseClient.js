/* ============================================================
   STREET TASKER — supabaseClient.js
   Sprint 3: Supabase client initialization
   ============================================================
   Single source of truth for the Supabase client instance.
   All modules use window.supabase set here.

   Future Sprint: When migrating to a bundler (Vite/Next.js),
   replace CDN import with:
     import { createClient } from '@supabase/supabase-js'
   and load keys from .env.local.
   ============================================================ */

'use strict';

const SUPABASE_URL      = 'https://ftoiqbacutnbjnztguts.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pXJorKJ3GSf-I53hUvyUlw_pCCIV6qz';

(function initSupabaseClient() {
  if (typeof window.supabase !== 'undefined' && typeof window.supabase.from === 'function') {
    // Already initialized (e.g. loaded twice)
    return;
  }

  if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
    console.error('[StreetTasker] Supabase CDN script not loaded. Add CDN <script> before supabaseClient.js');
    return;
  }

  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  console.log('[StreetTasker] Supabase client initialized ✓');
})();
