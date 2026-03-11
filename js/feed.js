/* ============================================================
   STREET TASKER — feed.js  (Sprint 3.3)
   CSS classes corrected to match feed.css.
   Loads from feed_posts table, falls back to static.
   ============================================================ */
'use strict';

const STATIC_POSTS = [
  {
    id:'p1', author:'Sadia Bello', initials:'SB', avatarClass:'av-5',
    service:'Make-up Artist', location:'Ajah, Lagos', timeAgo:'2 hours ago',
    caption:'Just wrapped a beautiful bridal session today! Full glam look for an Abuja-Lagos wedding. ✨',
    mediaColor:'#1A0A2E', mediaIcon:'star', likes:142, comments:18, liked:false, saved:false,
  },
  {
    id:'p2', author:'Adebayo Okafor', initials:'AO', avatarClass:'av-1',
    service:'Electrician', location:'Lekki, Lagos', timeAgo:'5 hours ago',
    caption:'Complete rewiring job done for a 4-bedroom apartment in Lekki Phase 1. New smart panel and surge protection installed. DM for quotes!',
    mediaColor:'#0F172A', mediaIcon:'zap', likes:89, comments:12, liked:false, saved:false,
  },
  {
    id:'p3', author:'Aisha Yusuf', initials:'AY', avatarClass:'av-3',
    service:'House Cleaner', location:'Lekki Phase 1, Lagos', timeAgo:'1 day ago',
    caption:'Before & after move-in clean for a stunning apartment on Ozumba Mbadiwe. Booking slots open for next week!',
    mediaColor:'#0A1628', mediaIcon:'clean', likes:203, comments:31, liked:false, saved:false,
  },
  {
    id:'p4', author:'Chidi Fernandez', initials:'CF', avatarClass:'av-2',
    service:'Barber', location:'Victoria Island', timeAgo:'2 days ago',
    caption:'New client special running this week — fresh cuts starting at ₦2,500. Book your slot now!',
    mediaColor:'#1E3A5F', mediaIcon:'scissors', likes:67, comments:9, liked:false, saved:false,
  },
];

const MEDIA_ICONS = {
  star:     `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  zap:      `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  clean:    `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>`,
  scissors: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/></svg>`,
  img:      `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
};

let feedState = [];
let feedPage  = 1;
const FEED_PAGE_SIZE = 6;

/* ── Init ────────────────────────────────────────────────────── */
async function initFeedPage() {
  feedState = [];
  feedPage  = 1;

  try {
    const posts = await window.ST.db.fetchFeedPosts({ limit: 40 });
    if (posts && posts.length > 0) {
      const colors = ['#1A0A2E','#0F172A','#0A1628','#1E3A5F','#1A3320','#2D1B00'];
      feedState = posts.map((p, i) => ({
        id:          String(p.id),
        author:      p.author_name || 'Tasker',
        initials:    (p.author_name || 'TK').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase(),
        avatarClass: `av-${(i % 6) + 1}`,
        service:     p.service || '',
        location:    p.location || 'Lagos',
        timeAgo:     timeAgo(p.created_at),
        caption:     p.caption || '',
        mediaColor:  p.image_url ? null : colors[i % colors.length],
        imageUrl:    p.image_url || null,
        mediaIcon:   'img',
        likes:       parseInt(p.likes) || 0,
        comments:    0,
        liked:       false,
        saved:       false,
        fromDB:      true,
      }));
    }
  } catch (err) {
    console.warn('[Feed] Supabase load failed:', err.message);
  }

  if (feedState.length === 0) feedState = [...STATIC_POSTS];

  renderFeed(1);
  wireFeed();
}

/* ── Render ──────────────────────────────────────────────────── */
function renderFeed(page = 1) {
  feedPage = page;
  const container    = document.getElementById('feedContainer');
  const loadMoreWrap = document.getElementById('feedLoadMoreWrap');
  if (!container) return;

  const slice = feedState.slice(0, page * FEED_PAGE_SIZE);
  container.innerHTML = slice.map(buildPost).join('');

  if (loadMoreWrap) {
    loadMoreWrap.style.display = slice.length < feedState.length ? 'flex' : 'none';
  }
}

function buildPost(post) {
  const heartFill = post.liked ? 'var(--red)' : 'none';
  const heartStroke = post.liked ? 'var(--red)' : 'currentColor';

  const media = post.imageUrl
    ? `<img src="${post.imageUrl}" alt="${post.author}" style="width:100%;height:auto;max-height:480px;object-fit:cover;display:block;" />`
    : `<div style="background:${post.mediaColor};width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${MEDIA_ICONS[post.mediaIcon] || MEDIA_ICONS.img}<div class="feed-media-overlay"><span class="feed-media-label">${post.service || 'Street Tasker'}</span></div></div>`;
  const mediaClass = post.imageUrl ? 'feed-media has-image' : 'feed-media';

  return `
<article class="feed-post" id="post-${post.id}">
  <div class="feed-post-header">
    <div class="feed-avatar ${post.avatarClass}">${post.initials}</div>
    <div class="feed-author-info">
      <div class="feed-author-name">${post.author}</div>
      <div class="feed-author-meta">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        ${post.service}
        ${post.location ? `<span>·</span><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${post.location}` : ''}
      </div>
    </div>
    <span class="feed-post-time">${post.timeAgo}</span>
  </div>

  <div class="${mediaClass}">${media}</div>

  <div class="feed-like-count" id="like-count-${post.id}">${post.likes} like${post.likes !== 1 ? 's' : ''}</div>

  <div class="feed-caption">
    <span class="feed-caption-author">${post.author}</span>${post.caption}
  </div>

  <div class="feed-actions">
    <div class="feed-actions-left">
      <button class="feed-action-btn ${post.liked ? 'feed-action-liked' : ''}" id="like-btn-${post.id}" onclick="toggleLike('${post.id}')" aria-label="Like post">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="${heartFill}" stroke="${heartStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
      <button class="feed-action-btn" onclick="toggleComments('${post.id}')" aria-label="Comment">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
    </div>
    <div class="feed-actions-right">
      <button class="feed-action-btn ${post.saved ? 'feed-action-saved' : ''}" onclick="toggleSave('${post.id}')" aria-label="Save">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="${post.saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
    </div>
  </div>

  <div class="feed-comments" id="comments-${post.id}" style="display:none; padding:0 18px 14px; border-top:1px solid var(--border); margin-top:4px;">
    <div id="comment-list-${post.id}" style="padding:10px 0 8px;"></div>
    <div style="display:flex; gap:8px; align-items:center;">
      <input type="text" id="comment-input-${post.id}"
        placeholder="Add a comment..."
        style="flex:1;padding:8px 14px;border:1.5px solid var(--border);border-radius:var(--radius-pill);font-size:0.83rem;font-family:var(--font);outline:none;background:var(--bg-subtle);"
        onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--border)'"
        onkeydown="if(event.key==='Enter'){submitComment('${post.id}');return false;}" />
      <button class="btn btn-primary btn-sm" onclick="submitComment('${post.id}')">Post</button>
    </div>
  </div>
</article>`;
}

/* ── Wire ────────────────────────────────────────────────────── */
function wireFeed() {
  const btn = document.getElementById('feedLoadMoreBtn');
  if (btn) btn.addEventListener('click', () => renderFeed(feedPage + 1));
}

/* ── Actions ─────────────────────────────────────────────────── */
async function toggleLike(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post) return;

  post.liked  = !post.liked;
  post.likes += post.liked ? 1 : -1;
  post.likes  = Math.max(0, post.likes);

  /* Update count label */
  const countEl = document.getElementById(`like-count-${postId}`);
  if (countEl) countEl.textContent = `${post.likes} like${post.likes !== 1 ? 's' : ''}`;

  /* Update button state */
  const btn = document.getElementById(`like-btn-${postId}`);
  if (btn) {
    btn.classList.toggle('feed-action-liked', post.liked);
    btn.classList.add('like-pop');
    setTimeout(() => btn.classList.remove('like-pop'), 300);
    const svg = btn.querySelector('path');
    if (svg) {
      svg.setAttribute('fill', post.liked ? 'var(--red)' : 'none');
      svg.setAttribute('stroke', post.liked ? 'var(--red)' : 'currentColor');
    }
  }

  if (post.fromDB) {
    try { await window.ST.db.togglePostLike(postId, post.likes, post.liked); } catch (e) {}
  }
}
window.toggleLike = toggleLike;

function toggleSave(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post) return;
  post.saved = !post.saved;
  const btn = document.getElementById(`post-${postId}`)?.querySelector('.feed-action-saved, .feed-action-btn:last-child');
  if (btn) {
    btn.classList.toggle('feed-action-saved', post.saved);
    const svg = btn.querySelector('path');
    if (svg) svg.setAttribute('fill', post.saved ? 'currentColor' : 'none');
  }
  showToast(post.saved ? 'Post saved' : 'Post unsaved');
}
window.toggleSave = toggleSave;

function toggleComments(postId) {
  const box = document.getElementById(`comments-${postId}`);
  if (!box) return;
  const open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  if (open) loadComments(postId);
}
window.toggleComments = toggleComments;

async function loadComments(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post?.fromDB) return;
  const listEl = document.getElementById(`comment-list-${postId}`);
  if (!listEl) return;
  try {
    const comments = await window.ST.db.fetchComments(postId);
    if (!comments.length) {
      listEl.innerHTML = '<p style="font-size:0.82rem;color:var(--text-muted);padding:4px 0;">No comments yet. Be the first!</p>';
      return;
    }
    listEl.innerHTML = comments.map(c => `
      <div style="padding:5px 0;font-size:0.83rem;border-bottom:1px solid var(--gray-100);">
        <strong style="color:var(--text-primary);">${c.users?.name || 'User'}</strong>
        <span style="color:var(--text-secondary);margin-left:6px;">${c.body}</span>
      </div>`).join('');
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
  const div    = document.createElement('div');
  div.style.cssText = 'padding:5px 0;font-size:0.83rem;border-bottom:1px solid var(--gray-100);';
  div.innerHTML = `<strong style="color:var(--text-primary);">${name}</strong><span style="color:var(--text-secondary);margin-left:6px;">${body}</span>`;
  if (listEl) {
    const empty = listEl.querySelector('p');
    if (empty) empty.remove();
    listEl.appendChild(div);
  }
  input.value = '';

  const post = feedState.find(p => p.id === postId);
  if (post?.fromDB) {
    try { await window.ST.db.postComment({ postId, body }); } catch (e) {}
  }
}
window.submitComment = submitComment;

function timeAgo(iso) {
  if (!iso) return 'recently';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

window.initFeedPage = initFeedPage;
