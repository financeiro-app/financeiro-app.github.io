// Service worker: deixa o app instalável e abrindo sem internet.
// Página: rede primeiro (sempre pega a versão nova) e, sem conexão, a última cópia salva.
// Bibliotecas e fontes (CDN): cache primeiro. Dados (Supabase) e cotações nunca passam pelo cache.
const CACHE = 'cfp-v4';
const ALERTS = 'cfp-alerts'; // avisos de saldo negativo calculados pelo app (alerts.json) e os já enviados (sent.json)
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== ALERTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/supabase\.co$/.test(url.hostname) || url.hostname === 'brapi.dev') return;
  if (url.pathname.endsWith('.apk')) return; // download do app Android: sempre direto da rede, sem cache
  if (req.mode === 'navigate') {
    // cache: no-cache = sempre confere com o servidor (ETag). Sem isso o navegador reaproveitava a página por até 10 min
    // (max-age do GitHub Pages) e abria uma versão antiga do app logo depois de uma atualização.
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
      return res;
    }).catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});

// ---------- avisos de saldo negativo ----------
// O app calcula, sempre que abre ou muda algo, em que dia cada conta fica negativa e grava a lista aqui.
// O Android acorda o service worker (periodicsync, ~1 vez por dia) e o aviso sai um dia antes, só uma vez.
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function checkAlerts() {
  const c = await caches.open(ALERTS), r = await c.match('alerts.json'); if (!r) return;
  const data = await r.json(), sr = await c.match('sent.json'), sent = sr ? await sr.json() : {}, today = hojeLocal();
  for (const a of data.list || []) {
    if (a.at > today || a.d < today || sent[a.id]) continue;
    await self.registration.showNotification(a.title, { body: a.body, tag: a.id, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './?tab=contas' } });
    sent[a.id] = today;
  }
  const old = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10); for (const k of Object.keys(sent)) if (sent[k] < old) delete sent[k];
  await c.put('sent.json', new Response(JSON.stringify(sent), { headers: { 'Content-Type': 'application/json' } }));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'cfp-alerts') e.waitUntil(checkAlerts()); });
self.addEventListener('message', e => { if (e.data && e.data.type === 'alerts-check') e.waitUntil(checkAlerts()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => 'focus' in x);
    if (w) return w.focus().then(x => (x && 'navigate' in x ? x.navigate(url) : null));
    return self.clients.openWindow(url);
  }));
});
