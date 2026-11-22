# Pantry Count

A phone-friendly pantry inventory. Point the camera at barcodes to add or use up items, with expiry dates, locations and a shared household list.

- **Live scanning** uses the browser's built-in barcode reader where available (Chrome on Android) and falls back to ZXing (iPhone Safari).
- **Product names** come from [Open Food Facts](https://world.openfoodfacts.org) (with Open Products Facts and Open Beauty Facts as fallbacks). Anything not found is named once and remembered for the household.
- **Shared list** lives in Supabase. The page only calls `pantry_*` database functions, and each one checks the household key.

## Household link

The household key is **not** in this repo. It travels in the link after `#k=`. Anyone with the link can view and edit the list, so share it only with your household. Use **Copy household link** in the app to send it.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `config.js`: Supabase URL and publishable key (safe to be public)
- `manifest.webmanifest`, `icon.svg`: lets you add it to your home screen
