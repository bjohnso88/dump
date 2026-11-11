# Dump

A calm, zero-friction to-do app. Type, hit enter, done.

- Type anything → it's a to-do. Start with `idea:` → it goes to Ideas.
- Tap a to-do to mark it done. Swipe left or hold to delete.
- **Wrap up** shows today's wins, then lets you keep or drop what's left.
- **This week** shows what you finished in the last 7 days.

Data lives in `localStorage` on your phone only. No accounts, no sync.

## Files
- `index.html` – the page
- `style.css` – the look (auto dark mode)
- `app.js` – all the logic (~250 lines)
- `manifest.json`, `*.png`, `sw.js` – home-screen install + works offline
- `make_icons.py` – regenerates the icons (optional)

## Try it locally
```
python3 -m http.server 8000
```
Then open http://localhost:8000.
