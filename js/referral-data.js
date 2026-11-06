/* StreetTasker referral data (stage M15). Reads ONLY through the signed-in person's own database functions and rows (RLS); writes nothing.
   Used by referrals.html (js/referral-page.js) and by the two homepage referral strips (home-feed.html). */
(function (root) {
  'use strict';
  function db() { return root.supabase; }
  function shareUrl(code) { return root.location.origin + '/signup.html?ref=' + encodeURIComponent(code); }

  /* [{programme, code, points, converted_count, pending_count, gifts_saved, next_milestone}] ; [] when nothing is set up ; throws on a database error */
  async function summary() {
    const { data, error } = await db().rpc('referral_my_summary');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }
  async function stats(programme) {
    const { data, error } = await db().rpc('referral_my_stats', { p_programme: programme });
    if (error) throw error;
    return (Array.isArray(data) && data[0]) || { visits: 0, signed_up: 0, verified: 0, points: 0 };
  }
  async function history(programme) {
    const { data, error } = await db().rpc('referral_my_history', { p_programme: programme, p_limit: 50 });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }
  /* saved gifts of a programme, newest first (own rows only: row level security) */
  async function rewards(programme) {
    const p = await db().from('referral_profiles').select('id').eq('programme', programme).maybeSingle();
    if (p.error) throw p.error;
    if (!p.data) return [];
    const { data, error } = await db().from('referral_rewards')
      .select('id, milestone_index, points_threshold, kind, status, created_at, ends_at').eq('profile_id', p.data.id).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  /* customer credit waiting: {points, earned_naira, accepted_naira, available_naira, balance, ...} or null */
  async function creditStatus() {
    const { data, error } = await db().rpc('referral_customer_credit_status');
    if (error) throw error;
    return (Array.isArray(data) && data[0]) || null;
  }
  /* the database does all the checking; these only pass the press along. Result: {ok, reason, message, credited, balance, ends_at} */
  async function creditAccept() {
    const { data, error } = await db().rpc('referral_customer_credit_accept');
    if (error) throw error;
    return data || { ok: false };
  }
  async function rewardAccept(id) {
    const { data, error } = await db().rpc('referral_reward_accept', { p_reward: id });
    if (error) throw error;
    return data || { ok: false };
  }
  /* which programme the person is acting as right now */
  function activeProgramme() {
    try { return localStorage.getItem('st_role') === 'tasker' ? 'tasker' : 'customer'; } catch (e) { return 'customer'; }
  }
  /* summary row for one programme, or null */
  async function mine(programme) {
    const rows = await summary();
    return rows.find(function (r) { return r.programme === programme; }) || null;
  }

  root.STReferralData = { shareUrl: shareUrl, summary: summary, stats: stats, history: history, rewards: rewards, activeProgramme: activeProgramme, mine: mine, creditStatus: creditStatus, creditAccept: creditAccept, rewardAccept: rewardAccept };
})(window);
