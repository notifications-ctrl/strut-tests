// Admin page: results, CSV export, tester names, stock and settings.
const $ = sel => document.querySelector(sel);
const app = () => $('#app');
let pin = null; try { pin = sessionStorage.getItem('st_admin_pin'); } catch {}
let D = null;        // data from admin_data
let tab = 'results';
const open = new Set();

function on(sel, fn) { document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn)); }
function nameOf(id) { return D.testers.find(t => t.id === id)?.name || ''; }
function fmt(ts) { return ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }
function cfgFromData() { return { stock150: D.stock150, stock100: D.stock100, settings: D.settings }; }
// Results use earlier rooflights too (same as the phones); values known only from those are marked *.
function resultFor(r) {
  // Same rule as the phones: learn from everything except SIM- rooflights.
  const all = D.rooflights.filter(x => !/^SIM-/i.test(x.reference || '')).map(x => ({ ...x, tests: testsFor(x.id) }));
  return nextSuggestion(testsFor(r.id), cfgFromData(), undefined, priorsFor(r, all));
}
const mark = (v, inf) => v === null || v === undefined ? '' : `${v}${inf ? '*' : ''}`;
function inferredText(s) {
  const out = [];
  if (s.h1.inferred?.good) out.push('150 opens'); if (s.h1.inferred?.fail) out.push("150 doesn't open");
  if (s.h2.inferred?.good) out.push('100 opens'); if (s.h2.inferred?.fail) out.push("100 doesn't open");
  return out.join(', ');
}
function testsFor(id) { return D.tests.filter(t => t.rooflight_id === id).sort((a, b) => a.test_no - b.test_no); }

function isTest(r) { return /^(SIM|TRY|TEST)-/i.test(r.reference || ''); }
let filter = 'all', query = '';
const picked = new Set();

function showLogin(msg) {
  $('#logout').style.visibility = 'hidden';
  let entry = '';
  app().innerHTML = `
    <div class="center"><div style="font-size:52px;margin-top:10px">🔒</div><h1>Admin PIN</h1></div>
    <div style="max-width:340px;margin:0 auto">
      <div class="dots" id="dots"></div>
      <p class="err center" id="err">${esc(msg || '')}</p>
      <div class="pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="del">⌫</button><button data-k="0">0</button><button data-k="ok" class="k-ok">✓</button>
      </div>
    </div>`;
  const dots = () => { $('#dots').innerHTML = '<i></i>'.repeat(entry.length); };
  const go = async () => {
    if (!entry) return;
    pin = entry; $('#err').textContent = '…';
    try { await load(); try { sessionStorage.setItem('st_admin_pin', pin); } catch {} render(); }
    catch (e) { pin = null; entry = ''; dots(); $('#err').textContent = e instanceof PinError ? 'Wrong PIN' : e instanceof LockedError ? 'Locked. Wait 10 min.' : e.message; }
  };
  on('[data-k]', e => {
    const k = e.currentTarget.dataset.k;
    if (k === 'ok') return go();
    if (k === 'del') entry = entry.slice(0, -1); else if (entry.length < 12) entry += k;
    $('#err').textContent = ''; dots();
  });
  document.onkeydown = e => {
    if (!$('.pad')) return;
    if (/^[0-9]$/.test(e.key) && entry.length < 12) { entry += e.key; dots(); }
    else if (e.key === 'Backspace') { entry = entry.slice(0, -1); dots(); }
    else if (e.key === 'Enter') go();
  };
}

async function load() { D = await rpc('admin_data', { p_pin: pin }); }

async function call(fn, args, okMsg) {
  try {
    await rpc(fn, { p_pin: pin, ...args });
    await load(); render(); if (okMsg) toast(okMsg);
  } catch (e) {
    if (e instanceof PinError) return relock();
    alert(e.message);
  }
}
function relock() { pin = null; try { sessionStorage.removeItem('st_admin_pin'); } catch {} showLogin('Please enter the PIN again.'); }
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
}

function render() {
  $('#logout').style.visibility = 'visible';
  const tabs = { results: '📋 Results', names: '👤 Testers', stock: '🔩 Stock', settings: '⚙️ Settings' };
  const y = window.scrollY;
  app().innerHTML = `
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button class="${tab === k ? 'sel' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
    <div id="body"></div>`;
  on('[data-tab]', e => { tab = e.currentTarget.dataset.tab; render(); window.scrollTo(0, 0); });
  ({ results: renderResults, names: renderNames, stock: renderStock, settings: renderSettings })[tab]();
  window.scrollTo(0, y);
}

// ---------- results ----------
function shown() {
  const q = query.trim().toLowerCase();
  return D.rooflights.filter(r =>
    (filter === 'all' || (filter === 'real' && !isTest(r)) || (filter === 'test' && isTest(r)) || (filter === 'open' && !r.finished)) &&
    (!q || `${r.reference} ${r.length_mm}x${r.width_mm} ${r.length_mm} × ${r.width_mm} ${nameOf(r.tester_id)}`.toLowerCase().includes(q)));
}

function strutRow(name, h, stroke) {
  const stock = stroke === 150 ? D.stock150 : D.stock100;
  const lo = stock[0], hi = stock[stock.length - 1];
  const star = v => `${v}<sup title="Worked out from other rooflights, not tested on this one">*</sup>`;
  const opens = h.lowGood !== null ? (h.inferred?.good ? star(h.lowGood) : h.lowGood) : (h.highFail === hi ? `Over ${hi}` : '–');
  const str = rangeText(h.struggles) || (h.lowGood === lo ? `Below ${lo}` : '–');
  const no = h.highFail !== null ? (h.inferred?.fail ? star(h.highFail) : h.highFail) : (h.lowPass === lo ? `Below ${lo}` : '–');
  return `<div class="strut"><span class="nm">${name}</span>
    <div class="pill g"><b>${opens}</b><small>Opens</small></div>
    <div class="pill s"><b>${str}</b><small>Struggles</small></div>
    <div class="pill n"><b>${no}</b><small>Doesn't open</small></div></div>`;
}

function rooflightCard(r) {
  const ts = testsFor(r.id), s = resultFor(r), isOpen = open.has(r.id);
  const dot = k => `<span class="dot ${RATINGS[k].cls}"></span>`;
  return `<div class="rl ${picked.has(r.id) ? 'picked' : ''}">
    <div class="rl-top">
      <input type="checkbox" data-pick="${r.id}" ${picked.has(r.id) ? 'checked' : ''} aria-label="Select ${esc(r.reference)}">
      <div class="rl-title"><b>${esc(r.reference)}</b>
        <div class="rl-meta">${r.length_mm} × ${r.width_mm} mm${r.anti_noise ? ' · anti-noise' : ''} · ${ts.length} ${ts.length === 1 ? 'try' : 'tries'} · ${esc(nameOf(r.tester_id)) || '?'} · ${fmt(r.created_at)}</div></div>
      <div>${r.finished ? '<span class="status fin">✓ Finished</span>' : '<span class="status open">In progress</span>'}${isTest(r) ? '<span class="status test">Test data</span>' : ''}</div>
    </div>
    ${strutRow('150 STRUT', s.h1, 150)}
    ${strutRow('100 STRUT', s.h2, 100)}
    ${isOpen ? (ts.length ? `<table class="tries"><tr><th>#</th><th>150 strut</th><th>100 strut</th><th>Note</th><th>When</th></tr>
      ${ts.map(t => `<tr><td>${t.test_no}</td>
        <td>${dot(t.part1)}<span class="f">${t.force_150}</span> ${RATINGS[t.part1].label}</td>
        <td>${dot(t.part2)}<span class="f">${t.force_100}</span> ${RATINGS[t.part2].label}${t.seq_answer === 'yes' ? ' · long strut first' : ''}</td>
        <td>${esc(t.note)}</td><td>${fmt(t.tested_at)}</td></tr>`).join('')}</table>` : '<p class="note">No tries saved.</p>') : ''}
    <div class="rl-actions">
      <button data-open="${r.id}">${isOpen ? '▴ Hide tries' : '▾ Show tries'}</button>
      <button data-fin="${r.id}" data-v="${!r.finished}">${r.finished ? '↺ Reopen' : '✓ Mark finished'}</button>
      <button class="del" data-del="${r.id}">🗑 Delete</button>
    </div>
  </div>`;
}

function renderResults() {
  const list = shown();
  const nTests = D.tests.filter(t => D.rooflights.some(r => r.id === t.rooflight_id && !isTest(r))).length;
  const real = D.rooflights.filter(r => !isTest(r));
  for (const id of [...picked]) if (!D.rooflights.some(r => r.id === id)) picked.delete(id);
  const allShownPicked = list.length && list.every(r => picked.has(r.id));
  const f = (k, label, n) => `<button data-filter="${k}" class="${filter === k ? 'sel' : ''}">${label} <span style="opacity:.6">${n}</span></button>`;
  $('#body').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${real.length}</b><span>Real rooflights</span></div>
      <div class="stat"><b>${real.filter(r => r.finished).length}</b><span>Finished</span></div>
      <div class="stat"><b>${nTests}</b><span>Real tries</span></div>
    </div>
    <details class="help"><summary>How to read the results</summary>
      <div class="legend">
        <div><span class="pill g" style="min-width:110px"><b>700</b><small>Opens</small></span> The weakest strut that opens the lid properly.</div>
        <div><span class="pill s" style="min-width:110px"><b>500–650</b><small>Struggles</small></span> Struts that open it, but slowly or with effort.</div>
        <div><span class="pill n" style="min-width:110px"><b>450</b><small>Doesn't open</small></span> The strongest strut that doesn't open it.</div>
        <div><span class="pill" style="min-width:110px"><b>700<sup>*</sup></b></span> Worked out from other rooflights, not tested on this one.</div>
        <div><span class="pill" style="min-width:110px"><b>Below 400</b></span> The answer is outside the struts we stock.</div>
      </div>
      <p class="note">The 150 strut is tested in 100 N steps, the 100 strut in 50 N steps. "Test data" means a reference starting SIM-, TRY- or TEST-; it's ignored when the app learns.</p>
    </details>
    <div class="row" style="flex-wrap:wrap">
      <button class="act blue" id="csvSum" style="flex:1 1 170px">⬇ Summary for Excel</button>
      <button class="act" id="csvTests" style="flex:1 1 170px">⬇ Every try for Excel</button>
      <button class="act" id="reload" style="flex:1 1 120px">↻ Refresh</button>
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search reference, size or name" value="${esc(query)}">
      <div class="filters">${f('all', 'All', D.rooflights.length)}${f('real', 'Real', real.length)}${f('test', 'Test data', D.rooflights.length - real.length)}${f('open', 'In progress', D.rooflights.filter(r => !r.finished).length)}</div>
      <div class="selbar">
        <label><input type="checkbox" id="pickAll" ${allShownPicked ? 'checked' : ''}> Select all shown</label>
        <button class="act red" id="delPicked" ${picked.size ? '' : 'disabled'}>🗑 Delete selected (${picked.size})</button>
        ${picked.size ? '<button class="act" id="clearPick">Clear selection</button>' : ''}
      </div>
    </div>
    ${list.length ? list.map(rooflightCard).join('') : '<div class="empty">Nothing here.</div>'}`;

  const q = $('#q');
  q.addEventListener('input', () => { query = q.value; const pos = q.selectionStart; renderResults(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  on('[data-filter]', e => { filter = e.currentTarget.dataset.filter; renderResults(); });
  document.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', () => {
    c.checked ? picked.add(c.dataset.pick) : picked.delete(c.dataset.pick); renderResults(); }));
  $('#pickAll').addEventListener('change', e => { for (const r of list) e.target.checked ? picked.add(r.id) : picked.delete(r.id); renderResults(); });
  on('#clearPick', () => { picked.clear(); renderResults(); });
  on('#delPicked', bulkDelete);
  on('[data-open]', e => { const id = e.currentTarget.dataset.open; open.has(id) ? open.delete(id) : open.add(id); renderResults(); });
  on('[data-fin]', e => call('admin_set_finished', { p_id: e.currentTarget.dataset.fin, p_finished: e.currentTarget.dataset.v === 'true' }, 'Updated'));
  on('[data-del]', e => {
    const r = D.rooflights.find(x => x.id === e.currentTarget.dataset.del);
    if (confirm(`Delete ${r.reference} and its ${testsFor(r.id).length} tries?\n\nThis can't be undone.`)) call('admin_delete_rooflight', { p_id: r.id }, 'Deleted');
  });
  on('#reload', async () => { await load(); render(); toast('Up to date'); });
  on('#csvTests', () => downloadCsv('strut-tests-every-try.csv', testsCsv()));
  on('#csvSum', () => downloadCsv('strut-tests-summary.csv', summaryCsv()));
}

async function bulkDelete() {
  const rs = D.rooflights.filter(r => picked.has(r.id));
  if (!rs.length) return;
  const names = rs.slice(0, 12).map(r => r.reference).join(', ') + (rs.length > 12 ? ` and ${rs.length - 12} more` : '');
  if (!confirm(`Delete ${rs.length} rooflight${rs.length === 1 ? '' : 's'} and all their tries?\n\n${names}\n\nThis can't be undone.`)) return;
  const btn = $('#delPicked'); btn.disabled = true;
  let done = 0;
  try {
    for (const r of rs) { await rpc('admin_delete_rooflight', { p_pin: pin, p_id: r.id }); done++; picked.delete(r.id); btn.textContent = `Deleting… ${done}/${rs.length}`; }
  } catch (e) {
    if (e instanceof PinError) return relock();
    alert(`Stopped after ${done}: ${e.message}`);
  }
  await load(); render(); toast(`Deleted ${done}`);
}

function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function toCsv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
function downloadCsv(name, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads it as UTF-8
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const isoDate = ts => ts ? new Date(ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }).replace(',', '') : '';
function testsCsv() {
  const head = ['Reference', 'Length mm', 'Width mm', 'Anti-noise', 'Try no', '150 force N', '150 result', '100 force N', '100 result',
    'Long strut opened first', 'Note', 'Tester', 'Tested at'];
  const byId = Object.fromEntries(D.rooflights.map(r => [r.id, r]));
  const rows = D.tests.map(t => { const r = byId[t.rooflight_id] || {}; return [
    r.reference, r.length_mm, r.width_mm, r.anti_noise ? 'Yes' : 'No', t.test_no, t.force_150, RATINGS[t.part1].label,
    t.force_100, RATINGS[t.part2].label, t.seq_answer ? SEQ[t.seq_answer] : '', t.note, nameOf(t.tester_id), isoDate(t.tested_at)]; });
  return toCsv([head, ...rows]);
}
function summaryCsv() {
  const cfg = cfgFromData();
  const head = ['Reference', 'Length mm', 'Width mm', 'Anti-noise', 'Tries',
    '150 lowest that opens N', '150 struggles N', "150 highest that doesn't open N", '150 found',
    '100 lowest that opens N', '100 struggles N', "100 highest that doesn't open N", '100 found', 'Known from earlier rooflights (not tested)', 'Status', 'Tester', 'Started'];
  const rows = D.rooflights.map(r => { const ts = testsFor(r.id); const s = resultFor(r); return [
    r.reference, r.length_mm, r.width_mm, r.anti_noise ? 'Yes' : 'No', ts.length,
    s.h1.lowGood ?? '', s.h1.struggles.join(' '), s.h1.highFail ?? '', s.h1.done ? 'Yes' : 'No',
    s.h2.lowGood ?? '', s.h2.struggles.join(' '), s.h2.highFail ?? '', s.h2.done ? 'Yes' : 'No', inferredText(s),
    r.finished ? 'Finished' : 'Open', nameOf(r.tester_id), isoDate(r.created_at)]; });
  return toCsv([head, ...rows]);
}

// ---------- names ----------
function renderNames() {
  $('#body').innerHTML = `
    <div class="panel">
      <h2>Who can test</h2>
      <p class="lead">These names appear on the phones. Hiding a name keeps their old results but takes them off the list.</p>
      ${D.testers.map(t => `<div class="namerow">
        <span class="avatar" style="${t.active ? '' : 'background:var(--line)'}">${esc(t.name[0] || '?')}</span>
        <input class="inline" data-name="${t.id}" value="${esc(t.name)}">
        <button class="act" data-save="${t.id}">Save</button>
        <button class="act" data-act="${t.id}" data-v="${!t.active}">${t.active ? 'Hide' : 'Show'}</button>
      </div>`).join('')}
    </div>
    <div class="panel">
      <h2>Add someone</h2>
      <div class="row"><input class="inline" id="newName" placeholder="Name"><button class="act blue" id="add" style="flex:0 0 auto">＋ Add</button></div>
    </div>`;
  on('#add', () => { const n = $('#newName').value.trim(); if (n) call('admin_save_tester', { p_id: null, p_name: n, p_active: true }, 'Added'); });
  on('[data-save]', e => { const id = e.currentTarget.dataset.save; call('admin_save_tester', { p_id: id, p_name: document.querySelector(`[data-name="${id}"]`).value, p_active: null }, 'Saved'); });
  on('[data-act]', e => { const id = e.currentTarget.dataset.act; const t = D.testers.find(x => x.id === id);
    call('admin_save_tester', { p_id: id, p_name: t.name, p_active: e.currentTarget.dataset.v === 'true' }, 'Saved'); });
}

// ---------- stock ----------
function renderStock() {
  $('#body').innerHTML = `
    <div class="panel">
      <h2>Struts we hold</h2>
      <p class="lead">The app only suggests struts on these lists. Type the forces in newtons, separated by commas.
        Leave a strut on here even if it's out of stock today; testers can tap "Don't have it" on the phone.</p>
      <div class="grid2">
        <div><label class="field" for="s150">150 mm strut</label><textarea id="s150" rows="4">${D.stock150.join(', ')}</textarea>
          <p class="note">${D.stock150.length} sizes, ${D.stock150[0]} to ${D.stock150[D.stock150.length - 1]} N</p></div>
        <div><label class="field" for="s100">100 mm strut</label><textarea id="s100" rows="4">${D.stock100.join(', ')}</textarea>
          <p class="note">${D.stock100.length} sizes, ${D.stock100[0]} to ${D.stock100[D.stock100.length - 1]} N</p></div>
      </div>
      <button class="btn go" id="saveStock" style="max-width:300px">Save</button>
    </div>`;
  const parse = s => [...new Set(s.split(/[\s,;]+/).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  on('#saveStock', () => {
    const a = parse($('#s150').value), b = parse($('#s100').value);
    if (!a.length || !b.length) return alert('Each strut needs at least one force.');
    call('admin_save_stock', { p_150: a, p_100: b }, 'Stock saved');
  });
}

// ---------- settings ----------
function renderSettings() {
  const s = D.settings;
  const num = (id, label, v, hint) => `<div><label class="field" for="${id}">${label}</label><input class="inline" id="${id}" type="text" inputmode="numeric" value="${v}"><p class="note">${hint}</p></div>`;
  $('#body').innerHTML = `
    <div class="panel">
      <h2>Starting points</h2>
      <p class="lead">Only used for a size the app knows nothing about yet. Once there are results, it works from those instead.</p>
      <div class="grid2">
        ${num('start_150', 'First 150 strut to try (N)', s.start_150, 'Pick something that will almost certainly open it.')}
        ${num('start_100', 'First 100 strut to try (N)', s.start_100, 'Same idea for the 100 strut.')}
        ${num('drop_150', 'First step down, 150 (N)', s.drop_150, 'After the first one opens, how far to drop.')}
        ${num('drop_100', 'First step down, 100 (N)', s.drop_100, 'Same for the 100 strut.')}
        ${num('max_tests', 'Ask to stop after this many tries', s.max_tests, 'The tester can still carry on.')}
      </div>
      <button class="btn go" id="saveSet" style="max-width:300px">Save</button>
    </div>
    <div class="panel">
      <h2>PINs</h2>
      <p class="lead">4 to 12 digits. If you change the factory PIN, every phone will ask for the new one.</p>
      <div class="grid2">
        <div><label class="field" for="fpin">New factory PIN</label><input class="inline" id="fpin" inputmode="numeric" autocomplete="off">
          <button class="act" id="setF" style="margin-top:8px">Change factory PIN</button></div>
        <div><label class="field" for="apin">New admin PIN</label><input class="inline" id="apin" inputmode="numeric" autocomplete="off">
          <button class="act" id="setA" style="margin-top:8px">Change admin PIN</button></div>
      </div>
    </div>`;
  on('#saveSet', () => {
    const p = {}; for (const k of ['start_150', 'start_100', 'drop_150', 'drop_100', 'max_tests']) p[k] = parseInt($('#' + k).value, 10);
    if (Object.values(p).some(v => !(v > 0))) return alert('All settings must be positive numbers.');
    call('admin_save_settings', { p }, 'Settings saved');
  });
  on('#setF', () => { const v = $('#fpin').value.trim(); if (confirm('Change the factory PIN? Every phone will need the new one.')) call('admin_set_pin', { p_which: 'factory', p_new: v }, 'Factory PIN changed'); });
  on('#setA', async () => {
    const v = $('#apin').value.trim();
    if (!confirm('Change the admin PIN?')) return;
    try { await rpc('admin_set_pin', { p_pin: pin, p_which: 'admin', p_new: v }); pin = v; try { sessionStorage.setItem('st_admin_pin', v); } catch {} await load(); render(); toast('Admin PIN changed'); }
    catch (e) { alert(e.message); }
  });
}

$('#logout').addEventListener('click', () => { pin = null; try { sessionStorage.removeItem('st_admin_pin'); } catch {} showLogin(); });
(async () => {
  if (!pin) return showLogin();
  try { await load(); render(); } catch { showLogin(); }
})();
