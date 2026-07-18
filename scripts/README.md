# scripts/

Question-authoring tooling. None of these run at request time in the live app —
they're used only when (re-)importing content into Supabase.

- `build_questions.py` — reads raw `.xlsx` files from `source/` and generates the
  per-subject JSON catalogs that used to live in `data/`.
- `export_questions.py` — exports questions back out of Supabase.
- `import_to_supabase.py` — pushes generated JSON into Supabase (`questions`,
  `chapters`, etc.).
- `run_migrations.py` / `sync_worker.py` / `local_setup.py` — schema migrations,
  the email/Sheets sync worker, and local dev bootstrap.

## Content archive

`data/` (~35MB generated JSON) and `source/` (~4.7MB raw `.xlsx` files) were
removed from this repo's initial commit to keep the working tree small — they
are not read by anything in `js/` or `index.html` at runtime. The original
content was archived as a zip before removal (2026-07-18) and handed directly
to the repo owner. If you need to re-run `build_questions.py` or
`import_to_supabase.py` from scratch, restore `data/` and/or `source/` from
that archive into the repo root first.
