# wpgcardhub-site

Marketing site + admin batch-import tool for [WPG CardHub](https://github.com/jquiogue-commits/CardShowFinder), hosted on GitHub Pages.

- **`/`** — public landing page: features, screenshots, FAQ, and a "notify me at launch" waitlist form.
- **`/admin/`** — admin-only batch flyer importer. Sign in with the same admin account used in the app, drop in several flyer photos, review the AI-parsed details, and import them all as shows in one pass.

No backend of its own — both pages talk directly to the same Supabase project the iOS app uses (`js/config.js`), and Row Level Security (not page obscurity) is what actually restricts admin writes. The anon key here is the same public key shipped in the app; see `CardShowFinder/Data/SupabaseConfig.swift`.

New shows imported from `/admin/` get their region's default map coordinate — open the app's **Account → Admin tools → Fix map locations** afterward to geocode them precisely, instead of this site needing its own geocoding integration.

## Local preview

```
python3 -m http.server 8000
```
