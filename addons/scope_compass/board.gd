@tool
extends RefCounted
## Estado del tablero en el dock: hitos, tareas y avisos, con el mismo orden que la CLI y la UI web.

const STATUSES := [
	{ "id": "doing", "label": "En curso", "color": Color("#7fb0dc") },
	{ "id": "review", "label": "Revisión", "color": Color("#e0a95a") },
	{ "id": "todo", "label": "Pendiente", "color": Color("#9a917f") },
	{ "id": "done", "label": "Hecho", "color": Color("#6fbf94") },
]

var config = null
var milestones: Array = []
var tasks: Array = []
var warnings: Array = []
## Documentos: [{ alias, path, sections: [{ id, title, … }] }] (del hub, o de compass_reader.read_docs sin hub).
var docs: Array = []


func load_from(data: Dictionary) -> void:
	config = data.get("config")
	milestones = data.get("milestones", [])
	tasks = data.get("tasks", [])
	warnings = data.get("warnings", [])
	docs = data.get("docs", [])


func project_name() -> String:
	return config.get("project", "") if config is Dictionary else ""


func port() -> int:
	return int(config.get("port", 4711)) if config is Dictionary else 4711


func milestone(id: String):
	for m in milestones:
		if m.id == id:
			return m
	return null


func task(id: String):
	for t in tasks:
		if t.id == id:
			return t
	return null


## Tareas del hito, ordenadas por order y después code (orden natural, como la CLI).
func tasks_of(milestone_id: String) -> Array:
	var out := tasks.filter(func(t): return t.milestone == milestone_id)
	out.sort_custom(func(a, b):
		var oa := _num(a.get("order"))
		var ob := _num(b.get("order"))
		if oa != ob:
			return oa < ob
		return str(a.get("code", "")).naturalnocasecmp_to(str(b.get("code", ""))) < 0)
	return out


## [hechas, total] del hito.
func progress(milestone_id: String) -> Array:
	var ts := tasks_of(milestone_id)
	return [ts.filter(func(t): return t.status == "done").size(), ts.size()]


## El primer hito (por order) que tiene tareas sin terminar; si no hay, el primero.
func default_milestone() -> String:
	for m in milestones:
		var p := progress(m.id)
		if p[1] > 0 and p[0] < p[1]:
			return m.id
	return milestones[0].id if milestones.size() > 0 else ""


## Aplica un documento del hub (o lo quita si doc es null). Devuelve si cambió algo.
func apply(collection: String, id: String, doc) -> bool:
	var list: Array = milestones if collection == "milestones" else tasks
	var i := -1
	for j in list.size():
		if list[j].id == id:
			i = j
	if doc == null:
		if i < 0:
			return false
		list.remove_at(i)
	elif i >= 0:
		list[i] = doc
	else:
		list.append(doc)
	if collection == "milestones":
		list.sort_custom(func(a, b): return _num(a.get("order")) < _num(b.get("order")))
	# Un archivo que se corrigió deja de estar en los avisos.
	var path := "compass/%s/%s.json" % [collection, id]
	warnings = warnings.filter(func(w): return w.path != path)
	return true


## Un aviso del hub (un archivo que pasó a inválido): reemplaza el del mismo archivo y lo saca de la lista.
func warn(w: Dictionary) -> void:
	warnings = warnings.filter(func(x): return x.path != w.get("path"))
	warnings.append({ "code": w.get("code", ""), "path": w.get("path", ""), "message": w.get("message", "") })
	var parts := str(w.get("path", "")).split("/")
	if parts.size() == 3 and parts[0] == "compass" and w.get("code") != "unknown_milestone":
		var list: Array = milestones if parts[1] == "milestones" else tasks
		var id := parts[2].get_basename()
		for j in list.size():
			if list[j].id == id:
				list.remove_at(j)
				break


## Documento por alias o por ruta (las refs usan la ruta; los enlaces [[alias#id]], el alias).
func doc(key: String):
	for d in docs:
		if d.alias == key:
			return d
	for d in docs:
		if d.path == key:
			return d
	return null


func section(d, id: String):
	if d == null:
		return null
	for s in d.sections:
		if s.id == id:
			return s
	return null


static func steps(t: Dictionary) -> Array:
	var cl = t.get("checklist", [])
	cl = cl if cl is Array else []
	return [cl.filter(func(c): return c is Dictionary and c.get("done", false)).size(), cl.size()]


static func _num(v) -> float:
	return float(v) if typeof(v) in [TYPE_INT, TYPE_FLOAT] else 0.0
