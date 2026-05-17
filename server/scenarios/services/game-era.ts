/**
 * Game era from scenario container_format + data_version (genie-scx Version methods).
 * Container format is stored as a four-char "1.XX" string — compare the XX suffix as an integer.
 * DE: payload data >= 1.28, container strictly newer than 1.22, or is_definitive_edition.
 * @see sourcemodules/genie-rs/crates/genie-scx/src/types.rs
 * @see Public/AOE2-McGenieSCX/aoe2_mcgeniescx/types.py
 */

export type GameEra = "aoe" | "aok" | "aoc" | "hd" | "de";

const AOK_FORMATS = new Set(["1.18", "1.19", "1.20"]);
/** First AoK container minor (genie-scx is_aok); "1.XX" with XX < 18 → Age of Empires I era. */
const AOK_MIN_CONTAINER_MINOR = 18;
/** Legacy ceiling; container minor strictly above this → DE (matches is_definitive_edition_container_format). */
const LEGACY_MAX_CONTAINER_MINOR = 22;
const DE_MIN_DATA = 1.28;
const AOC_MAX_DATA = 1.22;

/** Minor version from stored "1.XX" container string (XX as integer, not float). */
export function parseContainerFormatMinor(format: string): number | null {
  const m = /^1\.(\d)(\d)$/.exec(format.trim());
  if (!m) return null;
  return Number(m[1]) * 10 + Number(m[2]);
}

export function isPreAokContainerFormat(format: string): boolean {
  const minor = parseContainerFormatMinor(format);
  return minor != null && minor < AOK_MIN_CONTAINER_MINOR;
}

export function isDefinitiveEditionContainerFormat(format: string): boolean {
  const minor = parseContainerFormatMinor(format);
  return minor != null && minor > LEGACY_MAX_CONTAINER_MINOR;
}

/** SQLite: true when `col` is a "1.XX" container strictly below AoK (1.18). */
export function containerPreAokSql(col: string): string {
  return `(${col} GLOB '1.[0-9][0-9]' AND (CAST(SUBSTR(${col}, 3, 1) AS INTEGER) * 10 + CAST(SUBSTR(${col}, 4, 1) AS INTEGER)) < ${AOK_MIN_CONTAINER_MINOR})`;
}

/** SQLite: true when `col` is a "1.XX" container strictly newer than legacy max (1.22). */
export function containerDefinitiveEditionSql(col: string): string {
  return `(${col} GLOB '1.[0-9][0-9]' AND (CAST(SUBSTR(${col}, 3, 1) AS INTEGER) * 10 + CAST(SUBSTR(${col}, 4, 1) AS INTEGER)) > ${LEGACY_MAX_CONTAINER_MINOR})`;
}

export function deriveGameEra(input: {
  container_format?: string | null;
  data_version?: number | null;
  is_definitive_edition?: boolean | number | null;
}): GameEra | null {
  const format = (input.container_format ?? "").trim();
  const data = input.data_version;
  const isDe =
    input.is_definitive_edition === true ||
    input.is_definitive_edition === 1;

  if (isDe) {
    return "de";
  }

  if (data != null && Number.isFinite(data) && data >= DE_MIN_DATA) {
    return "de";
  }

  if (format && isDefinitiveEditionContainerFormat(format)) {
    return "de";
  }

  if (format && AOK_FORMATS.has(format)) {
    return "aok";
  }

  if (format === "1.21" && data != null && Number.isFinite(data) && data <= AOC_MAX_DATA) {
    return "aoc";
  }

  if (
    format === "1.21" ||
    (format === "1.22" && data != null && Number.isFinite(data) && data > AOC_MAX_DATA)
  ) {
    return "hd";
  }

  if (format && isPreAokContainerFormat(format)) {
    return "aoe";
  }

  return null;
}

/** D1 CASE body with `s.` column prefix. */
export const GAME_ERA_FROM_COLUMNS_SQL = `CASE
    WHEN s.is_definitive_edition = 1 THEN 'de'
    WHEN s.data_version IS NOT NULL AND s.data_version >= ${DE_MIN_DATA} THEN 'de'
    WHEN ${containerDefinitiveEditionSql("s.container_format")} THEN 'de'
    WHEN s.container_format IN ('1.18', '1.19', '1.20') THEN 'aok'
    WHEN s.container_format = '1.21' AND s.data_version IS NOT NULL AND s.data_version <= ${AOC_MAX_DATA} THEN 'aoc'
    WHEN s.container_format = '1.21' OR (s.container_format = '1.22' AND s.data_version IS NOT NULL AND s.data_version > ${AOC_MAX_DATA}) THEN 'hd'
    WHEN ${containerPreAokSql("s.container_format")} THEN 'aoe'
    ELSE NULL
  END`;

/** Browse list: derive when format/data/DE flag exist; else stored game_era. */
export const GAME_ERA_LIST_SQL = `CASE
    WHEN s.is_definitive_edition = 1 OR s.container_format IS NOT NULL OR s.data_version IS NOT NULL THEN ${GAME_ERA_FROM_COLUMNS_SQL}
    ELSE s.game_era
  END`;

export const GAME_ERA_LABEL: Record<GameEra, string> = {
  aoe: "AOE",
  aok: "AOK",
  aoc: "AOC",
  hd: "HD",
  de: "DE",
};
