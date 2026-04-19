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
mcminimap/vendor/aoe2mcminimap/     # git submodule -> UnluckyForSome/AOE2-McMinimap
scripts/
  sync-mcminimap.mjs                # ensures submodule is initialised
  build-mcminimap-bundle.mjs        # SHA-gated tar of McMinimap.py + data + emblems + legacy/mgz_legacy
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

## Deploying (Cloudflare)

```bash
npm run deploy
```

The `predeploy` hook runs `npm run build:mcminimap`, which:

1. initialises the submodule if needed,
2. compares the submodule HEAD SHA against `public/mcminimap/vendor/manifest.json`, and
3. rebuilds the tarball only when the SHA changed (fast no-op otherwise).

If you use Cloudflare's Git-connected build pipeline, make sure **"Include submodules"**
is enabled for the project so the build environment can populate
`mcminimap/vendor/aoe2mcminimap/` before `npx wrangler deploy` runs.

## How `/mcminimap` works (high level)

```
Browser --> index.html --> app.js --> new Worker("/mcminimap/worker.js")
                                         |
                                         |-- loads Pyodide runtime from jsDelivr
                                         |-- installs pure-Python wheels via micropip
                                         |-- fetches /mcminimap/vendor/aoe2mcminimap.tar
                                         |-- pyodide.unpackArchive -> /home/pyodide/aoe2mcminimap
                                         |-- runs /mcminimap/py/bootstrap.py
                                         |
                               postMessage(file bytes + settings)
                                         |
                                         v
                            bootstrap.render(...) -> PNG bytes -> main thread
```

No scenarios, replays, or PNGs ever leave the browser.
