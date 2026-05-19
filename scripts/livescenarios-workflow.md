# Livescenarios → production R2 + D1

Mirror [`livescenarios/`](../livescenarios/) (gitignored) into the **same** R2 bucket the Worker uses for scenario binaries, reconcile D1, then parse unparsed rows.

## One-time setup

1. **Migration v5** (tombstones table): `npm run db:migrate:scenarios:v5`
2. **Deploy** the Worker (delete handler + sync tombstone purge).
3. rclone remote → bucket **`scenarios`** (see [`wrangler.jsonc`](../wrangler.jsonc)).
4. `SYNC_SECRET` for `POST /api/scenarios/sync` — production: `wrangler secret put SYNC_SECRET` (same value in your shell as `set SYNC_SECRET=...`).
5. Default **`SITE_URL`** is production (`https://aoe2museum.com`, see `PUBLIC_BASE_URL` in `wrangler.jsonc`). **No `npm run dev` required.** Use `SITE_URL=http://localhost:8787` only when testing sync against local wrangler dev.

## Pipeline ([`sync-livescenarios.ps1`](sync-livescenarios.ps1) / [`.bat`](sync-livescenarios.bat))

1. **`reconcile-livescenarios.py`** — **2 D1 reads** (catalog + tombstones), then:
   - Delete **local** files for tombstoned keys (website deletes).
   - **Targeted** `rclone copy` only for catalog keys missing locally (not a full-bucket pull).
   - MD5 dedupe (oldest file wins per hash).
   - `rclone sync` local → R2 (local authoritative).
2. **`POST /api/scenarios/sync`** — D1 ↔ R2; purges tombstoned objects still on R2.
3. **`backfill-scenario-metadata.py --only-unparsed --local-root ./livescenarios`**

Preview: `-ReconcileDryRun` on the PS1 script, or `python scripts/reconcile-livescenarios.py --dry-run ...`.

### How deletes work

| Delete on | What happens on next batch |
|-----------|----------------------------|
| **Website** | Row + R2 removed; **tombstone** recorded. Reconcile removes local copy; sync cannot resurrect. |
| **Local only** | `rclone sync` drops R2 key; sync API removes D1 row. No tombstone (not needed). |

### Mental model

After a successful run: **R2 and D1 match your local folder**, plus any **D1 catalog** files you were missing (downloaded), minus **tombstones** and deduped MD5 copies.

- Empty `livescenarios/` still **wipes R2** at sync — never run on an empty folder by accident.
- Local-only files not in D1 are **uploaded** and indexed on step 2.
- Unset `WRANGLER_D1_LOCAL` for production reconcile/backfill.

## Manual commands

```bash
npm run db:migrate:scenarios:v5   # once
python scripts/reconcile-livescenarios.py --root ./livescenarios --rclone-remote livescenarios:scenarios
curl -X POST -H "Authorization: Bearer $SYNC_SECRET" https://aoe2museum.com/api/scenarios/sync
python scripts/backfill-scenario-metadata.py --only-unparsed --local-root ./livescenarios
```

## Cloudflare cost per batch run

| Step | API usage |
|------|-----------|
| Reconcile | 2× `wrangler d1 execute` (read-only) |
| rclone | R2 egress/ops via your rclone account (no Worker) |
| POST sync | 1 Worker request + R2 list + D1 batch (existing) |
| Backfill | Per unparsed row (unchanged) |

No full R2 listing from the laptop script.
