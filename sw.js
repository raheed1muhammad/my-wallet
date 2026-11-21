const C='mywallet-v44',A=['./','index.html','cloud.js','trading.js','manifest.json','icons/icon-192.png','icons/icon-512.png','icons/logo-mark.png','icons/apple-touch-icon.png','icons/favicon-64.png'];
const FB=['app','auth','firestore'].map(n=>'https://www.gstatic.com/firebasejs/10.14.1/firebase-'+n+'.js');
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(A.map(u=>fetch(u,{cache:'reload'}).then(r=>c.put(u,r)))).then(()=>Promise.allSettled(FB.map(u=>c.match(u).then(h=>h||fetch(u).then(r=>c.put(u,r))))))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
/* Fast opening: the app files are served from the phone first and refreshed quietly in the background, so a slow network does not delay opening.
   A new release is used from the next opening. The Firebase files have a version in their address, so they never change. Database and login traffic is never touched. */
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  const mine=u.origin===location.origin,fb=u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/'),fonts=u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(!mine&&!fb&&!fonts)return;
  if(mine){
    e.respondWith(caches.open(C).then(c=>c.match(e.request,{ignoreSearch:true}).then(hit=>{
      const net=fetch(new Request(e.request.url,{cache:'no-cache'})).then(r=>{if(r.ok){const k=e.request.mode==='navigate'?'./':e.request;c.put(k,r.clone())}return r});
      if(hit){net.catch(()=>{});return hit}
      return net.catch(()=>c.match('./',{ignoreSearch:true}));
    })));
    return;
  }
  e.respondWith(caches.open(C).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r}))));
});
/* Reminders sent from the server arrive here. A message is always shown (the phone requires it). Only a title and a short text are used. */
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){}
  const n=d.notification||d.data||{};
  const title=String(n.title||'My Wallet').slice(0,80),body=String(n.body||'').slice(0,200);
  e.waitUntil(self.registration.showNotification(title,{body:body,icon:'icons/icon-192.png',badge:'icons/favicon-64.png',tag:n.tag?String(n.tag).slice(0,60):undefined,data:{url:'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const dy=e.notification.tag==='diary';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    for(const c of l){if('focus' in c){if(dy){try{c.postMessage({diary:1})}catch(_){}}return c.focus()}}
    return self.clients.openWindow(dy?'./?diary=1':'./');
  }));
});
