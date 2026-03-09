# Street Taskers — Frontend

Local services marketplace connecting customers with skilled taskers across Lagos.

## Sprint Status

| Sprint | Status | Notes |
|--------|--------|-------|
| Sprint 1 | ✅ Complete | Foundation: design system, pages, layout |
| Sprint 2 | ✅ Complete | Interactive UI: forms, listings, social feed, subscription |
| Sprint 3 | 🔜 Next | Supabase backend, map discovery, booking engine |
| Sprint 4 | 📋 Planned | Paystack subscriptions, AI assistant, notifications |

## Pages

| Page | File | Sprint |
|------|------|--------|
| Homepage | `index.html` | 1 |
| Find Taskers | `find-taskers.html` | 2 (enhanced) |
| Post a Task | `post-task.html` | 2 (enhanced) |
| Social Feed | `social-feed.html` | 2 (new) |
| Subscription / Pricing | `subscription.html` | 2 (new) |
| Login | `login.html` | 1 |
| Sign Up | `signup.html` | 1 |

## File Structure

```
street-tasker/
├── index.html
├── find-taskers.html
├── post-task.html
├── social-feed.html
├── subscription.html
├── login.html
├── signup.html
├── css/
│   ├── styles.css          # Design system (variables, reset, base components)
│   ├── tasks.css           # Task form + tasker card v2 styles
│   ├── subscription.css    # Subscription tiers + plan cards
│   └── feed.css            # Social feed + post cards
├── js/
│   ├── app.js              # Bootstrap, component loader, scroll animations
│   ├── ui.js               # Toast, placeholder data, card builder
│   ├── tasks.js            # Task posting form — Sprint 2
│   ├── taskers.js          # Tasker listings, filtering, booking modal — Sprint 2
│   ├── feed.js             # Social feed likes/comments — Sprint 2
│   ├── subscription.js     # Subscription tier UI — Sprint 2
│   └── future-features.js  # Supabase integration stubs — Sprint 3+
├── components/
│   ├── navbar.html         # Shared navigation (loaded via fetch)
│   ├── footer.html         # Shared footer (loaded via fetch)
│   ├── task-card.html      # Tasker card reference markup
│   └── feed-post.html      # Feed post reference markup
└── images/
    ├── logo-nav.png        # Transparent logo for navbar
    ├── logo-full.jpeg      # Full street-sign logo
    ├── favicon.png         # Browser tab icon
    └── apple-touch-icon.png
```

## Local Development

Components are loaded via `fetch()` — must run a local server:

```bash
# Option 1
npx serve .

# Option 2
python3 -m http.server 3000

# Then open: http://localhost:3000
```

## Sprint 2 Features

- **Task Posting Form**: validated form with draft saving, character counter, budget chips, category quick-select, progress indicator
- **Tasker Listings**: live filtering (category, rating, price, availability), search with debounce, sort, pagination, booking modal
- **Social Feed**: like/comment interactions (in-memory), share, save, suggested taskers, trending services sidebar
- **Subscription Plans**: Free / Starter (₦9,999/mo) / Pro (₦29,999/mo), annual billing toggle, free slot meter, comparison table, FAQ

## Sprint 3 Integration Points

All `showSprintAlert()` calls mark where Supabase integration goes:
- Task posting → `supabase.from('tasks').insert()`
- Auth → `supabase.auth.signUp()` / `supabase.auth.signIn()`
- Tasker data → `supabase.from('tasker_profiles').select()`
- Booking → `supabase.from('bookings').insert()`
- Map → Mapbox GL JS + PostGIS spatial queries

## Sprint 4 Integration Points

- Payments → Paystack subscription API
- AI → Anthropic Claude API for task description improvement
- Push notifications → Supabase Edge Functions + FCM
