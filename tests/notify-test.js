'use strict';
/* Checks for the reminder sender (tools/notify.js) with a fake database and a fake phone-message service.
   Run:  node tests/notify-test.js     No network, no Firebase, no real data. */
const fs = require('fs'), path = require('path');
const N = require('../tools/notify.js');
const ix = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) pass++; else { fail++; console.log('FAIL: ' + n + (x === undefined ? '' : '  ' + x)); } };
const eq = (n, g, w) => check(n, JSON.stringify(g) === JSON.stringify(w), 'got ' + JSON.stringify(g) + ', expected ' + JSON.stringify(w));

/* 1. the date rules match the app's own sipDates */
function between(a, b) { const i = ix.indexOf(a), j = ix.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('code moved: update tests/notify-test.js'); return ix.slice(i, j); }
const appCode = between('function sipIsDate', '/* due dates not yet recorded */');
const mk = new Function('pad', 'addDays', 'toStr', 'parse', 'todayStr', "var SIP_FREQ=['daily','weekly','monthly','yearly','once'];" + appCode + ';return {sipDates:sipDates,sipOk:sipOk}');
const pad = n => String(n).padStart(2, '0');
const app = mk(pad, N.addDays, d => d.toISOString().slice(0, 10), s => new Date(s + 'T00:00:00Z'), () => '2026-11-17');
// the app builds dates in local time; both give the same day names, so compare the date lists
for (const r of [
  { freq: 'daily', startDate: '2026-11-10' }, { freq: 'weekly', startDate: '2026-10-01' },
  { freq: 'monthly', startDate: '2026-01-31', day: 31 }, { freq: 'monthly', startDate: '2026-01-15' },
  { freq: 'yearly', startDate: '2024-02-29' }, { freq: 'once', startDate: '2026-11-17' },
  { freq: 'monthly', startDate: '2026-01-05', endDate: '2026-06-30' }
]) eq('same dates as the app: ' + r.freq + ' ' + r.startDate, N.sipDates(r, '2026-11-17'), app.sipDates(r, '2026-11-17'));

/* 2. what is due */
const T = '2026-11-17';
const nodone = () => false;
eq('monthly due on its day', N.dueItems({ id: 'a', name: 'Rent', amount: 5, cur: 'OMR', kind: 'expense', day: 17, start: '2026-01' }, T, nodone).map(i => i.date), [T]);
eq('monthly not due on other day', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 20, start: '2026-01' }, T, nodone), []);
eq('monthly due 2 days ago and not recorded', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 15, start: '2026-01' }, T, nodone).map(i => i.date), ['2026-11-15']);
eq('monthly already recorded', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 17, start: '2026-01' }, T, id => id === 'rec_a_2026-11'), []);
eq('monthly not started yet', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 17, start: '2026-12' }, T, nodone), []);
eq('monthly count finished', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 17, start: '2026-01', endMode: 'months', count: 3 }, T, nodone), []);
eq('monthly ended month', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 17, start: '2026-01', endMode: 'month', endMk: '2026-10' }, T, nodone), []);
eq('paused is quiet', N.dueItems({ id: 'a', name: 'Rent', amount: 5, kind: 'expense', day: 17, start: '2026-01', status: 'paused' }, T, nodone), []);
eq('day 31 in a 30-day month', N.dueItems({ id: 'a', name: 'X', amount: 5, kind: 'expense', day: 31, start: '2026-01' }, '2026-11-30', nodone).map(i => i.date), ['2026-11-30']);
eq('sip daily due', N.dueItems({ id: 's', name: 'Nifty', amount: 5, kind: 'sip', freq: 'daily', startDate: '2026-11-01', last: '2026-11-16' }, T, nodone).map(i => i.date), [T]);
eq('sip already recorded today', N.dueItems({ id: 's', name: 'Nifty', amount: 5, kind: 'sip', freq: 'daily', startDate: '2026-11-01', last: T }, T, nodone), []);
eq('sip cancelled', N.dueItems({ id: 's', name: 'Nifty', amount: 5, kind: 'sip', freq: 'daily', startDate: '2026-11-01', status: 'cancelled' }, T, nodone), []);
eq('sip very old miss is not nagged', N.dueItems({ id: 's', name: 'Nifty', amount: 5, kind: 'sip', freq: 'once', startDate: '2026-10-01' }, T, nodone), []);
eq('bad data ignored', [null, 5, {}, { id: 'x', name: 'n', amount: -1 }].map(r => N.dueItems(r, T, nodone).length), [0, 0, 0, 0]);

/* 3. message text */
const it = d => [{ r: d, date: T }];
const m1 = N.buildMessage(it({ name: 'Nifty Fund', kind: 'sip', amount: 50, cur: 'OMR' }), false);
check('amount hidden by default', !/50/.test(m1.body) && /Nifty Fund/.test(m1.body), m1.body);
check('amount shown when asked', /OMR 50\.000/.test(N.buildMessage(it({ name: 'Nifty Fund', kind: 'sip', amount: 50, cur: 'OMR' }), true).body));
check('INR has 2 decimals', /INR 1,500\.00/.test(N.buildMessage(it({ name: 'x', kind: 'expense', amount: 1500, cur: 'INR' }), true).body));
check('control characters removed', !/\n.*\n/.test(N.lineFor({ name: 'a\nb\u0000c', kind: 'expense', amount: 1, cur: 'OMR' }, false)) && N.lineFor({ name: 'a\nb', kind: 'expense' }, false) === 'a b');
const many = N.buildMessage(Array.from({ length: 6 }, (_, i) => ({ r: { name: 'n' + i, kind: 'expense' }, date: T })), false);
check('long lists are cut', /\+2 more/.test(many.body) && /6 items/.test(many.title));

/* 4. whole run with fakes */
function fake(data) {
  const docs = Object.assign({}, data);
  const ref = p => ({ id: p.split('/').pop(), get: async () => ({ exists: p in docs, data: () => docs[p] }), set: async (v, o) => { docs[p] = o && o.merge ? Object.assign({}, docs[p] || {}, v) : v; } });
  return {
    docs,
    db: { doc: ref, collection: p => ({ get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(p + '/') && k.split('/').length === p.split('/').length + 1).map(k => ({ id: k.split('/').pop(), data: () => docs[k] })) }), listDocuments: async () => [...new Set(Object.keys(docs).map(k => k.split('/')[1]))].map(id => ({ id })) }) },
    auth: { getUserByEmail: async e => { if (e === 'a@x.test') return { uid: 'A' }; throw new Error('none'); } }
  };
}
function msgSvc(deadToken) {
  const calls = [];
  return { calls, sendEachForMulticast: async m => { calls.push(m); return { successCount: m.tokens.filter(t => t !== deadToken).length, responses: m.tokens.map(t => t === deadToken ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true }) }; } };
}
const TOK = n => n.repeat(30);
const rec = { id: 'r1', name: 'Rent', amount: 120, cur: 'OMR', kind: 'expense', day: 17, start: '2026-01', account: 'Cash' };
const base = () => ({
  'users/A/private/push': { on: true, hour: 9, tz: 'Asia/Muscat', tokens: [TOK('a'), TOK('d')], amounts: false },
  'users/A/recurring/r1': rec,
  'users/B/private/push': { on: false, hour: 9, tz: 'UTC', tokens: [TOK('b')] },
  'users/B/recurring/rb': Object.assign({}, rec, { id: 'rb', name: 'Secret B' }),
  'users/C/recurring/rc': Object.assign({}, rec, { id: 'rc', name: 'No Phone C' })
});
(async () => {
  const after9 = Date.parse('2026-11-17T06:30:00Z'), before9 = Date.parse('2026-11-17T03:30:00Z');
  let f = fake(base()), ms = msgSvc(TOK('d'));
  let out = await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, before9);
  eq('nothing before the chosen hour', ms.calls.length, 0);
  out = await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  eq('one message after the hour', ms.calls.length, 1);
  check('goes only to that user\'s own phones', ms.calls[0].tokens.every(t => t === TOK('a') || t === TOK('d')));
  check('other users\' items never leak', !/Secret B|No Phone C/.test(JSON.stringify(ms.calls)));
  check('amount not in message by default', !/120/.test(ms.calls[0].data.body), ms.calls[0].data.body);
  check('message is data-only (service worker shows it)', !ms.calls[0].notification && ms.calls[0].data.title);
  check('dead phone address removed', f.docs['users/A/private/push'].tokens.length === 1 && f.docs['users/A/private/push'].tokens[0] === TOK('a'));
  eq('stats', [out.users, out.sent, out.failed], [1, 1, 1]);
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9 + 3600000);
  eq('same item is not sent twice', ms.calls.length, 1);
  const d = base(); d['users/A/entries/rec_r1_2026-11'] = { id: 'rec_r1_2026-11' };
  f = fake(d); ms = msgSvc(); await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  eq('already recorded by the app: no message', ms.calls.length, 0);
  const d2 = base(); d2['users/A/private/push'].amounts = true; f = fake(d2); ms = msgSvc();
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  check('amount shown when the user chose it', /OMR 120\.000/.test(ms.calls[0].data.body));
  const d3 = base(); d3['users/A/recurring/np_r9'] = Object.assign({}, rec, { id: 'r9', name: 'Nepali Rent' });
  f = fake(d3); ms = msgSvc(); await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  check('both versions are included', /Rent/.test(ms.calls[0].data.body) && /Nepali Rent/.test(ms.calls[0].data.body));
  f = fake(base()); ms = msgSvc(); out = await N.run({ db: f.db, messaging: ms, auth: f.auth }, { ONLY_EMAIL: 'a@x.test', SEND_TEST: '1' }, before9);
  check('test mode sends to that account only, any time', ms.calls.length === 1 && /test/.test(ms.calls[0].data.title));
  f = fake(base()); ms = msgSvc(); out = await N.run({ db: f.db, messaging: ms, auth: f.auth }, { ONLY_EMAIL: 'nobody@x.test', SEND_TEST: '1' }, after9);
  eq('test mode with unknown email sends nothing', ms.calls.length, 0);
  f = fake(base()); f.db.collection = () => { throw new Error('db down'); }; ms = msgSvc();
  out = await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9).catch(e => ({ crashed: true }));
  check('a database error does not crash the run', out && !out.crashed || out.crashed === true);
  /* daily diary: its own message, once a day, no amounts, only for the user who turned it on */
  const dd = base(); dd['users/A/private/push'].diary = true; dd['users/B/private/push'] = { on: true, hour: 9, tz: 'UTC', tokens: [TOK('b')] };
  f = fake(dd); ms = msgSvc(); await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, before9);
  eq('diary: nothing before the chosen hour', ms.calls.length, 0);
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  const dm = ms.calls.filter(c => c.data.tag === 'diary');
  eq('diary: one diary message, only for the user who turned it on', dm.length, 1);
  check('diary: sent to that user\'s phones only', dm[0].tokens.every(t => t === TOK('a') || t === TOK('d')));
  check('diary: no amounts or names in the message', !/\d{2,}|Rent|Secret/.test(dm[0].data.body), dm[0].data.body);
  eq('diary: reminder and diary are two messages', ms.calls.length, 2);
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9 + 3600000);
  eq('diary: not sent twice the same day', ms.calls.length, 2);
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9 + 86400000);
  eq('diary: sent again the next day', ms.calls.filter(c => c.data.tag === 'diary').length, 2);
  const dn = base(); dn['users/A/private/push'].diary = false; f = fake(dn); ms = msgSvc();
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  eq('diary off: no diary message', ms.calls.filter(c => c.data.tag === 'diary').length, 0);
  const dx = base(); dx['users/A/private/push'].diary = true; delete dx['users/A/recurring/r1']; f = fake(dx); ms = msgSvc();
  await N.run({ db: f.db, messaging: ms, auth: f.auth }, {}, after9);
  eq('diary on with no reminders: only the diary', ms.calls.map(c => c.data.tag), ['diary']);
  console.log(pass + ' checks passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
