@tool
extends RefCounted
## Lee compass/ desde disco en solo lectura (spec §11.1, nivel 1): el dock sin hub.
## Un archivo que no se puede leer va a `warnings` y no se carga, igual que en el hub.

const STATUSES := ["todo", "paused", "doing", "review", "done"]


## Devuelve { config, milestones, tasks, warnings, docs } (docs: ver read_docs).
## Cada documento lleva su "id" (el nombre del archivo), como en la API del hub.
static func read(project_root: String) -> Dictionary:
	var compass := project_root.path_join("compass")
	var out := { "config": null, "milestones": [], "tasks": [], "warnings": [], "docs": [] }
	# Proyecto sin compass/ (plugin recién instalado): tablero vacío con un aviso, sin errores en la consola.
	if not DirAccess.dir_exists_absolute(compass):
		out.warnings.append({ "code": "missing_compass", "path": "compass/", "message": "no existe" })
		return out
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
	out["docs"] = read_docs(project_root, out.config)
	return out


static func _json_files(dir: String) -> PackedStringArray:
	var files := PackedStringArray()
	if not DirAccess.dir_exists_absolute(dir):
		return files
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
			# Sin hub nadie valida el schema: una lista con otra forma (un JSON editado a mano) rompía el render (19.10).
			for k in ["checklist", "links", "refs", "images", "files", "tags", "decisions"]:
				var v = doc.get(k, [])
				if typeof(v) != TYPE_ARRAY:
					return k + " no es una lista"
				var want := TYPE_STRING if k in ["images", "files", "tags"] else TYPE_DICTIONARY
				for x in v:
					if typeof(x) != want:
						return "%s tiene un elemento con otra forma" % k
			if doc.has("playtest") and typeof(doc.playtest) != TYPE_DICTIONARY:
				return "playtest no es un objeto"
			for c in doc.get("checklist", []):
				if typeof(c.get("text")) != TYPE_STRING:
					return "un paso sin texto"
			for l in doc.get("links", []):
				if typeof(l.get("task")) != TYPE_STRING:
					return "un vínculo sin tarea"
			for r in doc.get("refs", []):
				if typeof(r.get("doc")) != TYPE_STRING:
					return "una referencia sin documento"
	return ""


static func _num(v) -> float:
	return float(v) if typeof(v) in [TYPE_INT, TYPE_FLOAT] else 0.0


## Documentos de config.json › docs, leídos sin hub (6.7): [{ alias, path, lines, sections: [{ id, title, level,
## start, end, explicit }] }]. Mismas reglas que docFiles y parseSections de hub/src/docs.js: un patrón
## (docs/**/*.md) toma los archivos que no están declarados aparte ni son el export markdown, con el alias
## "<alias>/<ruta desde la carpeta fija, sin .md>" (D33).
static func read_docs(project_root: String, config) -> Array:
	var out := []
	if not config is Dictionary:
		return out
	var entries: Array = config.get("docs", [])
	var taken := { str(config.get("export_md", "")): true }
	for entry in entries:
		if not str(entry.get("path", "")).contains("*"):
			taken[str(entry.get("path", ""))] = true
	for entry in entries:
		var alias := str(entry.get("alias", ""))
		var path := str(entry.get("path", ""))
		var files := [[alias, path]]
		if path.contains("*"):
			var base := path.substr(0, path.find("*"))
			base = base.substr(0, base.rfind("/") + 1)
			var found := PackedStringArray()
			_walk(project_root, base, RegEx.create_from_string("^" + _glob_regex(path) + "$"), found)
			found.sort()
			files = []
			for rel in found:
				if not taken.has(rel):
					files.append([alias + "/" + rel.substr(base.length()).trim_suffix(".md"), rel])
		for f in files:
			if not FileAccess.file_exists(project_root.path_join(f[1])):
				continue
			var lines := FileAccess.get_file_as_string(project_root.path_join(f[1])).split("\n")
			out.append({ "alias": f[0], "path": f[1], "lines": lines, "sections": parse_sections(lines) })
	return out


## Un patrón de glob como regex: "**/" cruza cero o más carpetas; "*" y "?" no cruzan "/".
static func _glob_regex(pattern: String) -> String:
	var re := ""
	var i := 0
	while i < pattern.length():
		if pattern.substr(i, 3) == "**/":
			re += "(?:.*/)?"
			i += 3
			continue
		if pattern.substr(i, 2) == "**":
			re += ".*"
			i += 2
			continue
		var c := pattern[i]
		if c == "*":
			re += "[^/]*"
		elif c == "?":
			re += "[^/]"
		elif "\\^$.|+()[]{}".contains(c):
			re += "\\" + c
		else:
			re += c
		i += 1
	return re


## Archivos debajo de rel (relativa al proyecto, terminada en "/" o vacía) que cumplen re. Como el glob del hub,
## no entra en carpetas ocultas (.git, .godot) ni en node_modules, y no toma archivos ocultos.
static func _walk(root: String, rel: String, re: RegEx, out: PackedStringArray) -> void:
	var dir := root.path_join(rel)
	if not DirAccess.dir_exists_absolute(dir):
		return
	for f in DirAccess.get_files_at(dir):
		if not f.begins_with(".") and re.search(rel + f) != null:
			out.append(rel + f)
	for d in DirAccess.get_directories_at(dir):
		if not d.begins_with(".") and d != "node_modules":
			_walk(root, rel + d + "/", re, out)


static func parse_sections(lines: PackedStringArray) -> Array:
	var heads := []
	var fence := ""
	var heading := RegEx.create_from_string("^(#{1,6})[ \\t]+(.+?)[ \\t#]*$")
	var id_line := RegEx.create_from_string("^<!--\\s*id:\\s*([a-z0-9][a-z0-9_-]*)\\s*-->\\s*$")
	for i in lines.size():
		var l := lines[i]
		var stripped := l.strip_edges(true, false)
		if stripped.begins_with("```") or stripped.begins_with("~~~"):
			var f := stripped.substr(0, 3)
			fence = f if fence == "" else ("" if f == fence else fence)
			continue
		if fence != "":
			continue
		var h := heading.search(l)
		if h == null:
			continue
		var m = id_line.search(lines[i + 1].strip_edges()) if i + 1 < lines.size() else null
		var title := h.get_string(2).strip_edges()
		heads.append({ "title": title, "level": h.get_string(1).length(), "start": i, "explicit": m != null,
			"id": m.get_string(1) if m != null else slugify(title) })
	for k in heads.size():
		var end := lines.size()
		for j in range(k + 1, heads.size()):
			if heads[j].level <= heads[k].level:
				end = heads[j].start
				break
		heads[k]["end"] = end
	return heads


## Slug aproximado (sin quitar tildes: GDScript no normaliza Unicode). Solo afecta a secciones sin id explícito.
static func slugify(title: String) -> String:
	var s := title.to_lower().replace("`", "")
	var out := ""
	for ch in s:
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
		elif ch == " " or ch == "-":
			out += "-"
	while out.contains("--"):
		out = out.replace("--", "-")
	return out.strip_edges().trim_prefix("-").trim_suffix("-")
