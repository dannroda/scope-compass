"""Genera el markdown legible de un tablero desde una carpeta con milestones/ y tasks/ (JSON)."""
import argparse, datetime, glob, json, os

ap = argparse.ArgumentParser()
ap.add_argument('src', help='carpeta con milestones/ y tasks/ (export del artifact o compass/)')
ap.add_argument('out', help='archivo .md de salida')
ap.add_argument('--title', default='Scope Compass', help='nombre del proyecto para el título')
ap.add_argument('--board', default='https://claude.ai/artifact/JAiu8ZznTSLcDk8EzU3Zaj', help='URL del tablero')
a = ap.parse_args()

load = lambda d: {os.path.basename(p)[:-5]: json.load(open(p, encoding='utf-8')) for p in glob.glob(f'{a.src}/{d}/*.json')}
ms, ts = load('milestones'), load('tasks')
ST = {'todo': 'Pendiente', 'doing': 'En curso', 'review': 'Revisión', 'done': 'Hecho'}
key = lambda t: (t.get('order', 0), t.get('code', ''))
L = [f'# Tareas — {a.title}', '',
     f'> Copia local del tablero {a.board}. '
     'El tablero es la fuente de verdad; este archivo se regenera desde ahí.',
     f'> Generado: {datetime.date.today().isoformat()}', '']
for mid, m in sorted(ms.items(), key=lambda kv: kv[1].get('order', 0)):
    mt = sorted([t for t in ts.values() if t.get('milestone') == mid], key=key)
    done = sum(t.get('status') == 'done' for t in mt)
    L += [f"## {m['code']} — {m['title']}" + (f"  ({done}/{len(mt)})" if mt else ''), '', m.get('goal', ''), '']
    if m.get('done_when'):
        L += ['**Hecho cuando:**'] + [f'- {x}' for x in m['done_when']] + ['']
    for t in mt:
        head = ' '.join(x for x in [t.get('code', ''), t['title']] if x)
        L += [f"### {head} · {ST.get(t.get('status', 'todo'), t.get('status'))}", '']
        L += [f"- [{'x' if c.get('done') else ' '}] {c['text']}" for c in t.get('checklist', [])]
        if t.get('checklist'): L.append('')
        if t.get('test'): L += [f"**Prueba:** {t['test']}", '']
        if t.get('notes'): L += [f"**Notas:** {t['notes']}", '']
        if t.get('refs'): L += ['**Referencias:** ' + ', '.join(f"`{r['doc']}#{r['section']}`" for r in t['refs']), '']
open(a.out, 'w', encoding='utf-8').write('\n'.join(L).rstrip() + '\n')
