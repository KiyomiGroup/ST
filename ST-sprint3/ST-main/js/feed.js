/* ============================================================
   STREET TASKERS — feed.js
   Sprint 2: Social feed UI — likes, comments, posts
   ============================================================
   All interactions are client-side only in Sprint 2.
   Like counts and comments are stored in memory and reset
   on page reload.

   Future Sprint 3: Replace placeholder data with:
     fetchSocialFeed() from future-features.js
   Future Sprint 3: Like/comment actions call Supabase:
     supabase.from('likes').insert({ post_id, user_id })
     supabase.from('comments').insert({ post_id, user_id, body })
   Future Sprint 3: Real-time like counts via Supabase Realtime:
     supabase.channel('likes').on('postgres_changes', ...).subscribe()
   ============================================================ */

'use strict';

/* ── Placeholder feed data ───────────────────────────────────── */
/*
 * Future Sprint 3: Replace with fetchSocialFeed() result.
 * Schema mirrors Supabase 'posts' JOIN 'profiles' JOIN 'likes'.
 */
const FEED_POSTS = [
  {
    id:         'p1',
    authorId:   't5',
    author:     'Sadia Bello',
    initials:   'SB',
    avatarClass:'av-5',
    service:    'Make-up Artist',
    category:   'beauty',
    location:   'Ajah, Lagos',
    timeAgo:    '2 hours ago',
    caption:    'Just wrapped a beautiful bridal session today! Full glam look for an Abuja-Lagos wedding. Swipe to see the full transformation. ✨',
    tags:       ['#BridalMakeup', '#LagosWedding', '#GlamArtist'],
    likes:      142,
    comments:   18,
    liked:      false,
    saved:      false,
    mediaType:  'placeholder',
    mediaColor: '#1A0A2E',
    mediaIcon:  'star',
  },
  {
    id:         'p2',
    authorId:   't1',
    author:     'Adebayo Okafor',
    initials:   'AO',
    avatarClass:'av-1',
    service:    'Electrician',
    category:   'electrician',
    location:   'Lekki, Lagos',
    timeAgo:    '5 hours ago',
    caption:    'Complete rewiring job done for a 4-bedroom apartment in Lekki Phase 1. New smart panel, load-shedding bypass, and whole-apartment surge protection installed. DM for quotes!',
    tags:       ['#Electrical', '#SmartHome', '#LagosElectrician'],
    likes:      89,
    comments:   12,
    liked:      false,
    saved:      false,
    mediaType:  'placeholder',
    mediaColor: '#0F172A',
    mediaIcon:  'zap',
  },
  {
    id:         'p3',
    authorId:   't9',
    author:     'Aisha Yusuf',
    initials:   'AY',
    avatarClass:'av-3',
    service:    'House Cleaner',
    category:   'cleaning',
    location:   'Lekki Phase 1, Lagos',
    timeAgo:    '1 day ago',
    caption:    'Before & after move-in clean for a stunning apartment on Ozumba Mbadiwe. The difference speaks for itself. Booking slots open for next week!',
    tags:       ['#MovingCleaning', '#DeepClean', '#LagosCleaners'],
    likes:      203,
    comments:   31,
    liked:      false,
    saved:      false,
    mediaType:  'placeholder',
    mediaColor: '#16301E',
    mediaIcon:  'sparkles',
  },
  {
    id:         'p4',
    authorId:   't2',
    author:     'Chidi Fernandez',
    initials:   'CF',
    avatarClass:'av-2',
    service:    'Barber',
    category:   'barber',
    location:   'Victoria Island, Lagos',
    timeAgo:    '1 day ago',
    caption:    'Fresh cuts all day. Low fade with line-up for a client heading to a corporate event. Precision is everything. Book via the app!',
    tags:       ['#BarberLife', '#LagosBarber', '#FreshCut'],
    likes:      167,
    comments:   24,
    liked:      false,
    saved:      false,
    mediaType:  'placeholder',
    mediaColor: '#1E3A5F',
    mediaIcon:  'scissors',
  },
  {
    id:         'p5',
    authorId:   't4',
    author:     'Emeka Obi',
    initials:   'EO',
    avatarClass:'av-4',
    service:    'Mechanic',
    category:   'mechanic',
    location:   'Surulere, Lagos',
    timeAgo:    '2 days ago',
    caption:    'Full engine overhaul on a 2019 Toyota Camry. New timing chain, valve seals, and gaskets. Running smooth as new. Genuine parts only.',
    tags:       ['#AutoRepair', '#LagosGarage', '#ToyotaSpecialist'],
    likes:      98,
    comments:   15,
    liked:      false,
    saved:      false,
    mediaType:  'placeholder',
    mediaColor: '#2D1B00',
    mediaIcon:  'wrench',
  },
  {
    id:         'p6',
    authorId:   't10',
    author:     'Chukwuemeka Odu',
    initials:   'CO',
    avatarClass:'av-4',
    service:    'Carpenter',
    category:   'carpentry',
    location:   'Oshodi, Lagos',
    timeAgo:    '3 days ago',
    caption:    'Custom wardrobe build with sliding doors and internal LED lighting. Client briefing to finished product in 4 days. Quality craftsmanship guaranteed.',
    tags:       ['#Carpentry', '#CustomFurniture', '#LagosWoodwork'],
    likes:      74,
    comments:   9,
    liked:      false,
    saved:      false,
    mediaType:  'placeholder',
    mediaColor: '#1A1000',
    mediaIcon:  'hammer',
  },
];

/* ── In-memory state ─────────────────────────────────────────── */
/*
 * Future Sprint 3: Replace with Supabase Realtime subscription.
 * Likes persisted in 'likes' table, comments in 'comments' table.
 */
let feedState  = FEED_POSTS.map(p => ({ ...p })); // shallow copy for mutability
let feedPage   = 1;
const PAGE_SIZE = 4;

/* Placeholder comments per post */
const POST_COMMENTS = {
  p1: [
    { author:'Temi A.',  initials:'TA', avatarClass:'av-2', body:'Absolutely stunning! You are so talented!', timeAgo:'1 hour ago' },
    { author:'Bola M.',  initials:'BM', avatarClass:'av-3', body:'DM\'d you! I need this for my sister\'s wedding.', timeAgo:'1 hour ago' },
  ],
  p2: [
    { author:'Kunle T.', initials:'KT', avatarClass:'av-1', body:'Excellent work Adebayo! Very thorough.', timeAgo:'4 hours ago' },
  ],
  p3: [
    { author:'Priya S.', initials:'PS', avatarClass:'av-5', body:'This is exactly what I need for my new place!', timeAgo:'20 hours ago' },
    { author:'Zara O.',  initials:'ZO', avatarClass:'av-6', body:'The before pics don\'t do the after justice 😄', timeAgo:'18 hours ago' },
  ],
};

/* ── Init ────────────────────────────────────────────────────── */
function initFeedPage() {
  renderFeed(1);
  wireNewPostBox();
  wireLoadMore();

  console.log('[Feed] Social feed initialized ✓');
}

/* ── Render feed ─────────────────────────────────────────────── */
function renderFeed(page = 1) {
  const container = document.getElementById('feedContainer');
  if (!container) return;

  const slice = feedState.slice(0, page * PAGE_SIZE);

  if (page === 1) container.innerHTML = '';

  /* Only append new posts if loading more */
  const startIdx = (page - 1) * PAGE_SIZE;
  const newPosts = feedState.slice(startIdx, page * PAGE_SIZE);

  newPosts.forEach((post, i) => {
    const card = buildFeedPost(post, startIdx + i);
    container.appendChild(card);
  });

  feedPage = page;

  /* Load more button */
  const loadMoreWrap = document.getElementById('feedLoadMoreWrap');
  if (loadMoreWrap) {
    loadMoreWrap.style.display = (page * PAGE_SIZE) < feedState.length ? 'flex' : 'none';
  }
}

/* ── Build a feed post card ──────────────────────────────────── */
function buildFeedPost(post, index) {
  const card = document.createElement('article');
  card.className = 'feed-post anim-fade-up';
  card.id        = `post-${post.id}`;
  card.style.animationDelay = `${index * 0.07}s`;
  card.dataset.postId = post.id;

  const mediaIcon = getMediaIconSVG(post.mediaIcon, post.mediaColor);
  const tagsHTML  = post.tags.map(t => `<span class="feed-tag">${t}</span>`).join('');
  const commentsPreview = (POST_COMMENTS[post.id] || []).slice(0, 2).map(c => `
    <div class="comment-preview">
      <div class="comment-avatar ${c.avatarClass}">${c.initials}</div>
      <div class="comment-body">
        <span class="comment-author">${c.author}</span>
        <span class="comment-text">${c.body}</span>
      </div>
    </div>
  `).join('');

  card.innerHTML = `
    <!-- Post header -->
    <div class="feed-post-header">
      <div class="feed-avatar ${post.avatarClass}">${post.initials}</div>
      <div class="feed-author-info">
        <div class="feed-author-name">${post.author}</div>
        <div class="feed-author-meta">
          ${getServiceIconSVG(post.category)}
          ${post.service} &middot; ${post.location}
        </div>
      </div>
      <div class="feed-post-time">${post.timeAgo}</div>
    </div>

    <!-- Media placeholder -->
    <div class="feed-media" style="background:${post.mediaColor};">
      <div class="feed-media-icon">${mediaIcon}</div>
      <!-- Future Sprint 3: Replace with real <img> or <video> from Supabase Storage -->
      <div class="feed-media-overlay">
        <span class="feed-media-label">Portfolio Work</span>
      </div>
    </div>

    <!-- Actions bar -->
    <div class="feed-actions">
      <div class="feed-actions-left">
        <button
          class="feed-action-btn ${post.liked ? 'feed-action-liked' : ''}"
          id="like-btn-${post.id}"
          onclick="toggleLike('${post.id}')"
          aria-label="Like post"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${post.liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <button
          class="feed-action-btn"
          onclick="toggleComments('${post.id}')"
          aria-label="Comment"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button
          class="feed-action-btn"
          onclick="sharePost('${post.id}')"
          aria-label="Share"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      </div>
      <div class="feed-actions-right">
        <button
          class="feed-action-btn ${post.saved ? 'feed-action-saved' : ''}"
          id="save-btn-${post.id}"
          onclick="toggleSave('${post.id}')"
          aria-label="Save post"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${post.saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Like count -->
    <div class="feed-like-count" id="like-count-${post.id}">
      <strong id="like-num-${post.id}">${post.likes}</strong> likes
    </div>

    <!-- Caption -->
    <div class="feed-caption">
      <span class="feed-caption-author">${post.author}</span>
      <span class="feed-caption-text" id="caption-${post.id}">${truncateCaption(post.caption)}</span>
      ${post.caption.length > 120
        ? `<button class="feed-more-btn" onclick="expandCaption('${post.id}')">more</button>`
        : ''}
    </div>

    <!-- Tags -->
    <div class="feed-tags">${tagsHTML}</div>

    <!-- Comments preview -->
    ${commentsPreview ? `<div class="feed-comments-preview">${commentsPreview}</div>` : ''}

    <!-- View all comments link
         Future Sprint 3: Navigates to full post detail page -->
    ${(POST_COMMENTS[post.id] || []).length > 0
      ? `<button class="feed-view-comments" onclick="toggleComments('${post.id}')">
           View all ${post.comments} comments
         </button>`
      : ''}

    <!-- Comment input area -->
    <div class="feed-comment-box" id="comment-box-${post.id}" style="display:none;">
      <div class="feed-comment-input-row">
        <div class="feed-comment-avatar av-current">You</div>
        <div class="feed-comment-input-wrap">
          <input
            type="text"
            id="comment-input-${post.id}"
            class="feed-comment-input"
            placeholder="Add a comment..."
            maxlength="280"
            onkeydown="handleCommentKey(event, '${post.id}')"
          />
          <button class="feed-comment-send" onclick="submitComment('${post.id}')" aria-label="Post comment">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Book CTA — links to find-taskers page
         Future Sprint 3: Direct booking modal -->
    <div class="feed-book-cta">
      <button class="btn btn-outline btn-sm" onclick="openBookingFromFeed('${post.authorId}', '${post.author}', '${post.service}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Book ${post.author.split(' ')[0]}
      </button>
    </div>
  `;
  return card;
}

/* ── Like toggle ─────────────────────────────────────────────── */
/*
 * Future Sprint 3: Call Supabase:
 *   liked ? supabase.from('likes').delete().match({ post_id, user_id })
 *         : supabase.from('likes').insert({ post_id, user_id })
 * Real-time count updates via Supabase Realtime channel.
 */
function toggleLike(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post) return;

  post.liked  = !post.liked;
  post.likes += post.liked ? 1 : -1;

  /* Update UI */
  const btn      = document.getElementById(`like-btn-${postId}`);
  const numEl    = document.getElementById(`like-num-${postId}`);
  const svg      = btn?.querySelector('svg');

  if (btn)   btn.classList.toggle('feed-action-liked', post.liked);
  if (svg)   svg.setAttribute('fill', post.liked ? 'currentColor' : 'none');
  if (numEl) numEl.textContent = post.likes;

  /* Micro-animation */
  if (btn) {
    btn.classList.add('like-pop');
    setTimeout(() => btn.classList.remove('like-pop'), 300);
  }

  console.log(`[Feed] Like ${post.liked ? 'added' : 'removed'} on post ${postId} — Sprint 3 will persist to Supabase`);
}

/* ── Save toggle ─────────────────────────────────────────────── */
/*
 * Future Sprint 3: Persist to Supabase 'saved_posts' table.
 */
function toggleSave(postId) {
  const post = feedState.find(p => p.id === postId);
  if (!post) return;

  post.saved = !post.saved;
  const btn = document.getElementById(`save-btn-${postId}`);
  const svg = btn?.querySelector('svg');
  if (btn) btn.classList.toggle('feed-action-saved', post.saved);
  if (svg) svg.setAttribute('fill', post.saved ? 'currentColor' : 'none');

  showToast(post.saved ? 'Post saved to your collection' : 'Post removed from collection');
}

/* ── Comment toggle ──────────────────────────────────────────── */
function toggleComments(postId) {
  const box = document.getElementById(`comment-box-${postId}`);
  if (!box) return;
  const isOpen = box.style.display === 'none' || !box.style.display;
  box.style.display = isOpen ? 'block' : 'none';
  if (isOpen) {
    const input = document.getElementById(`comment-input-${postId}`);
    input?.focus();
  }
}

/* ── Comment submit ──────────────────────────────────────────── */
/*
 * Future Sprint 3: Call Supabase:
 *   supabase.from('comments').insert({ post_id: postId, user_id, body: text })
 */
function submitComment(postId) {
  const input = document.getElementById(`comment-input-${postId}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  /* Inject new comment into preview area */
  const preview = document.querySelector(`#post-${postId} .feed-comments-preview`);
  if (preview) {
    const div = document.createElement('div');
    div.className = 'comment-preview comment-new';
    div.innerHTML = `
      <div class="comment-avatar av-current">You</div>
      <div class="comment-body">
        <span class="comment-author">You</span>
        <span class="comment-text">${escapeHTML(text)}</span>
      </div>`;
    preview.appendChild(div);
  }

  /* Update comment count */
  const post = feedState.find(p => p.id === postId);
  if (post) {
    post.comments++;
    const viewAllBtn = document.querySelector(`#post-${postId} .feed-view-comments`);
    if (viewAllBtn) viewAllBtn.textContent = `View all ${post.comments} comments`;
  }

  input.value = '';
  showToast('Comment added — will be saved to Supabase in Sprint 3');
  console.log(`[Feed] Comment on ${postId} captured for Sprint 3:`, text);
}

function handleCommentKey(event, postId) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitComment(postId);
  }
}

/* ── Share post ──────────────────────────────────────────────── */
/*
 * Future Sprint 3: Generate real shareable URL.
 */
function sharePost(postId) {
  const url = `${window.location.origin}/post-detail.html?id=${postId}`;
  if (navigator.share) {
    navigator.share({ title: 'Street Taskers', url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() =>
      showToast('Link copied to clipboard!')
    );
  } else {
    showToast('Share link: ' + url);
  }
}

/* ── Open booking from feed ──────────────────────────────────── */
function openBookingFromFeed(authorId, name, service) {
  /*
   * Future Sprint 3: Open booking modal for this tasker.
   * For now, navigate to find-taskers page.
   */
  showSprintAlert(
    'Book This Tasker',
    `You want to book ${name} for ${service}.\n\nDirect booking from the feed will be available in Sprint 3. You can find and book ${name.split(' ')[0]} on the Find Taskers page.`
  );
}

/* ── Caption expand ──────────────────────────────────────────── */
function truncateCaption(text, max = 120) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function expandCaption(postId) {
  const post    = feedState.find(p => p.id === postId);
  const capEl   = document.getElementById(`caption-${postId}`);
  const moreBtn = capEl?.nextElementSibling;
  if (capEl && post) {
    capEl.textContent = post.caption;
    moreBtn?.remove();
  }
}

/* ── New post box ────────────────────────────────────────────── */
/*
 * Future Sprint 3: Authenticated taskers can post photos + captions.
 * Photo upload goes to Supabase Storage, post row to 'posts' table.
 */
function wireNewPostBox() {
  const input = document.getElementById('newPostInput');
  if (!input) return;
  input.addEventListener('click', () => {
    showSprintAlert(
      'Post Your Work — Sprint 3',
      'Taskers will be able to share photos of completed jobs, add captions, and tag services directly from the app in Sprint 3.'
    );
  });
}

/* ── Load more ───────────────────────────────────────────────── */
function wireLoadMore() {
  const btn = document.getElementById('feedLoadMoreBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Loading...';
      btn.disabled = true;
      await delay(600);
      btn.textContent = 'Load More';
      btn.disabled = false;
      renderFeed(feedPage + 1);
      /*
       * Future Sprint 3: Fetch next page from Supabase:
       *   const more = await fetchSocialFeed({ page: feedPage })
       *   feedState.push(...more)
       *   renderFeed(feedPage + 1)
       */
    });
  }
}

/* ── Utility ─────────────────────────────────────────────────── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getMediaIconSVG(icon, bg) {
  const icons = {
    star:     `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    zap:      `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    sparkles: `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
    scissors: `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="4" r="2"/><path d="m5.81 10.186 1.768-2.832L10 12l2.828-4.243"/><circle cx="18" cy="4" r="2"/></svg>`,
    wrench:   `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    hammer:   `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/></svg>`,
  };
  return icons[icon] || icons.star;
}

function getServiceIconSVG(category) {
  const icons = {
    beauty:      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    electrician: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    cleaning:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>`,
    barber:      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="4" r="2"/><path d="m5.81 10.186 1.768-2.832L10 12"/><circle cx="18" cy="4" r="2"/></svg>`,
    mechanic:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    carpentry:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/></svg>`,
  };
  return icons[category] || `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`;
}

/* ── Expose globals ──────────────────────────────────────────── */
window.initFeedPage         = initFeedPage;
window.toggleLike           = toggleLike;
window.toggleSave           = toggleSave;
window.toggleComments       = toggleComments;
window.submitComment        = submitComment;
window.handleCommentKey     = handleCommentKey;
window.sharePost            = sharePost;
window.openBookingFromFeed  = openBookingFromFeed;
window.expandCaption        = expandCaption;
