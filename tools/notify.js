'use strict';
/* Sends a reminder on the day a recurring item is due (SIP, loan repayment/collection, income, expense).
   Run by GitHub Actions every hour (.github/workflows/notify.yml). Needs one secret: FIREBASE_SERVICE_ACCOUNT.
   Privacy: this file prints only counts. The Actions log of a public repo is public, so never print names, amounts, emails or tokens. */
const crypto = require('crypto');
const DAY = 86400000, NP = 'np_', LOOKBACK = 3;
const pad = n => String(n).padStart(2, '0');
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addMk = (mk, n) => { const t = (+mk.slice(0, 4)) * 12 + (+mk.slice(5, 7) - 1) + n; return Math.floor(t / 12) + '-' + pad(t % 12 + 1); };

/* ---- the same date rules the app uses (index.html: sipDates / recDay) ---- */
function sipOk(r) { return ['daily', 'weekly', 'monthly', 'yearly', 'once'].includes(r.freq) && isDate(r.startDate) && (!r.endDate || isDate(r.endDate)); }
function sipDates(r, upTo) {
  if (!sipOk(r)) return [];
  let lim = upTo; const s = r.startDate, out = [];
  if (r.endDate && r.endDate < lim) lim = r.endDate;
  if (s > lim) return out;
  if (r.freq === 'once') return [s];
  const sy = +s.slice(0, 4), sm = +s.slice(5, 7), sd = +s.slice(8, 10);
  if (r.freq === 'daily' || r.freq === 'weekly') {
    const step = r.freq === 'daily' ? 1 : 7;
    for (let k = s, i = 0; k <= lim && i < 5000; i++) { out.push(k); k = addDays(k, step); }
    return out;
  }
  if (r.freq === 'monthly') {
    const day = Math.min(Math.max(1, Math.floor(r.day) || sd), 31);
    for (let i = 0; i < 1200; i++) {
      const t = sy * 12 + (sm - 1) + i, y = Math.floor(t / 12), m = t % 12 + 1;
      const k = y + '-' + pad(m) + '-' + pad(Math.min(day, dim(y, m)));
      if (k > lim) break;
      if (k >= s) out.push(k);
    }
    return out;
  }
  for (let i = 0; i < 200; i++) {
    const yy = sy + i, k = yy + '-' + pad(sm) + '-' + pad(Math.min(sd, dim(yy, sm)));
    if (k > lim) break;
    out.push(k);
  }
  return out;
}
function recDay(r, mk) { const d = dim(+mk.slice(0, 4), +mk.slice(5, 7)); return mk + '-' + pad(Math.min(Math.max(1, Math.floor(r.day) || 1), d)); }
function monthActive(r, mk) {
  const start = /^\d{4}-\d{2}$/.test(r.start || '') ? r.start : null;
  if (!start || mk < start) return false;
  if (r.endMode === 'months') { const n = (+mk.slice(0, 4)) * 12 + +mk.slice(5, 7) - ((+start.slice(0, 4)) * 12 + +start.slice(5, 7)); return n < Math.max(1, Math.floor(r.count) || 1); }
  if (r.endMode === 'month' && /^\d{4}-\d{2}$/.test(r.endMk || '')) return mk <= r.endMk;
  return true;
}

/* items of one recurring that are due and not yet recorded (so an item the app already added is not reminded) */
function dueItems(r, today, entryDone) {
  if (!r || typeof r !== 'object' || !r.name || !(r.amount > 0) || typeof r.id !== 'string') return [];
  if (r.status === 'paused' || r.status === 'cancelled') return [];
  const lo = addDays(today, -LOOKBACK);
  if (r.freq) {
    const ds = sipDates(r, today).filter(k => k >= lo && k > (r.last || ''));
    return ds.length ? [{ key: r.id + '|' + ds[ds.length - 1], r, date: ds[ds.length - 1] }] : [];
  }
  const out = [];
  for (const mk of [addMk(today.slice(0, 7), -1), today.slice(0, 7)]) {
    if (!monthActive(r, mk)) continue;
    const d = recDay(r, mk);
    if (d >= lo && d <= today && !entryDone('rec_' + r.id + '_' + mk)) out.push({ key: r.id + '|' + d, r, date: d });
  }
  return out.slice(-1);
}

function localNow(tz, nowMs) {
  let parts;
  try { parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs)); }
  catch (e) { parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs)); }
  const g = t => parts.find(p => p.type === t).value;
  return { date: g('year') + '-' + g('month') + '-' + g('day'), hour: +g('hour') % 24 };
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function money(cur, a) { const d = cur === 'INR' ? 2 : 3; return (cur === 'INR' ? 'INR ' : 'OMR ') + Number(a).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function lineFor(r, showAmounts) {
  const nm = clean(r.name, 40), per = clean(r.person, 40);
  const t = r.kind === 'sip' ? 'SIP · ' + nm : r.kind === 'repay' ? 'Repay · ' + (per || nm) : r.kind === 'collect' ? 'Collect · ' + (per || nm) : r.kind === 'income' ? 'Income · ' + nm : nm;
  return t + (showAmounts ? ' · ' + money(r.cur, r.amount) : '');
}
function buildMessage(items, showAmounts) {
  const lines = items.slice(0, 4).map(i => lineFor(i.r, showAmounts));
  if (items.length > 4) lines.push('+' + (items.length - 4) + ' more');
  return { title: items.length === 1 ? 'My Wallet · due today' : 'My Wallet · ' + items.length + ' items due today', body: lines.join('\n'), tag: 'due-' + items[0].date };
}
const hash = k => crypto.createHash('sha1').update(k).digest('hex').slice(0, 20);
const BAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

/* ---- one run. db / messaging / auth are the Firebase Admin objects (or stand-ins in the tests) ---- */
async function run(deps, env, nowMs) {
  const { db, messaging, auth } = deps;
  const wantTest = env.SEND_TEST === '1', onlyEmail = wantTest ? (env.ONLY_EMAIL || '').trim().toLowerCase() : '', test = wantTest && !!onlyEmail;
  if (wantTest && !onlyEmail) return { users: 0, sent: 0, failed: 0, note: 'test needs the TEST_EMAIL secret' };
  let uids;
  if (onlyEmail) { try { uids = [(await auth.getUserByEmail(onlyEmail)).uid]; } catch (e) { return { users: 0, sent: 0, failed: 0, note: 'no such account' }; } }
  else uids = (await db.collection('users').listDocuments()).map(d => d.id);
  const stat = { users: 0, sent: 0, failed: 0 };
  for (const uid of uids) {
    try {
      const pref = db.doc('users/' + uid + '/private/push'), ps = await pref.get();
      if (!ps.exists) continue;
      const pd = ps.data() || {}, tokens = (Array.isArray(pd.tokens) ? pd.tokens : []).filter(t => typeof t === 'string' && t.length > 20).slice(0, 5);
      if (!pd.on || !tokens.length) continue;
      stat.users++;
      const jobs = []; /* each job: one message and the log keys to remember once it was delivered */
      let logRef = null, prev = {};
      if (test) jobs.push({ msg: { title: 'My Wallet · test', body: 'The reminder server can reach this phone.', tag: 'server-test' }, keys: [] });
      else if (env.ANNOUNCE_ID && env.ANNOUNCE_TITLE) {
        /* one-time announcement to everyone who has notifications on; the id is remembered so it is never sent twice to the same person */
        logRef = db.doc('users/' + uid + '/private/pushlog');
        const ls = await logRef.get(); prev = (ls.exists && ls.data().sent) || {};
        const nk = hash('news:' + env.ANNOUNCE_ID);
        if (prev[nk]) continue;
        jobs.push({ msg: { title: String(env.ANNOUNCE_TITLE).slice(0, 60), body: String(env.ANNOUNCE_BODY || '').slice(0, 140), tag: 'news' }, keys: [nk] });
      }
      else {
        const hour = pd.hour >= 0 && pd.hour <= 23 ? Math.floor(pd.hour) : 9, now = localNow(pd.tz || 'UTC', nowMs);
        if (now.hour < hour) continue;
        logRef = db.doc('users/' + uid + '/private/pushlog');
        const ls = await logRef.get(); prev = (ls.exists && ls.data().sent) || {};
        const rs = await db.collection('users/' + uid + '/recurring').get(), items = [];
        for (const doc of rs.docs) {
          const np = doc.id.indexOf(NP) === 0, pre = np ? NP : '';
          const r = Object.assign({}, doc.data()); if (typeof r.id !== 'string') r.id = np ? doc.id.slice(NP.length) : doc.id;
          for (const c of dueItems(r, now.date, () => false)) {
            /* a monthly item the app already recorded is not reminded */
            if (!r.freq && (await db.doc('users/' + uid + '/entries/' + pre + 'rec_' + r.id + '_' + c.date.slice(0, 7)).get()).exists) continue;
            items.push(c);
          }
        }
        const fresh = items.filter(i => !prev[hash(i.key)]);
        if (fresh.length) jobs.push({ msg: buildMessage(fresh, !!pd.amounts), keys: fresh.map(i => hash(i.key)) });
        /* the daily diary: one short message a day, never with amounts; the app builds the diary itself when tapped */
        const dk = hash('diary:' + now.date);
        if (pd.diary === true && !prev[dk]) jobs.push({ msg: { title: 'My Wallet', body: 'Your daily diary is ready. Tap to see your day.', tag: 'diary' }, keys: [dk] });
        if (!jobs.length) continue;
      }
      const dead = [], doneKeys = [];
      for (const job of jobs) {
        const res = await messaging.sendEachForMulticast({ tokens, data: { title: job.msg.title, body: job.msg.body, tag: job.msg.tag }, webpush: { headers: { TTL: '43200', Urgency: 'high' } } });
        res.responses.forEach((x, i) => { if (x.success) stat.sent++; else { stat.failed++; if (x.error && BAD.includes(x.error.code) && !dead.includes(tokens[i])) dead.push(tokens[i]); } });
        if (res.successCount > 0) doneKeys.push(...job.keys);
      }
      if (dead.length) await pref.set({ tokens: tokens.filter(t => !dead.includes(t)) }, { merge: true });
      if (logRef && doneKeys.length) {
        const keep = {}, cut = new Date(nowMs - 45 * DAY).toISOString().slice(0, 10);
        Object.keys(prev).forEach(k => { if (typeof prev[k] === 'string' && prev[k] >= cut) keep[k] = prev[k]; });
        const today = new Date(nowMs).toISOString().slice(0, 10);
        doneKeys.forEach(k => { keep[k] = today; });
        await logRef.set({ sent: keep });
      }
    } catch (e) { stat.failed++; }
  }
  return stat;
}

module.exports = { sipDates, recDay, monthActive, dueItems, localNow, buildMessage, lineFor, run, addDays, money };

if (require.main === module) {
  (async () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) { console.log('The FIREBASE_SERVICE_ACCOUNT secret is not added yet, so nothing was sent.'); process.exit(0); }
    let cred; try { cred = JSON.parse(raw); } catch (e) { console.log('The FIREBASE_SERVICE_ACCOUNT secret is not valid JSON.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    const out = await run({ db: admin.firestore(), messaging: admin.messaging(), auth: admin.auth() }, process.env, Date.now());
    console.log('Reminders: users checked ' + out.users + ', sent ' + out.sent + ', failed ' + out.failed + (out.note ? ', ' + out.note : ''));
    if (out.failed > 0 && out.sent === 0 && out.users > 0) process.exit(1);
  })().catch(() => { console.log('Reminder run failed.'); process.exit(1); });
}
