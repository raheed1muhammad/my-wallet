'use strict';
/* My Wallet checks. Run:  node tests/run.js
   They take the REAL functions out of index.html / cloud.js and run them with simple stand-ins.
   No network, no Firebase, no personal data. Exit code 1 if anything fails. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const ix = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cj = fs.readFileSync(path.join(root, 'cloud.js'), 'utf8');
let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, extra) { if (ok) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : '  ' + extra)); } }
function eq(name, got, want) { check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)); }
function between(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + 1);
  if (i < 0 || j < 0) throw new Error('Cannot find code between "' + a + '" and "' + b + '". The code was reshaped: update tests/run.js.');
  return src.slice(i, j);
}
function one(src, re, what) { const m = src.match(re); if (!m) throw new Error('Cannot find ' + what + ' in the code: update tests/run.js.'); return m[0]; }
function section(t) { console.log('- ' + t); }

/* ---------- 1. escaping and CSV ---------- */
function testEscAndCsv() {
  section('escaping and CSV');
  const esc = new Function(one(ix, /function esc\(s\)\{[^\n]*\}/, 'esc') + ';return esc')();
  eq('esc quotes and tags', esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  eq('esc null', esc(null), '');
  const csv = new Function(one(ix, /function csvCell\(v\)\{[^\n]*\}/, 'csvCell') + ';return csvCell')();
  eq('csv number kept', csv(-5), '-5');
  eq('csv zero kept', csv(0), '0');
  eq('csv numeric text kept', csv('-2.000'), '-2.000');
  eq('csv formula blocked', csv('=HYPERLINK("http://x","a")').charAt(0), '"');
  check('csv formula gets a quote mark', csv('=1+1') === "'=1+1");
  check('csv @ blocked', csv('@SUM(A1)') === "'@SUM(A1)");
  check('csv minus text blocked', csv('-2+3') === "'-2+3");
  eq('csv normal text kept', csv('Salary'), 'Salary');
  eq('csv comma quoted', csv('Food, drinks'), '"Food, drinks"');
  eq('csv quote doubled', csv('say "hi"'), '"say ""hi"""');
  eq('csv null empty', csv(null), '');
}

/* ---------- 2. money and balances ---------- */
function testMoney() {
  section('money and balances');
  const code = [
    'var FMT={OMR:new Intl.NumberFormat("en-US",{minimumFractionDigits:3,maximumFractionDigits:3}),INR:new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})};',
    between(ix, 'function rnd(', 'function esc('),
    between(ix, 'function accOf(', 'function balanceOf('),
    one(ix, /function balanceOf\(acc,cur,until\)\{[\s\S]*?\n\}/, 'balanceOf')
  ].join('\n');
  const ctxSrc = code + `
    var allowsCur=typeof allowsCur==='function'?allowsCur:function(a,c){return true};
    return {rnd:rnd,money:money,accOf:accOf,balanceOf:balanceOf,set:function(acc,ent,open){ACCS=acc;S.entries=ent;S.opening=open||{}}};`;
  const pre = 'var ACCS=["Cash","Bank Muscat","Federal Bank"],S={entries:[],opening:{}};var allowsCur=function(a,c){return true};var curs=function(){return ["OMR","INR"]};';
  const api = new Function(pre + code + '\nreturn {rnd:rnd,money:money,accOf:accOf,balanceOf:balanceOf,set:function(a,e,o){ACCS=a;S.entries=e;S.opening=o||{}}};')();
  eq('rnd OMR 3 decimals', api.rnd(0.1 + 0.2, 'OMR'), 0.3);
  eq('rnd INR 2 decimals', api.rnd(10.126, 'INR'), 10.13);
  check('rnd never gives -0', Object.is(api.rnd(-0.0004, 'OMR'), 0));
  eq('money OMR', api.money(1234.5, 'OMR'), 'OMR 1,234.500');
  check('money negative uses minus sign', api.money(-5, 'OMR').charAt(0) === '−');
  check('money INR has rupee sign', api.money(1500, 'INR').indexOf('₹') === 0);
  eq('unknown account counted as Cash', api.accOf({ account: 'Deleted Bank' }), 'Cash');
  eq('known account kept', api.accOf({ account: 'Bank Muscat' }), 'Bank Muscat');
  const ACC = ['Cash', 'Bank Muscat', 'Federal Bank'];
  const E = (o) => Object.assign({ date: '2026-11-01', currency: 'OMR' }, o);
  api.set(ACC, [E({ type: 'income', account: 'Bank Muscat', amount: 100 }), E({ type: 'expense', account: 'Bank Muscat', amount: 30.5 })], { 'Bank Muscat': { OMR: 10 } });
  eq('opening + income - expense', api.balanceOf('Bank Muscat', 'OMR', '2026-12-31'), 79.5);
  eq('other account untouched', api.balanceOf('Cash', 'OMR', '2026-12-31'), 0);
  eq('all accounts add up', api.balanceOf('all', 'OMR', '2026-12-31'), 79.5);
  eq('later entries not counted yet', api.balanceOf('Bank Muscat', 'OMR', '2026-10-31'), 10);
  api.set(ACC, [E({ type: 'income', account: 'Cash', amount: 50 }), E({ type: 'transfer', from: 'Cash', to: 'Bank Muscat', amount: 20 })]);
  eq('transfer leaves source', api.balanceOf('Cash', 'OMR', '2026-12-31'), 30);
  eq('transfer reaches target', api.balanceOf('Bank Muscat', 'OMR', '2026-12-31'), 20);
  eq('transfer keeps the total', api.balanceOf('all', 'OMR', '2026-12-31'), 50);
  api.set(ACC, [E({ type: 'income', account: 'Cash', amount: 50 }), E({ type: 'transfer', from: 'Cash', to: 'Bank Muscat', amount: 20, fee: 0.5, feeOn: 'from' })]);
  eq('transfer fee comes off the total', api.balanceOf('all', 'OMR', '2026-12-31'), 49.5);
  api.set(ACC, [E({ type: 'income', account: 'Cash', amount: 10 }), E({ type: 'transfer', from: 'Cash', to: 'Federal Bank', amount: 5, toCurrency: 'INR', toAmount: 1100 })]);
  eq('cross-currency: source OMR', api.balanceOf('Cash', 'OMR', '2026-12-31'), 5);
  eq('cross-currency: target gets INR', api.balanceOf('Federal Bank', 'INR', '2026-12-31'), 1100);
  eq('cross-currency: target has no OMR', api.balanceOf('Federal Bank', 'OMR', '2026-12-31'), 0);
  api.set(ACC, [E({ type: 'income', account: 'Cash', amount: 100 }), E({ type: 'loan', kind: 'lend', account: 'Cash', amount: 40, person: 'A' }), E({ type: 'loan', kind: 'collect', account: 'Cash', amount: 15, person: 'A' })]);
  eq('lend reduces, collect adds back', api.balanceOf('Cash', 'OMR', '2026-12-31'), 75);
  api.set(ACC, [E({ type: 'income', account: 'Cash', amount: 100 }), E({ type: 'loan', kind: 'borrow', account: 'Cash', amount: 30, person: 'B' }), E({ type: 'loan', kind: 'repay', account: 'Cash', amount: 10, person: 'B' })]);
  eq('borrow adds, repay reduces', api.balanceOf('Cash', 'OMR', '2026-12-31'), 120);
  api.set(ACC, [E({ type: 'income', account: 'Cash', amount: 100 }), E({ type: 'sip', kind: 'invest', account: 'Cash', amount: 25 }), E({ type: 'sip', kind: 'draw', account: 'Cash', amount: 5 })]);
  eq('SIP invest reduces, draw adds', api.balanceOf('Cash', 'OMR', '2026-12-31'), 80);
}

/* ---------- 3. restoring a backup file ---------- */
async function testRestore() {
  section('restore from backup (hostile IDs)');
  const validEntrySrc = one(ix, /function validEntry\(e\)\{[\s\S]*?\n\}/, 'validEntry');
  const handler = one(ix, /\$\('#restore-file'\)\.addEventListener\('change',function\(\)\{[\s\S]*?reader\.readAsText\(file\);\n\}\);/, 'restore handler');
  const good = id => ({ id, type: 'expense', currency: 'OMR', amount: 1.5, date: '2026-11-06', category: 'Test', note: 'x' });
  function run(backup) {
    return new Promise(done => {
      const writes = [], toasts = []; let fn;
      const S = { entries: [], rates: [], db: { collection: c => ({ doc: id => ({ set: () => { writes.push(c + '/' + id); return Promise.resolve(); } }) }), doc: p => ({ set: () => { writes.push(p); return Promise.resolve(); } }) } };
      const REC = [], recSaveOne = r => { writes.push('recurring/' + r.id); return Promise.resolve(); }, curMk = () => '2026-11';
      const render = () => { }, persistLocal = () => { }, askOkP = () => Promise.resolve(true);
      const toast = m => { toasts.push(m); setTimeout(() => done({ writes, toasts }), 15); };
      const FileReader = function () { this.readAsText = function () { this.result = JSON.stringify(backup); this.onload(); }; };
      const $ = () => ({ addEventListener: (e, f) => { fn = f; } });
      new Function('S', 'REC', 'recSaveOne', 'curMk', 'render', 'persistLocal', 'askOkP', 'toast', 'FileReader', '$', validEntrySrc + '\n' + handler + '\n return 1;')(S, REC, recSaveOne, curMk, render, persistLocal, askOkP, toast, FileReader, $);
      fn.call({ files: [{}], value: '' });
    });
  }
  const r1 = await run({ app: 'My Wallet', formatVersion: 1, entries: [good('e1abc'), good('r-12_x.y')], rates: [{ d: '2026-11-06', r: 9.9 }], plans: { '2026-11': { a: 1 } }, recurring: [{ id: 'rec1', name: 'Rent', amount: 5 }] });
  check('normal backup: all written', ['entries/e1abc', 'entries/r-12_x.y', 'rates/2026-11-06', 'plans/2026-11', 'recurring/rec1'].every(x => r1.writes.includes(x)), r1.writes.join(','));
  check('normal backup: nothing skipped', r1.toasts[0].indexOf('skipped') < 0, r1.toasts[0]);
  const r2 = await run({ app: 'My Wallet', formatVersion: 1, entries: [good('ok1'), good('x" onmouseover="alert(1)'), good('a/b/c'), good('<img src=x onerror=alert(1)>'), good(undefined), good('A'.repeat(200))], rates: [{ d: '2026-11-06/../private/xchkey', r: 9 }], plans: { '../../config/signup': { x: 1 } }, recurring: [{ id: 'evil" x="', name: 'Bad', amount: 5 }] });
  eq('hostile backup: only the safe entry written', r2.writes, ['entries/ok1']);
  check('hostile backup: user told how many skipped', r2.toasts[0].indexOf('5 skipped') > -1, r2.toasts[0]);
  const r3 = await run({ app: 'My Wallet', formatVersion: 1, entries: [good('q"q'), good('w/w')] });
  eq('all-hostile backup: nothing written', r3.writes, []);
}

/* ---------- 4. account / settings patch ---------- */
function testPatch() {
  section('settings patch (two phones cannot erase each other)');
  const applyPatch = new Function(between(cj, 'function applyPatch', 'window.__cloudPatch') + ';return applyPatch')();
  const J = o => JSON.stringify(o), start = J({ profile: { name: 'R' }, accounts: [], closed: [], showClosed: false });
  let cloud = start;
  const apply = op => { cloud = J(applyPatch(cloud, op)); return JSON.parse(cloud); };
  apply({ type: 'addAccount', name: 'Savings X', cur: 'OMR' });
  let c = apply({ type: 'addAccount', name: 'Wallet Y', cur: 'INR' });
  eq('both added accounts kept', c.accounts.map(a => a.name), ['Savings X', 'Wallet Y']);
  c = apply({ type: 'addAccount', name: 'savings x', cur: 'OMR' });
  eq('same name in other case ignored', c.accounts.length, 2);
  apply({ type: 'closeAccount', name: 'Federal Bank' }); c = apply({ type: 'closeAccount', name: 'Bank Muscat' });
  c = apply({ type: 'closeAccount', name: 'Bank Muscat' });
  eq('close twice keeps one', c.closed, ['Federal Bank', 'Bank Muscat']);
  c = apply({ type: 'reopenAccount', name: 'Federal Bank' });
  eq('reopen only that one', c.closed, ['Bank Muscat']);
  c = apply({ type: 'profile', name: 'Raheed', country: 'Oman' });
  eq('profile saved, accounts untouched', [c.profile, c.accounts.length], [{ name: 'Raheed', country: 'Oman' }, 2]);
  c = apply({ type: 'showClosed', value: true });
  eq('showClosed saved', c.showClosed, true);
  eq('broken cloud copy gives safe defaults', JSON.parse(J(applyPatch('{{not json', { type: 'closeAccount', name: 'Cash' }))).closed, ['Cash']);
  eq('array as cloud copy gives safe defaults', applyPatch('[1,2]', { type: 'addAccount', name: 'Z', cur: 'OMR' }).accounts.length, 1);
  eq('long profile name is cut', applyPatch(start, { type: 'profile', name: 'x'.repeat(100), country: '' }).profile.name.length, 40);
}

/* ---------- 5. save counter and status line ---------- */
async function testSave() {
  section('save counter and status line');
  const log = [];
  global.window = { dispatchEvent: e => log.push(e.detail) };
  global.CustomEvent = function (n, o) { this.detail = o.detail; };
  Object.defineProperty(global, 'navigator', { value: { onLine: true }, writable: true, configurable: true });
  new Function(between(cj, 'var SAVE=', 'function dsnap') + ';global.soft=soft;')();
  const st = () => global.window.__saveState();
  await global.soft(Promise.resolve()); await sleep(5);
  eq('normal save leaves nothing pending', st(), { pending: 0, failed: 0 });
  let err = ''; await global.soft(Promise.reject(new Error('permission-denied'))).catch(e => err = e.message); await sleep(5);
  eq('refused save is counted', st(), { pending: 0, failed: 1 });
  eq('caller still receives the error', err, 'permission-denied');
  global.window.__saveClear(); eq('dismiss clears the count', st(), { pending: 0, failed: 0 });
  navigator.onLine = false; let rel = false, res; const q = new Promise(r => { res = r; });
  global.soft(q).then(() => rel = true); await sleep(5);
  check('offline: caller released at once', rel); eq('offline: save waits as pending', st(), { pending: 1, failed: 0 });
  navigator.onLine = true; res(); await sleep(5); eq('after sync nothing pending', st(), { pending: 0, failed: 0 });
  // status text
  const src = between(ix, 'function syncText()', "$('#sync').addEventListener");
  const el = { textContent: '', a: {}, setAttribute(k, v) { this.a[k] = v; }, removeAttribute(k) { delete this.a[k]; } };
  const S = { mode: 'cloud' }, $ = () => el, toasts = [], toast = m => toasts.push(m), listeners = {};
  global.window.addEventListener = (n, f) => { listeners[n] = f; };
  new Function('S', '$', 'toast', 'window', 'navigator', 'setTimeout', src + ';')(S, $, toast, global.window, global.navigator, setTimeout);
  const fire = (p, f) => listeners.walletsave({ detail: { pending: p, failed: f } });
  fire(0, 0); eq('idle: line hidden', [el.textContent, !!el.a['data-st']], ['', false]);
  fire(1, 0); eq('quick save: no flicker', el.textContent, '');
  await sleep(1700); check('slow save: shows Saving', el.textContent.indexOf('Saving 1 change') === 0, el.textContent);
  fire(0, 0); eq('saved: hidden again', el.textContent, '');
  fire(0, 1); check('refused: warning line', el.textContent.indexOf('1 change not saved') > -1 && el.a['data-st'] === 'fail', el.textContent);
  fire(0, 1); eq('same failure: only one toast', toasts.length, 1);
  fire(0, 0); navigator.onLine = false; fire(2, 0);
  check('offline with 2 waiting', el.textContent.indexOf('Offline. 2 changes') === 0, el.textContent);
  navigator.onLine = true; S.mode = 'local'; fire(0, 0); eq('this-device-only mode stays hidden', !!el.a['data-st'], false);
}

/* ---------- 6. sign-out erases the offline copy ---------- */
async function testSignOut() {
  section('sign-out erases the offline database copy');
  const src = between(cj, 'function wipeDb()', '/* ---------- db shim');
  const timeoutSrc = one(cj, /function timeout\(p,ms\)\{[^\n]*\}/, 'timeout');
  function make(o) {
    const log = [], dbs = o.dbs || ['firestore/[DEFAULT]/proj/main', 'other-site-db'];
    const env = {
      log, timeoutSrc, fs: {}, auth: {}, RELOADK: 'r',
      terminate: () => { log.push('terminate'); return o.hang ? new Promise(() => { }) : Promise.resolve(); },
      clearIndexedDbPersistence: () => { log.push('clear'); return o.clearFails ? Promise.reject(new Error('x')) : Promise.resolve(); },
      signOut: () => { log.push('signOut'); return Promise.resolve(); },
      wipeLocal: () => log.push('wipeLocal'),
      sessionStorage: { removeItem: () => { } },
      location: { reload: () => log.push('reload') },
      confirm: () => { log.push('asked'); return o.answer !== false; },
      indexedDB: { databases: () => Promise.resolve(dbs.map(name => ({ name }))), deleteDatabase: n => log.push('deleted ' + n) },
      window: { __saveState: () => ({ pending: o.pending || 0, failed: 0 }) },
      navigator: { onLine: o.offline ? false : true }
    };
    const names = Object.keys(env);
    const fn = new Function(...names, timeoutSrc + src + '\nreturn doSignOut;')(...names.map(k => env[k]));
    return { go: fn, log };
  }
  let t = make({}); t.go(); await sleep(60);
  eq('normal: erases then wipes then reloads', t.log, ['signOut', 'terminate', 'clear', 'wipeLocal', 'reload']);
  t = make({ clearFails: true }); t.go(); await sleep(60);
  check('clear fails: only Firestore databases deleted', t.log.includes('deleted firestore/[DEFAULT]/proj/main') && !t.log.includes('deleted other-site-db'), t.log.join(','));
  check('clear fails: still signs out and reloads', t.log.includes('wipeLocal') && t.log[t.log.length - 1] === 'reload', t.log.join(','));
  t = make({ pending: 2, answer: false }); t.go(); await sleep(30);
  eq('unsynced changes + user says no: nothing happens', t.log, ['asked']);
  t = make({ offline: true, answer: true }); t.go(); await sleep(60);
  check('offline + user says yes: signs out', t.log[0] === 'asked' && t.log.includes('reload'), t.log.join(','));
  t = make({ hang: true }); const t0 = Date.now(); t.go();
  await sleep(4400); check('erase hangs: gives up after about 4 seconds and still reloads', t.log.includes('reload') && Date.now() - t0 < 6000, t.log.join(','));
  check('robots noindex present', /<meta name="robots" content="noindex,nofollow">/.test(ix));
  check('no page-wide no-referrer (it would break the API key lock)', !/<meta[^>]+name=["']referrer["']/i.test(ix));
  check('rate requests send no referrer', /referrerPolicy:'no-referrer'/.test(ix));
  check('outside link has noreferrer', /rel="noopener noreferrer">Exchange Rate API/.test(ix));
}

/* ---------- 7. fast start: open now when this phone already has its settings ---------- */
async function testStartup() {
  section('startup: app opens without waiting for the cloud settings');
  const src = between(cj, 'function begin(){', 'function ready(){');
  const timeoutSrc = one(cj, /function timeout\(p,ms\)\{[^\n]*\}/, 'timeout');
  function make(o) {
    const log = [], store = Object.assign({ 'mywallet.uid': 'U1' }, o.local === undefined ? {} : { 'mywallet.settings.v1': o.local });
    let release;
    const cloudGet = new Promise(r => { release = r; });
    const env = {
      log, timeoutSrc, UID: 'U1', UIDK: 'mywallet.uid', SETK: 'mywallet.settings.v1', RELOADK: 'r',
      PM: () => { }, wipeLocal: () => log.push('wipeLocal'), ready: () => log.push('ready'),
      uref: () => 'ref', track: p => p, doc: () => 'd', fs: {},
      getDoc: () => o.cloudNever ? new Promise(() => { }) : cloudGet,
      setDoc: () => { log.push('upload'); return Promise.resolve(); },
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
      sessionStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
      location: { reload: () => log.push('reload') }
    };
    const names = Object.keys(env);
    const fn = new Function(...names, timeoutSrc + src + '\nreturn begin;')(...names.map(k => env[k]));
    const snap = cloud => ({ exists: () => cloud !== null, data: () => ({ set: cloud }) });
    return { go: fn, log, store, answer: c => release(snap(c)) };
  }
  let t = make({ local: '{"a":1}' }); t.go();
  eq('has local settings: app opens at once, before the cloud answers', t.log, ['ready']);
  t.answer('{"a":2}'); await sleep(20);
  eq('cloud differs: no reload', t.log, ['ready']);
  eq('cloud differs: newer copy kept for the next open', t.store['mywallet.settings.v1'], '{"a":2}');
  t = make({ local: '{"a":1}' }); t.go(); t.answer('{"a":1}'); await sleep(20);
  eq('cloud same: nothing else happens', t.log, ['ready']);
  t = make({ local: '{"a":1}' }); t.go(); t.answer(null); await sleep(20);
  eq('cloud empty: local copy is uploaded', t.log, ['ready', 'upload']);
  t = make({ local: '{"a":1}', cloudNever: true }); t.go(); await sleep(30);
  eq('cloud never answers: app is already open, nothing breaks', t.log, ['ready']);
  t = make({}); t.go();
  eq('no local settings (new phone): still waits for the cloud', t.log, []);
  t.answer('{"a":9}'); await sleep(20);
  eq('new phone: cloud copy used (one reload, as before)', t.log, ['reload']);
}

(async () => {
  const parts = [testEscAndCsv, testMoney, testRestore, testPatch, testSave, testSignOut, testStartup];
  for (const p of parts) { try { await p(); } catch (e) { fail++; console.log('FAIL: ' + p.name + ' could not run: ' + e.message); } }
  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
