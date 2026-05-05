// Thin index helper for the SLP manifest shape.
//
// Input shape (from /api/gif/slp/manifest):
//   { units: { [unit]: { [action]: slpIdNumber } }, total }
//
// We flip it into Map<unit, Map<action, number>> for fast unit -> action -> id lookups.

export function buildIndex(manifestUnits) {
  const byUnit = new Map();
  for (const unit of Object.keys(manifestUnits || {})) {
    const actions = manifestUnits[unit] || {};
    const actionMap = new Map();
    for (const action of Object.keys(actions)) {
      const id = actions[action];
      if (typeof id === "number") actionMap.set(action, id);
    }
    if (actionMap.size > 0) byUnit.set(unit, actionMap);
  }
  const units = Array.from(byUnit.keys()).sort(function (a, b) {
    return a.localeCompare(b);
  });
  return { byUnit, units };
}

export function listActions(index, unit) {
  const actions = index.byUnit.get(unit);
  if (!actions) return [];
  return Array.from(actions.keys()).sort(function (a, b) { return a.localeCompare(b); });
}

export function resolveId(index, unit, action) {
  if (!index || !unit || !action) return null;
  const actions = index.byUnit.get(unit);
  if (!actions) return null;
  return actions.has(action) ? actions.get(action) : null;
}

