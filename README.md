# AOE2 Museum

A Cloudflare Worker that hosts a small collection of Age of Empires II tools.
Each "app" lives under its own path and runs client-side where possible.

| Path                            | Description                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                             | Museum landing page listing available apps.                                                 |
| `/mcminimap/`                   | Isometric minimap renderer. Runs [AOE2-McMinimap](https://github.com/UnluckyForSome/AOE2-McMinimap) in-browser via Pyodide &mdash; nothing is uploaded for rendering. |
| `/api/gallery`                  | `GET` returns the latest-20 index; `POST image/png` (with `X-Source-Name`) appends to the gallery. |
| `/api/gallery/:id`              | Streams a stored gallery PNG from R2.                                                       |
| `/scenarios/`                   | Community archive of AoE2 custom scenarios (list, filter, download, contribute).            |
| `GET /api/scenarios`            | JSON list of every scenario in D1, newest first.                                            |
| `POST /api/scenarios/upload`    | Multipart upload (Turnstile-gated). Accepts `.scn`/`.scx`/`.aoe2scenario`/`.zip`, dedupes by MD5. |
| `GET /api/scenarios/download/:id` | Streams the scenario file from R2 and increments the download counter.                    |
| `POST /api/scenarios/sync`      | Bearer-auth (`SYNC_SECRET`) or cron-triggered R2&harr;D1 reconcile.                          |
| `/health`                       | JSON uptime check.                                                                          |

Static assets are served by the Worker's `assets` binding.
`/mcminimap/` has an optional, **public** gallery of the 20 most recent
minimaps (R2 + KV). `/scenarios/` is a shared community archive backed by
D1 + R2. See [Bindings](#bindings).

### Gallery caveat

The gallery is **global and public**: every visitor sees (and contributes to)
the same 20-slot ring buffer. The UI fire-and-forgets a PNG upload after each
successful render. Do not render private replays into the gallery unless you
are comfortable with them being visible to other visitors.

## Bindings

`wrangler.jsonc` declares these bindings:

| Binding         | Type           | Purpose                                   |
| --------------- | -------------- | ----------------------------------------- |
| `ASSETS`        | assets         | Serves `public/` (HTML, JS, vendor tar, &hellip;). |
| `MINIMAPS`      | R2 bucket      | McMinimap gallery PNGs (`aoe2museum-minimaps`, key `minimap/<id>.png`). |
| `MINIMAP_INDEX` | KV namespace   | McMinimap gallery &mdash; single `index` key, JSON array newest-first, capped at 20. |
| `BUCKET`        | R2 bucket      | Scenarios archive object storage (`scenarios`; key = stored filename). |
| `DB`            | D1 database    | Scenarios metadata (`scenarios`, uuid `94e77071-f016-4073-9c1a-c9012424b48d`). |

A weekly cron (`0 3 * * 1`) re-runs the R2&harr;D1 reconcile for the
Scenarios archive. Both resources are inherited from the previous standalone
`scenarios` Worker &mdash; two Workers can bind to the same D1/R2 during a
coexistence window without data migration.

Secrets (set with `wrangler secret put <NAME>` against this Worker):

| Name                | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `TURNSTILE_SECRET`  | Server-side key for the Cloudflare Turnstile widget on the upload form. |
| `SYNC_SECRET`       | Bearer token accepted by `POST /api/scenarios/sync` (the footer button). |

One-time setup (already done for the production account; repeat per account):

```bash
# McMinimap
wrangler r2 bucket create aoe2museum-minimaps
wrangler kv namespace create MINIMAP_INDEX
# paste the returned id into wrangler.jsonc under kv_namespaces[0].id

# Scenarios (only needed on a fresh account; production reuses existing)
wrangler r2 bucket create scenarios
wrangler d1 create scenarios
# paste the returned uuid into wrangler.jsonc under d1_databases[0].database_id
npm run db:migrate:scenarios   # WARNING: wipes the scenarios table

# Scenarios secrets
wrangler secret put TURNSTILE_SECRET
wrangler secret put SYNC_SECRET
```

## Layout

```
src/
  index.ts                          # Worker router + gallery handlers + scheduled()
  scenarios/
    env.ts                          # ScenariosEnv interface (DB, BUCKET, secrets)
    handlers/                       # list, upload, download, sync (ex-Pages-Scenarios)
    services/                       # turnstile, validation, verify-scenario
    db/schema.sql                   # reference only; production D1 is already populated
public/                             # served by the Cloudflare assets binding
  index.html                        # museum landing
  mcminimap/
    index.html                      # app UI (Generate + Gallery tabs, top progress bar)
    app.js                          # UI controller + worker RPC + gallery client
    worker.js                       # Pyodide host (DedicatedWorker)
    py/bootstrap.py                 # exposes render(bytes, ext, settings)
    assets/rainbow.png              # output placeholder shown before / on error
    vendor/aoe2mcminimap.tar        # generated from the submodule (gitignored)
    vendor/manifest.json            # { sourceSha, builtAt, files } (gitignored)
  scenarios/                        # migrated from the old `scenarios` Worker
    index.html                      # archive (table + filter + sort + pagination)
    contribute.html                 # upload form (Turnstile-gated)
    contact.html
    css/style.css                   # medieval/AoE2-themed styling
    js/scenarios.js                 # archive client
    js/upload.js                    # upload client (XHR progress + Turnstile)
    img/                            # aoc.png, aok.png, de.png, hd.png
vendor/
  aoe2mcminimap/                    # git submodule -> UnluckyForSome/AOE2-McMinimap
  pylibs/                           # downloaded pure-Python deps with no PyPI wheel (gitignored)
    construct/                      #   construct 2.8.16 + aocref (sdist-only on PyPI)
scripts/
  sync-mcminimap.mjs                # ensures submodule is initialised
  fetch-pylibs.mjs                  # downloads pinned sdists (e.g. construct==2.8.16) from PyPI
  build-mcminimap-bundle.mjs        # cache-gated tar of submodule slice + pylibs/
```

## Local development

First-time setup clones the submodule:

```bash
git clone --recurse-submodules <this-repo>
# or, if already cloned:
git submodule sync
git submodule update --init --recursive
npm install
```

If you pulled after the submodule path moved from `mcminimap/vendor/…` to
`vendor/…`, run `git submodule sync` once so Git updates local paths.

Run the dev server (the `predev` script regenerates the vendor tar if the
submodule has moved):

```bash
npm run dev
```

Then open http://localhost:8787.

### Bumping the McMinimap version

```bash
git submodule update --remote vendor/aoe2mcminimap
npm run build:mcminimap   # rebuilds the tar if the SHA changed, no-op otherwise
git add vendor/aoe2mcminimap
git commit -m "bump AOE2-McMinimap"
```

## Deploying

### From your machine

```bash
npm run deploy
```

The `predeploy` hook runs `npm run build:mcminimap`, which:

1. initialises the submodule if needed (`sync:mcminimap`),
2. downloads any pinned pure-Python deps that micropip cannot install as wheels
   (`fetch:pylibs` &mdash; `construct==2.8.16` and `aocref`, both sdist-only),
3. compares the submodule HEAD SHA and vendored pylib versions against
   `public/mcminimap/vendor/manifest.json`, and
4. rebuilds the tarball only when something changed (fast no-op otherwise).

### Via Cloudflare Workers Builds

**Workers Builds does not auto-initialise git submodules** (unlike Pages). You
have two reasonable options:

**Option A: build command initialises the submodule.** In your Worker's
build settings:

- **Build command:** `npm ci && git submodule update --init --recursive && npm run build:mcminimap`
- **Deploy command:** `npx wrangler deploy`

This works because `.gitmodules` ships with the repo and the submodule
(`UnluckyForSome/AOE2-McMinimap`) is public &mdash; no auth required.

**Option B: GitHub Actions.** If Workers Builds refuses to run `git
submodule update`, move the build there instead:

```yaml
# .github/workflows/deploy.yml
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Either way, `scripts/fetch-pylibs.mjs` pulls those sdists from PyPI at build
time, so you do not need to commit them.

## How `/mcminimap` works (high level)

```
Browser --> index.html --> app.js --> new Worker("/mcminimap/worker.js")
                                         |
                                         |-- loads Pyodide runtime from jsDelivr
                                         |-- installs pure-Python wheels via micropip
                                         |     (AoE2ScenarioParser, mgz-fast, tabulate)
                                         |-- fetches /mcminimap/vendor/aoe2mcminimap.tar
                                         |-- pyodide.unpackArchive -> /home/pyodide/aoe2mcminimap
                                         |     (renderer + pylibs: construct, aocref)
                                         |-- runs /mcminimap/py/bootstrap.py
                                         |     (adds pylibs/ + vendor dir to sys.path)
                                         |
                               postMessage(file bytes + settings)
                                         |
                                         v
                            bootstrap.render(...) -> PNG bytes -> main thread
```

No scenarios, replays, or source recordings ever leave the browser. The
Gallery tab optionally `POST`s the rendered PNG (plus the source filename) to
`/api/gallery`, which writes it to R2 and rewrites the KV index &mdash; the
source file itself is never uploaded.

## How `/scenarios` works (high level)

Unlike `/mcminimap`, the Scenarios archive is a **shared, server-backed**
app &mdash; uploaded scenario files live permanently in the `scenarios` R2
bucket, with metadata in the `scenarios` D1 database.

```
Browser --> /scenarios/ --> GET /api/scenarios (list from D1)
         \                --> click row --> GET /api/scenarios/download/:id (stream from R2)
          --> /scenarios/contribute.html --> Turnstile -> POST /api/scenarios/upload
                                              |
                                              |-- validate ext + size (<=5 MB, <=100 MB zip)
                                              |-- extract zips (fflate) in-Worker
                                              |-- MD5 dedupe vs D1
                                              |-- resolve filename collisions (-V1, -V2, ...)
                                              |-- verifyScenario() header check
                                              |-- write to R2 (BUCKET)
                                              |-- INSERT into D1 (DB)
```

The weekly cron (`0 3 * * 1`) runs `handleSync()` which reconciles the R2
bucket against the D1 table &mdash; detecting manual renames in R2,
inserting orphaned objects, and deleting D1 rows whose R2 object disappeared.
The same handler is reachable from the archive footer's `sync` link via
bearer-auth.

### Migration from the standalone `scenarios` Worker

The Museum reuses the exact same D1 database
(`94e77071-f016-4073-9c1a-c9012424b48d`) and R2 bucket (`scenarios`) that
the old standalone Worker used &mdash; binding two Workers to one resource
is supported and requires zero data migration. During the coexistence
window both Workers will run the Monday cron; it is idempotent, so this
is harmless. Delete the standalone `scenarios` Worker when ready.
