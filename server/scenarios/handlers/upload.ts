import { unzipSync } from "fflate";
import type { ScenariosEnv } from "../env";
import type { AuthEnv } from "../../auth/env";
import { requireVerifiedUser } from "../../auth/services/session";
import { getTurnstileSecretForRequest, verifyTurnstile } from "../services/turnstile";
import {
  isAllowedUploadType,
  isScenarioFile,
  checkFileSize,
  checkZipSize,
  checkZipExtractedSize,
  computeMd5,
  getExtension,
} from "../services/validation";
import { resolveStandaloneFilename } from "../services/collisions";
import { normalizeStoredKey } from "../services/filenames";
import { ScenarioVerifierUnavailableError, verifyScenario } from "../services/verify-scenario";

interface ProcessedFile {
  filename: string;
  buffer: ArrayBuffer;
}

interface Candidate extends ProcessedFile {
  md5: string;
}

interface ReadyFile {
  storedFilename: string;
  originalFilename: string;
  ext: string;
  buffer: ArrayBuffer;
  md5: string;
  r2Key: string;
}

const MAX_FILES = 900;
const VERIFY_FAILURE_MESSAGE =
  "Scenario verifier is unavailable right now. Please try your upload again shortly.";

export async function handleUpload(
  request: Request,
  env: ScenariosEnv & AuthEnv,
): Promise<Response> {
  const user = await requireVerifiedUser(request, env);
  if (user instanceof Response) return user;
  const formData = await request.formData();

  const turnstileToken = formData.get("cf-turnstile-response") as string | null;
  if (!turnstileToken) {
    return Response.json({ error: "Missing Turnstile token" }, { status: 400 });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? undefined;
  const turnstileSecret = getTurnstileSecretForRequest(request.url, env.TURNSTILE_SECRET);
  const valid = await verifyTurnstile(turnstileToken, turnstileSecret, ip);
  if (!valid) {
    return Response.json({ error: "Turnstile verification failed" }, { status: 403 });
  }

  const files = formData.getAll("file") as unknown as File[];
  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  const filesToProcess: ProcessedFile[] = [];
  const results: { filename: string; status: string }[] = [];

  for (const file of files) {
    if (!isAllowedUploadType(file.name)) {
      results.push({ filename: file.name, status: "rejected: invalid file type" });
      continue;
    }

    const rawBuffer = await file.arrayBuffer();

    if (getExtension(file.name) === "zip") {
      if (!checkZipSize(rawBuffer.byteLength)) {
        results.push({
          filename: file.name,
          status: "rejected: zip too large (max 100 MB)",
        });
        continue;
      }

      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(new Uint8Array(rawBuffer));
      } catch {
        results.push({ filename: file.name, status: "rejected: failed to extract zip" });
        continue;
      }

      if (!checkZipExtractedSize(entries)) {
        results.push({
          filename: file.name,
          status: "rejected: zip contents too large (max 100 MB)",
        });
        continue;
      }

      let foundScenarios = false;
      for (const [path, data] of Object.entries(entries)) {
        const name = path.split("/").pop() ?? path;
        if (isScenarioFile(name)) {
          filesToProcess.push({ filename: name, buffer: data.buffer as ArrayBuffer });
          foundScenarios = true;
          if (filesToProcess.length > MAX_FILES) {
            return Response.json(
              {
                error: `Zip contains too many scenario files. Maximum is ${MAX_FILES} per upload.`,
              },
              { status: 400 },
            );
          }
        }
      }

      if (!foundScenarios) {
        results.push({
          filename: file.name,
          status: "rejected: zip contains no scenario files",
        });
      }
    } else {
      filesToProcess.push({ filename: file.name, buffer: rawBuffer });
    }
  }

  if (filesToProcess.length > MAX_FILES) {
    return Response.json(
      {
        error: `Too many files (${filesToProcess.length}). Maximum is ${MAX_FILES} per upload.`,
      },
      { status: 400 },
    );
  }

  const sizeChecked = filesToProcess.filter((item) => {
    if (!checkFileSize(item.buffer.byteLength)) {
      results.push({ filename: item.filename, status: "rejected: exceeds 5 MB limit" });
      return false;
    }
    return true;
  });

  const HASH_CHUNK = 50;
  const hashResults: string[] = [];
  for (let i = 0; i < sizeChecked.length; i += HASH_CHUNK) {
    const chunk = sizeChecked.slice(i, i + HASH_CHUNK);
    const chunkHashes = await Promise.all(chunk.map((item) => computeMd5(item.buffer)));
    hashResults.push(...chunkHashes);
  }
  const hashed: Candidate[] = sizeChecked.map((item, i) => ({
    ...item,
    md5: hashResults[i],
  }));

  const existingHashes = new Set<string>();
  const PARAM_CHUNK = 100;
  const hashList = hashed.map((c) => c.md5);
  for (let i = 0; i < hashList.length; i += PARAM_CHUNK) {
    const chunk = hashList.slice(i, i + PARAM_CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const { results: dupeRows } = await env.DB.prepare(
      `SELECT sha256 FROM scenarios WHERE sha256 IN (${ph})`,
    )
      .bind(...chunk)
      .all<{ sha256: string }>();
    for (const r of dupeRows ?? []) existingHashes.add(r.sha256);
  }

  const seenInBatch = new Set<string>();
  const deduplicated = hashed.filter((c) => {
    if (existingHashes.has(c.md5) || seenInBatch.has(c.md5)) {
      results.push({ filename: c.filename, status: "rejected: duplicate file" });
      return false;
    }
    seenInBatch.add(c.md5);
    return true;
  });

  const verified: Candidate[] = [];
  for (const c of deduplicated) {
    try {
      const verification = await verifyScenario(env, c.filename, c.buffer);
      if (!verification.valid) {
        const reason = verification.reason?.trim() || "failed verification";
        results.push({ filename: c.filename, status: `rejected: ${reason}` });
        continue;
      }
      verified.push(c);
    } catch (error) {
      if (error instanceof ScenarioVerifierUnavailableError) {
        return Response.json({ error: VERIFY_FAILURE_MESSAGE }, { status: 503 });
      }
      throw error;
    }
  }

  const allNames = new Set<string>();
  if (verified.length > 0) {
    const { results: existingRows } = await env.DB.prepare(
      "SELECT filename FROM scenarios",
    ).all<{ filename: string }>();
    for (const r of existingRows ?? []) allNames.add(normalizeStoredKey(r.filename));
  }

  const readyFiles: ReadyFile[] = [];
  for (const c of verified) {
    const resolved = await resolveStandaloneFilename(
      env,
      c.filename,
      user.username,
      allNames,
    );
    const ext = getExtension(c.filename);
    readyFiles.push({
      storedFilename: resolved.storedFilename,
      originalFilename: c.filename,
      ext,
      buffer: c.buffer,
      md5: c.md5,
      r2Key: resolved.storedFilename,
    });
  }

  const R2_CHUNK = 50;
  for (let i = 0; i < readyFiles.length; i += R2_CHUNK) {
    const chunk = readyFiles.slice(i, i + R2_CHUNK);
    await Promise.all(chunk.map((f) => env.BUCKET.put(f.r2Key, f.buffer)));
  }

  if (readyFiles.length > 0) {
    const D1_CHUNK = 500;
    const insertStmt = env.DB.prepare(
      `INSERT INTO scenarios (filename, original_filename, filetype, size, sha256, r2_key,
        uploader_id, visibility, kind, hearts_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'public', 'standalone', 0)`,
    );
    const clearTombstoneStmt = env.DB.prepare(
      "DELETE FROM deleted_r2_keys WHERE r2_key = ?",
    );
    const stmts = readyFiles.flatMap((f) => [
      clearTombstoneStmt.bind(f.r2Key),
      insertStmt.bind(
        f.storedFilename,
        f.originalFilename,
        f.ext,
        f.buffer.byteLength,
        f.md5,
        f.r2Key,
        user.id,
      ),
    ]);
    for (let i = 0; i < stmts.length; i += D1_CHUNK) {
      await env.DB.batch(stmts.slice(i, i + D1_CHUNK));
    }
  }

  for (const f of readyFiles) {
    results.push({ filename: f.storedFilename, status: "uploaded" });
  }

  const anyUploaded = readyFiles.length > 0;
  return Response.json({ results }, { status: anyUploaded ? 200 : 409 });
}
