# Changelog

## v2.1.1
- Logos: Fehlversuche bei Netzproblemen werden nach 10 Minuten wiederholt (statt 7 Tagen), echte Fehltreffer nach einem Tag
- Logos: Website der Brauerei wird zusätzlich unter www. versucht und notfalls aus Wikidata übernommen
- User-Agent enthält eine Kontaktangabe (Pflicht bei Wikimedia), auch ohne hinterlegte E-Mail
- Neuer Knopf „Logos erneut suchen“ unter Mehr → Produktsuche

## v2.1.0
- Hinterlegter Bier-Katalog (offline), weltweite Suche über Wikidata und Open Food Facts, Brauerei-Logos
- „Fehlende Infos ergänzen“ für das ganze Bierbuch
- Papierkorb (30 Tage), Rückgängig nach dem Löschen, Server-Sicherungen zum Zurückspringen – für alle, ohne Admin
- Eigene Dialoge statt Browser-Popups
- Container übernimmt den Datenordner selbst (PUID/PGID), kein manuelles chown mehr
- Fix: JSON-Backup-Download war doppelt kodiert

## v2.0.0
- Komplett überarbeitet: globales Bierbuch, Solo-Bewertungen, Live-„Im Glas“, echte Blindverkostung, PWA, Offline-Warteschlange, Docker/TrueNAS
