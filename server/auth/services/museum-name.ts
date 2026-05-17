/** Single public account name (3–20 chars, [A-Za-z0-9_]). Stored in user.username; mirrored to user.name for better-auth. */

export const MUSEUM_NAME_MIN = 3;
export const MUSEUM_NAME_MAX = 20;
export const MUSEUM_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function isValidMuseumName(value: string): boolean {
  return (
    value.length >= MUSEUM_NAME_MIN &&
    value.length <= MUSEUM_NAME_MAX &&
    MUSEUM_NAME_PATTERN.test(value)
  );
}

/** Resolve the name used in filenames and public UI. */
export function getMuseumUsername(user: {
  username?: string | null;
  name?: string | null;
}): string | null {
  const handle = (user.username ?? user.name)?.trim();
  return handle || null;
}
