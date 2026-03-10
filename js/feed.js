/* ============================================================
   STREET TASKER — feed.js  (Sprint 3.2 Final)
   Social feed: loads from Supabase, falls back to static.
   Likes and comments persist to DB.
   ============================================================ */
'use strict';

const STATIC_POSTS = [
  { id:'p1', author:'Sadia Bello',     initials:'SB', avatarClass:'av-5', service:'Make-up Artist', location:'Ajah, Lagos',   timeAgo:'2 hours ago', caption:'Just wrapped a beautiful bridal session today! Full glam look for an Abuja-Lagos wedding. ✨', likes:142, comments:18, liked:false },
  { id:'p2', author:'Adebayo Okafor',  initials:'AO', avatarClass:'av-1', service:'Electrician',    location:'Lekki, Lagos',  timeAgo:'5 hours ago', caption:'Complete rewiring job done for a 4-bedroom apartment in Lekki Phase 1. New smart panel and surge protection installed. DM for quotes!', likes:89,  comments:12, liked:false },
  { id:'p3', author:'Aisha Yusuf',     initials:'AY', avatarClass:'av-3', service:'House Cleaner',  location:'Lekki, Lagos',  timeAgo:'1 day ago',   caption:'Before & after move-in clean for a stunning apartment on Ozumba Mbadiwe. Booking slots open next week!', likes:203, comments:31, liked:false },
  { id:'p4', author:'Chidi Fernandez', initials:'CF', avatarClass:'av-2', service:'Barber',         location:'V/Island',      timeAgo:'2 days ago',  caption:'New client special running this week — fresh cuts starting at ₦2,500. Book your slot now!', likes:67,  comments:9,  liked:false },
];

let feedState = [];
let feedPage  = 1;
const FEED_PAGE_SIZE = 4;

/* ── Init ────────────────────────────────────────────────────── */
async function initFeedPage() {
  feedState = [];
  feedPage  = 1;

  /* Load from Supabase */
  try {
    const posts = await window.ST.db.fetchFeedPosts({ limit: 30 });
    if (posts && posts.length > 0) {
      feedState = posts.map((p, i) => ({
        id:          String(p.id),
        author:      p.author_name || 'Tasker',
        initials:    (p.author_name || 'TK').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase(),
        avatarClass: `av-${(i % 6) + 1}`,
        service:     p.service || '',
        location:    p.location || 'Lagos',
        timeAgo:     timeAgo(p.created_at),
        caption:     p.caption || '',
        likes:       parseInt(p.likes) || 0,
        comments:    0,
        liked:       false,
        fromDB:      true,
      }));
    }
  } catch (err) {
    console.warn('[Feed] Supabase load failed:', err.message);
  }

  /* Append static posts if DB is empty */
  if (feedState.length === 0) feedState = [...STATIC_POSTS];

  renderFeed(1);
  wireFeed();
}

/* ── Render ──────────────────────────────────────────────────── */
function renderFeed(page = 1) {
  feedPage = page;
  const container = document.getElementById('feedContainer');
  const loadMoreWrap = document.getElementById('feedLoadMoreWrap');
  if (!container) return;

  const slice = feedState.slice(0, page * FEED_PAGE_SIZE);
  container.innerHTML = slice.map(buildPost).join('');

  if (loadMoreWrap) {
    loadMoreWrap.style.display = slice.length < feedState.length ? 'flex' : 'none';
  }
}

function buildPost(post) {
  const bgColors = ['#1A0A2E','#0F172A','#0A1628','#1A0A10'];
  const bg = bgColors[Math.abs(post.id.toString().charCodeAt(0)) % bgColors.length];
  return `
  <article class="feed-post fade-up" id="post-${post.id}">
    <div class="post-header">
      <div class="post-avatar ${post.avatarClass}">${post.initials}</div>
      <div class="post-author-info">
        <div class="post-author-name">${post.author}</div>
        <div class="post-author-meta">${post.service}${post.location ? ' · ' + post.location : ''}</div>
      </div>
      <div class="post-time">${post.timeAgo}</div>
    </div>
    <div class="post-media" style="background:${bg}; min-height:180px; border-radius:var(--radius-md); margin-bottom:14px; display:flex; align-items:center; justify-content:center;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </div>
    <div class="post-caption">${post.caption}</div>
    <div class="post-actions">
      <button class="post-action-btn ${post.liked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${post.liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span id="likes-${post.id}">${post.likes}</span>
      </button>
      <button class="post-action-btn" onclick="toggleComments('${post.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Comment
      </button>
    </div>
    <div class="post-comments" id="comments-${post.id}" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
      <div id="comment-list-${post.id}" style="margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px;">
        <input type="text" id="comment-input-${post.id}" placeholder="Write a comment..."
          style="flex:1; padding:8px 12px; border:1.5px solid var(--border); border-radius:var(--radius-pill); font-size:0.84rem; font-family:var(--font); outline:none;"
          onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter'){submitComment('${post.id}'); return false;}" />
        <button class="btn btn-primary btn-sm" onclick="submitComment('${post.id}')">Send</button>
      </div>
    </div>
  </article>`;
}

/* ── Actions ─────────────────────────────────────────────────── */
function wireFeed() {
  const loadMoreBtn = document.getElementById('feedLoadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => renderFeed(feedPage + 1));
}

async function toggleLike(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post) return;

  post.liked  = !post.liked;
  post.likes += post.liked ? 1 : -1;
  post.likes  = Math.max(0, post.likes);

  const el = document.getElementById(`likes-${postId}`);
  if (el) el.textContent = post.likes;
  const btn = el?.closest('.post-action-btn');
  if (btn) {
    btn.classList.toggle('liked', post.liked);
    btn.querySelector('svg').setAttribute('fill', post.liked ? 'currentColor' : 'none');
  }

  if (post.fromDB) {
    try { await window.ST.db.togglePostLike(postId, post.likes, post.liked); } catch (e) {}
  }
}
window.toggleLike = toggleLike;

function toggleComments(postId) {
  const box = document.getElementById(`comments-${postId}`);
  if (!box) return;
  const open = box.style.display === 'none' || !box.style.display;
  box.style.display = open ? 'block' : 'none';
  if (open) loadComments(postId);
}
window.toggleComments = toggleComments;

async function loadComments(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post || !post.fromDB) return;
  const listEl = document.getElementById(`comment-list-${postId}`);
  if (!listEl) return;
  try {
    const comments = await window.ST.db.fetchComments(postId);
    listEl.innerHTML = comments.map(c => `
      <div style="padding:6px 0; font-size:0.83rem; border-bottom:1px solid var(--gray-100);">
        <strong style="color:var(--text-primary);">${c.users?.name || 'User'}</strong>
        <span style="color:var(--text-secondary); margin-left:6px;">${c.body}</span>
      </div>`).join('') || '<p style="font-size:0.82rem; color:var(--text-muted);">No comments yet.</p>';
  } catch (e) {}
}

async function submitComment(postId) {
  const input = document.getElementById(`comment-input-${postId}`);
  const body  = input?.value?.trim();
  if (!body) return;

  const user = await window.ST.auth.getCurrentUser();
  if (!user) { showToast('Log in to comment.'); return; }

  const listEl = document.getElementById(`comment-list-${postId}`);
  const name   = user.user_metadata?.name || user.email?.split('@')[0] || 'You';
  const div = document.createElement('div');
  div.style.cssText = 'padding:6px 0; font-size:0.83rem; border-bottom:1px solid var(--gray-100);';
  div.innerHTML = `<strong style="color:var(--text-primary);">${name}</strong><span style="color:var(--text-secondary); margin-left:6px;">${body}</span>`;
  listEl?.appendChild(div);
  input.value = '';

  const post = feedState.find(p => p.id === postId);
  if (post?.fromDB) {
    try { await window.ST.db.postComment({ postId, body }); } catch (e) {}
  }
}
window.submitComment = submitComment;

function timeAgo(iso) {
  if (!iso) return 'recently';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

window.initFeedPage = initFeedPage;
