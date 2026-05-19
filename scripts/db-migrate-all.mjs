/**
 * Run additive D1 migrations in order. Treats "duplicate column" as already applied.
 *
 * Usage:
 *   node scripts/db-migrate-all.mjs           # remote (production D1)
 *   node scripts/db-migrate-all.mjs --local   # local wrangler D1
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = process.argv.includes("--local");
const flag = local ? "--local" : "--remote";

const MIGRATIONS = [
  "server/auth/db/schema.sql",
  "server/auth/db/pending-signup.sql",
  "server/scenarios/db/alter-v2.sql",
  "server/scenarios/db/alter-v3.sql",
  "server/scenarios/db/alter-v4.sql",
  "server/scenarios/db/alter-v5-tombstones.sql",
  "server/scenarios/db/alter-v6-game-era.sql",
  "server/campaigns/db/schema.sql",
  "server/hearts/db/schema.sql",
  "server/history/db/schema.sql",
];

function runWrangler(file) {
  return new Promise((resolve) => {
    const args = [
      "d1",
      "execute",
      "scenarios",
      `--file=${file}`,
      flag,
      "--yes",
    ];
    const child = spawn("npx", ["wrangler", ...args], {
      cwd: root,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, out });
    });
  });
}

function isAlreadyApplied(output) {
  return /duplicate column name/i.test(output) || /already exists/i.test(output);
}

async function main() {
  console.log(`db:migrate:all (${flag})\n`);
  let failed = 0;

  for (const file of MIGRATIONS) {
    console.log(`\n--- ${file} ---\n`);
    const { code, out } = await runWrangler(file);
    if (code === 0) {
      console.log(`OK: ${file}`);
      continue;
    }
    if (isAlreadyApplied(out)) {
      console.log(`SKIP (already applied): ${file}`);
      continue;
    }
    console.error(`FAILED: ${file} (exit ${code})`);
    failed++;
    break;
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\nAll migrations complete.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
