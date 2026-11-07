const C='mywallet-v19',A=['./','index.html','cloud.js','manifest.json','icons/icon-192.png','icons/icon-512.png','icons/logo-mark.png','icons/apple-touch-icon.png','icons/favicon-64.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(A.map(u=>fetch(u,{cache:'reload'}).then(r=>c.put(u,r))))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
/* Cache only this site's files and the Firebase SDK modules. Database and login traffic is never touched. */
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  const ok=u.origin===location.origin||u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/')||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(!ok)return;
  e.respondWith(fetch(u.origin===location.origin?new Request(e.request.url,{cache:'no-cache'}):e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html'))))});
