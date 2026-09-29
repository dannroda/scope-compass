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


func load_from(data: Dictionary) -> void:
	config = data.get("config")
	milestones = data.get("milestones", [])
	tasks = data.get("tasks", [])
	warnings = data.get("warnings", [])


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


static func steps(t: Dictionary) -> Array:
	var cl = t.get("checklist", [])
	cl = cl if cl is Array else []
	return [cl.filter(func(c): return c is Dictionary and c.get("done", false)).size(), cl.size()]


static func _num(v) -> float:
	return float(v) if typeof(v) in [TYPE_INT, TYPE_FLOAT] else 0.0
