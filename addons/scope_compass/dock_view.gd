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

var banner: PanelContainer
var banner_title: Label
var warnings_label: Label
var milestone_select: OptionButton
var reload_button: Button
var browser_button: Button
var new_row: HBoxContainer
var new_title: LineEdit
var tree: Tree
var detail: VBoxContainer
var detail_title: Label
var status_select: OptionButton
var steps_box: VBoxContainer
var notice: Label
var footer_dot: ColorRect
var footer_label: Label
var footer_right: Label
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

	detail = VBoxContainer.new()
	add_child(detail)
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
		var cb := CheckBox.new()
		cb.text = str(cl[i].get("text", "")).replace("`", "")
		cb.button_pressed = cl[i].get("done", false)
		cb.disabled = not online
		cb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var id: String = t.id
		cb.toggled.connect(func(on: bool): update_task(id, func(cur): return { "checklist": _toggled(cur, i, on) }))
		steps_box.add_child(cb)


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
