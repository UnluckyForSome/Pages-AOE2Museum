import { getExtension } from "./validation";

/** Display title from original filename (stem without extension). */
export function displayTitleFromFilename(filename: string): string {
  const ext = getExtension(filename);
  if (!ext) return filename;
  return filename.slice(0, filename.length - ext.length - 1);
}

/** Stored identity: `Mission1 by Hunter2.scx` */
export function usernameSuffixFilename(originalFilename: string, username: string): string {
  const ext = getExtension(originalFilename);
  const stem = displayTitleFromFilename(originalFilename);
  if (!ext) return `${stem} by ${username}`;
  return `${stem} by ${username}.${ext}`;
}

/** Alt collision: `Mission1 [alt1] by Hunter2.scx` */
export function altSuffixFilename(
  baseStem: string,
  altN: number,
  username: string,
  ext: string,
): string {
  const tagged = `${baseStem} [alt${altN}]`;
  return ext ? `${tagged} by ${username}.${ext}` : `${tagged} by ${username}`;
}

/** Normalize identity key for collision checks (lowercase stored filename). */
export function normalizeStoredKey(filename: string): string {
  return filename.toLowerCase();
}
