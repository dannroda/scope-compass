@tool
extends RefCounted
## Estado del tablero en el dock: hitos, tareas y avisos, con el mismo orden que la CLI y la UI web.

const STATUSES := [
	{ "id": "doing", "label": "En curso", "color": Color("#7fb0dc") },
	{ "id": "review", "label": "Revisión", "color": Color("#e0a95a") },
	{ "id": "todo", "label": "Pendiente", "color": Color("#9a917f") },
	{ "id": "paused", "label": "Pausado", "color": Color("#a99bd1") },
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


## Sin mayúsculas ni tildes, como norm de hub/src/filters.js: "Diseño" encuentra "diseno".
static func norm(s: String) -> String:
	var out := s.to_lower()
	for pair in [["áàäâã", "a"], ["éèëê", "e"], ["íìïî", "i"], ["óòöôõ", "o"], ["úùüû", "u"], ["ñ", "n"], ["ç", "c"]]:
		for ch in pair[0]:
			out = out.replace(ch, pair[1])
	return out


## Las tareas de todos los hitos cuyo código, título o id tienen todas las palabras de q (21.5), como
## `scompass list --q`: en el orden de los hitos y, dentro de cada uno, como tasks_of.
func search(q: String) -> Array:
	var words := Array(norm(q).split(" ", false))
	var out := []
	for m in milestones:
		for t in tasks_of(m.id):
			var text := norm("%s %s %s" % [t.get("code", ""), t.get("title", ""), t.id])
			if words.all(func(w): return text.contains(w)):
				out.append(t)
	return out


## [hechas, total, en revisión] del hito. Las de Revisión cuentan como hechas (falta comprobarlas, como en la web).
func progress(milestone_id: String) -> Array:
	var ts := tasks_of(milestone_id)
	var review := ts.filter(func(t): return t.status == "review").size()
	return [ts.filter(func(t): return t.status == "done").size() + review, ts.size(), review]


## Terminado: tiene tareas y están todas en Hecho.
static func complete(p: Array) -> bool:
	return p[1] > 0 and p[0] == p[1] and p[2] == 0


## El primer hito (por order) que tiene tareas sin terminar; si no hay, el primero.
func default_milestone() -> String:
	for m in milestones:
		var p := progress(m.id)
		if p[1] > 0 and not complete(p):
			return m.id
	return milestones[0].id if milestones.size() > 0 else ""


# --- Vínculos entre tareas (misma lógica que hub/src/links.js) ---

static func links_of(t) -> Array:
	var l = t.get("links", []) if t is Dictionary else []
	return l if l is Array else []


## Vínculos de una tarea vistos desde ella: { blocks, blocked_by, related } con ids. Cada tarea guarda solo
## "blocks" (bloquea a) y "related"; el inverso se calcula acá.
func link_view(id: String) -> Dictionary:
	var out := { "blocks": [], "blocked_by": [], "related": [] }
	var add := func(list: Array, x: String): if x != id and not list.has(x): list.append(x)
	for l in links_of(task(id)):
		add.call(out.blocks if l.get("type") == "blocks" else out.related, str(l.get("task", "")))
	for t in tasks:
		for l in links_of(t):
			if str(l.get("task", "")) == id:
				add.call(out.blocked_by if l.get("type") == "blocks" else out.related, t.id)
	return out


## Tareas sin terminar que bloquean a esta (una tarea hecha no está bloqueada).
func open_blockers(id: String) -> Array:
	var me = task(id)
	if me == null or me.status == "done":
		return []
	return link_view(id).blocked_by.filter(func(b): var t = task(b); return t != null and not t.status in ["done", "review"])


## Tareas en Revisión que bloqueaban a esta: ya no la bloquean, pero se avisa (desbloqueada en revisión).
func review_blockers(id: String) -> Array:
	var me = task(id)
	if me == null or me.status == "done":
		return []
	return link_view(id).blocked_by.filter(func(b): var t = task(b); return t != null and t.status == "review")


## "5.2 Título" de una tarea, o su id si no existe.
func task_name(id: String) -> String:
	var t = task(id)
	if t == null:
		return id + " (no existe)"
	var code := str(t.get("code", ""))
	return ((code + " " if code != "" else "") + str(t.title)).replace("`", "")


## Aplica un documento del hub (o lo quita si doc es null). Devuelve si cambió algo.
func apply(collection: String, id: String, doc) -> bool:
	# Otras colecciones (las listas, D25) el dock no las muestra: no se mezclan con las tareas.
	if collection != "milestones" and collection != "tasks":
		return false
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


## Fecha límite (D26), como dueState de hub/src/dates.js: "overdue", "today", "later" o "" (sin fecha o hecha).
## Sin hora, vence al terminar el día. now: segundos Unix en hora local (los tests lo fijan).
static func due_state(t: Dictionary, now: float = -1.0) -> String:
	var due := str(t.get("due", ""))
	if due == "" or t.get("status", "") == "done":
		return ""
	var re := RegEx.create_from_string("^(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2}))?$")
	var m := re.search(due)
	if m == null:
		return ""
	if now < 0:
		now = Time.get_unix_time_from_system() + Time.get_time_zone_from_system().bias * 60
	var today := Time.get_datetime_string_from_unix_time(int(now)).substr(0, 10)
	var day := due.substr(0, 10)
	if day < today:
		return "overdue"
	if day > today:
		return "later"
	if m.get_string(4) != "":
		var at := Time.get_datetime_string_from_unix_time(int(now)).substr(11, 5)
		return "overdue" if due.substr(11, 5) < at else "today"
	return "today"


## "2026-10-10T17:30" → "10/10 17:30".
static func show_due(due: String) -> String:
	var out := "%s/%s" % [due.substr(8, 2), due.substr(5, 2)]
	return out + (" " + due.substr(11, 5) if due.length() > 10 else "")


## Cómo salió la prueba de la tarea (D40): { result?, note? }, vacío si no se probó.
static func playtest_of(t) -> Dictionary:
	var p = t.get("playtest") if t is Dictionary else null
	return p if p is Dictionary else {}


## El playtest de la tarea con un cambio (las reglas de hub/src/playtests.js y de la web): null o "" quita el campo,
## la nota va sin espacios de más; si no queda nada, null (se borra playtest).
static func next_playtest(cur, change: Dictionary):
	var out: Dictionary = cur.duplicate() if cur is Dictionary else {}
	for k in change:
		var v = change[k]
		if v == null or str(v).strip_edges() == "":
			out.erase(k)
		else:
			out[k] = str(v).strip_edges() if k == "note" else v
	return null if out.is_empty() else out


## Decisiones de la tarea (§31, D42). El estado se calcula como en hub/src/decisions.js: open (pregunta sin
## respuesta), pending (tomada sin consultar, sin revisar), revert (a revertir) o resolved.
static func decisions_of(t) -> Array:
	var d = t.get("decisions", []) if t is Dictionary else []
	return (d if d is Array else []).filter(func(x): return x is Dictionary)


static func decision_state(d: Dictionary) -> String:
	if d.get("asked", false):
		return "resolved" if str(d.get("reply", "")) != "" else "open"
	var review := str(d.get("review", ""))
	return "pending" if review == "" else "revert" if review == "revert" else "resolved"


## { open, pending, revert, resolved }: cuántas decisiones de la tarea hay en cada estado.
static func decision_counts(t) -> Dictionary:
	var n := { "open": 0, "pending": 0, "revert": 0, "resolved": 0 }
	for d in decisions_of(t):
		n[decision_state(d)] += 1
	return n


static func steps(t: Dictionary) -> Array:
	var cl = t.get("checklist", [])
	cl = cl if cl is Array else []
	return [cl.filter(func(c): return c is Dictionary and c.get("done", false)).size(), cl.size()]


static func _num(v) -> float:
	return float(v) if typeof(v) in [TYPE_INT, TYPE_FLOAT] else 0.0
