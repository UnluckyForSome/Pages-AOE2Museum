# AOE2 Museum

A Cloudflare Worker that hosts a small collection of Age of Empires II tools.
Each "app" lives under its own path and runs client-side where possible.

For the cross-repo dependency map covering `AoE2ScenarioParser`,
`AOE2-McMinimap`, `AOE2-McMGZ`, and the separate `remote-n2` deployment, see
[`DEPENDENCIES.md`](./DEPENDENCIES.md).

| Path                            | Description                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                             | Museum landing page listing available apps.                                                 |
| `/pages/contact/`               | Contact page.                                                                               |
| `/pages/minimap/`             | Isometric minimap renderer (Generate + Gallery tabs). Runs [AOE2-McMinimap](https://github.com/UnluckyForSome/AOE2-McMinimap) in-browser via Pyodide &mdash; nothing is uploaded for rendering. |
| `/pages/gif/`                   | Animated unit GIF / APNG from `.slp` / `.sld` sprites (Garage-backed assets via `/api/gif/*`). |
| `/api/gallery`                  | `GET` returns the latest-20 index; `POST image/png` (with `X-Source-Name`) appends to the gallery. |
| `/api/gallery/:id`              | Streams a stored gallery PNG from R2.                                                       |
| `/pages/scenarios/`             | Community archive of AoE2 custom scenarios (Archive + Contribute tabs on one page; `#contribute` deep-links the upload tab). |
| `/pages/campaignmanager/`    | Pure-JS port of [withmorten/rge_campaign](https://github.com/withmorten/rge_campaign). Extract + Pack tabs for `.cpn`/`.cpx`/`.aoecpn`/`.aoe2campaign` &mdash; runs entirely in the browser, nothing is uploaded. |
| `GET /api/scenarios`            | JSON list of every scenario in D1, newest first.                                            |
| `POST /api/scenarios/upload`    | Multipart upload (Turnstile-gated). Accepts `.scn`/`.scx`/`.aoe2scenario`/`.zip`, dedupes by MD5. |
| `GET /api/scenarios/download/:id` | Streams the scenario file from R2 and increments the download counter.                    |
| `POST /api/scenarios/sync`      | Bearer-auth (`SYNC_SECRET`) or cron-triggered R2&harr;D1 reconcile.                          |
| `/health`                       | JSON uptime check.                                                                          |

Static assets are served by the Worker's `assets` binding.
`/pages/minimap/` has an optional, **public** gallery of the 20 most recent
minimaps (R2 + KV). `/pages/scenarios/` is a shared community archive backed by
D1 + R2. See [Bindings](#bindings).

All pages share a single navy+gold theme defined in
`public/assets/css/museum.css` (tokens, site nav, buttons, cards, tabs, status
bubble, form controls, responsive). Per-app stylesheets
(`public/pages/minimap/style.css`, `public/pages/scenarios/css/style.css`) only add
genuinely unique widgets. The same `.tabs`/`.tab` pill component and
`.statusbar` progress bubble are reused across apps.

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
server/
  worker/
    index.ts                        # Worker router + scheduled()
    env.ts                          # Env interface (bindings)
    http/json.ts                    # shared JSON response helper
    features/
      gallery.ts                    # /api/gallery handlers
      aocrec.ts                     # /api/aocrec proxy handlers
      microsoft.ts                  # /api/ms proxy handlers
      scenarios.ts                  # /api/scenarios router (wraps server/scenarios/handlers/*)
  scenarios/
    env.ts                          # ScenariosEnv interface (DB, BUCKET, secrets)
    handlers/                       # list, upload, download, sync (ex-Pages-Scenarios)
    services/                       # turnstile, validation, verify-scenario
    db/schema.sql                   # reference only; production D1 is already populated
public/                             # served by the Cloudflare assets binding
  index.html                        # museum landing (navy+gold, shared nav)
  contact.html                      # shared contact page
  styles/museum.css                 # shared theme (tokens, nav, tabs, statusbar, buttons, cards)
  pages/                            # multi-page “apps” (URLs /pages/<name>/)
    gif/                            # unit GIF / SLD tab (see also public/modules/unit-gifs)
    mcminimap/
    scenarios/
    campaign-extractor/
  modules/                          # shared browser JS / WASM / McMinimap bundle (URLs /modules/...)
    rge-campaign/rge-campaign.js
    fflate/fflate.browser.js
    gifenc/gifenc.esm.js
    aoe2mcminimap/                  # generated tar + manifest (gitignored)
    unit-gifs/                      # SLP/SLD mapping JSON, palette, team-colors (GIF app + Worker manifests)
sourcemodules/
  aoe2mcminimap/                    # fetch-pylibs — AOE2-McMinimap sdist tree (gitignored)
  construct/                        # fetch-pylibs — transitive AOE2-McMGZ dep (gitignored)
  aocref/                           # fetch-pylibs — transitive AOE2-McMGZ dep (gitignored)
  aoe2_mcgeniescx/                  # fetch-pylibs — AOE2-McGenieSCX package from TestPyPI (gitignored)
  AoE2ScenarioParser/               # fetch-pylibs — museum branch package tree from GitHub (gitignored)
  pages_aoe2museum_py/              # local Pyodide facade package bundled for Pages-only parser entrypoints
  aoe2_mccampaign/                  # fetch-pylibs — AOE2-McCampaign sdist (gitignored); index see below
  mgz/                              # fetch-pylibs — AOE2-McMGZ package (`mgz` import namespace)
server/
  minimap/                          # civ/map JSON for Microsoft API proxy (imported by Worker TS)
scripts/
  fetch-pylibs.mjs                  # fetches AOE2-McMGZ (+ deps), AOE2-McGenieSCX, museum AoE2ScenarioParser, AOE2-McCampaign, AOE2-McMinimap into sourcemodules/
  build-mcminimap-bundle.mjs        # cache-gated tar (McMinimap tree + fetched pylibs + local parser facade -> aoe2mcminimap.tar)
```

## Local development

```bash
git clone <this-repo>
cd Pages-AOE2Museum   # or your checkout path
npm install
```

**PyPI indexes (defaults match TestPyPI staging):**

| Package | Default index | Override env |
|---------|----------------|--------------|
| **AOE2-McGenieSCX** | TestPyPI | `AOE2_MCGENIESCX_PYPI_INDEX` (e.g. `https://pypi.org`) |
| **AOE2-McGenieSCX** version pin | `0.1.1` in script | `AOE2_MCGENIESCX_VERSION` |
| **AoE2ScenarioParser** source | GitHub `museum` branch | `AOE2_SCENARIO_PARSER_REF` |
| **AOE2-McCampaign** | [TestPyPI](https://test.pypi.org/project/AOE2-McCampaign/) | `AOE2_MCCAMPAIGN_PYPI_INDEX` (e.g. `https://pypi.org`) |
| **AOE2-McMGZ** | TestPyPI | `AOE2_MCMGZ_PYPI_INDEX` |
| **AOE2-McMGZ** version pin | `0.1.0` in script | `AOE2_MCMGZ_VERSION` |
| **AOE2-McMinimap** | [TestPyPI](https://test.pypi.org/project/aoe2-mcminimap/) | `AOE2_MCMINIMAP_PYPI_INDEX` |
| **AOE2-McMinimap** version pin | `0.1.0` in script | `AOE2_MCMINIMAP_VERSION` |

When these packages are on **production [PyPI](https://pypi.org/)**:

```bash
export AOE2_MCGENIESCX_PYPI_INDEX=https://pypi.org
export AOE2_MCCAMPAIGN_PYPI_INDEX=https://pypi.org
export AOE2_MCMGZ_PYPI_INDEX=https://pypi.org
export AOE2_MCMINIMAP_PYPI_INDEX=https://pypi.org
npm run fetch:pylibs
```

Run the dev server (`predev` runs `build:mcminimap`, which fetches sdists if needed and rebuilds the tar):

```bash
npm run dev
```

Then open http://localhost:8787.

### Bumping McMinimap and replay-parser versions

Set **`AOE2_MCMINIMAP_VERSION`** and/or **`AOE2_MCMGZ_VERSION`** to the new release (and bump the matching `*_PYPI_INDEX` env var if needed), then:

```bash
npm run build:mcminimap
```

Commit any intentional changes to **`scripts/fetch-pylibs.mjs`** default pins if you bump them for everyone.

## Deploying

### From your machine

```bash
npm run deploy
```

The `predeploy` hook runs `npm run build:mcminimap`, which:

1. runs **`fetch:pylibs`** (**`AOE2-McMGZ`** + transitive `construct`/`aocref`, **`AOE2-McGenieSCX`**, **`AOE2-McCampaign`**, **`AOE2-McMinimap`** &mdash; see index table above),
2. compares vendored **`.version`** pins against `public/modules/aoe2mcminimap/manifest.json`, and
3. rebuilds the tarball only when something changed (fast no-op otherwise).

Nothing under **`sourcemodules/aoe2mcminimap/`** (or other fetched trees) is committed; CI must be able to reach **PyPI / TestPyPI** over HTTPS.

### Via Cloudflare Workers Builds

- **Build command:** `npm ci && npm run build:mcminimap`
- **Deploy command:** `npx wrangler deploy`

Set **`AOE2_MCGENIESCX_PYPI_INDEX`**, **`AOE2_MCCAMPAIGN_PYPI_INDEX`**, **`AOE2_MCMGZ_PYPI_INDEX`**, **`AOE2_MCMGZ_VERSION`**, **`AOE2_MCMINIMAP_PYPI_INDEX`**, and **`AOE2_MCMINIMAP_VERSION`** in the Workers Builds environment when you move off TestPyPI defaults.

**GitHub Actions** example (no submodules):

```yaml
# .github/workflows/deploy.yml
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

## How `/pages/minimap` works (high level)

```
Browser --> /pages/minimap/index.html --> app.js --> new Worker("/pages/minimap/worker.js")
                                         |
                                         |-- loads Pyodide runtime from jsDelivr
                                         |-- installs pure-Python wheels via micropip
                                         |     (AoE2ScenarioParser, tabulate)
                                         |-- fetches /modules/aoe2mcminimap/aoe2mcminimap.tar
                                         |-- pyodide.unpackArchive -> /home/pyodide/aoe2mcminimap
                                         |     (renderer + pylibs: mgz, construct, aocref)
                                         |-- runs /pages/minimap/py/bootstrap.py
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

## How `/pages/scenarios` works (high level)

Unlike `/pages/minimap`, the Scenarios archive is a **shared, server-backed**
app &mdash; uploaded scenario files live permanently in the `scenarios` R2
bucket, with metadata in the `scenarios` D1 database.

```
Browser --> /pages/scenarios/ (Archive tab)  --> GET /api/scenarios (list from D1)
         \                                     --> click row --> GET /api/scenarios/download/:id (stream from R2)
          --> /pages/scenarios/#contribute    --> Turnstile -> POST /api/scenarios/upload
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

## How `/pages/campaignmanager` works (high level)

A static, fully client-side app &mdash; the Worker only serves the assets.
The Genie engine campaign formats are simple enough that a pure-JS port of
[withmorten/rge_campaign](https://github.com/withmorten/rge_campaign) is a
single dependency-free ES module
(`public/modules/rge-campaign/rge-campaign.js`), faithful to the byte
layout of the original C tool's `main.c` / `util.c`.

```
Browser --> /pages/campaignmanager/ --> app.js (ES module)
                                       |
                                       |-- Extract tab
                                       |     drop file -> readCampaign(bytes)
                                       |     -> render metadata + scenario table
                                       |     -> per-row Download (Blob)
                                       |     -> Download all (.zip) via fflate.zipSync
                                       |
                                       \-- Pack tab
                                             drop scenarios -> sortable list
                                             -> writeCampaign({ ext, name, scenarios })
                                             -> trigger Blob download
```

Supported formats (the version header byte determines which one):

| Extension          | Origin                | Library format |
| ------------------ | --------------------- | -------------- |
| `.cpn` / `.cpx`    | AoE1 to AoC (legacy)  | `legacy`       |
| `.aoecpn`          | AoE1: Definitive Edition | `de1`       |
| `.aoe2campaign`    | AoE2: Definitive Edition | `de2`       |

The library is also usable from Node (
`import { readCampaign, writeCampaign } from "./public/modules/rge-campaign/rge-campaign.js"`
).

## Syncing AoE2 graphics (SLDs) to an S3 bucket

I sync the Age of Empires II: DE graphics folder (containing the SLDs) to an
S3 bucket (`s3://sld/`) hosted on a separate machine using AWS CLI against a
Garage S3-compatible endpoint:

```bash
aws --profile garage --endpoint-url https://garage.mcclemont.com s3 sync "C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\drs\graphics" "s3://sld/" --delete
```

Notes:

- `--delete` makes the bucket mirror the local directory (removes objects in
  the bucket that no longer exist locally).
- For speed, I added a DNS record on the router so `garage.mcclemont.com`
  resolves to a local IP &mdash; requests stay on the LAN (nothing goes through
  Cloudflare).
