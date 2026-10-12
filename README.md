# BSD Strut Tests

Phone app for recording gas strut tests on rooflights.

- `index.html`: factory app (installable, works with no signal and sends when signal returns)
- `admin.html`: results, CSV export, tester names, stock and settings
- `logic.js`: next-strut suggestion logic
- `supabase/schema.sql`: database setup (tables are closed; the browser can only call PIN-checked functions)

Hosted on GitHub Pages; data in the Supabase project "BSD Strut Tests".
