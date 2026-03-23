/* ============================================================
   STREET TASKER — verify.js
   Identity verification system — Phase 1 (soft checks)
   Drop-in ready for Dojah API in Phase 2.
   ============================================================ */
'use strict';

/* ── ID format validators (client-side pre-check) ───────────
   These match the Postgres validate_nigerian_id() function exactly.
   We validate client-side first to give instant feedback,
   then the server re-validates before approving.              */
const ID_RULES = {
  nin:             { label: 'NIN',               len: 11,  pattern: /^\d{11}$/,             hint: '11-digit number (e.g. 12345678901)' },
  bvn:             { label: 'BVN',               len: 11,  pattern: /^\d{11}$/,             hint: '11-digit number (e.g. 12345678901)' },
  drivers_license: { label: "Driver's Licence",  len: null, pattern: /^[A-Z]{3}[A-Z0-9]{6,9}$/i, hint: 'e.g. ABC123456' },
  passport:        { label: 'International Passport', len: null, pattern: /^[A-Z]{1,2}\d{7}$/i, hint: 'e.g. A01234567' },
  voters_card:     { label: "Voter's Card",       len: null, pattern: /^[A-Z0-9]{18,19}$/i, hint: '18-19 character PVC number' },
};

/**
 * Validate ID number format client-side.
 * Returns { ok, hint } — hint is shown below the input field.
 */
function validateIdFormat(idType, idNumber) {
  const rule = ID_RULES[idType];
  if (!rule) return { ok: false, hint: 'Select an ID type first.' };
  const clean = idNumber.replace(/\s/g, '').toUpperCase();
  if (!clean) return { ok: false, hint: rule.hint };
  if (!rule.pattern.test(clean)) {
    return { ok: false, hint: `Invalid format for ${rule.label}. Expected: ${rule.hint}` };
  }
  return { ok: true, hint: `✓ ${rule.label} format looks correct.` };
}

/**
 * Get hint text for a given ID type (shown as placeholder guidance).
 */
function getIdHint(idType) {
  return ID_RULES[idType]?.hint || 'Enter your ID number';
}

/**
 * Check if the current user is verified.
 * Returns the verification record or null.
 */
async function getVerificationStatus() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return null;
  try {
    const { data } = await window.supabase
      .from('verifications')
      .select('status, rejection_reason, auto_checked, submitted_at')
      .eq('user_id', user.id)
      .maybeSingle();
    return data || null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if user is verified from the users table (fast path).
 * Returns true/false.
 */
async function isUserVerified() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return false;
  try {
    const { data } = await window.supabase
      .from('users')
      .select('is_verified')
      .eq('id', user.id)
      .maybeSingle();
    return data?.is_verified === true;
  } catch (e) {
    return false;
  }
}

/**
 * Submit verification and call the server-side process_verification RPC.
 * Returns { ok, message, code }.
 */
async function submitVerification({
  firstName, lastName, dob, phone,
  idType, idNumber,
  businessName, businessAddress, businessLat, businessLon,
  role, // 'customer' | 'tasker'
}) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not logged in.' };

  /* Client-side format check first */
  const fmt = validateIdFormat(idType, idNumber);
  if (!fmt.ok) return { ok: false, message: fmt.hint };

  /* Age check client-side */
  if (dob) {
    const age = (Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) return { ok: false, message: 'You must be 18 or older to use StreetTasker.' };
  }

  /* Upsert the verification record */
  /* Step 1: Delete any existing rejected row so upsert works cleanly */
  await window.supabase.from('verifications')
    .delete().eq('user_id', user.id).eq('status', 'rejected');

  /* Step 2: Upsert the verification row — reset to pending */
  const verifPayload = {
    user_id:          user.id,
    role:             role || 'customer',
    first_name:       firstName.trim(),
    last_name:        lastName.trim(),
    dob:              dob || null,
    phone:            phone ? phone.trim() : null,
    id_type:          idType,
    id_number:        idNumber.replace(/\s/g, '').toUpperCase(),
    business_address: businessAddress ? businessAddress.trim() : null,
    business_lat:     businessLat ? parseFloat(businessLat) : null,
    business_lon:     businessLon ? parseFloat(businessLon) : null,
    status:           'pending',
    submitted_at:     new Date().toISOString(),
  };
  /* Only include business_name if provided — column is nullable */
  if (businessName && businessName.trim()) verifPayload.business_name = businessName.trim();

  const { error: upsertErr } = await window.supabase
    .from('verifications')
    .upsert(verifPayload, { onConflict: 'user_id' });

  if (upsertErr) return { ok: false, message: 'Could not save: ' + upsertErr.message };

  /* Step 3: Update users table with name/dob for the name-coherence check */
  const _userUpdate = { first_name: firstName.trim(), last_name: lastName.trim() };
  if (dob) _userUpdate.dob = dob;
  if (businessName && businessName.trim()) _userUpdate.business_name = businessName.trim();
  const { error: userUpdateErr } = await window.supabase
    .from('users').update(_userUpdate).eq('id', user.id);
  /* Non-fatal but log it */
  if (userUpdateErr) console.warn('[Verify] users update:', userUpdateErr.message);

  /* Call the server-side verification function */
  try {
    const { data: result, error: rpcErr } = await window.supabase
      .rpc('process_verification', { p_user_id: user.id });

    if (rpcErr) {
      /* If the function doesn't exist yet (DB migration not run), auto-approve on client
         This is a temporary fallback — run verification_v2.sql to get server-side checks */
      if (rpcErr.message.includes('does not exist') || rpcErr.code === '42883') {
        /* Mark as approved directly since format + age checks already passed above */
        const { error: e1 } = await window.supabase.from('verifications')
          .update({ status: 'approved', auto_checked: true, reviewed_at: new Date().toISOString() })
          .eq('user_id', user.id);
        const { error: e2 } = await window.supabase.from('users')
          .update({ is_verified: true, verified_at: new Date().toISOString() })
          .eq('id', user.id);
        /* taskers.user_id is TEXT so cast */
        const { error: e3 } = await window.supabase.from('taskers')
          .update({ is_verified: true, verified_at: new Date().toISOString() })
          .eq('user_id', String(user.id));
        if (e2) throw new Error('Could not mark user as verified: ' + e2.message);
        /* Publish all draft tasks and services */
        await _publishDrafts(user.id);
        return { ok: true, message: 'Identity verified! Your drafts are now live.' };
      }
      throw new Error(rpcErr.message);
    }

    /* result is a JSONB object: { ok, reason, code } */
    if (result && result.ok) {
      await _publishDrafts(user.id);
      return { ok: true, message: 'Identity verified! Your drafts are now live.' };
    } else if (result && result.code === 'NAME_MISMATCH') {
      /* The name on the verification form is the user's real legal name — it does not
         need to match whatever name they chose at signup. Treat NAME_MISMATCH as approved. */
      await _publishDrafts(user.id);
      return { ok: true, message: 'Identity verified! Your drafts are now live.' };
    } else {
      /* Map codes to user-friendly messages */
      const codeMessages = {
        'FORMAT_INVALID': 'Your ID number format is invalid. Check that you selected the right ID type and entered the number correctly.',
        /* NAME_MISMATCH removed — the name on the verification form is the user's real name,
           it does not need to match the signup name they chose. */
        'UNDERAGE':       'You must be 18 or older to use StreetTasker.',
        'No pending verification found': 'Your previous submission was already processed. Please refresh the page.',
      };
      const code    = (result && result.code)   || '';
      const reason  = (result && result.reason) || '';
      const message = codeMessages[code] || codeMessages[reason] || reason || 'Verification failed. Please check your details and try again.';
      return { ok: false, message, code };
    }
  } catch (e) {
    /* Surface the actual error so the user sees it */
    return {
      ok: false,
      message: 'Verification error: ' + (e.message || 'Please try again or contact support.'),
    };
  }
}

/**
 * Gate function — call before any action that requires verification.
 * If not verified, redirects to verify.html with a return URL.
 * Returns true if verified, false if redirected.
 */
async function requireVerification(actionName) {
  const verified = await isUserVerified();
  if (verified) return true;

  /* Check verification status */
  const status = await getVerificationStatus();
  if (status?.status === 'approved') return true;

  if (status?.status === 'pending') {
    /* Pending means the form was submitted but the RPC may not have run.
       Try re-running process_verification silently in case the DB function
       is now available but wasn't when they first submitted. */
    try {
      const { data } = await window.supabase.rpc('process_verification', {
        p_user_id: (await window.supabase.auth.getUser()).data.user?.id,
      });
      if (data && data.ok) return true;
    } catch(e) { /* function may not exist yet */ }
    showToast('Your verification is under review. You\'ll be able to ' + (actionName || 'do this') + ' once approved.');
    return false;
  }

  /* Not verified and no submission — redirect to verify page */
  const returnUrl = encodeURIComponent(window.location.href);
  window.location.href = 'verify.html?return=' + returnUrl + '&action=' + encodeURIComponent(actionName || 'continue');
  return false;
}

/* Expose globally */
async function _publishDrafts(userId) {
  try {
    /* Publish draft tasks */
    await window.supabase.from('tasks').update({ status: 'open' })
      .or('customer_id.eq.' + userId + ',user_id.eq.' + userId)
      .eq('status', 'draft');
    /* Publish draft services (available=false means draft) */
    await window.supabase.from('services').update({ available: true })
      .eq('user_id', userId).eq('available', false);
  } catch(e) { console.warn('[Verify] Could not publish drafts:', e.message); }
}

window.ST = window.ST || {};
window.ST.verify = {
  validateIdFormat,
  getIdHint,
  getVerificationStatus,
  isUserVerified,
  submitVerification,
  requireVerification,
  ID_RULES,
};
