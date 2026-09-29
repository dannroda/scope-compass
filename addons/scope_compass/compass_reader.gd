@tool
extends RefCounted
## Lee compass/ desde disco en solo lectura (spec §11.1, nivel 1): el dock sin hub.
## Un archivo que no se puede leer va a `warnings` y no se carga, igual que en el hub.

const STATUSES := ["todo", "doing", "review", "done"]


## Devuelve { config, milestones: Array[Dictionary], tasks: Array[Dictionary], warnings: Array[Dictionary] }.
## Cada documento lleva su "id" (el nombre del archivo), como en la API del hub.
static func read(project_root: String) -> Dictionary:
	var compass := project_root.path_join("compass")
	var out := { "config": null, "milestones": [], "tasks": [], "warnings": [] }
	var cfg = _read_doc(compass.path_join("config.json"), "config", out.warnings)
	if cfg != null:
		out.config = cfg
	for collection in ["milestones", "tasks"]:
		var dir := compass.path_join(collection)
		for file in _json_files(dir):
			var doc = _read_doc(dir.path_join(file), collection, out.warnings)
			if doc == null:
				continue
			doc["id"] = file.get_basename()
			out[collection].append(doc)
	out.milestones.sort_custom(func(a, b): return _num(a.get("order")) < _num(b.get("order")))
	return out


static func _json_files(dir: String) -> PackedStringArray:
	var files := PackedStringArray()
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".json") and not f.begins_with("."):
			files.append(f)
	files.sort()
	return files


static func _read_doc(path: String, kind: String, warnings: Array):
	var rel := "compass/" + path.get_base_dir().get_file() + "/" + path.get_file()
	if kind == "config":
		rel = "compass/config.json"
	if not FileAccess.file_exists(path):
		warnings.append({ "code": "missing_config", "path": rel, "message": "falta" })
		return null
	var text := FileAccess.get_file_as_string(path)
	for line in text.split("\n"):
		if line.begins_with("<<<<<<<") or line.begins_with("=======") or line.begins_with(">>>>>>>"):
			warnings.append({ "code": "conflict_markers", "path": rel, "message": "conflicto de git sin resolver" })
			return null
	var json := JSON.new()
	if json.parse(text) != OK or typeof(json.data) != TYPE_DICTIONARY:
		warnings.append({ "code": "invalid_json", "path": rel, "message": "JSON inválido" })
		return null
	var doc: Dictionary = json.data
	var problem := _check(doc, kind)
	if problem != "":
		warnings.append({ "code": "invalid_schema", "path": rel, "message": problem })
		return null
	return doc


## Lo mínimo para mostrar el documento. La validación completa (JSON Schema) es del hub y la CLI.
static func _check(doc: Dictionary, kind: String) -> String:
	match kind:
		"config":
			if typeof(doc.get("project")) != TYPE_STRING:
				return "falta project"
		"milestones":
			for k in ["code", "title"]:
				if typeof(doc.get(k)) != TYPE_STRING:
					return "falta " + k
		"tasks":
			for k in ["milestone", "title"]:
				if typeof(doc.get(k)) != TYPE_STRING:
					return "falta " + k
			if not STATUSES.has(doc.get("status")):
				return "status inválido"
			if doc.has("checklist") and typeof(doc.checklist) != TYPE_ARRAY:
				return "checklist no es una lista"
	return ""


static func _num(v) -> float:
	return float(v) if typeof(v) in [TYPE_INT, TYPE_FLOAT] else 0.0
