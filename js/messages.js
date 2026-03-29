/* ============================================================
   STREET TASKER — messages.js
   In-platform messaging between customers and taskers.
   ============================================================ */
'use strict';

const CONTACT_PATTERNS = [
  /\b(\+?234|0)[789]\d{9}\b/,
  /\b\d{4}[\s\-]?\d{3}[\s\-]?\d{4}\b/,
  /whatsapp\.com\/|wa\.me\//i,
  /telegram\.me\/|t\.me\//i,
  /instagram\.com\//i,
  /\byou\s*can\s*(call|reach|find|contact)\s*me\b/i,
  /\bmy\s*(number|contact|phone|whatsapp)\s*(is|:)/i,
  /\btext\s*me\s*(on|at|via)\b/i,
  /\bmeet\s*(me\s*)?(outside|off\s*platform|off-platform)\b/i,
];

const MAX_VIOLATIONS = 3;

/* ── Safe query helper — always resolves, never hangs ── */
async function safeQuery(queryFn) {
  return new Promise(async (resolve) => {
    const timer = setTimeout(() => resolve({ data: null, error: new Error('TIMEOUT') }), 8000);
    try {
      const result = await queryFn();
      clearTimeout(timer);
      resolve(result);
    } catch (e) {
      clearTimeout(timer);
      resolve({ data: null, error: e });
    }
  });
}

/* ── Load all conversations for a user ── */
async function loadConversations(userId) {
  const result = await safeQuery(() =>
    window.supabase
      .from('message_threads')
      .select(`
        id, customer_id, tasker_id, context_type, context_id,
        last_message, last_message_at, customer_unread, tasker_unread,
        customer:customer_id(id, name, first_name, last_name, avatar_url),
        tasker:tasker_id(id, name, first_name, last_name, avatar_url)
      `)
      .or('customer_id.eq.' + userId + ',tasker_id.eq.' + userId)
      .order('last_message_at', { ascending: false })
  );

  if (result.error) throw result.error;
  return result.data || [];
}

/* ── Load messages for a thread ── */
async function loadMessages(threadId) {
  const result = await safeQuery(() =>
    window.supabase
      .from('messages')
      .select('id, sender_id, body, created_at, flagged')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
  );
  if (result.error) throw result.error;
  return result.data || [];
}

/* ── Send a message ── */
async function sendMessage(threadId, senderId, receiverId, body) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const violated = CONTACT_PATTERNS.some(p => p.test(trimmed));

  const result = await safeQuery(() =>
    window.supabase
      .from('messages')
      .insert({ thread_id: threadId, sender_id: senderId, receiver_id: receiverId, body: trimmed, flagged: violated })
      .select()
      .single()
  );
  if (result.error) throw result.error;

  /* Update thread last_message */
  await safeQuery(() =>
    window.supabase.from('message_threads')
      .update({ last_message: trimmed.slice(0, 80), last_message_at: new Date().toISOString() })
      .eq('id', threadId)
  );

  if (violated) handleContactViolation(senderId).catch(() => {});
  return result.data;
}

/* ── Contact violation handler ── */
async function handleContactViolation(userId) {
  try {
    const { data: u } = await window.supabase.from('users').select('contact_violations').eq('id', userId).maybeSingle();
    const violations = ((u && u.contact_violations) || 0) + 1;
    await window.supabase.from('users').update({ contact_violations: violations }).eq('id', userId);
    if (violations >= MAX_VIOLATIONS) {
      await window.supabase.from('users').update({ is_flagged: true, flagged_reason: 'Repeated contact sharing violations' }).eq('id', userId);
    }
  } catch (e) { /* non-blocking */ }
}

/* ── Subscribe to realtime messages ── */
function subscribeToThread(threadId, onMessage) {
  return window.supabase
    .channel('thread:' + threadId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: 'thread_id=eq.' + threadId,
    }, payload => onMessage(payload.new))
    .subscribe();
}

/* ── Get or create thread ── */
async function getOrCreateThread(customerId, taskerId, contextType, contextId) {
  const existing = await safeQuery(() =>
    window.supabase.from('message_threads').select('id')
      .eq('customer_id', customerId).eq('tasker_id', taskerId).eq('context_id', contextId)
      .maybeSingle()
  );
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const created = await safeQuery(() =>
    window.supabase.from('message_threads').insert({
      customer_id: customerId, tasker_id: taskerId,
      context_type: contextType, context_id: contextId,
      last_message: null, last_message_at: new Date().toISOString(),
      customer_unread: 0, tasker_unread: 0,
    }).select('id').single()
  );
  if (created.error) throw created.error;
  return created.data.id;
}

/* ── Mark messages as read ── */
async function markRead(threadId, userId, role) {
  const col = role === 'customer' ? 'customer_unread' : 'tasker_unread';
  await safeQuery(() =>
    window.supabase.from('message_threads').update({ [col]: 0 }).eq('id', threadId)
  );
}

window.ST = window.ST || {};
window.ST.messages = {
  loadConversations, loadMessages, sendMessage,
  subscribeToThread, getOrCreateThread, markRead,
  CONTACT_PATTERNS,
};
