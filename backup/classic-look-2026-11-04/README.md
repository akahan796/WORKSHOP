# Backup: looks before Refined became the only look (2026-11-04)

Copies of the files as of commit 8368dcb, when the app still had the Classic
(Arial) look and the Soft modern, Crisp product and Workshop studio themes.
The same state is tagged in git as `classic-look`.

- `styles.css` — the base styles (the Classic look on its own)
- `themes.css` — Refined plus the three exploration themes, as `html[data-theme=…]` overrides
- `index.html`, `ui.js` — the theme picker and the before-first-paint theme script

To bring the old setup back: `git checkout classic-look -- styles.css themes.css index.html src/views/ui.js`
