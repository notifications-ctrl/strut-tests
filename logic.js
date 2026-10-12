// Next-strut logic, shared by the factory app and the admin page.
// Strut 1 = 150mm (shut to halfway), strut 2 = 100mm (halfway to open).
// Stored rating codes are kept from the first version: smooth = Opens, slow = Struggles, nomove = Doesn't open.

const RATINGS = {
  flies:  { label: 'Flies open',     icon: '⇈', cls: 'r-flies',  pass: true,  good: true },
  smooth: { label: 'Opens',          icon: '✓', cls: 'r-smooth', pass: true,  good: true },
  slow:   { label: 'Struggles',      icon: '~', cls: 'r-slow',   pass: true,  good: false },
  stops:  { label: 'Stops part way', icon: '…', cls: 'r-stops',  pass: false, good: false }, // old code, not offered
  nomove: { label: "Doesn't open",   icon: '✕', cls: 'r-nomove', pass: false, good: false },
};
const RATING_ORDER = ['flies', 'smooth', 'slow', 'nomove'];
const SEQ = { yes: 'Yes', no: 'No', notsure: 'Not sure' };
const TEMPS = { cold: 'Cold', mild: 'Mild', warm: 'Warm' };

// Every strut is searched to the nearest 50 N stocked step.
const HALVES = {
  1: { key: 'force_150', part: 'part1', stroke: 150 },
  2: { key: 'force_100', part: 'part2', stroke: 100 },
};

function closest(list, target) {
  let best = list[0];
  for (const v of list) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}
function onGrid(stock) { return [...stock].sort((a, b) => a - b); }

// Summary of what tries showed for one strut.
function edges(rated) {
  const passes = rated.filter(x => x.r.pass === true).map(x => x.f);
  const lowPass = passes.length ? Math.min(...passes) : null;
  const fails = rated.filter(x => x.r.pass === false && (lowPass === null || x.f < lowPass)).map(x => x.f);
  const highFail = fails.length ? Math.max(...fails) : null;
  const goods = rated.filter(x => x.r.good === true).map(x => x.f);
  const lowGood = goods.length ? Math.min(...goods) : null;
  const bads = rated.filter(x => x.r.good === false && (lowGood === null || x.f < lowGood)).map(x => x.f);
  const highBad = bads.length ? Math.max(...bads) : null;
  return { lowPass, highFail, lowGood, highBad };
}

// Where one strut stands. Results come ONLY from real tries on this rooflight.
// Earlier rooflights (`prior`) only decide which strut to try next.
// Two edges are found to the nearest stocked step, in this order:
//   1. "opens" vs "doesn't open" (struggling still counts as opening, so we keep going down)
//   2. "opens well" vs "struggles"
function halfState(n, tests, stock, settings, missing = [], prior = null) {
  const h = HALVES[n];
  const full = onGrid(stock);
  const list = full.filter(f => !missing.includes(f));
  const rated = tests.filter(t => RATINGS[t[h.part]]).map(t => ({ f: t[h.key], r: RATINGS[t[h.part]] }));
  const { lowPass, highFail, lowGood, highBad } = edges(rated);
  const struggles = [...new Set(rated.filter(x => x.r.pass && !x.r.good).map(x => x.f))].sort((a, b) => a - b);
  const est = prior?.est || {}, hint = prior?.hint || {};
  // Expected edges for this size: from the fitted estimate, else from bigger/smaller rooflights.
  const expGood = est.good ?? hint.hi ?? null;          // first strut expected to open it well
  const expOpen = est.open ?? (hint.lo != null ? hint.lo + 1 : null); // first strut expected to open it at all
  const keep = lowGood ?? lowPass;
  const base = { lowGood, struggles, highFail, lowPass, learnt: expGood != null || expOpen != null };
  const out = o => ({ ...base, ...o });

  if (!list.length) return out({ done: false, force: null, status: 'nothing' });
  if (!rated.length) {
    // First try: where we expect it to open well (never above what opened a bigger rooflight well).
    let t = expGood ?? (n === 1 ? settings.start_150 : settings.start_100);
    if (hint.hi != null) t = Math.min(t, hint.hi);
    return out({ done: false, force: closest(list, t), status: 'start' });
  }

  // Pick inside a gap: aim at the expected edge if it's inside the gap, otherwise halve the gap.
  // `exp` is the first value expected to be on the upper side, so test the step just below it first.
  const gap = (lo, hi, exp) => {
    const avail = list.filter(s => s > lo && s < hi);
    if (!avail.length) return { open: false, paused: full.some(s => s > lo && s < hi) };
    if (exp != null && exp > lo && exp <= hi) {
      const below = avail.filter(s => s < exp);
      return { open: true, pick: below.length ? below[below.length - 1] : avail[0] };
    }
    return { open: true, pick: closest(avail, (lo + hi) / 2) };
  };

  // ---- Edge 1: opens vs doesn't open ----
  if (lowPass === null) { // nothing has opened yet: go stronger
    const higher = list.filter(s => s > highFail);
    if (!higher.length) return out({ done: true, force: full[full.length - 1], status: full.some(s => s > highFail) ? 'paused' : 'toostrong' });
    const cap = hint.hi != null && hint.hi > highFail ? hint.hi : higher[higher.length - 1]; // never above what opened a bigger rooflight
    const t = expGood != null && expGood > highFail ? Math.min(expGood, cap) : (highFail + cap) / 2;
    return out({ done: false, force: closest(higher, t), status: 'up' });
  }
  if (highFail === null) { // everything opened so far: drop to just below where we expect it to stop opening
    const lower = list.filter(s => s < lowPass);
    if (!lower.length) {
      if (full.some(s => s < lowPass)) return out({ done: true, force: keep, status: 'paused' });
    } else {
      const drop = n === 1 ? settings.drop_150 : settings.drop_100;
      if (expOpen != null && expOpen <= lowPass) {
        const below = lower.filter(s => s < expOpen);
        return out({ done: false, force: below.length ? below[below.length - 1] : lower[0], status: 'down' });
      }
      return out({ done: false, force: closest(lower, lowPass - drop), status: 'down' });
    }
  } else {
    const g = gap(highFail, lowPass, expOpen);
    if (g.open) return out({ done: false, force: g.pick, status: 'narrow' });
    if (g.paused) return out({ done: true, force: keep, status: 'paused' });
  }

  // ---- Edge 2: opens well vs struggles ----
  if (lowGood === null) { // it only ever struggled: go stronger to find where it opens well
    const top = Math.max(...rated.filter(x => x.r.pass === true).map(x => x.f));
    const higher = list.filter(s => s > top);
    if (!higher.length) return out({ done: true, force: keep, status: full.some(s => s > top) ? 'paused' : 'done' });
    const cap = hint.hi != null && hint.hi > top ? hint.hi : higher[higher.length - 1];
    const t = expGood != null && expGood > top ? Math.min(expGood, cap) : (top + cap) / 2;
    return out({ done: false, force: closest(higher, t), status: 'up' });
  }
  if (highBad === null) { // nothing below has struggled or failed: our weakest strut still opens it well
    const lower = list.filter(s => s < lowGood);
    if (lower.length) return out({ done: false, force: lower[lower.length - 1], status: 'down' });
    if (full.some(s => s < lowGood)) return out({ done: true, force: keep, status: 'paused' });
  } else {
    const g = gap(highBad, lowGood, expGood);
    if (g.open) return out({ done: false, force: g.pick, status: 'narrow' });
    if (g.paused) return out({ done: true, force: keep, status: 'paused' });
  }
  return out({ done: true, force: keep, status: 'done' });
}

// ---------- learning from earlier rooflights ----------
// Assumption: a rooflight that is no longer, no wider and no heavier on anti-noise never needs stronger struts.
function lighterOrSame(a, b) {
  return a.length_mm <= b.length_mm && a.width_mm <= b.width_mm && (a.anti_noise ? 1 : 0) <= (b.anti_noise ? 1 : 0);
}

// What one rooflight's real tries showed, for both struts.
function resultsOf(rooflight) {
  const r = {};
  for (const n of [1, 2]) {
    const h = HALVES[n];
    r[h.stroke] = edges((rooflight.tests || []).filter(t => RATINGS[t[h.part]]).map(t => ({ f: t[h.key], r: RATINGS[t[h.part]] })));
  }
  return r;
}

// Estimates the forces for a new size from earlier results: log F = a + p·log(length) + q·log(width) + k·antiNoise.
// It starts by assuming force scales with area (p = q = 1) and moves away from that as real results come in.
function fitEstimate(points, target) {
  if (!points.length) return null;
  const X = points.map(pt => [1, Math.log(pt.L), Math.log(pt.W), pt.A]);
  const y = points.map(pt => Math.log(pt.F));
  const lam = 0.5, prior = [0, 1, 1, 0];
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
  for (let i = 0; i < X.length; i++) for (let j = 0; j < 4; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < 4; k++) A[j][k] += X[i][j] * X[i][k]; }
  for (let j = 1; j < 4; j++) { A[j][j] += lam; b[j] += lam * prior[j]; }
  A[0][0] += 1e-9;
  // Solve A·w = b (Gaussian elimination)
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; }
  }
  const w = M.map((row, i) => row[4] / row[i]);
  return Math.exp(w[0] + w[1] * Math.log(target.length_mm) + w[2] * Math.log(target.width_mm) + w[3] * (target.anti_noise ? 1 : 0));
}

// Guidance for `target` from `history` (other rooflights, each with .tests). Never used as a result.
//  hint.hi = lowest strut that opened a no-smaller rooflight well (don't start above this)
//  hint.lo = highest strut that failed to open a no-bigger rooflight (expect this to fail too)
//  est.good / est.open = fitted estimate of the two edges for this size
function priorsFor(target, history) {
  const pri = { 150: { hint: {}, est: {} }, 100: { hint: {}, est: {} } };
  if (!target || !target.length_mm || !target.width_mm) return pri;
  const pts = { 150: { good: [], open: [] }, 100: { good: [], open: [] } };
  for (const h of history || []) {
    if (!h || h.id === target.id || !h.tests || !h.tests.length || !h.length_mm || !h.width_mm) continue;
    const res = resultsOf(h);
    const lighter = lighterOrSame(target, h), heavier = lighterOrSame(h, target);
    for (const s of [150, 100]) {
      const e = res[s], k = pri[s].hint;
      if (lighter && e.lowGood !== null) k.hi = Math.min(k.hi ?? Infinity, e.lowGood);
      if (heavier && e.highFail !== null) k.lo = Math.max(k.lo ?? -Infinity, e.highFail);
      const pt = { L: h.length_mm, W: h.width_mm, A: h.anti_noise ? 1 : 0 };
      // Only edges that were pinned down (a result on both sides) feed the estimate.
      if (e.lowGood !== null && e.highBad !== null) pts[s].good.push({ ...pt, F: (e.lowGood + e.highBad) / 2 });
      if (e.lowPass !== null && e.highFail !== null) pts[s].open.push({ ...pt, F: (e.lowPass + e.highFail) / 2 });
    }
  }
  for (const s of [150, 100]) {
    const k = pri[s].hint;
    if (k.hi != null && k.lo != null && k.lo >= k.hi) { delete k.hi; delete k.lo; } // earlier results disagree: ignore
    let g = fitEstimate(pts[s].good, target), o = fitEstimate(pts[s].open, target);
    if (g != null && k.hi != null) g = Math.min(g, k.hi);   // never expect higher than a bigger rooflight needed
    if (o != null && k.lo != null) o = Math.max(o, k.lo + 1);
    if (g != null && o != null && o > g) o = g;
    if (g != null) pri[s].est.good = g;
    if (o != null) pri[s].est.open = o;
  }
  return pri;
}

// Overall suggestion for the next test on a rooflight.
function nextSuggestion(tests, cfg, missing = { 150: [], 100: [] }, priors = null) {
  const s1 = halfState(1, tests, cfg.stock150, cfg.settings, missing[150] || [], priors?.[150]);
  const s2 = halfState(2, tests, cfg.stock100, cfg.settings, missing[100] || [], priors?.[100]);
  return {
    h1: s1, h2: s2,
    force_150: s1.force,
    force_100: s2.force,
    finished: s1.done && s2.done,
    overLimit: tests.length >= cfg.settings.max_tests,
  };
}

function needsSeqQuestion(f150, f100) { return f100 * 1.4 > f150; }

function rangeText(list) {
  if (!list.length) return '';
  return list.length === 1 ? `${list[0]}` : `${list[0]}–${list[list.length - 1]}`;
}

if (typeof module !== 'undefined') module.exports = { RATINGS, halfState, nextSuggestion, needsSeqQuestion, priorsFor, onGrid };
