@tool
extends Node
## Cliente del hub para el dock (spec §11.1, nivel 2): HTTP para cargar y escribir, WebSocket para los
## cambios en vivo (§5.5). Si el hub no está o se cae, el dock vuelve a leer compass/ en solo lectura.

signal went_online
signal went_offline
signal event_received(msg: Dictionary)

const HOST := "127.0.0.1"

var project_root := ""
## Puerto de config.json; `port` es el que se usa (puede ser otro, si el registro dice que el hub está ahí).
var config_port := 4711
var port := 4711
## Ruta delante de la API: "" en un hub suelto, "/p/<clave>" si el proyecto lo sirve el Inicio (D29).
var base := ""
var online := false
## Solo para tests: no aplicar los eventos del WebSocket (simula una vista desactualizada).
var ignore_events := false

var _ws: WebSocketPeer = null
var _connecting := false
## Por qué falló la última búsqueda del hub (para mostrarlo en el aviso del dock).
var last_error := ""
## Versión que informó el hub conectado (/api/health).
var hub_version := ""


## JSON de algo que no controla el dock (otro programa en el puerto, un registro a medio escribir): null si no es
## JSON, sin el error que JSON.parse_string imprime en la consola del editor cada vez (19.10).
static func parse_json(text: String):
	var j := JSON.new()
	return j.data if j.parse(text) == OK else null


func base_url() -> String:
	return "http://%s:%d%s" % [HOST, port, base]


## ¿Hay un hub de este mismo proyecto? Primero en el puerto de la config y, si no, donde diga el registro de
## hubs (lanzado con otro --port). Si lo hay, abre el WebSocket (el hello dispara la carga).
func detect() -> bool:
	if _connecting or online:
		return online
	_connecting = true
	# Primero lo que dice el registro (un hub suelto o el Inicio con su base), después el puerto de la config.
	var targets := registry_targets()
	if not targets.any(func(t): return t[0] == config_port and t[1] == ""):
		targets.append([config_port, ""])
	var first_error := ""
	for t in targets:
		port = t[0]
		base = t[1]
		if await _probe():
			return true
		if first_error == "":
			first_error = last_error
	port = config_port
	base = ""
	last_error = first_error
	_connecting = false
	return false


func _probe() -> bool:
	var r := await request("GET", "/api/health", null, [], 0.5)
	var ok := false
	if r.code == 0:
		last_error = "no responde"
	elif not (r.json is Dictionary and r.json.get("name") == "scope-compass"):
		last_error = "responde otro programa, HTTP %d" % r.code
	elif not _same_path(str(r.json.get("project", "")), project_root):
		last_error = "es el hub de otro proyecto: %s" % r.json.get("project", "")
	else:
		ok = true
		last_error = ""
		hub_version = str(r.json.get("version", ""))
	if ok:
		_ws = WebSocketPeer.new()
		if _ws.connect_to_url("ws://%s:%d%s/ws" % [HOST, port, base]) != OK:
			_ws = null
			ok = false
			last_error = "no se pudo abrir el WebSocket"
		else:
			_connecting = false
	return ok


## Dónde está el hub de este proyecto según el registro ($XDG_RUNTIME_DIR/scope-compass/hubs/*.json): pares
## [puerto, base]. Un hub suelto tiene base ""; un proyecto que sirve el Inicio, "/p/<clave>" (D29).
func registry_targets() -> Array:
	var out := []
	for h in _registry():
		if _same_path(str(h.get("project", "")), project_root) and h.get("port") != null:
			out.append([int(h.port), str(h.get("base", ""))])
	return out


## Puertos de los hubs de este proyecto (sin la base).
func registry_ports() -> Array:
	return registry_targets().map(func(t): return t[0])


## El puerto del Inicio según el registro (kind "home"), o -1. No se puede saber desde Godot si el proceso sigue
## vivo (is_process_running es solo para hijos): si la entrada quedó vieja, el pedido al Inicio falla y el dock
## levanta su propio hub.
func home_port() -> int:
	for h in _registry():
		if h.get("kind", "") == "home" and h.get("port") != null:
			return int(h.port)
	return -1


func _registry() -> Array:
	var dir := registry_dir()
	var out := []
	# El registro lo crea el primer hub que arranca: hasta entonces no existe.
	if not DirAccess.dir_exists_absolute(dir):
		return out
	for f in DirAccess.get_files_at(dir):
		if not f.ends_with(".json"):
			continue
		var h = parse_json(FileAccess.get_file_as_string(dir.path_join(f)))
		if h is Dictionary:
			out.append(h)
	return out


static func registry_dir() -> String:
	var custom := OS.get_environment("SCOMPASS_REGISTRY")
	if custom != "":
		return custom.path_join("hubs")
	# En Windows, %TEMP%\scope-compass\hubs, la misma que usa Node (os.tmpdir() mira TEMP antes que TMP).
	if OS.get_name() == "Windows":
		var tmp := OS.get_environment("TEMP")
		return (tmp if tmp != "" else OS.get_temp_dir()).replace("\\", "/").path_join("scope-compass/hubs")
	var runtime := OS.get_environment("XDG_RUNTIME_DIR")
	if runtime != "":
		return runtime.path_join("scope-compass/hubs")
	var out := []
	OS.execute("id", ["-u"], out)
	var uid := str(out[0]).strip_edges() if out.size() else ""
	return OS.get_temp_dir().path_join("scope-compass-%s/hubs" % uid)


func _process(_delta: float) -> void:
	if _ws == null:
		return
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not online:
				online = true
				went_online.emit()
			while _ws.get_available_packet_count() > 0:
				var msg = parse_json(_ws.get_packet().get_string_from_utf8())
				if msg is Dictionary and not (ignore_events and msg.get("type") != "hello"):
					event_received.emit(msg)
		WebSocketPeer.STATE_CLOSED:
			_ws = null
			if online:
				online = false
				went_offline.emit()


## Descarta un intento de conexión a medias (lo usa "Reintentar").
func reset() -> void:
	_connecting = false
	if _ws and _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		_ws.close()
		_ws = null


func close() -> void:
	if _ws:
		_ws.close()
	_ws = null
	online = false


## Una request al hub. Devuelve { code, json } (code 0 si no hubo respuesta).
func request(method: String, path: String, body = null, headers: Array = [], timeout := 5.0) -> Dictionary:
	return await request_url(method, base_url() + path, body, headers, timeout)


## Una request a cualquier URL (el Inicio, para activar el proyecto). Misma respuesta que request().
func request_url(method: String, url: String, body = null, headers: Array = [], timeout := 5.0) -> Dictionary:
	var http := HTTPRequest.new()
	http.timeout = timeout
	add_child(http)
	var h := PackedStringArray(headers)
	var data := ""
	if body != null:
		h.append("Content-Type: application/json")
		data = JSON.stringify(body)
	var methods := { "GET": HTTPClient.METHOD_GET, "POST": HTTPClient.METHOD_POST, "PUT": HTTPClient.METHOD_PUT,
		"PATCH": HTTPClient.METHOD_PATCH, "DELETE": HTTPClient.METHOD_DELETE }
	if http.request(url, h, methods[method], data) != OK:
		http.queue_free()
		return { "code": 0, "json": null }
	var res: Array = await http.request_completed
	http.queue_free()
	var text := (res[3] as PackedByteArray).get_string_from_utf8()
	return { "code": res[1] if res[0] == HTTPRequest.RESULT_SUCCESS else 0, "json": parse_json(text) if text != "" else null }


## Carga completa: { config, milestones, tasks, warnings } con la forma de compass_reader.read().
func load_all():
	var cfg := await request("GET", "/api/config")
	var ms := await request("GET", "/api/milestones")
	var ts := await request("GET", "/api/tasks")
	if cfg.code != 200 or ms.code != 200 or ts.code != 200:
		return null
	var docs := await request("GET", "/api/docs")
	return { "config": cfg.json, "milestones": ms.json.milestones, "tasks": ts.json.tasks,
		"warnings": ms.json.warnings + ts.json.warnings, "docs": docs.json.docs if docs.code == 200 else [] }


## El registro guarda la ruta como la da Node: en Windows, con "\\" y la letra de la unidad en mayúscula. En
## Windows las rutas no distinguen mayúsculas.
func _same_path(a: String, b: String) -> bool:
	var norm := func(p: String) -> String:
		var s := p.replace("\\", "/").simplify_path().trim_suffix("/")
		return s.to_lower() if OS.get_name() == "Windows" else s
	return norm.call(a) == norm.call(b)
