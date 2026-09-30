@tool
extends VBoxContainer
## Vista del dock "Tablero" (mockups Dock_Tasks y Dock_Offline). Es un Control común: el plugin la pone
## dentro de un EditorDock y los tests la instancian sin editor.
## Con hub: carga por HTTP, cambios en vivo por WebSocket y edición. Sin hub: compass/ en solo lectura.

signal state_changed(online: bool)
signal loaded

const Reader := preload("compass_reader.gd")
const Board := preload("board.gd")
const HubClient := preload("hub_client.gd")

## Preferencias por proyecto. El plugin las guarda en la metadata del proyecto del editor.
var get_pref: Callable = func(_key: String, default): return default
var set_pref: Callable = func(_key: String, _value): pass
## Ruta a scompass configurada en Editor Settings ("" = buscarla).
var scompass_setting: Callable = func(): return ""
## Editor Settings scope_compass/keep_hub_running: el hub sigue al cerrar el editor, con ícono en la bandeja.
var keep_hub_setting: Callable = func(): return false

var project_root := ""
var board := Board.new()
var client := HubClient.new()
var online := false
var current_milestone := ""
var selected_task := ""
var _collapsed := { "done": true }
var _uncommitted := -1
var _loading := false
var _reload_again := false
var _queues := {}
var hub_pid := -1
## Tubería con el hub que lanzó el dock: mientras exista, el hub vive; si Godot muere, el sistema la cierra.
var _hub_pipe := {}
## El hub se lanzó para quedar corriendo: el dock no lo cierra.
var hub_kept := false

var banner: PanelContainer
var banner_title: Label
var warnings_label: Label
var milestone_select: OptionButton
var reload_button: Button
var browser_button: Button
var new_row: HBoxContainer
var new_title: LineEdit
var tree: Tree
var detail_scroll: ScrollContainer
var detail: VBoxContainer
var detail_title: Label
var status_select: OptionButton
var steps_box: VBoxContainer
var refs_box: VBoxContainer
## Referencias desplegadas ("ruta#id") y bloques de las secciones pedidas al hub (6.7).
var _refs_open := {}
## Pasos con el detalle desplegado ("tarea:índice").
var _steps_open := {}
var _blocks := {}
## Resaltado para los CodeEdit de los snippets. El plugin pasa el GDScriptSyntaxHighlighter del editor; fuera
## del editor (tests) queda un CodeHighlighter básico.
var make_highlighter: Callable = func(lang: String): return basic_highlighter(lang)
var notice: Label
var footer_dot: ColorRect
var footer_label: Label
var footer_right: Label
var restart_button: Button
var _poll: Timer
var _notice_timer: Timer


func _init() -> void:
	name = "Tablero"
	size_flags_vertical = SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 6)
	add_child(client)
	client.went_online.connect(_on_online)
	client.went_offline.connect(_on_offline)
	client.event_received.connect(_on_event)
	_build()


## Punto de entrada: la raíz del proyecto (donde está compass/).
func setup(root: String) -> void:
	project_root = root
	client.project_root = root
	await reload()
	await _try_hub()


## Recarga completa: por HTTP si hay hub, de disco si no. Si llega otra mientras carga, se repite.
func reload() -> void:
	if _loading:
		_reload_again = true
		return
	_loading = true
	while true:
		_reload_again = false
		var data = null
		if online:
			data = await client.load_all()
		if data == null:
			data = Reader.read(project_root)
		board.load_from(data)
		if not _reload_again:
			break
	_loading = false
	client.port = board.port()
	_uncommitted = _count_uncommitted()
	var remembered: String = get_pref.call("milestone", "")
	if current_milestone == "" or board.milestone(current_milestone) == null:
		current_milestone = remembered if board.milestone(remembered) != null else board.default_milestone()
	if selected_task != "" and board.task(selected_task) == null:
		selected_task = ""
	_render()
	loaded.emit()


func _try_hub() -> void:
	if not online:
		await client.detect()


# --- Hub ---------------------------------------------------------------------------------------

func _on_online() -> void:
	online = true
	state_changed.emit(true)


func _on_offline() -> void:
	online = false
	state_changed.emit(false)
	await reload()


func _on_event(msg: Dictionary) -> void:
	match msg.get("type"):
		"hello":
			await reload()
		"upsert":
			if board.apply(msg.collection, msg.id, msg.doc):
				_render()
		"delete":
			if board.apply(msg.collection, msg.id, null):
				if msg.id == selected_task:
					selected_task = ""
				_render()
		"doc_changed":
			# El documento cambió: se olvida el BBCode de sus secciones y se recarga el índice.
			for k in _blocks.keys():
				if str(k).begins_with(str(msg.get("alias", "")) + "#"):
					_blocks.erase(k)
			await reload()
		"warning":
			board.warn(msg)
			if board.task(selected_task) == null:
				selected_task = ""
			_render()


## Escrituras de una tarea, en fila. El cambio se calcula al enviarlo, sobre el estado más reciente y con
## su etag (como la UI web): tildar dos pasos seguidos no da 409 ni pisa el primero.
## patch: un Dictionary o un Callable(task) -> Dictionary.
func update_task(id: String, patch) -> void:
	if not _queues.has(id):
		_queues[id] = []
	_queues[id].append(patch)
	if _queues[id].size() > 1:
		return
	while not _queues[id].is_empty():
		await _send_update(id, _queues[id][0])
		_queues[id].pop_front()
	_queues.erase(id)


func _send_update(id: String, patch) -> void:
	var t = board.task(id)
	if t == null or not online:
		return
	var body: Dictionary = patch.call(t) if patch is Callable else patch
	var r := await client.request("PATCH", "/api/tasks/" + id.uri_encode(), body, ["If-Match: \"%s\"" % t.get("etag", "")])
	if r.code == 200:
		board.apply("tasks", id, r.json)
		_render()
	elif r.code == 409 and r.json is Dictionary and r.json.error.get("current") is Dictionary:
		# Alguien la cambió antes: se toma la versión actual y se avisa (spec §5.3).
		var cur: Dictionary = r.json.error.current
		var doc: Dictionary = cur.doc.duplicate()
		doc["id"] = cur.id
		doc["etag"] = cur.etag
		board.apply("tasks", id, doc)
		_render()
		show_notice("Otra pestaña o la CLI cambió esta tarea; se actualizó. Revisá y volvé a aplicar tu cambio.")
	else:
		var msg: String = r.json.error.message if r.json is Dictionary and r.json.has("error") else "sin respuesta del hub"
		show_notice("No se pudo guardar: " + msg)


func create_task(title: String) -> void:
	title = title.strip_edges()
	if title == "" or current_milestone == "" or not online:
		return
	var r := await client.request("POST", "/api/tasks", { "title": title, "milestone": current_milestone, "code": "",
		"status": "todo", "checklist": [], "test": "", "notes": "", "refs": [] })
	if r.code == 201:
		board.apply("tasks", r.json.id, r.json)
		selected_task = r.json.id
		_render()
	else:
		show_notice("No se pudo crear la tarea.")


# --- Iniciar el hub (5.5) ----------------------------------------------------------------------

## Dónde está scompass: la opción de Editor Settings, al lado del proyecto, dentro de él o en el PATH.
## Devuelve [programa, args previos] listos para OS.create_process, o [] si no se encontró.
func scompass_command() -> Array:
	var candidates: Array = []
	var configured: String = scompass_setting.call()
	if configured != "":
		candidates.append(configured)
	candidates.append(project_root.path_join("../scope-compass/hub/bin/scompass.js").simplify_path())
	candidates.append(project_root.path_join("hub/bin/scompass.js"))
	for path in candidates:
		if path.ends_with(".js") and FileAccess.file_exists(path):
			return ["node", [path]]
		if not path.ends_with(".js") and FileAccess.file_exists(path):
			return [path, []]
	var out := []
	if OS.execute("sh", ["-c", "command -v scompass"], out) == 0 and str(out[0]).strip_edges() != "":
		return [str(out[0]).strip_edges(), []]
	return []


## Levanta `scompass serve` para este proyecto y espera a conectarse (hasta 8 s).
func start_hub() -> bool:
	if online:
		return true
	var cmd := scompass_command()
	if cmd.is_empty():
		show_notice("No encontré scompass. Configurá su ruta en Editor Settings › scope_compass/scompass_path.")
		return false
	# Por sh con la salida a un log: si no, el hub hereda el stdout de Godot. exec conserva el PID.
	var log_path := project_root.path_join(".godot/scope_compass_hub.log")
	DirAccess.make_dir_recursive_absolute(log_path.get_base_dir())
	hub_kept = bool(keep_hub_setting.call())
	if hub_kept:
		# Independiente del editor (5.9): sin tubería y con ícono en la bandeja para detenerlo. create_process ya
		# pone al hijo en su propia sesión (setsid sobra y, al ser líder, haría un fork que cambia el PID).
		var args: Array = ["-c", 'log="$1"; shift; exec "$@" >"$log" 2>&1 </dev/null', "sh", log_path, cmd[0]] + cmd[1] \
			+ ["--dir", project_root, "serve", "--tray"]
		hub_pid = OS.create_process("sh", PackedStringArray(args))
	else:
		var args: Array = ["-c", 'log="$1"; shift; exec "$@" >"$log" 2>&1', "sh", log_path, cmd[0]] + cmd[1] \
			+ ["--dir", project_root, "serve", "--exit-on-stdin-close"]
		# La entrada del hub es una tubería con Godot: si el editor se cierra, se cuelga o lo matan, el hub se va (5.8).
		_hub_pipe = OS.execute_with_pipe("sh", PackedStringArray(args), false)
		hub_pid = int(_hub_pipe.get("pid", -1))
	if hub_pid <= 0:
		hub_pid = -1
		show_notice("No se pudo iniciar el hub con %s." % cmd[0])
		return false
	for i in 32:
		await get_tree().create_timer(0.25).timeout
		if await client.detect() or online:
			break
		if not OS.is_process_running(hub_pid):
			break
	if not online and not await _wait_online(2.0):
		show_notice("El hub no arrancó. Mirá .godot/scope_compass_hub.log o probá `scompass serve` en una terminal.")
		return false
	return true


func _wait_online(secs: float) -> bool:
	var t0 := Time.get_ticks_msec()
	while not online and Time.get_ticks_msec() - t0 < secs * 1000:
		await get_tree().process_frame
	return online


## Reinicia el hub (POST /api/restart): se cae, vuelve en el mismo puerto y el dock se reconecta. Si el hub era
## de este dock, sigue siéndolo (hereda la tubería con Godot) y se actualiza su PID.
func restart_hub() -> bool:
	if not online:
		return false
	var r := await client.request("POST", "/api/restart")
	if r.code != 202:
		show_notice("El hub no aceptó reiniciarse.")
		return false
	var t0 := Time.get_ticks_msec()
	while online and Time.get_ticks_msec() - t0 < 5000:
		await get_tree().process_frame
	while not online and Time.get_ticks_msec() - t0 < 12000:
		await get_tree().create_timer(0.25).timeout
		await client.detect()
	if not await _wait_online(2.0):
		show_notice("El hub no volvió después de reiniciarse. Mirá .godot/scope_compass_hub.log.")
		return false
	if hub_pid > 0:
		var h := await client.request("GET", "/api/health")
		if h.code == 200:
			hub_pid = int(h.json.pid)
	show_notice("Hub reiniciado.")
	return true


## Cierra el hub solo si lo abrió este dock y no está en modo "mantener" (salvo force): corta la tubería
## (el hub termina el export pendiente y sale).
## Si en 3 s sigue vivo, SIGTERM.
func stop_hub(force := false) -> void:
	if hub_pid <= 0 or (hub_kept and not force):
		return
	for key in ["stdio", "stderr"]:
		if _hub_pipe.get(key) is FileAccess:
			_hub_pipe[key].close()
	_hub_pipe = {}
	# Con kill -0: tras un reinicio el hub es nieto de Godot y OS.is_process_running no lo conoce.
	var alive := func(pid: int) -> bool: return OS.execute("kill", ["-0", str(pid)]) == 0
	var t0 := Time.get_ticks_msec()
	while alive.call(hub_pid) and Time.get_ticks_msec() - t0 < 3000:
		OS.delay_msec(50)
	if alive.call(hub_pid):
		if OS.execute("kill", ["-TERM", str(hub_pid)]) != 0:
			OS.kill(hub_pid)
	hub_pid = -1


func show_notice(text: String) -> void:
	notice.text = text
	notice.visible = true
	_notice_timer.start()


# --- Construcción ----------------------------------------------------------------------------

func _build() -> void:
	banner = PanelContainer.new()
	var bs := StyleBoxFlat.new()
	bs.bg_color = Color("#2e2a1c")
	bs.border_color = Color("#6b5a22")
	bs.set_border_width_all(1)
	bs.set_corner_radius_all(3)
	bs.set_content_margin_all(8)
	banner.add_theme_stylebox_override("panel", bs)
	var bv := VBoxContainer.new()
	banner.add_child(bv)
	banner_title = Label.new()
	banner_title.add_theme_color_override("font_color", Color("#ffde66"))
	bv.add_child(banner_title)
	var btext := Label.new()
	btext.text = "Mostrando las tareas desde compass/ en solo lectura. Para editarlas, iniciá el hub o editá los JSON y commiteá con git."
	btext.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	bv.add_child(btext)
	var bb := HBoxContainer.new()
	bv.add_child(bb)
	var start := Button.new()
	start.text = "Iniciar hub"
	start.pressed.connect(start_hub)
	bb.add_child(start)
	var retry := Button.new()
	retry.text = "Reintentar"
	retry.pressed.connect(func(): await reload(); await _try_hub())
	bb.add_child(retry)
	var open_tasks := Button.new()
	open_tasks.text = "Abrir compass/tasks"
	open_tasks.pressed.connect(func(): OS.shell_open(project_root.path_join("compass/tasks")))
	bb.add_child(open_tasks)
	add_child(banner)

	warnings_label = Label.new()
	warnings_label.add_theme_color_override("font_color", Color("#e8806e"))
	warnings_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(warnings_label)

	var head := HBoxContainer.new()
	add_child(head)
	milestone_select = OptionButton.new()
	milestone_select.size_flags_horizontal = SIZE_EXPAND_FILL
	milestone_select.clip_text = true
	milestone_select.tooltip_text = "Hito"
	milestone_select.item_selected.connect(_on_milestone_selected)
	head.add_child(milestone_select)
	reload_button = Button.new()
	reload_button.tooltip_text = "Recargar"
	reload_button.text = "↻"
	reload_button.pressed.connect(reload)
	head.add_child(reload_button)
	browser_button = Button.new()
	browser_button.tooltip_text = "Abrir el tablero en el navegador"
	browser_button.text = "↗"
	browser_button.pressed.connect(func(): OS.shell_open(client.base_url() + "/"))
	head.add_child(browser_button)

	new_row = HBoxContainer.new()
	add_child(new_row)
	new_title = LineEdit.new()
	new_title.placeholder_text = "Nueva tarea en este hito"
	new_title.size_flags_horizontal = SIZE_EXPAND_FILL
	new_title.text_submitted.connect(func(t): new_title.clear(); create_task(t))
	new_row.add_child(new_title)
	var add := Button.new()
	add.text = "Agregar"
	add.pressed.connect(func(): var t := new_title.text; new_title.clear(); create_task(t))
	new_row.add_child(add)

	tree = Tree.new()
	tree.hide_root = true
	tree.columns = 2
	tree.set_column_expand(0, true)
	tree.set_column_expand(1, false)
	tree.set_column_custom_minimum_width(1, 44)
	tree.size_flags_vertical = SIZE_EXPAND_FILL
	tree.custom_minimum_size.y = 160
	tree.item_selected.connect(_on_item_selected)
	tree.item_collapsed.connect(_on_item_collapsed)
	add_child(tree)

	# El detalle se desplaza solo: una tarea con muchos pasos no le quita lugar a la lista.
	detail_scroll = ScrollContainer.new()
	detail_scroll.size_flags_vertical = SIZE_EXPAND_FILL
	detail_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(detail_scroll)
	detail = VBoxContainer.new()
	detail.size_flags_horizontal = SIZE_EXPAND_FILL
	detail_scroll.add_child(detail)
	detail_title = Label.new()
	detail_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail_title.add_theme_font_size_override("font_size", 15)
	detail.add_child(detail_title)
	var srow := HBoxContainer.new()
	detail.add_child(srow)
	var slabel := Label.new()
	slabel.text = "Estado"
	srow.add_child(slabel)
	status_select = OptionButton.new()
	status_select.size_flags_horizontal = SIZE_EXPAND_FILL
	for s in Board.STATUSES:
		status_select.add_item(s.label)
		status_select.set_item_metadata(status_select.item_count - 1, s.id)
	status_select.item_selected.connect(func(i): if selected_task != "": update_task(selected_task, { "status": status_select.get_item_metadata(i) }))
	srow.add_child(status_select)
	steps_box = VBoxContainer.new()
	detail.add_child(steps_box)
	refs_box = VBoxContainer.new()
	detail.add_child(refs_box)

	notice = Label.new()
	notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	notice.add_theme_color_override("font_color", Color("#e0a95a"))
	notice.visible = false
	add_child(notice)
	_notice_timer = Timer.new()
	_notice_timer.one_shot = true
	_notice_timer.wait_time = 6.0
	_notice_timer.timeout.connect(func(): notice.visible = false)
	add_child(_notice_timer)

	var foot := HBoxContainer.new()
	add_child(foot)
	footer_dot = ColorRect.new()
	footer_dot.custom_minimum_size = Vector2(8, 8)
	footer_dot.size_flags_vertical = SIZE_SHRINK_CENTER
	foot.add_child(footer_dot)
	footer_label = Label.new()
	foot.add_child(footer_label)
	footer_right = Label.new()
	footer_right.size_flags_horizontal = SIZE_EXPAND_FILL
	footer_right.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	foot.add_child(footer_right)
	restart_button = Button.new()
	restart_button.text = "Reiniciar hub"
	restart_button.flat = true
	restart_button.tooltip_text = "Reinicia el hub (para que cargue código nuevo de Scope Compass)"
	restart_button.pressed.connect(restart_hub)
	foot.add_child(restart_button)

	# Sin hub: cada 3 s se busca el hub y se relee compass/ (una edición a mano o un git pull se ven solos).
	_poll = Timer.new()
	_poll.wait_time = 3.0
	_poll.timeout.connect(func():
		if not online and project_root != "":
			await _try_hub()
			if not online:
				await reload())
	add_child(_poll)


func _ready() -> void:
	_poll.start()


func _exit_tree() -> void:
	client.close()


# --- Render ----------------------------------------------------------------------------------

func _render() -> void:
	banner.visible = not online
	banner_title.text = "No hay hub en 127.0.0.1:%d" % board.port()
	warnings_label.visible = board.warnings.size() > 0
	warnings_label.text = "\n".join(board.warnings.map(func(w): return "%s · %s" % [w.path, w.message]))
	browser_button.disabled = not online
	new_row.visible = online

	milestone_select.clear()
	for m in board.milestones:
		var p := board.progress(m.id)
		milestone_select.add_item("%s · %s (%d/%d)" % [m.code, m.title, p[0], p[1]])
		milestone_select.set_item_metadata(milestone_select.item_count - 1, m.id)
		if m.id == current_milestone:
			milestone_select.select(milestone_select.item_count - 1)

	_render_tree()
	_render_detail()

	footer_dot.color = Color("#6fbf94") if online else Color("#e0655a")
	footer_label.text = ("127.0.0.1:%d" % board.port()) if online else "Sin hub · solo lectura"
	restart_button.visible = online
	footer_right.text = ("compass: %d sin commitear" % _uncommitted) if _uncommitted >= 0 else ""


func _render_tree() -> void:
	tree.clear()
	var root := tree.create_item()
	var ts := board.tasks_of(current_milestone)
	for s in Board.STATUSES:
		var items := ts.filter(func(t): return t.status == s.id)
		if items.is_empty():
			continue
		var g := tree.create_item(root)
		g.set_text(0, "● %s · %d" % [s.label.to_upper(), items.size()])
		g.set_custom_color(0, s.color)
		g.set_selectable(0, false)
		g.set_selectable(1, false)
		g.set_metadata(0, "status:" + s.id)
		g.collapsed = _collapsed.get(s.id, false)
		for t in items:
			var it := tree.create_item(g)
			var code := str(t.get("code", ""))
			it.set_text(0, ((code + "  " if code != "" else "") + str(t.title)).replace("`", ""))
			var st := Board.steps(t)
			it.set_text(1, "%d/%d" % st if st[1] > 0 else "")
			it.set_text_alignment(1, HORIZONTAL_ALIGNMENT_RIGHT)
			it.set_metadata(0, t.id)
			it.set_tooltip_text(0, str(t.title))
			if t.id == selected_task:
				it.select(0)


func _render_detail() -> void:
	var t = board.task(selected_task)
	detail.visible = t != null
	detail_scroll.visible = t != null
	if t == null:
		return
	detail_title.text = (((str(t.code) + " ") if str(t.get("code", "")) != "" else "") + str(t.title)).replace("`", "")
	for i in status_select.item_count:
		if status_select.get_item_metadata(i) == t.status:
			status_select.select(i)
	status_select.disabled = not online
	for c in steps_box.get_children():
		steps_box.remove_child(c)
		c.queue_free()
	var cl = t.get("checklist", [])
	for i in (cl.size() if cl is Array else 0):
		# Cada paso: el checkbox con el texto corto y, si tiene detalle, ▸ para desplegarlo debajo.
		var row := VBoxContainer.new()
		var line := HBoxContainer.new()
		row.add_child(line)
		var cb := CheckBox.new()
		cb.text = str(cl[i].get("text", "")).replace("`", "")
		cb.button_pressed = cl[i].get("done", false)
		cb.disabled = not online
		cb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		cb.size_flags_horizontal = SIZE_EXPAND_FILL
		var id: String = t.id
		cb.toggled.connect(func(on: bool): update_task(id, func(cur): return { "checklist": _toggled(cur, i, on) }))
		line.add_child(cb)
		var detail_text := str(cl[i].get("detail", ""))
		if detail_text != "":
			var key := "%s:%d" % [id, i]
			var open: bool = _steps_open.get(key, false)
			var toggle := Button.new()
			toggle.flat = true
			toggle.text = "▾" if open else "▸"
			toggle.tooltip_text = "Ocultar detalle" if open else "Ver detalle"
			toggle.size_flags_vertical = SIZE_SHRINK_BEGIN
			toggle.pressed.connect(func(): _steps_open[key] = not open; _render_detail())
			line.add_child(toggle)
			if open:
				var detail_label := Label.new()
				detail_label.text = detail_text.replace("`", "")
				detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				detail_label.add_theme_color_override("font_color", Color("#a69d8c"))
				var margin := MarginContainer.new()
				margin.add_theme_constant_override("margin_left", 28)
				margin.add_child(detail_label)
				row.add_child(margin)
		steps_box.add_child(row)
	_render_refs(t)


# --- Referencias a documentos (6.7) ----------------------------------------------------------------

func _render_refs(t: Dictionary) -> void:
	for c in refs_box.get_children():
		refs_box.remove_child(c)
		c.queue_free()
	var refs = t.get("refs", [])
	if not refs is Array or refs.is_empty():
		return
	var label := Label.new()
	label.text = "Referencias"
	label.add_theme_color_override("font_color", Color("#a69d8c"))
	refs_box.add_child(label)
	for r in refs:
		var d = board.doc(str(r.get("doc", "")))
		var s = board.section(d, str(r.get("section", "")))
		var key := "%s#%s" % [r.get("doc", ""), r.get("section", "")]
		if s == null:
			var broken := Label.new()
			broken.text = "⚠ Referencia rota: " + key
			broken.add_theme_color_override("font_color", Color("#e8806e"))
			refs_box.add_child(broken)
			continue
		var head := HBoxContainer.new()
		refs_box.add_child(head)
		var open: bool = _refs_open.get(key, false)
		var toggle := Button.new()
		toggle.flat = true
		toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
		toggle.size_flags_horizontal = SIZE_EXPAND_FILL
		toggle.clip_text = true
		toggle.text = ("▾ " if open else "▸ ") + str(s.title).replace("`", "")
		toggle.tooltip_text = "%s#%s" % [d.alias, s.id]
		toggle.pressed.connect(func(): _refs_open[key] = not open; _render_detail())
		head.add_child(toggle)
		if online:
			var web := Button.new()
			web.text = "↗"
			web.tooltip_text = "Abrir en el navegador"
			web.pressed.connect(func(): OS.shell_open("%s/#docs/%s/%s" % [client.base_url(), str(d.alias).uri_encode(), str(s.id).uri_encode()]))
			head.add_child(web)
		if open:
			var box := VBoxContainer.new()
			box.name = "Section"
			refs_box.add_child(box)
			_fill_section(box, d, s)


## La sección en bloques: texto en RichTextLabel y cada snippet en un CodeEdit de solo lectura, con el resaltado
## del editor. Con hub, los bloques los arma el hub (texto en BBCode); sin hub, se parte el markdown de disco.
func _fill_section(box: VBoxContainer, d: Dictionary, s: Dictionary) -> void:
	var key := "%s#%s" % [d.alias, s.id]
	var blocks = _blocks.get(key)
	if blocks == null and online:
		var wait := Label.new()
		wait.text = "Cargando…"
		box.add_child(wait)
		var r := await client.request("GET", "/api/docs/%s/sections/%s?format=blocks" % [str(d.alias).uri_encode(), str(s.id).uri_encode()])
		if not is_instance_valid(box):
			return
		wait.queue_free()
		if r.code != 200:
			var err := Label.new()
			err.text = "No se pudo traer la sección."
			box.add_child(err)
			return
		blocks = r.json.blocks
		_blocks[key] = blocks
	elif blocks == null:
		var lines: PackedStringArray = d.get("lines", PackedStringArray())
		blocks = split_blocks(lines.slice(s.start, s.end))
	for b in blocks:
		if b.type == "code":
			box.add_child(_code_view(str(b.code), str(b.get("lang", ""))))
		else:
			var text := RichTextLabel.new()
			text.fit_content = true
			text.selection_enabled = true
			text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			text.bbcode_enabled = b.has("bbcode")
			text.text = str(b.get("bbcode", b.get("text", "")))
			box.add_child(text)


func _code_view(code: String, lang: String) -> CodeEdit:
	var ce := CodeEdit.new()
	ce.text = code
	ce.editable = false
	ce.scroll_fit_content_height = true
	ce.gutters_draw_line_numbers = false
	ce.minimap_draw = false
	ce.highlight_current_line = false
	ce.wrap_mode = TextEdit.LINE_WRAPPING_NONE
	ce.size_flags_horizontal = SIZE_EXPAND_FILL
	ce.syntax_highlighter = make_highlighter.call(lang)
	return ce


## Parte el markdown de una sección en bloques de texto (plano) y de código, igual que renderBlocks del hub.
static func split_blocks(lines: PackedStringArray) -> Array:
	var blocks := []
	var buf := PackedStringArray()
	var fence := ""
	var lang := ""
	var id_line := RegEx.create_from_string("^\\s*<!--\\s*id:\\s*[a-z0-9][a-z0-9_-]*\\s*-->\\s*$")
	var fence_re := RegEx.create_from_string("^\\s{0,3}(```|~~~)\\s*([\\w+-]*)")
	for line in lines:
		if id_line.search(line):
			continue
		var f := fence_re.search(line)
		if fence == "" and f:
			var chunk := "\n".join(buf).strip_edges()
			if chunk != "":
				blocks.append({ "type": "text", "text": chunk })
			buf = PackedStringArray()
			fence = f.get_string(1)
			lang = "gdscript" if f.get_string(2) == "gd" else f.get_string(2)
			continue
		if fence != "" and f and f.get_string(1) == fence and f.get_string(2) == "":
			blocks.append({ "type": "code", "lang": lang, "code": "\n".join(buf) })
			buf = PackedStringArray()
			fence = ""
			continue
		buf.append(line)
	if fence != "":
		blocks.append({ "type": "code", "lang": lang, "code": "\n".join(buf) })
	elif "\n".join(buf).strip_edges() != "":
		blocks.append({ "type": "text", "text": "\n".join(buf).strip_edges() })
	return blocks


const _KEYWORDS := ["func", "var", "const", "class_name", "extends", "if", "elif", "else", "for", "while", "match",
	"return", "pass", "break", "continue", "signal", "enum", "static", "await", "in", "is", "as", "not", "and", "or",
	"self", "super", "true", "false", "null", "void", "class"]
const _TYPES := ["int", "float", "bool", "String", "StringName", "Array", "Dictionary", "Vector2", "Vector3", "Node",
	"Node2D", "Node3D", "Resource", "Color", "Callable", "PackedStringArray"]


## Resaltado básico de GDScript para cuando no hay editor (el plugin usa el del editor).
static func basic_highlighter(lang: String) -> SyntaxHighlighter:
	if lang != "gdscript":
		return null
	var h := CodeHighlighter.new()
	for k in _KEYWORDS:
		h.add_keyword_color(k, Color("#ff7085"))
	for t in _TYPES:
		h.add_keyword_color(t, Color("#8effda"))
	h.number_color = Color("#a1ffe0")
	h.function_color = Color("#57b3ff")
	h.symbol_color = Color("#abc9ff")
	h.member_variable_color = Color("#dfe2e6")
	h.add_color_region("#", "", Color("#8a929c"), true)
	h.add_color_region("\"", "\"", Color("#ffeda1"))
	h.add_color_region("@", " ", Color("#ffb373"), false)
	return h


static func _toggled(t: Dictionary, index: int, on: bool) -> Array:
	var out := []
	var cl = t.get("checklist", [])
	for j in (cl.size() if cl is Array else 0):
		var c: Dictionary = cl[j].duplicate()
		if j == index:
			c["done"] = on
		out.append(c)
	return out


# --- Eventos ---------------------------------------------------------------------------------

func _on_milestone_selected(index: int) -> void:
	current_milestone = milestone_select.get_item_metadata(index)
	set_pref.call("milestone", current_milestone)
	selected_task = ""
	_render()


func _on_item_selected() -> void:
	var it := tree.get_selected()
	var id = it.get_metadata(0) if it else null
	if id is String and not id.begins_with("status:"):
		selected_task = id
		_render_detail()


func _on_item_collapsed(it: TreeItem) -> void:
	var m = it.get_metadata(0)
	if m is String and m.begins_with("status:"):
		_collapsed[m.trim_prefix("status:")] = it.collapsed


## Archivos de compass/ con cambios sin commitear; -1 si no hay git o no es un repo.
func _count_uncommitted() -> int:
	if project_root == "":
		return -1
	var out := []
	var code := OS.execute("git", ["-C", project_root, "status", "--porcelain", "--", "compass"], out)
	if code != 0 or out.is_empty():
		return -1
	var lines := str(out[0]).strip_edges()
	return 0 if lines == "" else lines.split("\n").size()


# --- Para los tests ----------------------------------------------------------------------------

## El checkbox del paso i del detalle.
func step_checkbox(i: int) -> CheckBox:
	return steps_box.get_child(i).get_child(0).get_child(0)


## Ids de las tareas visibles en la lista, en orden, con el estado de su grupo: ["doing:m0-03", …].
func listed() -> Array:
	var out := []
	var root := tree.get_root()
	if root == null:
		return out
	for g in root.get_children():
		var status := str(g.get_metadata(0)).trim_prefix("status:")
		for it in g.get_children():
			out.append(status + ":" + str(it.get_metadata(0)))
	return out
