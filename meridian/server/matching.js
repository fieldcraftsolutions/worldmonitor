// Explainable candidate matching. The output is a *candidate for analyst review*,
// never a determination. Every candidate carries the reasons it surfaced, the
// conflicting signals, and the data gaps that limit the comparison.
//
// Known limits (documented, not hidden): no transliteration tables, no phonetic
// matching, no date-of-birth/nationality features, thresholds are untuned
// heuristics and have not been evaluated against a labelled test set.

export const MATCH_CONFIG = {
  surfaceThreshold: 0.8,   // below this a list entry is not surfaced
  strongThreshold: 0.92,   // "strong_candidate" is still only a candidate
  version: 'heuristic-0.1',
};

const LEGAL_FORMS = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'sa', 'sarl', 'gmbh', 'ag', 'bv', 'nv', 'plc', 'srl', 'spa', 'oao', 'ooo', 'ao', 'zao',
  'jsc', 'pjsc', 'as', 'ab', 'oy', 'pte', 'pty', 'lp', 'llp', 'fze', 'fzco', 'sas',
]);

export function normalizeName(s) {
  const tokens = String(s ?? '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ').filter(Boolean);
  const core = tokens.filter((t) => !LEGAL_FORMS.has(t));
  return (core.length ? core : tokens);
}

export function normalizeIdentifier(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function jaro(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0; let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (m / a.length + m / b.length + (m - t / 2) / m) / 3;
}

export function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return j + l * 0.1 * (1 - j);
}

// Token-aware name similarity in [0,1] between two token arrays.
export function nameSimilarity(ta, tb) {
  if (!ta.length || !tb.length) return 0;
  const sorted = (t) => [...t].sort().join(' ');
  const jw = jaroWinkler(sorted(ta), sorted(tb));
  // Fuzzy token overlap: a token counts as shared if it is near-identical to one on the other side.
  const shared = ta.filter((x) => tb.some((y) => jaroWinkler(x, y) >= 0.9)).length;
  const dice = (2 * shared) / (ta.length + tb.length);
  return 0.5 * jw + 0.5 * dice;
}

function namesOf(rec) {
  return [rec.name, ...(rec.aliases || [])].filter(Boolean).map((n) => ({ raw: n, tokens: normalizeName(n) }));
}

function bestNamePair(entityNames, listNames) {
  let best = { score: 0 };
  for (const e of entityNames) {
    for (const l of listNames) {
      const score = nameSimilarity(e.tokens, l.tokens);
      if (score > best.score) best = { score, entityName: e.raw, listName: l.raw };
    }
  }
  return best;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * @param entity {name, aliases[], identifiers[{type,value}], jurisdiction}
 * @param listEntries [{id, name, aliases[], identifiers[], jurisdiction, program, list_id}]
 */
export function screenEntity(entity, listEntries, config = MATCH_CONFIG) {
  const entityNames = namesOf(entity);
  const candidates = [];

  for (const entry of listEntries) {
    const features = [];
    const conflicts = [];
    const gaps = [];

    const pair = bestNamePair(entityNames, namesOf(entry));
    let score = pair.score;
    let surfaceScore = pair.score; // conflicts never lower this: see below
    features.push({
      code: 'name_similarity',
      label: 'Name similarity',
      detail: `"${pair.entityName}" vs listed "${pair.listName}" — ${pct(pair.score)} after normalization (legal-form words and punctuation removed)`,
    });

    // identifiers
    const entIds = (entity.identifiers || []).map((i) => ({ ...i, n: normalizeIdentifier(i.value) }));
    const listIds = (entry.identifiers || []).map((i) => ({ ...i, n: normalizeIdentifier(i.value) }));
    const exact = entIds.filter((e) => listIds.some((l) => l.type === e.type && l.n === e.n));
    const differing = entIds.filter((e) => listIds.some((l) => l.type === e.type) && !listIds.some((l) => l.type === e.type && l.n === e.n));
    if (exact.length) {
      score = Math.max(score, 0.95);
      surfaceScore = Math.max(surfaceScore, 0.95);
      features.push({ code: 'identifier_exact', label: 'Identifier agreement', detail: `Same ${exact.map((e) => `${e.type} ${e.value}`).join(', ')} on both records` });
    }
    if (differing.length) {
      score -= 0.1;
      conflicts.push({ code: 'identifier_conflict', label: 'Identifier differs', detail: `Same identifier type with a different value: ${differing.map((e) => `${e.type} ${e.value}`).join(', ')}. May indicate a different entity, or a data error.` });
    }
    if (!entIds.length) gaps.push({ code: 'entity_no_identifiers', label: 'No identifiers on your record', detail: 'Identifier comparison was not possible. Collect registration/tax/IMO numbers before disposition.' });
    else if (!listIds.length) gaps.push({ code: 'list_no_identifiers', label: 'No identifiers on the list entry', detail: 'The listed record carries no identifiers to compare against.' });

    // jurisdiction
    if (entity.jurisdiction && entry.jurisdiction) {
      if (norm(entity.jurisdiction) === norm(entry.jurisdiction)) {
        score += 0.05;
        features.push({ code: 'jurisdiction_agree', label: 'Jurisdiction agrees', detail: `Both records: ${entity.jurisdiction}` });
      } else {
        score -= 0.08;
        conflicts.push({ code: 'jurisdiction_conflict', label: 'Jurisdiction differs', detail: `Your record: ${entity.jurisdiction}; listed: ${entry.jurisdiction}. Entities can operate or be registered in several jurisdictions.` });
      }
    } else {
      gaps.push({ code: 'jurisdiction_missing', label: 'Jurisdiction missing', detail: 'Jurisdiction could not be compared on at least one record.' });
    }

    // Conflicting signals lower the *displayed* score/band, but a candidate is
    // surfaced on its name/identifier evidence alone. Entities legitimately carry
    // several identifiers and list data contains errors, so a conflict must never
    // silently drop a candidate; only an analyst may dismiss it.
    score = Math.max(0, Math.min(1, score));
    if (surfaceScore < config.surfaceThreshold) continue;

    candidates.push({
      list_entry_id: entry.id,
      list_id: entry.list_id,
      listed_name: entry.name,
      listed_program: entry.program ?? null,
      listed_jurisdiction: entry.jurisdiction ?? null,
      listed_aliases: entry.aliases ?? [],
      listed_identifiers: entry.identifiers ?? [],
      matched_entity_name: pair.entityName,
      matched_list_name: pair.listName,
      score: Math.round(score * 1000) / 1000,
      name_score: Math.round(pair.score * 1000) / 1000,
      band: score >= config.strongThreshold ? 'strong_candidate' : 'possible_candidate',
      features, conflicts, gaps,
      review_status: 'pending_review',
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
