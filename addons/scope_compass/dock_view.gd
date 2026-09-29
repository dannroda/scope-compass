@tool
extends VBoxContainer
## Vista del dock "Tablero" (mockups Dock_Tasks y Dock_Offline). Es un Control común: el plugin la pone
## dentro de un EditorDock y los tests la instancian sin editor.

const Reader := preload("compass_reader.gd")
const Board := preload("board.gd")

## Preferencias por proyecto. El plugin las guarda en la metadata del proyecto del editor.
var get_pref: Callable = func(_key: String, default): return default
var set_pref: Callable = func(_key: String, _value): pass

var project_root := ""
var board := Board.new()
var online := false
var current_milestone := ""
var selected_task := ""
var _collapsed := { "done": true }
var _uncommitted := -1
var _read_at := 0

var banner: PanelContainer
var banner_title: Label
var warnings_label: Label
var milestone_select: OptionButton
var reload_button: Button
var tree: Tree
var detail: VBoxContainer
var detail_title: Label
var status_select: OptionButton
var steps_box: VBoxContainer
var footer_dot: ColorRect
var footer_label: Label
var footer_right: Label
var _poll: Timer


func _init() -> void:
	name = "Tablero"
	size_flags_vertical = SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 6)
	_build()


## Punto de entrada: la raíz del proyecto (donde está compass/).
func setup(root: String) -> void:
	project_root = root
	reload()


func reload() -> void:
	board.load_from(Reader.read(project_root))
	_read_at = Time.get_unix_time_from_system()
	_uncommitted = _count_uncommitted()
	var remembered: String = get_pref.call("milestone", "")
	if current_milestone == "" or board.milestone(current_milestone) == null:
		current_milestone = remembered if board.milestone(remembered) != null else board.default_milestone()
	if selected_task != "" and board.task(selected_task) == null:
		selected_task = ""
	_render()


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
	retry.pressed.connect(reload)
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
	srow.add_child(status_select)
	steps_box = VBoxContainer.new()
	detail.add_child(steps_box)

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

	# Sin hub, se relee compass/ cada 5 s: una edición a mano o un git pull se ven solos.
	_poll = Timer.new()
	_poll.wait_time = 5.0
	_poll.timeout.connect(func(): if not online and project_root != "": reload())
	add_child(_poll)


func _ready() -> void:
	_poll.start()


# --- Render ----------------------------------------------------------------------------------

func _render() -> void:
	banner.visible = not online
	banner_title.text = "No hay hub en 127.0.0.1:%d" % board.port()
	warnings_label.visible = board.warnings.size() > 0
	warnings_label.text = "\n".join(board.warnings.map(func(w): return "%s · %s" % [w.path, w.message]))

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
	var parts := []
	if _uncommitted >= 0:
		parts.append("compass: %d sin commitear" % _uncommitted)
	footer_right.text = " · ".join(parts)


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
		c.queue_free()
	var cl = t.get("checklist", [])
	for i in (cl.size() if cl is Array else 0):
		var cb := CheckBox.new()
		cb.text = str(cl[i].get("text", "")).replace("`", "")
		cb.button_pressed = cl[i].get("done", false)
		cb.disabled = not online
		cb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		steps_box.add_child(cb)


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
