#!/usr/bin/env python3
"""Bierstudio – gemeinsam oder allein Bier bewerten.

Nur Python-Standardbibliothek. Daten liegen als JSON in DATA_DIR.
Umgebungsvariablen:
  PORT          (Standard 8000)
  DATA_DIR      (Standard ./data)
  OFF_CONTACT   Kontakt (E-Mail/URL) für Open-Food-Facts-Abfragen (optional)
  BACKUP_KEEP   Anzahl automatischer Backups (Standard 60)
"""
import csv, datetime, io, json, os, re, secrets, shutil, tempfile, threading, time
import urllib.parse, urllib.request
import lookup
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

VERSION = '2.1.1'
BASE = Path(__file__).resolve().parent
STATIC = BASE / 'static'
DATA_DIR = Path(os.environ.get('DATA_DIR', BASE.parent / 'data')).resolve()
DB_FILE = DATA_DIR / 'bierstudio.json'
BACKUP_DIR = DATA_DIR / 'backups'
BACKUP_KEEP = int(os.environ.get('BACKUP_KEEP', '60'))
BACKUP_INTERVAL = 600  # höchstens alle 10 Minuten ein automatisches Backup
LOGO_DIR = DATA_DIR / 'logos'
TRASH_DAYS = 30
CATS = ['Aussehen', 'Geruch', 'Geschmack', 'Körper', 'Abgang']
WEIGHTS = {'Aussehen': 1, 'Geruch': 1, 'Geschmack': 2, 'Körper': 1, 'Abgang': 1}
ID_RE = re.compile(r'^[0-9a-f]{16}$')
LOCK = threading.RLock()
DB = None
_last_backup = 0.0


# ---------------------------------------------------------------- helpers
def uid():
    return secrets.token_hex(8)


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().casefold()


def clean(s, n=120):
    return re.sub(r'\s+', ' ', str(s or '')).strip()[:n]


def parse_abv(v):
    if v in (None, ''):
        return None
    try:
        x = float(str(v).replace(',', '.').replace('%', '').strip())
    except ValueError:
        return None
    return round(x, 2) if 0 <= x <= 80 else None


def detail_score(detail):
    return sum(float(detail[k]) * WEIGHTS[k] for k in CATS) / sum(WEIGHTS.values()) * 2


def atomic_write(path, obj):
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def backup(force=False):
    global _last_backup
    if not DB_FILE.exists() or (not force and time.time() - _last_backup < BACKUP_INTERVAL):
        return
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    shutil.copy2(DB_FILE, BACKUP_DIR / f'{stamp}.json')
    _last_backup = time.time()
    for p in sorted(BACKUP_DIR.glob('*.json'))[:-BACKUP_KEEP]:
        p.unlink()


def save(force_backup=False):
    backup(force_backup)
    DB['rev'] = DB.get('rev', 0) + 1
    atomic_write(DB_FILE, DB)


# ---------------------------------------------------------------- migration
def empty_db():
    return {'version': 3, 'rev': 1, 'people': [], 'beers': [], 'sessions': [], 'ratings': [],
            'active': None, 'settings': {}, 'trash': []}


def from_v1(o):
    """Uraltformat data.json (Note 0–100 bzw. Kategorien 1–5)."""
    if not isinstance(o.get('beers'), list) or not isinstance(o.get('ratings'), list):
        raise ValueError('Unbekanntes Format')
    s = {'id': uid(), 'name': 'Importiertes Tasting', 'date': '', 'place': '', 'people': [],
         'beers': [], 'ratings': [], 'reveal': o.get('reveal', True), 'closed': False, 'current': None}
    ids = {}
    for b in o['beers']:
        x = dict(b); x['id'] = uid(); ids[b['id']] = x['id']; s['beers'].append(x)
    for r in o['ratings']:
        if r.get('beer') not in ids:
            continue
        v = r.get('s', {}); detail = None
        if 'Gesamt' in v:
            value = float(v['Gesamt']) / 10
        else:
            detail = {k: float(v.get(k, 3)) for k in CATS}
            value = detail_score(detail)
        s['people'].append(str(r['user']))
        s['ratings'].append({'beer': ids[r['beer']], 'user': str(r['user']), 'value': round(value, 3),
                             'note': r.get('note', ''), 'detail': detail, 'favorite': False})
    s['people'] = list(dict.fromkeys(s['people']))
    return {'version': 2, 'sessions': [s], 'active': s['id']}


def from_v2(o):
    """Version 2 (Biere pro Tasting) -> Version 3 (globales Bierbuch)."""
    if not isinstance(o.get('sessions'), list):
        raise ValueError('Kein gültiges Version-2-Backup')
    d = empty_db()
    by_name = {}
    for s in o['sessions']:
        ns = {'id': s.get('id') or uid(), 'name': clean(s.get('name')) or 'Tasting',
              'date': s.get('date', ''), 'place': s.get('place', ''),
              'people': [clean(p, 40) for p in s.get('people', []) if clean(p, 40)],
              'beers': [], 'reveal': bool(s.get('reveal', True)), 'closed': bool(s.get('closed')),
              'current': None, 'created_at': now()}
        idmap = {}
        for b in s.get('beers', []):
            key = norm(b.get('name'))
            if key in by_name:
                gb = by_name[key]
                for k in ('brewery', 'style', 'barcode', 'brand'):  # fehlende Infos ergänzen
                    if b.get(k) and not gb.get(k):
                        gb[k] = clean(b[k])
                if gb.get('abv') is None:
                    gb['abv'] = parse_abv(b.get('abv'))
            else:
                gb = {'id': b.get('id') if ID_RE.match(str(b.get('id', ''))) else uid(),
                      'name': clean(b.get('name')) or 'Unbenannt', 'brewery': clean(b.get('brewery')),
                      'style': clean(b.get('style')), 'abv': parse_abv(b.get('abv')),
                      'barcode': clean(b.get('barcode'), 20), 'brand': clean(b.get('brand')),
                      'image': '', 'created_by': '', 'created_at': now()}
                by_name[key] = gb
                d['beers'].append(gb)
            idmap[b.get('id')] = gb['id']
            if gb['id'] not in ns['beers']:
                ns['beers'].append(gb['id'])
        if s.get('current') in idmap:
            ns['current'] = idmap[s['current']]
        for r in s.get('ratings', []):
            if r.get('beer') not in idmap:
                continue
            d['ratings'] = [x for x in d['ratings'] if not (
                x['beer'] == idmap[r['beer']] and x['user'] == r['user'] and x['session'] == ns['id'])]
            d['ratings'].append({'beer': idmap[r['beer']], 'user': clean(r['user'], 40), 'session': ns['id'],
                                 'value': round(float(r['value']), 3), 'detail': r.get('detail'),
                                 'note': str(r.get('note', ''))[:1000], 'tags': [],
                                 'favorite': bool(r.get('favorite')), 'ts': ''})
            if clean(r['user'], 40) not in ns['people']:
                ns['people'].append(clean(r['user'], 40))
        d['sessions'].append(ns)
        for p in ns['people']:
            if p not in d['people']:
                d['people'].append(p)
    d['active'] = o.get('active') if any(s['id'] == o.get('active') for s in d['sessions']) else None
    return d


def upgrade(o):
    if not isinstance(o, dict):
        raise ValueError('Keine gültige Datei')
    if o.get('version') == 3:
        validate_v3(o)
        return o
    if o.get('version') == 2:
        return from_v2(o)
    if 'beers' in o and 'ratings' in o:
        return from_v2(from_v1(o))
    raise ValueError('Unbekanntes Datenformat')


def validate_v3(d):
    for k in ('people', 'beers', 'sessions', 'ratings'):
        if not isinstance(d.get(k), list):
            raise ValueError(f'Feld „{k}“ fehlt')
    beer_ids = {b['id'] for b in d['beers']}
    for r in d['ratings']:
        if r['beer'] not in beer_ids or not 0 <= float(r['value']) <= 10:
            raise ValueError('Ungültige Bewertung im Backup')
    d.setdefault('settings', {})
    d.setdefault('trash', [])
    d.setdefault('rev', 1)


def load_db():
    global DB
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)
    if DB_FILE.exists():
        DB = upgrade(json.loads(DB_FILE.read_text(encoding='utf-8')))
        return
    # Erststart: alte Dateien im Datenordner übernehmen
    for name in ('tasting-data.json', 'data.json'):
        old = DATA_DIR / name
        if old.exists():
            DB = upgrade(json.loads(old.read_text(encoding='utf-8')))
            print(f'Importiert: {old}')
            break
    else:
        DB = empty_db()
    atomic_write(DB_FILE, DB)


# ---------------------------------------------------------------- view
def session_of(sid):
    return next((s for s in DB['sessions'] if s['id'] == sid), None)


def beer_of(bid):
    return next((b for b in DB['beers'] if b['id'] == bid), None)


def redacted(user):
    """Liefert die Daten so, dass Blindverkostungen auch technisch blind sind."""
    blind_sessions = {s['id'] for s in DB['sessions'] if not s['reveal']}
    blind_beers = set()
    for s in DB['sessions']:
        if s['id'] in blind_sessions:
            blind_beers.update(s['beers'])
    beers = []
    for b in DB['beers']:
        if b['id'] in blind_beers and b.get('created_by') != user:
            beers.append({'id': b['id'], 'name': '', 'blind': True})
        else:
            beers.append(b)
    ratings = []
    for r in DB['ratings']:
        if r['session'] in blind_sessions and r['user'] != user:
            ratings.append({'beer': r['beer'], 'user': r['user'], 'session': r['session'], 'hidden': True})
        elif r['beer'] in blind_beers and r['user'] != user and r['session'] not in blind_sessions:
            continue  # alte Solo-Noten würden das verdeckte Bier verraten
        else:
            ratings.append(r)
    return {'version': 3, 'rev': DB['rev'], 'people': DB['people'], 'beers': beers,
            'sessions': DB['sessions'], 'ratings': ratings, 'active': DB.get('active'),
            'trash': [{'tid': t['tid'], 'kind': t['kind'], 'at': t['at'], 'by': t['by'], 'label': t['label'],
                       'n': len(t.get('ratings', []))} for t in reversed(DB.get('trash', []))],
            'off': bool(os.environ.get('OFF_CONTACT') or DB['settings'].get('off_contact'))}


# ---------------------------------------------------------------- Open Food Facts
OFF_CACHE = {}
STYLES = [('alkoholfrei', 'Alkoholfrei'), ('alcohol-free', 'Alkoholfrei'), ('non-alcoholic', 'Alkoholfrei'),
          ('radler', 'Radler'), ('weizen', 'Weizen'), ('wheat', 'Weizen'), ('weiss', 'Weizen'),
          ('ipa', 'IPA'), ('pale-ale', 'Pale Ale'), ('stout', 'Stout'), ('porter', 'Porter'),
          ('bock', 'Bock'), ('kellerbier', 'Kellerbier'), ('zwickel', 'Kellerbier'), ('helles', 'Helles'),
          ('kolsch', 'Kölsch'), ('koelsch', 'Kölsch'), ('altbier', 'Alt'), ('dunkel', 'Dunkel'),
          ('export', 'Export'), ('marzen', 'Märzen'), ('pils', 'Pils'), ('lager', 'Lager')]


def off_contact():
    return os.environ.get('OFF_CONTACT') or DB['settings'].get('off_contact', '')


def off_get(url):
    hit = OFF_CACHE.get(url)
    if hit and time.time() - hit[0] < 86400:
        return hit[1], True
    contact = off_contact()
    if not contact:
        raise ValueError('Online-Suche: bitte zuerst unter „Mehr“ eine Kontakt-E-Mail für Open Food Facts hinterlegen')
    req = urllib.request.Request(url, headers={'User-Agent': f'Bierstudio/{VERSION} ({contact})'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        raise ValueError(f'Open Food Facts nicht erreichbar ({e.__class__.__name__})')
    if len(OFF_CACHE) > 300:
        OFF_CACHE.clear()
    OFF_CACHE[url] = (time.time(), data)
    return data, False


def off_product(p):
    cats = ' '.join(p.get('categories_tags') or []) + ' ' + norm(p.get('product_name'))
    style = next((s for k, s in STYLES if k in cats), '')
    n = p.get('nutriments') or {}
    abv = parse_abv(n.get('alcohol_100g', n.get('alcohol_value', p.get('alcohol_value'))))
    code = str(p.get('code', ''))
    return {'code': code, 'name': clean(p.get('product_name_de') or p.get('product_name')) or 'Ohne Namen',
            'brand': clean(str(p.get('brands', '')).split(',')[0]), 'quantity': clean(p.get('quantity'), 40),
            'style': style, 'abv': abv, 'image': p.get('image_front_small_url') or '',
            'source_url': f'https://world.openfoodfacts.org/product/{code}'}


FIELDS = 'code,product_name,product_name_de,brands,quantity,categories_tags,nutriments,image_front_small_url'


def off_search(q):
    url = 'https://world.openfoodfacts.org/cgi/search.pl?' + urllib.parse.urlencode({
        'search_terms': q, 'search_simple': 1, 'action': 'process', 'json': 1, 'page_size': 15,
        'tagtype_0': 'categories', 'tag_contains_0': 'contains', 'tag_0': 'beers', 'fields': FIELDS})
    data, cached = off_get(url)
    return {'products': [off_product(p) for p in data.get('products', []) if p.get('code')], 'cached': cached}


def off_unified(p):
    return {'source': 'off', 'name': p['name'], 'brewery': p['brand'], 'style': p['style'], 'abv': p['abv'], 'country': '',
            'site': '', 'barcode': p['code'], 'image': p['image'], 'quantity': p['quantity'], 'source_url': p['source_url']}


def world_lookup(q):
    """Sucht parallel bei Wikidata und Open Food Facts."""
    if len(q) < 2:
        raise ValueError('Mindestens zwei Zeichen eingeben')
    results, notes = {}, []

    def wd():
        try:
            results['wd'] = lookup.wd_beers(q, off_contact())
        except Exception as e:
            notes.append(f'Wikidata nicht erreichbar ({e.__class__.__name__})')

    def off():
        try:
            results['off'] = [off_unified(p) for p in off_search(q)['products']]
        except ValueError as e:
            notes.append(str(e))
    threads = [threading.Thread(target=f) for f in (wd, off)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(15)
    return {'results': results.get('wd', []) + results.get('off', []), 'notes': notes}


def off_barcode(code):
    if not re.fullmatch(r'\d{8,14}', code):
        raise ValueError('Barcode mit 8–14 Ziffern eingeben')
    data, cached = off_get(f'https://world.openfoodfacts.org/api/v2/product/{code}.json?fields={FIELDS}')
    p = data.get('product')
    return {'products': [off_product({**p, 'code': code})] if p else [], 'cached': cached}


# ---------------------------------------------------------------- actions
def blind_beer_ids():
    return {b for s in DB['sessions'] if not s['reveal'] for b in s['beers']}


def trash_put(kind, by, label, payload):
    """Gelöschtes landet 30 Tage im Papierkorb – jede Person kann es zurückholen."""
    cutoff = (datetime.datetime.now().astimezone() - datetime.timedelta(days=TRASH_DAYS)).isoformat(timespec='seconds')
    DB['trash'] = [t for t in DB.setdefault('trash', []) if t['at'] >= cutoff][-300:]
    t = {'tid': uid(), 'kind': kind, 'at': now(), 'by': clean(by, 40), 'label': clean(label, 160), **payload}
    DB['trash'].append(t)
    return t['tid']


def act_person(q):
    name = clean(q.get('name'), 40)
    if not name:
        raise ValueError('Name fehlt')
    if name not in DB['people']:
        DB['people'].append(name)
    return {'name': name}


def act_rate(q):
    user = clean(q.get('user'), 40)
    if user not in DB['people']:
        raise ValueError('Bitte zuerst eine Person wählen')
    beer = beer_of(q.get('beer'))
    if not beer:
        raise ValueError('Bier nicht gefunden')
    sid = q.get('session') or None
    if sid:
        s = session_of(sid)
        if not s:
            raise ValueError('Tasting nicht gefunden')
        if s['closed']:
            raise ValueError('Dieses Tasting ist abgeschlossen')
        if beer['id'] not in s['beers']:
            raise ValueError('Bier gehört nicht zu diesem Tasting')
        if user not in s['people']:
            s['people'].append(user)
    detail = q.get('detail')
    if detail:
        if any(k not in detail or detail[k] is None or not 1 <= float(detail[k]) <= 5 for k in CATS):
            raise ValueError('Bitte alle fünf Kategorien bewerten')
        detail = {k: float(detail[k]) for k in CATS}
        value = detail_score(detail)
    else:
        detail = None
        value = float(str(q.get('value')).replace(',', '.'))
    if not 0 <= value <= 10:
        raise ValueError('Note muss zwischen 0 und 10 liegen')
    favorite = bool(q.get('favorite'))
    if favorite and sid:  # ein Favorit pro Person und Abend
        for r in DB['ratings']:
            if r['user'] == user and r['session'] == sid:
                r['favorite'] = False
    DB['ratings'] = [r for r in DB['ratings'] if not (r['user'] == user and r['beer'] == beer['id'] and r['session'] == sid)]
    tags = [clean(t, 24) for t in (q.get('tags') or [])[:12] if clean(t, 24)]
    DB['ratings'].append({'beer': beer['id'], 'user': user, 'session': sid, 'value': round(value, 2),
                          'detail': detail, 'note': str(q.get('note') or '')[:1000], 'tags': tags,
                          'favorite': favorite, 'ts': q.get('ts') or now()})
    return {}


def act_rating_delete(q):
    sid = q.get('session') or None
    s = session_of(sid) if sid else None
    if s and s['closed']:
        raise ValueError('Dieses Tasting ist abgeschlossen')
    r = next((r for r in DB['ratings'] if r['user'] == q.get('user') and r['beer'] == q.get('beer') and r['session'] == sid), None)
    if not r:
        raise ValueError('Bewertung nicht gefunden')
    b = beer_of(r['beer'])
    name = 'verdecktes Bier' if r['beer'] in blind_beer_ids() else (b or {}).get('name', '?')
    tid = trash_put('rating', q.get('by') or q.get('user'), f"Note von {r['user']} für {name}", {'rating': r})
    DB['ratings'].remove(r)
    return {'tid': tid}


def act_beer(q):
    b = beer_of(q.get('id'))
    created = False
    if b is None:
        name = clean(q.get('name'))
        if not name:
            raise ValueError('Name fehlt')
        existing = next((x for x in DB['beers'] if norm(x['name']) == norm(name)), None)
        if existing and not q.get('force_new'):
            b = existing  # gleicher Name -> gleiches Bier, damit alle dasselbe bewerten
        else:
            cid = q.get('id')
            b = {'id': cid if cid and ID_RE.match(cid) else uid(), 'name': name, 'brewery': '', 'style': '',
                 'abv': None, 'barcode': '', 'brand': '', 'image': '',
                 'created_by': clean(q.get('user'), 40), 'created_at': now()}
            DB['beers'].append(b)
            created = True
    # Neu angelegt oder gezielt bearbeitet: Felder übernehmen.
    # Per Name gefundenes, bestehendes Bier: nur leere Felder ergänzen.
    editing = created or q.get('id') == b['id']
    for k, n in (('name', 120), ('brewery', 120), ('style', 60), ('brand', 120), ('barcode', 20), ('image', 300),
                 ('abv', 0), ('country', 60), ('site', 0), ('source', 30)):
        if k not in q or (not editing and b.get(k) not in (None, '')):
            continue
        v = parse_abv(q[k]) if k == 'abv' else lookup.domain(str(q[k] or '')) if k == 'site' else clean(q[k], n)
        if (k == 'name' and not v) or (k == 'image' and v and not v.startswith('https://')):
            continue
        b[k] = v
    sid = q.get('session')
    if sid:
        s = session_of(sid)
        if not s:
            raise ValueError('Tasting nicht gefunden')
        if b['id'] not in s['beers']:
            s['beers'].append(b['id'])
        if q.get('make_current') or not s.get('current'):
            s['current'] = b['id']
    return {'id': b['id'], 'existing': not created}


def act_beer_delete(q):
    bid = q.get('id')
    b = beer_of(bid)
    if not b:
        raise ValueError('Bier nicht gefunden')
    backup(force=True)
    places = [{'session': s['id'], 'index': s['beers'].index(bid), 'current': s.get('current') == bid}
              for s in DB['sessions'] if bid in s['beers']]
    tid = trash_put('beer', q.get('user'), b['name'], {'beer': b, 'places': places,
                                                       'ratings': [r for r in DB['ratings'] if r['beer'] == bid]})
    DB['beers'] = [b for b in DB['beers'] if b['id'] != bid]
    DB['ratings'] = [r for r in DB['ratings'] if r['beer'] != bid]
    for s in DB['sessions']:
        s['beers'] = [x for x in s['beers'] if x != bid]
        if s.get('current') == bid:
            s['current'] = None
    return {'tid': tid}


def act_session(q):
    if q.get('new'):
        s = {'id': uid(), 'name': 'Tasting-Abend', 'date': datetime.date.today().isoformat(), 'place': '',
             'people': [], 'beers': [], 'reveal': True, 'closed': False, 'current': None, 'created_at': now()}
        DB['sessions'].append(s)
        DB['active'] = s['id']
    else:
        s = session_of(q.get('id'))
        if not s:
            raise ValueError('Tasting nicht gefunden')
    for k in ('name', 'date', 'place'):
        if k in q:
            s[k] = clean(q[k])
    if not s['name']:
        s['name'] = 'Tasting-Abend'
    if 'people' in q:
        ps = list(dict.fromkeys(clean(x, 40) for x in q['people'] if clean(x, 40)))
        rated = {r['user'] for r in DB['ratings'] if r['session'] == s['id']}
        missing = rated - set(ps)
        if missing:
            raise ValueError('Personen mit Bewertungen können nicht entfernt werden: ' + ', '.join(sorted(missing)))
        s['people'] = ps
        for p in ps:
            if p not in DB['people']:
                DB['people'].append(p)
    for k in ('closed', 'reveal'):
        if k in q:
            s[k] = bool(q[k])
    if 'current' in q:
        s['current'] = q['current'] if q['current'] in s['beers'] else None
    if q.get('activate'):
        DB['active'] = s['id']
    return {'id': s['id']}


def act_session_beers(q):
    s = session_of(q.get('session'))
    if not s:
        raise ValueError('Tasting nicht gefunden')
    bid = q.get('id')
    if q.get('op') == 'add':
        if not beer_of(bid):
            raise ValueError('Bier nicht gefunden')
        if bid not in s['beers']:
            s['beers'].append(bid)
    elif q.get('op') == 'remove':
        if any(r['session'] == s['id'] and r['beer'] == bid for r in DB['ratings']):
            raise ValueError('Bier hat in diesem Tasting schon Bewertungen')
        s['beers'] = [x for x in s['beers'] if x != bid]
        if s.get('current') == bid:
            s['current'] = None
    elif q.get('op') == 'move':
        i = s['beers'].index(bid)
        j = i + (1 if int(q.get('dir', 1)) > 0 else -1)
        if 0 <= j < len(s['beers']):
            s['beers'][i], s['beers'][j] = s['beers'][j], s['beers'][i]
    else:
        raise ValueError('Unbekannte Operation')
    return {}


def act_session_delete(q):
    s = session_of(q.get('id'))
    if not s:
        raise ValueError('Tasting nicht gefunden')
    backup(force=True)
    tid = trash_put('session', q.get('user'), s['name'], {'session': s, 'was_active': DB.get('active') == s['id'],
                                                         'ratings': [r for r in DB['ratings'] if r['session'] == s['id']]})
    DB['sessions'] = [x for x in DB['sessions'] if x['id'] != s['id']]
    DB['ratings'] = [r for r in DB['ratings'] if r['session'] != s['id']]
    if DB.get('active') == s['id']:
        DB['active'] = None
    return {'tid': tid}


def _add_ratings(rs):
    keys = {(r['beer'], r['user'], r['session']) for r in DB['ratings']}
    ids = {b['id'] for b in DB['beers']}
    sids = {s['id'] for s in DB['sessions']}
    for r in rs:
        if r['beer'] in ids and (r['session'] is None or r['session'] in sids) and (r['beer'], r['user'], r['session']) not in keys:
            DB['ratings'].append(r)
            if r['user'] not in DB['people']:
                DB['people'].append(r['user'])


def act_trash_restore(q):
    t = next((t for t in DB.get('trash', []) if t['tid'] == q.get('tid')), None)
    if not t:
        raise ValueError('Nicht mehr im Papierkorb')
    if t['kind'] == 'rating':
        r = t['rating']
        if not beer_of(r['beer']) or (r['session'] and not session_of(r['session'])):
            raise ValueError('Das Bier bzw. der Abend dazu ist gelöscht – zuerst das wiederherstellen')
        if any(x['beer'] == r['beer'] and x['user'] == r['user'] and x['session'] == r['session'] for x in DB['ratings']):
            raise ValueError('Dafür gibt es inzwischen eine neue Bewertung')
        _add_ratings([r])
    elif t['kind'] == 'beer':
        b = t['beer']
        if beer_of(b['id']):
            raise ValueError('Das Bier ist schon wieder da')
        DB['beers'].append(b)
        for pl in t.get('places', []):
            s = session_of(pl['session'])
            if s and b['id'] not in s['beers']:
                s['beers'].insert(min(pl['index'], len(s['beers'])), b['id'])
                if pl.get('current') and not s.get('current'):
                    s['current'] = b['id']
        _add_ratings(t.get('ratings', []))
    elif t['kind'] == 'session':
        s = t['session']
        if session_of(s['id']):
            raise ValueError('Der Abend ist schon wieder da')
        ids = {b['id'] for b in DB['beers']}
        s['beers'] = [x for x in s['beers'] if x in ids]
        if s.get('current') not in s['beers']:
            s['current'] = None
        DB['sessions'].append(s)
        _add_ratings(t.get('ratings', []))
        if t.get('was_active') and not DB.get('active'):
            DB['active'] = s['id']
    DB['trash'] = [x for x in DB['trash'] if x['tid'] != t['tid']]
    return {}


BACKUP_RE = re.compile(r'^\d{8}-\d{6}-\d{6}\.json$')


def list_backups():
    out = []
    for p in sorted(BACKUP_DIR.glob('*.json'), reverse=True):
        if BACKUP_RE.match(p.name):
            t = datetime.datetime.strptime(p.name[:15], '%Y%m%d-%H%M%S').astimezone()
            out.append({'name': p.name, 'at': t.isoformat(timespec='seconds'), 'size': p.stat().st_size})
    return out


def act_backup_restore(q):
    global DB
    name = str(q.get('name', ''))
    if not BACKUP_RE.match(name) or not (BACKUP_DIR / name).exists():
        raise ValueError('Sicherung nicht gefunden')
    new = upgrade(json.loads((BACKUP_DIR / name).read_text(encoding='utf-8')))
    backup(force=True)  # aktueller Stand wird vorher selbst gesichert
    new['rev'] = DB.get('rev', 0) + 1
    DB = new
    return {}


def act_active(q):
    if q.get('id') and not session_of(q['id']):
        raise ValueError('Tasting nicht gefunden')
    DB['active'] = q.get('id') or None
    return {}


def act_settings(q):
    if 'off_contact' in q:
        c = clean(q['off_contact'], 120)
        if c and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+|https?://\S+', c):
            raise ValueError('Bitte eine gültige E-Mail oder URL angeben')
        DB['settings']['off_contact'] = c
    return {}


def act_restore(q):
    global DB
    new = upgrade(q)
    backup(force=True)
    new['rev'] = DB.get('rev', 0) + 1
    DB = new
    return {}


def act_logos_retry(q):
    return {'cleared': lookup.forget_misses(LOGO_DIR) if LOGO_DIR.exists() else 0}


ACTIONS = {'person': act_person, 'rate': act_rate, 'rating/delete': act_rating_delete, 'beer': act_beer,
           'beer/delete': act_beer_delete, 'session': act_session, 'session/beers': act_session_beers,
           'session/delete': act_session_delete, 'active': act_active, 'settings': act_settings,
           'restore': act_restore, 'trash/restore': act_trash_restore, 'backup/restore': act_backup_restore,
           'logos/retry': act_logos_retry}


def csv_export(user, sid):
    view = redacted(user)
    beers = {b['id']: b for b in view['beers']}
    sessions = {s['id']: s for s in view['sessions']}
    f = io.StringIO()
    w = csv.writer(f, delimiter=';')
    w.writerow(['Tasting', 'Datum', 'Bier', 'Brauerei', 'Stil', 'Alkohol %', 'Person', 'Note 0-10'] + CATS +
               ['Tags', 'Notiz', 'Favorit', 'Zeitpunkt'])
    for r in view['ratings']:
        if r.get('hidden') or (sid and sid != 'all' and (r['session'] or 'solo') != sid):
            continue
        b = beers.get(r['beer'], {}); s = sessions.get(r['session'])
        d = r.get('detail') or {}
        w.writerow([s['name'] if s else 'Solo', s.get('date', '') if s else r.get('ts', '')[:10],
                    b.get('name', '?'), b.get('brewery', ''), b.get('style', ''),
                    str(b.get('abv') or '').replace('.', ','), r['user'], str(r['value']).replace('.', ',')] +
                   [str(d.get(k, '')).replace('.0', '') for k in CATS] +
                   [', '.join(r.get('tags') or []), r.get('note', ''), 'ja' if r.get('favorite') else '', r.get('ts', '')])
    return '﻿' + f.getvalue()


# ---------------------------------------------------------------- HTTP
MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
        '.ico': 'image/x-icon'}


class Handler(BaseHTTPRequestHandler):
    server_version = 'Bierstudio/' + VERSION
    sys_version = ''

    def log_message(self, fmt, *args):
        if os.environ.get('LOG_REQUESTS'):
            super().log_message(fmt, *args)

    def send(self, status, body, ctype='application/json', headers=None):
        if ctype == 'application/json' and not isinstance(body, (bytes, str)):
            body = json.dumps(body, ensure_ascii=False, separators=(',', ':'))
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(status)
        self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith(('text', 'application/json')) else ''))
        self.send_header('Content-Length', str(len(b)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        for k, v in {'Cache-Control': 'no-store', **(headers or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(b)

    def query(self):
        return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}

    def static(self, path):
        if path in ('/', '/index.html') or not Path(path).suffix:
            path = '/index.html'  # SPA-Fallback
        f = (STATIC / path.lstrip('/')).resolve()
        if STATIC not in f.parents or not f.is_file():
            return self.send(404, {'error': 'Nicht gefunden'})
        extra = {'Cache-Control': 'no-cache'}
        if path == '/sw.js':
            extra['Service-Worker-Allowed'] = '/'
        if path == '/index.html':
            extra['Content-Security-Policy'] = ("default-src 'self'; img-src 'self' data: https://*.openfoodfacts.org "
                                                "https://*.openfoodfacts.net; style-src 'self' 'unsafe-inline'; "
                                                "script-src 'self'; connect-src 'self'; media-src 'self' blob:")
        self.send(200, f.read_bytes(), MIME.get(f.suffix, 'application/octet-stream'), extra)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        q = self.query()
        try:
            if path == '/healthz':
                return self.send(200, {'ok': True, 'version': VERSION})
            if not path.startswith('/api/'):
                return self.static(path)
            if path == '/api/lookup':
                return self.send(200, world_lookup(clean(q.get('q'))))
            if path == '/api/logo':
                if not q.get('b') and not q.get('s'):
                    return self.send(404, {'error': 'Kein Logo'})
                hit = lookup.get_logo(clean(q.get('b')), clean(q.get('s')), off_contact(), LOGO_DIR)
                if not hit:
                    return self.send(404, {'error': 'Kein Logo'}, headers={'Cache-Control': 'public, max-age=600'})
                return self.send(200, hit[0], hit[1], {'Cache-Control': 'public, max-age=2592000',
                                                        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"})
            if path == '/api/backups':
                return self.send(200, {'backups': list_backups()})
            if path == '/api/off/search':
                return self.send(200, off_search(clean(q.get('q'))))
            if path == '/api/off/barcode':
                return self.send(200, off_barcode(clean(q.get('code'), 20)))
            with LOCK:
                if path == '/api/state':
                    if q.get('since') == str(DB['rev']):
                        return self.send(200, {'rev': DB['rev'], 'unchanged': True})
                    return self.send(200, redacted(q.get('user', '')))
                if path == '/api/trash':
                    return self.send(200, {'trash': redacted(q.get('user', ''))['trash']})
                if path == '/api/backup':
                    name = 'bierstudio-backup-' + datetime.date.today().isoformat() + '.json'
                    return self.send(200, json.dumps(DB, ensure_ascii=False, indent=1), 'application/json',
                                     {'Content-Disposition': f'attachment; filename="{name}"'})
                if path == '/api/csv':
                    return self.send(200, csv_export(q.get('user', ''), q.get('session', 'all')), 'text/csv',
                                     {'Content-Disposition': 'attachment; filename="bierstudio.csv"'})
            self.send(404, {'error': 'Nicht gefunden'})
        except ValueError as e:
            self.send(400, {'error': str(e)})
        except Exception as e:
            self.send(500, {'error': 'Serverfehler: ' + str(e)})

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get('Host'):
                return self.send(403, {'error': 'Fremde Herkunft nicht erlaubt'})
            n = int(self.headers.get('Content-Length') or 0)
            if n > 20_000_000:
                return self.send(413, {'error': 'Datei zu groß'})
            q = json.loads(self.rfile.read(n) or b'{}')
            action = ACTIONS.get(urllib.parse.urlsplit(self.path).path.removeprefix('/api/'))
            if not action or not isinstance(q, dict):
                return self.send(404, {'error': 'Unbekannte Aktion'})
            with LOCK:
                snapshot = json.dumps(DB)
                try:
                    result = action(q)
                    save()
                except Exception:
                    globals()['DB'] = json.loads(snapshot)  # nichts halb Geändertes behalten
                    raise
                self.send(200, {'ok': True, 'rev': DB['rev'], **result})
        except (ValueError, KeyError, TypeError) as e:
            self.send(400, {'error': str(e) or 'Ungültige Anfrage'})
        except Exception as e:
            self.send(500, {'error': 'Speichern fehlgeschlagen: ' + str(e)})


def drop_privileges():
    """Startet der Container als root und sind PUID/PGID gesetzt: Datenordner übernehmen, dann Rechte abgeben.
    So muss auf TrueNAS niemand vorher chown ausführen."""
    uid = os.environ.get('PUID')
    if not uid or os.name != 'posix' or os.geteuid() != 0:
        return
    uid, gid = int(uid), int(os.environ.get('PGID') or uid)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for root, dirs, files in os.walk(DATA_DIR):
        for path in [root] + [os.path.join(root, x) for x in dirs + files]:
            try:
                os.lchown(path, uid, gid)
            except OSError:
                pass
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    print(f'Läuft als Benutzer {uid}:{gid}', flush=True)


def main():
    drop_privileges()
    load_db()
    port = int(os.environ.get('PORT', '8000'))
    srv = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    srv.daemon_threads = True
    print(f'Bierstudio {VERSION} läuft auf Port {port} · Daten: {DB_FILE}', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
