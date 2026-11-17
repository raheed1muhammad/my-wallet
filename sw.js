const C='mywallet-v35',A=['./','index.html','cloud.js','trading.js','manifest.json','icons/icon-192.png','icons/icon-512.png','icons/logo-mark.png','icons/apple-touch-icon.png','icons/favicon-64.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(A.map(u=>fetch(u,{cache:'reload'}).then(r=>c.put(u,r))))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
/* Cache only this site's files and the Firebase SDK modules. Database and login traffic is never touched. */
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  const ok=u.origin===location.origin||u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/')||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(!ok)return;
  e.respondWith(fetch(u.origin===location.origin?new Request(e.request.url,{cache:'no-cache'}):e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html'))))});
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
