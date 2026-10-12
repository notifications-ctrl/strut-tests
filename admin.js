// Admin page: results, CSV export, tester names, stock and settings.
const $ = sel => document.querySelector(sel);
const app = () => $('#app');
let pin = null; try { pin = sessionStorage.getItem('st_admin_pin'); } catch {}
let D = null;        // data from admin_data
let tab = 'results';
const open = new Set();

function on(sel, fn) { document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn)); }
function nameOf(id) { return D.testers.find(t => t.id === id)?.name || ''; }
function fmt(ts) { return ts ? new Date(ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
function cfgFromData() { return { stock150: D.stock150, stock100: D.stock100, settings: D.settings }; }
// Results use earlier rooflights too (same as the phones); values known only from those are marked *.
function resultFor(r) {
  const all = D.rooflights.map(x => ({ ...x, tests: testsFor(x.id) }));
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

function showLogin(msg) {
  $('#logout').style.visibility = 'hidden';
  app().innerHTML = `
    <h1>Admin</h1>
    <label class="field" for="pin">Admin PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" style="max-width:320px">
    <p class="err" id="err">${esc(msg || '')}</p>
    <button class="primary" id="go" style="max-width:320px">Open</button>`;
  const go = async () => {
    pin = $('#pin').value.trim();
    $('#err').textContent = 'Checking…';
    try { await load(); try { sessionStorage.setItem('st_admin_pin', pin); } catch {} render(); }
    catch (e) { pin = null; $('#err').textContent = e instanceof PinError ? 'That PIN is not right.' : e.message; }
  };
  on('#go', go);
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

async function load() { D = await rpc('admin_data', { p_pin: pin }); }

async function call(fn, args, okMsg) {
  try {
    await rpc(fn, { p_pin: pin, ...args });
    await load(); render(); if (okMsg) flash(okMsg);
  } catch (e) {
    if (e instanceof PinError) { pin = null; try { sessionStorage.removeItem('st_admin_pin'); } catch {} return showLogin('Please enter the PIN again.'); }
    alert(e.message);
  }
}
function flash(msg) { const el = $('#flash'); if (el) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 3000); } }

function render() {
  $('#logout').style.visibility = 'visible';
  const tabs = { results: 'Results', names: 'Names', stock: 'Stock', settings: 'Settings' };
  app().innerHTML = `
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button class="${tab === k ? 'sel' : 'secondary'}" data-tab="${k}">${v}</button>`).join('')}</div>
    <div class="notice ok" id="flash" style="display:none"></div>
    <div id="body"></div>`;
  on('[data-tab]', e => { tab = e.currentTarget.dataset.tab; render(); });
  ({ results: renderResults, names: renderNames, stock: renderStock, settings: renderSettings })[tab]();
}

// ---------- results ----------
function renderResults() {
  const cfg = cfgFromData();
  const rows = D.rooflights.map(r => {
    const ts = testsFor(r.id);
    const s = resultFor(r);
    const v = x => x === null ? '' : x;
    const main = `<tr class="lid" data-id="${r.id}">
      <td>${open.has(r.id) ? '▾' : '▸'} ${esc(r.reference)}</td><td>${r.length_mm} × ${r.width_mm}</td>
      <td>${r.anti_noise ? 'Yes' : 'No'}</td><td>${ts.length}</td>
      <td>${mark(s.h1.lowGood, s.h1.inferred?.good)}</td><td>${rangeText(s.h1.struggles)}</td><td>${mark(s.h1.highFail, s.h1.inferred?.fail)}</td>
      <td>${mark(s.h2.lowGood, s.h2.inferred?.good)}</td><td>${rangeText(s.h2.struggles)}</td><td>${mark(s.h2.highFail, s.h2.inferred?.fail)}</td>
      <td>${r.finished ? 'Finished' : 'Open'}</td><td>${esc(nameOf(r.tester_id))}</td><td>${fmt(r.created_at)}</td></tr>`;
    if (!open.has(r.id)) return main;
    const sub = ts.length ? `<table class="data"><tr><th>#</th><th>150 N</th><th>150 result</th><th>100 N</th><th>100 result</th><th>Long strut first?</th><th>Note</th><th>Tester</th><th>When</th></tr>
      ${ts.map(t => `<tr><td>${t.test_no}</td><td>${t.force_150}</td><td>${RATINGS[t.part1].label}</td><td>${t.force_100}</td><td>${RATINGS[t.part2].label}</td>
        <td>${t.seq_answer ? SEQ[t.seq_answer] : ''}</td><td style="white-space:normal">${esc(t.note)}</td>
        <td>${esc(nameOf(t.tester_id))}</td><td>${fmt(t.tested_at)}</td></tr>`).join('')}</table>` : '<p>No tests.</p>';
    return main + `<tr class="sub"><td colspan="13">${sub}
      <p><button class="small secondary" data-fin="${r.id}" data-v="${!r.finished}">${r.finished ? 'Reopen' : 'Mark finished'}</button>
      <button class="small danger" data-del="${r.id}">Delete this lid and its tests</button></p></td></tr>`;
  }).join('');
  $('#body').innerHTML = `
    <div class="row" style="max-width:640px">
      <button class="primary" id="csvTests">Download all tests (CSV)</button>
      <button class="primary" id="csvSum">Download summary (CSV)</button>
    </div>
    <button class="secondary small" id="reload">Refresh</button>
    <p class="hint">${D.rooflights.length} rooflights, ${D.tests.length} tries. Click a row to see its tries. * = known from earlier rooflights, not tested on this one.</p>
    <div class="wrap"><table class="data">
      <tr><th>Reference</th><th>Size mm</th><th>Anti-noise</th><th>Tries</th>
        <th>150 opens</th><th>150 struggles</th><th>150 doesn't open</th><th>100 opens</th><th>100 struggles</th><th>100 doesn't open</th><th>Status</th><th>Tester</th><th>Started</th></tr>
      ${rows || '<tr><td colspan="13">No results yet.</td></tr>'}
    </table></div>`;
  on('tr.lid', e => { const id = e.currentTarget.dataset.id; open.has(id) ? open.delete(id) : open.add(id); renderResults(); });
  on('[data-fin]', e => call('admin_set_finished', { p_id: e.currentTarget.dataset.fin, p_finished: e.currentTarget.dataset.v === 'true' }, 'Updated.'));
  on('[data-del]', e => { if (confirm('Delete this lid and all its tests? This cannot be undone.')) call('admin_delete_rooflight', { p_id: e.currentTarget.dataset.del }, 'Deleted.'); });
  on('#reload', async () => { await load(); render(); });
  on('#csvTests', () => downloadCsv('strut-tests.csv', testsCsv()));
  on('#csvSum', () => downloadCsv('strut-summary.csv', summaryCsv()));
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
    <h2>Tester names</h2>
    <p class="hint">Hidden names stay on old results but don't appear on the phones.</p>
    <div class="wrap"><table class="data" style="max-width:640px">
      <tr><th>Name</th><th>Shown on phones</th><th></th></tr>
      ${D.testers.map(t => `<tr><td><input class="inline" data-name="${t.id}" value="${esc(t.name)}"></td>
        <td>${t.active ? 'Yes' : 'No'}</td>
        <td><button class="small secondary" data-save="${t.id}">Save name</button>
            <button class="small secondary" data-act="${t.id}" data-v="${!t.active}">${t.active ? 'Hide' : 'Show'}</button></td></tr>`).join('')}
    </table></div>
    <h2>Add a name</h2>
    <div class="row" style="max-width:640px"><input class="inline" id="newName" placeholder="Name"><button class="primary" id="add" style="margin:0">Add</button></div>`;
  on('#add', () => { const n = $('#newName').value.trim(); if (n) call('admin_save_tester', { p_id: null, p_name: n, p_active: true }, 'Added.'); });
  on('[data-save]', e => { const id = e.currentTarget.dataset.save; call('admin_save_tester', { p_id: id, p_name: document.querySelector(`[data-name="${id}"]`).value, p_active: null }, 'Saved.'); });
  on('[data-act]', e => { const id = e.currentTarget.dataset.act; const t = D.testers.find(x => x.id === id);
    call('admin_save_tester', { p_id: id, p_name: t.name, p_active: e.currentTarget.dataset.v === 'true' }, 'Saved.'); });
}

// ---------- stock ----------
function renderStock() {
  $('#body').innerHTML = `
    <h2>Struts we hold</h2>
    <p class="hint">Forces in newtons, separated by commas or spaces. Suggestions only use these.</p>
    <div class="grid2">
      <div><label class="field" for="s150">150mm stroke</label><textarea id="s150" rows="5">${D.stock150.join(', ')}</textarea></div>
      <div><label class="field" for="s100">100mm stroke</label><textarea id="s100" rows="5">${D.stock100.join(', ')}</textarea></div>
    </div>
    <button class="primary" id="saveStock" style="max-width:320px">Save stock</button>`;
  const parse = s => [...new Set(s.split(/[\s,;]+/).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  on('#saveStock', () => {
    const a = parse($('#s150').value), b = parse($('#s100').value);
    if (!a.length || !b.length) return alert('Each stroke needs at least one force.');
    call('admin_save_stock', { p_150: a, p_100: b }, 'Stock saved.');
  });
}

// ---------- settings ----------
function renderSettings() {
  const s = D.settings;
  const num = (id, label, v, hint) => `<div><label class="field" for="${id}">${label}</label><input class="inline" id="${id}" type="number" value="${v}">${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
  $('#body').innerHTML = `
    <h2>Test settings</h2>
    <div class="grid2">
      ${num('start_150', 'Starting 150mm force (N)', s.start_150)}
      ${num('start_100', 'Starting 100mm force (N)', s.start_100)}
      ${num('drop_150', '150mm first drop (N)', s.drop_150, 'After a pass with no fail yet, go down by this much.')}
      ${num('drop_100', '100mm first drop (N)', s.drop_100)}
      ${num('max_tests', 'Tests per lid before asking to stop', s.max_tests)}
    </div>
    <button class="primary" id="saveSet" style="max-width:320px">Save settings</button>
    <h2>PINs</h2>
    <p class="hint">4 to 12 digits. After changing the factory PIN, each phone asks for the new one.</p>
    <div class="grid2">
      <div><label class="field" for="fpin">New factory PIN</label><input class="inline" id="fpin" inputmode="numeric" autocomplete="off">
        <button class="secondary" id="setF">Change factory PIN</button></div>
      <div><label class="field" for="apin">New admin PIN</label><input class="inline" id="apin" inputmode="numeric" autocomplete="off">
        <button class="secondary" id="setA">Change admin PIN</button></div>
    </div>`;
  on('#saveSet', () => {
    const p = {}; for (const k of ['start_150', 'start_100', 'drop_150', 'drop_100', 'max_tests']) p[k] = parseInt($('#' + k).value, 10);
    if (Object.values(p).some(v => !(v > 0))) return alert('All settings must be positive numbers.');
    call('admin_save_settings', { p }, 'Settings saved.');
  });
  on('#setF', () => { const v = $('#fpin').value.trim(); if (confirm('Change the factory PIN? Every phone will need the new one.')) call('admin_set_pin', { p_which: 'factory', p_new: v }, 'Factory PIN changed.'); });
  on('#setA', async () => {
    const v = $('#apin').value.trim();
    if (!confirm('Change the admin PIN?')) return;
    try { await rpc('admin_set_pin', { p_pin: pin, p_which: 'admin', p_new: v }); pin = v; try { sessionStorage.setItem('st_admin_pin', v); } catch {} await load(); render(); flash('Admin PIN changed.'); }
    catch (e) { alert(e.message); }
  });
}

$('#logout').addEventListener('click', () => { pin = null; try { sessionStorage.removeItem('st_admin_pin'); } catch {} showLogin(); });
(async () => {
  if (!pin) return showLogin();
  try { await load(); render(); } catch { showLogin(); }
})();
