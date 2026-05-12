# Scenario Upload Verification: Relevant Context

This document is a handoff for building a remote parser-verification service on the Docker host.

Primary goal:

- Replace the current shallow scenario upload verification with a real parser-backed verification step.
- Host that parser service on the remote machine under `python.mcclemont.com`.
- Keep the existing Cloudflare Worker as the public upload endpoint.
- Have the Worker call the remote Python service during upload processing.

## Repos / systems involved

### This repo

- Repo: `Pages-AOE2Museum`
- Main runtime: Cloudflare Worker + static assets
- Worker entrypoint: `server/worker/index.ts`
- Scenario upload route: `POST /api/scenarios/upload`

### Remote Docker host

User-provided target area:

- `@SSH FS - N2-Docker.lan/docker-projects/pythonserver`
- Extend/build under:
  - `@SSH FS - N2-Docker.lan/docker-projects/pythonserver/data`
  - `@SSH FS - N2-Docker.lan/docker-projects/pythonserver/build`

Desired public hostname:

- `python.mcclemont.com`

### Parser source of truth

Latest parser branch:

- [UnluckyForSome/AoE2ScenarioParser @ museum](https://github.com/UnluckyForSome/AoE2ScenarioParser/tree/museum)

This repo already treats that branch as the canonical parser source for the browser-side McMinimap/Pyodide flow.

## What the current upload flow does

The current browser upload UI lives in `public/pages/scenarios/js/upload.js`.

High-level flow:

1. Browser validates extensions and size limits client-side.
2. Browser loads Turnstile and submits `multipart/form-data` to `POST /api/scenarios/upload`.
3. Cloudflare Worker verifies Turnstile.
4. Worker accepts:
   - `.scn`
   - `.scx`
   - `.aoe2scenario`
   - `.zip`
5. For zips, Worker extracts entries with `fflate` and pulls out scenario files.
6. Worker enforces file count and size caps.
7. Worker hashes candidates and deduplicates against D1.
8. Worker runs `verifyScenario()` on each remaining file.
9. Accepted files are stored in R2 and metadata is inserted into D1.

Relevant files:

- `server/worker/index.ts`
- `server/scenarios/routes.ts`
- `server/scenarios/handlers/upload.ts`
- `server/scenarios/services/validation.ts`
- `server/scenarios/services/turnstile.ts`
- `server/scenarios/services/verify-scenario.ts`
- `public/pages/scenarios/js/upload.js`

## Why the current verification is insufficient

Current verification is only a header regex:

```ts
export async function verifyScenario(buffer: ArrayBuffer): Promise<boolean> {
  if (buffer.byteLength < 3) return false;
  const header = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  const str = String.fromCharCode(...header);
  return /^\d+\.\d+/.test(str);
}
```

Source:

- `server/scenarios/services/verify-scenario.ts`

This means uploads are currently accepted if they merely start with something that looks like a version number, not if they are truly valid scenario files according to the new parser backend.

## Existing parser-related architecture in this repo

There is already a richer parser/analyse pipeline in the frontend, but it is not used for uploads.

Relevant files:

- `public/modules/app-shell/shared-pyodide-service.js`
- `public/pages/scenarios/js/inspector.js`
- `scripts/fetch-pylibs.mjs`
- `scripts/build-mcminimap-bundle.mjs`

Important facts:

- The browser-side analyse tab uses `window.Aoe2MuseumPyodideService.analyse(...)`.
- The Pyodide bundle is built from vendored Python sources under `sourcemodules/`.
- `AoE2ScenarioParser` is fetched from GitHub branch `museum`.

From `scripts/fetch-pylibs.mjs`:

- `AOE2_SCENARIO_PARSER_REF` defaults to `museum`
- package source URL resolves to GitHub codeload for `UnluckyForSome/AoE2ScenarioParser`

From `scripts/build-mcminimap-bundle.mjs`:

- `AoE2ScenarioParser` is already considered a required part of the parsing bundle

This is useful because the remote Python API should validate files using the same parser family already trusted by the analyse/minimap pipeline.

## Recommended target architecture

Keep the existing flow mostly intact:

1. Browser still uploads to Cloudflare Worker.
2. Worker still:
   - verifies Turnstile
   - extracts zip files
   - enforces upload caps
   - deduplicates files
3. Worker replaces local `verifyScenario()` with a remote call to the Python parser API.
4. Python service performs real parser-backed verification per file.
5. Worker only stores files in R2/D1 when the remote service confirms validity.

Why this shape is best:

- The browser API stays same-origin and unchanged.
- Turnstile remains enforced at the Worker.
- Zip extraction and upload throttling stay in the Worker, so the Python service receives already-filtered individual files.
- The Python service stays focused on parsing/verification, not archive management or public upload orchestration.

## Best integration point in the Worker

The clean seam is in:

- `server/scenarios/handlers/upload.ts`

Current logic:

- dedupe first
- verify second
- store to R2/D1 after verification

Specifically, this loop should eventually call remote verification instead of the current local regex verifier:

```ts
for (const c of deduplicated) {
  const isValid = await verifyScenario(c.buffer);
  if (!isValid) {
    results.push({ filename: c.filename, status: "rejected: failed verification" });
    continue;
  }
  verified.push(c);
}
```

That is the most natural hook point for replacing local verification with an HTTP call.

## Proposed responsibility split

### Cloudflare Worker responsibilities

- Accept browser uploads
- Verify Turnstile
- Expand zip uploads
- Enforce:
  - max 900 scenario files
  - max 5 MB per scenario file
  - max 100 MB zip compressed
  - max 100 MB extracted contents
- Deduplicate via D1 hash check
- Call remote parser verification API for each candidate file
- Persist accepted files to R2/D1
- Return upload result JSON to browser

### Python service responsibilities

- Expose HTTP API for parser-backed verification
- Accept one scenario file per request
- Confirm whether the file is a legitimate parseable scenario
- Return structured metadata if available
- Return explicit failure reason when invalid
- Authenticate requests from the Worker

## Recommended Python service API

Recommended minimal endpoint:

- `POST /api/verify-scenario`

Recommended request shape:

- `Content-Type: application/octet-stream`
- headers:
  - `X-Filename: <original filename>`
  - `X-Extension: scn|scx|aoe2scenario`
  - `Authorization: Bearer <shared secret>`

Alternative:

- `multipart/form-data` with one file and metadata fields

Recommended response shape:

```json
{
  "ok": true,
  "valid": true,
  "reason": "parsed successfully",
  "analysis": {
    "containerFormat": "scx",
    "dataVersion": 1.46,
    "isDefinitiveEdition": false,
    "parseBackend": "AoE2ScenarioParser museum"
  }
}
```

Invalid example:

```json
{
  "ok": true,
  "valid": false,
  "reason": "parser rejected file: invalid trigger section"
}
```

Error example:

```json
{
  "ok": false,
  "error": "internal parser error"
}
```

Guidance:

- Keep `valid` separate from transport success.
- Return a human-readable `reason`; the Worker can map it to the upload result.
- Returning `analysis` is optional for first pass, but useful if this later feeds archive metadata.

## Authentication recommendation

Do not expose an unauthenticated parser API to the public internet.

Recommended:

- Shared bearer token between Cloudflare Worker and Python service
- Store Worker secret as a Wrangler secret, for example:
  - `PARSER_VERIFY_TOKEN`
- Store base URL as config/var or secret, for example:
  - `PARSER_VERIFY_BASE_URL=https://python.mcclemont.com`

Likely future Worker env additions:

- `PARSER_VERIFY_BASE_URL`
- `PARSER_VERIFY_TOKEN`

## Performance / timeout considerations

Current browser upload timeout:

- `300000 ms` (5 minutes)
- file: `public/pages/scenarios/js/upload.js`

Implications:

- Remote verification must be reasonably fast.
- The Worker currently handles files inline, synchronously.
- If verification is done one file at a time, large uploads may become slow.

Recommended first version:

- Keep it simple: one-file-per-request verification
- Add tight request timeouts in the Worker
- Fail closed if the verifier is unavailable

Possible future optimization:

- Add a batch verification endpoint to reduce per-request overhead

## Important current data/logic details

### Dedupe hash naming mismatch

The Worker computes MD5:

- `computeMd5()` in `server/scenarios/services/validation.ts`

But stores it in a D1 column named `sha256`:

- insert in `server/scenarios/handlers/upload.ts`

This works today, but it is a naming trap. Do not assume the stored value is actually SHA-256 unless that is separately fixed.

### Upload limits currently enforced

From `server/scenarios/services/validation.ts` and `server/scenarios/handlers/upload.ts`:

- max scenario file size: 5 MB
- max zip size: 100 MB compressed
- max extracted zip contents: 100 MB
- max total scenario files per upload: 900

### Accepted extensions

Upload pipeline currently accepts:

- `.scn`
- `.scx`
- `.aoe2scenario`
- `.zip`

The remote parser service only needs to verify extracted individual scenario files, not zip files directly, unless the design is deliberately changed.

## What the remote-side Cursor agent should build

On the Docker host, the agent should aim to create/extend:

1. A Python HTTP service in the `pythonserver` project
2. Build/container config so it fetches or installs the parser from:
   - `https://github.com/UnluckyForSome/AoE2ScenarioParser/tree/museum`
3. An HTTP endpoint at:
   - `https://python.mcclemont.com/api/verify-scenario`
4. Auth protection so only the Worker can call it
5. Clear container startup/build instructions for that host

The remote agent should prefer:

- FastAPI + Uvicorn (good default)
- explicit health endpoint, e.g. `GET /health`
- clear Docker build that pins the parser ref/branch

## Suggested remote implementation checklist

The remote agent should probably do this:

1. Inspect current `docker-projects/pythonserver` layout
2. Determine whether it already has:
   - `docker-compose.yml` or `compose.yml`
   - `Dockerfile`
   - reverse proxy config (nginx, Caddy, Traefik, etc.)
3. Add a Python API app with:
   - `POST /api/verify-scenario`
   - `GET /health`
4. Fetch/install the parser from the `museum` branch
5. Add auth via bearer token
6. Ensure the container is reachable behind `python.mcclemont.com`
7. Document the env vars and any manual deploy commands

## Suggested Worker follow-up after remote service exists

Once the remote service is live, this repo will still need a follow-up change:

1. Add Worker env vars/secrets for the parser service URL and token
2. Replace `verifyScenario()` usage in `server/scenarios/handlers/upload.ts` with remote fetch
3. Preserve the current user-facing rejected status format
4. Decide how much of the remote parser error/reason should be exposed back to the uploader

## Constraints from this environment

The SSHFS mount rule in this repo says:

- remote filesystem can be read/edited
- no remote shell/command execution is available from this environment

So from this side, I could not inspect or run the actual Docker host project. The remote-side agent should inspect the real files there and adapt this design to the host’s existing compose/reverse-proxy conventions.

## Minimal context summary for the remote agent

If you want a short prompt to give a Cursor agent on the Docker host, use this:

> Build a parser verification HTTP service inside the existing `docker-projects/pythonserver` project. It should expose `POST /api/verify-scenario` on `python.mcclemont.com`, authenticate requests with a bearer token, and verify uploaded `.scn`, `.scx`, and `.aoe2scenario` files using `UnluckyForSome/AoE2ScenarioParser` branch `museum`. The Cloudflare Worker in the main app will call this endpoint after Turnstile, zip extraction, size checks, and dedupe, and before storing files to R2/D1. Please inspect the current Docker/proxy setup on this machine and implement the service in a way that matches the existing project conventions.

