# StreetTasker onboarding / guided tours: stages

Spec: ST onboarding spec (uploaded as a .md with the ST-Real-Main zip). One stage per session. Changed files only.

| # | Stage | Status |
|---|-------|--------|
| 1 | Engine, persistence (SQL), tests, demo page | delivered |
| 2 | Safety Reminder above the chat input (customers and taskers, every conversation, mobile) | delivered |
| 3 | First-login tours, customer and tasker, run on the logged-in homepage (home-feed.html) | delivered |
| 4 | Help / Learn centre, nav entry, replay; compact dark tour card; card clears the mobile tab bar | delivered |
| 5 | Customer tutorials: post a task, book a service, offers, additional expenses | delivered |
| 6 | Tasker tutorials: find and apply, respond to bookings, manage work | delivered |
| 7 | Chat tutorials for both roles + the Actions guide (#requestBtn / #jrSheet) | next |
| 8 | QA pass against the spec's test list, design-system check, handoff | |

## Decisions
- No staging: SQL and changes go straight to the live project. Every stage's SQL must be safe to run once on live (idempotent, no destructive statements) and say plainly what it touches.
- The first-login tour runs when the user goes to the homepage (logged-in homepage = home-feed.html; index.html redirects logged-in users there). The existing post-login redirects (post-task.html / post-service.html) are NOT changed.
- Progress is per user and role: table public.user_tour_progress (sql/onboarding-progress.sql), RLS own rows, localStorage fallback (key st_tours:<userId>) when the table is missing.
- Skipped tours do not restart by themselves and are not marked completed; the person restarts them from Help / Learn (Stage 4). Completed tours do not auto-replay.
- Chat tutorials cover messages.html only, not coordinator-chat.html.
- Features the spec names that do not exist get skipped and listed in that stage's summary.

## Engine quick reference (js/onboarding.js)
Register a tour with ST.onboarding.register({...}), start with .start(id) (replay) or .autoStart(id) / .autoStartFirst([ids]) (first visit only).
Targets use data-tour attributes; a step's target can be a list of selectors (first visible wins), so desktop and mobile elements share one step.
Step options are documented at the top of js/onboarding.js.
Safety reminder: #jrSafetyReminder in messages.html (class .jr-reminder in css/messages.css), revealed where #inputBar is revealed in openThread. Has data-tour="chat-safety-reminder" for the chat tour in Stage 7.
Tests: node --test tests/onboarding.test.js
Home tours (Stage 3): js/onboarding-tours-home.js registers 'customer-home' and 'tasker-home'. home-feed.html loads css/onboarding.css, js/onboarding.js and the tours file, and calls ST.homeTours.start() at the end of initFeed (after the role is known). Targets are existing ids in home-feed.html / components/navbar.html / components/bottom-nav.html plus data-tour hooks on the hero buttons and category chips. Steps whose target is not on screen are skipped (phone vs desktop, profile already complete). Tests: node --test tests/onboarding-tours.test.js

## Stage 4 (Help / Learn)
- Page: learn.html (public to read; replay needs a login). Content: js/learn-content.js (plain data, tests/learn.test.js). Script: js/learn.js. Styles: css/learn.css.
- Entry points: Settings dropdown "Help / Learn" (#navMenuHelp), mobile drawer "Help / Learn" (#navDrawerHelp), footer "Help center" (was "Coming soon"), sitemap.xml.
- Replay: ST.onboarding.replay(id). A tour on another page is opened as <page>?tour=<id>; every page that hosts tours must call ST.onboarding.consumeReplay() once the role is known (home-feed already does, inside ST.homeTours.start()). Stages 5-7: do the same on each host page.
- Learn page tour list is read from the engine registry, so each later stage must add its tours file to learn.html (comment marks the spot). Guide topics already name the ids reserved for later stages (a "Take the tour" button shows only when that id is registered and fits the role):
  customer-post-task, customer-book-service, tasker-apply-task, customer-chat, tasker-chat, payments-guide, manage-work.
  Stage 5-7 must register tours with these ids or change the `tours` list in js/learn-content.js.
- Skip: every tour card has Skip (and a close X) on every step but the last, plus Esc. Skipped tours are not completed and never restart by themselves; Help / Learn restarts them.
- Tour card is now compact and dark (see DESIGN-SYSTEM.md). Counter reads 1/6. Phones: card sits above .st-bottom-nav (engine measures it).
- Chat tutorial note for Stage 7: the spec's "More Actions" is the Request button (#requestBtn / #jrSheet) in this codebase.
- Tests: node --test tests/onboarding.test.js tests/onboarding-tours.test.js tests/learn.test.js tests/onboarding-replay.test.js

## Stage 5 (customer tutorials)
- File: js/onboarding-tours-customer.js registers four tours (all role customer, auto: false, so they never start by themselves; a customer starts them from Help / Learn, which opens the page with ?tour=<id>):
  | Tour id | Page | Topic on learn.html |
  |---|---|---|
  | customer-post-task | post-task.html | Posting a task |
  | customer-offers | customer-applications.html | Posting a task (offers) |
  | customer-book-service | find-services.html | Booking a service |
  | customer-expenses | messages.html | Payments and additional costs |
- Host pages (post-task, find-services, customer-applications, messages) load css/onboarding.css, js/onboarding.js and the tours file. The tours file starts the tour itself when the address has ?tour=<id> (no page code changed). learn.html loads the tours file so it can list and replay them.
- Steps for screens that may be empty (offers list, services grid) or pop-ups that are closed (the booking form, the extra-cost card) use fallback: 'center', so they show as a plain card instead of being skipped.
- Nothing is submitted or changed by a tour. No fee wording anywhere in customer copy (tests check this).
- The book-service tour stays on find-services.html and explains the booking pop-up in centred cards (the pop-up lives on tasker-profile.html and needs a real tasker id, so it cannot be a replay target).
- Tests: node --test tests/onboarding-tours-customer.test.js (also checks every selector exists in the page or the script that draws it).
- Stage 6 must do the same on each host page: load the tours file after js/onboarding.js, and add the tours file to learn.html. Reserved ids still open: tasker-apply-task, manage-work, customer-chat, tasker-chat, payments-guide.

## Stage 6 (tasker tutorials)
- File: js/onboarding-tours-tasker.js registers three tours (role tasker, auto: false; started from Help / Learn through ?tour=<id>, same as Stage 5):
  | Tour id | Page | Topic on learn.html |
  |---|---|---|
  | tasker-apply-task | find-tasks.html | Finding and accepting tasks |
  | tasker-bookings | bookings.html | Managing bookings and jobs |
  | manage-work | bookings.html | Managing bookings and jobs |
- Host pages (find-tasks, bookings) load css/onboarding.css, js/onboarding.js and the tours file; learn.html loads it too. No page code changed.
- The apply tour stays on find-tasks.html and explains make-offer.html in centred cards (that page needs a real task id, so it cannot be a replay target). The tasker sees the fee line there, so the copy may mention the platform fee; customer copy never does.
- Tests: node --test tests/onboarding-tours-tasker.test.js (also checks every selector exists).
- Stage 7 (chat tours) hosts on messages.html: add its tours file after js/onboarding.js there and on learn.html. Reserved ids still open: customer-chat, tasker-chat, payments-guide.
