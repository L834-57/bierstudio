"""Online-Quellen für Bierdaten: Wikidata (Biere, Brauereien, Logos) und Websites der Brauereien (Icons).

Nur Standardbibliothek. Alle Funktionen werfen bei Netzwerkfehlern Exceptions; der Aufrufer fängt sie ab.
"""
import json, re, threading, time, urllib.parse, urllib.request
from html.parser import HTMLParser

VERSION = '2.1.0'
WD_API = 'https://www.wikidata.org/w/api.php?'
CACHE = {}
BEERISH = re.compile(r'bier|beer|pils|lager|\bale\b|weizen|weiß|weiss|stout|porter|bock|kölsch|brauerei|brewery|brewed|cerveza|birra|pivo', re.I)
BREWERYISH = re.compile(r'brauerei|brewery|brauhaus|bräu|brouwerij|brasserie|pivovar|cervecer|birrificio|browar', re.I)
GENERIC = {'bier', 'biermarke', 'marke', 'beer', 'beer brand', 'brand', 'getränk', 'alkoholisches getränk',
           'produkt', 'lebensmittelmarke', 'markenname', 'trademark', 'handelsmarke'}
STYLE_WORDS = [('alkoholfrei', 'Alkoholfrei'), ('alcohol-free', 'Alkoholfrei'), ('non-alcoholic', 'Alkoholfrei'),
               ('radler', 'Radler'), ('weizen', 'Weizen'), ('weiß', 'Weizen'), ('weiss', 'Weizen'), ('wheat', 'Weizen'),
               ('witbier', 'Witbier'), ('ipa', 'IPA'), ('india pale', 'IPA'), ('pale ale', 'Pale Ale'), ('pale-ale', 'Pale Ale'),
               ('stout', 'Stout'), ('porter', 'Porter'), ('schwarzbier', 'Schwarzbier'), ('bock', 'Bock'),
               ('kellerbier', 'Kellerbier'), ('zwickel', 'Kellerbier'), ('helles', 'Helles'), ('hell', 'Helles'),
               ('kölsch', 'Kölsch'), ('kolsch', 'Kölsch'), ('koelsch', 'Kölsch'), ('altbier', 'Alt'), ('dunkel', 'Dunkel'),
               ('export', 'Export'), ('märzen', 'Märzen'), ('marzen', 'Märzen'), ('tripel', 'Tripel'), ('trappist', 'Trappist'),
               ('pils', 'Pils'), ('lager', 'Lager')]


def style_from(text):
    t = str(text or '').casefold()
    return next((s for k, s in STYLE_WORDS if k in t), '')


def ua(contact):
    return f'Bierstudio/{VERSION} ({contact or "self-hosted beer tasting app"})'


def http_get(url, contact, max_bytes=2_000_000, timeout=8):
    req = urllib.request.Request(url, headers={'User-Agent': ua(contact), 'Accept-Language': 'de,en;q=0.8'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError('Antwort zu groß')
        return data, r.headers.get('Content-Type', ''), r.geturl()


def get_json(url, contact, ttl=86400):
    hit = CACHE.get(url)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    data, _, _ = http_get(url, contact)
    j = json.loads(data.decode('utf-8'))
    if len(CACHE) > 500:
        CACHE.clear()
    CACHE[url] = (time.time(), j)
    return j


# ---------------------------------------------------------------- Wikidata
def wd_search(q, contact, limit=8):
    j = get_json(WD_API + urllib.parse.urlencode({'action': 'wbsearchentities', 'search': q, 'language': 'de', 'uselang': 'de',
                                                  'type': 'item', 'limit': limit, 'format': 'json'}), contact)
    hits = j.get('search', [])
    return [h['id'] for h in hits], {h['id']: h.get('description', '') for h in hits}


def wd_entities(ids, contact, props='claims|labels|descriptions'):
    ids = [i for i in dict.fromkeys(ids) if re.fullmatch(r'Q\d+', i)][:50]
    if not ids:
        return {}
    j = get_json(WD_API + urllib.parse.urlencode({'action': 'wbgetentities', 'ids': '|'.join(ids), 'props': props,
                                                  'languages': 'de|en', 'format': 'json'}), contact)
    return j.get('entities', {})


def label(e):
    lab = (e or {}).get('labels', {})
    return (lab.get('de') or lab.get('en') or {}).get('value', '')


def description(e):
    d = (e or {}).get('descriptions', {})
    return (d.get('de') or d.get('en') or {}).get('value', '')


def claims(e, prop):
    out = []
    for c in (e or {}).get('claims', {}).get(prop, []):
        snak = c.get('mainsnak', {})
        if snak.get('snaktype') == 'value':
            out.append(snak.get('datavalue', {}).get('value'))
    return out


def ids_of(e, prop):
    return [v['id'] for v in claims(e, prop) if isinstance(v, dict) and 'id' in v]


def domain(url):
    try:
        host = urllib.parse.urlsplit(url if '://' in url else 'https://' + url).hostname or ''
    except ValueError:
        return ''
    host = host.lower().removeprefix('www.')
    return host if re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}', host) else ''


def site_of(e):
    for v in claims(e, 'P856'):
        if isinstance(v, str) and domain(v):
            return domain(v)
    return ''


def wd_beers(q, contact):
    """Biere passend zur Suche, mit Brauerei, Stil, Alkoholgehalt, Land und Website der Brauerei."""
    ids, descs = wd_search(q, contact)
    ents = wd_entities(ids, contact)
    beers = []
    for i in ids:
        e = ents.get(i)
        if not e:
            continue
        text = descs.get(i, '') + ' ' + description(e)
        if not BEERISH.search(text) or (BREWERYISH.search(text) and not ids_of(e, 'P176') and not claims(e, 'P2665')):
            continue  # keine Brauereien selbst, nur Biere
        beers.append(e)
    refs = []
    for e in beers:
        refs += ids_of(e, 'P176') + ids_of(e, 'P279') + ids_of(e, 'P31') + ids_of(e, 'P495')
    rents = wd_entities(refs, contact)
    country_ids = [c for e in beers for b in ids_of(e, 'P176')[:1] for c in ids_of(rents.get(b), 'P17')[:1]]
    rents.update(wd_entities([c for c in country_ids if c not in rents], contact, props='labels'))
    out = []
    for e in beers:
        brew = rents.get((ids_of(e, 'P176') or [''])[0], {})
        style = ''
        for sid in ids_of(e, 'P279') + ids_of(e, 'P31'):
            lab = label(rents.get(sid))
            if lab and lab.casefold() not in GENERIC:
                style = style_from(lab) or lab
                break
        abv = None
        for v in claims(e, 'P2665'):
            try:
                abv = round(float(v['amount']), 2)
                break
            except (TypeError, ValueError, KeyError):
                pass
        cid = (ids_of(e, 'P495') or ids_of(brew, 'P17') or [''])[0]
        out.append({'source': 'wikidata', 'name': label(e), 'brewery': label(brew), 'style': style or style_from(label(e)),
                    'abv': abv, 'country': label(rents.get(cid)), 'site': site_of(brew) or site_of(e), 'barcode': '',
                    'image': '', 'source_url': f'https://www.wikidata.org/wiki/{e.get("id", "")}'})
    return [x for x in out if x['name']]


# ---------------------------------------------------------------- Logos
MAGIC = [(b'\x89PNG', 'image/png'), (b'\xff\xd8', 'image/jpeg'), (b'GIF8', 'image/gif'), (b'\x00\x00\x01\x00', 'image/x-icon')]


def sniff(data):
    for m, t in MAGIC:
        if data.startswith(m):
            return t
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    head = data[:800].lstrip().lower()
    if b'<svg' in head and (head.startswith(b'<?xml') or head.startswith(b'<svg') or head.startswith(b'<!--')):
        return 'image/svg+xml'
    return None


def fetch_image(url, contact):
    data, _, _ = http_get(url, contact, max_bytes=400_000)
    t = sniff(data)
    if not t or len(data) < 80:
        raise ValueError('kein Bild')
    return data, t


class _Icons(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons = []

    def handle_starttag(self, tag, attrs):
        if tag != 'link':
            return
        a = dict(attrs)
        rel = (a.get('rel') or '').lower()
        if 'icon' in rel and a.get('href'):
            m = re.match(r'(\d+)x(\d+)', a.get('sizes') or '')
            size = int(m.group(1)) if m else (999 if (a.get('type') or '').endswith('svg+xml') or a['href'].endswith('.svg') else 0)
            prio = 2 if 'apple-touch' in rel else 1
            self.icons.append((prio, size, a['href']))


def logo_from_wikidata(brewery, contact):
    if not brewery:
        return None
    ids, descs = wd_search(brewery, contact, limit=5)
    ents = wd_entities(ids, contact)
    for i in ids:
        e = ents.get(i, {})
        logos = [v for v in claims(e, 'P154') if isinstance(v, str)]
        if logos and ('Q131734' in ids_of(e, 'P31') or BREWERYISH.search(descs.get(i, '') + ' ' + description(e))):
            url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + urllib.parse.quote(logos[0].replace(' ', '_')) + '?width=160'
            return fetch_image(url, contact)
    return None


def logo_from_site(site, contact):
    site = domain(site or '')
    if not site:
        return None
    base = f'https://{site}/'
    cands = []
    try:
        html, _, final = http_get(base, contact, max_bytes=800_000)
        p = _Icons()
        p.feed(html.decode('utf-8', 'ignore'))
        p.icons.sort(key=lambda x: (x[1] >= 64, x[0], x[1]), reverse=True)
        cands = [urllib.parse.urljoin(final, h) for _, _, h in p.icons]
    except Exception:
        pass
    cands += [base + 'apple-touch-icon.png', base + 'favicon.ico']
    for url in dict.fromkeys(cands):
        if not url.startswith('https://'):
            continue
        try:
            return fetch_image(url, contact)
        except Exception:
            continue
    return None


_locks, _locks_guard = {}, threading.Lock()


def get_logo(brewery, site, contact, cache_dir):
    """Liefert (bytes, content_type) oder None. Ergebnisse (auch Fehlschläge) werden zwischengespeichert."""
    key = re.sub(r'[^a-z0-9]+', '-', (domain(site or '') or str(brewery or '')).casefold()).strip('-')[:80]
    if not key:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    meta, img = cache_dir / f'{key}.json', cache_dir / f'{key}.img'
    with _locks_guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        if meta.exists():
            try:
                m = json.loads(meta.read_text())
                if m.get('ok') and img.exists():
                    return img.read_bytes(), m['type']
                if time.time() - m.get('at', 0) < 7 * 86400:
                    return None  # kürzlich erfolglos versucht
            except (ValueError, KeyError):
                pass
        found = None
        for fn in (lambda: logo_from_wikidata(brewery, contact), lambda: logo_from_site(site, contact)):
            try:
                found = fn()
            except Exception:
                found = None
            if found:
                break
        if found:
            img.write_bytes(found[0])
        meta.write_text(json.dumps({'ok': bool(found), 'type': found[1] if found else '', 'at': time.time()}))
        return found
