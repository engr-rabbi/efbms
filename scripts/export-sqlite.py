#!/usr/bin/env python3
"""
Export the OLD ElectroFlow database (Prisma/SQLite, db/custom.db) to one JSON file that the
new app can import (Settings ▸ Backup & Data ▸ Data migration).

  python3 scripts/export-sqlite.py path/to/custom.db  [-o export.json] [--library-only]

 * Original record IDs are kept → every relationship (project→floor→room→point, material→image…) survives.
 * Drawing documents are exported with their full editable JSON (geometry, scale, layers, symbols, routes).
 * Images that were stored as data: URLs are exported as-is; the importer moves them to Google Drive.
   Bundled sample images (/images/materials/…) stay static files in the site.
 * Users are NOT exported: the old password hashes (unsalted SHA-256) must not be carried over.
   Create users again in the new app (Settings ▸ Users).
 * --library-only exports only the reusable library (materials, images, suppliers, design rules,
   company, settings) and no projects — handy as a starter data set.
 * The export also records row counts so the import report can be compared.
"""
import argparse, json, sqlite3, sys, datetime

TABLES = {  # new table name -> (old table, column mapping {new: old}) ; None = same name
    'company': ('CompanyInfo', {}),
    'designRules': ('DesignRule', {}),
    'settings': ('AppSetting', {'id': 'key', 'value': 'value'}),
    'suppliers': ('Supplier', {}),
    'materials': ('Material', {}),
    'materialImages': ('MaterialImage', {}),
    'priceHistory': ('PriceHistory', {}),
    'projects': ('Project', {}),
    'floors': ('Floor', {}),
    'rooms': ('Room', {}),
    'points': ('ElectricalPoint', {}),
    'fixtures': ('PlumbingFixture', {}),
    'circuits': ('Circuit', {}),
    'estimateItems': ('EstimateItem', {}),
    'boqOverrides': ('BoqOverride', {}),
    'drawings': ('DrawingDoc', {}),
    'quotations': ('Quotation', {}),
    'purchaseOrders': ('PurchaseOrder', {}),
    'stockMovements': ('StockMovement', {}),
}
LIBRARY = {'company', 'designRules', 'settings', 'suppliers', 'materials', 'materialImages', 'priceHistory'}
DROP = {'userId'}  # columns that have no counterpart in the new schema


def iso(v):
    if v is None or v == '':
        return ''
    if isinstance(v, (int, float)):  # Prisma stores DateTime as epoch milliseconds in SQLite
        return datetime.datetime.fromtimestamp(v / 1000, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
    return str(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('db')
    ap.add_argument('-o', '--out', default='efbms-export.json')
    ap.add_argument('--library-only', action='store_true')
    a = ap.parse_args()
    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    have = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
    out, counts = {}, {}
    for new, (old, mapping) in TABLES.items():
        if a.library_only and new not in LIBRARY:
            continue
        if old not in have:
            print(f'  (skip {old}: table not found)', file=sys.stderr)
            continue
        rows = []
        for r in con.execute(f'select * from "{old}"'):
            d = dict(r)
            for newc, oldc in mapping.items():
                if oldc in d:
                    d[newc] = d.pop(oldc) if newc != oldc else d[oldc]
            for k in ('createdAt', 'updatedAt'):
                if k in d:
                    d[k] = iso(d[k])
            for k in list(d):
                if k in DROP:
                    d.pop(k)
                elif isinstance(d[k], int) and k in ('rccb', 'isDemo', 'archived', 'active', 'calibrated', 'isSample', 'isPrimary'):
                    d[k] = bool(d[k])
                elif d[k] is None:
                    d[k] = ''
            if new == 'drawings' and 'data' not in d:
                continue
            if new == 'stockMovements':
                d['projectId'] = d.get('projectId') or ''
            if new == 'projects':
                d['ownerId'] = ''            # the importing admin becomes owner; assign members in the app
                d['members'] = ''
            rows.append(d)
        out[new] = rows
        counts[new] = len(rows)
        print(f'{new:16s} {len(rows)}')
    json.dump({'format': 'efbms-export-v1', 'exportedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': a.db, 'counts': counts, 'tables': out},
              open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('written', a.out)


if __name__ == '__main__':
    main()
