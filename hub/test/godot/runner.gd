extends SceneTree
## Corre los tests de Godot del dock: godot --headless --path <repo> --script res://hub/test/godot/runner.gd -- <caso> <args…>
## Imprime "OK <caso>" o "FAIL <caso>: <motivo>" y sale con 0 o 1.

const DockView := preload("res://addons/scope_compass/dock_view.gd")

var _failed := false


func _initialize() -> void:
	await process_frame # el árbol listo antes de agregar nodos que hacen requests
	var args := OS.get_cmdline_user_args()
	var case_name: String = args[0] if args.size() > 0 else ""
	var fn := "test_" + case_name
	if not has_method(fn):
		_fail(case_name, "caso desconocido")
	else:
		await call(fn, args.slice(1))
		if not _failed:
			print("OK ", case_name)
	quit(1 if _failed else 0)


func _fail(case_name: String, why: String) -> void:
	_failed = true
	printerr("FAIL ", case_name, ": ", why)


func _check(case_name: String, cond: bool, why: String) -> bool:
	if not cond:
		_fail(case_name, why)
	return cond


func _view(root_dir: String) -> DockView:
	var v := DockView.new()
	get_root().add_child(v)
	await v.setup(root_dir)
	await process_frame
	return v


# Sin hub: muestra las tareas del hito por defecto agrupadas por estado, en solo lectura.
func test_offline(a: Array) -> void:
	var v := await _view(a[0])
	var c := "offline"
	if not _check(c, v.banner.visible, "falta el aviso de solo lectura"): return
	if not _check(c, v.banner_title.text == "No hay hub en 127.0.0.1:4711", "título del aviso: " + v.banner_title.text): return
	if not _check(c, v.current_milestone == a[1], "hito por defecto %s, esperado %s" % [v.current_milestone, a[1]]): return
	var listed := v.listed()
	if not _check(c, JSON.stringify(listed) == a[2], "tareas listadas %s, esperado %s" % [JSON.stringify(listed), a[2]]): return
	if not _check(c, v.footer_label.text == "Sin hub · solo lectura", "pie: " + v.footer_label.text): return
	# Elegir otra tarea muestra su detalle, con el estado deshabilitado.
	v.tree.get_root().get_child(0).get_child(0).select(0)
	await process_frame
	if not _check(c, v.detail.visible and v.status_select.disabled, "detalle visible y en solo lectura"): return
	if not _check(c, v.steps_box.get_child_count() > 0 and v.steps_box.get_child(0).disabled, "pasos en solo lectura"): return


# Elegir un hito lo recuerda (preferencia del proyecto) y cambia la lista.
func test_pick_milestone(a: Array) -> void:
	var saved := {}
	var v := DockView.new()
	v.set_pref = func(k, val): saved[k] = val
	get_root().add_child(v)
	await v.setup(a[0])
	var idx := -1
	for i in v.milestone_select.item_count:
		if v.milestone_select.get_item_metadata(i) == a[1]:
			idx = i
	v.milestone_select.select(idx)
	v.milestone_select.item_selected.emit(idx)
	await process_frame
	var c := "pick_milestone"
	if not _check(c, saved.get("milestone") == a[1], "no se guardó la preferencia: %s" % saved): return
	if not _check(c, JSON.stringify(v.listed()) == a[2], "tareas listadas %s" % JSON.stringify(v.listed())): return


# Archivos inválidos: se avisan y no se listan; una edición a mano se ve al recargar.
func test_invalid_and_reload(a: Array) -> void:
	var v := await _view(a[0])
	var c := "invalid_and_reload"
	if not _check(c, v.warnings_label.visible and v.warnings_label.text.contains("compass/tasks/m1-02.json"), "aviso: " + v.warnings_label.text): return
	if not _check(c, not JSON.stringify(v.listed()).contains("m1-02"), "m1-02 no debería listarse"): return
	var f := FileAccess.open(a[0].path_join("compass/tasks/m1-02.json"), FileAccess.WRITE)
	f.store_string(a[1])
	f.close()
	v.reload()
	if not _check(c, not v.warnings_label.visible, "el aviso tendría que irse"): return
	if not _check(c, JSON.stringify(v.listed()).contains("doing:m1-02"), "m1-02 en curso: " + JSON.stringify(v.listed())): return


# El pie cuenta los archivos de compass/ sin commitear (git status).
func test_uncommitted(a: Array) -> void:
	var v := await _view(a[0])
	var c := "uncommitted"
	if not _check(c, v.footer_right.text == "compass: %s sin commitear" % a[1], "pie: " + v.footer_right.text): return


# --- Con hub ----------------------------------------------------------------------------------

## Espera hasta que cond() sea verdadera o pasen `secs` segundos.
func _until(cond: Callable, secs := 5.0) -> bool:
	var t0 := Time.get_ticks_msec()
	while not cond.call():
		if Time.get_ticks_msec() - t0 > secs * 1000:
			return false
		await process_frame
	return true


## Espera a que Node cree el archivo marcador (coordinación con el test).
func _wait_file(path: String, secs := 10.0) -> bool:
	return await _until(func(): return FileAccess.file_exists(path), secs)


func _online_view(root_dir: String, c: String):
	var v := await _view(root_dir)
	if not _check(c, await _until(func(): return v.online and not v._loading and v.board.tasks.size() > 0 and v.board.tasks[0].has("etag")), "no se conectó al hub"):
		return null
	if not _check(c, not v.banner.visible and v.new_row.visible, "sigue en solo lectura"):
		return null
	return v


func _select(v, id: String) -> void:
	v.selected_task = id
	v._render()


func _pick_status(v, status: String) -> void:
	for i in v.status_select.item_count:
		if v.status_select.get_item_metadata(i) == status:
			v.status_select.select(i)
			v.status_select.item_selected.emit(i)


# Mover desde el dock: se escribe por la API.
func test_online_move(a: Array) -> void:
	var c := "online_move"
	var v = await _online_view(a[0], c)
	if v == null: return
	print("READY")
	_select(v, a[1])
	if not _check(c, not v.status_select.disabled, "estado deshabilitado con hub"): return
	_pick_status(v, a[2])
	if not _check(c, await _until(func(): return v.board.task(a[1]).status == a[2] and v._queues.is_empty()), "no se aplicó el cambio"): return


# Un cambio hecho afuera (la UI web, la CLI) llega al dock por el WebSocket.
func test_online_receive(a: Array) -> void:
	var c := "online_receive"
	var v = await _online_view(a[0], c)
	if v == null: return
	v.current_milestone = v.board.task(a[1]).milestone
	v._render()
	print("READY")
	var t0 := Time.get_ticks_msec()
	if not _check(c, await _until(func(): return v.board.task(a[1]).status == a[2] and v.listed().has(a[2] + ":" + a[1]), 3.0), "no llegó el cambio"): return
	print("ELAPSED ", Time.get_ticks_msec() - t0)


# Tildar varios pasos seguidos: se guardan todos, sin 409.
func test_toggle_steps(a: Array) -> void:
	var c := "toggle_steps"
	var v = await _online_view(a[0], c)
	if v == null: return
	_select(v, a[1])
	var n: int = v.steps_box.get_child_count()
	if not _check(c, n >= 3, "pocos pasos"): return
	for i in n:
		var cb: CheckBox = v.steps_box.get_child(i)
		cb.button_pressed = not cb.button_pressed
	if not _check(c, await _until(func(): return v._queues.is_empty()), "la fila no terminó"): return
	if not _check(c, not v.notice.visible, "aviso inesperado: " + v.notice.text): return


# 409: el dock no se enteró del cambio (eventos ignorados); al escribir, toma la versión actual y avisa.
func test_conflict(a: Array) -> void:
	var c := "conflict"
	var v = await _online_view(a[0], c)
	if v == null: return
	v.client.ignore_events = true
	_select(v, a[1])
	print("READY")
	if not _check(c, await _wait_file(a[0].path_join(".go")), "Node no avisó"): return
	_pick_status(v, a[2])
	if not _check(c, await _until(func(): return v.notice.visible), "no hubo aviso de conflicto"): return
	if not _check(c, v.notice.text.contains("cambió esta tarea"), "aviso: " + v.notice.text): return
	if not _check(c, v.board.task(a[1]).get("notes") == a[3], "no tomó la versión actual: %s" % v.board.task(a[1]).get("notes")): return


# Nueva tarea desde el dock, en el hito elegido.
func test_create(a: Array) -> void:
	var c := "create"
	var v = await _online_view(a[0], c)
	if v == null: return
	if not _check(c, v.new_row.visible, "falta la fila de nueva tarea"): return
	v.current_milestone = a[1]
	v.new_title.text = a[2]
	v.new_title.text_submitted.emit(a[2])
	if not _check(c, await _until(func(): return v.board.tasks.any(func(t): return t.title == a[2] and t.milestone == a[1])), "no se creó"): return
	var made = v.board.tasks.filter(func(t): return t.title == a[2])[0]
	print("CREATED ", made.id)


# El hub se cae: solo lectura; vuelve: edición otra vez, sin reiniciar el editor.
func test_reconnect(a: Array) -> void:
	var c := "reconnect"
	var v = await _online_view(a[0], c)
	if v == null: return
	print("READY")
	if not _check(c, await _until(func(): return not v.online, 5.0), "no detectó la caída"): return
	if not _check(c, v.banner.visible, "falta el aviso sin hub"): return
	print("STATE offline")
	if not _check(c, await _until(func(): return v.online and not v._loading, 10.0), "no se reconectó"): return
	if not _check(c, not v.banner.visible, "el aviso sigue visible"): return
	if not _check(c, v.board.task(a[1]).status == a[2], "no recargó lo que cambió mientras estaba caído"): return


# "Iniciar hub" levanta scompass serve y el dock pasa a edición; stop_hub lo cierra.
func test_start_hub(a: Array) -> void:
	var c := "start_hub"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	if not _check(c, not v.online, "ya había hub"): return
	if not _check(c, await v.start_hub(), "no arrancó: " + v.notice.text): return
	if not _check(c, await _until(func(): return v.online and not v._loading and not v.banner.visible), "no pasó a edición"): return
	var pid: int = v.hub_pid
	print("PID ", pid)
	v.stop_hub()
	if not _check(c, await _until(func(): return not OS.is_process_running(pid), 5.0), "el hub sigue corriendo"): return
	if not _check(c, await _until(func(): return not v.online, 5.0), "el dock sigue en línea"): return


# Sin scompass: avisa en lugar de fallar en silencio.
func test_start_hub_missing(a: Array) -> void:
	var c := "start_hub_missing"
	var v := await _view(a[0])
	v.scompass_setting = func(): return "/no/existe/scompass.js"
	v.project_root = "/no/existe"
	if not _check(c, v.scompass_command().is_empty() or v.scompass_command()[0] != "node", "encontró algo inesperado"): return


# Lanza el hub desde el dock y se queda esperando: Node mata a Godot con kill -9 (5.8).
func test_start_hub_and_hang(a: Array) -> void:
	var c := "start_hub_and_hang"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	if not _check(c, await v.start_hub(), "no arrancó: " + v.notice.text): return
	print("PID ", v.hub_pid)
	print("READY")
	await create_timer(30.0).timeout
	_fail(c, "nadie mató a Godot")


# Modo "mantener": el hub queda corriendo aunque el dock lo quiera cerrar (5.9).
func test_start_hub_keep(a: Array) -> void:
	var c := "start_hub_keep"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	v.keep_hub_setting = func(): return true
	if not _check(c, await v.start_hub(), "no arrancó: " + v.notice.text): return
	if not _check(c, v.hub_kept, "no quedó en modo mantener"): return
	var pid: int = v.hub_pid
	v.stop_hub() # lo que hace el plugin al cerrar el editor
	await create_timer(1.0).timeout
	if not _check(c, OS.is_process_running(pid), "el dock lo cerró igual"): return
	print("PID ", pid)


# --- Referencias a documentos (6.7) ---------------------------------------------------------------

func _refs_check(v, a: Array, c: String, online: bool) -> void:
	_select(v, a[1])
	var head = v.refs_box.get_child(1) if v.refs_box.get_child_count() > 1 else null
	if not _check(c, head is HBoxContainer and head.get_child(0).text.contains("Ventanas de ataque"), "no está la referencia"): return
	head.get_child(0).pressed.emit()
	await process_frame
	var box = v.refs_box.get_node_or_null("Section")
	if not _check(c, box is VBoxContainer, "no se desplegó la sección"): return
	var code_of = func():
		for ch in box.get_children():
			if ch is CodeEdit:
				return ch
		return null
	var text_of = func():
		var out := ""
		for ch in box.get_children():
			if ch is RichTextLabel:
				out += ch.get_parsed_text()
		return out
	if not _check(c, await _until(func(): return is_instance_valid(box) and text_of.call().contains("Las ventanas de golpe son datos") and code_of.call() != null, 5.0), "sin texto o sin snippet: " + text_of.call()): return
	var ce: CodeEdit = code_of.call()
	if not _check(c, ce.text == "class_name AttackData\nextends Resource", "código: " + ce.text): return
	if not _check(c, not ce.editable and ce.syntax_highlighter != null, "el CodeEdit tendría que ser de solo lectura y con resaltado"): return
	if not _check(c, not text_of.call().contains("class_name"), "el código no tendría que estar también en el texto"): return
	var broken := false
	for ch in v.refs_box.get_children():
		if ch is Label and ch.text.contains("Referencia rota: gdd.md#borrada"):
			broken = true
	_check(c, broken, "falta el aviso de la referencia rota")


func test_refs_online(a: Array) -> void:
	var v = await _online_view(a[0], "refs_online")
	if v == null: return
	await _refs_check(v, a, "refs_online", true)


func test_refs_offline(a: Array) -> void:
	var v := await _view(a[0])
	await _refs_check(v, a, "refs_offline", false)
