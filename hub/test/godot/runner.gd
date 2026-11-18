extends SceneTree
## Corre los tests de Godot del dock: godot --headless --path <repo> --script res://hub/test/godot/runner.gd -- <caso> <args…>
## Imprime "OK <caso>" o "FAIL <caso>: <motivo>" y sale con 0 o 1.

const DockView := preload("res://addons/scope_compass/dock_view.gd")
const Board := preload("res://addons/scope_compass/board.gd")

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
	if not _check(c, v.banner_title.text.begins_with("No hay hub en 127.0.0.1:4711"), "título del aviso: " + v.banner_title.text): return
	if not _check(c, v.current_milestone == a[1], "hito por defecto %s, esperado %s" % [v.current_milestone, a[1]]): return
	var listed := v.listed()
	if not _check(c, JSON.stringify(listed) == a[2], "tareas listadas %s, esperado %s" % [JSON.stringify(listed), a[2]]): return
	if not _check(c, v.footer_label.text == "Sin hub · solo lectura", "pie: " + v.footer_label.text): return
	# Elegir otra tarea muestra su detalle, con el estado deshabilitado.
	v.tree.get_root().get_child(0).get_child(0).select(0)
	await process_frame
	if not _check(c, v.detail.visible and v.detail.status_select.disabled, "detalle visible y en solo lectura"): return
	if not _check(c, v.detail.steps_box.get_child_count() > 0 and v.detail.step_checkbox(0).disabled, "pasos en solo lectura"): return


# Idioma (§45): con SCOMPASS_LANG=en el dock sale en inglés (el test lo lanza con esa variable).
func test_english(a: Array) -> void:
	var v := await _view(a[0])
	var c := "english"
	if not _check(c, v.banner_title.text.begins_with("No hub at 127.0.0.1:4711"), "título del aviso: " + v.banner_title.text): return
	if not _check(c, v.footer_label.text == "No hub · read-only", "pie: " + v.footer_label.text): return
	if not _check(c, v.detail.status_select.get_item_text(0) == "In progress", "estado: " + v.detail.status_select.get_item_text(0)): return
	if not _check(c, v.tasks_header.text.contains("Tasks · "), "cabecera de la lista: " + v.tasks_header.text): return
	if not _check(c, v.new_title.placeholder_text == "New task in this milestone", "caja de tarea nueva: " + v.new_title.placeholder_text): return
	if not _check(c, v.auto_translate_mode == Node.AUTO_TRANSLATE_MODE_DISABLED, "el catálogo del editor no tiene que traducir el dock"): return


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
	for i in v.detail.status_select.item_count:
		if v.detail.status_select.get_item_metadata(i) == status:
			v.detail.status_select.select(i)
			v.detail.status_select.item_selected.emit(i)


# Mover desde el dock: se escribe por la API.
func test_online_move(a: Array) -> void:
	var c := "online_move"
	var v = await _online_view(a[0], c)
	if v == null: return
	print("READY")
	_select(v, a[1])
	if not _check(c, not v.detail.status_select.disabled, "estado deshabilitado con hub"): return
	_pick_status(v, a[2])
	if not _check(c, await _until(func(): return v.board.task(a[1]).status == a[2] and v._queues.is_empty()), "no se aplicó el cambio"): return


# Un cambio hecho afuera (la UI web, la CLI) llega al dock por el WebSocket.
# Hub de otra versión que el addon: aviso en el dock; con la misma, nada.
# §39: con el hub del mismo protocolo no hay aviso, aunque las versiones difieran.
func test_protocol_ok(a: Array) -> void:
	var c := "protocol_ok"
	var v = await _online_view(a[0], c)
	if v == null: return
	if not _check(c, v.client.mismatch_version == "" and not v.compat_row.visible, "avisa con el mismo protocolo"): return
	v.client.hub_version = "9.9.9"
	v._render()
	if not _check(c, not v.compat_row.visible, "avisa por la versión con el mismo protocolo"): return


# §39: un hub de otro protocolo (o anterior, sin protocol) no se usa: solo lectura, y el aviso ofrece el binario.
func test_protocol_mismatch(a: Array) -> void:
	var c := "protocol_mismatch"
	var v := await _view(a[0])
	await _until(func(): return v.client.mismatch_version != "", 3.0)
	if not _check(c, not v.online and v.banner.visible, "se conectó a un hub de otro protocolo"): return
	if not _check(c, v.client.mismatch_version == "0.0.1" and v.client.mismatch_protocol == -1, "no anotó la versión: %s %d" % [v.client.mismatch_version, v.client.mismatch_protocol]): return
	if not _check(c, v.compat_row.visible and v.compat_label.text.contains("0.0.1") and v.compat_label.text.contains(v.addon_version()), "sin aviso: " + v.compat_label.text): return
	var url: String = v.compat_button.tooltip_text
	if not _check(c, url.begins_with("https://github.com/dannroda/scope-compass/releases/download/v%s/scompass-v%s-" % [v.addon_version(), v.addon_version()]), "URL del binario: " + url): return
	if not _check(c, v.banner_title.text.contains("otro protocolo"), "el banner no dice por qué: " + v.banner_title.text): return
	if not _check(c, v.board.tasks.size() > 0, "no leyó compass/ de disco"): return


# §39: el updater (copia del de godot-agent) sin red: versiones, elegir el zip del addon, URL del binario, extraer e
# instalar.
func test_updater(a: Array) -> void:
	var c := "updater"
	var U := preload("res://addons/scope_compass/addon_updater.gd")
	if not _check(c, U.compare_versions("v1.2.10", "1.2.9") == 1 and U.compare_versions("1.3.0-beta.1", "1.3.0") == -1 and U.compare_versions("1.0.0", "v1.0.0") == 0, "compare_versions"): return
	var asset := func(n: String): return { "name": n, "browser_download_url": "https://x/" + n }
	var list := [
		{ "tag_name": "v0.3.0", "prerelease": true, "assets": [asset.call("scope-compass-addon-v0.3.0.zip")] },
		{ "tag_name": "v0.2.5", "draft": true, "assets": [asset.call("scope-compass-addon-v0.2.5.zip")] },
		{ "tag_name": "v0.2.1", "html_url": "https://h/0.2.1", "body": "notas", "assets": [asset.call("scompass-v0.2.1-windows-x64.zip"), asset.call("scope-compass-addon-v0.2.1.zip")] },
		{ "tag_name": "v0.2.4", "assets": [asset.call("scompass-v0.2.4-linux-x64"), asset.call("scompass-v0.2.4-windows-x64.zip")] },
		{ "tag_name": "v0.1.0", "assets": [asset.call("scope-compass-addon-v0.1.0.zip")] },
	]
	var r: Dictionary = U.pick_release(list, false)
	if not _check(c, r.get("version") == "0.2.1" and r.zip_url == "https://x/scope-compass-addon-v0.2.1.zip" and r.notes == "notas", "pick_release: %s" % r): return
	if not _check(c, U.pick_release(list, true).get("version") == "0.3.0", "con prereleases"): return
	if not _check(c, U.binary_url("0.2.1", "Windows", "x86_64") == "https://github.com/dannroda/scope-compass/releases/download/v0.2.1/scompass-v0.2.1-windows-x64.exe", "binary_url Windows"): return
	if not _check(c, U.binary_url("0.2.1", "Linux", "arm64").ends_with("/v0.2.1/scompass-v0.2.1-linux-arm64"), "binary_url Linux"): return
	if not _check(c, U.is_dev_copy(), "el repo de Scope Compass no cuenta como copia de desarrollo"): return
	# Un zip como el del release: addons/scope_compass/ con plugin.cfg en 9.9.9.
	var tmp := OS.get_temp_dir().path_join("scompass-updater-%d" % Time.get_ticks_usec())
	DirAccess.make_dir_recursive_absolute(tmp)
	var zip_path := tmp.path_join("addon.zip")
	var zp := ZIPPacker.new()
	zp.open(zip_path)
	for f in [["addons/scope_compass/plugin.cfg", "[plugin]\nversion=\"9.9.9\"\n"], ["addons/scope_compass/nuevo.gd", "extends Node\n"], ["otro/fuera.txt", "x"]]:
		zp.start_file(f[0])
		zp.write_file(f[1].to_utf8_buffer())
		zp.close_file()
	zp.close()
	var bad: Dictionary = U.extract(zip_path, tmp.path_join("x1"), "9.9.8")
	if not _check(c, not bad.ok and bad.error.contains("9.9.9"), "aceptó un zip de otra versión: %s" % bad): return
	var staged: Dictionary = U.extract(zip_path, tmp.path_join("x2"), "9.9.9")
	if not _check(c, staged.ok and FileAccess.file_exists(staged.dir.path_join("nuevo.gd")) and not FileAccess.file_exists(staged.dir.path_join("fuera.txt")), "extract: %s" % staged): return
	# Instalar sobre una copia vieja: lo que ya no viene se borra (si es del addon); lo que agregó el usuario queda.
	var target := tmp.path_join("addon")
	DirAccess.make_dir_recursive_absolute(target)
	for f in ["plugin.cfg", "viejo.gd", "mio.json"]:
		FileAccess.open(target.path_join(f), FileAccess.WRITE).store_string("viejo")
	var inst: Dictionary = U.install(staged.dir, target, tmp.path_join("backup"))
	if not _check(c, inst.ok and FileAccess.file_exists(target.path_join("nuevo.gd")) and not FileAccess.file_exists(target.path_join("viejo.gd")) and FileAccess.file_exists(target.path_join("mio.json")), "install: %s" % inst): return
	if not _check(c, FileAccess.get_file_as_string(target.path_join("plugin.cfg")).contains("9.9.9"), "no pisó plugin.cfg"): return
	_rm(tmp)


func _rm(path: String) -> void:
	for f in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(f))
	for d in DirAccess.get_directories_at(path):
		_rm(path.path_join(d))
	DirAccess.remove_absolute(path)


# §39: el aviso de una versión nueva del addon: Después la recuerda; en el repo (copia de desarrollo) no busca.
func test_addon_update(a: Array) -> void:
	var c := "addon_update"
	var prefs := {}
	var v := DockView.new()
	v.get_pref = func(k: String, d): return prefs.get(k, d)
	v.set_pref = func(k: String, val): prefs[k] = val
	get_root().add_child(v)
	await v.setup(a[0])
	if not _check(c, not v.addon_update_row.visible, "avisa sin release"): return
	if not _check(c, (await v.check_addon_update(true)).contains("desarrollo"), "buscó en una copia de desarrollo"): return
	v.show_addon_release({ "version": "9.9.9", "html_url": "https://h" })
	if not _check(c, v.addon_update_row.visible and v.addon_update_label.text.contains("9.9.9") and v.addon_update_label.text.contains(v.addon_version()), "sin aviso: " + v.addon_update_label.text): return
	v.dismiss_addon_update()
	if not _check(c, not v.addon_update_row.visible and prefs.get("update_dismissed") == "9.9.9", "Después no se recordó: %s" % prefs): return
	# Una pre-release (canal beta, D62) se marca como tal.
	v.show_addon_release({ "version": "9.9.10", "html_url": "https://h", "prerelease": true })
	if not _check(c, v.addon_update_label.text.contains("9.9.10 (beta)"), "sin (beta): " + v.addon_update_label.text): return
	if not _check(c, v.update_channel_setting.call() == "stable", "el canal por defecto no es stable"): return


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
	var n: int = v.detail.steps_box.get_child_count()
	if not _check(c, n >= 3, "pocos pasos"): return
	for i in n:
		var cb: CheckBox = v.detail.step_checkbox(i)
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
	var pid: int = v.hub.pid
	print("PID ", pid)
	v.stop_hub()
	if not _check(c, await _until(func(): return not OS.is_process_running(pid), 5.0), "el hub sigue corriendo"): return
	if not _check(c, await _until(func(): return not v.online, 5.0), "el dock sigue en línea"): return


# Con el Inicio corriendo, el dock no levanta un proceso ni espera a "Iniciar hub": al abrirse le pide al Inicio que
# sirva el proyecto en /p/<clave> (D29, 21.1).
func test_start_hub_home(a: Array) -> void:
	var c := "start_hub_home"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	if not _check(c, v.client.home_port() > 0, "no ve el Inicio en el registro"): return
	if not _check(c, await _until(func(): return v.online and not v._loading and not v.banner.visible), "no se conectó solo al Inicio: " + v.banner_title.text): return
	if not _check(c, await v.start_hub(), "Iniciar hub con el Inicio ya conectado: " + v.notice.text): return
	if not _check(c, v.client.base.begins_with("/p/") and v.client.port == v.client.home_port(), "base %s puerto %d" % [v.client.base, v.client.port]): return
	if not _check(c, v.hub.pid == -1, "levantó un proceso propio: %d" % v.hub.pid): return
	# Una escritura del dock pasa por el Inicio.
	var t = v.board.tasks[0]
	var r = await v.client.request("PATCH", "/api/tasks/" + str(t.id), { "status": "review" }, ["If-Match: \"%s\"" % t.etag])
	if not _check(c, r.code == 200, "PATCH por el Inicio: HTTP %d" % r.code): return
	print("TASK ", t.id)


# Proyecto sin compass/: el dock ofrece crearla, corre `scompass init` y queda listo para iniciar el hub.
func test_init_compass(a: Array) -> void:
	var c := "init_compass"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	if not _check(c, v.banner.visible and v.init_button.visible and not v.start_button.visible, "no ofrece crear compass/"): return
	if not _check(c, v.banner_title.text == "Este proyecto no tiene compass/", "título del aviso: " + v.banner_title.text): return
	# En una pestaña oculta el dock mide 0 de ancho: los textos no pueden pedir un alto enorme.
	if not _check(c, v.get_combined_minimum_size().y < 600, "alto mínimo %d" % v.get_combined_minimum_size().y): return
	# Plantilla: juego por defecto; el caso puede pedir otra (a[2]).
	if not _check(c, v.template_select.visible and v.selected_template() == "juego", "plantilla por defecto: " + v.selected_template()): return
	if a.size() > 2:
		for i in v.template_select.item_count:
			if v.template_select.get_item_metadata(i) == a[2]:
				v.template_select.select(i)
	if not _check(c, await v.init_compass(), "no se creó: " + v.notice.text): return
	if not _check(c, FileAccess.file_exists(a[0].path_join("compass/config.json")), "falta compass/config.json"): return
	if not _check(c, v.start_button.visible and not v.init_button.visible and not v.template_select.visible, "no ofrece iniciar el hub"): return
	if not _check(c, v.board.warnings.is_empty(), "avisos: " + str(v.board.warnings)): return


# compass/ con el schema de una versión anterior: el dock lo avisa y "Actualizar" corre `scompass update`.
func test_update_compass(a: Array) -> void:
	var c := "update_compass"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	await v.check_compass()
	if not _check(c, v.update_row.visible and v.outdated == ["compass/schema/task.schema.json"], "no avisa el schema viejo: " + str(v.outdated)): return
	if not _check(c, v.update_label.text.ends_with(": schema/task.schema.json"), "aviso: " + v.update_label.text): return
	if not _check(c, await v.update_compass(), "no actualizó: " + v.notice.text): return
	if not _check(c, not v.update_row.visible and v.outdated.is_empty(), "el aviso sigue: " + str(v.outdated)): return


# Sin scompass: avisa en lugar de fallar en silencio.
func test_start_hub_missing(a: Array) -> void:
	var c := "start_hub_missing"
	var v := await _view(a[0])
	v.scompass_setting = func(): return "/no/existe/scompass.js"
	v.project_root = "/no/existe"
	# Puede encontrar uno instalado (PATH, `npm install -g`), pero nunca la ruta configurada que no existe.
	var cmd := v.scompass_command()
	if not _check(c, cmd.is_empty() or not str(cmd).contains("/no/existe"), "inventó un comando: " + str(cmd)): return


# Sin PATH ni ruta configurada: usa la instalación que scompass anotó en <datos>/scompass.json (§37).
func test_recorded_command(a: Array) -> void:
	var c := "recorded_command"
	var data: String = a[1]
	var exe := OS.get_executable_path()
	# La instalación anotada se escribe después de abrir el dock: setup() corre `scompass update --check`, y con el
	# ejecutable de Godot anotado como scompass eso abría otro Godot y el test se colgaba.
	var v := await _view(a[0])
	v.scompass_setting = func(): return ""
	var f := FileAccess.open(data.path_join("scompass.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify({"command": exe, "args": []}))
	f.close()
	OS.set_environment("SCOMPASS_DATA", data)
	v.project_root = "/no/existe"
	var cmd := v.scompass_command()
	if not _check(c, cmd == [exe, []], "no usó la anotada: " + str(cmd)): return
	# Si el programa anotado ya no está, no lo devuelve.
	f = FileAccess.open(data.path_join("scompass.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify({"command": "/no/existe/scompass", "args": []}))
	f.close()
	cmd = v.scompass_command()
	if not _check(c, cmd.is_empty() or not str(cmd).contains("/no/existe"), "devolvió uno que no existe: " + str(cmd)): return


# Lanza el hub desde el dock y se queda esperando: Node mata a Godot con kill -9 (5.8).
func test_start_hub_and_hang(a: Array) -> void:
	var c := "start_hub_and_hang"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	if not _check(c, await v.start_hub(), "no arrancó: " + v.notice.text): return
	print("PID ", v.hub.pid)
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
	if not _check(c, v.hub.kept, "no quedó en modo mantener"): return
	var pid: int = v.hub.pid
	v.stop_hub() # lo que hace el plugin al cerrar el editor
	await create_timer(1.0).timeout
	if not _check(c, OS.is_process_running(pid), "el dock lo cerró igual"): return
	print("PID ", pid)


# --- Referencias a documentos (6.7) ---------------------------------------------------------------

func _refs_check(v, a: Array, c: String, online: bool) -> void:
	_select(v, a[1])
	var head = v.detail.refs_box.get_child(1) if v.detail.refs_box.get_child_count() > 1 else null
	if not _check(c, head is HBoxContainer and head.get_child(0).text.contains("Ventanas de ataque"), "no está la referencia"): return
	head.get_child(0).pressed.emit()
	await process_frame
	var box = v.detail.refs_box.get_node_or_null("Section")
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
	for ch in v.detail.refs_box.get_children():
		if ch is Label and ch.text.contains("Referencia rota: gdd.md#borrada"):
			broken = true
	if not _check(c, broken, "falta el aviso de la referencia rota"): return
	# Al documento entero (12.1): su título, sin desplegar, y rota si el documento no está.
	var whole = v.detail.refs_box.find_child("WholeDoc", true, false)
	if not _check(c, whole is Label and whole.text == "▤ Juego", "falta la referencia al documento entero"): return
	var whole_broken := false
	for ch in v.detail.refs_box.get_children():
		if ch is Label and ch.text.contains("Referencia rota: otro.md no está"):
			whole_broken = true
	_check(c, whole_broken, "falta el aviso del documento que no está")


func test_refs_online(a: Array) -> void:
	var v = await _online_view(a[0], "refs_online")
	if v == null: return
	await _refs_check(v, a, "refs_online", true)


func test_refs_offline(a: Array) -> void:
	var v := await _view(a[0])
	await _refs_check(v, a, "refs_offline", false)


# Sin hub, los patrones de config.json › docs se expanden como en el hub (12.2): a[1] son los [alias, ruta] esperados.
func test_read_docs(a: Array) -> void:
	const Reader := preload("res://addons/scope_compass/compass_reader.gd")
	var config = JSON.parse_string(FileAccess.get_file_as_string(a[0].path_join("compass/config.json")))
	var got := []
	for d in Reader.read_docs(a[0], config):
		got.append([d.alias, d.path])
	_check("read_docs", JSON.stringify(got) == a[1], "documentos %s, esperado %s" % [JSON.stringify(got), a[1]])


# Vínculos: la tarea bloqueada por una en Revisión lo muestra en la lista y en el detalle; el vínculo lleva a la otra tarea.
func test_links(a: Array) -> void:
	var c := "links"
	var v := await _view(a[0])
	_select(v, a[1])
	if not _check(c, v.detail.links_box.get_child_count() == 2, "vínculos en el detalle: %d" % v.detail.links_box.get_child_count()): return
	var link: Button = v.detail.links_box.get_child(1)
	if not _check(c, link.text.begins_with("Bloqueada por: ") and link.text.ends_with(" · Revisión"), "texto: " + link.text): return
	var item: TreeItem = v.tree.get_selected()
	# La que bloquea está en Revisión: ya no bloquea, pero la lista avisa que quedó desbloqueada.
	if not _check(c, item != null and item.get_tooltip_text(0).contains("Desbloqueada, en Revisión: ") and not item.get_tooltip_text(0).contains("Bloqueada por: "), "la lista no marca la tarea desbloqueada en revisión"): return
	link.pressed.emit()
	await process_frame
	if not _check(c, v.selected_task == a[2], "no fue a la otra tarea: " + v.selected_task): return
	link = v.detail.links_box.get_child(1)
	if not _check(c, link.text.begins_with("Bloquea a: "), "texto del inverso: " + link.text): return


# Fecha límite (8.13): vencida y de hoy se marcan en la lista y en el detalle; una hecha no.
func test_due(a: Array) -> void:
	var c := "due"
	# La regla, con un "ahora" fijo: 4/10/2026 15:00.
	var now := float(Time.get_unix_time_from_datetime_string("2026-10-04T15:00:00"))
	var cases := [["2026-10-03", "overdue"], ["2026-10-04", "today"], ["2026-10-04T14:59", "overdue"], ["2026-10-04T17:30", "today"], ["2026-10-05", "later"]]
	for k in cases:
		var got := Board.due_state({ "due": k[0], "status": "todo" }, now)
		if not _check(c, got == k[1], "%s: %s, esperado %s" % [k[0], got, k[1]]): return
	if not _check(c, Board.due_state({ "due": "2026-10-03", "status": "done" }, now) == "", "una hecha no se marca"): return
	var v := await _view(a[0])
	v.current_milestone = "m01"
	_select(v, a[1])
	if not _check(c, v.detail.due_label.visible and v.detail.due_label.text == "Vencida · 01/01", "detalle vencida: " + v.detail.due_label.text): return
	var row: TreeItem = v.tree.get_selected()
	if not _check(c, row != null and row.get_text(1).begins_with("01/01") and row.get_custom_color(1) == v.OVERDUE_COLOR, "fila vencida: " + (row.get_text(1) if row else "sin fila")): return
	# La columna entra entera (m32-11): el ancho sale del texto más ancho, no de 44 px fijos.
	var font := v.tree.get_theme_font("font")
	var need := font.get_string_size(row.get_text(1), HORIZONTAL_ALIGNMENT_LEFT, -1, v.tree.get_theme_font_size("font_size")).x
	if not _check(c, v.tree.get_column_width(1) >= need, "la columna 1 corta «%s»: %d < %d" % [row.get_text(1), v.tree.get_column_width(1), need]): return
	_select(v, a[2])
	if not _check(c, v.detail.due_label.text.begins_with("Vence hoy · "), "detalle de hoy: " + v.detail.due_label.text): return
	_select(v, a[3])
	if not _check(c, v.detail.due_label.text == "Vence 01/01", "una hecha no dice vencida: " + v.detail.due_label.text): return
	_select(v, a[4])
	if not _check(c, not v.detail.due_label.visible, "sin fecha no muestra nada"): return


# Un paso con detalle: tocar el texto (o ▸) lo despliega; tocar el texto no tilda el paso.
func test_step_detail(a: Array) -> void:
	var c := "step_detail"
	var v := await _view(a[0])
	_select(v, a[1])
	var line: HBoxContainer = v.detail.steps_box.get_child(0).get_child(0)
	if not _check(c, line.get_child_count() == 3 and line.get_child(2).text == "▸", "falta el ▸ del detalle"): return
	if not _check(c, v.detail.steps_box.get_child(1).get_child(0).get_child_count() == 2, "un paso sin detalle no lleva ▸"): return
	# El cuadradito, centrado con la primera línea del texto (±2 px).
	await process_frame
	var cb: CheckBox = v.detail.step_checkbox(0)
	var label: Button = line.get_child(1)
	var sb := label.get_theme_stylebox("normal")
	var line_mid := label.global_position.y + sb.get_margin(SIDE_TOP) + label.get_theme_font("font").get_height(label.get_theme_font_size("font_size")) / 2.0
	var cb_mid := cb.global_position.y + cb.size.y / 2.0
	if not _check(c, absf(cb_mid - line_mid) <= 2.0, "cuadradito desalineado: centro %.1f vs línea %.1f" % [cb_mid, line_mid]): return
	var was: bool = v.detail.step_checkbox(0).button_pressed
	line.get_child(1).pressed.emit() # el texto
	await process_frame
	var row = v.detail.steps_box.get_child(0)
	if not _check(c, row.get_child_count() == 2 and row.get_child(1).get_child(0).text == a[2], "detalle: %s" % (row.get_child(1).get_child(0).text if row.get_child_count() == 2 else "no se desplegó")): return
	if not _check(c, v.detail.step_checkbox(0).button_pressed == was, "tocar el texto cambió el estado del paso"): return
	v.detail.steps_box.get_child(0).get_child(0).get_child(2).pressed.emit() # ▾ lo vuelve a plegar
	await process_frame
	_check(c, v.detail.steps_box.get_child(0).get_child_count() == 1, "no se plegó")


# El bloque de tareas se pliega (el detalle toma todo el alto) y el divisor se recuerda.
func test_split(a: Array) -> void:
	var c := "split"
	var saved := {}
	var v := DockView.new()
	v.set_pref = func(k, val): saved[k] = val
	v.get_pref = func(k, d): return saved.get(k, d)
	get_root().add_child(v)
	await v.setup(a[0])
	if not _check(c, v.tasks_header.text.begins_with("▾ Tareas · "), "encabezado: " + v.tasks_header.text): return
	v.tasks_header.pressed.emit()
	await process_frame
	if not _check(c, not v.tree.visible and v.split.collapsed and v.tasks_header.text.begins_with("▸"), "no se plegó"): return
	if not _check(c, saved.get("tasks_collapsed") == true, "no se recordó el plegado"): return
	v.tasks_header.pressed.emit()
	v.split.dragged.emit(123)
	if not _check(c, saved.get("split") == 123 and v.tree.visible, "no se recordó el divisor"): return
	# Una vista nueva arranca como quedó.
	saved["tasks_collapsed"] = true
	var w := DockView.new()
	w.get_pref = func(k, d): return saved.get(k, d)
	get_root().add_child(w)
	await w.setup(a[0])
	_check(c, not w.tree.visible, "la vista nueva no arrancó plegada")


# "Reiniciar hub" desde el dock: vuelve, se reconecta y sigue siendo del dock (se cierra con stop_hub).
func test_restart_hub(a: Array) -> void:
	var c := "restart_hub"
	var v := await _view(a[0])
	v.scompass_setting = func(): return a[1]
	if not _check(c, await v.start_hub(), "no arrancó: " + v.notice.text): return
	if not _check(c, await _until(func(): return v.online and not v._loading), "no se conectó"): return
	var before: int = v.hub.pid
	if not _check(c, v.restart_button.visible, "falta el botón con hub"): return
	if not _check(c, await v.restart_hub(), "no se reinició: " + v.notice.text): return
	var after: int = v.hub.pid
	print("PIDS ", before, " ", after)
	# OS.is_process_running solo conoce los hijos de Godot; el hub reiniciado es nieto (kill -0, o tasklist).
	var alive := func(pid: int) -> bool: return DockView.HubProcess.pid_alive(pid)
	if not _check(c, after != before and alive.call(after), "PID nuevo inválido: %d → %d" % [before, after]): return
	v.stop_hub()
	if not _check(c, await _until(func(): return not alive.call(after), 5.0), "el hub nuevo no se cerró con el dock"): return


# Íconos: los botones usan los de assets/ (importados por Godot).
func test_icons(a: Array) -> void:
	var c := "icons"
	var v := await _view(a[0])
	for name in v.ICONS:
		if not _check(c, v.ICONS[name] is Texture2D, "no cargó %s" % name): return
	_check(c, v.reload_button.icon == v.ICONS.reload and v.browser_button.icon == v.ICONS.browser, "botones sin ícono")


# El aviso dice por qué no encontró el hub; "Reintentar" lo vuelve a buscar.
func test_detect_reason(a: Array) -> void:
	var c := "detect_reason"
	var v := await _view(a[0])
	await v._try_hub()
	v._render()
	if not _check(c, v.banner_title.text.contains(a[1]), "aviso: " + v.banner_title.text): return
	print("READY")
	if not _check(c, await _wait_file(a[0].path_join(".go")), "Node no avisó"): return
	v._on_retry()
	_check(c, await _until(func(): return v.online, 5.0), "Reintentar no lo encontró: " + v.banner_title.text)


# El hub no está en el puerto de la config, pero el registro dice dónde está: el dock lo encuentra.
func test_registry(a: Array) -> void:
	var c := "registry"
	var v = await _online_view(a[0], c)
	if v == null: return
	_check(c, v.client.port == int(a[1]) and v.client.config_port != v.client.port, "puerto %d (config %d)" % [v.client.port, v.client.config_port])


# Sin hub al abrir el dock; después aparece en otro puerto que el de la config (como el Inicio): el sondeo lo
# encuentra y todo apunta ahí, la carga y lo que abre en el navegador.
func test_poll_registry(a: Array) -> void:
	var c := "poll_registry"
	var v := await _view(a[0])
	if not _check(c, not v.online, "ya estaba conectado"): return
	print("READY")
	if not _check(c, await _until(func(): return v.online and not v._loading and v.board.tasks.size() > 0 and v.board.tasks[0].has("etag"), 10.0), "no cargó del hub (puerto %d)" % v.client.port): return
	_check(c, v.web_url("#files") == "http://127.0.0.1:%s/#files" % a[1], "abre " + v.web_url("#files"))


# Etiquetas, prioridad y responsable (M11): en la fila, la prioridad solo si es alta (como la tarjeta de la web);
# en el detalle, todo, y la descripción (17.2). El botón de Archivos se ve si la config no tiene views o si incluye files.
func test_props(a: Array) -> void:
	var c := "props"
	var v := await _view(a[0])
	v.current_milestone = "m01"
	_select(v, a[1])
	if not _check(c, v.detail.props_label.visible and v.detail.props_label.text == "Prioridad alta · Tamaño M · @ana · #arte #audio", "detalle: " + v.detail.props_label.text): return
	if not _check(c, v.detail.description_label.visible and v.detail.description_label.text == "Qué hacer y por qué", "descripción: " + v.detail.description_label.text): return
	var shots := v.detail.images_box.get_children()
	if not _check(c, v.detail.images_box.visible and shots.size() == 2 and shots[0].texture_normal != null and shots[1] is Label and shots[1].text == "⚠ falta.png", "capturas (18.4): %d" % shots.size()): return
	var ms_text := v.milestone_select.get_item_text(v.milestone_select.selected)
	if not _check(c, ms_text.contains(" · atrasado "), "hito atrasado (18.2): " + ms_text): return
	var row: TreeItem = v.tree.get_selected()
	if not _check(c, row != null and row.get_text(0).ends_with(" · Alta · @ana · #arte #audio"), "fila: " + (row.get_text(0) if row else "sin fila")): return
	_select(v, a[2])
	row = v.tree.get_selected()
	if not _check(c, v.detail.props_label.text == "Prioridad baja" and not row.get_text(0).contains("Baja"), "baja: %s / %s" % [v.detail.props_label.text, row.get_text(0)]): return
	_select(v, a[3])
	if not _check(c, not v.detail.props_label.visible, "sin nada no muestra nada: " + v.detail.props_label.text): return
	if not _check(c, not v.detail.description_label.visible, "sin descripción no muestra nada: " + v.detail.description_label.text): return
	if not _check(c, not v.detail.images_box.visible, "sin capturas no muestra nada"): return
	if not _check(c, v.files_button.visible, "sin views falta el botón de Archivos"): return
	v.board.config.views = ["board", "docs"]
	v._render()
	_check(c, not v.files_button.visible, "views sin files y el botón se ve")


# Archivos de la tarea (15.3): se listan en el detalle; un clic los abre con open_file (el editor, que pone el plugin)
# y, si Godot no lo abre y no hay hub, el dock avisa. El que no está en el disco va en rojo.
func test_task_files(a: Array) -> void:
	var c := "task_files"
	var v := await _view(a[0])
	var opened := []
	v.open_file = func(p: String) -> bool:
		opened.append(p)
		return p.ends_with(".gd")
	v.current_milestone = "m01"
	_select(v, a[1])
	var buttons := v.detail.files_box.get_children().filter(func(n): return n is Button)
	var names := buttons.map(func(b): return b.text)
	if not _check(c, names == ["src/player.gd", "docs/notas.md", "src/borrado.gd"], "archivos: %s" % [names]): return
	if not _check(c, not buttons[0].has_theme_color_override("font_color") and buttons[2].has_theme_color_override("font_color"), "el que no está va en rojo"): return
	buttons[0].pressed.emit()
	buttons[1].pressed.emit()
	if not _check(c, opened == ["src/player.gd", "docs/notas.md"], "abrió %s" % [opened]): return
	if not _check(c, v.notice.visible and v.notice.text.contains("docs/notas.md"), "sin hub, avisa: " + v.notice.text): return
	_select(v, a[2])
	_check(c, v.detail.files_box.get_child_count() == 0, "una tarea sin archivos no muestra la sección")


# El script y la escena que se editan (15.4): arriba, las tareas sin terminar que los citan, de cualquier hito; un
# clic lleva a la tarea. En el detalle, "+ Vincular" agrega el abierto a la tarea elegida (con hub).
func test_editing(a: Array) -> void:
	var c := "editing"
	var v = await _online_view(a[0], c)
	if v == null: return
	v.current_milestone = "m02"
	v.set_editing("script", "res://src/player.gd")
	var names: Array = v.editing_box.get_children().map(func(b): return b.text)
	if not _check(c, v.editing_box.visible and names == ["player.gd · " + v.board.task_name(a[1])], "arriba: %s" % [names]): return
	v.set_editing("scene", "res://nivel.tscn::GDScript_x")
	if not _check(c, v.editing.scene == "", "un script incorporado no es un archivo: " + v.editing.scene): return
	v.editing_box.get_child(0).pressed.emit()
	if not _check(c, v.selected_task == a[1] and v.current_milestone == "m01", "no fue a la tarea: %s en %s" % [v.selected_task, v.current_milestone]): return
	if not _check(c, not v.detail.files_box.get_children().any(func(b): return b is Button and b.text.begins_with("+ Vincular")), "ofrece vincular lo que ya cita"): return
	_select(v, a[2])
	var add = v.detail.files_box.get_children().filter(func(b): return b is Button and b.text == "+ Vincular player.gd")
	if not _check(c, add.size() == 1, "falta + Vincular player.gd"): return
	add[0].pressed.emit()
	if not _check(c, await _until(func(): return v.board.task(a[2]).get("files", []) == ["src/player.gd"]), "no se vinculó"): return
	v.set_editing("script", "")
	_check(c, not v.editing_box.visible, "sin script abierto, la caja se va")


# 19.9: mover el dock (el editor lo saca del árbol y lo vuelve a poner) cierra el WebSocket: pasa a sin hub y
# el poll lo reconecta, en vez de quedar "conectado" sin eventos.
func test_reparent(a: Array) -> void:
	var c := "reparent"
	var v = await _online_view(a[0], c)
	if v == null: return
	var parent: Node = v.get_parent()
	parent.remove_child(v)
	parent.add_child(v)
	await process_frame
	if not _check(c, not v.online and v.banner.visible, "sigue marcado en línea sin WebSocket"): return
	_check(c, await _until(func(): return v.online and v.client.online, 8.0), "no se reconectó")


# 19.9: las miniaturas se decodifican una vez; un GIF (Godot no lo carga) es un botón con el nombre; sin hub, el
# poll no relee compass/ si no cambió nada, y sí si cambió.
func test_thumbs(a: Array) -> void:
	var c := "thumbs"
	var v := await _view(a[0])
	v.current_milestone = "m01"
	_select(v, a[1])
	var shots := v.detail.images_box.get_children()
	if not _check(c, shots.size() == 2 and shots[0] is TextureButton and shots[0].texture_normal != null, "miniatura: %d" % shots.size()): return
	if not _check(c, shots[1] is Button and shots[1].text == "▣ anim.gif", "gif: %s" % shots[1]): return
	var tex = shots[0].texture_normal
	v._render()
	if not _check(c, v.detail.images_box.get_child(0).texture_normal == tex, "volvió a decodificar la captura"): return
	var loads := [0]
	v.loaded.connect(func(): loads[0] += 1)
	v._poll.timeout.emit()
	await _until(func(): return false, 0.5)
	if not _check(c, loads[0] == 0, "releyó compass/ sin cambios"): return
	await _until(func(): return false, 1.1) # la fecha de modificación va en segundos
	var p: String = a[0].path_join("compass/tasks/%s.json" % a[1])
	var text := FileAccess.get_file_as_string(p)
	var f := FileAccess.open(p, FileAccess.WRITE)
	f.store_string(text.replace("\"title\":", "\"title\": ").replace("\"title\":  ", "\"title\": "))
	f.store_string("\n")
	f = null
	v._poll.timeout.emit()
	_check(c, await _until(func(): return loads[0] > 0, 3.0), "no releyó después de un cambio")


# 19.10: sin hub, una tarea con links/checklist/refs de otra forma va a los avisos y no rompe el render.
func test_bad_shapes(a: Array) -> void:
	var c := "bad_shapes"
	var v := await _view(a[0])
	v.current_milestone = "m01"
	v._render()
	var paths := v.board.warnings.map(func(w): return w.path)
	if not _check(c, paths.has("compass/tasks/m1-04.json") and paths.has("compass/tasks/m1-05.json") and paths.has("compass/tasks/m1-06.json"), "avisos: %s" % [paths]): return
	_check(c, v.listed().size() > 0, "la lista quedó vacía")


# 19.10: un guardado que falla vuelve a mostrar lo que hay; crear una tarea que falla deja el título; doble
# clic en Iniciar hub no lanza dos; Reiniciar hub no se ofrece en un proyecto del Inicio.
func test_failed_writes(a: Array) -> void:
	var c := "failed_writes"
	var v = await _online_view(a[0], c)
	if v == null: return
	_select(v, a[1])
	var before: String = v.board.task(a[1]).status
	# El hub deja de responder: el PATCH falla sin respuesta.
	v.client.port = 1
	_pick_status(v, "done")
	if not _check(c, await _until(func(): return v._queues.is_empty()), "la fila no terminó"): return
	if not _check(c, v.detail.status_select.get_item_metadata(v.detail.status_select.selected) == before, "el selector quedó en lo que no se guardó"): return
	if not _check(c, v.notice.text.begins_with("No se pudo guardar"), "aviso: " + v.notice.text): return
	v.new_title.text = "Que no se pierda"
	await v.create_task(v.new_title.text)
	if not _check(c, v.new_title.text == "Que no se pierda", "se borró el título de una tarea que no se creó"): return
	v.client.base = "/p/algo"
	v._render()
	if not _check(c, not v.restart_button.visible, "Reiniciar hub visible en un proyecto del Inicio"): return
	v.online = false
	v._starting = true
	_check(c, (await v.start_hub()) == false and v._starting, "un segundo Iniciar hub no esperó al primero")


# 19.11: el dock entra en el slot derecho (~300 px), también con un error largo y con hub; la tarea abierta tiene
# el botón para abrirla en el navegador.
func test_narrow(a: Array) -> void:
	var c := "narrow"
	var v := await _view(a[0])
	v.client.last_error = "es el hub de otro proyecto: /home/alguien/Proyectos/Godot/un-proyecto-con-nombre-largo"
	v.current_milestone = "m01"
	v.selected_task = a[1]
	v._render()
	await process_frame
	var w: float = v.get_combined_minimum_size().x
	if not _check(c, w <= 300, "sin hub pide %d px" % w): return
	if not _check(c, not v.detail.web_button.visible, "abrir en el navegador sin hub"): return
	v.online = true
	v._uncommitted = 12
	v._render()
	await process_frame
	w = v.get_combined_minimum_size().x
	if not _check(c, w <= 300, "con hub pide %d px" % w): return
	_check(c, v.detail.web_button.visible and v.web_url("#task/" + a[1]).ends_with("/#task/" + a[1]), "falta abrir la tarea en el navegador")


# 21.3: el resultado del playtest vive en la tarea (D40). La lista marca ✓ anda / ✗ falla; el detalle muestra Anda /
# Falla y la nota si la tarea se probó o está en Revisión. Sin hub, de solo lectura.
func test_playtest(a: Array) -> void:
	var c := "playtest"
	var v := await _view(a[0])
	v.current_milestone = "m01"
	_select(v, a[1])
	var row: TreeItem = v.tree.get_selected()
	if not _check(c, row != null and row.get_text(0).begins_with("✗ ") and row.get_tooltip_text(0).contains("Playtest: falla · Se traba"), "fila que falla: %s" % (row.get_text(0) if row else "sin fila")): return
	var d = v.detail
	if not _check(c, d.playtest_box.visible and d.result_buttons.fail.button_pressed and not d.result_buttons.pass.button_pressed, "detalle: falla marcada"): return
	if not _check(c, d.result_buttons.fail.disabled, "sin hub los botones tendrían que estar deshabilitados"): return
	if not _check(c, d.result_buttons.fail.has_theme_color_override("font_disabled_color") and not d.result_buttons.pass.has_theme_color_override("font_disabled_color"), "deshabilitado, no se ve cuál está marcado"): return
	if not _check(c, d.playtest_note.visible and d.playtest_note.text == "Se traba\nal saltar", "nota: " + d.playtest_note.text): return
	_select(v, a[2])
	row = v.tree.get_selected()
	if not _check(c, row.get_text(0).begins_with("✓ ") and d.result_buttons.pass.button_pressed and not d.playtest_note.visible, "la que anda: " + row.get_text(0)): return
	_select(v, a[3])
	row = v.tree.get_selected()
	_check(c, not d.playtest_box.visible and not row.get_text(0).begins_with("✓") and not row.get_text(0).begins_with("✗"), "sin probar y fuera de Revisión no muestra nada")


# 21.3, con hub: Anda / Falla escriben en la tarea sin tocar la nota; otro clic en el mismo lo quita, y sin nada se
# borra el campo playtest.
func test_playtest_online(a: Array) -> void:
	var c := "playtest_online"
	var v = await _online_view(a[0], c)
	if v == null: return
	v.current_milestone = "m01"
	_select(v, a[1])
	var d = v.detail
	if not _check(c, not d.result_buttons.pass.disabled, "con hub los botones tendrían que andar"): return
	d.result_buttons.pass.pressed.emit()
	if not _check(c, await _until(func(): return v._queues.is_empty() and Board.playtest_of(v.board.task(a[1])).get("result") == "pass"), "no pasó a anda"): return
	if not _check(c, d.result_buttons.pass.button_pressed and not d.result_buttons.fail.button_pressed, "botones después de anda"): return
	d.result_buttons.pass.pressed.emit()
	if not _check(c, await _until(func(): return v._queues.is_empty() and not Board.playtest_of(v.board.task(a[1])).has("result")), "otro clic no lo quitó"): return
	_select(v, a[2])
	d.result_buttons.pass.pressed.emit()
	_check(c, await _until(func(): return v._queues.is_empty() and not v.board.task(a[2]).has("playtest")), "sin resultado ni nota no se borró playtest")


# 24.9: las decisiones (§31) en el dock. La lista marca ? (preguntas abiertas) o ! (sin revisar) y lo dice el tooltip;
# el detalle las muestra con su estado, y OK / Revertir solo en las sin revisar, deshabilitados sin hub.
func test_decisions(a: Array) -> void:
	var c := "decisions"
	var v := await _view(a[0])
	v.current_milestone = "m01"
	_select(v, a[1])
	var row: TreeItem = v.tree.get_selected()
	if not _check(c, row != null and row.get_text(0).begins_with("? ") and row.get_tooltip_text(0).contains("Decisiones: 1 preguntas abiertas, 1 sin revisar"), "fila: %s / %s" % [row.get_text(0) if row else "", row.get_tooltip_text(0) if row else ""]): return
	var d = v.detail
	if not _check(c, d.decisions_box.visible and d.decisions_box.get_child_count() == 4, "detalle: %d hijos" % d.decisions_box.get_child_count()): return
	if not _check(c, d.decisions_box.get_child(0).text == "Decisiones (1 abiertas, 1 sin revisar)", "título: " + d.decisions_box.get_child(0).text): return
	var buttons: Array = d.decision_buttons(1)
	if not _check(c, buttons.size() == 2 and buttons[0].text == "OK" and buttons[0].disabled, "OK de la sin revisar, deshabilitado sin hub"): return
	if not _check(c, d.decision_buttons(2).is_empty() and d.decision_buttons(3).is_empty(), "la pregunta y la revisada no tienen botones"): return
	_select(v, a[2])
	row = v.tree.get_selected()
	_check(c, not d.decisions_box.visible and not row.get_text(0).begins_with("? ") and not row.get_text(0).begins_with("! "), "sin decisiones no muestra nada")


# 24.9, con hub: OK y Revertir escriben la revisión de la decisión, buscándola por cuándo se registró y su texto.
func test_decisions_online(a: Array) -> void:
	var c := "decisions_online"
	var v = await _online_view(a[0], c)
	if v == null: return
	v.current_milestone = "m01"
	_select(v, a[1])
	var d = v.detail
	var buttons: Array = d.decision_buttons(1)
	if not _check(c, buttons.size() == 2 and not buttons[1].disabled, "con hub Revertir tendría que andar"): return
	buttons[1].pressed.emit()
	if not _check(c, await _until(func(): return v._queues.is_empty() and Board.decisions_of(v.board.task(a[1]))[0].get("review") == "revert"), "no quedó a revertir"): return
	_check(c, d.decision_buttons(1).is_empty() and v.tree.get_selected().get_text(0).begins_with("? "), "después de revertir: sin botones, la fila sigue con la pregunta")


# 21.5: la caja de búsqueda filtra por código, título o id en todos los hitos, con todas las palabras y sin tildes;
# lo de otro hito lleva su código, Hecho se despliega, y vacía vuelve a la lista del hito.
func test_search(a: Array) -> void:
	var c := "search"
	var v := await _view(a[0])
	v.current_milestone = "m01"
	v._render()
	var before: Array = v.listed()
	v.search.text = "menu PAUSA"
	v.search.text_changed.emit(v.search.text)
	if not _check(c, v.listed() == ["review:m1-05"], "menu PAUSA: %s" % [v.listed()]): return
	if not _check(c, v.tasks_header.text.ends_with("Tareas · 1 encontrada"), "encabezado: " + v.tasks_header.text): return
	v.search.text = "m0-02"
	v.search.text_changed.emit(v.search.text)
	if not _check(c, v.listed() == ["done:m0-02"], "por id en otro hito: %s" % [v.listed()]): return
	var g: TreeItem = v.tree.get_root().get_child(0)
	if not _check(c, not g.collapsed and g.get_child(0).get_text(0).ends_with(" · M0"), "Hecho desplegado y con el hito: %s" % g.get_child(0).get_text(0)): return
	v.search.text = "1.5 pausa"
	v.search.text_changed.emit(v.search.text)
	if not _check(c, v.listed() == ["review:m1-05"], "código y palabra: %s" % [v.listed()]): return
	v.search.text = "pausa inexistente"
	v.search.text_changed.emit(v.search.text)
	if not _check(c, v.listed().is_empty(), "todas las palabras: %s" % [v.listed()]): return
	v.search.text = ""
	v.search.text_changed.emit("")
	if not _check(c, v.listed() == before, "vacía no volvió a la lista del hito: %s" % [v.listed()]): return
	var done: TreeItem = v.tree.get_root().get_child(v.tree.get_root().get_child_count() - 1)
	_check(c, done.collapsed, "Hecho tendría que volver a estar plegado")


# 21.4: Bug desde el dock: el título de la caja, la etiqueta bug con su plantilla y la captura (acá, una imagen fija en
# lugar del editor); si el juego no contesta, el bug se carga igual y se avisa; sin título, no se carga nada.
func test_bug(a: Array) -> void:
	var c := "bug"
	var v = await _online_view(a[0], c)
	if v == null: return
	v.current_milestone = "m02"
	var n: int = v.board.tasks.size()
	v.new_title.text = "  "
	await v.create_bug(v.new_title.text, "editor")
	if not _check(c, v.notice.text.begins_with("Escribí en la caja") and v.board.tasks.size() == n, "sin título: " + v.notice.text): return
	v.capture_editor = func():
		var img := Image.create(64, 40, false, Image.FORMAT_RGB8)
		img.fill(Color.RED)
		return img
	v.new_title.text = "Se cae del mapa"
	await v.create_bug(v.new_title.text, "editor")
	var made = v.board.task(v.selected_task)
	if not _check(c, made != null and made.title == "Se cae del mapa" and made.get("images", []).size() == 1, "no se cargó con la captura: %s" % made): return
	if not _check(c, v.new_title.text == "" and v.notice.text.contains("con la captura del editor") and v.notice.text.contains("Completá la descripción"), "aviso: " + v.notice.text): return
	if not _check(c, v.detail.images_box.get_child_count() == 1, "la captura no está en el detalle"): return
	print("BUG ", made.id)
	await v.create_bug("Sin juego", "game")
	made = v.board.task(v.selected_task)
	if not _check(c, made.title == "Sin juego" and not made.has("images") and v.notice.text.contains("el juego no contestó"), "sin juego: %s / %s" % [made, v.notice.text]): return
	print("NOSHOT ", made.id)
	# El menú: "Con captura del juego" solo con un juego corriendo.
	v.bug_button.about_to_popup.emit()
	if not _check(c, v.bug_button.get_popup().is_item_disabled(0), "captura del juego habilitada sin juego"): return
	v.game_running = func() -> bool: return true
	v.bug_button.about_to_popup.emit()
	_check(c, not v.bug_button.get_popup().is_item_disabled(0), "captura del juego deshabilitada con juego")
