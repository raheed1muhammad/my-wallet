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

/* ---------- 8. SIP schedules and automatic recording ---------- */
async function testSip() {
  section('SIP: schedules, month ends, leap years, pause, duplicates, low balance');
  const helpers = ['pad', 'toStr', 'parse', 'addDays'].map(n => one(ix, new RegExp('function ' + n + '\\([^\\n]*\\}(?=\\n)'), n)).join('\n');
  const region = between(ix, 'function recDay(', 'function recDues(');
  function make(o) {
    o = o || {};
    const env = { S: { recReady: true, entReady: true, mode: 'cloud', recBusy: {} }, REC: o.REC || [], log: [], saved: [], bal: o.bal === undefined ? 1e9 : o.bal, today: o.today || '2026-01-10' };
    const src = `var S=env.S,REC=env.REC;var __t=env.today;function todayStr(){return __t}
      function curMk(){return __t.slice(0,7)}function addMonths(s,n){var d=parse(s);d.setDate(1);d.setMonth(d.getMonth()+n);return toStr(d)}function addMk(mk,n){return addMonths(mk+'-01',n).slice(0,7)}
      function balanceOf(){return env.bal}function money(v,c){return c+' '+v}function failMsg(e){return String(e)}
      function saveEntry(e){env.saved.push(e);if(env.dup&&env.saved.some(function(x,i){return x.id===e.id&&i<env.saved.length-1}))env.dupFound=true;return Promise.resolve()}
      function recSaveOne(){env.log.push('save');return Promise.resolve()}function toast(m){env.log.push('toast:'+m)}function notify(t){env.log.push('notify:'+t)}function render(){}
      ${helpers}\n${region}\nreturn {sipDates,sipTodo,sipNext,sipSetStatus,recAuto,setToday:function(d){__t=d},S:S}`;
    const api = new Function('env', src)(env);
    return Object.assign(env, { api });
  }
  const T = make();
  const D = (r, upTo) => T.api.sipDates(r, upTo);
  eq('daily: 4 days', D({ freq: 'daily', startDate: '2026-01-01' }, '2026-01-04'), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  eq('weekly: every 7 days', D({ freq: 'weekly', startDate: '2026-01-01' }, '2026-01-20'), ['2026-01-01', '2026-01-08', '2026-01-15']);
  eq('monthly: 31st becomes month end (non-leap Feb)', D({ freq: 'monthly', startDate: '2026-01-31' }, '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  eq('monthly: 31st in leap year Feb', D({ freq: 'monthly', startDate: '2028-01-31' }, '2028-03-01'), ['2028-01-31', '2028-02-29']);
  eq('monthly: day setting 10, start after the 10th, first is next month', D({ freq: 'monthly', startDate: '2026-01-20', day: 10 }, '2026-03-15'), ['2026-02-10', '2026-03-10']);
  eq('monthly: crosses the new year', D({ freq: 'monthly', startDate: '2026-11-15' }, '2027-02-20'), ['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15']);
  eq('yearly: 29 Feb becomes 28 Feb in normal years, 29 in leap years', D({ freq: 'yearly', startDate: '2024-02-29' }, '2028-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  eq('one time: one date only', D({ freq: 'once', startDate: '2026-03-05' }, '2030-01-01'), ['2026-03-05']);
  eq('one time: not yet due', D({ freq: 'once', startDate: '2026-03-05' }, '2026-03-04'), []);
  eq('end date stops it', D({ freq: 'daily', startDate: '2026-01-01', endDate: '2026-01-02' }, '2026-01-31'), ['2026-01-01', '2026-01-02']);
  eq('start in the future: nothing yet', D({ freq: 'monthly', startDate: '2026-06-01' }, '2026-01-10'), []);
  eq('bad frequency: nothing', D({ freq: 'hourly', startDate: '2026-01-01' }, '2026-02-01'), []);
  eq('bad start date (30 Feb): nothing', D({ freq: 'daily', startDate: '2026-02-30' }, '2026-04-01'), []);
  eq('hostile start date: nothing', D({ freq: 'daily', startDate: '<b>x</b>' }, '2026-04-01'), []);
  eq('daily SIP over many years is capped, no freeze', D({ freq: 'daily', startDate: '1990-01-01' }, '2026-01-01').length <= 5000, true);
  eq('next date for monthly SIP', T.api.sipNext({ freq: 'monthly', startDate: '2026-01-10', last: '2026-01-10' }, '2026-01-10'), '2026-02-10');
  eq('next date: none after it finished', T.api.sipNext({ freq: 'once', startDate: '2026-01-10', last: '2026-01-10' }, '2026-01-10'), null);
  eq('next date: none when cancelled', T.api.sipNext({ freq: 'daily', startDate: '2026-01-10', status: 'cancelled' }, '2026-01-10'), null);

  /* pause / resume / cancel */
  let r = { freq: 'daily', startDate: '2026-01-01', last: '2026-01-03', status: 'active' };
  T.api.sipSetStatus(r, 'paused', '2026-01-05'); eq('paused', r.status, 'paused');
  T.api.sipSetStatus(r, 'active', '2026-01-09');
  eq('resume does not catch up the paused days', [r.status, r.last], ['active', '2026-01-09']);
  eq('after resume only new days are due', T.api.sipTodo(r, '2026-01-10'), ['2026-01-10']);
  r = { freq: 'daily', startDate: '2026-01-01', pend: '2026-01-02' }; T.api.sipSetStatus(r, 'cancelled', '2026-01-05');
  eq('cancel drops the waiting payment', [r.status, r.pend], ['cancelled', undefined]);
  T.api.sipSetStatus(r, 'active', '2026-01-06'); eq('a cancelled SIP cannot be resumed', r.status, 'cancelled');

  /* automatic recording */
  function run(rec, o) { const m = make(Object.assign({ REC: [rec] }, o)); m.api.recAuto(); return m; }
  const base = { id: 'a1', name: 'Fund', kind: 'sip', cur: 'INR', amount: 5000, account: 'Cash', freq: 'monthly', startDate: '2026-01-10', status: 'active' };
  let m = run(Object.assign({}, base), { today: '2026-01-10' }); await sleep(20);
  eq('due today with enough money: one SIP entry', m.saved.map(e => [e.id, e.type, e.kind, e.amount, e.account, e.date]), [['rec_a1_2026-01-10', 'sip', 'invest', 5000, 'Cash', '2026-01-10']]);
  eq('last paid date is recorded', m.REC[0].last, '2026-01-10');
  m.api.recAuto(); await sleep(20);
  eq('second run does not add it again (no double payment)', m.saved.length, 1);
  m = run(Object.assign({}, base), { today: '2026-01-10', bal: 100 }); await sleep(20);
  eq('not enough money: nothing deducted, payment waits as due', [m.saved.length, m.REC[0].pend], [0, '2026-01-10']);
  eq('not enough money: user is told', m.log.some(x => x.indexOf('notify:Payment due') === 0), true);
  m = run(Object.assign({}, base, { status: 'paused' }), { today: '2026-03-10' }); await sleep(20);
  eq('paused: nothing added', m.saved.length, 0);
  m = run(Object.assign({}, base, { status: 'cancelled' }), { today: '2026-03-10' }); await sleep(20);
  eq('cancelled: nothing added', m.saved.length, 0);
  m = run(Object.assign({}, base, { freq: 'daily', startDate: '2026-01-08' }), { today: '2026-01-10' }); await sleep(20);
  eq('3 missed days are caught up, one entry each', m.saved.map(e => e.date), ['2026-01-08', '2026-01-09', '2026-01-10']);
  m = run(Object.assign({}, base, { freq: 'daily', startDate: '2026-01-01' }), { today: '2026-01-10' }); await sleep(20);
  eq('10 missed days: nothing added silently', m.saved.length, 0);
  eq('10 missed days: marked for your decision, once', [m.REC[0].review, m.log.filter(x => x.indexOf('toast:') === 0).length], [10, 1]);
  m.api.recAuto(); await sleep(20);
  eq('decision still pending: no second warning', m.log.filter(x => x.indexOf('toast:') === 0).length, 1);
  m.REC[0].catchOk = true; m.api.recAuto(); await sleep(30);
  eq('after you agree: all 10 added, flags cleared', [m.saved.length, m.REC[0].catchOk, m.REC[0].review], [10, undefined, undefined]);
  m = run(Object.assign({}, base, { freq: 'daily', startDate: '2026-01-08' }), { today: '2026-01-10', bal: 7000 }); await sleep(20);
  eq('money for only 1 of 3: adds 1, the next waits as due', [m.saved.map(e => e.date), m.REC[0].pend], [['2026-01-08'], '2026-01-09']);
  m = run(Object.assign({}, base, { startDate: '2026-06-10' }), { today: '2026-01-10' }); await sleep(20);
  eq('SIP that starts in the future: nothing', m.saved.length, 0);
  m = run({ id: 'o1', name: 'Old', kind: 'expense', cur: 'OMR', amount: 5, account: 'Cash', day: 10, start: '2026-01', endMode: 'none', category: 'Bills' }, { today: '2026-01-12' }); await sleep(20);
  eq('old monthly recurring still works as before', m.saved.map(e => [e.id, e.type, e.date]), [['rec_o1_2026-01', 'expense', '2026-01-10']]);
  check('restore only accepts valid SIP schedules and drops catch-up flags', /\(!x\.freq\|\|\(x\.kind==='sip'&&sipOk\(x\)/.test(ix) && /if\(r\.freq\)\{delete r\.catchOk;delete r\.review;delete r\.pend\}/.test(ix));
  check('SIP screen is drawn with the SIP page', /renderSipAnalysis\(\);renderSipAuto\(\);/.test(ix));
  check('SIP names are escaped on screen', /'<div class="plb"><div class="pln"><b>'\+esc\(r\.name\)/.test(ix.slice(ix.indexOf('function renderSipAuto'))));
  check('old recurring screen skips SIPs (they have their own card on the SIP page)', /REC\.filter\(function\(r\)\{return !r\.freq\}\)/.test(ix));
}

/* ---------- 9. Trading practice (paper trading only) ---------- */
async function testTrading() {
  section('trading practice: virtual money, risk limits, costs');
  const TR = require('../trading.js');
  const C = TR.cfgOf({ capital: 100000, riskPct: 1, maxDaily: 2000, maxWeekly: 5000, maxTradesDay: 3, brokPct: 0.1, fixedFee: 20 });
  eq('default settings are safe', [TR.cfgOf(null).riskPct, TR.cfgOf(null).capital, TR.cfgOf(null).ack], [1, 100000, false]);
  eq('risk per trade is capped at 5%', TR.cfgOf({ riskPct: 50 }).riskPct, 5);
  eq('charges: 0.1% + fixed fee', TR.fee(50000, C), 70);
  const mk = (o) => Object.assign({ id: 't_1', sym: 'ABC', qty: 100, entry: 500, stop: 480, date: '2026-01-05', status: 'open', strat: 'Breakout', ts: 1 }, o);
  let a = TR.account([mk()], C);
  eq('buy uses practice cash only (cost + charges)', [a.cash, a.openValue], [49930, 50000]);
  a = TR.account([mk({ status: 'closed', exit: 520, exitDate: '2026-01-06', feesIn: 70, feesOut: 72 })], C);
  eq('closed win: profit after charges added to cash', [a.cash, a.realized], [101858, 1858]);
  a = TR.account([mk({ status: 'closed', exit: 470, exitDate: '2026-01-06' })], C);
  eq('closed loss reduces cash', a.cash, 100000 + (-30 * 100 - 70 - TR.fee(47000, C)));
  eq('open trade with a typed price shows open result', TR.pnl(mk({ last: 510 }), C), 930);
  eq('open trade without a price shows 0, no invented number', TR.pnl(mk(), C), 0);
  const win = mk({ id: 't_a', status: 'closed', exit: 520, exitDate: '2026-01-06', ts: 1 }), loss = mk({ id: 't_b', status: 'closed', exit: 480, exitDate: '2026-01-07', strat: 'Other', ts: 2 }), loss2 = mk({ id: 't_c', status: 'closed', exit: 480, exitDate: '2026-01-08', strat: 'Other', ts: 3 });
  const s = TR.stats([win, loss, loss2, mk({ id: 't_d' })], C);
  eq('stats counts', [s.total, s.closed, s.open, s.wins, s.losses], [4, 3, 1, 1, 2]);
  check('win rate is 33.3', s.winRate === 33.3, s.winRate);
  check('max drawdown is the two losses in a row', s.maxDrawdown === 4276, s.maxDrawdown);
  eq('strategy table', Object.keys(s.byStrategy).sort(), ['Breakout', 'Other']);
  eq('reward to risk', [TR.rr(500, 480, 540), TR.rr(500, 480, 480), TR.rr(500, 520, 540)], [2, null, null]);
  eq('position size: 1% of 1,00,000 with 20 risk per share = 50', TR.sizePosition({ capital: 100000, riskPct: 1, entry: 500, stop: 480, cash: 100000, brokPct: 0.1 }).qty, 50);
  const lim = TR.sizePosition({ capital: 100000, riskPct: 1, entry: 500, stop: 480, cash: 10000, brokPct: 0.1 });
  check('position size never exceeds available cash', lim.qty === 19 && lim.limitedByCash, JSON.stringify(lim));
  eq('position size: bad input gives 0', TR.sizePosition({ capital: 1, riskPct: 1, entry: 500, stop: 600, cash: 1, brokPct: 0 }).qty, 0);
  const buy = (o, T, c) => TR.checkBuy(Object.assign({ sym: 'ABC', qty: 50, entry: 500, stop: 480, target: 540, date: '2026-01-10' }, o), T || [], c || C, '2026-01-10');
  eq('a normal trade has no errors or warnings', buy({}), { errors: [], warnings: [] });
  check('stop-loss is required', buy({ stop: NaN }).errors.length === 1);
  check('stop above entry is refused', buy({ stop: 520 }).errors.length === 1);
  check('fractional quantity is refused', buy({ qty: 1.5 }).errors.length === 1);
  check('lowercase or hostile share code is refused', buy({ sym: '<b>x</b>' }).errors.length === 1 && buy({ sym: 'abc' }).errors.length === 1);
  check('not enough cash: refused, no borrowing', buy({ qty: 500 }).errors.some(x => /Borrowing/.test(x)));
  check('too much risk: warning', buy({ qty: 80 }).warnings.some(x => /above your limit/.test(x)));
  check('low reward to risk: warning', buy({ target: 510 }).warnings.some(x => /Reward to risk/.test(x)));
  check('no target: warning', buy({ target: null }).warnings.some(x => /No target/.test(x)));
  check('three trades today: warning', buy({}, [mk({ id: 't_1', date: '2026-01-10' }), mk({ id: 't_2', date: '2026-01-10' }), mk({ id: 't_3', date: '2026-01-10' })], TR.cfgOf({ capital: 1000000, maxTradesDay: 3 })).warnings.some(x => /daily|limit is 3/.test(x)));
  const l1 = mk({ id: 't_l1', status: 'closed', exit: 400, exitDate: '2026-01-09', ts: 5 }), l2 = mk({ id: 't_l2', status: 'closed', exit: 400, exitDate: '2026-01-10', ts: 6 });
  const w2 = buy({}, [l1, l2], TR.cfgOf({ capital: 1000000, maxDaily: 1000 }));
  check('losses in a row and daily loss limit: warnings', w2.warnings.some(x => /last 2/.test(x)) && w2.warnings.some(x => /daily loss limit/.test(x)), JSON.stringify(w2));
  eq('price at stop is detected', TR.priceHit(mk({ last: 479 })), 'stop');
  eq('price at target is detected', TR.priceHit(mk({ last: 540, target: 540 })), 'target');
  eq('no price typed: no signal', TR.priceHit(mk()), null);
  eq('closed trade: no signal', TR.priceHit(mk({ status: 'closed', exit: 1, exitDate: '2026-01-02', last: 1 })), null);
  check('weekly summary mentions trades', TR.weekly([win, loss], C, '2026-01-10').count === 2);
  check('weekly summary with nothing', TR.weekly([], C, '2026-01-10').count === 0);
  check('a hostile stored trade is rejected', !TR.okTrade(mk({ sym: '<img>' })) && !TR.okTrade(mk({ qty: 1.5 })) && !TR.okTrade(mk({ stop: 600 })) && !TR.okTrade(mk({ date: '2026-02-30' })) && !TR.okTrade(mk({ status: 'closed' })) && TR.okTrade(mk()));
  const ex = TR.explain({ entry: 500, stop: 480, target: 530, qty: 50 }, C);
  const all = JSON.stringify(ex).toLowerCase();
  check('assistant never says buy now, sell now or guaranteed', !/buy now|sell now|guarantee|will rise|will fall|sure profit/.test(all));
  check('assistant says it is education', /education/i.test(ex.title));
  check('assistant asks for missing information', TR.explain({ entry: 0, stop: 0 }, C).lines.length === 1);
  eq('there are 18 lessons, each with one quiz and a valid answer', TR.LESSONS.filter(l => l.q[1].length === 3 && l.q[2] >= 0 && l.q[2] < 3 && l.b.length >= 1).length, 18);
  check('lesson search: rsi finds the RSI lesson first', TR.answerQ('what is rsi')[0].id === 'l12');
  check('lesson search finds stop loss', TR.answerQ('what is a stop loss').some(l => l.id === 'l13'));
  check('disclaimer text', TR.DISCLAIMER === 'PAPER TRADING – NO REAL MONEY INVOLVED.');
  const src = fs.readFileSync(path.join(__dirname, '..', 'trading.js'), 'utf8');
  check('trading code does not touch wallet entries, SIP or recurring', !/collection\('(entries|recurring|settings|plans|goals|rates)'\)|saveEntry|balanceOf|REC\b/.test(src));
  check('trading data goes only to its own collection', (src.match(/collection\('([a-z_]+)'\)/g) || []).every(x => x === "collection('trading')"));
  check('trading code has no network calls', !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src));
  check('page loads trading.js only when opened (not in the startup scripts)', !/<script[^>]+src=["']trading\.js/.test(ix));
  check('rules allow the trading collection', /'trading'/.test(fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')));
}

(async () => {
  const parts = [testEscAndCsv, testMoney, testRestore, testPatch, testSave, testSignOut, testStartup, testSip, testTrading];
  for (const p of parts) { try { await p(); } catch (e) { fail++; console.log('FAIL: ' + p.name + ' could not run: ' + e.message); } }
  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
