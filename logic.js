// Next-strut logic, shared by the factory app and the admin page.
// Part 1 (shut to halfway) depends on the 150mm strut; part 2 (halfway to open) on the 100mm strut.

const RATINGS = {
  flies:  { label: 'Flies open (too strong)',      cls: 'r-flies',  pass: true },
  smooth: { label: 'Opens smoothly by itself',     cls: 'r-smooth', pass: true },
  slow:   { label: 'Slow, but gets there by itself', cls: 'r-slow', pass: true },
  stops:  { label: 'Stops part way, needs a hand', cls: 'r-stops',  pass: false },
  nomove: { label: "Won't move without a push",    cls: 'r-nomove', pass: false },
};
const RATING_ORDER = ['flies', 'smooth', 'slow', 'stops', 'nomove'];
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

// Works out where one half stands.
// `missing` = forces we hold in principle but haven't got to hand right now; they are skipped
// for suggestions only and stay on the stock list.
// Returns { lowPass, highFail, done, force, status }
//  status: 'start' | 'drop' | 'raise' | 'split' | 'done' | 'lowest' | 'nostock' | 'nothing' | 'limited'
function halfState(n, tests, stock, settings, missing = []) {
  const h = HALVES[n];
  const full = [...stock].sort((a, b) => a - b);
  const list = full.filter(f => !missing.includes(f));
  if (!list.length) return { lowPass: null, highFail: null, done: false, force: null, status: 'nothing' };
  const start = n === 1 ? settings.start_150 : settings.start_100;
  const drop = n === 1 ? settings.drop_150 : settings.drop_100;

  const passes = tests.filter(t => RATINGS[t[h.part]]?.pass).map(t => t[h.key]);
  const fails = tests.filter(t => RATINGS[t[h.part]] && !RATINGS[t[h.part]].pass).map(t => t[h.key]);
  const lowPass = passes.length ? Math.min(...passes) : null;
  // Ignore any fail at or above the lowest pass (a one-off oddity); the bracket is below it.
  const usableFails = lowPass === null ? fails : fails.filter(f => f < lowPass);
  const highFail = usableFails.length ? Math.max(...usableFails) : null;

  if (!tests.length) return { lowPass, highFail, done: false, force: closest(list, start), status: 'start' };

  // When no strut we have to hand fits, but one exists on the stock list: stop this half for now.
  const stopped = (fullOptions, fallback, status) => fullOptions.length
    ? { lowPass, highFail, done: true, force: fallback, status: 'limited' }
    : { lowPass, highFail, done: true, force: fallback, status };

  if (lowPass === null) {
    const higher = list.filter(s => s > highFail);
    if (!higher.length) return stopped(full.filter(s => s > highFail), full[full.length - 1], 'nostock');
    const target = (highFail + higher[higher.length - 1]) / 2;
    return { lowPass, highFail, done: false, force: closest(higher, target), status: 'raise' };
  }

  if (highFail === null) {
    const lower = list.filter(s => s < lowPass);
    if (!lower.length) return stopped(full.filter(s => s < lowPass), lowPass, 'lowest');
    return { lowPass, highFail, done: false, force: closest(lower, lowPass - drop), status: 'drop' };
  }

  const between = list.filter(s => s > highFail && s < lowPass);
  if (!between.length) return stopped(full.filter(s => s > highFail && s < lowPass), lowPass, 'done');
  return { lowPass, highFail, done: false, force: closest(between, (highFail + lowPass) / 2), status: 'split' };
}

// Overall suggestion for the next test on a lid.
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

function halfSummaryText(st) {
  const opened = st.lowPass !== null ? `${st.lowPass} N` : 'none yet';
  const didnt = st.highFail !== null ? `${st.highFail} N` : 'none yet';
  return { opened, didnt };
}

if (typeof module !== 'undefined') module.exports = { RATINGS, halfState, nextSuggestion, needsSeqQuestion };
