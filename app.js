// BSD strut test app (factory phones).
const $ = sel => document.querySelector(sel);
const app = () => $('#app');

// ---------- local storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('st_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('st_' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('st_' + k); } catch {} },
};
let cfg = store.get('cfg', null);           // testers, stock, settings
let lids = store.get('lids', {});           // rooflight id -> rooflight + tests
let queue = store.get('queue', []);         // items waiting to send
let lastSendError = null;
let history = store.get('hist', []);     // earlier rooflights (any phone), for learning
const saveLids = () => store.set('lids', lids);
const saveQueue = () => { store.set('queue', queue); showPending(); };

function tester() { const id = store.get('tester', null); return cfg?.testers.find(t => t.id === id) || null; }
function testerName(id) { return cfg?.testers.find(t => t.id === id)?.name || ''; }

// ---------- sending ----------
// The banner only appears if something has been waiting over 5 seconds (or there's no signal),
// so it doesn't flash up on every normal save.
let waitingSince = null;
function showPending() {
  const el = $('#pending');
  if (!queue.length) { waitingSince = null; el.classList.add('hidden'); return; }
  if (!waitingSince) { waitingSince = Date.now(); setTimeout(showPending, 5200); }
  if (navigator.onLine && !lastSendError && Date.now() - waitingSince < 5000) return;
  const n = queue.filter(q => q.kind === 'test').length || queue.length;
  el.classList.remove('hidden');
  el.textContent = `⟳ ${n} waiting to send`;
  el.title = lastSendError || (navigator.onLine ? '' : 'No signal');
}

let flushing = false;
async function flush() {
  const pin = store.get('pin', null);
  if (flushing || !queue.length || !pin) { showPending(); return; }
  flushing = true;
  try {
    while (queue.length) {
      const item = queue[0];
      const fn = item.kind === 'test' ? 'app_save_test' : 'app_save_rooflight';
      await rpc(fn, { p_pin: pin, p: item.data });
      queue.shift(); lastSendError = null; saveQueue();
    }
  } catch (e) {
    if (e instanceof PinError) { store.del('pin'); showPin('PIN changed'); }
    else if (e.server) lastSendError = e.message.slice(0, 80);
    else lastSendError = null; // no signal: try again later
  } finally { flushing = false; showPending(); }
}
window.addEventListener('online', flush);
setInterval(flush, 30000);
function enqueue(kind, data) { queue.push({ kind, data }); saveQueue(); flush(); }

// ---------- helpers ----------
function screen(html, keepScroll) { app().innerHTML = html; if (!keepScroll) window.scrollTo(0, 0); }
function on(sel, fn) { document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn)); }
function sizeText(l) { return `${l.length_mm} × ${l.width_mm}`; }
function serverRooflight(l) { const { tests, missing, keepGoing, ...r } = l; return r; }
// Earlier rooflights to learn from: everything downloaded, plus anything on this phone not yet sent.
// Test rooflights (SIM-, TRY-, TEST-) only learn from other test rooflights; real ones only from real ones.
const isTestRef = ref => /^(SIM|TRY|TEST)-/i.test(ref || '');
function priorsOf(l) {
  const byId = {};
  for (const h of history) byId[h.id] = h;
  for (const x of Object.values(lids)) if (x.tests.length) byId[x.id] = x;
  delete byId[l.id];
  const same = Object.values(byId).filter(h => h.reference !== undefined && isTestRef(h.reference) === isTestRef(l.reference));
  return priorsFor(l, same);
}
function missingOf(l) { if (!l.missing) l.missing = { 150: [], 100: [] }; return l.missing; }
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
function home(show) { $('#homeBtn').style.visibility = show ? 'visible' : 'hidden'; }

// ---------- PIN (keypad) ----------
function showPin(msg) {
  home(false);
  let pin = '';
  screen(`
    <div class="center"><div style="font-size:52px;margin-top:10px">🔒</div><h1>Factory PIN</h1></div>
    <div class="dots" id="dots"></div>
    <p class="err center" id="err">${esc(msg || '')}</p>
    <div class="pad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
      <button data-k="del">⌫</button><button data-k="0">0</button><button data-k="ok" class="k-ok">✓</button>
    </div>`);
  const dots = () => { $('#dots').innerHTML = '<i></i>'.repeat(pin.length); };
  on('[data-k]', async e => {
    const k = e.currentTarget.dataset.k;
    if (k === 'del') { pin = pin.slice(0, -1); return dots(); }
    if (k !== 'ok') { if (pin.length < 12) pin += k; $('#err').textContent = ''; return dots(); }
    if (!pin) return;
    $('#err').textContent = '…';
    try {
      const data = await rpc('app_config', { p_pin: pin });
      store.set('pin', pin); cfg = data; store.set('cfg', cfg); lastSendError = null;
      flush(); start();
    } catch (err) {
      pin = ''; dots();
      $('#err').textContent = err instanceof PinError ? 'Wrong PIN' : err instanceof LockedError ? 'Locked. Wait 10 min.' : 'Needs signal the first time';
    }
  });
}

// ---------- refresh settings & open rooflights from server ----------
async function refresh() {
  const pin = store.get('pin', null);
  if (!pin || !navigator.onLine) return;
  try {
    const data = await rpc('app_config', { p_pin: pin });
    cfg = data; store.set('cfg', cfg);
    try { const h = await rpc('app_history', { p_pin: pin }); history = h.rooflights || []; store.set('hist', history); }
    catch (e) { if (e instanceof PinError) throw e; } // older database without app_history: carry on without learning
    const open = await rpc('app_open_rooflights', { p_pin: pin });
    const serverIds = new Set();
    for (const r of open.rooflights) {
      serverIds.add(r.id);
      const local = lids[r.id];
      if (!local) { lids[r.id] = r; continue; }
      const ids = new Set(local.tests.map(t => t.id));
      for (const t of r.tests) if (!ids.has(t.id)) local.tests.push(t);
      local.tests.sort((a, b) => a.test_no - b.test_no || a.tested_at.localeCompare(b.tested_at));
    }
    // Finished elsewhere (or deleted): drop local copies with nothing waiting to send.
    const waiting = new Set(queue.map(q => q.kind === 'test' ? q.data.rooflight_id : q.data.id));
    for (const id of Object.keys(lids)) {
      if (!serverIds.has(id) && !waiting.has(id) && !lids[id].finished) delete lids[id];
    }
    saveLids();
  } catch (e) {
    if (e instanceof PinError) { store.del('pin'); showPin('PIN changed'); throw e; }
  }
}

// ---------- start / who / home ----------
async function start() {
  showPending();
  if (!store.get('pin', null) || !cfg) return showPin();
  if (!tester()) return showWho();
  showHome();
  try { await refresh(); if ($('#homeScreen')) showHome(); } catch {}
}

function showWho() {
  home(false);
  screen(`
    <h1>Who's testing?</h1>
    ${cfg.testers.length ? cfg.testers.map(t => `<button class="item" data-id="${t.id}"><span class="avatar">${esc(t.name[0])}</span><span class="t"><b>${esc(t.name)}</b></span><span class="go-arrow">›</span></button>`).join('')
      : '<div class="card">No names yet. Ask Mark to add yours.</div>'}`);
  on('[data-id]', e => { store.set('tester', e.currentTarget.dataset.id); start(); });
}

function chipsFor(l) {
  const s = nextSuggestion(l.tests, cfg, missingOf(l), priorsOf(l));
  const c = (name, h) => `<span class="chip ${h.done ? 'ok' : ''}">${name} ${h.done ? '✓' : '…'}</span>`;
  return c('150', s.h1) + c('100', s.h2);
}

function showHome() {
  home(false);
  const me = tester();
  const open = Object.values(lids).filter(l => !l.finished).sort((a, b) => b.created_at.localeCompare(a.created_at));
  screen(`
    <div id="homeScreen">
      <div class="row" style="align-items:center"><h1 style="margin:6px 0">Hi ${esc(me.name)} 👋</h1>
        <button class="btn ghost" id="changeName" style="flex:0 0 auto;width:auto;margin:0">Not me</button></div>
      <button class="btn blue" id="newTest"><span class="big">＋</span> New rooflight</button>
      ${open.map(l => `<button class="item" data-lid="${l.id}">
        <span class="t"><b>${esc(l.reference)}</b><span class="muted">${sizeText(l)} · ${l.tests.length} tries</span><br>${chipsFor(l)}</span>
        <span class="go-arrow">›</span></button>`).join('')}
    </div>`);
  on('#newTest', showDetails);
  on('[data-lid]', e => showTest(e.currentTarget.dataset.lid));
  on('#changeName', () => { store.del('tester'); showWho(); });
}

// ---------- new rooflight ----------
function showDetails() {
  home(true);
  let anti = false;
  screen(`
    <h1>New rooflight</h1>
    <label class="field" for="ref">Reference</label>
    <input id="ref" type="text" autocomplete="off" autocapitalize="characters">
    <div class="row">
      <div><label class="field" for="len">Length mm</label><input id="len" type="text" inputmode="numeric" pattern="[0-9]*"></div>
      <div><label class="field" for="wid">Width mm</label><input id="wid" type="text" inputmode="numeric" pattern="[0-9]*"></div>
    </div>
    <label class="field">Anti-noise</label>
    <div class="seg" id="an"><button class="sel" data-v="0">No</button><button data-v="1">Yes</button></div>
    <p class="err" id="err"></p>
    <button class="btn go" id="go">Start ›</button>`);
  on('#an button', e => { anti = e.currentTarget.dataset.v === '1'; document.querySelectorAll('#an button').forEach(b => b.classList.toggle('sel', b === e.currentTarget)); });
  on('#go', () => {
    const ref = $('#ref').value.trim();
    const len = parseInt($('#len').value, 10), wid = parseInt($('#wid').value, 10);
    if (!ref) return $('#err').textContent = 'Reference?';
    if (!(len > 0) || !(wid > 0)) return $('#err').textContent = 'Length and width?';
    const l = { id: uuid(), reference: ref, length_mm: len, width_mm: wid, anti_noise: anti, pairs: 2, lid: 1,
                tester_id: tester().id, finished: false, created_at: new Date().toISOString(), tests: [] };
    lids[l.id] = l; saveLids();
    enqueue('rooflight', serverRooflight(l));
    showTest(l.id);
  });
}

// ---------- the test card ----------
// One screen per try: what to fit, rate it, save. Then it shows the next struts to fit.
function trackHtml(stroke, h, l, next) {
  const stock = stroke === 150 ? cfg.stock150 : cfg.stock100;
  const key = stroke === 150 ? 'force_150' : 'force_100';
  const part = stroke === 150 ? 'part1' : 'part2';
  const miss = missingOf(l)[stroke];
  const last = {};
  for (const t of l.tests) last[t[key]] = t[part];
  const cls = f => {
    if (f === next) return 't-next';
    const r = RATINGS[last[f]];
    if (r) return r.good ? 't-good' : r.pass ? 't-str' : 't-no';
    return miss.includes(f) ? 't-miss' : '';
  };
  return `<div class="track">${stock.map(f => `<i class="${cls(f)}"></i>`).join('')}</div>
    <div class="track-ends"><span>${stock[0]}</span><span>${stock[stock.length - 1]}</span></div>`;
}

// Results for one strut. Where the answer lies outside the struts we stock, say so
// (e.g. "Below 400"), rather than leaving a blank that looks like a finished result.
function pointsHtml(h, stroke) {
  const stock = stroke === 150 ? cfg.stock150 : cfg.stock100;
  const lo = stock[0], hi = stock[stock.length - 1];
  const star = '<sup title="Known from earlier rooflights">*</sup>';
  const opens = h.lowGood !== null ? `${h.lowGood}${h.inferred?.good ? star : ''}` : (h.highFail === hi || h.status === 'toostrong' ? `Over ${hi}` : '–');
  const str = rangeText(h.struggles) || (h.lowGood === lo ? `Below ${lo}` : '–');
  const no = h.highFail !== null ? `${h.highFail}${h.inferred?.fail ? star : ''}` : (h.lowPass === lo ? `Below ${lo}` : '–');
  return `<div class="points">
    <div class="p-good"><b>${opens}</b><small>Opens</small></div>
    <div class="p-str"><b>${str}</b><small>Struggles</small></div>
    <div class="p-no"><b>${no}</b><small>Doesn't open</small></div></div>
    ${h.inferred?.good || h.inferred?.fail ? '<p class="muted" style="margin:6px 0 0;font-size:13px">* known from earlier rooflights</p>' : ''}`;
}
function outOfRange(h) { return h.highFail === null || h.lowGood === null || h.status === 'paused'; }

function showTest(lidId, state) {
  home(true);
  const l = lids[lidId];
  const sug = nextSuggestion(l.tests, cfg, missingOf(l), priorsOf(l));
  const st = state || { f150: sug.force_150, f100: sug.force_100, part1: null, part2: null, seq: null, note: '', pop: false };
  if (st.f150 === null) st.f150 = cfg.stock150[cfg.stock150.length - 1];
  if (st.f100 === null) st.f100 = cfg.stock100[cfg.stock100.length - 1];
  const prev = l.tests[l.tests.length - 1];
  const seq = needsSeqQuestion(st.f150, st.f100);

  // A strut that's already found and still fitted at a force this rooflight has really been tested at
  // doesn't need rating again: its earlier rating is carried over (and noted), unless the tester chooses to rate it.
  const keptFrom = (stroke, h, f) => {
    if (!h.done) return null;
    const key = stroke === 150 ? 'force_150' : 'force_100', part = stroke === 150 ? 'part1' : 'part2';
    const t = [...l.tests].reverse().find(x => x[key] === f && RATINGS[x[part]] && !(x.note || '').includes(`${stroke} kept from try`));
    return t ? { rating: t[part], tryNo: t.test_no } : null;
  };
  const kept = { 150: st.rate150 ? null : keptFrom(150, sug.h1, st.f150), 100: st.rate100 ? null : keptFrom(100, sug.h2, st.f100) };
  const part1 = st.part1 || kept[150]?.rating, part2 = st.part2 || kept[100]?.rating;

  const strutCard = (stroke, h, f, part, prevF) => {
    if (kept[stroke] && !st[part]) {
      return `<div class="card done">
        <div class="card-head"><span class="tag">${stroke} strut</span><span class="ok-badge">✓ Found</span></div>
        <div class="force ${prev && f !== prevF ? 'changed' : ''}" style="padding:2px"><span class="n" style="font-size:40px">${f}</span><span class="u">N</span>${prev && f !== prevF ? `<span class="was">was ${prevF}</span>` : ''}</div>
        <p class="center" style="margin:0 0 6px;font-weight:800">${prev && f !== prevF ? `Change back to ${f} N` : 'Leave it fitted'} · no need to rate</p>
        ${pointsHtml(h, stroke)}
        <button class="btn ghost" data-rate="${stroke}" style="min-height:44px;margin:6px 0 0">Rate it anyway</button>
        ${stroke === 100 && seq ? `<div class="seq"><span>Long strut first?</span>${Object.entries(SEQ).map(([k, v]) =>
          `<button data-seq="${k}" class="${st.seq === k ? 'sel' : ''}">${k === 'notsure' ? '?' : v}</button>`).join('')}</div>` : ''}
      </div>`;
    }
    const changed = prev && f !== prevF;
    const badge = h.status === 'paused' ? '<span class="pause-badge">Paused</span>'
      : h.status === 'toostrong' ? '<span class="pause-badge">None strong enough</span>'
      : h.done ? '<span class="ok-badge">✓ Found</span>' : '';
    return `<div class="card ${h.done ? 'done' : ''}">
      <div class="card-head"><span class="tag">${stroke} strut</span>${badge}</div>
      <button class="force ${changed ? 'changed' : ''} ${changed && st.pop ? 'pop' : ''}" data-pick="${stroke}">
        <span class="n">${f}</span><span class="u">N</span>${changed ? `<span class="was">was ${prevF}</span>` : ''}</button>
      ${trackHtml(stroke, h, l, f)}
      ${h.done ? pointsHtml(h, stroke) : ''}
      ${stroke === 100 ? '<p class="muted" style="margin:8px 0 0">Help it to halfway first if needed</p>' : ''}
      <div class="tiles">${RATING_ORDER.map(r => `<button class="tile ${RATINGS[r].cls} ${st[part] === r ? 'sel' : ''}" data-part="${part}" data-v="${r}">
        <span class="ic">${RATINGS[r].icon}</span>${RATINGS[r].label}</button>`).join('')}</div>
      ${stroke === 100 && seq ? `<div class="seq"><span>Long strut first?</span>${Object.entries(SEQ).map(([k, v]) =>
        `<button data-seq="${k}" class="${st.seq === k ? 'sel' : ''}">${k === 'notsure' ? '?' : v}</button>`).join('')}</div>` : ''}
    </div>`;
  };

  const ready = part1 && part2 && (!seq || st.seq);
  screen(`
    <div class="card-head"><div><b style="font-size:20px">${esc(l.reference)}</b> <span class="muted">${sizeText(l)}</span></div>
      <span class="muted">Try ${l.tests.length + 1}</span></div>
    <p class="muted" style="margin:4px 0 0">Fit these on both pairs · open once · rate it${sug.h1.learnt || sug.h2.learnt ? ' · 🧠 using earlier rooflights' : ''}</p>
    ${strutCard(150, sug.h1, st.f150, 'part1', prev?.force_150)}
    ${strutCard(100, sug.h2, st.f100, 'part2', prev?.force_100)}
    ${st.noteOpen || st.note ? `<textarea id="note" placeholder="Note">${esc(st.note)}</textarea>` : '<button class="btn ghost" id="addNote">✎ Add note</button>'}
    <button class="btn go" id="save" ${ready ? '' : 'disabled'}><span class="big">✓</span> Save</button>
    <div class="row">
      ${l.tests.length ? '<button class="btn ghost" id="hist">History</button>' : ''}
      <button class="btn ghost" id="fin">Finish</button>
    </div>`, state && !st.pop);
  st.pop = false;

  const keepNote = () => { const n = $('#note'); if (n) st.note = n.value; };
  on('[data-part]', e => { keepNote(); const { part, v } = e.currentTarget.dataset; st[part] = v; showTest(lidId, st); });
  on('[data-seq]', e => { keepNote(); st.seq = e.currentTarget.dataset.seq; showTest(lidId, st); });
  on('[data-rate]', e => { keepNote(); st['rate' + e.currentTarget.dataset.rate] = true; showTest(lidId, st); });
  on('#addNote', () => { st.noteOpen = true; showTest(lidId, st); $('#note').focus(); });
  on('[data-pick]', e => { keepNote(); pickSheet(lidId, Number(e.currentTarget.dataset.pick), st); });
  on('#hist', () => historySheet(l));
  on('#fin', () => { if (confirm('Finish this rooflight?')) finishLid(lidId); });
  on('#save', () => {
    keepNote();
    const carried = [150, 100].filter(s => kept[s] && !st[s === 150 ? 'part1' : 'part2'])
      .map(s => `${s} kept from try ${kept[s].tryNo}, not re-rated`);
    const t = {
      id: uuid(), rooflight_id: lidId, test_no: l.tests.length + 1, force_150: st.f150, force_100: st.f100,
      part1, part2, seq_answer: seq ? st.seq : '', temperature: '',
      note: [(st.note || '').trim(), ...carried].filter(Boolean).join(' · '), tester_id: tester().id, tested_at: new Date().toISOString(),
    };
    l.tests.push(t); saveLids();
    enqueue('test', t);
    afterSave(lidId);
  });
}

function afterSave(lidId) {
  const l = lids[lidId];
  const sug = nextSuggestion(l.tests, cfg, missingOf(l), priorsOf(l));
  if (sug.finished) { toast('✓ Saved'); return showWin(lidId); }
  if (sug.overLimit && !l.keepGoing) return showLimit(lidId);
  const prev = l.tests[l.tests.length - 1];
  const moves = [];
  if (sug.force_150 !== prev.force_150) moves.push(`150 → ${sug.force_150}`);
  if (sug.force_100 !== prev.force_100) moves.push(`100 → ${sug.force_100}`);
  toast(`✓ Saved${moves.length ? ' · Next: ' + moves.join(', ') : ''}`);
  showTest(lidId, { f150: sug.force_150, f100: sug.force_100, part1: null, part2: null, seq: null, note: '', pop: true });
}

function showLimit(lidId) {
  const l = lids[lidId];
  screen(`<div class="card win"><div class="em">⏱️</div><h1>${l.tests.length} tries done</h1></div>
    <button class="btn go" id="fin">Finish</button>
    <button class="btn" id="more">Keep going</button>`);
  on('#fin', () => finishLid(lidId));
  on('#more', () => { l.keepGoing = true; saveLids(); showTest(lidId); });
}

function showWin(lidId) {
  home(true);
  const l = lids[lidId];
  const sug = nextSuggestion(l.tests, cfg, missingOf(l), priorsOf(l));
  screen(`
    <div class="card win"><div class="em">${outOfRange(sug.h1) || outOfRange(sug.h2) ? '🏁' : '🎉'}</div>
      <h1>${outOfRange(sug.h1) || outOfRange(sug.h2) ? 'Done, as far as our struts go' : 'All found!'}</h1><div class="muted">${esc(l.reference)} · ${sizeText(l)} · ${l.tests.length} tries</div></div>
    <div class="card"><div class="tag">150 strut</div>${pointsHtml(sug.h1, 150)}</div>
    <div class="card"><div class="tag">100 strut</div>${pointsHtml(sug.h2, 100)}</div>
    <button class="btn go" id="fin"><span class="big">✓</span> Finish rooflight</button>
    <button class="btn ghost" id="more">One more try</button>`);
  on('#fin', () => finishLid(lidId));
  on('#more', () => showTest(lidId));
}

function finishLid(lidId) {
  const l = lids[lidId];
  l.finished = true; saveLids();
  enqueue('rooflight', serverRooflight(l));
  toast('✓ Rooflight finished');
  showHome();
}

// ---------- sheets ----------
function sheet(html) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

// Tap a strut number: "don't have it" (suggests another) or pick a different one to fit.
function pickSheet(lidId, stroke, st) {
  const l = lids[lidId];
  const miss = missingOf(l)[stroke];
  const stock = stroke === 150 ? cfg.stock150 : cfg.stock100;
  const key = stroke === 150 ? 'f150' : 'f100';
  const cur = st[key];
  const bg = sheet(`
    <div class="card-head"><span class="tag">${stroke} strut</span><button class="btn ghost" data-x style="width:auto;margin:0;min-height:44px">✕</button></div>
    <button class="btn" data-dont style="color:var(--bad)">✕ Don't have ${cur} N</button>
    <div class="muted" style="margin:10px 0 8px">Or fit a different one</div>
    <div class="chips">${stock.map(f => `<button data-f="${f}" class="${f === cur ? 'sel' : ''} ${miss.includes(f) ? 'miss' : ''}">${f}</button>`).join('')}</div>`);
  bg.querySelector('[data-x]').onclick = () => bg.remove();
  bg.querySelector('[data-dont]').onclick = () => {
    if (!miss.includes(cur)) miss.push(cur);
    saveLids(); bg.remove();
    const sug = nextSuggestion(l.tests, cfg, missingOf(l), priorsOf(l));
    st[key] = stroke === 150 ? sug.force_150 : sug.force_100;
    if (st[key] === null) { toast('None left to hand'); st[key] = cur; }
    else toast(`Try ${st[key]} N instead`);
    st.pop = true; showTest(lidId, st);
  };
  bg.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    const f = Number(b.dataset.f);
    const i = miss.indexOf(f); if (i >= 0) miss.splice(i, 1); // picking it means we have it after all
    saveLids(); bg.remove();
    st[key] = f; showTest(lidId, st);
  });
}

function historySheet(l) {
  const dot = r => `<span class="dot ${RATINGS[r].cls}"></span>`;
  const bg = sheet(`
    <div class="card-head"><span class="tag">History</span><button class="btn ghost" data-x style="width:auto;margin:0;min-height:44px">✕</button></div>
    <ul class="hist">${[...l.tests].reverse().map(t => `<li><span class="no">${t.test_no}</span>
      <span style="flex:1">${dot(t.part1)}<b>${t.force_150}</b> <span class="muted">${RATINGS[t.part1].label}</span><br>
      ${dot(t.part2)}<b>${t.force_100}</b> <span class="muted">${RATINGS[t.part2].label}</span>${t.note ? `<br><span class="muted">✎ ${esc(t.note)}</span>` : ''}</span></li>`).join('')}</ul>`);
  bg.querySelector('[data-x]').onclick = () => bg.remove();
}

// ---------- boot ----------
$('#homeBtn').addEventListener('click', showHome);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
flush();
