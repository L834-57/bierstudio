'use strict';
/* Bierstudio – Frontend ohne Build-Schritt. Alle Aktionen laufen über data-act/data-on (CSP-tauglich). */

// ------------------------------------------------------------------ Grundlagen
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
};
const CATS = ['Aussehen', 'Geruch', 'Geschmack', 'Körper', 'Abgang'];
const W = { Aussehen: 1, Geruch: 1, Geschmack: 2, 'Körper': 1, Abgang: 1 };
const TAGS = ['süffig', 'herb', 'bitter', 'malzig', 'süß', 'fruchtig', 'hopfig', 'spritzig', 'mild', 'würzig', 'vollmundig', 'wässrig', 'säuerlich', 'rauchig'];
const STYLES = ['Pils', 'Helles', 'Lager', 'Export', 'Weizen', 'Kellerbier', 'Märzen', 'Dunkel', 'Bock', 'Kölsch', 'Alt', 'IPA', 'Pale Ale', 'Stout', 'Porter', 'Radler', 'Alkoholfrei'];

let D = LS.get('bs-cache', null);
let me = LS.get('bs-user', '');
let view = LS.get('bs-view', 'abend');
let sid = LS.get('bs-session', null);
let outbox = LS.get('bs-outbox', []);
let online = navigator.onLine;
let seg = 'rate', statSeg = 'ich';
let buch = { q: '', f: 'all', sort: 'avg' };
let pendingRender = false, deferredInstall = null, scanStream = null, addState = null;
const pick = {}, lastCurrent = {}, forms = {};
const drafts = LS.get('bs-drafts', {});
const ACT = {}, ON = {}, CH = {};
const DEMO = window.__BS_DEMO || null;

const theme = LS.get('bs-theme', '');
if (theme) document.documentElement.dataset.theme = theme;

// ------------------------------------------------------------------ Format-Helfer
const fmt = (v, d = 2) => v == null || isNaN(v) ? '–' : (+v).toLocaleString('de-DE', { maximumFractionDigits: d });
const color = v => v == null ? 'var(--muted)' : `hsl(${Math.round(Math.max(0, Math.min(10, v)) * 12)} 70% 44%)`;
const hue = str => { let h = 7; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = n => String(n).trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?';
const avatar = (name, cls = '') => `<span class="av ${cls}" style="background:hsl(${hue(name)} 42% 44%)" title="${esc(name)}">${esc(initials(name))}</span>`;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = v => Math.max(0, Math.min(10, v));
const hex16 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { } };
const dateDe = iso => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? new Date(iso.slice(0, 10) + 'T12:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
function verdict(v) {
  if (v == null) return 'Zieh den Regler oder tipp auf die Zahl';
  return v < 2 ? 'Weg damit' : v < 4 ? 'Eher nicht' : v < 5.5 ? 'Geht so' : v < 7 ? 'Ordentlich' : v < 8.5 ? 'Richtig gut' : v < 9.5 ? 'Hervorragend' : 'Perfekt';
}
let toastTimer, toastAction = null;
function toast(t, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(t)}</span>` + (action ? `<button class="toast-act" data-act="toastAct">${esc(action.label)}</button>` : '');
  el.classList.toggle('has-act', !!action); el.classList.add('show');
  toastAction = action?.run || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); toastAction = null; }, action ? 8000 : 2800);
}
const undoToast = (msg, tid) => toast(msg, tid ? { label: 'Rückgängig', run: () => restoreTrash(tid) } : null);
async function restoreTrash(tid) {
  try { await send('trash/restore', { tid }); haptic(20); toast('Wiederhergestellt ✓'); } catch (e) { toast(e.message); }
}

/** Eigener Dialog statt confirm()/prompt() – sieht auf dem Handy besser aus und funktioniert überall. */
function ask({ title, text = '', ok = 'OK', danger = false, input = null }) {
  return new Promise(res => {
    const d = $('#ask');
    $('#ask-body').innerHTML = `<h2>${esc(title)}</h2>${text ? `<p class="muted small">${esc(text)}</p>` : ''}${input ? `<input class="field" id="ask-in" value="${esc(input.value ?? '')}" placeholder="${esc(input.placeholder || '')}" inputmode="${input.mode || 'text'}" maxlength="${input.max || 60}" autocomplete="off" style="margin-top:8px">` : ''}<div class="btns" style="margin-top:18px"><button class="btn" id="ask-no">Abbrechen</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" id="ask-ok">${esc(ok)}</button></div>`;
    let done = false;
    const fin = v => { if (done) return; done = true; if (d.open) d.close(); res(v); };
    $('#ask-no').onclick = () => fin(input ? null : false);
    $('#ask-ok').onclick = () => fin(input ? $('#ask-in').value : true);
    d.onclose = () => fin(input ? null : false);
    d.onkeydown = e => { if (e.key === 'Enter' && input) { e.preventDefault(); $('#ask-ok').click(); } };
    d.showModal();
    if (input) setTimeout(() => { $('#ask-in').focus(); $('#ask-in').select(); }, 60);
  });
}

// ------------------------------------------------------------------ Daten-Helfer
const session = () => D?.sessions.find(s => s.id === sid) || null;
const beer = id => D.beers.find(b => b.id === id);
const visible = r => !r.hidden;
const ctxEq = (a, b) => (a || null) === (b || null);
function label(b, s) {
  if (!b) return 'Unbekannt';
  if (!b.blind) return b.name;
  const i = s ? s.beers.indexOf(b.id) : -1;
  return i >= 0 ? `Bier ${i + 1}` : 'Verdecktes Bier';
}
const COUNTRIES = { DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', CZ: 'Tschechien', BE: 'Belgien', NL: 'Niederlande', DK: 'Dänemark', PL: 'Polen', FR: 'Frankreich', IT: 'Italien', ES: 'Spanien', PT: 'Portugal', GB: 'Großbritannien', IE: 'Irland', US: 'USA', MX: 'Mexiko', JP: 'Japan', CN: 'China', TH: 'Thailand', AU: 'Australien', SE: 'Schweden', NO: 'Norwegen', FI: 'Finnland', HU: 'Ungarn', HR: 'Kroatien', GR: 'Griechenland', TR: 'Türkei' };
const countryCode = c => { if (!c) return ''; if (COUNTRIES[c]) return c; const hit = Object.entries(COUNTRIES).find(([, n]) => n === c || (c === 'Vereinigte Staaten' && n === 'USA') || (c === 'Vereinigtes Königreich' && n === 'Großbritannien')); return hit ? hit[0] : c; };
const flag = c => /^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(...[...c].map(x => 0x1F1A5 + x.charCodeAt(0))) : '';
const countryText = c => flag(c) ? `${flag(c)} ${COUNTRIES[c] || c}` : (c || '');
function meta(b, long = false) {
  if (!b || b.blind) return 'Wird bei der Auflösung enthüllt';
  const country = long ? countryText(b.country) : (flag(b.country) || b.country || '');
  return [b.brewery, b.style, b.abv != null && b.abv !== '' ? fmt(b.abv, 1) + ' %' : '', country].filter(Boolean).map(esc).join(' · ');
}
const logoUrl = b => `/api/logo?b=${encodeURIComponent(b.brewery || '')}&s=${encodeURIComponent(b.site || '')}&v=${LS.get('bs-logo-v', 0)}`;
/** Produktbild > Brauerei-Logo > farbiger Anfangsbuchstabe (Fallback bei Ladefehler, siehe error-Listener) */
function thumb(b, s) {
  const t = label(b, s), fb = b?.blind ? '?' : (t[0] || '?').toUpperCase(), h = hue(t);
  if (b?.image && !b.blind) return `<img class="thumb" src="${esc(b.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb="${esc(fb)}" data-h="${h}">`;
  // Logo liegt über dem Buchstaben und wird erst nach dem Laden sichtbar – nie ein leeres Kästchen
  if (!DEMO && b && !b.blind && (b.site || b.brewery)) return `<span class="thumb" style="background:hsl(${h} 38% 40%)">${esc(fb)}<img class="logo" src="${esc(logoUrl(b))}" alt="" loading="lazy"></span>`;
  return `<span class="thumb" style="background:hsl(${h} 38% 40%)">${esc(fb)}</span>`;
}
document.addEventListener('load', e => { if (e.target.classList?.contains('logo')) e.target.classList.add('ok'); }, true);
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.classList.contains('logo')) { t.remove(); return; }
  if (t.tagName !== 'IMG' || !t.dataset.fb) return;
  const sp = document.createElement('span');
  sp.className = 'thumb'; sp.style.background = `hsl(${t.dataset.h} 38% 40%)`; sp.textContent = t.dataset.fb;
  t.replaceWith(sp);
}, true);

// ---------- Hinterlegter Bier-Katalog (offline) + Kandidaten aus Online-Suchen
let CAT = null;
const fold = s => String(s || '').toLocaleLowerCase('de').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
async function catalog() {
  if (!CAT) {
    try { CAT = (await (await fetch('catalog.json')).json()).beers.map(c => ({ ...c, source: 'katalog', keys: [c.name, ...c.aliases].map(fold) })); }
    catch { CAT = []; }
  }
  return CAT;
}
function catScore(c, q) {
  const fq = fold(q);
  if (!fq) return 0;
  const qt = fq.split(' ');
  let best = 0;
  for (const k of c.keys) {
    if (k === fq) return 100;
    const kt = k.split(' ');
    if (k.startsWith(fq + ' ') || k.startsWith(fq)) best = Math.max(best, 70);
    if (qt.every(t => kt.some(x => x.startsWith(t)))) best = Math.max(best, 60 + Math.round(15 * qt.length / kt.length));
    else if (fq.length >= 3 && k.includes(fq)) best = Math.max(best, 45);
  }
  if (c.brewery && qt.every(t => fold(c.brewery).includes(t))) best = Math.max(best, 40);
  return best;
}
const catRank = q => (CAT || []).map(c => [catScore(c, q), c]).filter(x => x[0] >= 40).sort((a, b) => b[0] - a[0]);
const catSearch = (q, n = 5) => catRank(q).slice(0, n).map(x => x[1]);
/** Eindeutiger Treffer für automatisches Ergänzen (z. B. „Zäpfle“ → Rothaus Pils Tannenzäpfle). */
function catBest(name) {
  const r = catRank(name);
  if (!r.length || r[0][0] < 60) return null;
  return r[0][0] === 100 || !r[1] || r[1][0] < r[0][0] ? r[0][1] : null;
}
const SRC = { katalog: 'Bierstudio-Katalog', wikidata: 'Wikidata', off: 'Open Food Facts' };
const candMeta = c => [c.brewery, c.style, c.abv != null && c.abv !== '' ? fmt(c.abv, 1) + ' %' : '', countryText(countryCode(c.country)), c.quantity].filter(Boolean).map(esc).join(' · ');
const candThumb = c => thumb({ id: '', name: c.name, brewery: c.brewery, site: c.site, image: c.image });
const offToCand = p => ({ source: 'off', name: p.name, brewery: p.brand, style: p.style, abv: p.abv, barcode: p.code, image: p.image, quantity: p.quantity, country: '', site: '' });
/** Felder eines Kandidaten für ein Bier; mit onlyEmpty nur Lücken füllen. */
function candFields(c, b = {}, onlyEmpty = false) {
  const out = {};
  const put = (k, v) => { if (v == null || v === '') return; if (onlyEmpty && b[k] != null && b[k] !== '') return; out[k] = v; };
  put('brewery', c.brewery); put('style', c.style); put('abv', c.abv); put('country', countryCode(c.country)); put('site', c.site);
  if (!b.barcode) put('barcode', c.barcode);
  if (!b.image) put('image', c.image);
  if (Object.keys(out).length) out.source = c.source;
  return out;
}
catalog();
const avg = rs => { const v = rs.filter(visible); return v.length ? v.reduce((a, r) => a + r.value, 0) / v.length : null; };
const own = (s, b) => D.ratings.find(r => r.beer === b && r.user === me && ctxEq(r.session, s));
function beerAgg(id) {
  // pro Person zuerst mitteln, damit Vieltrinker nicht doppelt zählen
  const per = {};
  for (const r of D.ratings) if (r.beer === id && visible(r)) (per[r.user] ||= []).push(r.value);
  const vals = Object.values(per).map(a => a.reduce((x, y) => x + y, 0) / a.length);
  return { avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, people: vals.length, per };
}

// ------------------------------------------------------------------ Netzwerk & Offline-Warteschlange
async function http(path, body) {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { }
  if (!r.ok) { const e = new Error(j.error || 'Fehler ' + r.status); e.server = true; throw e; }
  return j;
}
function setOnline(v) {
  online = v;
  const n = outbox.length, el = $('#net');
  el.hidden = v && !n;
  el.textContent = v ? `Synchronisiere ${n} …` : `Offline${n ? ' · ' + n + ' wartend' : ''}`;
}
async function flush() {
  while (outbox.length) {
    const it = outbox[0];
    try { await http('/api/' + it.path, it.body); }
    catch (e) { if (!e.server) return false; toast('Nicht synchronisiert: ' + e.message); }
    outbox.shift(); LS.set('bs-outbox', outbox);
  }
  return true;
}
/** Sendet eine Aktion. Mit queue:true wird sie offline zwischengespeichert und lokal angewendet. */
async function send(path, body, opt = {}) {
  const enqueue = () => {
    outbox.push({ path, body: { ...body, ...(opt.offlineBody || {}) } }); LS.set('bs-outbox', outbox);
    opt.apply?.(); LS.set('bs-cache', D); setOnline(false); return { queued: true, id: body.id };
  };
  if (opt.queue && outbox.length) return enqueue(); // Reihenfolge einhalten
  try {
    const j = await http('/api/' + path, body);
    await refresh(true);
    return j;
  } catch (e) {
    if (!e.server && opt.queue) return enqueue();
    throw e.server ? e : new Error('Keine Verbindung zum Server');
  }
}
let refreshing = null;
async function refresh(force = false) {
  if (refreshing && !force) return refreshing;
  refreshing = (async () => {
    try {
      if (outbox.length && !(await flush())) throw new TypeError('offline');
      const j = await http(`/api/state?user=${encodeURIComponent(me)}${force || !D ? '' : '&since=' + D.rev}`);
      setOnline(true);
      if (!j.unchanged) { D = j; LS.set('bs-cache', D); onData(); }
    } catch (e) { setOnline(false); if (!D) $('#main').innerHTML = '<div class="card empty"><div class="big">📡</div><h2>Server nicht erreichbar</h2><p class="muted">Bist du im richtigen WLAN bzw. VPN?</p></div>'; }
    finally { refreshing = null; }
  })();
  return refreshing;
}
function onData() {
  if (me && !D.people.includes(me) && !outbox.some(o => o.path === 'person')) { me = ''; LS.set('bs-user', ''); }
  for (const k of Object.keys(drafts)) if (!drafts[k].dirty) delete drafts[k];
  // "Im Glas" folgen: wenn der Gastgeber das nächste Bier setzt, springen alle mit
  for (const s of D.sessions) {
    const prev = lastCurrent[s.id];
    if (prev !== undefined && prev !== s.current && s.current && s.id === sid) {
      const cur = pick[s.id];
      if (!cur || cur === prev) {
        if (!drafts[`${s.id}:${cur}:${me}`]?.dirty) {
          pick[s.id] = s.current; seg = 'rate';
          toast('Neu im Glas: ' + label(beer(s.current), s)); haptic(30);
        }
      }
    }
    lastCurrent[s.id] = s.current;
  }
  requestRender();
}
function applyRate(body) {
  D.ratings = D.ratings.filter(r => !(r.user === body.user && r.beer === body.beer && ctxEq(r.session, body.session)));
  if (body.favorite && body.session) D.ratings.forEach(r => { if (r.user === body.user && r.session === body.session) r.favorite = false; });
  D.ratings.push({ ...body, value: round(body.value, 2) });
  const s = D.sessions.find(x => x.id === body.session);
  if (s && !s.people.includes(body.user)) s.people.push(body.user);
}

// ------------------------------------------------------------------ Rendering
function editing() {
  const a = document.activeElement;
  return a && $('#main').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}
function requestRender() { if (editing()) pendingRender = true; else render(); }
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !editing()) { pendingRender = false; render(); } }, 80));

function render() {
  if (!D) return;
  for (const v of ['abend', 'buch', 'stats', 'mehr']) $('#t-' + v).classList.toggle('active', view === v);
  $('#me').textContent = me ? initials(me) : '?';
  $('#me').style.background = me ? `hsl(${hue(me)} 42% 44%)` : '';
  $('#me').style.color = me ? '#fff' : '';
  const html = { abend: renderAbend, buch: renderBuch, stats: renderStats, mehr: renderMehr }[view]();
  const y = scrollY;
  $('#main').innerHTML = `<div class="view">${html}</div>`;
  if (lastView === view) scrollTo(0, y); else scrollTo(0, 0);
  lastView = view;
}
let lastView = null;

const whoCard = () => `<div class="card empty"><div class="big">👋</div><h2>Wer trinkt mit?</h2><p class="muted">Wähle deinen Namen, damit deine Noten dir zugeordnet werden.</p><button class="btn primary" data-act="pickUser">Person wählen</button></div>`;

// ---------- Abend
function currentSession() {
  if (!D.sessions.some(s => s.id === sid)) {
    const open = D.sessions.filter(s => !s.closed);
    sid = D.sessions.some(s => s.id === D.active) ? D.active : (open.at(-1) || D.sessions.at(-1))?.id || null;
  }
  return session();
}
function renderAbend() {
  const s = currentSession();
  if (!s) return `<h1>Tasting-Abend</h1><div class="card empty"><div class="big">🍻</div><h2>Noch kein Abend</h2><p class="muted">Leg einen Abend an, lade deine Leute per QR-Code ein und bewertet gemeinsam dasselbe Bier.</p><div class="btns" style="justify-content:center;margin-top:14px"><button class="btn primary" data-act="newSession">Abend starten</button></div><p class="small muted" style="margin-top:18px">Allein unterwegs? Tippe auf <b>＋</b> und trag dein Bier einfach so ein.</p>${DEMO?.seedUrl ? '<button class="btn ghost" data-act="demoSeed" style="margin-top:6px">Bisheriges Tasting laden (27 Biere)</button>' : ''}</div>`;
  const status = s.closed ? '<span class="pill">Abgeschlossen</span>' : !s.reveal ? '<span class="pill accent">🙈 Blind</span>' : '<span class="pill">Offen</span>';
  const total = s.beers.length * Math.max(1, s.people.length);
  const done = D.ratings.filter(r => r.session === s.id).length;
  let out = `<div class="between" style="margin-top:4px;align-items:flex-start">
    <button class="grow" style="text-align:left;min-width:0" data-act="switchSession">
      <div class="row" style="gap:6px">${status}${D.active === s.id && !s.closed ? '<span class="pill live">LIVE</span>' : ''}</div>
      <h1 class="ellipsis">${esc(s.name)} <span class="chev">⌄</span></h1>
      <div class="small muted">${[dateDe(s.date), s.place && esc(s.place), `${s.people.length} Personen`, `${s.beers.length} ${s.beers.length === 1 ? 'Bier' : 'Biere'}`].filter(Boolean).join(' · ')}</div>
    </button>
    <button class="icon-btn" data-act="sessionMenu" aria-label="Abend-Optionen">⋯</button></div>
  <div class="seg" style="margin:14px 0"><button class="${seg === 'rate' ? 'on' : ''}" data-act="seg" data-v="rate">Bewerten</button><button class="${seg === 'res' ? 'on' : ''}" data-act="seg" data-v="res">Ergebnis${s.reveal ? '' : ' 🙈'} <span class="tiny muted">${Math.round(100 * done / (total || 1))} %</span></button></div>`;
  return out + (seg === 'res' ? renderResults(s) : renderRate(s));
}
function selectedBeer(s) {
  let id = pick[s.id];
  if (!s.beers.includes(id)) id = s.current && s.beers.includes(s.current) ? s.current : s.beers.find(b => !own(s.id, b)) || s.beers[0];
  pick[s.id] = id;
  return id;
}
function renderRate(s) {
  if (!s.beers.length) return `<div class="card empty"><div class="big">🍺</div><h2>Noch keine Biere</h2><p class="muted">Füge das erste Bier hinzu – alle sehen es sofort auf ihrem Handy.</p><button class="btn primary" data-act="addToSession">＋ Bier hinzufügen</button></div>`;
  const id = selectedBeer(s), b = beer(id), idx = s.beers.indexOf(id);
  const raters = new Set(D.ratings.filter(r => r.session === s.id && r.beer === id).map(r => r.user));
  const chips = s.beers.map((x, i) => {
    const bb = beer(x), l = label(bb, s);
    return `<button class="chip ${x === id ? 'on' : ''} ${s.current === x ? 'live' : ''}" data-act="pickBeer" data-id="${x}">${i + 1}. ${esc(l.length > 18 ? l.slice(0, 17) + '…' : l)}${own(s.id, x) ? ' ✓' : ''}</button>`;
  }).join('');
  const people = [...new Set([...s.people, ...raters])];
  return `<div class="chips" id="beerchips">${chips}${s.closed ? '' : '<button class="chip" data-act="addToSession">＋ Bier</button>'}</div>
  <div class="card" style="margin-top:8px">
    <div class="hero">${thumb(b, s)}<div class="grow" style="min-width:0">
      <div class="row" style="gap:6px">${s.current === id ? '<span class="pill live">Im Glas</span>' : ''}<span class="pill">${idx + 1} von ${s.beers.length}</span></div>
      <h2 style="margin:6px 0 2px">${esc(label(b, s))}</h2><div class="small muted">${meta(b) || 'Keine weiteren Infos'}</div></div></div>
    <div class="who">${people.map(p => avatar(p, raters.has(p) ? 'done' : 'off')).join('')}</div>
    <div class="between small muted" style="margin-top:8px"><span>${raters.size} von ${people.length} haben bewertet</span>
    ${s.current !== id && !s.closed ? `<button class="btn ghost small" data-act="setCurrent" data-id="${id}">Für alle ins Glas</button>` : ''}</div>
  </div>
  ${me ? `<div class="card">${rateForm('m', s.id, id)}</div>
  <div class="btns"><button class="btn" data-act="stepBeer" data-d="-1" ${idx === 0 ? 'disabled' : ''}>← Zurück</button><button class="btn" data-act="nextOpen">Nächstes offenes →</button></div>` : whoCard()}`;
}

// ---------- Bewertungsformular (wird in Abend und Sheets wiederverwendet)
const dkey = (s, b) => `${s || 'solo'}:${b}:${me}`;
function draftFor(s, b) {
  const k = dkey(s, b);
  if (!drafts[k]) {
    const r = own(s, b), empty = Object.fromEntries(CATS.map(c => [c, null]));
    drafts[k] = r ? { mode: r.detail ? 'detail' : 'quick', value: r.value, detail: r.detail ? { ...r.detail } : empty, tags: [...(r.tags || [])], note: r.note || '', favorite: !!r.favorite, dirty: false }
      : { mode: LS.get('bs-mode', 'quick'), value: null, detail: empty, tags: [], note: '', favorite: false, dirty: false };
  }
  return drafts[k];
}
const saveDrafts = () => LS.set('bs-drafts', Object.fromEntries(Object.entries(drafts).filter(([, v]) => v.dirty)));
function draftValue(d) {
  if (d.mode === 'detail') return CATS.some(c => d.detail[c] == null) ? null : CATS.reduce((a, c) => a + d.detail[c] * W[c], 0) / 6 * 2;
  return d.value;
}
function saveLabel(f, d) {
  const sess = f.s && D.sessions.find(x => x.id === f.s);
  if (sess?.closed) return 'Abend ist abgeschlossen';
  if (draftValue(d) == null) return d.mode === 'detail' ? 'Alle fünf Kategorien bewerten' : 'Note wählen';
  return own(f.s, f.b) ? (d.dirty ? 'Änderung speichern' : 'Gespeichert ✓') : 'Bewertung speichern';
}
function rateForm(p, s, b, opt = {}) {
  const f = forms[p] = { s, b, ...opt };
  const d = draftFor(s, b), v = draftValue(d), ex = own(s, b);
  const sess = s && D.sessions.find(x => x.id === s);
  const quick = `<input type="range" class="slider ${d.value == null ? 'unset' : ''}" id="${p}-range" min="0" max="10" step="0.1" value="${d.value ?? 5}" data-on="range" data-change="rangeDone" data-p="${p}" style="--p:${(d.value ?? 0) * 10}%;--c:${color(d.value)}" aria-label="Note von 0 bis 10">
    <div class="scale"><span>0 · gar nicht</span><span>5 · ordentlich</span><span>10 · perfekt</span></div>
    <div class="steps" style="margin-top:12px">${[-0.5, -0.1, 0.1, 0.5].map(x => `<button data-act="rf" data-p="${p}" data-k="step" data-v="${x}" aria-label="${x > 0 ? 'plus' : 'minus'} ${fmt(Math.abs(x), 1)}">${x > 0 ? '+' : '−'}${fmt(Math.abs(x), 1)}</button>`).join('')}</div>`;
  const detail = CATS.map(c => `<div class="cat"><span>${c}${W[c] > 1 ? ' <small>×2</small>' : ''}</span><div class="five">${[1, 2, 3, 4, 5].map(n => `<button class="${d.detail[c] === n ? 'on' : ''}" data-act="rf" data-p="${p}" data-k="cat" data-c="${c}" data-v="${n}" aria-label="${c} ${n}">${n}</button>`).join('')}</div></div>`).join('') +
    '<p class="tiny muted">1 = schwach · 5 = hervorragend · Geschmack zählt doppelt. Ergibt eine Note von 2 bis 10.</p>';
  return `<div id="rf-${p}">
    <div class="rate-head"><button data-act="rfExact" data-p="${p}" aria-label="Note eintippen"><span class="big-score ${v == null ? 'unset' : ''}" id="${p}-score" style="${v == null ? '' : 'color:' + color(v)}">${v == null ? '–' : fmt(v)}</span><span class="of10">/10</span></button>
    <div class="verdict" id="${p}-verdict">${verdict(v)}</div></div>
    <div class="seg" style="margin-top:14px"><button class="${d.mode === 'quick' ? 'on' : ''}" data-act="rf" data-p="${p}" data-k="mode" data-v="quick">Schnell</button><button class="${d.mode === 'detail' ? 'on' : ''}" data-act="rf" data-p="${p}" data-k="mode" data-v="detail">Detailliert</button></div>
    ${d.mode === 'quick' ? quick : detail}
    <label class="lbl">Eindruck</label>
    <div class="chips wrap">${[...new Set([...TAGS, ...d.tags])].map(t => `<button class="chip ${d.tags.includes(t) ? 'on' : ''}" data-act="rf" data-p="${p}" data-k="tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}<button class="chip" data-act="rf" data-p="${p}" data-k="newtag">＋</button></div>
    <label class="lbl" for="${p}-note">Notiz</label>
    <textarea class="field" id="${p}-note" data-on="note" data-p="${p}" rows="2" maxlength="1000" placeholder="Was bleibt hängen?">${esc(d.note)}</textarea>
    <div class="between" style="margin-top:12px">
      <button class="fav ${d.favorite ? 'on' : ''}" data-act="rf" data-p="${p}" data-k="fav">${d.favorite ? '♥' : '♡'} ${s ? 'Favorit des Abends' : 'Lieblingsbier'}</button>
      ${ex && !sess?.closed ? `<button class="btn ghost danger small" data-act="rfDelete" data-p="${p}">Löschen</button>` : ''}</div>
    <div class="savebar"><button class="btn primary block" id="${p}-save" data-act="rfSave" data-p="${p}" ${v == null || sess?.closed || (ex && !d.dirty) ? 'disabled' : ''}>${saveLabel(f, d)}</button></div>
  </div>`;
}
function rfRerender(p) { const f = forms[p], el = document.getElementById('rf-' + p); if (el) el.outerHTML = rateForm(p, f.s, f.b, f); }
function rfLive(p) {
  const f = forms[p], d = draftFor(f.s, f.b), v = draftValue(d);
  const sc = document.getElementById(p + '-score'), r = document.getElementById(p + '-range'), btn = document.getElementById(p + '-save');
  if (sc) { sc.textContent = v == null ? '–' : fmt(v); sc.style.color = v == null ? '' : color(v); sc.classList.toggle('unset', v == null); }
  document.getElementById(p + '-verdict').textContent = verdict(v);
  if (r) { r.classList.toggle('unset', d.value == null); r.style.setProperty('--p', (d.value ?? 0) * 10 + '%'); r.style.setProperty('--c', color(d.value)); }
  const sess = f.s && D.sessions.find(x => x.id === f.s);
  if (btn) { btn.disabled = v == null || !!sess?.closed || (own(f.s, f.b) && !d.dirty); btn.textContent = saveLabel(f, d); }
}
ON.range = el => { const p = el.dataset.p, f = forms[p], d = draftFor(f.s, f.b); d.value = +el.value; d.dirty = true; rfLive(p); };
CH.rangeDone = () => saveDrafts();
ON.note = el => { const p = el.dataset.p, f = forms[p], d = draftFor(f.s, f.b); d.note = el.value; d.dirty = true; saveDrafts(); rfLive(p); };
ACT.rf = async el => {
  const p = el.dataset.p, f = forms[p], d = draftFor(f.s, f.b), k = el.dataset.k;
  if (k === 'mode') { d.mode = el.dataset.v; LS.set('bs-mode', d.mode); }
  if (k === 'step') d.value = clamp(round((d.value ?? 5) + +el.dataset.v, 1));
  if (k === 'cat') d.detail[el.dataset.c] = +el.dataset.v;
  if (k === 'tag') d.tags = d.tags.includes(el.dataset.v) ? d.tags.filter(x => x !== el.dataset.v) : [...d.tags, el.dataset.v];
  if (k === 'newtag') { const t = ((await ask({ title: 'Eigener Eindruck', ok: 'Hinzufügen', input: { placeholder: 'z. B. karamellig', max: 24 } })) || '').trim().slice(0, 24); if (!t) return; if (!d.tags.includes(t)) d.tags.push(t); }
  if (k === 'fav') d.favorite = !d.favorite;
  d.dirty = true; saveDrafts(); haptic(); rfRerender(p);
};
ACT.rfExact = async el => {
  const p = el.dataset.p, f = forms[p], d = draftFor(f.s, f.b);
  const x = await ask({ title: 'Note eintippen', text: 'Von 0 bis 10, Komma erlaubt.', ok: 'Übernehmen', input: { value: d.value == null ? '' : fmt(d.value), mode: 'decimal', max: 5 } });
  if (x == null) return;
  const n = Number(x.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10) return toast('Bitte eine Zahl zwischen 0 und 10');
  d.mode = 'quick'; d.value = round(n, 2); d.dirty = true; saveDrafts(); rfRerender(p);
};
ACT.rfSave = async el => {
  if (!me) return pickUser();
  const p = el.dataset.p, f = forms[p], k = dkey(f.s, f.b), d = drafts[k], v = draftValue(d);
  if (v == null) return;
  el.disabled = true; el.textContent = 'Speichert …';
  const body = { beer: f.b, user: me, session: f.s || null, value: round(v, 2), detail: d.mode === 'detail' ? d.detail : null, tags: d.tags, note: d.note, favorite: d.favorite, ts: new Date().toISOString() };
  delete drafts[k]; saveDrafts();
  try {
    const r = await send('rate', body, { queue: true, apply: () => applyRate(body) });
    haptic(25); toast(r.queued ? 'Offline gespeichert – wird synchronisiert' : 'Gespeichert ✓');
    if (f.onSaved) f.onSaved(); else render();
  } catch (e) { drafts[k] = d; saveDrafts(); toast(e.message); rfRerender(p); }
};
ACT.rfDelete = async el => {
  const f = forms[el.dataset.p];
  if (!(await ask({ title: 'Bewertung löschen?', text: 'Deine Note für dieses Bier wird entfernt.', ok: 'Löschen', danger: true }))) return;
  const body = { beer: f.b, user: me, session: f.s || null };
  try {
    const r = await send('rating/delete', body, { queue: true, apply: () => { D.ratings = D.ratings.filter(r => !(r.user === me && r.beer === f.b && ctxEq(r.session, f.s))); } });
    delete drafts[dkey(f.s, f.b)]; saveDrafts(); undoToast('Bewertung gelöscht', r.tid);
    if (f.onSaved) f.onSaved(); else render();
  } catch (e) { toast(e.message); }
};

// ---------- Ergebnis eines Abends
function sessionRows(s) {
  return s.beers.map(id => {
    const rs = D.ratings.filter(r => r.session === s.id && r.beer === id), vis = rs.filter(visible), a = avg(vis);
    const sd = vis.length ? Math.sqrt(vis.reduce((x, r) => x + (r.value - a) ** 2, 0) / vis.length) : 0;
    return { b: beer(id), id, rs, vis, a, sd, fav: vis.filter(r => r.favorite).length };
  });
}
function renderResults(s) {
  const rows = sessionRows(s);
  const people = [...new Set([...s.people, ...D.ratings.filter(r => r.session === s.id).map(r => r.user)])];
  if (!s.reveal) {
    return `<div class="card empty"><div class="big">🙈</div><h2>Noch verdeckt</h2><p class="muted">Biernamen und fremde Noten bleiben geheim, bis ihr auflöst – auch technisch, nicht nur optisch.</p>
      ${s.closed ? '' : '<button class="btn primary" data-act="reveal">Jetzt auflösen</button>'}</div>
      <div class="section-title">Fortschritt</div><div class="card">${people.map(p => { const n = D.ratings.filter(r => r.session === s.id && r.user === p).length; return `<div class="bar-row"><span class="row" style="gap:8px">${avatar(p)}<span class="ellipsis">${esc(p)}</span></span><div class="meter"><i style="width:${100 * n / (s.beers.length || 1)}%"></i></div><span class="num small">${n}/${s.beers.length}</span></div>`; }).join('')}</div>`;
  }
  const ranked = rows.filter(r => r.a != null).sort((a, b) => b.a - a.a);
  if (!ranked.length) return '<div class="card empty"><div class="big">📊</div><h2>Noch keine Noten</h2><p class="muted">Sobald bewertet wird, entsteht hier die Rangliste.</p></div>';
  const medal = ['🥇', '🥈', '🥉'];
  const podium = ranked.length >= 3 ? `<div class="podium">${[1, 0, 2].map(i => `<div class="p p${i + 1}"><div class="medal">${medal[i]}</div><b style="color:${color(ranked[i].a)}">${fmt(ranked[i].a, 1)}</b><div class="nm">${esc(label(ranked[i].b, s))}</div></div>`).join('')}</div>` : '';
  const list = ranked.map((x, i) => `<button class="item" data-act="beerSheet" data-id="${x.id}">
    <span class="num muted" style="width:22px;text-align:center;font-weight:700">${i + 1}</span>
    <div class="grow"><h3>${esc(label(x.b, s))}</h3><div class="sub">${x.vis.length} Noten${x.fav ? ` · ♥ ${x.fav}` : ''} · Streuung ${fmt(x.sd, 1)}</div>
      <div class="strip">${x.vis.map(r => `<span class="pt" style="left:${r.value * 10}%;background:hsl(${hue(r.user)} 42% 44%)" title="${esc(r.user)}: ${fmt(r.value)}"></span>`).join('')}<span class="avg" style="left:${x.a * 10}%"></span></div></div>
    <div class="score-pill"><b style="color:${color(x.a)}">${fmt(x.a, 2)}</b><small>Ø</small></div></button>`).join('');
  // Gesprächsstoff
  const multi = ranked.filter(x => x.vis.length >= 3);
  const contro = [...multi].sort((a, b) => b.sd - a.sd)[0], agree = [...multi].sort((a, b) => a.sd - b.sd)[0];
  const facts = [];
  if (contro) facts.push(['🔥', 'Am umstrittensten', `${label(contro.b, s)} – Noten von ${fmt(Math.min(...contro.vis.map(r => r.value)), 1)} bis ${fmt(Math.max(...contro.vis.map(r => r.value)), 1)}`]);
  if (agree && agree !== contro) facts.push(['🤝', 'Größte Einigkeit', `${label(agree.b, s)} – Streuung nur ${fmt(agree.sd, 2)}`]);
  const pp = people.map(p => { const v = D.ratings.filter(r => r.session === s.id && r.user === p && visible(r)); return { p, n: v.length, a: v.length ? v.reduce((x, r) => x + r.value, 0) / v.length : null }; }).filter(x => x.n >= 3).sort((a, b) => a.a - b.a);
  if (pp.length >= 2) { facts.push(['🧐', 'Strengste Zunge', `${pp[0].p} – Ø ${fmt(pp[0].a, 2)}`]); facts.push(['🥳', 'Großzügigste Zunge', `${pp.at(-1).p} – Ø ${fmt(pp.at(-1).a, 2)}`]); }
  const twin = twins(people, r => r.session === s.id, 3)[0];
  if (twin) facts.push(['👯', 'Geschmackszwillinge', `${twin.a} & ${twin.b} – im Schnitt nur ${fmt(twin.diff, 2)} auseinander`]);
  const oracle = people.map(p => {
    const d = rows.map(x => { const mine = x.vis.find(r => r.user === p), others = x.vis.filter(r => r.user !== p); return mine && others.length ? Math.abs(mine.value - avg(others)) : null; }).filter(x => x != null);
    return { p, d: d.length >= 3 ? d.reduce((a, b) => a + b, 0) / d.length : null };
  }).filter(x => x.d != null).sort((a, b) => a.d - b.d)[0];
  if (oracle) facts.push(['🎯', 'Trifft den Gruppengeschmack', `${oracle.p} – nur ${fmt(oracle.d, 2)} vom Rest entfernt`]);
  const matrix = `<div class="table-wrap"><table><thead><tr><th>Bier</th>${people.map(p => `<th>${esc(initials(p))}</th>`).join('')}<th>Ø</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(label(x.b, s))}</td>${people.map(p => { const r = x.vis.find(r => r.user === p); return `<td class="cell" style="color:${r ? color(r.value) : 'var(--muted)'}">${r ? fmt(r.value, 1) + (r.favorite ? '♥' : '') : '–'}</td>`; }).join('')}<td><b>${fmt(x.a, 1)}</b></td></tr>`).join('')}</tbody></table></div>`;
  return `${podium}<div class="list">${list}</div>
    ${facts.length ? `<div class="section-title">Gesprächsstoff</div><div class="list">${facts.map(([i, t, d]) => `<div class="item"><span style="font-size:26px">${i}</span><div class="grow"><h3>${esc(t)}</h3><div class="sub" style="white-space:normal">${esc(d)}</div></div></div>`).join('')}</div>` : ''}
    <div class="section-title">Alle Noten</div><div class="card">${matrix}<p class="tiny muted" style="margin-top:10px">${people.map(p => `${esc(initials(p))} = ${esc(p)}`).join(' · ')}</p></div>
    <a class="btn block" href="/api/csv?session=${s.id}&user=${encodeURIComponent(me)}" download>CSV exportieren</a>`;
}
/** Paare mit ähnlichstem Geschmack: mittlere absolute Abweichung über gemeinsame Biere. */
function twins(people, filter, minCommon) {
  const by = {};
  for (const r of D.ratings) if (visible(r) && filter(r)) ((by[r.user] ||= {})[r.beer] ||= []).push(r.value);
  const m = u => Object.fromEntries(Object.entries(by[u] || {}).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
  const res = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const A = m(people[i]), B = m(people[j]), common = Object.keys(A).filter(k => k in B);
    if (common.length >= minCommon) res.push({ a: people[i], b: people[j], n: common.length, diff: common.reduce((x, k) => x + Math.abs(A[k] - B[k]), 0) / common.length });
  }
  return res.sort((a, b) => a.diff - b.diff);
}

// ---------- Bierbuch
function renderBuch() {
  const vis = D.beers.filter(b => !b.blind), hidden = D.beers.length - vis.length;
  const f = [['all', 'Alle'], ['mine', 'Von mir bewertet'], ['new', 'Noch nicht probiert'], ['fav', '♥ Favoriten'], ['solo', 'Solo']];
  return `<h1>Bierbuch</h1><p class="small muted">${vis.length} Biere · ${D.ratings.filter(visible).length} Bewertungen${hidden ? ` · ${hidden} verdeckt` : ''}</p>
  <input class="field" type="search" id="buch-q" data-on="buchQ" placeholder="Bier, Brauerei oder Stil suchen …" value="${esc(buch.q)}" enterkeyhint="search" autocomplete="off" style="margin-top:8px">
  <div class="chips" style="margin-top:10px">${f.map(([k, t]) => `<button class="chip ${buch.f === k ? 'on' : ''}" data-act="buchF" data-v="${k}">${t}</button>`).join('')}</div>
  ${(() => { const n = vis.filter(missingInfo).length; return n ? `<button class="card flat item" data-act="bulkEnrich" style="margin:6px 0 8px;min-height:0;width:100%"><span style="font-size:22px">✨</span><div class="grow"><h3>${n} ${n === 1 ? 'Bier' : 'Biere'} mit fehlenden Infos</h3><div class="sub">Alkohol, Stil, Brauerei ergänzen</div></div><span class="chev">›</span></button>` : ''; })()}
  <div class="between" style="margin:4px 2px 8px"><span class="small muted" id="buch-n"></span>
  <select class="field" style="width:auto;min-height:36px;padding:6px 10px;font-size:14px" data-change="buchSort" aria-label="Sortierung">${[['avg', 'Beste Ø'], ['mine', 'Meine Note'], ['new', 'Neueste'], ['az', 'A–Z']].map(([k, t]) => `<option value="${k}" ${buch.sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  <div id="buch-list">${buchList()}</div>`;
}
function buchList() {
  const q = norm(buch.q);
  let rows = D.beers.filter(b => !b.blind).map(b => {
    const ag = beerAgg(b.id), mine = D.ratings.filter(r => r.beer === b.id && r.user === me && visible(r));
    const last = D.ratings.filter(r => r.beer === b.id).map(r => r.ts || '').sort().at(-1) || b.created_at || '';
    return { b, ag, my: mine.length ? avg(mine) : null, fav: mine.some(r => r.favorite), solo: D.ratings.some(r => r.beer === b.id && !r.session), last };
  });
  if (q) rows = rows.filter(x => norm([x.b.name, x.b.brewery, x.b.style, x.b.barcode].join(' ')).includes(q));
  if (buch.f === 'mine') rows = rows.filter(x => x.my != null);
  if (buch.f === 'new') rows = rows.filter(x => x.my == null);
  if (buch.f === 'fav') rows = rows.filter(x => x.fav);
  if (buch.f === 'solo') rows = rows.filter(x => x.solo);
  const by = { avg: (a, b) => (b.ag.avg ?? -1) - (a.ag.avg ?? -1), mine: (a, b) => (b.my ?? -1) - (a.my ?? -1), new: (a, b) => (b.last > a.last ? 1 : -1), az: (a, b) => a.b.name.localeCompare(b.b.name, 'de') };
  rows.sort(by[buch.sort]);
  setTimeout(() => { const n = $('#buch-n'); if (n) n.textContent = rows.length + ' Treffer'; });
  if (!rows.length) return `<div class="card empty"><div class="big">🔍</div><p class="muted">Nichts gefunden.</p>${buch.q ? `<button class="btn primary" data-act="add" data-name="${esc(buch.q)}">„${esc(buch.q)}“ eintragen</button>` : ''}</div>`;
  return `<div class="list">${rows.map(x => `<button class="item" data-act="beerSheet" data-id="${x.b.id}">${thumb(x.b)}
    <div class="grow"><h3>${esc(x.b.name)}${x.fav ? ' <span style="color:#e5484d">♥</span>' : ''}</h3><div class="sub">${meta(x.b) || '&nbsp;'}</div></div>
    <div class="score-pill"><b style="color:${color(x.ag.avg)}">${fmt(x.ag.avg, 1)}</b><small>${x.my != null ? 'ich ' + fmt(x.my, 1) : x.ag.people + '× bewertet'}</small></div></button>`).join('')}</div>`;
}
ON.buchQ = el => { buch.q = el.value; $('#buch-list').innerHTML = buchList(); };
ACT.buchF = el => { buch.f = el.dataset.v; render(); };
CH.buchSort = el => { buch.sort = el.value; $('#buch-list').innerHTML = buchList(); };

// ---------- Statistik
function renderStats() {
  const seg2 = `<h1>Statistik</h1><div class="seg" style="margin:12px 0 16px"><button class="${statSeg === 'ich' ? 'on' : ''}" data-act="statSeg" data-v="ich">Ich</button><button class="${statSeg === 'gruppe' ? 'on' : ''}" data-act="statSeg" data-v="gruppe">Alle</button></div>`;
  if (statSeg === 'gruppe') return seg2 + groupStats();
  if (!me) return seg2 + whoCard();
  const mine = D.ratings.filter(r => r.user === me && visible(r));
  if (!mine.length) return seg2 + '<div class="card empty"><div class="big">📈</div><h2>Noch keine Daten</h2><p class="muted">Bewerte dein erstes Bier – hier entsteht dein Geschmacksprofil.</p></div>';
  const per = {};
  for (const r of mine) (per[r.beer] ||= []).push(r.value);
  const beers = Object.entries(per).map(([id, v]) => ({ b: beer(id), v: v.reduce((a, c) => a + c, 0) / v.length })).filter(x => x.b && !x.b.blind).sort((a, b) => b.v - a.v);
  const a = mine.reduce((x, r) => x + r.value, 0) / mine.length;
  const sessions = new Set(mine.filter(r => r.session).map(r => r.session)).size;
  const styles = {};
  for (const x of beers) if (x.b.style) (styles[x.b.style] ||= []).push(x.v);
  const st = Object.entries(styles).map(([k, v]) => ({ k, n: v.length, a: v.reduce((x, y) => x + y, 0) / v.length })).sort((x, y) => y.a - x.a);
  const tags = {};
  for (const r of mine) for (const t of r.tags || []) tags[t] = (tags[t] || 0) + 1;
  const hist = Array(11).fill(0);
  for (const r of mine) hist[Math.min(10, Math.floor(r.value))]++;
  const hmax = Math.max(...hist);
  const tw = twins(D.people, () => true, 3).filter(t => t.a === me || t.b === me);
  const row = (x, i) => `<button class="item" data-act="beerSheet" data-id="${x.b.id}"><span class="num muted" style="width:20px;font-weight:700">${i + 1}</span><div class="grow"><h3>${esc(x.b.name)}</h3><div class="sub">${meta(x.b) || '&nbsp;'}</div></div><div class="score-pill"><b style="color:${color(x.v)}">${fmt(x.v, 1)}</b></div></button>`;
  return seg2 + `<div class="kpis"><div class="kpi"><b>${beers.length}</b><span>Biere probiert</span></div><div class="kpi"><b style="color:${color(a)}">${fmt(a, 2)}</b><span>Ø meine Note</span></div><div class="kpi"><b>${sessions}</b><span>Abende</span></div><div class="kpi"><b>${esc(st[0]?.k || '–')}</b><span>Lieblingsstil</span></div></div>
  <div class="card"><h2>Notenverteilung</h2><div class="hist">${hist.map((n, i) => `<div><i style="height:${hmax ? 100 * n / hmax : 0}%;background:${color(i + 0.5)}" title="${n}× ${i}"></i><small>${i}</small></div>`).join('')}</div></div>
  <div class="section-title">Meine Top 5</div><div class="list">${beers.slice(0, 5).map(row).join('')}</div>
  ${beers.length > 5 ? `<div class="section-title">Nie wieder</div><div class="list">${beers.slice(-3).reverse().map((x, i) => row(x, beers.length - 1 - i)).join('')}</div>` : ''}
  ${st.length ? `<div class="section-title">Nach Bierstil</div><div class="card">${st.map(x => `<div class="bar-row"><span class="ellipsis">${esc(x.k)} <span class="muted small">${x.n}×</span></span><div class="meter"><i style="width:${x.a * 10}%;background:${color(x.a)}"></i></div><b class="num small">${fmt(x.a, 1)}</b></div>`).join('')}</div>` : ''}
  ${Object.keys(tags).length ? `<div class="section-title">Meine Eindrücke</div><div class="card"><div class="chips wrap">${Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="chip">${esc(t)} <span class="n">${n}</span></span>`).join('')}</div></div>` : ''}
  ${tw.length ? `<div class="section-title">Geschmacksverwandtschaft</div><div class="card">${tw.map(t => { const o = t.a === me ? t.b : t.a, sim = Math.max(0, 100 - t.diff * 10); return `<div class="bar-row" style="grid-template-columns:minmax(0,1fr) 110px 48px"><span class="row" style="gap:8px">${avatar(o)}<span class="ellipsis">${esc(o)} <span class="muted small">${t.n} gemeinsam</span></span></span><div class="meter"><i style="width:${sim}%"></i></div><b class="num small">${Math.round(sim)} %</b></div>`; }).join('')}<p class="tiny muted">100 % = immer identische Noten. Berechnet aus der mittleren Abweichung bei gemeinsam bewerteten Bieren.</p></div>` : ''}`;
}
function groupStats() {
  const rows = D.beers.filter(b => !b.blind).map(b => ({ b, ...beerAgg(b.id) })).filter(x => x.people >= 2).sort((a, b) => b.avg - a.avg);
  const ppl = D.people.map(p => { const v = D.ratings.filter(r => r.user === p && visible(r)); return { p, n: v.length, a: v.length ? v.reduce((x, r) => x + r.value, 0) / v.length : null }; }).filter(x => x.n).sort((a, b) => b.n - a.n);
  if (!rows.length && !ppl.length) return '<div class="card empty"><p class="muted">Noch keine Bewertungen.</p></div>';
  return `<div class="kpis"><div class="kpi"><b>${D.beers.filter(b => !b.blind).length}</b><span>Biere im Bierbuch</span></div><div class="kpi"><b>${D.ratings.length}</b><span>Bewertungen</span></div><div class="kpi"><b>${D.sessions.length}</b><span>Abende</span></div><div class="kpi"><b>${ppl.length}</b><span>Personen</span></div></div>
  <div class="section-title">Ewige Bestenliste <span style="text-transform:none;font-weight:500">(ab 2 Personen)</span></div>
  <div class="list">${rows.slice(0, 15).map((x, i) => `<button class="item" data-act="beerSheet" data-id="${x.b.id}"><span class="num muted" style="width:22px;font-weight:700">${i + 1}</span><div class="grow"><h3>${esc(x.b.name)}</h3><div class="sub">${x.people} Personen · ${meta(x.b) || ''}</div></div><div class="score-pill"><b style="color:${color(x.avg)}">${fmt(x.avg, 2)}</b></div></button>`).join('') || '<div class="item muted">Noch zu wenige Daten.</div>'}</div>
  <div class="section-title">Personen</div><div class="card">${ppl.map(x => `<div class="bar-row" style="grid-template-columns:minmax(0,1fr) 110px 42px"><span class="row" style="gap:8px">${avatar(x.p)}<span class="ellipsis">${esc(x.p)} <span class="muted small">${x.n} Noten</span></span></span><div class="meter"><i style="width:${x.a * 10}%;background:${color(x.a)}"></i></div><b class="num small">${fmt(x.a, 1)}</b></div>`).join('')}</div>`;
}
ACT.statSeg = el => { statSeg = el.dataset.v; render(); };

// ---------- Mehr
function renderMehr() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const install = DEMO ? '<p class="small muted">Das hier ist die Testversion im Browser. Als App installieren und offline nutzen geht in der selbst gehosteten Version (Docker/TrueNAS).</p>' : standalone ? '<p class="small muted">✓ Läuft bereits als App.</p>'
    : deferredInstall ? '<button class="btn primary block" data-act="install">Als App installieren</button>'
      : ios ? '<p class="small">In Safari unten auf <b>Teilen</b> <span aria-hidden="true">⎋</span> tippen und dann <b>„Zum Home-Bildschirm“</b> wählen.</p>'
        : `<p class="small">Im Browser-Menü <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen.</p>${isSecureContext ? '' : '<p class="tiny muted">Hinweis: Volle App-Installation und Offline-Modus brauchen HTTPS (z. B. über einen Reverse Proxy oder Tailscale). Über eine reine IP-Adresse mit http klappt nur die einfache Verknüpfung.</p>'}`;
  const sess = [...D.sessions].reverse();
  return `<h1>Mehr</h1>
  <div class="section-title">Profil</div>
  <div class="list"><button class="item" data-act="pickUser">${me ? avatar(me) : '<span class="av" style="background:var(--muted)">?</span>'}<div class="grow"><h3>${me ? esc(me) : 'Keine Person gewählt'}</h3><div class="sub">Tippen zum Wechseln</div></div><span class="chev">›</span></button></div>
  <div class="section-title">Tasting-Abende</div>
  <div class="list">${sess.map(s => { const n = D.ratings.filter(r => r.session === s.id).length; return `<button class="item" data-act="openSession" data-id="${s.id}"><span class="thumb" style="background:hsl(${hue(s.name)} 38% 40%)">🍻</span><div class="grow"><h3>${esc(s.name)}</h3><div class="sub">${[dateDe(s.date), s.beers.length + ' Biere', n + ' Noten', s.closed ? 'abgeschlossen' : !s.reveal ? 'blind' : ''].filter(Boolean).join(' · ')}</div></div>${D.active === s.id && !s.closed ? '<span class="pill live">LIVE</span>' : ''}<span class="chev">›</span></button>`; }).join('')}
  <button class="item" data-act="newSession"><span class="thumb" style="background:var(--accent);color:var(--accent-ink)">＋</span><div class="grow"><h3>Neuen Abend starten</h3></div></button></div>
  <div class="section-title">Einladen & installieren</div>
  <div class="card"><button class="btn block" data-act="invite">QR-Code zum Mitmachen zeigen</button><div style="margin-top:14px">${install}</div></div>
  <div class="section-title">Darstellung</div>
  <div class="seg">${[['', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, t]) => `<button class="${LS.get('bs-theme', '') === k ? 'on' : ''}" data-act="theme" data-v="${k}">${t}</button>`).join('')}</div>
  <div class="section-title">Produktsuche</div>
  <div class="card">${DEMO ? '<p class="small muted">Die Online-Suche bei Open Food Facts gibt es nur in der selbst gehosteten Version.</p>' : D.off ? '<p class="small">✓ Weltweite Suche über Wikidata und Open Food Facts ist aktiv, inklusive Barcode.</p>' : `<p class="small muted">Die weltweite Suche nach Namen (Wikidata) funktioniert sofort. Für Open Food Facts und die Barcode-Suche braucht es eine Kontakt-E-Mail, die nur an diese Dienste übermittelt wird.</p><label class="lbl" for="off-mail">Kontakt-E-Mail</label><input class="field" id="off-mail" type="email" autocomplete="email" placeholder="du@example.de"><button class="btn block" style="margin-top:10px" data-act="offContact">Speichern</button>`}
  ${DEMO ? '' : '<button class="btn block" style="margin-top:10px" data-act="logosRetry">Logos erneut suchen</button><p class="tiny muted" style="margin-top:6px">Logos erscheinen bei Bieren mit eingetragener Brauerei. Fehlt die, hilft „Infos ergänzen“ im Bierbuch.</p>'}
  <p class="tiny muted" style="margin-top:8px">Daten: <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a> (CC0), <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener">Open Food Facts</a> (ODbL), Logos von Wikimedia Commons bzw. den Websites der Brauereien. Angaben im Zweifel am Etikett prüfen.</p></div>
  <div class="section-title">Papierkorb</div>
  <div class="list">${(D.trash || []).slice(0, 25).map(t => `<div class="item"><span style="font-size:22px;width:28px;text-align:center">${{ beer: '🍺', session: '🍻', rating: '⭐' }[t.kind] || '🗑'}</span><div class="grow"><h3>${esc(t.label)}</h3><div class="sub">${esc(t.by || 'Jemand')} · ${new Date(t.at).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${t.n ? ` · ${t.n} Noten` : ''}</div></div><button class="btn small" data-act="restoreTrash" data-tid="${t.tid}">Zurückholen</button></div>`).join('') || '<div class="item muted small">Leer. Gelöschte Biere, Abende und Noten landen hier 30 Tage lang – jede Person kann sie zurückholen.</div>'}</div>
  ${DEMO ? '' : `<div class="section-title">Server-Sicherungen</div>
  <div class="card"><p class="small muted" style="margin-top:0">Der Server sichert automatisch (höchstens alle 10 Minuten bei Änderungen und vor jedem Löschen). Jede Person kann zu einem früheren Stand zurückspringen – der aktuelle Stand wird vorher selbst gesichert, also ist auch das umkehrbar.</p><button class="btn block" data-act="backups">Sicherungen anzeigen</button></div>`}
  <div class="section-title">Daten</div>
  <div class="card"><div class="btns"><a class="btn" href="/api/backup" download>Backup (JSON)</a><a class="btn" href="/api/csv?session=all&user=${encodeURIComponent(me)}" download>Alles als CSV</a></div>
  <label class="lbl" for="restore">Backup wiederherstellen</label><input class="field" id="restore" type="file" accept=".json,application/json" data-change="restore">
  <p class="tiny muted">Ersetzt alle Daten. Vorher wird auf dem Server automatisch gesichert. Alte Formate (data.json, tasting-data.json) werden übernommen.</p></div>
  <p class="tiny muted" style="text-align:center;margin:26px 0 0">Bierstudio 2.1.1${DEMO ? ' · Testversion, ' + esc(DEMO.modeText()) : ''} · Namen sind keine Konten – bitte nur eigene Noten bearbeiten.</p>`;
}
ACT.backups = async () => {
  try {
    const { backups } = await http('/api/backups');
    const t = iso => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    openSheet(head('Server-Sicherungen') + `<p class="small muted" style="margin-top:-2px">Zurückspringen ersetzt den aktuellen Stand für alle. Der jetzige Stand wird vorher gesichert und erscheint danach ganz oben in dieser Liste.</p>
      <div class="list">${backups.map(b => `<div class="item"><div class="grow"><h3>${t(b.at)}</h3><div class="sub">${Math.max(1, Math.round(b.size / 1024))} KB</div></div><button class="btn small" data-act="backupRestore" data-name="${esc(b.name)}" data-at="${esc(t(b.at))}">Zurückspringen</button></div>`).join('') || '<div class="item muted">Noch keine Sicherungen.</div>'}</div>`);
  } catch (e) { toast(e.server ? e.message : 'Keine Verbindung zum Server'); }
};
ACT.backupRestore = async el => {
  if (!(await ask({ title: 'Stand wiederherstellen?', text: `Alle Daten springen auf den Stand von ${el.dataset.at} zurück – für alle Geräte. Der aktuelle Stand wird vorher gesichert.`, ok: 'Zurückspringen', danger: true }))) return;
  try { await send('backup/restore', { name: el.dataset.name }); Object.keys(drafts).forEach(k => delete drafts[k]); saveDrafts(); closeSheet(); toast('Stand wiederhergestellt ✓'); } catch (e) { toast(e.message); }
};
ACT.logosRetry = async el => {
  el.disabled = true;
  try { await send('logos/retry', {}); LS.set('bs-logo-v', Date.now()); toast('Logos werden neu gesucht …'); render(); }
  catch (e) { toast(e.message); el.disabled = false; }
};
ACT.theme = el => { const v = el.dataset.v; LS.set('bs-theme', v); if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; render(); };
ACT.install = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); };
ACT.offContact = async () => { try { await send('settings', { off_contact: $('#off-mail').value }); toast('Gespeichert ✓'); } catch (e) { toast(e.message); } };
CH.restore = async el => {
  const f = el.files[0];
  if (!f || !(await ask({ title: 'Backup wiederherstellen?', text: 'Alle aktuellen Daten werden durch dieses Backup ersetzt.', ok: 'Ersetzen', danger: true }))) { el.value = ''; return; }
  try { await send('restore', JSON.parse(await f.text())); Object.keys(drafts).forEach(k => delete drafts[k]); saveDrafts(); toast('Backup wiederhergestellt ✓'); }
  catch (e) { toast(e instanceof SyntaxError ? 'Keine gültige JSON-Datei' : e.message); }
  el.value = '';
};

// ------------------------------------------------------------------ Sheets (Bottom-Sheets)
const sheet = $('#sheet');
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  if (!sheet.open) { sheet.showModal(); history.pushState({ sheet: 1 }, ''); }
  $('#sheet-body').scrollTop = 0;
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('close', () => { stopScan(); delete forms.s; if (history.state?.sheet) history.back(); if (pendingRender) { pendingRender = false; render(); } });
addEventListener('popstate', () => { if (sheet.open) sheet.close(); });
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
const head = (t, back) => `<div class="sheet-head">${back ? `<button class="icon-btn" data-act="${back.act}" ${back.id ? `data-id="${back.id}"` : ''} aria-label="Zurück">‹</button>` : ''}<h2 id="sheet-title" class="grow ellipsis" style="flex:1">${esc(t)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Schließen">✕</button></div>`;
ACT.closeSheet = closeSheet;

// ---------- Person
function pickUser() {
  openSheet(head('Wer bist du?') + `<div class="list">${D.people.map(p => `<button class="item" data-act="setUser" data-v="${esc(p)}">${avatar(p)}<div class="grow"><h3>${esc(p)}</h3></div>${p === me ? '<span style="color:var(--accent);font-weight:700">✓</span>' : ''}</button>`).join('') || '<div class="item muted">Noch niemand eingetragen.</div>'}</div>
  <label class="lbl" for="new-person">Neu dabei?</label><div class="row"><input class="field" id="new-person" placeholder="Dein Name" maxlength="40" autocomplete="given-name" enterkeyhint="done"><button class="btn primary" data-act="addUser">OK</button></div>
  <p class="tiny muted" style="margin-top:12px">Namen sind keine geschützten Konten. Bitte nur deine eigenen Noten bearbeiten.</p>`);
}
ACT.pickUser = pickUser;
function setUser(name) {
  me = name; LS.set('bs-user', me); closeSheet(); toast('Hallo ' + me + ' 👋'); render(); refresh(true);
}
ACT.setUser = el => setUser(el.dataset.v);
ACT.addUser = async () => {
  const name = $('#new-person').value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return;
  try { await send('person', { name }, { queue: true, apply: () => { if (!D.people.includes(name)) D.people.push(name); } }); setUser(name); }
  catch (e) { toast(e.message); }
};

// ---------- Abend-Aktionen
ACT.tab = el => { view = el.dataset.v; LS.set('bs-view', view); closeSheet(); render(); };
ACT.seg = el => { seg = el.dataset.v; render(); };
ACT.pickBeer = el => { pick[sid] = el.dataset.id; render(); };
ACT.stepBeer = el => { const s = session(), i = s.beers.indexOf(pick[sid]) + +el.dataset.d; if (s.beers[i]) { pick[sid] = s.beers[i]; render(); } };
ACT.nextOpen = () => {
  const s = session(), i = s.beers.indexOf(pick[sid]);
  const order = [...s.beers.slice(i + 1), ...s.beers.slice(0, i)];
  const n = order.find(b => !own(s.id, b));
  if (n) { pick[sid] = n; render(); scrollTo({ top: 0, behavior: 'smooth' }); } else toast('Du hast alle Biere bewertet 🎉');
};
ACT.setCurrent = async el => { try { await send('session', { id: sid, current: el.dataset.id }); haptic(); toast('Für alle ins Glas gesetzt'); } catch (e) { toast(e.message); } };
const askReveal = () => ask({ title: 'Für alle auflösen?', text: 'Biernamen und alle Noten werden für alle sichtbar.', ok: 'Auflösen' });
ACT.reveal = async () => { if (!(await askReveal())) return; try { await send('session', { id: sid, reveal: true }); seg = 'res'; render(); haptic(40); } catch (e) { toast(e.message); } };
ACT.openSession = el => { sid = el.dataset.id; LS.set('bs-session', sid); view = 'abend'; seg = 'rate'; LS.set('bs-view', view); closeSheet(); render(); };
ACT.switchSession = () => {
  const list = [...D.sessions].reverse();
  openSheet(head('Abend wählen') + `<div class="list">${list.map(s => `<button class="item" data-act="openSession" data-id="${s.id}"><div class="grow"><h3>${esc(s.name)}</h3><div class="sub">${[dateDe(s.date), s.beers.length + ' Biere', s.closed ? 'abgeschlossen' : ''].filter(Boolean).join(' · ')}</div></div>${s.id === sid ? '<span style="color:var(--accent);font-weight:700">✓</span>' : ''}</button>`).join('')}</div><button class="btn primary block" data-act="newSession">＋ Neuen Abend starten</button>`);
};
ACT.sessionMenu = () => {
  const s = session();
  const b = (act, t, extra = '') => `<button class="item" data-act="${act}" ${extra}><div class="grow"><h3>${t}</h3></div><span class="chev">›</span></button>`;
  openSheet(head(s.name) + `<div class="list">
    ${b('editSession', '✏️ Name, Datum & Teilnehmer')}
    ${s.closed ? '' : b('addToSession', '🍺 Bier hinzufügen')}
    ${b('invite', '📱 Freunde einladen (QR)')}
    ${s.closed ? '' : b('toggle', s.reveal ? '🙈 Ab jetzt blind (Noten verdecken)' : '👀 Jetzt auflösen', 'data-k="reveal"')}
    ${b('toggle', s.closed ? '🔓 Wieder öffnen' : '🔒 Abend abschließen', 'data-k="closed"')}
    ${D.active === s.id ? '' : b('makeLive', '📡 Als LIVE-Abend für alle setzen')}
    ${b('manageBeers', '↕️ Reihenfolge & Biere verwalten')}</div>
    <div class="list">${b('deleteSession', '<span style="color:var(--danger)">Abend löschen</span>')}</div>`);
};
ACT.toggle = async el => {
  const s = session(), k = el.dataset.k, v = !s[k];
  if (k === 'reveal' && v && !(await askReveal())) return;
  try { await send('session', { id: s.id, [k]: v }); closeSheet(); toast('Gespeichert ✓'); } catch (e) { toast(e.message); }
};
ACT.makeLive = async () => { try { await send('active', { id: sid }); closeSheet(); toast('Alle Geräte öffnen jetzt diesen Abend'); } catch (e) { toast(e.message); } };
ACT.deleteSession = async () => {
  const s = session();
  if (!(await ask({ title: 'Abend löschen?', text: `„${s.name}“ mit allen ${D.ratings.filter(r => r.session === s.id).length} Bewertungen. Die Biere bleiben im Bierbuch. Der Abend liegt danach 30 Tage im Papierkorb.`, ok: 'Löschen', danger: true }))) return;
  try { const r = await send('session/delete', { id: s.id, user: me }); sid = null; closeSheet(); undoToast('Abend gelöscht', r.tid); } catch (e) { toast(e.message); }
};
function sessionForm(s) {
  const isNew = !s;
  s = s || { name: '', date: new Date().toISOString().slice(0, 10), place: '', people: me ? [me] : [], reveal: true };
  const all = [...new Set([...D.people, ...s.people])];
  openSheet(head(isNew ? 'Neuer Abend' : 'Abend bearbeiten') + `
    <label class="lbl" for="s-name">Name</label><input class="field" id="s-name" value="${esc(s.name)}" placeholder="z. B. Pils-Battle bei Alex" maxlength="120">
    <div class="grid2"><div><label class="lbl" for="s-date">Datum</label><input class="field" id="s-date" type="date" value="${esc(s.date)}"></div>
    <div><label class="lbl" for="s-place">Ort</label><input class="field" id="s-place" value="${esc(s.place)}" maxlength="120"></div></div>
    <label class="lbl">Wer ist dabei?</label><div class="chips wrap" id="s-people">${all.map(p => `<button class="chip ${s.people.includes(p) ? 'on' : ''}" data-act="togglePerson" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px"><input class="field" id="s-newp" placeholder="Weitere Person" maxlength="40"><button class="btn" data-act="addPersonChip">＋</button></div>
    <p class="tiny muted">Wer mitbewertet, wird automatisch ergänzt.</p>
    ${isNew ? `<label class="switch"><span><b>Blindverkostung</b><br><span class="small muted">Biernamen & fremde Noten bleiben verdeckt, bis ihr auflöst.</span></span><input type="checkbox" id="s-blind"></label>` : ''}
    <div class="savebar"><button class="btn primary block" data-act="saveSession" data-new="${isNew ? 1 : ''}">${isNew ? 'Abend starten' : 'Speichern'}</button></div>`);
}
ACT.newSession = () => sessionForm(null);
ACT.editSession = () => sessionForm(session());
ACT.togglePerson = el => el.classList.toggle('on');
ACT.addPersonChip = () => {
  const v = $('#s-newp').value.trim().slice(0, 40);
  if (!v) return;
  const c = document.createElement('button');
  c.className = 'chip on'; c.dataset.act = 'togglePerson'; c.dataset.v = v; c.textContent = v;
  $('#s-people').append(c); $('#s-newp').value = '';
};
ACT.saveSession = async el => {
  const body = { name: $('#s-name').value || 'Tasting-Abend', date: $('#s-date').value, place: $('#s-place').value, people: [...document.querySelectorAll('#s-people .chip.on')].map(c => c.dataset.v) };
  if (el.dataset.new) Object.assign(body, { new: true, activate: true, reveal: !$('#s-blind').checked }); else body.id = sid;
  try { const r = await send('session', body); sid = r.id; LS.set('bs-session', sid); view = 'abend'; seg = 'rate'; closeSheet(); render(); toast(el.dataset.new ? 'Abend gestartet 🍻' : 'Gespeichert ✓'); }
  catch (e) { toast(e.message); }
};
ACT.manageBeers = () => {
  const s = session();
  openSheet(head('Biere verwalten', { act: 'sessionMenu' }) + `<div class="list">${s.beers.map((id, i) => `<div class="item"><span class="num muted" style="width:20px">${i + 1}</span><div class="grow"><h3>${esc(label(beer(id), s))}</h3></div>
    <button class="icon-btn" data-act="moveBeer" data-id="${id}" data-d="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn" data-act="moveBeer" data-id="${id}" data-d="1" aria-label="Nach unten" ${i === s.beers.length - 1 ? 'disabled' : ''}>↓</button><button class="icon-btn" data-act="removeBeer" data-id="${id}" aria-label="Entfernen" style="color:var(--danger)">✕</button></div>`).join('') || '<div class="item muted">Noch keine Biere.</div>'}</div>`);
};
ACT.moveBeer = async el => { try { await send('session/beers', { session: sid, op: 'move', id: el.dataset.id, dir: +el.dataset.d }); ACT.manageBeers(); } catch (e) { toast(e.message); } };
ACT.removeBeer = async el => { if (!(await ask({ title: 'Aus dem Abend entfernen?', text: 'Das Bier bleibt im Bierbuch.', ok: 'Entfernen', danger: true }))) return; try { await send('session/beers', { session: sid, op: 'remove', id: el.dataset.id }); ACT.manageBeers(); } catch (e) { toast(e.message); } };

// ---------- Einladung / QR
ACT.invite = () => {
  const base = DEMO?.shareUrl || LS.get('bs-base', '') || location.origin;
  const url = DEMO ? base : base.replace(/\/$/, '') + '/' + (sid ? '?s=' + sid : '');
  let svg = '';
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { svg = ''; }
  const local = !DEMO && /^(localhost|127\.|\[::1\])/.test(location.hostname);
  openSheet(head('Mitmachen') + `<p class="muted small" style="text-align:center">Mit der Handykamera scannen – im selben WLAN bzw. VPN.</p>
    <div class="qr">${svg}</div><p class="url">${esc(url)}</p>
    <div class="btns" style="margin-top:12px">${navigator.share ? '<button class="btn" data-act="shareLink">Teilen</button>' : ''}<button class="btn" data-act="copyLink">Link kopieren</button></div>
    <details class="more" ${local ? 'open' : ''} ${DEMO ? 'hidden' : ''}><summary>Adresse anpassen</summary>${local ? '<p class="small" style="color:var(--danger)">Du nutzt „localhost“ – andere Geräte erreichen das nicht. Trag die Adresse deines Servers ein, z. B. http://192.168.1.20:8000</p>' : ''}
    <div class="row"><input class="field" id="base-url" value="${esc(LS.get('bs-base', ''))}" placeholder="${esc(location.origin)}" inputmode="url"><button class="btn" data-act="saveBase">OK</button></div></details>`);
  ACT.copyLink = async () => { try { await navigator.clipboard.writeText(url); toast('Link kopiert'); } catch { const r = document.createRange(); r.selectNodeContents($('.url')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Link markiert – jetzt kopieren'); } };
  ACT.shareLink = () => navigator.share({ title: 'Bierstudio', text: 'Komm zum Tasting!', url }).catch(() => { });
};
ACT.demoSeed = async el => {
  el.disabled = true; el.textContent = 'Lädt …';
  try { const r = await fetch(DEMO.seedUrl); await send('restore', await r.json()); sid = null; toast('Tasting geladen ✓'); render(); if (!me) pickUser(); }
  catch (e) { toast(e.message); el.disabled = false; el.textContent = 'Nochmal versuchen'; }
};
ACT.saveBase = () => { LS.set('bs-base', $('#base-url').value.trim()); ACT.invite(); };

// ---------- Bier-Detail
function beerSheet(id) {
  const b = beer(id);
  if (!b) return closeSheet();
  const ag = beerAgg(id), rs = D.ratings.filter(r => r.beer === id && visible(r)).sort((a, c) => (c.ts || '').localeCompare(a.ts || ''));
  const mySolo = own(null, id);
  const s = session(), canAdd = s && !s.closed && !s.beers.includes(id);
  const sname = x => x ? D.sessions.find(y => y.id === x)?.name || 'Abend' : 'Solo';
  openSheet(head(b.blind ? 'Verdecktes Bier' : b.name) + `<div class="hero">${thumb(b)}<div class="grow" style="min-width:0"><div class="small muted">${meta(b, true) || 'Keine weiteren Infos'}</div>
    ${b.source ? `<div class="tiny muted">Angaben: ${esc(SRC[b.source] || b.source)}</div>` : ''}
    ${b.barcode ? `<div class="tiny muted">EAN ${esc(b.barcode)} · <a href="https://world.openfoodfacts.org/product/${esc(b.barcode)}" target="_blank" rel="noopener">Open Food Facts</a></div>` : ''}</div></div>
    <div class="kpis" style="margin-top:14px"><div class="kpi"><b style="color:${color(ag.avg)}">${fmt(ag.avg, 2)}</b><span>Ø aller Personen</span></div><div class="kpi"><b>${rs.length}</b><span>Bewertungen</span></div></div>
    ${missingInfo(b) ? `<button class="card flat item" data-act="enrich" data-id="${id}" style="margin:0 0 12px;min-height:0"><span style="font-size:22px">✨</span><div class="grow"><h3>Infos ergänzen</h3><div class="sub">${[b.brewery ? '' : 'Brauerei', b.style ? '' : 'Bierstil', b.abv == null || b.abv === '' ? 'Alkohol' : ''].filter(Boolean).join(', ')} fehlt – aus Katalog oder weltweit</div></div><span class="chev">›</span></button>` : ''}
    <div class="btns"><button class="btn primary" data-act="rateSolo" data-id="${id}">${mySolo ? 'Meine Solo-Note ändern' : 'Jetzt bewerten'}</button>${canAdd ? `<button class="btn" data-act="addExisting" data-id="${id}">Zum Abend hinzufügen</button>` : ''}</div>
    <div class="section-title">Alle Noten</div>
    <div class="list">${rs.map(r => `<div class="item" style="align-items:flex-start">${avatar(r.user)}<div class="grow"><h3>${esc(r.user)}${r.favorite ? ' <span style="color:#e5484d">♥</span>' : ''}</h3><div class="sub">${esc(sname(r.session))}${r.ts ? ' · ' + dateDe(r.ts) : ''}</div>
      ${r.tags?.length ? `<div class="chips wrap" style="margin-top:6px">${r.tags.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}${r.note ? `<p class="small" style="white-space:pre-wrap">${esc(r.note)}</p>` : ''}</div>
      <div class="score-pill"><b style="color:${color(r.value)}">${fmt(r.value, 1)}</b></div></div>`).join('') || '<div class="item muted">Noch keine Noten.</div>'}</div>
    ${b.blind ? '' : `<div class="btns"><button class="btn" data-act="editBeer" data-id="${id}">Bearbeiten</button>${missingInfo(b) ? '' : `<button class="btn" data-act="enrich" data-id="${id}">Infos suchen</button>`}<button class="btn danger" data-act="deleteBeer" data-id="${id}">Löschen</button></div>`}`);
}
ACT.beerSheet = el => beerSheet(el.dataset.id);
ACT.toastAct = async () => { const f = toastAction; toastAction = null; $('#toast').classList.remove('show'); if (f) await f(); };
ACT.restoreTrash = el => restoreTrash(el.dataset.tid);

// ---------- Infos ergänzen (Katalog + weltweit)
let enrichState = null;
function enrichSheet(id, web = null, notes = []) {
  const b = beer(id);
  if (!b) return closeSheet();
  enrichState = { id, cands: [...catSearch(b.name, 5), ...(web || [])] };
  openSheet(head('Infos ergänzen', { act: 'beerSheet', id }) + `<p class="small muted" style="margin-top:-2px">Tippe auf den passenden Eintrag. Brauerei, Stil, Alkohol und Land werden übernommen; „${esc(b.name)}“ bleibt als Name, außer du schaltest es hier um.</p>
    <label class="switch"><span>Offiziellen Namen übernehmen</span><input type="checkbox" id="en-name"></label>
    <div class="list">${enrichState.cands.map((c, i) => `<button class="item" data-act="applyCand" data-i="${i}">${candThumb(c)}<div class="grow"><h3>${esc(c.name)}</h3><div class="sub">${candMeta(c) || '&nbsp;'}</div><div class="tiny muted">${SRC[c.source] || ''}</div></div><span class="chev">›</span></button>`).join('') || '<div class="item muted">Kein Treffer im hinterlegten Katalog.</div>'}</div>
    ${notes.map(n => `<p class="tiny muted">${esc(n)}</p>`).join('')}
    ${web ? '' : `<button class="btn block" data-act="enrichWeb" data-id="${id}">🌍 Weltweit suchen (Wikidata & Open Food Facts)</button>`}`);
}
ACT.enrich = async el => { await catalog(); enrichSheet(el.dataset.id); };
ACT.enrichWeb = async el => {
  if (DEMO) return toast('Die weltweite Suche gibt es nur in der selbst gehosteten Version');
  const id = el.dataset.id, b = beer(id);
  el.disabled = true; el.textContent = 'Suche weltweit …';
  try { const r = await http('/api/lookup?q=' + encodeURIComponent(b.name)); enrichSheet(id, r.results, r.notes.concat(r.results.length ? [] : ['Online nichts gefunden – Angaben ggf. unter „Bearbeiten“ selbst eintragen.'])); }
  catch (e) { toast(e.server ? e.message : 'Keine Verbindung zum Server'); el.disabled = false; el.textContent = '🌍 Weltweit suchen'; }
};
ACT.applyCand = async el => {
  const c = enrichState.cands[+el.dataset.i], b = beer(enrichState.id);
  const body = { id: b.id, ...candFields(c, b) };
  if ($('#en-name').checked && c.name) body.name = c.name;
  try { await send('beer', body); haptic(20); toast('Ergänzt ✓'); beerSheet(b.id); } catch (e) { toast(e.message); }
};
const missingInfo = b => !b.blind && (b.abv == null || b.abv === '' || !b.style || !b.brewery);
ACT.bulkEnrich = async () => {
  await catalog();
  const rows = D.beers.filter(missingInfo).map(b => ({ b, c: catBest(b.name) }));
  const hit = rows.filter(x => x.c && Object.keys(candFields(x.c, x.b, true)).length), miss = rows.filter(x => !hit.includes(x));
  addState = null;
  openSheet(head('Fehlende Infos ergänzen') + `<p class="small muted" style="margin-top:-2px">Vorschläge aus dem hinterlegten Katalog. Es werden nur leere Felder gefüllt, deine Namen bleiben.</p>
    ${hit.length ? `<div class="list">${hit.map((x, i) => `<label class="item" style="cursor:pointer"><input type="checkbox" class="bk" data-i="${i}" checked style="width:22px;height:22px;accent-color:var(--accent);flex:none"><div class="grow"><h3>${esc(x.b.name)} → ${esc(x.c.name)}</h3><div class="sub">${candMeta(x.c)}</div></div></label>`).join('')}</div>
    <div class="savebar"><button class="btn primary block" data-act="bulkApply">${hit.length} Biere ergänzen</button></div>` : '<div class="card muted small">Für die übrigen Biere gibt es keinen eindeutigen Treffer im Katalog.</div>'}
    ${miss.length ? `<div class="section-title">Nicht im Katalog (${miss.length})</div><div class="list">${miss.map(x => `<button class="item" data-act="enrich" data-id="${x.b.id}"><div class="grow"><h3>${esc(x.b.name)}</h3><div class="sub">Einzeln suchen – auch weltweit</div></div><span class="chev">›</span></button>`).join('')}</div>` : ''}`);
  enrichState = { bulk: hit };
};
ACT.bulkApply = async el => {
  const picks = [...document.querySelectorAll('.bk')].filter(x => x.checked).map(x => enrichState.bulk[+x.dataset.i]);
  el.disabled = true;
  let ok = 0;
  for (const x of picks) {
    el.textContent = `Ergänze ${ok + 1} von ${picks.length} …`;
    try { await http('/api/beer', { id: x.b.id, ...candFields(x.c, x.b, true) }); ok++; } catch (e) { toast(`${x.b.name}: ${e.message}`); }
  }
  await refresh(true); closeSheet(); toast(`${ok} Biere ergänzt ✓`);
};
ACT.rateSolo = el => {
  if (!me) return pickUser();
  const id = el.dataset.id, b = beer(id);
  openSheet(head(b.name, { act: 'beerSheet', id }) + `<p class="small muted" style="margin-top:-4px">Solo-Bewertung · ${meta(b) || ''}</p>` + rateForm('s', null, id, { onSaved: () => beerSheet(id) }));
};
ACT.addExisting = async el => { try { await send('session/beers', { session: sid, op: 'add', id: el.dataset.id }); pick[sid] = el.dataset.id; toast('Zum Abend hinzugefügt'); beerSheet(el.dataset.id); } catch (e) { toast(e.message); } };
ACT.editBeer = el => {
  const b = beer(el.dataset.id);
  openSheet(head('Bier bearbeiten', { act: 'beerSheet', id: b.id }) + beerFields(b) + `<div class="savebar"><button class="btn primary block" data-act="saveBeer" data-id="${b.id}">Speichern</button></div>`);
};
ACT.saveBeer = async el => {
  const body = { id: el.dataset.id, ...readBeerFields() };
  if (!body.name) return toast('Name fehlt');
  try { await send('beer', body); toast('Gespeichert ✓'); beerSheet(el.dataset.id); } catch (e) { toast(e.message); }
};
ACT.deleteBeer = async el => {
  const n = D.ratings.filter(r => r.beer === el.dataset.id).length;
  if (!(await ask({ title: 'Bier löschen?', text: `Es verschwindet aus dem Bierbuch, zusammen mit ${n} Bewertungen in allen Abenden. Es liegt danach 30 Tage im Papierkorb.`, ok: 'Löschen', danger: true }))) return;
  try { const r = await send('beer/delete', { id: el.dataset.id, user: me }); closeSheet(); undoToast('Bier gelöscht', r.tid); } catch (e) { toast(e.message); }
};
function beerFields(b = {}) {
  return `<label class="lbl" for="f-name">Name</label><input class="field" id="f-name" value="${esc(b.name)}" maxlength="120">
  <label class="lbl" for="f-brewery">Brauerei / Marke</label><input class="field" id="f-brewery" value="${esc(b.brewery)}" maxlength="120">
  <div class="grid2"><div><label class="lbl" for="f-style">Stil</label><input class="field" id="f-style" list="styles" value="${esc(b.style)}" maxlength="60"></div>
  <div><label class="lbl" for="f-abv">Alkohol %</label><input class="field" id="f-abv" inputmode="decimal" value="${b.abv != null ? esc(fmt(b.abv, 1)) : ''}" maxlength="5"></div></div>
  <label class="lbl" for="f-barcode">Barcode (EAN)</label><input class="field" id="f-barcode" inputmode="numeric" value="${esc(b.barcode)}" maxlength="14">
  <datalist id="styles">${STYLES.map(x => `<option value="${x}">`).join('')}</datalist>`;
}
const readBeerFields = () => ({ name: $('#f-name').value.trim(), brewery: $('#f-brewery').value, style: $('#f-style').value, abv: $('#f-abv').value, barcode: $('#f-barcode').value.replace(/\D/g, '') });

// ---------- Bier eintragen (＋) – Solo oder für den Abend
ACT.add = el => {
  const s = session(), openS = s && !s.closed ? s : null;
  addFlow({ session: view === 'abend' && openS ? openS.id : null, rate: true, name: el.dataset.name || '' });
};
ACT.addToSession = () => addFlow({ session: sid, rate: false });
function addFlow(st) {
  addState = { ...st, chosen: null, extra: {} };
  const s = session(), openS = s && !s.closed ? s : null;
  const where = st.rate && openS ? `<div class="seg" style="margin-bottom:6px"><button class="${!st.session ? 'on' : ''}" data-act="addWhere" data-v="">Solo</button><button class="${st.session ? 'on' : ''}" data-act="addWhere" data-v="${openS.id}">${esc(openS.name.length > 22 ? openS.name.slice(0, 21) + '…' : openS.name)}</button></div>` : '';
  const canScan = !DEMO && 'BarcodeDetector' in window && isSecureContext && navigator.mediaDevices;
  openSheet(head(st.rate ? 'Was trinkst du?' : 'Bier zum Abend hinzufügen') + where + `
    <div class="row" style="margin-top:6px"><input class="field" id="f-name" placeholder="Name oder Barcode" autocomplete="off" enterkeyhint="search" data-on="addSearch" value="${esc(st.name || '')}" maxlength="120">
    ${canScan ? '<button class="icon-btn" data-act="scan" aria-label="Barcode scannen" style="width:46px;height:46px">▥</button>' : ''}</div>
    <div id="a-matches"></div>
    <div id="a-off"></div>
    <details class="more" id="a-details"><summary>Details ergänzen (Brauerei, Stil, Alkohol)</summary>
      <label class="lbl" for="f-brewery">Brauerei / Marke</label><input class="field" id="f-brewery" maxlength="120">
      <div class="grid2"><div><label class="lbl" for="f-style">Stil</label><input class="field" id="f-style" list="styles" maxlength="60"></div>
      <div><label class="lbl" for="f-abv">Alkohol %</label><input class="field" id="f-abv" inputmode="decimal" maxlength="5"></div></div>
      <label class="lbl" for="f-barcode">Barcode (EAN)</label><input class="field" id="f-barcode" inputmode="numeric" maxlength="14">
      <datalist id="styles">${STYLES.map(x => `<option value="${x}">`).join('')}</datalist></details>
    ${!st.rate ? '<label class="switch"><span><b>Sofort ins Glas</b><br><span class="small muted">Alle springen direkt zu diesem Bier.</span></span><input type="checkbox" id="a-current" checked></label>' : ''}
    <div class="savebar"><button class="btn primary block" data-act="addNext">${st.rate ? 'Weiter zur Bewertung' : 'Hinzufügen'}</button></div>`);
  addSearch();
  if (!st.name) setTimeout(() => $('#f-name')?.focus(), 250);
}
ACT.addWhere = el => { addState.session = el.dataset.v || null; el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); };
function addSearch() {
  const q = norm($('#f-name')?.value), box = $('#a-matches');
  if (!box) return;
  if (addState.chosen && norm(beer(addState.chosen)?.name) !== q) addState.chosen = null;
  const hits = q ? D.beers.filter(b => !b.blind && norm([b.name, b.brewery, b.barcode].join(' ')).includes(q)).slice(0, 6) : [];
  const isCode = /^\d{8,14}$/.test(q);
  const cat = !isCode && q.length >= 2 && !addState.chosen ? catSearch(q, 4).filter(c => !D.beers.some(b => norm(b.name) === norm(c.name))) : [];
  addState.cat = cat;
  box.innerHTML = (hits.length ? `<div class="section-title" style="margin-top:12px">Schon im Bierbuch</div><div class="list">${hits.map(b => { const ag = beerAgg(b.id); return `<button class="item" data-act="choose" data-id="${b.id}">${thumb(b)}<div class="grow"><h3>${esc(b.name)}</h3><div class="sub">${meta(b) || '&nbsp;'}</div></div><div class="score-pill">${addState.chosen === b.id ? '<b style="color:var(--accent)">✓</b>' : `<b style="color:${color(ag.avg)}">${fmt(ag.avg, 1)}</b><small>${ag.people}×</small>`}</div></button>`; }).join('')}</div>` : '')
    + (cat.length ? `<div class="section-title" style="margin-top:12px">Aus dem Katalog</div><div class="list">${cat.map((c, i) => `<button class="item" data-act="pickCand" data-src="cat" data-i="${i}">${candThumb(c)}<div class="grow"><h3>${esc(c.name)}</h3><div class="sub">${candMeta(c)}</div></div><span class="chev">＋</span></button>`).join('')}</div>` : '')
    + (q.length >= 3 && !addState.chosen ? `<button class="btn ghost block" data-act="worldSearch" style="margin-top:4px">🌍 ${isCode ? 'Barcode' : '„' + esc($('#f-name').value.trim()) + '“'} weltweit suchen</button>` : '');
}
ON.addSearch = () => addSearch();
ACT.choose = el => {
  const b = beer(el.dataset.id);
  addState.chosen = b.id; $('#f-name').value = b.name; $('#a-off').innerHTML = '';
  addSearch(); haptic();
};
ACT.offSearch = () => ACT.worldSearch();
ACT.worldSearch = async () => {
  const q = $('#f-name').value.trim(), box = $('#a-off'), code = /^\d{8,14}$/.test(q);
  if (DEMO) { box.innerHTML = '<p class="small muted">Die weltweite Suche gibt es nur in der selbst gehosteten Version. Der Katalog oben funktioniert aber auch hier.</p>'; return; }
  if (code && !D.off) { box.innerHTML = '<p class="small muted">Barcode-Suche: unter <b>Mehr → Produktsuche</b> eine Kontakt-E-Mail hinterlegen.</p>'; return; }
  box.innerHTML = '<p class="small muted">Suche bei Wikidata und Open Food Facts …</p>';
  try {
    const r = code ? { results: (await http('/api/off/barcode?code=' + q)).products.map(offToCand), notes: [] } : await http('/api/lookup?q=' + encodeURIComponent(q));
    addState.results = r.results;
    box.innerHTML = (r.results.length ? `<div class="section-title">Weltweit gefunden</div><div class="list">` + r.results.map((c, i) => `<button class="item" data-act="pickCand" data-src="web" data-i="${i}">${candThumb(c)}<div class="grow" style="min-width:0"><h3>${esc(c.name)}</h3><div class="sub">${candMeta(c) || '&nbsp;'}</div><div class="tiny muted">${SRC[c.source] || ''}</div></div><span class="chev">＋</span></button>`).join('') + '</div>'
      : '<p class="small muted">Nichts gefunden – trag das Bier einfach selbst ein.</p>') + r.notes.map(n => `<p class="tiny muted">${esc(n)}</p>`).join('');
  } catch (e) { box.innerHTML = `<p class="small" style="color:var(--danger)">${esc(e.server ? e.message : 'Keine Verbindung zum Server – weltweite Suche nicht möglich')}</p>`; }
};
ACT.pickCand = el => {
  const c = (el.dataset.src === 'cat' ? addState.cat : addState.results)[+el.dataset.i];
  const local = c.barcode && D.beers.find(b => b.barcode === c.barcode && !b.blind);
  if (local) { ACT.choose({ dataset: { id: local.id } }); toast('Schon im Bierbuch – übernommen'); return; }
  $('#f-name').value = c.name; $('#f-brewery').value = c.brewery || ''; $('#f-style').value = c.style || '';
  $('#f-abv').value = c.abv != null && c.abv !== '' ? fmt(c.abv, 1) : ''; $('#f-barcode').value = c.barcode || '';
  addState.extra = { country: countryCode(c.country), site: c.site || '', image: c.image || '', source: c.source };
  addState.chosen = null;
  $('#a-details').open = true; $('#a-off').innerHTML = ''; addSearch(); haptic(); toast('Angaben übernommen – bitte kurz prüfen');
};
ACT.addNext = async el => {
  if (!me) return pickUser();
  const st = addState, f = readBeerFields();
  if (!f.name) { $('#f-name').focus(); return toast('Wie heißt das Bier?'); }
  let id = st.chosen;
  const exact = !id && D.beers.find(b => !b.blind && norm(b.name) === norm(f.name));
  // Exakter Katalog-Treffer (z. B. „Corona“): fehlende Angaben automatisch mitnehmen
  if (!id && !exact && !st.extra.source) {
    const c = (CAT || []).find(c => c.keys.includes(fold(f.name)));
    if (c) { const cf = candFields(c, f, true); Object.assign(f, cf); st.extra = { ...st.extra, country: cf.country || '', site: cf.site || '', source: 'katalog' }; }
  }
  if (exact) id = exact.id;
  el.disabled = true;
  try {
    const makeCurrent = !st.rate && $('#a-current')?.checked;
    if (id) {
      if (st.session && !session()?.beers.includes(id)) await send('session/beers', { session: st.session, op: 'add', id });
      if (makeCurrent) await send('session', { id: st.session, current: id });
    } else {
      const body = { id: hex16(), ...f, ...st.extra, user: me, session: st.session, make_current: makeCurrent };
      const r = await send('beer', body, {
        queue: true, offlineBody: { force_new: true },
        apply: () => { D.beers.push({ ...body, abv: f.abv ? +f.abv.replace(',', '.') : null, created_at: new Date().toISOString(), created_by: me }); const s = D.sessions.find(x => x.id === st.session); if (s && !s.beers.includes(body.id)) s.beers.push(body.id); }
      });
      id = r.id || body.id;
    }
    if (st.session) { pick[st.session] = id; sid = st.session; }
    haptic(20);
    if (!st.rate) { closeSheet(); toast('Hinzugefügt ✓'); render(); return; }
    const b = beer(id);
    openSheet(head(b?.name || f.name) + `<p class="small muted" style="margin-top:-4px">${st.session ? 'Für „' + esc(session()?.name) + '“' : 'Solo-Bewertung'}${b && meta(b) ? ' · ' + meta(b) : ''}</p>`
      + rateForm('s', st.session, id, { onSaved: () => { closeSheet(); if (st.session) { view = 'abend'; seg = 'rate'; } render(); } }));
  } catch (e) { toast(e.message); el.disabled = false; }
};

// ---------- Barcode-Scanner (Android/Chrome mit HTTPS)
ACT.scan = async () => {
  const box = $('#a-off');
  try {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    box.innerHTML = '<video class="scan" id="scan-video" playsinline muted></video><button class="btn block" data-act="stopScan" style="margin-top:8px">Abbrechen</button>';
    const v = $('#scan-video'); v.srcObject = scanStream; await v.play();
    const loop = async () => {
      if (!scanStream) return;
      try {
        const [c] = await det.detect(v);
        if (c?.rawValue) { stopScan(); haptic(40); $('#f-name').value = c.rawValue; addSearch(); const loc = D.beers.find(b => b.barcode === c.rawValue && !b.blind); if (loc) ACT.choose({ dataset: { id: loc.id } }); else ACT.offSearch(); return; }
      } catch { }
      setTimeout(loop, 250);
    };
    loop();
  } catch (e) { stopScan(); box.innerHTML = `<p class="small muted">Kamera nicht verfügbar (${esc(e.name || e.message)}). Barcode einfach eintippen.</p>`; }
};
function stopScan() { if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; const v = $('#scan-video'); if (v) v.closest('#a-off').innerHTML = ''; } }
ACT.stopScan = stopScan;

// ------------------------------------------------------------------ Events & Start
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const f = ACT[el.dataset.act];
  if (f) { if (el.tagName !== 'A') e.preventDefault(); f(el, e); }
});
document.addEventListener('input', e => { const el = e.target.closest('[data-on]'); if (el) ON[el.dataset.on]?.(el, e); });
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el) CH[el.dataset.change]?.(el, e); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'new-person') ACT.addUser();
  if (e.target.id === 's-newp') { e.preventDefault(); ACT.addPersonChip(); }
  if (e.target.id === 'f-name' && addState && sheet.open) { e.preventDefault(); e.target.blur(); }
});
addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', scrollY > 4), { passive: true });
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (view === 'mehr') render(); });
addEventListener('online', () => refresh(true));
addEventListener('offline', () => setOnline(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
addEventListener('pagehide', saveDrafts);
setInterval(() => { if (!document.hidden) refresh(); }, 4000);

// Einladungslink ?s=<id>
const params = new URLSearchParams(location.search), joinId = params.get('s'), quickAdd = params.has('add');
if (joinId) { sid = joinId; LS.set('bs-session', sid); view = 'abend'; LS.set('bs-view', view); }
if (location.search) history.replaceState(null, '', '/');
if (!DEMO && 'serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => { });
setOnline(online);
if (D) render();
refresh(true).then(() => {
  if (!D) return;
  if (!me) setTimeout(pickUser, 400);
  else if (quickAdd) ACT.add({ dataset: {} });
});
