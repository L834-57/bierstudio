#!/usr/bin/env python3
"""Wandelt tools/catalog.tsv in app/static/catalog.json um."""
import json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
rows = []
for line in (root / 'tools/catalog.tsv').read_text(encoding='utf-8').splitlines():
    if line.startswith('#') or not line.strip():
        continue
    p = line.split('\t') + [''] * 7
    n, a, b, s, v, c, w = p[:7]
    rows.append({'name': n, 'aliases': [x for x in a.split('|') if x], 'brewery': b, 'style': s,
                 'abv': float(v) if v else None, 'country': c, 'site': w})
out = {'version': 1, 'note': 'Richtwerte – können je nach Land und Jahrgang abweichen.', 'beers': rows}
(root / 'app/static/catalog.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(len(rows), 'Biere geschrieben')
