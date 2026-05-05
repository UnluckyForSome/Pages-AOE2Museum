const ALLOWED_EXTENSIONS = ["scn", "scx", "aoe2scenario"];
const ALLOWED_UPLOAD_EXTENSIONS = [...ALLOWED_EXTENSIONS, "zip"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100 MB compressed
const MAX_ZIP_EXTRACTED_SIZE = 100 * 1024 * 1024; // 100 MB total extracted

export function getExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts.pop()!.toLowerCase();
}

export function isAllowedUploadType(filename: string): boolean {
  return ALLOWED_UPLOAD_EXTENSIONS.includes(getExtension(filename));
}

export function isScenarioFile(filename: string): boolean {
  return ALLOWED_EXTENSIONS.includes(getExtension(filename));
}

export function checkFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

export function checkZipSize(size: number): boolean {
  return size > 0 && size <= MAX_ZIP_SIZE;
}

export function checkZipExtractedSize(entries: Record<string, Uint8Array>): boolean {
  let total = 0;
  for (const data of Object.values(entries)) {
    total += data.byteLength;
    if (total > MAX_ZIP_EXTRACTED_SIZE) return false;
  }
  return true;
}

export async function computeMd5(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("MD5", buffer);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function resolveFilenameCollision(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) return desired;

  const ext = getExtension(desired);
  const stem = desired.slice(0, desired.length - ext.length - 1);

  let version = 1;
  let candidate: string;
  do {
    candidate = `${stem}-V${version}.${ext}`;
    version++;
  } while (existing.has(candidate));

  return candidate;
}
