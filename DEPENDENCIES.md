# Cross-Repo Dependency Map

This file explains how the repositories around `Pages-AOE2Museum` fit together.
It is intended as a quick source of truth for humans and AI before making
changes that span the Museum site, parser, minimap renderer, replay parser, or
the remote verifier.

## Repositories and roles

### `Forks/AoE2ScenarioParser`

Standalone Python library for reading and writing AoE2 scenario files.

- Used by the Museum for scenario parsing in two places:
  - inside the browser minimap bundle
  - inside the remote verifier service used by `/pages/scenarios/`
- Current direct runtime dependency for legacy `.scn` / `.scx` parsing is
  `AOE2-McGenieSCX`.
- It does **not** currently import `AOE2-McMGZ` directly in this repo.

### `Forks/AOE2-McMGZ`

Standalone replay parser package.

- Used for recorded game parsing.
- Consumed by `AOE2-McMinimap`.
- Also vendored into the Museum minimap Pyodide bundle so replay minimaps can
  be rendered in-browser.

### `Public/AOE2-McMinimap`

Standalone Python CLI/library that renders isometric minimaps.

- Uses `AoE2ScenarioParser` for scenario inputs.
- Uses `AOE2-McMGZ` for recorded game inputs.
- Published independently from the Museum site.
- The Museum reuses the published package contents, not the local checkout
  directly.

### `Pages/Pages-AOE2Museum`

Main Cloudflare Worker site.

- Hosts the public Museum pages and APIs.
- Builds a browser bundle for `/pages/minimap/`.
- Calls a remote Python verifier for `/pages/scenarios/` uploads.
- Consumes upstream repos by fetching pinned package sources or commits during
  build/deploy steps.

### `Pages/Pages-AOE2Museum/remote-n2`

Separate repo/checkout representing code that runs on the remote server.

- Local edits here do nothing until that repo is committed, pushed, and
  deployed on the remote host.
- `pythonserver` contains the remote scenario verifier used by the main Museum
  Worker.
- `pythonserver` also has a separate clone-based render setup that expects a
  checked-out `AOE2-McMinimap` tree under
  `remote-n2/pythonserver/data/aoe2mcminimap`.
- The remote repo has its own deployment lifecycle and should be treated as a
  separate push target from `Pages-AOE2Museum`.

## High-level dependency graph

```text
AOE2-McGenieSCX
  -> AoE2ScenarioParser

AOE2-McMGZ
  -> AOE2-McMinimap

AoE2ScenarioParser
  -> AOE2-McMinimap

AOE2-McMGZ + AoE2ScenarioParser + AOE2-McMinimap
  -> Pages-AOE2Museum /pages/minimap browser bundle

AoE2ScenarioParser
  -> remote-n2/pythonserver verifier
  -> Pages-AOE2Museum /pages/scenarios upload verification
```

## What `Pages-AOE2Museum` actually consumes

The important distinction is that `Pages-AOE2Museum` usually does **not**
import the sibling working copies under `Forks/` or `Public/` directly.

Instead, the main site builds from fetched package sources:

- `scripts/fetch-pylibs.mjs`
  - fetches `AOE2-McMGZ` into `sourcemodules/mgz`
  - fetches `AOE2-McGenieSCX` into `sourcemodules/aoe2_mcgeniescx`
  - fetches `AoE2ScenarioParser` from the GitHub `museum` branch/ref into
    `sourcemodules/AoE2ScenarioParser`
  - fetches `AOE2-McMinimap` into `sourcemodules/aoe2mcminimap`
- `scripts/build-mcminimap-bundle.mjs`
  - packs those fetched trees, plus the local
    `sourcemodules/pages_aoe2museum_py` facade, into
    `public/modules/aoe2mcminimap/aoe2mcminimap.tar`

That means:

- pushing a standalone repo is **not enough** on its own
- the Museum repo also needs a rebuild or repin when it should start using the
  new upstream code

## Browser minimap path

`/pages/minimap/` runs client-side in Pyodide.

The Museum site bundles:

- `AOE2-McMinimap`
- `AoE2ScenarioParser`
- `AOE2-McMGZ`
- transitive pure-Python dependencies such as `construct` and `aocref`
- local Museum-only Python glue in `sourcemodules/pages_aoe2museum_py`

Use this mental model:

- upstream parser/minimap/replay-parser repos produce the source artifacts
- `Pages-AOE2Museum` vendors and bundles them
- the browser executes the bundled tar, not the sibling local repos

## Scenario verification path

`/pages/scenarios/` does **not** parse uploaded scenarios in-browser.

Flow:

1. The Worker receives the upload.
2. The Worker calls `PARSER_VERIFY_BASE_URL`.
3. The remote `pythonserver` verifies the file with `AoE2ScenarioParser`.
4. The Worker accepts or rejects the upload based on that response.

Important files:

- main Worker caller:
  `server/scenarios/services/verify-scenario.ts`
- Worker env contract:
  `server/scenarios/env.ts`
- remote verifier implementation:
  `remote-n2/pythonserver/data/api/scenario_verify.py`
- remote verifier dependency pin:
  `remote-n2/pythonserver/build/requirements.txt`
- shared token example:
  `remote-n2/pythonserver/worker-verifier.env.example`

This path is separate from the browser minimap bundle. If parser behavior
changes, you may need to update both the browser bundle and the remote verifier.

## Update playbooks

### If `AoE2ScenarioParser` changes

Do this when scenario parsing behavior, version support, or parser APIs change.

1. Commit and push `Forks/AoE2ScenarioParser`.
2. Decide whether the Museum browser bundle should use the new parser code.
3. If yes, update the ref/pin used by `Pages-AOE2Museum` if needed, then run
   `npm run build:mcminimap`.
4. Decide whether the remote verifier should use the same parser change.
5. If yes, update the pinned commit in
   `remote-n2/pythonserver/build/requirements.txt`, then push `remote-n2`.

Common mistake: updating the parser repo only, while forgetting that the Museum
bundle and the remote verifier consume their own pinned snapshots.

### If `AOE2-McMGZ` changes

Do this when replay parsing behavior changes.

1. Commit and push `Forks/AOE2-McMGZ`.
2. Publish or otherwise make the intended package version available where the
   Museum build expects it.
3. If `AOE2-McMinimap` depends on that change, update and republish
   `Public/AOE2-McMinimap` too.
4. Rebuild the Museum minimap bundle so the new `AOE2-McMGZ` version is fetched
   into `sourcemodules/mgz`.

Common mistake: assuming `AoE2ScenarioParser` is the repo that needs changing
for replay parsing. In the current setup, replay parsing belongs to
`AOE2-McMGZ` and its consumers.

### If `AOE2-McMinimap` changes

Do this when rendering behavior or the public minimap API changes.

1. Commit and push `Public/AOE2-McMinimap`.
2. Publish the new package version.
3. Rebuild `Pages-AOE2Museum` so it fetches the new minimap package and updates
   `public/modules/aoe2mcminimap/manifest.json`.
4. If any remote clone-based render setup still depends on a checked-out
   `AOE2-McMinimap` tree, update that separately.

Common mistake: updating the standalone repo but not rebuilding the Museum tar.

### If only `Pages-AOE2Museum` changes

Changes entirely inside this repo may still fall into two groups:

- Worker/UI-only changes:
  - deploy the Museum Worker
- minimap bundle changes:
  - rebuild the bundle with `npm run build:mcminimap`
  - then deploy the Worker

If you changed `sourcemodules/pages_aoe2museum_py`, `public/pages/minimap/py`,
or the bundle scripts, assume the minimap tar should be rebuilt.

### If `remote-n2` changes

Treat this as a separate deployment target.

1. Commit and push the `remote-n2` repo.
2. Wait for the push-to-deploy workflow to update the server.
3. If the main Museum Worker expects matching config or token changes, update
   `Pages-AOE2Museum` too.

Common mistake: editing `remote-n2` locally and assuming the live remote server
is updated automatically.

## Release order when multiple repos change

When multiple repos are involved, use this order unless there is a specific
reason not to:

1. lowest-level libraries first
2. standalone consumers next
3. Museum bundle rebuild after upstream releases/pins exist
4. remote verifier pin update if parser behavior changed
5. deploy the site and remote server separately

In practice that usually means:

1. `AOE2-McGenieSCX` or `AOE2-McMGZ`
2. `AoE2ScenarioParser`
3. `AOE2-McMinimap`
4. `Pages-AOE2Museum`
5. `remote-n2` when the verifier or remote services need matching changes

## Quick rules of thumb

- `Forks/` and `Public/` are usually source workspaces, not live dependencies of
  `Pages-AOE2Museum`.
- The Museum browser bundle is a vendored snapshot, not a live import from
  sibling repos.
- `AoE2ScenarioParser` currently depends on `AOE2-McGenieSCX` for legacy
  scenarios, not directly on `AOE2-McMGZ`.
- `AOE2-McMinimap` is the repo that bridges scenario parsing and replay parsing.
- `remote-n2` is operationally separate from the main Museum Worker repo.
- If parser behavior changes, check both:
  - the browser minimap bundle
  - the remote scenario verifier
