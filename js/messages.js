/* ============================================================
   STREET TASKER — messages.js
   In-platform messaging between customers and taskers.
   Includes payment negotiation flow (Sprint 5).
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
  /* Fetch threads without JOIN to avoid FK dependency on public.users */
  const result = await safeQuery(() =>
    window.supabase
      .from('message_threads')
      .select('id, customer_id, tasker_id, context_type, context_id, last_message, last_message_at, customer_unread, tasker_unread, agreed_price')
      .or('customer_id.eq.' + userId + ',tasker_id.eq.' + userId)
      .order('last_message_at', { ascending: false })
  );
  if (result.error) throw result.error;
  const threads = result.data || [];

  /* Fetch names for the other party in each thread */
  const otherIds = [...new Set(threads.map(t => userId === t.customer_id ? t.tasker_id : t.customer_id).filter(Boolean))];
  const nameMap = {};
  if (otherIds.length > 0) {
    try {
      const uRes = await window.supabase.from('users').select('id,name,first_name,last_name,avatar_url').in('id', otherIds);
      (uRes.data || []).forEach(u => { nameMap[u.id] = u; });
    } catch(_e) {}
  }

  return threads.map(t => {
    const isCustomer = userId === t.customer_id;
    const otherId    = isCustomer ? t.tasker_id : t.customer_id;
    t.customer = isCustomer ? { id: userId } : (nameMap[otherId] || { id: otherId });
    t.tasker   = isCustomer ? (nameMap[otherId] || { id: otherId }) : { id: userId };
    return t;
  });
}

/* ── Load messages for a thread ── */
async function loadMessages(threadId) {
  const result = await safeQuery(() =>
    window.supabase
      .from('messages')
      .select('id, sender_id, body, created_at, flagged, type, payment_request_id')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
  );
  if (result.error) throw result.error;
  return result.data || [];
}

/* ── Send a regular message ── */
async function sendMessage(threadId, senderId, receiverId, body) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const violated = CONTACT_PATTERNS.some(p => p.test(trimmed));

  const result = await safeQuery(() =>
    window.supabase
      .from('messages')
      .insert({ thread_id: threadId, sender_id: senderId, receiver_id: receiverId, body: trimmed, flagged: violated, type: 'text' })
      .select()
      .single()
  );
  if (result.error) throw result.error;

  await safeQuery(() =>
    window.supabase.from('message_threads')
      .update({ last_message: trimmed.slice(0, 80), last_message_at: new Date().toISOString() })
      .eq('id', threadId)
  );

  if (violated) handleContactViolation(senderId).catch(() => {});
  return result.data;
}

/* ── Send a payment request message (tasker only) ── */
async function sendPaymentRequest(threadId, senderId, receiverId, amountNaira) {
  if (!amountNaira || isNaN(amountNaira) || amountNaira <= 0) {
    throw new Error('Please enter a valid amount.');
  }

  const reqResult = await safeQuery(() =>
    window.supabase.from('payment_requests').insert({
      thread_id:   threadId,
      tasker_id:   senderId,
      customer_id: receiverId,
      amount:      Math.round(amountNaira),
      status:      'pending',
    }).select().single()
  );
  if (reqResult.error) throw reqResult.error;

  const requestId = reqResult.data.id;
  const formatted = Number(amountNaira).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  const msgBody = 'PAYMENT_REQUEST:' + requestId + ':' + Math.round(amountNaira);

  const msgResult = await safeQuery(() =>
    window.supabase.from('messages').insert({
      thread_id:          threadId,
      sender_id:          senderId,
      receiver_id:        receiverId,
      body:               msgBody,
      flagged:            false,
      type:               'payment_request',
      payment_request_id: requestId,
    }).select().single()
  );
  if (msgResult.error) throw msgResult.error;

  await safeQuery(() =>
    window.supabase.from('message_threads')
      .update({ last_message: ('Payment request: ' + formatted).slice(0, 80), last_message_at: new Date().toISOString() })
      .eq('id', threadId)
  );

  try {
    await window.supabase.from('notifications').insert({
      user_id: receiverId,
      type:    'payment_request',
      title:   'Payment request: ' + formatted,
      message: 'Your service provider has sent a payment request. Review and pay securely through the platform.',
      data:    { thread_id: threadId, payment_request_id: requestId },
      is_read: false,
    });
  } catch(_e) {}

  return { requestId, messageId: msgResult.data.id };
}

/* ── Customer accepts a payment request ── */
async function acceptPaymentRequest(requestId, threadId, contextType, contextId, customerEmail, customerName, taskerUserIdHint) {
  const { data: req, error: reqErr } = await window.supabase
    .from('payment_requests').select('*').eq('id', requestId).maybeSingle();
  if (reqErr) throw reqErr;
  if (!req) throw new Error('Payment request not found.');

  if (req.status === 'paid') throw new Error('This payment has already been completed.');

  if (req.status === 'pending') {
    await window.supabase.from('payment_requests')
      .update({ status: 'accepted' }).eq('id', requestId);
  }

  /* Store agreed price on thread */
  await window.supabase.from('message_threads')
    .update({ agreed_price: req.amount }).eq('id', threadId);

  /* Resolve tasker ID — use hint, then req.tasker_id, then fetch from thread */
  let taskerUserId = taskerUserIdHint || req.tasker_id || null;
  if (!taskerUserId) {
    try {
      const tRes = await window.supabase.from('message_threads').select('tasker_id').eq('id', threadId).maybeSingle();
      if (tRes.data) taskerUserId = tRes.data.tasker_id;
    } catch(_e) {}
  }

  if (window.ST && window.ST.payments) {
    return await window.ST.payments.initiatePayment({
      contextType:  contextType,  /* 'task' or 'booking' */
      contextId:    contextId,    /* task_id or booking_id */
      bookingId:    contextType === 'booking' ? contextId : null,
      taskId:       contextType === 'task' ? contextId : null,
      amountNaira:  req.amount,
      customerEmail,
      customerName,
      taskerUserId,
    });
  }
  throw new Error('Payment system not loaded. Please refresh and try again.');
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
  } catch (e) {}
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
  sendPaymentRequest, acceptPaymentRequest,
  subscribeToThread, getOrCreateThread, markRead,
  CONTACT_PATTERNS,
};
