# Street Taskers

Nigeria's local services marketplace connecting customers with skilled service providers.

## What Street Taskers does

Customers post tasks they need done. Taskers list their services. The platform matches them, handles bookings, and manages the relationship from first contact to job completion.

## Current status

Sprint 2 is complete. The site is live at streettasker.com.

| Sprint | Status | What was built |
|--------|--------|----------------|
| Sprint 1 | Complete | Design system, all page layouts, navigation |
| Sprint 2 | Complete | Live Supabase backend, auth, task posting, bookings, dashboards |
| Sprint 3 | Next | Map discovery, real-time notifications, Mapbox integration |
| Sprint 4 | Planned | Paystack payments, AI task description helper |

## Pages

| Page | File | Who uses it |
|------|------|-------------|
| Homepage | `index.html` | Everyone |
| Find Services | `find-taskers.html` | Customers looking for providers |
| Explore Tasks | `explore-tasks.html` | Taskers looking for work |
| Post a Task | `post-task.html` | Customers |
| Post a Service | `post-service.html` | Taskers |
| Customer Dashboard | `dashboard-customer.html` | Logged-in customers |
| Tasker Dashboard | `dashboard-tasker.html` | Logged-in taskers |
| Tasker Profile | `tasker-profile.html` | Public profile page |
| Login | `login.html` | Everyone |
| Sign Up | `signup.html` | New users |
| Verify Identity | `verify.html` | Taskers going through verification |
| Subscription Plans | `subscription.html` | Taskers considering upgrade |
| Terms of Service | `terms.html` | Legal |
| Privacy Policy | `privacy.html` | Legal |
| 404 | `404.html` | Error fallback |

**Removed pages:** `social-feed.html` was removed in Sprint 2. It is no longer part of the platform.

## File structure

```
/
├── index.html
├── find-taskers.html
├── explore-tasks.html
├── post-task.html
├── post-service.html
├── dashboard-customer.html
├── dashboard-tasker.html
├── tasker-profile.html
├── login.html
├── signup.html
├── verify.html
├── subscription.html
├── terms.html
├── privacy.html
├── 404.html
├── css/
│   ├── styles.css          Main design system and all shared styles
│   ├── tasks.css           Task form and tasker card styles
│   ├── subscription.css    Subscription tier styles
│   └── feed.css            Kept for now, may be removed in Sprint 3
├── js/
│   ├── supabaseClient.js   Supabase client initialisation
│   ├── auth.js             Login, signup, logout, session management
│   ├── db.js               All Supabase database calls
│   ├── app.js              Page bootstrap, navbar, scroll animations
│   ├── taskers.js          Find Services page — listings, filtering, booking modal
│   ├── tasks.js            Post a Task form logic
│   ├── location.js         Location autocomplete using Nominatim
│   ├── sanitize.js         XSS protection utilities
│   ├── ui.js               Toast notifications, placeholder data
│   ├── subscription.js     Subscription tier UI
│   ├── verify.js           Identity verification flow
│   └── future-features.js  Stubs for Sprint 3 and 4 features
├── components/
│   ├── navbar.html         Shared navigation bar
│   └── footer.html         Shared footer
└── images/
    ├── logo-nav.png
    ├── logo.png
    └── favicon.png
```

## Running locally

Components load via `fetch()` so a local server is required:

```bash
npx serve .
# or
python3 -m http.server 3000
```

Then open `http://localhost:3000`

## Database

The project uses Supabase. Key public tables:

- `users` — user profiles (name, role, bio, location)
- `tasks` — tasks posted by customers
- `services` — services listed by taskers
- `taskers` — tasker profiles with service details
- `bookings` — bookings between customers and taskers
- `task_applications` — tasker applications to customer tasks
- `notifications` — in-app notifications
- `reviews` — post-job reviews
- `subscriptions` — tasker subscription records
- `verifications` — identity verification submissions

## Two user roles

**Customer** — posts tasks, browses services, makes bookings, accepts or rejects applications.

**Tasker** — lists services, applies to tasks, accepts bookings, manages their profile and verification.

## Authentication

Email and password via Supabase Auth. Users must confirm their email before logging in. Google OAuth is configured but requires custom domain setup in the Supabase dashboard to work on the live domain.

## Known Sprint 3 integration points

All `showSprintAlert()` calls in the codebase mark where live integrations will go:
- Map discovery — Mapbox GL JS
- Real-time notifications — Supabase Realtime
- Payment processing — Paystack

## Email setup (action required)

Confirmation emails currently come from Supabase's default sender. To send from a Street Taskers address, configure a custom SMTP provider in the Supabase dashboard under Authentication > Email Templates. Update the sender name and address there — no code changes are needed.
