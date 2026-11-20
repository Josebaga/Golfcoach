const CACHE='golf-stats-v2';
const APP_FILES=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(APP_FILES);await self.skipWaiting()})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('golf-stats-')&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 if(event.request.mode==='navigate'||new URL(event.request.url).pathname.endsWith('/index.html')){
  event.respondWith((async()=>{try{const response=await fetch(event.request);if(response&&response.ok){const cache=await caches.open(CACHE);cache.put('./index.html',response.clone())}return response}catch(e){return (await caches.match('./index.html'))||Response.error()}})());
 }else{
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
 }
});