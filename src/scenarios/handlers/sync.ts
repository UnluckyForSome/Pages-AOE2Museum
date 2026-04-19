import type { ScenariosEnv } from "../env";
import { getExtension, isScenarioFile } from "../services/validation";

interface DbRow {
  id: number;
  filename: string;
  r2_key: string;
  sha256: string;
  size: number;
  downloads: number;
}

interface R2Entry {
  key: string;
  size: number;
  etag: string;
}

async function listAllR2Objects(bucket: R2Bucket): Promise<R2Entry[]> {
  const entries: R2Entry[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ cursor });
    for (const obj of listed.objects) {
      entries.push({ key: obj.key, size: obj.size, etag: obj.etag });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return entries;
}

export async function handleSync(env: ScenariosEnv): Promise<void> {
  const r2Objects = await listAllR2Objects(env.BUCKET);
  const { results: dbRows } = await env.DB.prepare(
    "SELECT id, filename, r2_key, sha256, size, downloads FROM scenarios",
  ).all<DbRow>();

  const rows = dbRows ?? [];

  const dbByKey = new Map<string, DbRow>();
  const dbByHash = new Map<string, DbRow>();
  for (const row of rows) {
    dbByKey.set(row.r2_key, row);
    if (row.sha256) {
      dbByHash.set(`${row.size}:${row.sha256}`, row);
    }
  }

  const r2Keys = new Set(r2Objects.map((o) => o.key));

  const toInsert: R2Entry[] = [];
  const renames: { r2Entry: R2Entry; oldRow: DbRow }[] = [];

  for (const obj of r2Objects) {
    if (dbByKey.has(obj.key)) continue;

    const filename = obj.key;
    if (!filename || !isScenarioFile(filename)) continue;

    const key = `${obj.size}:${obj.etag}`;
    const oldRow = dbByHash.get(key);
    if (oldRow && !r2Keys.has(oldRow.r2_key)) {
      renames.push({ r2Entry: obj, oldRow });
    } else {
      toInsert.push(obj);
    }
  }

  const renamedIds = new Set(renames.map((r) => r.oldRow.id));
  const toDelete: number[] = [];
  for (const row of rows) {
    if (!r2Keys.has(row.r2_key) && !renamedIds.has(row.id)) {
      toDelete.push(row.id);
    }
  }

  const statements: D1PreparedStatement[] = [];

  for (const { r2Entry, oldRow } of renames) {
    const newFilename = r2Entry.key;
    const newExt = getExtension(newFilename);
    statements.push(
      env.DB.prepare(
        "UPDATE scenarios SET filename = ?, original_filename = ?, filetype = ?, size = ?, sha256 = ?, r2_key = ? WHERE id = ?",
      ).bind(
        newFilename,
        newFilename,
        newExt,
        r2Entry.size,
        r2Entry.etag,
        r2Entry.key,
        oldRow.id,
      ),
    );
  }

  for (const id of toDelete) {
    statements.push(env.DB.prepare("DELETE FROM scenarios WHERE id = ?").bind(id));
  }

  for (const obj of toInsert) {
    const filename = obj.key;
    const ext = getExtension(filename);
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO scenarios (filename, original_filename, filetype, size, sha256, r2_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(filename, filename, ext, obj.size, obj.etag, obj.key),
    );
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `[scenarios sync] ${renames.length} renamed, ${toInsert.length} added, ${toDelete.length} deleted`,
  );
}
