// Thin index helper for the SLD mapping file.
//
// Input shape (from /gif/sourcefiles/sld/sld_mapping.json):
//   { "a_alfred_deathA_x2": { "unit": "alfred", "action": "deathA", "zoom": "x2" }, ... }
//
// We flip it into Map<unit, Map<action, Set<zoom>>> for fast cascading
// unit -> action -> zoom -> key lookups. The filename prefix ('a_' / 'u_' /
// 'b_' etc. - unit type) is part of the key and not derivable from the
// unit/action/zoom trio, so we keep the original key alongside.
//
// Keys look like `<prefix>_<unit>_<action>_<zoom>` where `<prefix>` can
// itself contain underscores (e.g. 'u_cav_warwagon_elite_walkA_x2'). We
// preserve the original keys in a second map so resolveKey() never has to
// rebuild strings.

export function buildIndex(mapping) {
  const byUnit = new Map();
  const keyByTriple = new Map(); // "unit|action|zoom" -> filename key

  for (const [key, entry] of Object.entries(mapping)) {
    if (!entry) continue;
    const unit = String(entry.unit || "").trim();
    const action = String(entry.action || "").trim();
    const zoom = String(entry.zoom || "").trim();
    if (!unit || !action || !zoom) continue;

    let actions = byUnit.get(unit);
    if (!actions) { actions = new Map(); byUnit.set(unit, actions); }
    let zooms = actions.get(action);
    if (!zooms) { zooms = new Set(); actions.set(action, zooms); }
    zooms.add(zoom);

    keyByTriple.set(unit + "|" + action + "|" + zoom, key);
  }

  const units = Array.from(byUnit.keys()).sort(function (a, b) {
    return a.localeCompare(b);
  });

  return { byUnit, keyByTriple, units };
}

export function listActions(index, unit) {
  const actions = index.byUnit.get(unit);
  if (!actions) return [];
  return Array.from(actions.keys()).sort(function (a, b) { return a.localeCompare(b); });
}

export function listZooms(index, unit, action) {
  const actions = index.byUnit.get(unit);
  if (!actions) return [];
  const zooms = actions.get(action);
  if (!zooms) return [];
  return Array.from(zooms).sort();
}

export function resolveKey(index, unit, action, zoom) {
  if (!unit || !action || !zoom) return null;
  return index.keyByTriple.get(unit + "|" + action + "|" + zoom) || null;
}
