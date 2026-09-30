@tool
extends Node
## Cliente del hub para el dock (spec §11.1, nivel 2): HTTP para cargar y escribir, WebSocket para los
## cambios en vivo (§5.5). Si el hub no está o se cae, el dock vuelve a leer compass/ en solo lectura.

signal went_online
signal went_offline
signal event_received(msg: Dictionary)

const HOST := "127.0.0.1"

var project_root := ""
var port := 4711
var online := false
## Solo para tests: no aplicar los eventos del WebSocket (simula una vista desactualizada).
var ignore_events := false

var _ws: WebSocketPeer = null
var _connecting := false
## Por qué falló la última búsqueda del hub (para mostrarlo en el aviso del dock).
var last_error := ""


func base_url() -> String:
	return "http://%s:%d" % [HOST, port]


## ¿Hay un hub de este mismo proyecto? Si lo hay, abre el WebSocket (el hello dispara la carga).
func detect() -> bool:
	if _connecting or online:
		return online
	_connecting = true
	var r := await request("GET", "/api/health", null, [], 0.5)
	var ok := false
	if r.code == 0:
		last_error = "no responde"
	elif not (r.json is Dictionary and r.json.get("name") == "scope-compass"):
		last_error = "responde otro programa (HTTP %d)" % r.code
	elif not _same_path(str(r.json.get("project", "")), project_root):
		last_error = "es el hub de otro proyecto: %s" % r.json.get("project", "")
	else:
		ok = true
		last_error = ""
	if ok:
		_ws = WebSocketPeer.new()
		if _ws.connect_to_url("ws://%s:%d/ws" % [HOST, port]) != OK:
			_ws = null
			ok = false
			last_error = "no se pudo abrir el WebSocket"
	_connecting = false
	return ok


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
				var msg = JSON.parse_string(_ws.get_packet().get_string_from_utf8())
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
	if http.request(base_url() + path, h, methods[method], data) != OK:
		http.queue_free()
		return { "code": 0, "json": null }
	var res: Array = await http.request_completed
	http.queue_free()
	var text := (res[3] as PackedByteArray).get_string_from_utf8()
	return { "code": res[1] if res[0] == HTTPRequest.RESULT_SUCCESS else 0, "json": JSON.parse_string(text) if text != "" else null }


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


func _same_path(a: String, b: String) -> bool:
	return a.simplify_path().trim_suffix("/") == b.simplify_path().trim_suffix("/")
