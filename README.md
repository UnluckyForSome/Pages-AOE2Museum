# AOE2 Museum

A Cloudflare Worker that hosts a small collection of Age of Empires II tools.
Each "app" lives under its own path and runs client-side where possible.

| Path                 | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `/`                  | Museum landing page listing available apps.                                                 |
| `/mcminimap/`        | Isometric minimap renderer. Runs [AOE2-McMinimap](https://github.com/UnluckyForSome/AOE2-McMinimap) in-browser via Pyodide &mdash; nothing is uploaded for rendering. |
| `/api/gallery`       | `GET` returns the latest-20 index; `POST image/png` (with `X-Source-Name`) appends to the gallery. |
| `/api/gallery/:id`   | Streams a stored gallery PNG from R2.                                                       |
| `/health`            | JSON uptime check.                                                                          |

Static assets are served by the Worker's `assets` binding. The only server
state is the optional, **public** gallery of the 20 most recent minimaps
(backed by R2 + KV) &mdash; see [Bindings](#bindings).

### Gallery caveat

The gallery is **global and public**: every visitor sees (and contributes to)
the same 20-slot ring buffer. The UI fire-and-forgets a PNG upload after each
successful render. Do not render private replays into the gallery unless you
are comfortable with them being visible to other visitors.

## Bindings

`wrangler.jsonc` declares three bindings:

| Binding         | Type           | Purpose                                   |
| --------------- | -------------- | ----------------------------------------- |
| `ASSETS`        | assets         | Serves `public/` (HTML, JS, vendor tar, &hellip;). |
| `MINIMAPS`      | R2 bucket      | Stores gallery PNGs at `minimap/<id>.png`. |
| `MINIMAP_INDEX` | KV namespace   | Single `index` key &mdash; JSON array, newest-first, capped at 20. |

One-time setup (already done for the production account; repeat per account):

```bash
wrangler r2 bucket create aoe2museum-minimaps
wrangler kv namespace create MINIMAP_INDEX
# then paste the returned id into wrangler.jsonc under kv_namespaces[0].id
```

## Layout

```
src/index.ts                        # Worker router
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
