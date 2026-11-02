# Entwicklung

Bierstudio kommt ohne Build-Schritt und ohne Abhängigkeiten aus: Der Server nutzt nur die Python-Standardbibliothek, das Frontend ist reines HTML, CSS und JavaScript.

```
app/
  server.py          HTTP-Server, Datenhaltung, Aktionen, Migration, Sicherungen, Papierkorb
  lookup.py          Wikidata-Suche und Brauerei-Logos
  static/
    index.html       App-Shell
    app.js           komplette Oberfläche (Event-Delegation über data-act / data-on, CSP-tauglich)
    app.css          Design-Tokens, hell/dunkel
    catalog.json     hinterlegter Bier-Katalog (aus tools/catalog.tsv erzeugt)
    sw.js            Service Worker (App-Shell offline, immer zuerst Netz)
    manifest.webmanifest, icons/, vendor/qrcode.js
tools/               Katalog-Quelle und Konverter
truenas/             YAML-Vorlagen für TrueNAS
```

## Lokal starten

```bash
python3 app/server.py
```

Die App läuft dann unter http://localhost:8000, die Daten liegen in `./data`. Mit `LOG_REQUESTS=1` protokolliert der Server jede Anfrage.

## Datenmodell (Version 3)

```jsonc
{
  "version": 3,
  "rev": 42,                       // steigt bei jeder Änderung, Clients fragen mit ?since=rev
  "people": ["Alex", "Sam"],
  "beers": [{ "id": "16 hex", "name": "", "brewery": "", "style": "", "abv": 5.2,
              "country": "DE", "site": "rothaus.de", "barcode": "", "image": "", "source": "katalog",
              "created_by": "Alex", "created_at": "ISO" }],
  "sessions": [{ "id": "", "name": "", "date": "YYYY-MM-DD", "place": "", "people": [],
                 "beers": ["bier-id", "..."], "reveal": true, "closed": false, "current": "bier-id" }],
  "ratings": [{ "beer": "", "user": "", "session": "abend-id oder null (Solo)", "value": 7.5,
                "detail": { "Aussehen": 4, "...": 3 } | null, "tags": [], "note": "", "favorite": false, "ts": "ISO" }],
  "active": "abend-id",            // „LIVE“-Abend
  "settings": { "off_contact": "" },
  "trash": [{ "tid": "", "kind": "beer|session|rating", "at": "ISO", "by": "", "label": "", "...": "gelöschte Daten" }]
}
```

Eine Bewertung ist eindeutig über `(beer, user, session)`. Biere sind global (Bierbuch). Ein Abend verweist nur auf sie.

## API

Alle Antworten sind JSON. Schreibende Aufrufe sind `POST` mit JSON-Body. Fremde `Origin`-Header werden abgelehnt.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/state?user=&since=` | Daten (bei Blindverkostung serverseitig gefiltert); `{unchanged:true}`, wenn `since` aktuell ist |
| GET | `/api/lookup?q=` | Weltweite Suche (Wikidata + Open Food Facts) |
| GET | `/api/off/barcode?code=` | Produkt per Barcode |
| GET | `/api/logo?b=<brauerei>&s=<domain>` | Brauerei-Logo (zwischengespeichert) oder 404 |
| GET | `/api/backups` | Liste der Server-Sicherungen |
| GET | `/api/backup` | Komplettes JSON-Backup |
| GET | `/api/csv?session=<id>\|all&user=` | CSV-Export |
| GET | `/healthz` | Health-Check |
| POST | `/api/person` | `{name}` |
| POST | `/api/rate` | `{beer, user, session, value \| detail, tags, note, favorite}` |
| POST | `/api/rating/delete` | `{beer, user, session}` → `{tid}` |
| POST | `/api/beer` | Anlegen (gleicher Name = gleiches Bier) oder mit `id` bearbeiten |
| POST | `/api/beer/delete` | `{id, user}` → `{tid}` |
| POST | `/api/session` | `{new}` oder `{id}` plus Felder, `reveal`, `closed`, `current` |
| POST | `/api/session/beers` | `{session, op: add\|remove\|move, id, dir}` |
| POST | `/api/session/delete` | `{id, user}` → `{tid}` |
| POST | `/api/active` | LIVE-Abend setzen |
| POST | `/api/trash/restore` | `{tid}` |
| POST | `/api/backup/restore` | `{name}` (aktueller Stand wird vorher gesichert) |
| POST | `/api/restore` | Komplettes Backup einspielen (auch Version 1/2) |
| POST | `/api/settings` | `{off_contact}` |

Schlägt eine Aktion fehl, wird der Stand im Speicher zurückgerollt, damit nichts halb geändert bleibt.

## Frontend-Prinzipien

- Alle Klicks laufen über `data-act="name"` → `ACT.name(el)`, Eingaben über `data-on` / `data-change`. Es gibt keine Inline-Handler, deshalb gilt eine strikte Content-Security-Policy.
- Abfrage alle 4 s mit `?since=rev`. Neu gezeichnet wird nur bei Änderungen und nie, während jemand tippt.
- Offline-Warteschlange (`localStorage: bs-outbox`) für Bewertungen und neue Biere.
- Entwürfe von Bewertungen bleiben pro Bier und Person erhalten, bis sie gespeichert werden.

## Katalog bauen

```bash
python3 tools/build_catalog.py
```
