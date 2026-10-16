@tool
extends EditorDebuggerPlugin
## Captura del juego que corre desde el editor (21.4), con el mismo pedido que usa la pestaña Game de Godot: el
## editor manda `scene:rq_screenshot [id]` por el depurador y el juego guarda su ventana en un PNG temporal y contesta
## `game_view:get_screenshot [id, ancho, alto, ruta]`. No hace falta nada del lado del juego.
## La respuesta les llega a todos los plugins que capturan "game_view" (también al de Godot, que ignora los ids que no
## pidió): los de acá empiezan bien arriba para no cruzarse con los suyos, que cuentan desde 0.

const FIRST_ID := 1 << 40

var _next := FIRST_ID
## id pedido → ruta del PNG ("" mientras no contesta).
var _paths := {}


func _has_capture(capture: String) -> bool:
	return capture == "game_view"


func _capture(message: String, data: Array, _session_id: int) -> bool:
	if message != "game_view:get_screenshot" or data.size() != 4 or int(data[0]) < FIRST_ID:
		return false
	if _paths.has(int(data[0])):
		_paths[int(data[0])] = str(data[3])
	else:
		# Llegó después del tiempo de espera: nadie la va a leer.
		DirAccess.remove_absolute(str(data[3]))
	return true


## ¿Hay un juego corriendo desde el editor, con el depurador conectado?
func running() -> bool:
	return _session() != null


func _session() -> EditorDebuggerSession:
	for s in get_sessions():
		if s.is_active():
			return s
	return null


## La ventana del juego, o null si no corre o no contesta a tiempo (por ejemplo, frenado en un breakpoint).
func game_image(timeout := 3.0) -> Image:
	var session := _session()
	if session == null:
		return null
	var id := _next
	_next += 1
	_paths[id] = ""
	session.send_message("scene:rq_screenshot", [id])
	var tree := Engine.get_main_loop() as SceneTree
	var t0 := Time.get_ticks_msec()
	while _paths[id] == "" and Time.get_ticks_msec() - t0 < timeout * 1000:
		await tree.process_frame
	var path: String = _paths[id]
	_paths.erase(id)
	if path == "" or not FileAccess.file_exists(path):
		return null
	var img := Image.load_from_file(path)
	DirAccess.remove_absolute(path)
	return img
