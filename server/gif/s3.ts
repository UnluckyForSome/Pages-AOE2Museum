// Thin SigV4 wrapper around aws4fetch for talking to a Garage S3 endpoint.
// Garage is S3-compatible enough that stock `path-style` GetObject /
// ListObjectsV2 calls work unchanged.
import { AwsClient } from "aws4fetch";
import type { GifEnv } from "./env";

function makeClient(env: GifEnv): AwsClient {
  if (!env.GARAGE_ACCESS_KEY_ID || !env.GARAGE_SECRET_ACCESS_KEY) {
    throw new Error("Garage credentials are not configured");
  }
  return new AwsClient({
    accessKeyId: env.GARAGE_ACCESS_KEY_ID,
    secretAccessKey: env.GARAGE_SECRET_ACCESS_KEY,
    service: "s3",
    region: env.GARAGE_REGION || "garage",
  });
}

function bucketUrl(env: GifEnv, bucket: string, key?: string, query?: Record<string, string>): string {
  // Path-style addressing: https://<endpoint>/<bucket>[/<key>][?...]
  const base = env.GARAGE_ENDPOINT.replace(/\/+$/, "");
  let url = `${base}/${encodeURIComponent(bucket)}`;
  if (key !== undefined) {
    // Keys can contain `/`; encode each segment separately.
    url += "/" + key.split("/").map(encodeURIComponent).join("/");
  }
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams(query).toString();
    url += `?${qs}`;
  }
  return url;
}

// Extract <Key> values from a ListObjectsV2 XML response without pulling in
// a full XML parser. Garage and MinIO both emit the stock S3 format.
function parseListKeys(xml: string): { keys: string[]; continuationToken: string | null; isTruncated: boolean } {
  const keys: string[] = [];
  const keyRe = /<Key>([^<]+)<\/Key>/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(xml)) !== null) {
    // Decode XML entities that S3 may emit for keys containing `&` / `<` / `>`.
    keys.push(
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    );
  }
  const truncMatch = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/);
  const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return {
    keys,
    continuationToken: tokenMatch ? tokenMatch[1] : null,
    isTruncated: truncMatch ? truncMatch[1].trim() === "true" : false,
  };
}

export async function listAllKeys(env: GifEnv, bucket: string): Promise<string[]> {
  const client = makeClient(env);
  const all: string[] = [];
  let continuationToken: string | null = null;
  // Hard cap so a bad bucket can never spin this forever.
  const MAX_PAGES = 200;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string> = {
      "list-type": "2",
      "max-keys": "1000",
    };
    if (continuationToken) query["continuation-token"] = continuationToken;
    const url = bucketUrl(env, bucket, undefined, query);
    const res = await client.fetch(url, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ListObjectsV2 ${bucket} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    const xml = await res.text();
    const { keys, continuationToken: next, isTruncated } = parseListKeys(xml);
    for (const k of keys) all.push(k);
    if (!isTruncated || !next) break;
    continuationToken = next;
  }
  return all;
}

export async function getObject(env: GifEnv, bucket: string, key: string, reqHeaders?: Headers): Promise<Response> {
  const client = makeClient(env);
  const url = bucketUrl(env, bucket, key);
  const init: RequestInit = { method: "GET" };
  // Forward Range for partial reads so browsers can seek within a large SLD.
  const range = reqHeaders?.get("range");
  if (range) {
    init.headers = { Range: range };
  }
  return client.fetch(url, init);
}
