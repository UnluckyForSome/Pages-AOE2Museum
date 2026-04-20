#!/usr/bin/env node
// Smoke test for the Garage S3 integration. Reads credentials and config from
// the environment, lists the first few keys of each bucket, and prints a
// short summary. Intended to be run manually before deploying a change to the
// /gif/ backend.
//
// Required env vars:
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
// Optional (defaults match wrangler.jsonc):
//   GARAGE_ENDPOINT=https://garage.mcclemont.com
//   GARAGE_REGION=garage
//   GARAGE_BUCKET_SLP=slp
//   GARAGE_BUCKET_SLD=sld

import { AwsClient } from "aws4fetch";

const ENDPOINT = (process.env.GARAGE_ENDPOINT || "https://garage.mcclemont.com").replace(/\/+$/, "");
const REGION = process.env.GARAGE_REGION || "garage";
const BUCKETS = [
  ["SLP", process.env.GARAGE_BUCKET_SLP || "slp"],
  ["SLD", process.env.GARAGE_BUCKET_SLD || "sld"],
];

const AK = process.env.AWS_ACCESS_KEY_ID || process.env.GARAGE_ACCESS_KEY_ID;
const SK = process.env.AWS_SECRET_ACCESS_KEY || process.env.GARAGE_SECRET_ACCESS_KEY;

if (!AK || !SK) {
  console.error("error: set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY before running");
  process.exit(2);
}

const client = new AwsClient({
  accessKeyId: AK,
  secretAccessKey: SK,
  service: "s3",
  region: REGION,
});

function parseKeys(xml) {
  const out = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  const total = /<KeyCount>([^<]+)<\/KeyCount>/.exec(xml);
  return { keys: out, keyCount: total ? Number(total[1]) : out.length };
}

async function probe(label, bucket) {
  const url = `${ENDPOINT}/${encodeURIComponent(bucket)}?list-type=2&max-keys=10`;
  const res = await client.fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[${label}] ${bucket}: ${res.status} ${res.statusText}`);
    console.error(text.slice(0, 400));
    return false;
  }
  const { keys, keyCount } = parseKeys(text);
  console.log(`[${label}] ${bucket}: ok (page keyCount=${keyCount})`);
  for (const k of keys) console.log(`  - ${k}`);
  return true;
}

let allOk = true;
for (const [label, bucket] of BUCKETS) {
  try {
    const ok = await probe(label, bucket);
    if (!ok) allOk = false;
  } catch (err) {
    allOk = false;
    console.error(`[${label}] ${bucket}: threw ${err && err.message ? err.message : err}`);
  }
}

process.exit(allOk ? 0 : 1);
