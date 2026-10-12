// Supabase connection. The publishable key is meant to be public; the database
// only accepts calls to PIN-checked functions, so it cannot read or change tables directly.
const SUPABASE_URL = 'https://bgfeorrywajmbtvjfbyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2oq5m99WZw9tDhi6SJFpaw_PR8PLKK3';

class PinError extends Error {}
class LockedError extends Error {}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Server error ${res.status}: ${text.slice(0, 200)}`);
    err.server = true;
    throw err;
  }
  const data = await res.json();
  if (data && data.error === 'pin') throw new PinError('Wrong PIN');
  if (data && data.error === 'locked') throw new LockedError('Too many wrong PINs. Wait 10 minutes.');
  if (data && data.error) { const e = new Error(data.error); e.server = true; throw e; }
  return data;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
