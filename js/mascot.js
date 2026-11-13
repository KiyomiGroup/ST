/* ============================================================
   StreetTasker mascot (Bisi the Bucket, "the guide"). Read docs/mascot/STREETTASKER-MASCOTS.md before changing anything here.

   Today: a small prompt from the side of the screen that asks one question with two buttons.

     ST.mascot.ask({ text, accept, decline, delay })  ->  Promise 'accepted' | 'declined' | 'none'

   'none' means it was not shown (already on screen, or the page is gone): the caller carries on as if not asked.
   It is NOT a modal: no dim layer, nothing is blocked, the page stays fully usable. It never takes keyboard focus.
   Nothing is saved here; the caller decides what a decline means.

   Built to become the site-wide assistant later (the mascot sitting in this corner all the time, without text):
   the character (.st-mascot-img) and the speech bubble (.st-mascot-bubble) are separate, so the chatbot can keep the
   character and drop or reuse the bubble. Position, size and layer are tokens (--mascot-* and --z-mascot in
   css/tokens.css), so moving it is one place. Today the whole thing leaves after the answer.

   Art: images/mascot/bisi-bucket.png (full body, every screen size). Styles: css/mascot.css.
   ============================================================ */
(function (root) {
  'use strict';
    var FULL = 'images/mascot/bisi-bucket.png';
  var ALT = 'Bisi, the StreetTasker guide';
  var showing = false;

  function el(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ask(opts) {
    opts = opts || {};
    var doc = root.document;
    if (!doc || !doc.body || showing) return Promise.resolve('none');
    /* ST.promptsPending: other pop-ups (js/tasker-live-nudge.js) wait while this one is waiting or on screen */
    root.ST = root.ST || {};
    root.ST.promptsPending = (root.ST.promptsPending || 0) + 1;
    return new Promise(function (resolve) {
      var timer = root.setTimeout(function () {
        if (!doc.body || showing) { root.ST.promptsPending--; resolve('none'); return; }
        showing = true;

        var box = el(doc, 'aside', 'st-mascot');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'false');
        box.setAttribute('aria-labelledby', 'stMascotText');

        var bubble = el(doc, 'div', 'st-mascot-bubble');
        var text = el(doc, 'p', 'st-mascot-text', opts.text || '');
        text.id = 'stMascotText';
        var actions = el(doc, 'div', 'st-mascot-actions');
        var accept = el(doc, 'button', 'btn btn-primary btn-sm', opts.accept || 'Yes');
        accept.type = 'button';
        var decline = el(doc, 'button', 'btn btn-ghost btn-sm', opts.decline || 'No');
        decline.type = 'button';
        actions.append(accept, decline);
        bubble.append(text, actions);

        var pic = el(doc, 'div', 'st-mascot-pic');
        var img = el(doc, 'img', 'st-mascot-img');
        img.src = FULL; img.alt = ALT;   /* full-body art on every screen; only the size changes on phones */
        pic.appendChild(img);

        box.append(bubble, pic);
        doc.body.appendChild(box);

        function done(answer) {
          box.remove();
          showing = false;
          root.ST.promptsPending--;
          resolve(answer);
        }
        accept.addEventListener('click', function () { done('accepted'); });
        decline.addEventListener('click', function () { done('declined'); });
      }, opts.delay > 0 ? opts.delay : 0);
      void timer;
    });
  }

  root.ST = root.ST || {};
  root.ST.mascot = { ask: ask };
})(typeof window !== 'undefined' ? window : globalThis);
