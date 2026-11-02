# Bierstudio auf TrueNAS SCALE

Die Anleitung gilt für TrueNAS SCALE ab 24.10 („Electric Eel“), wo Apps als Docker-Compose laufen. Bierstudio läuft dabei getrennt von deinen anderen Apps (eigenes Dataset, eigener Benutzer, eigenes Netzwerk).

## Installation

### 1. Dataset anlegen
*Datasets → Add Dataset*, z. B. `tank/bierstudio` (Preset „Generic“). Rechte musst du nicht anpassen, das übernimmt der Container beim Start.

### 2. App per YAML installieren
*Apps → Discover Apps → ⋮ (oben rechts) → Install via YAML*

- **Name:** `bierstudio`
- **Inhalt:** [`truenas/bierstudio.yaml`](../truenas/bierstudio.yaml)

```yaml
services:
  bierstudio:
    image: ghcr.io/l834-57/bierstudio:latest
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - /mnt/tank/bierstudio:/data
    environment:
      TZ: Europe/Berlin
```

Anpassen musst du nur:

| Zeile | Wert |
|---|---|
| `- /mnt/tank/bierstudio:/data` | Pfad zu deinem Dataset (`tank` = Name deines Pools) |
| `- "8000:8000"` | Bei Bedarf links einen anderen freien Port, z. B. `"8420:8000"` |
| `OFF_CONTACT: …` | Optional unter `environment`, für die Barcode-Suche |

*Save*: TrueNAS lädt das Image (amd64 und arm64) und startet die App.

### 3. Öffnen
`http://<IP-deines-TrueNAS>:8000`

Teile den Link bzw. den QR-Code aus *Mehr → QR-Code zum Mitmachen zeigen* mit deinen Freunden.

### Alte Daten übernehmen
Hast du noch eine `tasting-data.json` oder `data.json` aus einer früheren Version, gibt es zwei Wege:
- vor dem ersten Start ins Dataset kopieren: Sie wird automatisch übernommen.
- oder später in der App unter *Mehr → Backup wiederherstellen* hochladen.

## Update

*Apps → bierstudio →* **Update** (bzw. *Edit → Save*, um das neueste `latest`-Image zu ziehen). Deine Daten bleiben unverändert.

Willst du eine feste Version statt `latest`, ersetze `latest` durch den Commit-Hash eines Builds. Diese Tags erzeugt die GitHub-Action automatisch.

## Getrennt von anderen Apps

- eigenes Dataset
- eigener Benutzer: Der Container startet kurz als root, übernimmt `/data` für UID/GID `3100` (änderbar über `PUID`/`PGID`) und läuft danach ohne Root-Rechte
- eigenes Docker-Netzwerk: TrueNAS legt pro App automatisch eins an

Optional härtest du die App weiter mit `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]` und `cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]`. Ein Beispiel dafür ist [`bierstudio-ohne-image.yaml`](../truenas/bierstudio-ohne-image.yaml).

## Variante ohne Image-Registry

Erreicht dein Server `ghcr.io` nicht, nimm [`truenas/bierstudio-ohne-image.yaml`](../truenas/bierstudio-ohne-image.yaml). Sie nutzt das offizielle Python-Image und lädt die App beim ersten Start von GitHub.

## HTTPS

Ohne HTTPS funktioniert alles außer Offline-Modus, App-Installation unter Android und Kamera-Barcode-Scanner. Zwei bewährte Wege:

**Tailscale** (auch für unterwegs)
1. Die Tailscale-App aus dem TrueNAS-Katalog installieren und anmelden.
2. In der Tailscale-Verwaltung *MagicDNS* und *HTTPS Certificates* einschalten.
3. Auf dem TrueNAS diesen Befehl ausführen:
   ```bash
   tailscale serve --bg 8000
   ```
   Danach ist die App unter `https://<truenas-name>.<tailnet>.ts.net` erreichbar, für alle Geräte in deinem Tailnet.

**Reverse Proxy** (Nginx Proxy Manager, Caddy, Traefik)
- Eine Proxy-Regel auf `http://<truenas-ip>:8000` anlegen und ein Zertifikat einrichten (z. B. Let's Encrypt mit DNS-Challenge für eine interne Domain).
- WebSockets werden nicht benötigt.

## Fehlersuche

| Problem | Lösung |
|---|---|
| Image lässt sich nicht laden / `urlopen error` | Der Server braucht beim Installieren Internet (ghcr.io bzw. github.com). DNS und Gateway von TrueNAS prüfen. |
| `Address already in use` / Port belegt | Links einen anderen Port eintragen, z. B. `"8420:8000"` |
| Keine Logos, „Wikidata nicht erreichbar“ | Der Container braucht ausgehendes Internet zu `www.wikidata.org`, `commons.wikimedia.org` und `upload.wikimedia.org`. Ohne Internet bleiben die Anfangsbuchstaben. |
| „Offline“ oben in der App | Das Handy erreicht den Server nicht (anderes WLAN, VPN aus). Bewertungen werden gespeichert und später übertragen. |
| Etwas versehentlich gelöscht | *Mehr → Papierkorb* oder *Mehr → Server-Sicherungen* |

Die Logs findest du unter *Apps → bierstudio → Logs*.

## Daten im Dataset

```
bierstudio.json   aktuelle Daten
backups/          automatische Sicherungen (zum Zurückspringen in der App)
logos/            zwischengespeicherte Brauerei-Logos
.app/             nur bei der Variante ohne Image: heruntergeladene Versionen
```

Für die Datensicherung reicht ein normaler TrueNAS-Snapshot bzw. eine Replikation des Datasets.
