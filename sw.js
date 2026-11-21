// Service worker: ให้ติดตั้งเป็นแอปได้ และเปิดหน้าเว็บได้แม้เน็ตไม่ดี
// หน้าเว็บโหลดจากเน็ตก่อนเสมอ (ได้เวอร์ชันล่าสุด) ถ้าออฟไลน์ค่อยใช้ตัวที่เก็บไว้
// ไม่เก็บข้อมูลจากหลังบ้าน (Google Apps Script) และไม่เก็บภาพแผนที่
const CACHE = 'fleet-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (!sameOrigin && !cdn) return; // หลังบ้าน, แผนที่ ฯลฯ ให้ไปตามปกติ
  if (req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('.html'))) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
