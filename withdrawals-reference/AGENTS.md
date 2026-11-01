# Instructions for AI tools working on StreetTasker

This project follows a design system. Read it before you change any `.html`, `.css` or inline style.

1. **Read `DESIGN-SYSTEM.md` first**, then `css/tokens.css`, then `css/styles.css`.
2. Plain HTML, CSS and JS. No build step. Shared styles are in `css/`, shared markup in `components/`.
3. **Use tokens and existing classes.** Never write a raw hex colour, `rgb()`, font size, spacing or radius value that is not a token. If the value you need is missing, stop and ask for it to be added to `DESIGN-SYSTEM.md` and `css/tokens.css`.
4. **Reuse components** (`.btn`, `.card`, `.badge`, `.form-*`, `.container`) instead of restyling them inside a page. Pages only do layout.
5. **No inline `style=""` for look and feel. No `!important`** without a comment saying why.
6. **Stay in scope.** If asked to change one area (for example the logged-out nav), do not change logged-in views, mobile, or other pages. Scope with media queries and `body.st-logged-in` / `body:not(.st-logged-in)`.
7. **Run the check before you finish:** `node tools/check-design-system.js`. It must pass. Do not edit `tools/design-baseline.json` to make it pass. Only run `--update` after you have removed violations.
8. When done, list every file you edited and confirm nothing outside the requested scope changed.

Existing hardcoded values in older pages are known debt (see the baseline). Do not copy them into new code.
