# Bierstudio auf TrueNAS SCALE

Getestet ist die Anleitung für TrueNAS SCALE ab 24.10 („Electric Eel“), wo Apps als Docker-Compose laufen. Bierstudio läuft dabei **komplett getrennt** von deinen anderen Apps:
- eigenes Dataset
- eigener Benutzer (UID/GID `3100` statt des gemeinsamen `apps`-Benutzers)
- eigenes Docker-Netzwerk
- schreibgeschütztes Dateisystem und nur die nötigsten Rechte

## Installation

### 1. Dataset anlegen
*Datasets → Add Dataset*, z. B. `tank/bierstudio` (Preset „Generic“). Rechte musst du nicht anpassen, das übernimmt der Container beim Start.

### 2. App per YAML installieren
*Apps → Discover Apps → ⋮ (oben rechts) → Install via YAML*

- **Name:** `bierstudio`
- **Inhalt:** [`truenas/bierstudio.yaml`](../truenas/bierstudio.yaml) einfügen

Anpassen musst du darin nur:

| Zeile | Wert |
|---|---|
| `- /mnt/tank/bierstudio:/data` | Pfad zu deinem Dataset (`tank` = Name deines Pools) |
| `- "8000:8000"` | Bei Bedarf links einen anderen freien Port, z. B. `"8420:8000"` |
| `# OFF_CONTACT: …` | Optional, für die Barcode-Suche (Raute entfernen, E-Mail eintragen) |

*Save* → Die App startet. Beim **ersten Start** lädt sie die eingestellte Version von GitHub, das dauert ein paar Sekunden. Danach liegt sie im Dataset unter `.app/` und startet auch ohne Internet.

### 3. Öffnen
`http://<IP-deines-TrueNAS>:8000`

Teile den Link bzw. den QR-Code aus *Mehr → QR-Code zum Mitmachen zeigen* mit deinen Freunden.

### Alte Daten übernehmen
Hast du noch eine `tasting-data.json` oder `data.json` aus einer früheren Version, gibt es zwei Wege:
- vor dem ersten Start ins Dataset kopieren: Sie wird automatisch übernommen.
- oder später in der App unter *Mehr → Backup wiederherstellen* hochladen.

## Update

1. In der App-Konfiguration (*Apps → bierstudio → Edit*) `BIERSTUDIO_VERSION` auf die neue Version setzen, z. B. `v2.2.0`. Die verfügbaren Versionen stehen unter [Releases](https://github.com/L834-57/bierstudio/releases).
2. *Save*. Die App startet neu und lädt die neue Version.

Deine Daten bleiben dabei unverändert. Alte Versionen unter `.app/` kannst du löschen.

## Variante mit fertigem Image

Bei jedem Push baut eine GitHub-Action das Image `ghcr.io/l834-57/bierstudio:latest`. Damit TrueNAS es ohne Anmeldung laden kann, stellt der Repo-Besitzer einmalig unter *GitHub → Packages → bierstudio → Package settings → Change visibility* die Sichtbarkeit auf **Public**. Danach funktioniert [`truenas/bierstudio-image.yaml`](../truenas/bierstudio-image.yaml).

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
| App startet nicht, im Log steht `urlopen error` | Beim ersten Start braucht der Container Internet, um die Version von GitHub zu laden. DNS und Gateway von TrueNAS prüfen. |
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
.app/             heruntergeladene Bierstudio-Versionen
```

Für die Datensicherung reicht ein normaler TrueNAS-Snapshot bzw. eine Replikation des Datasets.
