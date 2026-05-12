import type { ScenariosEnv } from "../env";

interface ScenarioAnalysis {
  containerFormat?: string;
  gameVersion?: string;
  scenarioVersion?: string;
  parseBackend?: string;
}

interface ScenarioVerifyValidResponse {
  ok: true;
  valid: true;
  reason: string;
  analysis?: ScenarioAnalysis;
}

interface ScenarioVerifyInvalidResponse {
  ok: true;
  valid: false;
  reason: string;
}

interface ScenarioVerifyErrorResponse {
  ok: false;
  error: string;
}

export type ScenarioVerifyResponse =
  | ScenarioVerifyValidResponse
  | ScenarioVerifyInvalidResponse
  | ScenarioVerifyErrorResponse;

export class ScenarioVerifierUnavailableError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ScenarioVerifierUnavailableError";
    this.status = status;
  }
}

function requireVerifierConfig(env: Pick<ScenariosEnv, "PARSER_VERIFY_BASE_URL" | "PARSER_VERIFY_TOKEN">) {
  if (!env.PARSER_VERIFY_BASE_URL) {
    throw new ScenarioVerifierUnavailableError("Scenario verifier base URL is not configured.");
  }
  if (!env.PARSER_VERIFY_TOKEN) {
    throw new ScenarioVerifierUnavailableError("Scenario verifier token is not configured.");
  }
}

function getExtension(filename: string): string {
  const parts = String(filename || "").split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function isVerifyResponse(value: unknown): value is ScenarioVerifyResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (payload.ok === true && payload.valid === true && typeof payload.reason === "string") return true;
  if (payload.ok === true && payload.valid === false && typeof payload.reason === "string") return true;
  if (payload.ok === false && typeof payload.error === "string") return true;
  return false;
}

export async function verifyScenario(
  env: Pick<ScenariosEnv, "PARSER_VERIFY_BASE_URL" | "PARSER_VERIFY_TOKEN">,
  filename: string,
  buffer: ArrayBuffer,
): Promise<ScenarioVerifyValidResponse | ScenarioVerifyInvalidResponse> {
  requireVerifierConfig(env);

  const headers = new Headers({
    Authorization: `Bearer ${env.PARSER_VERIFY_TOKEN}`,
    "Content-Type": "application/octet-stream",
    "X-Filename": filename,
  });
  const ext = getExtension(filename);
  if (ext) headers.set("X-Extension", ext);

  const res = await fetch(env.PARSER_VERIFY_BASE_URL, {
    method: "POST",
    headers,
    body: buffer,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message =
      isVerifyResponse(payload) && "error" in payload
        ? payload.error
        : `Verifier request failed with ${res.status}`;
    throw new ScenarioVerifierUnavailableError(message, res.status);
  }

  if (!isVerifyResponse(payload)) {
    throw new ScenarioVerifierUnavailableError("Verifier returned an invalid JSON response.", res.status);
  }

  if (payload.ok === false) {
    throw new ScenarioVerifierUnavailableError(payload.error, res.status);
  }

  return payload;
}
