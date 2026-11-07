/* ============================================================
   StreetTasker — coordinator-verify-status.js (Didit stage V4a)
   One place that turns a row of idv_local_status_list() into the words and
   tone a coordinator sees. Display only: it never decides anything, and there
   is NO "mark verified" anywhere; verification is decided by the server (Didit).
   Loads after coordinator-common.js (extends window.STCo). Reused by stage V4b.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  if (!C) return;

  var BASE = 'coordinator-tasker-verify.html?id=';

  /* status -> [label, tone, filter group, action label | null] */
  var MAP = {
    NOT_STARTED:        ['Not started',         'none',     'not',      'Start identity check'],
    IN_PROGRESS:        ['In progress',         'progress', 'progress', 'Open identity check'],
    PENDING:            ['Being checked',       'progress', 'progress', 'See progress'],
    REVIEW_REQUIRED:    ['Needs review',        'review',   'progress', 'See progress'],
    RESUBMIT_REQUESTED: ['Needs another try',   'review',   'progress', 'Resend link'],
    VERIFIED:           ['Verified',            'verified', 'verified', null],
    FAILED:             ['Not verified',        'bad',      'not',      'Try again'],
    EXPIRED:            ['Expired',             'bad',      'not',      'Start again'],
    ABANDONED:          ['Not finished',        'none',     'not',      'Start again']
  };

  /* row: one entry of idv_local_status_list(), or null when it could not be read. */
  function verifyView(row, taskerId) {
    if (!row || typeof row !== 'object') {
      return { label: 'Status unavailable', tone: 'none', group: 'unknown', date: '', action: null, href: '' };
    }
    var st = row.verified === true ? 'VERIFIED' : String(row.status || 'NOT_STARTED');
    var m = MAP[st] || MAP.NOT_STARTED;
    var view = {
      label: m[0], tone: m[1], group: m[2],
      date: st === 'VERIFIED' && row.status === 'VERIFIED' ? C.formatDate(row.completed_at) : '',
      action: m[3], href: ''
    };
    if (view.action && C.isUuid(taskerId)) view.href = BASE + encodeURIComponent(taskerId);
    else view.action = null;
    return view;
  }

  C.verifyView = verifyView;
})();
