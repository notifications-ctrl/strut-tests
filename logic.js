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
// Known from earlier rooflights rather than tested (never saved, never shown as a rating):
const INFERRED = {
  good: { pass: true, good: true },   // a bigger rooflight opened well here, so this one will
  pass: { pass: true, good: null },   // a bigger rooflight at least opened here
  fail: { pass: false, good: false }, // a smaller rooflight didn't open here, so this one won't
  bad:  { pass: null, good: false },  // a smaller rooflight only struggled here, so this one won't open well
};
const RATING_ORDER = ['flies', 'smooth', 'slow', 'nomove'];
const SEQ = { yes: 'Yes', no: 'No', notsure: 'Not sure' };
const TEMPS = { cold: 'Cold', mild: 'Mild', warm: 'Warm' };

// Suggestions use these steps. 100 N on the 150 strut cuts tries the most; any stocked strut can still be fitted by hand.
const GRID_STEP = { 150: 100, 100: 50 };

const HALVES = {
  1: { key: 'force_150', part: 'part1', stroke: 150 },
  2: { key: 'force_100', part: 'part2', stroke: 100 },
};

function closest(list, target) {
  let best = list[0];
  for (const v of list) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}
function onGrid(stock, stroke) {
  const s = [...stock].sort((a, b) => a - b), step = GRID_STEP[stroke] || 50;
  return s.filter(f => (f - s[0]) % step === 0 || f === s[s.length - 1]);
}

// Summary of what real tries showed for one strut (used for history and for display).
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

// Where one strut stands. Two edges are searched, in this order:
//   1. "opens" vs "doesn't open" (struggling still counts as opening, so we keep going down)
//   2. "opens well" vs "struggles"
// `missing` = forces not to hand right now. `prior` = what earlier rooflights tell us (see priorsFor).
function halfState(n, tests, stock, settings, missing = [], prior = null) {
  const h = HALVES[n];
  const full = onGrid(stock, h.stroke);
  const list = full.filter(f => !missing.includes(f));
  const real = tests.filter(t => RATINGS[t[h.part]]).map(t => ({ f: t[h.key], r: RATINGS[t[h.part]], v: false }));
  const virt = consistentPriors(real, prior?.obs || []);
  const rated = real.concat(virt);
  const { lowPass, highFail, lowGood, highBad } = edges(rated);
  const struggles = [...new Set(real.filter(x => x.r.pass && !x.r.good).map(x => x.f))].sort((a, b) => a - b);
  const isReal = (f, test) => real.some(x => x.f === f && test(x.r));
  const inferred = {
    good: lowGood !== null && !isReal(lowGood, r => r.good === true),
    fail: highFail !== null && !isReal(highFail, r => r.pass === false),
  };
  const est = prior?.est || {};
  const start = est.good ?? (n === 1 ? settings.start_150 : settings.start_100);
  const keep = lowGood ?? lowPass;
  const base = { lowGood, struggles, highFail, lowPass, inferred, learnt: virt.length > 0 || est.good != null };
  const out = o => ({ ...base, ...o });

  if (!list.length) return out({ done: false, force: null, status: 'nothing' });
  if (!rated.length) return out({ done: false, force: closest(list, start), status: 'start' });

  const gap = (lo, hi) => {
    const avail = list.filter(s => s > lo && s < hi);
    if (avail.length) return { open: true, pick: closest(avail, (lo + hi) / 2) };
    return { open: false, paused: full.some(s => s > lo && s < hi) };
  };

  // ---- Edge 1: opens vs doesn't open ----
  if (lowPass === null) { // nothing has opened yet: go stronger
    const higher = list.filter(s => s > highFail);
    if (!higher.length) return out({ done: true, force: full[full.length - 1], status: full.some(s => s > highFail) ? 'paused' : 'toostrong' });
    const target = est.good > highFail ? est.good : (highFail + higher[higher.length - 1]) / 2;
    return out({ done: false, force: closest(higher, target), status: 'up' });
  }
  if (highFail === null) { // everything opened so far: drop, to just below where we expect it to stop opening
    const lower = list.filter(s => s < lowPass);
    if (!lower.length) {
      if (full.some(s => s < lowPass)) return out({ done: true, force: keep, status: 'paused' });
    } else {
      const drop = n === 1 ? settings.drop_150 : settings.drop_100;
      const target = est.open != null && est.open < lowPass ? est.open - 1 : lowPass - drop;
      return out({ done: false, force: closest(lower, target), status: 'down' });
    }
  } else {
    const g = gap(highFail, lowPass);
    if (g.open) return out({ done: false, force: g.pick, status: 'narrow' });
    if (g.paused) return out({ done: true, force: keep, status: 'paused' });
  }

  // ---- Edge 2: opens well vs struggles ----
  if (lowGood === null) { // it only ever struggled: go stronger to find where it opens well
    const top = Math.max(...rated.filter(x => x.r.pass === true).map(x => x.f));
    const higher = list.filter(s => s > top);
    if (!higher.length) return out({ done: true, force: keep, status: full.some(s => s > top) ? 'paused' : 'done' });
    const target = est.good > top ? est.good : (top + higher[higher.length - 1]) / 2;
    return out({ done: false, force: closest(higher, target), status: 'up' });
  }
  if (highBad === null) { // nothing below has been seen struggling yet: try lower
    const lower = list.filter(s => s < lowGood);
    if (lower.length) return out({ done: false, force: closest(lower, est.good != null && est.good < lowGood ? est.good : lowGood - 1), status: 'down' });
    if (full.some(s => s < lowGood)) return out({ done: true, force: keep, status: 'paused' });
  } else {
    const g = gap(highBad, lowGood);
    if (g.open) return out({ done: false, force: g.pick, status: 'narrow' });
    if (g.paused) return out({ done: true, force: keep, status: 'paused' });
  }
  return out({ done: true, force: keep, status: 'done' });
}

// Drop any inferred fact that clashes with a real try on this rooflight (real tries always win).
// If the inferred facts clash with each other, ignore them all for this strut.
function consistentPriors(real, obs) {
  const ok = o => {
    const r = INFERRED[o.kind];
    return !real.some(x =>
      (r.good === true && x.r.good === false && x.f >= o.f) ||
      (r.pass === true && x.r.pass === false && x.f >= o.f) ||
      (r.pass === false && x.r.pass === true && x.f <= o.f) ||
      (r.good === false && x.r.good === true && x.f <= o.f));
  };
  const kept = obs.filter(ok).map(o => ({ f: o.f, r: INFERRED[o.kind], v: true }));
  const e = edges(kept);
  if ((e.lowPass !== null && e.highFail !== null && e.highFail >= e.lowPass) ||
      (e.lowGood !== null && e.highBad !== null && e.highBad >= e.lowGood)) return [];
  return kept;
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
  const lam = 2, prior = [0, 1, 1, 0];
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

// Facts and estimates for `target` from `history` (other rooflights, each with .tests).
function priorsFor(target, history) {
  const pri = { 150: { obs: [], est: {} }, 100: { obs: [], est: {} } };
  if (!target || !target.length_mm || !target.width_mm) return pri;
  const pts = { 150: { good: [], open: [] }, 100: { good: [], open: [] } };
  for (const h of history || []) {
    if (!h || h.id === target.id || !h.tests || !h.tests.length || !h.length_mm || !h.width_mm) continue;
    const res = resultsOf(h);
    const lighter = lighterOrSame(target, h), heavier = lighterOrSame(h, target);
    for (const s of [150, 100]) {
      const e = res[s], o = pri[s].obs;
      if (lighter) {
        if (e.lowGood !== null) o.push({ f: e.lowGood, kind: 'good' });
        if (e.lowPass !== null) o.push({ f: e.lowPass, kind: 'pass' });
      }
      if (heavier) {
        if (e.highFail !== null) o.push({ f: e.highFail, kind: 'fail' });
        if (e.highBad !== null) o.push({ f: e.highBad, kind: 'bad' });
      }
      const pt = { L: h.length_mm, W: h.width_mm, A: h.anti_noise ? 1 : 0 };
      // Only use edges that were actually pinned down (a result on both sides).
      if (e.lowGood !== null && e.highBad !== null) pts[s].good.push({ ...pt, F: (e.lowGood + e.highBad) / 2 });
      if (e.lowPass !== null && e.highFail !== null) pts[s].open.push({ ...pt, F: (e.lowPass + e.highFail) / 2 });
    }
  }
  for (const s of [150, 100]) {
    const g = fitEstimate(pts[s].good, target), o = fitEstimate(pts[s].open, target);
    if (g) pri[s].est.good = g;
    if (o) pri[s].est.open = o;
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
    // Always at least one real try, even when earlier rooflights already pin the answer down.
    finished: s1.done && s2.done && tests.length > 0,
    overLimit: tests.length >= cfg.settings.max_tests,
  };
}

function needsSeqQuestion(f150, f100) { return f100 * 1.4 > f150; }

function rangeText(list) {
  if (!list.length) return '';
  return list.length === 1 ? `${list[0]}` : `${list[0]}–${list[list.length - 1]}`;
}

if (typeof module !== 'undefined') module.exports = { RATINGS, halfState, nextSuggestion, needsSeqQuestion, priorsFor, onGrid };
