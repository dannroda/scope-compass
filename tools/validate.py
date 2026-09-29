# /// script
# requires-python = ">=3.10"
# dependencies = ["jsonschema[format]>=4.18"]
# ///
"""Valida la carpeta compass/ de un proyecto contra schema/: schemas, formato canónico, conflictos y referencias a hitos."""
import argparse, glob, json, os, sys

from jsonschema import Draft202012Validator

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('dirs', nargs='*', default=['compass'], help='carpetas compass/ a validar')
ap.add_argument('--schema', default=os.path.join(HERE, '..', 'schema'), help='carpeta con los JSON Schema')
a = ap.parse_args()

V = {n: Draft202012Validator(json.load(open(f'{a.schema}/{n}.schema.json', encoding='utf-8')),
                             format_checker=Draft202012Validator.FORMAT_CHECKER)
     for n in ('config', 'milestone', 'task')}
canon = lambda obj: json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
errors = 0


def report(path, msg):
    global errors
    errors += 1
    print(f'{path}: {msg}')


def check(path, kind):
    text = open(path, encoding='utf-8').read()
    if any(line.startswith(('<<<<<<<', '=======', '>>>>>>>')) for line in text.splitlines()):
        report(path, 'marcadores de conflicto de git')
        return None
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        report(path, f'JSON inválido: {e}')
        return None
    for e in sorted(V[kind].iter_errors(doc), key=lambda e: list(e.path)):
        report(path, f"{'/'.join(map(str, e.path)) or '(raíz)'}: {e.message}")
    if text != canon(doc):
        report(path, 'no está en formato canónico')
    return doc


for d in a.dirs:
    if os.path.exists(f'{d}/config.json'):
        check(f'{d}/config.json', 'config')
    else:
        report(d, 'falta config.json')
    ms = {os.path.basename(p)[:-5] for p in glob.glob(f'{d}/milestones/*.json') if check(p, 'milestone') is not None}
    tasks = sorted(glob.glob(f'{d}/tasks/*.json'))
    for p in tasks:
        t = check(p, 'task')
        if t and t.get('milestone') not in ms:
            report(p, f"hito inexistente: {t.get('milestone')}")
    print(f'{d}: {len(ms)} hitos, {len(tasks)} tareas')

print('OK' if not errors else f'{errors} errores')
sys.exit(1 if errors else 0)
