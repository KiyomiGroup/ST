# VR5 Part B: patches for your categories files

Apply each patch by hand to YOUR latest copy of the file: find the **Find** text (it must appear exactly once; copy it whole, spaces included) and replace it with the **Replace with** text (empty means delete the find text, including its line break).
I read these from the ST-Real-Main zip of 2026-11-12. I did not send whole files, so none of your categories changes can be overwritten.
If a Find text is not found, your copy differs from the zip: send me that file and I will redo that one patch.


---

## post-service.html

### 1. Publish check: use canPublish()

**Find**
```text
        /* Verified = the SERVER says VERIFIED (idv_my_status). The old checks (verifications.status,
           users.is_verified) are browser-writable and are no longer trusted. If the read fails: not verified. */
        var isVerified = false;
        try {
          isVerified = !!(window.ST && window.ST.verify && await window.ST.verify.isUserVerified());
        } catch(e) { isVerified = false; }
```

**Replace with**
```text
        /* VR5: nobody verifies to post. "isVerified" now means "the server says this person may publish" (idv_can_publish).
           If the read fails: false, and the listing is saved as a draft. */
        var isVerified = false;
        try {
          var pubState = (window.ST && window.ST.verify && window.ST.verify.canPublish) ? await window.ST.verify.canPublish() : null;
          isVerified = !!(pubState && pubState.can_publish === true);
        } catch(e) { isVerified = false; }
```

### 2. Remove the verifyPrompt block use (the "else" branch of the save)

**Find**
```text
          /* Show verify prompt — pass return URL so verify.html bounces back */
          document.getElementById('verifyNowBtn').href = verifyUrl();
          /* "Verify My Identity Now" in the sidebar: go straight to verification once saved */
          if (goVerify) { window.location.href = verifyUrl(); return; }

          document.getElementById('formCard').style.display    = 'none';
          document.getElementById('verifyPrompt').style.display = 'block';
          window.scrollTo({ top: 0, behavior: 'smooth' });
```

**Replace with**
```text
          /* VR5: no verify step. The server could not publish just now (for example the check failed), so the listing stays a saved draft. */
          showToast('Saved as a draft. You can publish it from My Services.');
          setTimeout(function() { window.location.href = 'my-services.html'; }, 1600);
          return;
```

### 3. Subtitle under the title

**Find**
```text
Fill in your details below. Your listing will be saved, then you'll verify your identity before it goes live.
```

**Replace with**
```text
Fill in your details below. Your listing goes live as soon as you save it.
```

### 4. Desktop note above the buttons

**Find**
```text
Your listing is saved as a draft first. You'll verify your identity in the next step before it goes public.
```

**Replace with**
```text
Your listing goes live when you save it. Use Save Draft to keep it private for now.
```

### 5. Mobile note above the sticky bar

**Find**
```text
<span>Saved as a draft first</span><span class="pt-dot" aria-hidden="true"></span><span>Verify to go live</span>
```

**Replace with**
```text
<span>Goes live when saved</span><span class="pt-dot" aria-hidden="true"></span><span>Save Draft keeps it private</span>
```


---

## post-task.html

### 1. Delete the greyed-out urgent lock line (urgentLock, urgentLockText, urgentVerifyLink)

**Find**
```text
                    <p class="pt-urgent-lock" id="urgentLock" role="status" hidden><span id="urgentLockText">You need to verify your identity to use this feature.</span> <a class="pt-urgent-lock-link" id="urgentVerifyLink" href="verify.html">Verify now</a></p>
```

**Replace with:** nothing (delete the Find text).

### 2. Success modal: remove the "Verify Now - Post Task Live" button (verifyToPostBtn) and the "Verify Later" button

**Find**
```text
      <div id="modalVerifyNeeded">
        <div class="modal-icon" style="background:#fef3c7;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h2 style="margin-bottom:8px;">Task saved — verify to post</h2>
        <p style="color:var(--text-muted);font-size:var(--text-sm);margin-bottom:20px;line-height:1.6;">Your task <strong>"<span data-task-title></span>"</strong> has been saved. Verify your identity once to make it visible to taskers. It's quick and only done once.</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a id="verifyToPostBtn" href="verify.html?role=customer&return=my-tasks.html" class="btn btn-primary" style="text-decoration:none;justify-content:center;">Verify Now — Post Task Live</a>
          <button class="btn btn-ghost" onclick="saveDraftTask()">Save as Draft — Verify Later</button>
        </div>
      </div>
```

**Replace with**
```text
      <div id="modalVerifyNeeded">
        <div class="modal-icon" style="background:#fef3c7;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h2 style="margin-bottom:8px;">Task saved</h2>
        <p style="color:var(--text-muted);font-size:var(--text-sm);margin-bottom:20px;line-height:1.6;">Your task <strong>"<span data-task-title></span>"</strong> has been saved but is not live yet. Open My Tasks and try posting it again.</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="my-tasks.html" class="btn btn-primary" style="text-decoration:none;justify-content:center;">Go to My Tasks</a>
        </div>
      </div>
```

### 3. Comment above the modal

**Find**
```text
<!-- Success modal — verify to publish -->
```

**Replace with**
```text
<!-- Success modal -->
```


---

## js/tasks.js

### 1. Remove the two calls that grey out urgent

**Find**
```text
  applyUrgentGate();  /* after the draft is restored: grey out urgent if verification is needed */
  window.addEventListener('pageshow', (e) => { if (e.persisted) applyUrgentGate(); });  /* back from verify.html */
```

**Replace with:** nothing (delete the Find text).

### 2. setUrgentUI: no verification lock (the "immediate" lock set elsewhere is not touched)

**Find**
```text
/* True while the server says this person must verify before they can use urgent (never true once urgent is paid) */
let urgentLocked = false;

function setUrgentUI(state) {
  /* state: 'off' | 'pending' | 'paid' */
  const toggle = $id('urgentToggle');
  const box = document.querySelector('.pt-urgent');
  const note = $id('urgentNote');
  if (!toggle || !box) return;
  const locked = urgentLocked && state === 'off';
  toggle.checked = state === 'paid';
  toggle.disabled = state === 'pending' || locked;
  box.classList.toggle('is-locked', locked);
  const lock = $id('urgentLock');
  if (lock) lock.hidden = !locked;
  if (note) note.hidden = locked || state === 'off';   /* off: the explanation lives behind the info button */
```

**Replace with**
```text
function setUrgentUI(state) {
  /* state: 'off' | 'pending' | 'paid' */
  const toggle = $id('urgentToggle');
  const box = document.querySelector('.pt-urgent');
  const note = $id('urgentNote');
  if (!toggle || !box) return;
  toggle.checked = state === 'paid';
  toggle.disabled = state === 'pending';
  if (note) note.hidden = state === 'off';   /* off: the explanation lives behind the info button */
```

### 3. Delete urgentGateState, showUrgentLock and applyUrgentGate (one block)

**Find**
```text
/* Ask the SERVER (idv_can_publish) whether this person may use urgent. Returns 'ok', 'verify' or 'unavailable'.
   Signed-out people return 'ok' here: the existing log-in step handles them. No answer = no payment. */
async function urgentGateState() {
  let user = null;
  try {
    const res = await window.supabase.auth.getUser();
    user = res && res.data && res.data.user;
  } catch (e) { /* treated as signed out below */ }
  if (!user) return 'ok';
  let g = null;
  try {
    g = window.ST && window.ST.verify && window.ST.verify.canPublish ? await window.ST.verify.canPublish() : null;
  } catch (e) { g = null; }
  if (g && g.can_publish === true) return 'ok';
  if (g && g.can_publish === false && g.reason === 'verification_required') return 'verify';
  return 'unavailable';
}

function showUrgentLock(kind) {
  const text = $id('urgentLockText');
  const link = $id('urgentVerifyLink');
  if (text) text.textContent = kind === 'verify'
    ? 'You need to verify your identity to use this feature.'
    : 'We could not check your verification just now. Refresh the page to try again.';
  if (link) {
    link.hidden = kind !== 'verify';
    link.href = 'verify.html?return=' + encodeURIComponent('post-task.html') + '&action=' + encodeURIComponent('pay for urgent');
  }
  urgentLocked = true;
  setUrgentUI('off');
}

async function applyUrgentGate() {
  if (taskDraft.urgentPaid) return;           /* already paid: nothing to lock */
  const state = await urgentGateState();
  if (state === 'ok') {
    if (urgentLocked) { urgentLocked = false; setUrgentUI('off'); }
    return;
  }
  showUrgentLock(state);
}
```

**Replace with:** nothing (delete the Find text).

### 4a. startUrgentPayment: remove the locked check

**Find**
```text
  if (taskDraft.urgentPaid) { setUrgentUI('paid'); return; }
  if (urgentLocked) return;
```

**Replace with**
```text
  if (taskDraft.urgentPaid) { setUrgentUI('paid'); return; }
```

### 4b. startUrgentPayment: remove the server verification check before Paystack opens

**Find**
```text
  /* Check again with the server right before Paystack opens (the page state may be stale or edited) */
  const gate = await urgentGateState();
  if (gate !== 'ok') {
    showUrgentLock(gate);
    showToast(gate === 'verify' ? 'Verify your identity to use urgent. Your task details are saved.' : 'We could not check your verification. Nothing was charged.');
    return;
  }
```

**Replace with:** nothing (delete the Find text).

### 5. Toast text of the (now unused) saveDraftTask

**Find**
```text
Task saved as draft. Verify anytime to post it live.
```

**Replace with**
```text
Task saved as a draft.
```
