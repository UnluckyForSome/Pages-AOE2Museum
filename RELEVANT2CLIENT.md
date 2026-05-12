# Python Verifier: Client Integration Handoff

This is the requester-side contract for wiring the Cloudflare Worker (or any other caller) to the Python scenario verifier now running under `python.mcclemont.com`.

The Python side now exposes:

- `GET /health`
- `POST /api/verify-scenario`

The verifier is intended to be called after:

1. Turnstile verification
2. zip extraction
3. upload count / size checks
4. dedupe filtering

It is intended to receive one already-filtered scenario file at a time.

## Base URL

Use:

- `https://python.mcclemont.com/api/verify-scenario`

Suggested requester-side env vars:

- `PARSER_VERIFY_BASE_URL=https://python.mcclemont.com/api/verify-scenario`
- `PARSER_VERIFY_TOKEN=<shared secret>`

## Authentication

Send:

- `Authorization: Bearer <PARSER_VERIFY_TOKEN>`

Important:

- In production, the Python host should have `PARSER_VERIFY_TOKEN` set.
- If the Python service leaves `PARSER_VERIFY_TOKEN` empty, auth is effectively disabled there. Do not rely on that for public deployment.

## Preferred Request Shape

Preferred request:

- method: `POST`
- content type: `application/octet-stream`
- body: raw scenario bytes
- headers:
  - `Authorization: Bearer <token>`
  - `X-Filename: original-name.scx`

Optional extra header:

- `X-Extension: scx`

If both `X-Filename` and `X-Extension` are provided, the extension must match the filename suffix.

## Supported Extensions

The verifier accepts individual scenario files only:

- `.scn`
- `.scx`
- `.aoe2scenario`

It does not accept `.zip` directly.

## Size Limit

Current Python-side verifier limit:

- `VERIFY_MAX_UPLOAD_MB`
- default: `5 MB`

If a file exceeds that limit, the service returns `413`.

## Success Response

For a valid scenario:

```json
{
  "ok": true,
  "valid": true,
  "reason": "parsed successfully",
  "analysis": {
    "containerFormat": "scx",
    "gameVersion": "DE",
    "scenarioVersion": "1.57",
    "parseBackend": "AoE2ScenarioParser museum"
  }
}
```

Notes:

- `analysis` is present for successful parses.
- `containerFormat` comes from the uploaded file extension.
- `scenarioVersion` is the parser-detected scenario version.

## Invalid File Response

If the request succeeded but the parser rejected the file as not actually parseable:

```json
{
  "ok": true,
  "valid": false,
  "reason": "parser rejected file: ..."
}
```

Interpretation:

- Transport succeeded
- The file should be treated as rejected
- This is not a retryable infrastructure error

## Server Error Response

If the verifier itself fails unexpectedly:

```json
{
  "ok": false,
  "error": "internal parser error"
}
```

Interpretation:

- Treat this as verifier failure, not invalid-file failure
- Recommended behavior is to fail closed and reject or defer upload rather than storing unverified files

## HTTP Status Behavior

Expected status codes:

- `200`: verifier completed; inspect JSON
- `400`: bad request, missing filename/extension, empty file, unsupported extension, etc.
- `401`: missing or wrong bearer token
- `413`: file too large
- `415`: wrong content type
- `500`: unexpected internal verifier failure

Recommended requester behavior:

- `200` + `ok=true` + `valid=true` -> accept as verified
- `200` + `ok=true` + `valid=false` -> reject as failed verification
- any non-`200` or `ok=false` -> treat verifier as unavailable/error and fail closed

## Cloudflare Worker Example

This is the recommended request style from the requester Worker:

```ts
interface Env {
  PARSER_VERIFY_BASE_URL: string;
  PARSER_VERIFY_TOKEN: string;
}

type VerifyResponse =
  | {
      ok: true;
      valid: true;
      reason: string;
      analysis?: {
        containerFormat?: string;
        gameVersion?: string;
        scenarioVersion?: string;
        parseBackend?: string;
      };
    }
  | {
      ok: true;
      valid: false;
      reason: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function verifyScenarioRemotely(
  env: Env,
  filename: string,
  buffer: ArrayBuffer,
): Promise<VerifyResponse> {
  const res = await fetch(env.PARSER_VERIFY_BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.PARSER_VERIFY_TOKEN}`,
      "Content-Type": "application/octet-stream",
      "X-Filename": filename,
    },
    body: buffer,
  });

  let payload: VerifyResponse | null = null;
  try {
    payload = (await res.json()) as VerifyResponse;
  } catch {
    // Leave payload null and handle below.
  }

  if (!res.ok) {
    throw new Error(
      payload && "error" in payload
        ? payload.error
        : `Verifier request failed with ${res.status}`,
    );
  }

  if (!payload) {
    throw new Error("Verifier returned a non-JSON response.");
  }

  return payload;
}
```

## Upload Loop Integration Shape

The requester host should replace shallow local verification with a remote call at the point where each deduplicated scenario file is already available as bytes.

Suggested behavior:

1. Call the verifier once per candidate scenario file.
2. If response is `ok=true` and `valid=true`, keep the file in the `verified` set.
3. If response is `ok=true` and `valid=false`, mark the upload result as rejected.
4. If the verifier request fails or returns `ok=false`, fail closed.

Example status mapping:

- valid parser result -> keep current accepted flow
- invalid parser result -> `rejected: failed verification`
- verifier unavailable / 5xx / malformed response -> reject request or mark as temporary verifier failure, depending on your upload UX choice

## Curl Smoke Test

```bash
curl -X POST "https://python.mcclemont.com/api/verify-scenario" \
  -H "Authorization: Bearer $PARSER_VERIFY_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Filename: example.scx" \
  --data-binary "@example.scx"
```

Expected outcomes:

- valid file -> `200` with `ok: true, valid: true`
- corrupt file -> `200` with `ok: true, valid: false`
- wrong token -> `401`

## Health Check

```bash
curl "https://python.mcclemont.com/health"
```

Expected response:

```json
{
  "ok": true
}
```
