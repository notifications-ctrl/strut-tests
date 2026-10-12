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
const saveLids = () => store.set('lids', lids);
const saveQueue = () => { store.set('queue', queue); showPending(); };

function tester() { const id = store.get('tester', null); return cfg?.testers.find(t => t.id === id) || null; }
function testerName(id) { return cfg?.testers.find(t => t.id === id)?.name || ''; }

// ---------- sending ----------
function showPending() {
  const el = $('#pending');
  const tests = queue.filter(q => q.kind === 'test').length;
  if (!queue.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  let msg = tests ? `${tests} test${tests === 1 ? '' : 's'} waiting to send` : 'Details waiting to send';
  if (lastSendError) msg += ` (problem: ${lastSendError})`;
  else if (!navigator.onLine) msg += ' (no signal)';
  el.textContent = msg;
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
    if (e instanceof PinError) { store.del('pin'); lastSendError = 'PIN changed, enter the new one'; showPin(); }
    else if (e.server) lastSendError = e.message.slice(0, 80);
    else lastSendError = null; // no signal: try again later
  } finally { flushing = false; showPending(); }
}
window.addEventListener('online', flush);
setInterval(flush, 30000);

function enqueue(kind, data) { queue.push({ kind, data }); saveQueue(); flush(); }

// ---------- helpers ----------
function screen(html) { app().innerHTML = html; window.scrollTo(0, 0); }
function on(sel, fn) { document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn)); }
function lidLabel(l) {
  return `${esc(l.reference)} · ${l.length_mm || '?'} × ${l.width_mm || '?'} mm · Lid ${l.lid}`;
}
function serverRooflight(l) {
  const { tests, ...r } = l; return r;
}

// ---------- PIN ----------
function showPin(msg) {
  $('#homeBtn').style.visibility = 'hidden';
  screen(`
    <h1>Strut tests</h1>
    <p>Enter the factory PIN. You only do this once on this phone.</p>
    <label class="field" for="pin">Factory PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12">
    <p class="err" id="pinErr">${esc(msg || '')}</p>
    <button class="primary" id="go">Unlock</button>`);
  const go = async () => {
    const pin = $('#pin').value.trim();
    if (!pin) return;
    $('#go').disabled = true; $('#pinErr').textContent = 'Checking…';
    try {
      const data = await rpc('app_config', { p_pin: pin });
      store.set('pin', pin); cfg = data; store.set('cfg', cfg); lastSendError = null;
      flush(); start();
    } catch (e) {
      $('#go').disabled = false;
      $('#pinErr').textContent = e instanceof PinError ? 'That PIN is not right. Try again.'
        : e instanceof LockedError ? e.message
        : 'No signal. You need signal the first time.';
    }
  };
  on('#go', go);
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ---------- refresh settings & open tests from server ----------
async function refresh() {
  const pin = store.get('pin', null);
  if (!pin || !navigator.onLine) return;
  try {
    const data = await rpc('app_config', { p_pin: pin });
    cfg = data; store.set('cfg', cfg);
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
    // Lids finished elsewhere (or deleted): drop local copies that have nothing waiting to send.
    const waiting = new Set(queue.map(q => q.kind === 'test' ? q.data.rooflight_id : q.data.id));
    for (const id of Object.keys(lids)) {
      if (!serverIds.has(id) && !waiting.has(id) && !lids[id].finished) delete lids[id];
    }
    saveLids();
  } catch (e) {
    if (e instanceof PinError) { store.del('pin'); showPin('The PIN has changed. Enter the new one.'); throw e; }
  }
}

// ---------- start ----------
async function start() {
  showPending();
  if (!store.get('pin', null) || !cfg) return showPin();
  if (!tester()) return showWho();
  showHome();
  try { await refresh(); if ($('#homeScreen')) showHome(); } catch {}
}

function showWho() {
  $('#homeBtn').style.visibility = 'hidden';
  const names = cfg.testers;
  screen(`
    <h1>Who are you?</h1>
    ${names.length ? names.map(t => `<button class="secondary" data-id="${t.id}">${esc(t.name)}</button>`).join('')
      : '<p class="notice warn">No names set up yet. Ask Mark to add your name.</p>'}
  `);
  on('[data-id]', e => { store.set('tester', e.currentTarget.dataset.id); start(); });
}

function showHome() {
  $('#homeBtn').style.visibility = 'hidden';
  const open = Object.values(lids).filter(l => !l.finished).sort((a, b) => b.created_at.localeCompare(a.created_at));
  screen(`
    <div id="homeScreen">
      <h1>Hello ${esc(tester().name)}</h1>
      <p class="hint mt0">Not you? <a href="#" id="changeName">Change name</a></p>
      <button class="primary" id="newTest">New test</button>
      ${open.length ? `<h2>Carry on with</h2>` + open.map(l => `
        <button class="secondary" data-lid="${l.id}">${lidLabel(l)}<br>${l.tests.length} test${l.tests.length === 1 ? '' : 's'} done</button>`).join('') : ''}
    </div>`);
  on('#newTest', showDetails);
  on('[data-lid]', e => showFit(e.currentTarget.dataset.lid));
  $('#changeName').addEventListener('click', e => { e.preventDefault(); store.del('tester'); showWho(); });
}

// ---------- rooflight details ----------
function showDetails() {
  $('#homeBtn').style.visibility = 'visible';
  const f = { anti_noise: false, pairs: 2, lid: null };
  screen(`
    <h1>Rooflight details</h1>
    <label class="field" for="ref">Roof reference</label>
    <input id="ref" type="text" autocomplete="off" autocapitalize="characters">
    <div class="row">
      <div><label class="field" for="len">Length mm</label><input id="len" type="text" inputmode="numeric" pattern="[0-9]*"></div>
      <div><label class="field" for="wid">Width mm</label><input id="wid" type="text" inputmode="numeric" pattern="[0-9]*"></div>
    </div>
    <label class="field">Anti-noise?</label>
    <div class="row toggle" id="an">
      <button class="choice sel" data-v="false">No</button><button class="choice" data-v="true">Yes</button>
    </div>
    <label class="field">Strut pairs per lid</label>
    <div class="row toggle" id="pairs">
      <button class="choice" data-v="1">1</button><button class="choice sel" data-v="2">2</button><button class="choice" data-v="3">3</button>
    </div>
    <label class="field">Which lid?</label>
    <div class="row toggle" id="lid">
      <button class="choice" data-v="1">Lid 1</button><button class="choice" data-v="2">Lid 2</button>
    </div>
    <p class="err" id="err"></p>
    <button class="primary" id="go">Start testing</button>`);
  const group = (id, key, parse) => on(`#${id} .choice`, e => {
    document.querySelectorAll(`#${id} .choice`).forEach(b => b.classList.remove('sel'));
    e.currentTarget.classList.add('sel'); f[key] = parse(e.currentTarget.dataset.v);
  });
  group('an', 'anti_noise', v => v === 'true');
  group('pairs', 'pairs', Number);
  group('lid', 'lid', Number);
  on('#go', () => {
    const ref = $('#ref').value.trim();
    const len = parseInt($('#len').value, 10), wid = parseInt($('#wid').value, 10);
    const err = !ref ? 'Enter the roof reference.' : !(len > 0) || !(wid > 0) ? 'Enter the length and width in mm.' : !f.lid ? 'Choose Lid 1 or Lid 2.' : '';
    if (err) { $('#err').textContent = err; return; }
    const l = { id: uuid(), reference: ref, length_mm: len, width_mm: wid, anti_noise: f.anti_noise, pairs: f.pairs, lid: f.lid,
                tester_id: tester().id, finished: false, created_at: new Date().toISOString(), tests: [] };
    lids[l.id] = l; saveLids();
    enqueue('rooflight', serverRooflight(l));
    showFit(l.id);
  });
}

// ---------- what to fit ----------
function showFit(lidId, chosen) {
  $('#homeBtn').style.visibility = 'visible';
  const l = lids[lidId];
  const sug = nextSuggestion(l.tests, cfg);
  const f150 = chosen ? chosen.f150 : sug.force_150;
  const f100 = chosen ? chosen.f100 : sug.force_100;
  const prev = l.tests[l.tests.length - 1];
  const mark = (v, old) => prev && v !== old ? `<span class="changed">${v} N</span>` : `${v} N`;
  const settled = [];
  if (sug.h1.done) settled.push(`Part 1 is settled, so the 150 stays at ${sug.force_150} N.`);
  if (sug.h2.done) settled.push(`Part 2 is settled, so the 100 stays at ${sug.force_100} N.`);
  screen(`
    <p class="hint mt0">${lidLabel(l)} · Test ${l.tests.length + 1}</p>
    ${sug.finished && !chosen ? `<div class="done-banner">Both parts are settled</div><p>You can still do another test if you want to check something.</p>` : ''}
    <div class="fit">
      <span class="s">Fit 150mm @ ${mark(f150, prev?.force_150)}</span>
      <span class="s">and 100mm @ ${mark(f100, prev?.force_100)}</span>
      <small>on every pair (${l.pairs} pair${l.pairs === 1 ? '' : 's'})${chosen ? ' · your choice' : ''}</small>
    </div>
    ${!chosen && settled.length ? `<p class="hint">${settled.join(' ')}</p>` : ''}
    <p><b>Open and close it 3 times. Rate the worst one.</b></p>
    <button class="primary" id="rate">Fitted. Rate it</button>
    <button class="secondary" id="diff">Use different struts</button>
    ${l.tests.length ? '<button class="secondary" id="sum">See results so far</button>' : ''}
    <button class="secondary" id="fin">Finish this lid</button>`);
  on('#rate', () => showRate(lidId, f150, f100));
  on('#diff', () => showChoose(lidId, f150, f100));
  on('#sum', () => showSummary(lidId));
  on('#fin', () => finishLid(lidId));
}

function showChoose(lidId, f150, f100) {
  const sel = { f150, f100 };
  const chips = (list, key) => list.map(v => `<button data-k="${key}" data-v="${v}" class="${sel[key] === v ? 'sel' : ''}">${v}</button>`).join('');
  screen(`
    <h1>Which struts are fitted?</h1>
    <p class="hint mt0">Pick what is actually on the lid.</p>
    <h2>150mm strut (N)</h2><div class="chips">${chips(cfg.stock150, 'f150')}</div>
    <h2>100mm strut (N)</h2><div class="chips">${chips(cfg.stock100, 'f100')}</div>
    <button class="primary" id="use">Use these</button>
    <button class="secondary" id="back">Back</button>`);
  on('.chips button', e => {
    const { k, v } = e.currentTarget.dataset;
    sel[k] = Number(v);
    document.querySelectorAll(`.chips button[data-k="${k}"]`).forEach(b => b.classList.toggle('sel', Number(b.dataset.v) === sel[k]));
  });
  on('#use', () => showFit(lidId, sel));
  on('#back', () => showFit(lidId));
}

// ---------- rating ----------
function showRate(lidId, f150, f100) {
  const l = lids[lidId];
  const seq = needsSeqQuestion(f150, f100);
  const ans = { part1: null, part2: null, seq_answer: null, temperature: null };
  const ratingButtons = key => RATING_ORDER.map(r =>
    `<button class="choice ${RATINGS[r].cls}" data-q="${key}" data-v="${r}">${RATINGS[r].label}</button>`).join('');
  screen(`
    <p class="hint mt0">${lidLabel(l)} · Test ${l.tests.length + 1} · 150 @ ${f150} N, 100 @ ${f100} N</p>
    <h1 id="q-part1">Part 1: shut to halfway</h1>
    ${ratingButtons('part1')}
    <h1 id="q-part2">Part 2: halfway to fully open</h1>
    <p class="hint">If part 1 needed a push, help it to halfway, let go, then rate part 2.</p>
    ${ratingButtons('part2')}
    ${seq ? `<h1 id="q-seq_answer">Did the long strut open first?</h1>
      <p class="hint">The 100 is close in strength to the 150 here, so check which one moved first.</p>
      <div class="row toggle">${Object.entries(SEQ).map(([k, v]) => `<button class="choice" data-q="seq_answer" data-v="${k}">${v}</button>`).join('')}</div>` : ''}
    <h2>Temperature (optional)</h2>
    <div class="row toggle">${Object.entries(TEMPS).map(([k, v]) => `<button class="choice" data-q="temperature" data-v="${k}">${v}</button>`).join('')}</div>
    <h2>Note (optional)</h2>
    <textarea id="note" rows="3"></textarea>
    <p class="err" id="err"></p>
    <button class="primary" id="save">Save test</button>`);
  on('[data-q]', e => {
    const { q, v } = e.currentTarget.dataset;
    const optional = q === 'temperature';
    ans[q] = optional && ans[q] === v ? null : v; // tap again to clear temperature
    document.querySelectorAll(`[data-q="${q}"]`).forEach(b => b.classList.toggle('sel', b.dataset.v === ans[q]));
  });
  on('#save', () => {
    const missing = ['part1', 'part2', ...(seq ? ['seq_answer'] : [])].find(k => !ans[k]);
    if (missing) {
      $('#err').textContent = missing === 'seq_answer' ? 'Answer "Did the long strut open first?"' : `Rate ${missing === 'part1' ? 'part 1' : 'part 2'} first.`;
      document.getElementById('q-' + missing).scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const t = {
      id: uuid(), rooflight_id: lidId, test_no: l.tests.length + 1, force_150: f150, force_100: f100,
      part1: ans.part1, part2: ans.part2, seq_answer: ans.seq_answer || '', temperature: ans.temperature || '',
      note: $('#note').value.trim(), tester_id: tester().id, tested_at: new Date().toISOString(),
    };
    l.tests.push(t); saveLids();
    enqueue('test', t);
    showResult(lidId);
  });
}

// ---------- after saving ----------
function showResult(lidId) {
  const l = lids[lidId];
  const sug = nextSuggestion(l.tests, cfg);
  const sentNote = navigator.onLine ? 'Test saved.' : 'Test saved on this phone. It will send when there is signal.';
  let body;
  if (sug.finished) {
    body = `<div class="done-banner">Test finished</div>
      <p>Both parts are settled for this lid.</p>
      ${summaryHtml(l)}
      <button class="primary" id="fin">Finish this lid</button>
      <button class="secondary" id="more">Do another test anyway</button>`;
  } else if (sug.overLimit) {
    body = `<div class="notice warn"><b>${l.tests.length} tests done on this lid.</b> You can finish here or carry on.</div>
      ${summaryHtml(l)}
      <button class="primary" id="fin">Finish this lid</button>
      <button class="secondary" id="more">Carry on testing</button>`;
  } else {
    body = `<div class="fit"><span class="s">Next: 150mm @ ${sug.force_150} N</span><span class="s">and 100mm @ ${sug.force_100} N</span></div>
      <button class="primary" id="more">Next test</button>
      ${summaryHtml(l)}
      <button class="secondary" id="fin">Finish this lid now</button>`;
  }
  screen(`<div class="notice ok">${sentNote}</div>${body}`);
  on('#more', () => showFit(lidId));
  on('#fin', () => finishLid(lidId));
}

function finishLid(lidId) {
  const l = lids[lidId];
  if (!confirm('Finish this lid? It will leave the "Carry on" list.')) return;
  l.finished = true; saveLids();
  enqueue('rooflight', serverRooflight(l));
  showSummary(lidId, true);
}

function showSummary(lidId, finished) {
  const l = lids[lidId];
  screen(`
    ${finished ? '<div class="done-banner">Lid finished</div>' : ''}
    <h1>${lidLabel(l)}</h1>
    ${summaryHtml(l)}
    <h2>Every test</h2>
    ${testsListHtml(l)}
    ${finished ? '<button class="primary" id="home2">Back to start</button>' : '<button class="primary" id="back">Back</button>'}`);
  on('#home2', showHome);
  on('#back', () => showFit(lidId));
}

function summaryHtml(l) {
  const sug = nextSuggestion(l.tests, cfg);
  const row = (name, st) => {
    const s = halfSummaryText(st);
    const status = st.status === 'nostock' ? 'Even our strongest strut did not open it'
      : st.status === 'lowest' ? 'Our weakest strut opens it'
      : st.done ? 'Settled' : 'Still testing';
    return `<tr><th>${name}</th><td>${s.opened}</td><td>${s.didnt}</td><td>${status}</td></tr>`;
  };
  return `<table class="summary">
    <tr><th></th><th>Lowest that opened it</th><th>Highest that didn't</th><th></th></tr>
    ${row('Part 1 (150)', sug.h1)}${row('Part 2 (100)', sug.h2)}
  </table>`;
}

function testsListHtml(l) {
  if (!l.tests.length) return '<p>No tests yet.</p>';
  const pill = r => `<span class="pill ${RATINGS[r].cls}" style="background:var(--c)">${RATINGS[r].label}</span>`;
  return `<ul class="tests-list">${[...l.tests].reverse().map(t => `
    <li><b>Test ${t.test_no}</b> · 150 @ ${t.force_150} N, 100 @ ${t.force_100} N<br>
      Part 1: ${pill(t.part1)}<br>Part 2: ${pill(t.part2)}
      ${t.seq_answer ? `<br>Long strut opened first: ${SEQ[t.seq_answer]}` : ''}
      ${t.temperature ? `<br>Temperature: ${TEMPS[t.temperature]}` : ''}
      ${t.note ? `<br>Note: ${esc(t.note)}` : ''}
      <br><span class="hint">${esc(testerName(t.tester_id))} · ${new Date(t.tested_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
    </li>`).join('')}</ul>`;
}

// ---------- boot ----------
$('#homeBtn').addEventListener('click', showHome);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
flush();
