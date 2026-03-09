# ⚡ Street Tasker

**Local Services Marketplace** — Connect skilled workers with customers in your city.

> Sprint 1: Frontend Foundation — Deployed on GitHub Pages

---

## 🚀 Live Demo

Open `index.html` in your browser or deploy the folder to GitHub Pages.

---

## 📁 Project Structure

```
street-tasker/
├─ index.html              # Home page
├─ find-taskers.html       # Browse + filter taskers
├─ post-task.html          # Task submission form
├─ login.html              # Login page
├─ signup.html             # Signup page (Customer / Tasker)
├─ css/
│   └─ styles.css          # Full design system (glassmorphism + neon)
├─ js/
│   ├─ app.js              # Core bootstrap, component loader, nav
│   ├─ ui.js               # UI interactions, placeholder data, toast
│   └─ future-features.js  # Documented stubs for Sprint 2–4 features
├─ components/
│   ├─ navbar.html         # Shared navbar component
│   └─ footer.html         # Shared footer component
├─ images/                 # (add assets here)
└─ README.md
```

---

## 🎨 Design System

| Token | Value |
|---|---|
| Primary | Deep Purple `#2D1B69` / `#4A2C9A` |
| Accent | Neon Blue `#00D4FF` |
| Highlight | Soft Gold `#F0C040` |
| Background | Light Gray `#F5F4FA` |
| Font (Display) | Syne (800, 700, 600) |
| Font (Body) | DM Sans (300, 400, 500) |
| Style | Glassmorphism cards + neon glow accents |

---

## 🗺️ Sprint Roadmap

| Sprint | Status | Focus |
|---|---|---|
| **Sprint 1** | ✅ Done | Frontend foundation, all pages, design system |
| **Sprint 2** | 🔜 Next | Supabase auth, task posting, tasker profiles, real data |
| **Sprint 3** | 📋 Planned | Booking engine, map discovery (Mapbox), social feed |
| **Sprint 4** | 🔮 Future | AI task assistant, subscription/billing (Paystack), notifications |

---

## 🔌 Future Tech Stack

- **Database / Auth**: Supabase (PostgreSQL + Row Level Security)
- **Storage**: Supabase Storage (profile photos, task images)
- **Maps**: Mapbox GL JS + PostGIS for geo-queries
- **Payments**: Paystack (Nigeria) / Stripe
- **AI**: Claude API for task description improvement
- **Realtime**: Supabase Realtime for live booking updates

---

## 🛠️ Local Development

No build tools needed for Sprint 1 — it's pure HTML/CSS/JS.

```bash
# Option 1: Open directly
open index.html

# Option 2: Serve locally (avoids fetch() CORS issues for components)
npx serve .
# or
python3 -m http.server 3000
```

> ⚠️ Due to `fetch()` being used for navbar/footer components, open via a local server (not `file://`) for the best experience.

---

## 📋 Pages Overview

| Page | File | Status |
|---|---|---|
| Home | `index.html` | ✅ |
| Find Taskers | `find-taskers.html` | ✅ (placeholder data) |
| Post a Task | `post-task.html` | ✅ (form UI only) |
| Login | `login.html` | ✅ (UI only) |
| Signup | `signup.html` | ✅ (UI only) |
| Dashboard | `dashboard.html` | 🔜 Sprint 2 |
| Tasker Profile | `tasker/[id].html` | 🔜 Sprint 2 |
| Social Feed | `social.html` | 🔜 Sprint 3 |
| Map Discovery | `map.html` | 🔜 Sprint 3 |

---

## 💬 Comments Convention

Throughout the code you'll find these comment types:

```
// Future Sprint 2: Supabase auth integration
// Future Feature: Map discovery system
// Future Sprint 3: Booking engine
// Future Sprint 4: AI task assistant
```

These mark exact locations where backend logic will be wired in future sprints.

---

*Built with ❤️ · Street Tasker Sprint 1*
