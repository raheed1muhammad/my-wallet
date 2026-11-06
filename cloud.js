/* My Wallet cloud layer: Firebase email+password login, a per-user private Firestore space,
   and the same db API the app already uses. No personal data lives in this file or the repo. */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendPasswordResetEmail,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,doc,collection,onSnapshot,setDoc,deleteDoc,getDoc,getDocs,writeBatch,runTransaction} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

var firebaseConfig={
  apiKey:"AIzaSyCpYoEfq_hz65dpzG6HOH7N72RyUMFhs_A",
  authDomain:"my-wallet-d0163.firebaseapp.com",
  projectId:"my-wallet-d0163",
  storageBucket:"my-wallet-d0163.firebasestorage.app",
  messagingSenderId:"183119690656",
  appId:"1:183119690656:web:d496517fbecf52353482c5"
};
window.__cloudUp=true;
var app=initializeApp(firebaseConfig),auth=getAuth(app),fs;
try{fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}
catch(e){fs=initializeFirestore(app,{})}

var SETK='mywallet.settings.v1',UIDK='mywallet.uid',RELOADK='mywallet.reloaded';
var COLS=['entries','rates','plans','plan_income','plan_items','goals','recurring','settings'];
var UID=null,EMAIL='';

/* ---------- login screen ---------- */
var el=document.createElement('div');el.id='fbAuth';el.hidden=true;
el.innerHTML='<style>#fbAuth{position:fixed;inset:0;z-index:2000;background:var(--bg,#fff);color:var(--ink,#111);display:grid;place-items:center;padding:20px;overflow:auto;font-family:inherit}#fbAuth[hidden]{display:none}#fbAuth .box{width:min(420px,100%);background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:18px;padding:22px;box-shadow:var(--shadow,0 8px 30px rgba(0,0,0,.15))}#fbAuth h1{margin:0 0 4px;font-size:28px;font-family:var(--font-brand,inherit)}#fbAuth p{margin:0 0 14px;color:var(--ink-2,#555);font-size:14px}#fbAuth label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px;color:var(--ink-2,#555)}#fbAuth input{width:100%;padding:12px;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--surface-2,#f5f5f5);color:inherit;font:inherit;font-size:16px}#fbAuth .go{width:100%;margin-top:16px;padding:13px;border:0;border-radius:12px;font:inherit;font-weight:700;font-size:16px;background:var(--btn-inc,var(--accent,#0095f6));color:var(--btn-inc-ink,#fff);cursor:pointer}#fbAuth .go:disabled{opacity:.6}#fbAuth .lnk{background:none;border:0;color:var(--accent,#0095f6);font:inherit;font-size:14px;padding:10px 4px 0;cursor:pointer}#fbAuth .msg{min-height:20px;margin-top:10px;font-size:13px;font-weight:600;color:var(--neg,#c0392b)}#fbAuth .msg.ok{color:var(--pos,#0a7d4b)}</style><div class="box"><img src="icons/logo-mark.png" alt="" style="display:block;margin:0 auto 10px;height:64px;width:auto"><h1>My Wallet</h1><p id="fbSub"></p><form id="fbForm" autocomplete="on" novalidate><div id="fbRowE"><label for="fbEmail">Email</label><input id="fbEmail" type="email" autocomplete="email" inputmode="email"></div><div id="fbRowP"><label for="fbPass">Password</label><input id="fbPass" type="password" autocomplete="current-password"></div><div id="fbRowP2"><label for="fbPass2">Repeat password</label><input id="fbPass2" type="password" autocomplete="new-password"></div><div id="fbRowC"><label for="fbCode">Sign-up code (ask the owner)</label><input id="fbCode" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></div><button class="go" id="fbGo" type="submit"></button><div class="msg" id="fbMsg" role="alert"></div></form><div id="fbLinks"></div></div>';
document.body.appendChild(el);
var $e=function(i){return document.getElementById(i)};
var view='login';
function setMsg(t,ok){var m=$e('fbMsg');m.textContent=t||'';m.className='msg'+(ok?' ok':'')}
function showAuth(v,msg){
  view=v;el.hidden=false;setMsg(msg||'');
  var s={login:['Log in to your wallet','Log in'],signup:['Create your account with your own email and password.','Create account'],reset:['We will email you a link to set a new password.','Send reset link'],code:['One more step: enter the sign-up code the owner gave you.','Continue']}[v];
  $e('fbSub').textContent=s[0];$e('fbGo').textContent=s[1];$e('fbGo').disabled=false;
  $e('fbRowE').hidden=(v==='code');$e('fbRowP').hidden=(v==='reset'||v==='code');$e('fbRowP2').hidden=(v!=='signup');$e('fbRowC').hidden=(v!=='code');
  $e('fbPass').autocomplete=v==='signup'?'new-password':'current-password';
  var L={login:'<button class="lnk" data-v="signup" type="button">New here? Create account</button><br><button class="lnk" data-v="reset" type="button">Forgot password?</button>',signup:'<button class="lnk" data-v="login" type="button">I already have an account</button>',reset:'<button class="lnk" data-v="login" type="button">Back to log in</button>',code:'<button class="lnk" data-v="out" type="button">Log out</button>'};
  $e('fbLinks').innerHTML=L[v];
}
el.addEventListener('click',function(e){var b=e.target.closest('[data-v]');if(!b)return;if(b.dataset.v==='out')doSignOut();else showAuth(b.dataset.v)});
function friendly(e){
  var c=(e&&e.code)||'';
  var m={'auth/invalid-email':'That email address is not valid.','auth/email-already-in-use':'This email already has an account. Use Log in.','auth/weak-password':'Password is too weak. Use at least 8 characters.','auth/invalid-credential':'Wrong email or password.','auth/wrong-password':'Wrong email or password.','auth/user-not-found':'Wrong email or password.','auth/too-many-requests':'Too many tries. Wait a few minutes and try again.','auth/network-request-failed':'No internet connection. Try again.','permission-denied':'Wrong sign-up code.'};
  return m[c]||('Something went wrong ('+(c||'unknown')+'). Try again.');
}
$e('fbForm').addEventListener('submit',function(ev){
  ev.preventDefault();var em=$e('fbEmail').value.trim(),pw=$e('fbPass').value;setMsg('');
  var go=$e('fbGo');
  function done(){go.disabled=false}
  if(view==='code'){
    var code=$e('fbCode').value.trim();if(!code){setMsg('Enter the sign-up code.');return}
    go.disabled=true;
    setDoc(doc(fs,'invited',UID),{code:code}).then(function(){try{localStorage.setItem(INVK,UID)}catch(e){}begin()}).catch(function(e){done();setMsg(friendly(e))});return;
  }
  if(!em){setMsg('Enter your email.');return}
  if(view==='reset'){go.disabled=true;sendPasswordResetEmail(auth,em).then(function(){done();setMsg('Reset link sent. Check your email (also spam).',true)}).catch(function(e){done();setMsg(friendly(e))});return}
  if(pw.length<8){setMsg('Password must be at least 8 characters.');return}
  go.disabled=true;
  if(view==='signup'){
    if(pw!==$e('fbPass2').value){done();setMsg('The two passwords do not match.');return}
    createUserWithEmailAndPassword(auth,em,pw).catch(function(e){done();setMsg(friendly(e))});
  }else{
    signInWithEmailAndPassword(auth,em,pw).catch(function(e){done();setMsg(friendly(e))});
  }
});

/* ---------- per-user local cleanup ---------- */
function wipeLocal(){
  try{Object.keys(localStorage).forEach(function(k){if(k.indexOf('mywallet.')===0&&k!=='mywallet.igtheme'&&k!=='mywallet.themev'&&k!=='mywallet.customthemes'&&k!=='mywallet.customcss')localStorage.removeItem(k)})}catch(e){}
}
function doSignOut(){signOut(auth).then(function(){wipeLocal();try{sessionStorage.removeItem(RELOADK)}catch(e){}location.reload()}).catch(function(){location.reload()})}

/* ---------- db shim with the same API the app uses ---------- */
function uref(path){return doc.apply(null,[fs,'users',UID].concat(path.split('/')))}
function cref(name){return collection(fs,'users',UID,name)}
function clean(v){return JSON.parse(JSON.stringify(v))}
/* Counts saves that are still waiting and saves the server refused, so the app can say so honestly. */
var SAVE={pending:0,failed:0};
function saveNote(){try{window.dispatchEvent(new CustomEvent('walletsave',{detail:{pending:SAVE.pending,failed:SAVE.failed}}))}catch(e){}}
function track(p){SAVE.pending++;saveNote();p.then(function(){SAVE.pending--;saveNote()},function(){SAVE.pending--;SAVE.failed++;saveNote()});return p}
window.__saveState=function(){return{pending:SAVE.pending,failed:SAVE.failed}};
window.__saveClear=function(){SAVE.failed=0;saveNote()};
function soft(p){track(p);if(navigator.onLine===false){p.catch(function(){});return Promise.resolve()}
  return new Promise(function(res,rej){var t=setTimeout(res,4000);p.then(function(){clearTimeout(t);res()},function(e){clearTimeout(t);rej(e)})})}
function dsnap(d){return{id:d.id,exists:true,data:function(){return clean(d.data())}}}
function dbObj(){
  function docRef(r){return{
    set:function(v){return soft(setDoc(r,clean(v)))},
    delete:function(){return soft(deleteDoc(r))},
    onSnapshot:function(cb,err){return onSnapshot(r,function(s){cb({id:s.id,exists:s.exists(),data:function(){return s.exists()?clean(s.data()):undefined}})},err||function(){})}}}
  return{
    collection:function(n){return{
      doc:function(id){return docRef(uref(n+'/'+id))},
      onSnapshot:function(cb,err){return onSnapshot(cref(n),function(s){cb({docs:s.docs.map(dsnap)})},err||function(){})}}},
    doc:function(p){return docRef(uref(p))}};
}

/* ---------- change one setting safely ----------
   Old way: each device wrote its whole (maybe stale) copy of the settings, so a second device could erase
   an account the first one had just added. New way: read the newest cloud copy, apply only THIS change, write it back
   in one atomic step (transaction). Needs the internet; the caller shows a message when it fails. */
function applyPatch(base,op){
  var s;try{s=base?JSON.parse(base):null}catch(e){s=null}
  s=s&&typeof s==='object'&&!Array.isArray(s)?s:{};
  s.profile=s.profile&&typeof s.profile==='object'?s.profile:{};
  s.accounts=Array.isArray(s.accounts)?s.accounts:[];
  s.closed=Array.isArray(s.closed)?s.closed:[];
  if(op.type==='addAccount'){
    var nm=String(op.name||'');
    if(nm&&!s.accounts.some(function(a){return a&&typeof a.name==='string'&&a.name.toLowerCase()===nm.toLowerCase()}))s.accounts.push({name:nm,cur:op.cur});
  }else if(op.type==='closeAccount'){
    if(s.closed.indexOf(op.name)<0)s.closed.push(op.name);
  }else if(op.type==='reopenAccount'){
    s.closed=s.closed.filter(function(x){return x!==op.name});
  }else if(op.type==='profile'){
    s.profile={name:String(op.name||'').slice(0,40),country:String(op.country||'').slice(0,40)};
  }else if(op.type==='showClosed'){
    s.showClosed=!!op.value;
  }
  return s;
}
window.__cloudPatch=function(op,localJson){
  if(!UID)return Promise.reject(new Error('not signed in'));
  if(navigator.onLine===false)return Promise.reject(new Error('offline'));
  var ref=uref('settings/app');
  return timeout(runTransaction(fs,function(tx){
    return tx.get(ref).then(function(snap){
      var base=snap.exists()&&snap.data()&&typeof snap.data().set==='string'?snap.data().set:localJson;
      var json=JSON.stringify(applyPatch(base,op));
      tx.set(ref,{set:json,t:Date.now()});
      return json;
    });
  }),8000).then(function(json){
    try{localStorage.setItem(SETK,json)}catch(e){}
    return JSON.parse(json);
  });
};

/* ---------- start after login ---------- */
function begin(){
  var prev=null;try{prev=localStorage.getItem(UIDK)}catch(e){}
  if(prev!==UID){
    wipeLocal();try{localStorage.setItem(UIDK,UID);sessionStorage.removeItem(RELOADK)}catch(e){}
    if(prev!==null){location.reload();return}
  }
  timeout(getDoc(uref('settings/app')),3000).then(function(s){
    var cloud=s.exists()?s.data().set:null,local=null;
    try{local=localStorage.getItem(SETK)}catch(e){}
    if(cloud&&cloud!==local){
      var already=false;try{already=sessionStorage.getItem(RELOADK)==='1'}catch(e){}
      if(!already){try{localStorage.setItem(SETK,cloud);sessionStorage.setItem(RELOADK,'1')}catch(e){}location.reload();return}
    }else if(!cloud&&local){track(setDoc(uref('settings/app'),{set:local,t:Date.now()})).catch(function(){})}
    ready();
  }).catch(function(){ready()});
}
function ready(){
  el.hidden=true;
  window.__cloudSet=function(json){if(UID)track(setDoc(uref('settings/app'),{set:json,t:Date.now()})).catch(function(){})};
  window.__cloud={email:EMAIL,signOut:doSignOut,exportData:exportData,importData:importData};
  window.__dbRes(dbObj());
}
var started=false,INVK='mywallet.invok';
function timeout(p,ms){return Promise.race([p,new Promise(function(_,j){setTimeout(function(){j(new Error('timeout'))},ms)})])}
onAuthStateChanged(auth,function(user){
  if(!user){UID=null;EMAIL='';started=false;showAuth('login');return}
  UID=user.uid;EMAIL=user.email||'';
  if(started)return;
  var known=false;try{known=localStorage.getItem(INVK)===UID}catch(e){}
  if(known){started=true;begin();return}
  timeout(getDoc(doc(fs,'invited',UID)),8000).then(function(s){
    if(s.exists()){try{localStorage.setItem(INVK,UID)}catch(e){}started=true;begin()}else showAuth('code')
  }).catch(function(e){showAuth('login','Cannot reach the server. Connect to the internet once to sign in.')});
});

/* ---------- backup: export / import ---------- */
function exportData(){
  var out={app:'my-wallet',version:1,exported:new Date().toISOString(),collections:{}};
  return Promise.all(COLS.map(function(c){return getDocs(cref(c)).then(function(s){var o={};s.docs.forEach(function(d){o[d.id]=clean(d.data())});out.collections[c]=o})})).then(function(){
    var blob=new Blob([JSON.stringify(out)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='my-wallet-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
    return Object.keys(out.collections).reduce(function(n,k){return n+Object.keys(out.collections[k]).length},0);
  });
}
function importData(){
  return new Promise(function(res,rej){
    var inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
    inp.onchange=function(){
      var f=inp.files&&inp.files[0];if(!f){res(0);return}
      if(f.size>8*1024*1024){rej(new Error('File is too large.'));return}
      f.text().then(function(t){
        var j;try{j=JSON.parse(t)}catch(e){throw new Error('This is not a valid backup file.')}
        if(!j||j.app!=='my-wallet'||!j.collections||typeof j.collections!=='object')throw new Error('This is not a My Wallet backup.');
        var items=[];
        COLS.forEach(function(c){var o=j.collections[c];if(!o||typeof o!=='object')return;Object.keys(o).forEach(function(id){
          if(!/^[A-Za-z0-9_\-.]{1,80}$/.test(id)||!o[id]||typeof o[id]!=='object'||Array.isArray(o[id]))return;items.push([c,id,o[id]])})});
        if(!items.length)throw new Error('The backup has no data.');
        if(!window.confirm('Import '+items.length+' records into your wallet? Existing records with the same ID will be replaced.'))return 0;
        var chain=Promise.resolve();
        for(var i=0;i<items.length;i+=400)(function(part){chain=chain.then(function(){var b=writeBatch(fs);part.forEach(function(x){b.set(uref(x[0]+'/'+x[1]),clean(x[2]))});return b.commit()})})(items.slice(i,i+400));
        return chain.then(function(){
          var sa=j.collections.settings&&j.collections.settings.app&&j.collections.settings.app.set;
          if(typeof sa==='string'){try{JSON.parse(sa);localStorage.setItem(SETK,sa)}catch(e){}}
          return items.length});
      }).then(res,rej);
    };
    inp.click();
  });
}
