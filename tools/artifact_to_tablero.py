"""Convierte el export del artifact (un JSON por documento) al formato canónico de compass/."""
import datetime, glob, json, os, sys

src, dst = sys.argv[1], sys.argv[2]
NOW = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def canon(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + '\n'


for col in ('milestones', 'tasks'):
    os.makedirs(f'{dst}/{col}', exist_ok=True)
    for p in glob.glob(f'{src}/{col}/*.json'):
        d = json.load(open(p, encoding='utf-8'))
        d.pop('version', None)
        if col == 'tasks':
            d.setdefault('created_at', d.get('updated_at', NOW))
            d.setdefault('refs', [])
        open(f'{dst}/{col}/{os.path.basename(p)}', 'w', encoding='utf-8').write(canon(d))
