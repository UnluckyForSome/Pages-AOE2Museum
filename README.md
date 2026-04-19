# AOE2 Museum

A Cloudflare Worker that hosts a small collection of Age of Empires II tools.
Each "app" lives under its own path and runs client-side where possible.

| Path          | Description                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------- |
| `/`           | Museum landing page listing available apps.                                                 |
| `/mcminimap/` | Isometric minimap renderer. Runs [AOE2-McMinimap](https://github.com/UnluckyForSome/AOE2-McMinimap) in-browser via Pyodide &mdash; no upload to any server. |
| `/health`     | JSON uptime check.                                                                          |

Static assets are served by the Worker's `assets` binding; the Worker script
itself (`src/index.ts`) is thin and mostly exists for future dynamic endpoints.

## Layout

```
src/index.ts                        # Worker router
public/                             # served by the Cloudflare assets binding
  index.html                        # museum landing
  mcminimap/
    index.html                      # app UI
    app.js                          # UI controller + worker RPC
    worker.js                       # Pyodide host (DedicatedWorker)
    py/bootstrap.py                 # exposes render(bytes, ext, settings)
    vendor/aoe2mcminimap.tar        # generated from the submodule (gitignored)
    vendor/manifest.json            # { sourceSha, builtAt, files } (gitignored)
mcminimap/
  vendor/
    aoe2mcminimap/                  # git submodule -> UnluckyForSome/AOE2-McMinimap
    pylibs/                         # downloaded pure-Python deps with no PyPI wheel (gitignored)
      construct/                    #   construct 2.8.16 source (pinned by the vendored mgz tree)
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
git submodule update --init --recursive
npm install
```

Run the dev server (the `predev` script regenerates the vendor tar if the
submodule has moved):

```bash
npm run dev
```

Then open http://localhost:8787.

### Bumping the McMinimap version

```bash
git submodule update --remote mcminimap/vendor/aoe2mcminimap
npm run build:mcminimap   # rebuilds the tar if the SHA changed, no-op otherwise
git add mcminimap/vendor/aoe2mcminimap
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
   (`fetch:pylibs` &mdash; currently just `construct==2.8.16`),
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

Either way, `scripts/fetch-pylibs.mjs` pulls `construct` straight from PyPI at
build time, so you do not need to commit it.

## How `/mcminimap` works (high level)

```
Browser --> index.html --> app.js --> new Worker("/mcminimap/worker.js")
                                         |
                                         |-- loads Pyodide runtime from jsDelivr
                                         |-- installs pure-Python wheels via micropip
                                         |     (AoE2ScenarioParser, mgz-fast, aocref, tabulate)
                                         |-- fetches /mcminimap/vendor/aoe2mcminimap.tar
                                         |-- pyodide.unpackArchive -> /home/pyodide/aoe2mcminimap
                                         |     (renderer + pylibs/construct bundled in)
                                         |-- runs /mcminimap/py/bootstrap.py
                                         |     (adds pylibs/ + vendor dir to sys.path)
                                         |
                               postMessage(file bytes + settings)
                                         |
                                         v
                            bootstrap.render(...) -> PNG bytes -> main thread
```

No scenarios, replays, or PNGs ever leave the browser.
