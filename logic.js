// Next-strut logic, shared by the factory app and the admin page.
// Strut A = 150mm (shut to halfway), strut B = 100mm (halfway to open).
// Stored rating codes are kept from the first version: smooth = Opens, slow = Struggles, nomove = Doesn't open.

const RATINGS = {
  flies:  { label: 'Flies open',   icon: '⇈', cls: 'r-flies',  pass: true,  good: true },
  smooth: { label: 'Opens',        icon: '✓', cls: 'r-smooth', pass: true,  good: true },
  slow:   { label: 'Struggles',    icon: '~', cls: 'r-slow',   pass: true,  good: false },
  stops:  { label: 'Stops part way', icon: '…', cls: 'r-stops', pass: false, good: false }, // old code, not offered
  nomove: { label: "Doesn't open", icon: '✕', cls: 'r-nomove', pass: false, good: false },
};
const RATING_ORDER = ['flies', 'smooth', 'slow', 'nomove'];
const SEQ = { yes: 'Yes', no: 'No', notsure: 'Not sure' };
const TEMPS = { cold: 'Cold', mild: 'Mild', warm: 'Warm' };

const HALVES = {
  1: { key: 'force_150', part: 'part1', stroke: 150 },
  2: { key: 'force_100', part: 'part2', stroke: 100 },
};

function closest(list, target) {
  let best = list[0];
  for (const v of list) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}

// Where one strut stands. Two edges are searched, in this order:
//   1. "opens" vs "doesn't open" (struggling still counts as opening, so we keep going down)
//   2. "opens well" vs "struggles"
// `missing` = forces not to hand right now: skipped for suggestions, kept on the stock list.
// Returns { lowGood, struggles[], highFail, lowPass, done, force, status, phase }
function halfState(n, tests, stock, settings, missing = []) {
  const h = HALVES[n];
  const full = [...stock].sort((a, b) => a - b);
  const list = full.filter(f => !missing.includes(f));
  const start = n === 1 ? settings.start_150 : settings.start_100;
  const drop = n === 1 ? settings.drop_150 : settings.drop_100;

  const rated = tests.filter(t => RATINGS[t[h.part]]).map(t => ({ f: t[h.key], r: RATINGS[t[h.part]] }));
  const passes = rated.filter(x => x.r.pass).map(x => x.f);
  const lowPass = passes.length ? Math.min(...passes) : null;
  const fails = rated.filter(x => !x.r.pass && (lowPass === null || x.f < lowPass)).map(x => x.f);
  const highFail = fails.length ? Math.max(...fails) : null;
  const goods = rated.filter(x => x.r.good).map(x => x.f);
  const lowGood = goods.length ? Math.min(...goods) : null;
  const bads = rated.filter(x => !x.r.good && (lowGood === null || x.f < lowGood)).map(x => x.f);
  const highBad = bads.length ? Math.max(...bads) : null;
  const struggles = [...new Set(rated.filter(x => x.r.pass && !x.r.good).map(x => x.f))].sort((a, b) => a - b);
  const keep = lowGood ?? lowPass;
  const base = { lowGood, struggles, highFail, lowPass };
  const out = (o) => ({ ...base, ...o });

  if (!list.length) return out({ done: false, force: null, status: 'nothing', phase: 1 });
  if (!rated.length) return out({ done: false, force: closest(list, start), status: 'start', phase: 1 });

  // A gap is closed when no stock value sits inside it. If only struts not to hand sit inside, it's paused.
  const gap = (lo, hi) => {
    const avail = list.filter(s => s > lo && s < hi);
    if (avail.length) return { open: true, pick: closest(avail, (lo + hi) / 2) };
    return { open: false, paused: full.some(s => s > lo && s < hi) };
  };

  // ---- Edge 1: opens vs doesn't open ----
  if (lowPass === null) { // nothing has opened yet: go stronger
    const higher = list.filter(s => s > highFail);
    if (!higher.length) return out({ done: true, force: full[full.length - 1], status: full.some(s => s > highFail) ? 'paused' : 'toostrong', phase: 1 });
    return out({ done: false, force: closest(higher, (highFail + higher[higher.length - 1]) / 2), status: 'up', phase: 1 });
  }
  if (highFail === null) { // everything opened so far: drop
    const lower = list.filter(s => s < lowPass);
    if (!lower.length) {
      if (full.some(s => s < lowPass)) return out({ done: true, force: keep, status: 'paused', phase: 1 });
      // Our weakest strut still opens it; carry on to edge 2.
    } else {
      return out({ done: false, force: closest(lower, lowPass - drop), status: 'down', phase: 1 });
    }
  } else {
    const g = gap(highFail, lowPass);
    if (g.open) return out({ done: false, force: g.pick, status: 'narrow', phase: 1 });
    if (g.paused) return out({ done: true, force: keep, status: 'paused', phase: 1 });
  }

  // ---- Edge 2: opens well vs struggles ----
  if (lowGood === null) { // it only ever struggled: go stronger to find where it opens well
    const top = Math.max(...struggles);
    const higher = list.filter(s => s > top);
    if (!higher.length) return out({ done: true, force: keep, status: full.some(s => s > top) ? 'paused' : 'done', phase: 2 });
    return out({ done: false, force: closest(higher, (top + higher[higher.length - 1]) / 2), status: 'up', phase: 2 });
  }
  if (highBad !== null) {
    const g = gap(highBad, lowGood);
    if (g.open) return out({ done: false, force: g.pick, status: 'narrow', phase: 2 });
    if (g.paused) return out({ done: true, force: keep, status: 'paused', phase: 2 });
  }
  return out({ done: true, force: keep, status: 'done', phase: 2 });
}

// Overall suggestion for the next test on a rooflight.
function nextSuggestion(tests, cfg, missing = { 150: [], 100: [] }) {
  const s1 = halfState(1, tests, cfg.stock150, cfg.settings, missing[150] || []);
  const s2 = halfState(2, tests, cfg.stock100, cfg.settings, missing[100] || []);
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

if (typeof module !== 'undefined') module.exports = { RATINGS, halfState, nextSuggestion, needsSeqQuestion };
