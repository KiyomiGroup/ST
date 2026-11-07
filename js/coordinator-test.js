/* Coordinator test page. All grading is done on the server by coordinator_quiz_submit; this page never sees the answer key.
   Calls (see docs/coordinator-onboarding/handoff-S2.md):
     coordinator_quiz_start(p_token)                      -> { ok, attempt_id, questions:[{id,question,options}], attempts_left, max_per_day, pass_percent }
                                                              | { ok, passed:true, code } | { ok:false, error: invalid_token | no_attempts (+next_at) | quiz_not_ready }
     coordinator_quiz_submit(p_token, p_attempt, p_answers) -> pass { ok, passed:true, score, total, code } | fail { ok, passed:false, score, total, attempts_left, next_at }
   All text from the server is written with textContent. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var panels = ['cotLoading', 'cotBad', 'cotIntro', 'cotQuiz', 'cotFail', 'cotPass'];
  var TOKEN_RE = /^[0-9a-f]{64}$/;
  var token = '';
  var quiz = null;      /* { attemptId, questions, passPercent } */
  var answers = [];     /* chosen option index per question, null if not answered */
  var current = 0;

  function sb() { return window.supabase; }
  function show(id) {
    panels.forEach(function (p) { var el = $(p); if (el) el.hidden = (p !== id); });
    var heading = id === 'cotFail' ? $('cotFailTitle') : id === 'cotPass' ? $('cotPassTitle') : id === 'cotQuiz' ? $('cotQuestion') : null;
    if (heading) heading.focus();
    window.scrollTo(0, 0);
  }
  function showError(boxId, msg) { var b = $(boxId); b.textContent = msg; b.classList.add('is-visible'); }
  function clearError(boxId) { var b = $(boxId); b.textContent = ''; b.classList.remove('is-visible'); }

  function lagosTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d) + ' (Lagos time)';
    } catch (e) { return ''; }
  }
  function noAttemptsText(nextAt) {
    var when = nextAt ? lagosTime(nextAt) : '';
    return 'You have used all 3 tries for today.' + (when ? ' You can try again from ' + when + '.' : ' Please come back tomorrow.') + ' Use the time to read the guide again.';
  }
  function showBad(text) { if (text) $('cotBadText').textContent = text; show('cotBad'); }

  async function callRpc(name, args) {
    if (!sb()) throw new Error('no_client');
    var res = await sb().rpc(name, args);
    if (res.error) throw res.error;
    return res.data;
  }

  /* ---- start / resume a try ---- */
  async function startTry() {
    var errBox = 'cotIntroError';
    clearError(errBox);
    var data;
    try { data = await callRpc('coordinator_quiz_start', { p_token: token }); }
    catch (e) { show('cotIntro'); showError(errBox, 'We could not reach the server. Check your internet and try again.'); return; }
    if (!data || data.ok === false) {
      var code = data && data.error;
      if (code === 'invalid_token') return showBad();
      if (code === 'no_attempts') { show('cotFail'); $('cotFailTitle').textContent = 'No tries left today'; $('cotFailScore').textContent = ''; $('cotFailText').textContent = noAttemptsText(data.next_at); $('cotRetry').hidden = true; return; }
      if (code === 'quiz_not_ready') { show('cotIntro'); showError(errBox, 'The test is not ready yet. Please try again later.'); return; }
      show('cotIntro'); showError(errBox, 'Something went wrong. Please try again.'); return;
    }
    if (data.passed) return showPass(data);
    quiz = { attemptId: data.attempt_id, questions: data.questions || [], passPercent: data.pass_percent || 80 };
    if (!quiz.questions.length) { show('cotIntro'); showError(errBox, 'The test is not ready yet. Please try again later.'); return; }
    answers = quiz.questions.map(function () { return null; });
    current = 0;
    $('cotBar').max = quiz.questions.length;
    show('cotQuiz');
    renderQuestion();
  }

  /* ---- questions ---- */
  function renderQuestion() {
    var q = quiz.questions[current], total = quiz.questions.length;
    clearError('cotQuizError');
    $('cotProgressText').textContent = 'Question ' + (current + 1) + ' of ' + total;
    $('cotBar').value = current + 1;
    $('cotQuestion').textContent = q.question;
    var box = $('cotOptions'); box.textContent = '';
    (q.options || []).forEach(function (text, i) {
      var label = document.createElement('label'); label.className = 'cot-option';
      var input = document.createElement('input'); input.type = 'radio'; input.name = 'cotAnswer'; input.value = String(i);
      if (answers[current] === i) { input.checked = true; label.classList.add('is-selected'); }
      var span = document.createElement('span'); span.textContent = text;
      input.addEventListener('change', function () {
        answers[current] = i;
        Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('is-selected'); });
        label.classList.add('is-selected');
        $('cotNext').disabled = false;
      });
      label.appendChild(input); label.appendChild(span); box.appendChild(label);
    });
    $('cotBack').hidden = current === 0;
    $('cotNext').textContent = current === total - 1 ? 'Submit answers' : 'Next';
    $('cotNext').disabled = answers[current] === null;
  }

  async function submit() {
    var btn = $('cotNext'); btn.disabled = true; btn.textContent = 'Checking…'; clearError('cotQuizError');
    var data;
    try { data = await callRpc('coordinator_quiz_submit', { p_token: token, p_attempt: quiz.attemptId, p_answers: answers }); }
    catch (e) { btn.disabled = false; btn.textContent = 'Submit answers'; showError('cotQuizError', 'We could not reach the server. Your answers are kept on this page. Check your internet and press Submit answers again.'); return; }
    if (!data || data.ok === false) {
      btn.disabled = false; btn.textContent = 'Submit answers';
      var code = data && data.error;
      if (code === 'invalid_token') return showBad();
      if (code === 'invalid_attempt') return showError('cotQuizError', 'This try has expired. Go back to the start and begin a new try.');
      return showError('cotQuizError', 'Something went wrong. Please try again.');
    }
    if (data.passed) return showPass(data);
    var need = Math.ceil(data.total * quiz.passPercent / 100);
    $('cotFailTitle').textContent = 'Not passed this time';
    $('cotFailScore').textContent = 'You got ' + data.score + ' of ' + data.total + ' right.';
    var left = typeof data.attempts_left === 'number' ? data.attempts_left : null;
    var text = 'You need ' + need + ' right to pass. Read the guide again, then try again.';
    if (left !== null && left > 0) text += ' You have ' + left + (left === 1 ? ' try' : ' tries') + ' left today.';
    if (left === 0) text = 'You need ' + need + ' right to pass. ' + noAttemptsText(data.next_at);
    $('cotFailText').textContent = text;
    $('cotRetry').hidden = left === 0;
    show('cotFail');
  }

  function showPass(data) {
    $('cotPassScore').textContent = (typeof data.score === 'number' && typeof data.total === 'number') ? 'You got ' + data.score + ' of ' + data.total + ' right.' : 'You have already passed the test.';
    $('cotCode').textContent = data.code || '';
    $('cotCopyNote').textContent = '';
    show('cotPass');
    offerActivate();
  }

  /* Signed in already: one button makes the account a coordinator account. Not signed in: Sign up and Log in keep the code for the next page. */
  async function offerActivate() {
    var signedIn = false;
    try { var s = await window.supabase.auth.getSession(); signedIn = !!(s && s.data && s.data.session); } catch (e) { signedIn = false; }
    $('cotActivate').hidden = !signedIn;
    $('cotSignup').hidden = signedIn;
    $('cotLogin').hidden = signedIn;
    if (signedIn) $('cotPassText').textContent = 'This is your coordinator code. It can be used once and it expires, so use it soon. You are already signed in, so press Activate to turn this account into your coordinator account.';
  }
  function keepCode() { if (window.ST && window.ST.auth) window.ST.auth.rememberCoordinatorCode($('cotCode').textContent, ''); }
  async function activate() {
    var btn = $('cotActivate'), note = $('cotCopyNote');
    btn.disabled = true; note.textContent = '';
    keepCode();
    var user = null;
    try { var s = await window.supabase.auth.getSession(); user = s && s.data && s.data.session && s.data.session.user; } catch (e) { user = null; }
    var co = await window.ST.auth.redeemPendingCoordinatorCode(user);
    if (co.status === 'ready') { window.location.href = window.ST.auth.COORDINATOR_HOME; return; }
    btn.disabled = false;
    note.textContent = co.status === 'invalid' ? 'This code has already been used or has expired.' : 'We could not reach the server. Check your internet and press Activate again.';
  }

  async function copyCode() {
    var code = $('cotCode').textContent, note = $('cotCopyNote');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(code); note.textContent = 'Code copied.'; return; }
      throw new Error('no clipboard');
    } catch (e) {
      var range = document.createRange(); range.selectNodeContents($('cotCode'));
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      note.textContent = 'Press and hold the code, then choose Copy.';
    }
  }

  /* ---- wiring ---- */
  $('cotStart').addEventListener('click', function () { this.disabled = true; var b = this; startTry().finally(function () { b.disabled = false; }); });
  $('cotRetry').addEventListener('click', function () { startTry(); });
  $('cotBack').addEventListener('click', function () { if (current > 0) { current -= 1; renderQuestion(); } });
  $('cotNext').addEventListener('click', function () {
    if (answers[current] === null) return;
    if (current < quiz.questions.length - 1) { current += 1; renderQuestion(); } else { submit(); }
  });
  $('cotCopy').addEventListener('click', copyCode);
  $('cotActivate').addEventListener('click', activate);
  $('cotSignup').addEventListener('click', keepCode);
  $('cotLogin').addEventListener('click', keepCode);

  (function init() {
    token = (new URLSearchParams(window.location.search).get('t') || '').trim().toLowerCase();
    if (!TOKEN_RE.test(token)) return showBad('The link is missing or incomplete. Open the test link from your approval email, or apply to be a coordinator.');
    show('cotIntro');
  })();
})();
