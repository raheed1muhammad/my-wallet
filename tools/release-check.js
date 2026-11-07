'use strict';
/* Run this before every push:   node tools/release-check.js
   Add --bump to raise the cache number in sw.js for you when the app files changed.
   It checks: 1) the code has no syntax mistakes, 2) all tests pass, 3) no secrets in the files,
   4) the sw.js cache number was raised when index.html or cloud.js changed (so phones take the new version).
   Compares with the branch given in BASE (default: origin/main, then main). Exit code 1 = do not push. */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const bump = process.argv.includes('--bump');
let bad = 0;
const ok = m => console.log('  ok    ' + m), no = m => { bad++; console.log('  FAIL  ' + m); };
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

console.log('1. syntax');
const html = read('index.html');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((code, i) => { try { new vm.Script(code); ok('index.html script ' + (i + 1)); } catch (e) { no('index.html script ' + (i + 1) + ': ' + e.message); } });
const tmp = path.join(os.tmpdir(), 'mywallet-cloud-check.mjs'); fs.writeFileSync(tmp, read('cloud.js'));
const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
r.status === 0 ? ok('cloud.js') : no('cloud.js: ' + r.stderr.split('\n')[0]);
try { new vm.Script(read('sw.js')); ok('sw.js'); } catch (e) { no('sw.js: ' + e.message); }

console.log('2. tests');
const t = spawnSync(process.execPath, [path.join(root, 'tests', 'run.js')], { cwd: root, encoding: 'utf8' });
const last = t.stdout.trim().split('\n').pop();
t.status === 0 ? ok(last) : (no(last), console.log(t.stdout.split('\n').filter(l => l.startsWith('FAIL')).join('\n')));

console.log('3. secrets');
const files = ['index.html', 'cloud.js', 'sw.js', 'manifest.json', 'firestore.rules', 'README.md'].filter(f => fs.existsSync(path.join(root, f)));
const patterns = [[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'], [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'], [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}\b/, 'email address']];
let found = false;
files.forEach(f => {
  const txt = read(f);
  patterns.forEach(([re, name]) => { if (re.test(txt)) { found = true; no(name + ' found in ' + f); } });
  if (f !== 'cloud.js' && /AIza[0-9A-Za-z_-]{30,}/.test(txt)) { found = true; no('Google key found in ' + f + ' (only cloud.js may hold the public web key)'); }
});
if (!found) ok('nothing found in ' + files.length + ' files');

console.log('4. cache number');
const swPath = path.join(root, 'sw.js');
const num = txt => { const m = txt.match(/const C='mywallet-v(\d+)'/); return m ? +m[1] : null; };
const now = num(read('sw.js'));
if (now === null) no('cannot find the cache number (const C=\'mywallet-vNN\') in sw.js');
else {
  let base = ['origin/main', 'main'].find(b => git(['rev-parse', '--verify', '-q', b]).status === 0);
  if (!base) { ok('cache number is v' + now + ' (no base branch to compare with)'); }
  else {
    const changed = git(['diff', '--name-only', base, '--', 'index.html', 'cloud.js', 'manifest.json']).stdout.trim();
    const baseNum = num(git(['show', base + ':sw.js']).stdout || '');
    if (!changed) ok('app files unchanged compared with ' + base + ' (cache v' + now + ')');
    else if (baseNum !== null && now > baseNum) ok('app files changed and cache raised: v' + baseNum + ' to v' + now);
    else if (bump) { fs.writeFileSync(swPath, read('sw.js').replace(/const C='mywallet-v\d+'/, "const C='mywallet-v" + ((baseNum || now) + 1) + "'")); ok('raised cache number to v' + ((baseNum || now) + 1)); }
    else no('app files changed (' + changed.split('\n').join(', ') + ') but cache is still v' + now + '. Run with --bump');
  }
}
console.log(bad ? '\nNOT READY: ' + bad + ' problem(s). Do not push.' : '\nREADY to push.');
process.exit(bad ? 1 : 0);
