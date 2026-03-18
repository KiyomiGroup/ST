/* ============================================================
   STREET TASKER — sanitize.js
   XSS protection utilities.
   Must be loaded BEFORE feed.js, taskers.js, ui.js, subscription.js.
   ============================================================ */
'use strict';

/**
 * Escapes a string so it is safe to inject into HTML.
 * Converts the five dangerous HTML characters to their entities.
 * Use this on EVERY piece of user-supplied content before
 * inserting into innerHTML.
 *
 * @param {*} str — anything; non-strings are coerced then escaped.
 * @returns {string} HTML-safe string.
 *
 * Example:
 *   escapeHtml('<img src=x onerror=alert(1)>')
 *   → '&lt;img src=x onerror=alert(1)&gt;'
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}

/**
 * Sets an element's text content safely.
 * Prefer this over el.innerHTML = escapeHtml(str) where no HTML is needed.
 */
function safeText(el, str) {
  if (!el) return;
  el.textContent = str === null || str === undefined ? '' : String(str);
}

/**
 * Validates a file for upload.
 * Returns { ok: true } or { ok: false, error: 'message' }
 *
 * @param {File} file
 * @param {object} opts
 * @param {string[]} opts.allowedTypes  — e.g. ['image/jpeg','image/png','image/webp']
 * @param {number}   opts.maxBytes      — e.g. 5 * 1024 * 1024 for 5 MB
 */
function validateUpload(file, opts = {}) {
  const allowed  = opts.allowedTypes || ['image/jpeg', 'image/png', 'image/webp'];
  const maxBytes = opts.maxBytes     || 5 * 1024 * 1024; // 5 MB default

  if (!file) {
    return { ok: false, error: 'No file selected.' };
  }

  // Check MIME type against allowlist (not the filename extension)
  if (!allowed.includes(file.type)) {
    return {
      ok: false,
      error: `File type "${file.type || 'unknown'}" is not allowed. Please upload a JPEG, PNG, or WebP image.`,
    };
  }

  // Check file size
  if (file.size > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(0);
    return { ok: false, error: `File is too large. Maximum size is ${mb} MB.` };
  }

  return { ok: true };
}

// Expose globally
window.escapeHtml    = escapeHtml;
window.safeText      = safeText;
window.validateUpload = validateUpload;
