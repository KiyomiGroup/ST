/* ============================================================
   STREET TASKER — messages.js
   In-platform messaging between customers and taskers.

   RULES:
   1. Only customers can initiate messages
   2. Customer must have an accepted booking (service) or
      accepted task application to message a tasker
   3. Contact-sharing detection flags & suspends accounts
   4. Real-time via Supabase channel subscription
   ============================================================ */
'use strict';

/* ── Contact-sharing detection patterns ──────────────────────
   Any message matching these triggers a warning + flag.
   3+ violations = account suspended.                        */
const CONTACT_PATTERNS = [
  /\b(\+?234|0)[789]\d{9}\b/,                          // Nigerian phone numbers
  /\b\d{4}[\s\-]?\d{3}[\s\-]?\d{4}\b/,                // generic phone patterns
  /whatsapp\.com\/|wa\.me\//i,                          // WhatsApp links
  /telegram\.me\/|t\.me\//i,                            // Telegram
  /instagram\.com\//i,
  /snapchat\.com\//i,
  /\btelegram\b.*\bme\b/i,
  /\byou\s*can\s*(call|reach|find|contact)\s*me\b/i,
  /\bmy\s*(number|contact|phone|whatsapp)\s*(is|:)/i,
  /\btext\s*me\s*(on|at|via)\b/i,
  /\bmeet\s*(me\s*)?(outside|off\s*platform|off-platform)\b/i,
  /\b(dm|direct\s*message)\s*me\b/i,
];

const MAX_VIOLATIONS = 3;

/* ── Thread key: sorted user IDs + context ID ─────────────── */
function threadKey(userA, userB, contextId) {
  return [userA, userB].sort().join('_') + '_' + contextId;
}

/* ── Check if customer is allowed to message this tasker ───── */
async function canCustomerMessage(customerId, taskerId, contextId, contextType) {
  /* contextType: 'booking' | 'task_application' */
  try {
    if (contextType === 'booking') {
      const { data } = await window.supabase
        .from('bookings')
        .select('id, status')
        .eq('customer_id', customerId)
        .eq('tasker_id', taskerId)
        .in('status', ['confirmed', 'completed'])
        .limit(1)
        .maybeSingle();
      return !!data;
    }
    if (contextType === 'task_application') {
      const { data } = await window.supabase
        .from('task_applications')
        .select('id, status')
        .eq('id', contextId)
        .eq('tasker_id', taskerId)
        .eq('status', 'accepted')
        .maybeSingle();
      return !!data;
    }
  } catch (e) {
    console.warn('[Messages] canMessage check failed:', e.message);
  }
  return false;
}

/* ── Load messages for a thread ──────────────────────────────  */
async function loadMessages(threadId) {
  const queryPromise = window.supabase
    .from('messages')
    .select('id, sender_id, body, created_at, flagged')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Messages timed out. Check your connection.')), 10000)
  );

  const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
  if (error) throw error;
  return data || [];
}

/* ── Send a message ─────────────────────────────────────────── */
async function sendMessage(threadId, senderId, receiverId, body) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  /* Scan for contact sharing */
  const violated = CONTACT_PATTERNS.some(p => p.test(trimmed));

  const { data, error } = await window.supabase
    .from('messages')
    .insert({
      thread_id:   threadId,
      sender_id:   senderId,
      receiver_id: receiverId,
      body:        trimmed,
      flagged:     violated,
    })
    .select()
    .single();

  if (error) throw error;

  if (violated) {
    /* Log a violation and potentially suspend */
    await handleContactViolation(senderId, threadId, trimmed);
  }

  return data;
}

/* ── Contact violation handler ──────────────────────────────── */
async function handleContactViolation(userId, threadId, body) {
  try {
    /* Increment violation count in users table */
    const { data: u } = await window.supabase
      .from('users')
      .select('contact_violations')
      .eq('id', userId)
      .maybeSingle();

    const violations = ((u && u.contact_violations) || 0) + 1;

    await window.supabase
      .from('users')
      .update({ contact_violations: violations })
      .eq('id', userId);

    if (violations >= MAX_VIOLATIONS) {
      /* Flag account */
      await window.supabase
        .from('users')
        .update({ is_flagged: true, flagged_reason: 'Repeated contact sharing violations' })
        .eq('id', userId);
    }
  } catch (e) {
    console.warn('[Messages] violation log failed:', e.message);
  }
}

/* ── Subscribe to realtime messages for a thread ────────────── */
function subscribeToThread(threadId, onMessage) {
  return window.supabase
    .channel('thread:' + threadId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: 'thread_id=eq.' + threadId,
    }, payload => onMessage(payload.new))
    .subscribe();
}

/* ── Load all conversations for a user ─────────────────────── */
async function loadConversations(userId) {
  /* Race the Supabase query against a 10-second timeout */
  const queryPromise = window.supabase
    .from('message_threads')
    .select(`
      id, customer_id, tasker_id, context_type, context_id,
      last_message, last_message_at, customer_unread, tasker_unread,
      customer:customer_id(id, name, first_name, last_name, avatar_url),
      tasker:tasker_id(id, name, first_name, last_name, avatar_url)
    `)
    .or('customer_id.eq.' + userId + ',tasker_id.eq.' + userId)
    .order('last_message_at', { ascending: false });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out. Check your connection.')), 10000)
  );

  const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
  if (error) throw error;
  return data || [];
}

/* ── Mark messages as read ───────────────────────────────────── */
async function markRead(threadId, userId, role) {
  const col = role === 'customer' ? 'customer_unread' : 'tasker_unread';
  await window.supabase
    .from('message_threads')
    .update({ [col]: 0 })
    .eq('id', threadId);
}

/* ── Get or create thread ────────────────────────────────────── */
async function getOrCreateThread(customerId, taskerId, contextType, contextId) {
  /* Check if thread already exists */
  const { data: existing } = await window.supabase
    .from('message_threads')
    .select('id')
    .eq('customer_id', customerId)
    .eq('tasker_id', taskerId)
    .eq('context_id', contextId)
    .maybeSingle();

  if (existing) return existing.id;

  /* Create new thread */
  const { data: created, error } = await window.supabase
    .from('message_threads')
    .insert({
      customer_id:   customerId,
      tasker_id:     taskerId,
      context_type:  contextType,
      context_id:    contextId,
      last_message:  null,
      last_message_at: new Date().toISOString(),
      customer_unread: 0,
      tasker_unread:   0,
    })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

/* ── Update thread last message ─────────────────────────────── */
async function updateThreadLastMessage(threadId, body, senderId, customerId) {
  const isCustomer = senderId === customerId;
  const update = {
    last_message: body.slice(0, 80),
    last_message_at: new Date().toISOString(),
  };
  /* Increment unread for the OTHER party */
  if (isCustomer) update.tasker_unread = window.supabase.rpc ? undefined : null; /* handled via DB trigger ideally */
  await window.supabase.from('message_threads').update(update).eq('id', threadId);
}

window.ST = window.ST || {};
window.ST.messages = {
  canCustomerMessage,
  loadMessages,
  sendMessage,
  subscribeToThread,
  loadConversations,
  markRead,
  getOrCreateThread,
  updateThreadLastMessage,
  CONTACT_PATTERNS,
};
