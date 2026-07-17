// js/search.js — item search logic (front-end, case-insensitive, multi-field)

import { normalizeText } from "./utils.js";

/**
 * Build lookup maps so search can match storage / section names too.
 * @param {Array} areas - workshop-map areas
 * @param {Array} structures - storage structures
 */
export function buildLocationIndex(areas, structures) {
  const storageNames = new Map();
  const areaStructure = new Map();
  for (const a of areas) {
    storageNames.set(a.id, a.name);
    areaStructure.set(a.id, a.structureId);
  }
  const sectionNames = new Map(); // key: `${structureId}::${sectionId}` -> name
  for (const s of structures) {
    for (const sec of s.sections || []) {
      sectionNames.set(`${s.id}::${sec.id}`, sec.name);
    }
  }
  return {
    storageName: (storageId) => storageNames.get(storageId) || storageId || "",
    sectionName: (storageId, sectionId) => {
      const structId = areaStructure.get(storageId);
      return sectionNames.get(`${structId}::${sectionId}`) || sectionId || "";
    },
  };
}

/**
 * Returns the list of searchable strings for one item.
 */
export function searchableFields(item, index) {
  const storageName = index.storageName(item.storageId);
  const sectionName = index.sectionName(item.storageId, item.sectionId);
  return [
    item.name,
    item.description,
    ...(item.tags || []),
    storageName,
    sectionName,
  ];
}

/**
 * Filter items by a free-text query. Empty query returns all items.
 * @param {Array} items
 * @param {string} query
 * @param {object} index - from buildLocationIndex
 */
export function filterItems(items, query, index) {
  const q = normalizeText(query);
  if (!q) return items.slice();
  const terms = q.split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = searchableFields(item, index).map(normalizeText).join(" ");
    return terms.every((t) => haystack.includes(t));
  });
}
