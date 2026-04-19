/**
 * Checks that the file begins with a version string in the form `#.#`
 * (e.g. "1.21", "1.44", "212.22"). AoE2 scenario formats (.scn, .scx,
 * .aoe2scenario) all start with an ASCII version number like this.
 */
export async function verifyScenario(buffer: ArrayBuffer): Promise<boolean> {
  if (buffer.byteLength < 3) return false;
  const header = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  const str = String.fromCharCode(...header);
  return /^\d+\.\d+/.test(str);
}
