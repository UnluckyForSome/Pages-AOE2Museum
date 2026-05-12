# Host Guide: How AoE2 Museum Uses The Verifier

This document is for whoever maintains the remote parser service behind `python.mcclemont.com`.

Its job is simple: explain the client that calls you, what it has already done before the request reaches you, and exactly what your service must return for the site to behave correctly.

## System At A Glance

The public upload flow is split across three layers:

1. Browser UI on `/scenarios/`
2. Cloudflare Worker in this repo
3. Remote verifier on `python.mcclemont.com`

The verifier is not the public upload endpoint. The browser never talks to it directly.

Actual flow:

1. User uploads files in the browser.
2. Browser sends `multipart/form-data` to `POST /api/scenarios/upload` on the museum site.
3. The Worker performs all public-facing upload checks.
4. For each remaining candidate scenario file, the Worker sends a single raw-file request to the remote verifier.
5. The verifier says either "valid" or "invalid" and includes a reason.
6. Only files marked valid are stored in R2 and inserted into D1.

## What The Host Does Not Need To Do

The remote verifier is intentionally narrow in scope. It does not need to:

- handle browser uploads
- parse `multipart/form-data`
- verify Turnstile
- accept `.zip` files
- extract archives
- enforce the museum's upload batch UX
- deduplicate against D1
- write to R2 or D1
- serve downloads

All of that already happens in the museum app before your service is called.

## What The Worker Already Does Before Calling You

The Worker route is `POST /api/scenarios/upload`.

Before it calls the verifier, it already:

1. verifies Turnstile
2. accepts only `.scn`, `.scx`, `.aoe2scenario`, and `.zip`
3. extracts `.zip` uploads with `fflate`
4. discards non-scenario files inside zips
5. enforces limits
6. hashes candidate files
7. deduplicates against D1 and within the current batch

Current limits in the Worker:

- max `900` scenario files per upload
- max `5 MB` per scenario file
- max `100 MB` compressed zip size
- max `100 MB` extracted zip size

By the time the verifier is called, each request is for exactly one already-filtered scenario file.

## The Requests You Receive

The Worker currently calls:

- `POST https://python.mcclemont.com/api/verify-scenario`

Request shape:

- `Content-Type: application/octet-stream`
- body: raw scenario bytes
- headers:
  - `Authorization: Bearer <PARSER_VERIFY_TOKEN>`
  - `X-Filename: original filename`
  - `X-Extension: scn|scx|aoe2scenario` when available

The Worker side is configured by:

- `PARSER_VERIFY_BASE_URL`
- `PARSER_VERIFY_TOKEN`

Today, `wrangler.jsonc` points `PARSER_VERIFY_BASE_URL` at:

- `https://python.mcclemont.com/api/verify-scenario`

## What The Verifier Must Decide

For each request, the verifier must answer one question:

Is this file a real parseable AoE2 scenario according to the museum parser stack?

That includes both categories:

- legacy scenarios such as `.scn` and `.scx`
- Definitive Edition scenarios such as `.aoe2scenario`

This is important: the verifier must not assume every valid scenario should go through `AoE2DEScenario.from_file()`.

Legacy scenarios must be allowed to follow the legacy parser route. In the parser fork, the correct decision point is the detection/dispatch path used by `parse_scenario()` or the exported `verify_scenario()` helper, not a DE-only constructor.

## Parser Source Of Truth

The museum treats this parser fork as the source of truth:

- [UnluckyForSome/AoE2ScenarioParser @ museum](https://github.com/UnluckyForSome/AoE2ScenarioParser/tree/museum)

The browser-side analyse/minimap pipeline already uses that parser family, so the host verifier should stay aligned with it.

If you are validating by importing the parser fork directly, prefer the library entrypoint that dispatches between legacy and DE, rather than hand-rolling your own detection rules.

## Response Contract

The Worker expects JSON with one of these shapes.

### Valid scenario

```json
{
  "ok": true,
  "valid": true,
  "reason": "parsed successfully",
  "analysis": {
    "containerFormat": "scx",
    "gameVersion": "legacy",
    "scenarioVersion": "1.14",
    "parseBackend": "aoe2_mcgeniescx.Scenario"
  }
}
```

### Invalid scenario

```json
{
  "ok": true,
  "valid": false,
  "reason": "parser rejected file: unsupported trigger structure"
}
```

### Internal verifier failure

```json
{
  "ok": false,
  "error": "internal parser error"
}
```

## Status Code Expectations

The Worker currently treats responses like this:

- `200` + `ok: true` + `valid: true`
  - file is accepted and later stored
- `200` + `ok: true` + `valid: false`
  - file is rejected
  - the returned `reason` is shown to the uploader
- non-`200`
  - verifier is treated as unavailable
  - upload flow fails closed with a generic temporary error
- `200` + malformed JSON
  - verifier is treated as unavailable
- `200` + `ok: false`
  - verifier is treated as unavailable

Recommended HTTP statuses:

- `200` for completed verification, whether valid or invalid
- `400` for malformed caller request
- `401` for missing or wrong bearer token
- `413` for host-side size rejection if you enforce your own maximum
- `415` for wrong content type
- `500` for unexpected internal failures

## Important Note About `reason`

For invalid files, the museum site now surfaces the verifier's `reason` directly to the uploader on the contribute page.

That means your invalid response text should be:

- human-readable
- concise
- accurate
- safe to show publicly

Good examples:

- `parser rejected file: unsupported scenario structure`
- `parser rejected file: corrupt compressed payload`
- `parser rejected file: unsupported legacy container format`

Avoid leaking secrets, stack traces, internal paths, or noisy raw exceptions unless they are intentionally safe for end users.

## How The Worker Uses Your Answer

The Worker's upload loop is effectively:

1. call remote verifier for one candidate file
2. if `valid` is false, add `rejected: <reason>` to the UI result list
3. if `valid` is true, keep the file
4. after all files are checked, write accepted files to R2 and D1

So from the host's perspective:

- `valid: false` is a normal business outcome
- `ok: false` or non-`200` is an infrastructure failure

Those are intentionally different.

## Authentication

The verifier should require a shared bearer token.

Expected request header:

```http
Authorization: Bearer <PARSER_VERIFY_TOKEN>
```

The Worker already sends this header. The host should reject missing or incorrect tokens with `401`.

## Health Endpoint

The client handoff also references:

- `GET /health`

This is useful for smoke tests and manual ops checks, but it is not part of the main upload verification flow.

Suggested response:

```json
{
  "ok": true
}
```

## Host Implementation Guidance

If you are implementing or updating the host service, optimize for these properties:

- stateless per-request verification
- one file per request
- raw byte body input
- strict bearer-token auth
- parser-backed validity check, not header sniffing
- support for both legacy and DE scenario paths
- clear invalid reasons
- stable JSON contract

## The Most Important Parsing Caveat

If a legacy scenario comes back with an error like:

- `The version DE:1.21 is not supported by AoE2ScenarioParser`

that is a strong sign the request was incorrectly forced down a DE-only parsing route.

The museum's expectation is not "everything must parse as DE".

The expectation is:

- legacy scenarios should parse as legacy
- DE scenarios should parse as DE
- the verifier should make that decision before choosing the backend

## Client Files Worth Reading

If you need to understand the museum side in code, these are the most relevant files:

- `server/scenarios/handlers/upload.ts`
- `server/scenarios/services/verify-scenario.ts`
- `server/scenarios/routes.ts`
- `server/scenarios/env.ts`
- `public/pages/scenarios/js/upload.js`
- `RELEVANT2CLIENT.md`

## Practical Smoke-Test Checklist

From the host side, a good end-to-end check is:

1. send a valid legacy scenario
2. send a valid DE scenario
3. send a corrupt scenario
4. send a request with the wrong token

Expected outcomes:

1. valid legacy file -> `200`, `ok: true`, `valid: true`
2. valid DE file -> `200`, `ok: true`, `valid: true`
3. corrupt file -> `200`, `ok: true`, `valid: false`, with a public-safe reason
4. wrong token -> `401`

That is the contract the museum client is built around.
