@tool
extends ScrollContainer
## Detalle de la tarea abierta en el dock: estado y pasos (lo único que se edita acá), fecha, propiedades,
## descripción, capturas, vínculos, referencias a documentos y archivos del repo. Se desplaza solo: una tarea con
## muchos pasos no le quita lugar a la lista. Lo que necesita del tablero (la tarea, el hub, escribir) lo toma de view.

const Board := preload("board.gd")

## Ancho mínimo de los textos con ajuste de línea. Sin esto, mientras el dock está en una pestaña oculta mide 0 de
## ancho, cada palabra va en su renglón y el alto mínimo (miles de px) desacomoda todo el editor.
const WRAP_MIN_WIDTH := 140
const BLOCKED_COLOR := Color("#e8806e")
## Fecha límite: vencida (el mismo rojo) y de hoy.
const OVERDUE_COLOR := Color("#e8806e")
const TODAY_COLOR := Color("#e0a95a")
const MUTED_COLOR := Color("#a69d8c")
const PRIORITIES := { "high": "Alta", "medium": "Media", "low": "Baja" }
const LINK_KINDS := [["blocked_by", "Bloqueada por"], ["blocks", "Bloquea a"], ["related", "Relacionada con"]]

## La vista del dock (dock_view.gd).
var view: Control

var box: VBoxContainer
var title_label: Label
## Abre la tarea abierta en la web (19.11): ahí se edita lo que el dock solo muestra.
var web_button: Button
var hint: Label
## Fecha límite de la tarea abierta (solo lectura: se edita en la web o con `scompass set --due`).
var due_label: Label
var props_label: Label
## Qué hay que hacer y por qué (D37). Solo lectura: se edita en la web o con `scompass set --description`.
var description_label: Label
## Capturas de la tarea (18.4): miniaturas; un clic abre la imagen con el visor del sistema.
var images_box: HFlowContainer
var status_select: OptionButton
var steps_box: VBoxContainer
## Vínculos con otras tareas (solo lectura: se editan en la web o con `scompass link`).
var links_box: VBoxContainer
var refs_box: VBoxContainer
var files_box: VBoxContainer
## Referencias desplegadas ("ruta#id") y bloques de las secciones pedidas al hub (6.7).
var _refs_open := {}
## Pasos con el detalle desplegado ("tarea:índice").
var _steps_open := {}
var _blocks := {}
## Miniaturas ya decodificadas (19.9): ruta absoluta → { "stamp": modificado y tamaño, "tex": ImageTexture o null si no
## se pudo cargar }. Sin esto, cada render leía y achicaba las capturas del disco.
var _thumbs := {}


func _init(v: Control) -> void:
	view = v
	size_flags_vertical = SIZE_EXPAND_FILL
	horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	custom_minimum_size.y = 60
	box = VBoxContainer.new()
	box.size_flags_horizontal = SIZE_EXPAND_FILL
	add_child(box)
	var trow := HBoxContainer.new()
	box.add_child(trow)
	title_label = _wrapping_label()
	title_label.size_flags_horizontal = SIZE_EXPAND_FILL
	title_label.add_theme_font_size_override("font_size", 15)
	trow.add_child(title_label)
	web_button = view.icon_button("browser", "Abrir esta tarea en el navegador, donde se edita todo")
	web_button.size_flags_vertical = SIZE_SHRINK_BEGIN
	web_button.pressed.connect(func(): OS.shell_open(view.web_url("#task/" + view.selected_task.uri_encode())))
	trow.add_child(web_button)
	hint = _wrapping_label()
	hint.text = "Acá se cambian el estado y los pasos; lo demás, en el navegador (↗)."
	hint.add_theme_color_override("font_color", Color(1, 1, 1, 0.45))
	hint.add_theme_font_size_override("font_size", 11)
	box.add_child(hint)
	due_label = Label.new()
	box.add_child(due_label)
	props_label = _wrapping_label()
	box.add_child(props_label)
	var srow := HBoxContainer.new()
	box.add_child(srow)
	var slabel := Label.new()
	slabel.text = "Estado"
	srow.add_child(slabel)
	status_select = OptionButton.new()
	status_select.size_flags_horizontal = SIZE_EXPAND_FILL
	for s in Board.STATUSES:
		status_select.add_item(s.label)
		status_select.set_item_metadata(status_select.item_count - 1, s.id)
	status_select.item_selected.connect(func(i): if view.selected_task != "": view.update_task(view.selected_task, { "status": status_select.get_item_metadata(i) }))
	srow.add_child(status_select)
	description_label = _wrapping_label()
	box.add_child(description_label)
	images_box = HFlowContainer.new()
	box.add_child(images_box)
	steps_box = VBoxContainer.new()
	box.add_child(steps_box)
	links_box = VBoxContainer.new()
	box.add_child(links_box)
	refs_box = VBoxContainer.new()
	box.add_child(refs_box)
	files_box = VBoxContainer.new()
	box.add_child(files_box)


static func _wrapping_label() -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = WRAP_MIN_WIDTH
	return l


static func _section_label(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", MUTED_COLOR)
	return l


static func _clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()


## Responsable y etiquetas de la tarea (M11, spec §19), para la lista y el detalle: "@ana", "#arte #audio".
static func who_and_tags(t: Dictionary) -> Array:
	var out := []
	if str(t.get("assignee", "")) != "":
		out.append("@" + str(t.assignee))
	var tags = t.get("tags", [])
	if tags is Array and not tags.is_empty():
		out.append(" ".join(tags.map(func(x): return "#" + str(x))))
	return out


static func files_of(t) -> Array:
	var f = t.get("files", []) if t is Dictionary else []
	return f if f is Array else []


## Se olvida el BBCode de las secciones de un documento que cambió.
func forget_doc(alias: String) -> void:
	for k in _blocks.keys():
		if str(k).begins_with(alias + "#"):
			_blocks.erase(k)


func render() -> void:
	var online: bool = view.online
	var t = view.board.task(view.selected_task)
	visible = t != null
	if t == null:
		return
	title_label.text = (((str(t.code) + " ") if str(t.get("code", "")) != "" else "") + str(t.title)).replace("`", "")
	web_button.visible = online
	hint.visible = online
	var due := str(t.get("due", ""))
	var ds := Board.due_state(t)
	due_label.visible = due != ""
	due_label.text = ("Vencida · " if ds == "overdue" else "Vence hoy · " if ds == "today" else "Vence ") + Board.show_due(due) if due != "" else ""
	if ds == "overdue":
		due_label.add_theme_color_override("font_color", OVERDUE_COLOR)
	elif ds == "today":
		due_label.add_theme_color_override("font_color", TODAY_COLOR)
	else:
		due_label.remove_theme_color_override("font_color")
	var prio := str(t.get("priority", ""))
	var size := str(t.get("size", ""))
	var props := (["Prioridad " + PRIORITIES[prio].to_lower()] if PRIORITIES.has(prio) else []) + (["Tamaño " + size.to_upper()] if size != "" else []) + who_and_tags(t)
	props_label.visible = not props.is_empty()
	props_label.text = " · ".join(props)
	for i in status_select.item_count:
		if status_select.get_item_metadata(i) == t.status:
			status_select.select(i)
	status_select.disabled = not online
	var description := str(t.get("description", ""))
	description_label.visible = description != ""
	description_label.text = description.replace("`", "")
	_render_images(t)
	_render_steps(t)
	_render_links(t)
	_render_refs(t)
	_render_files(t)


# --- Pasos ---------------------------------------------------------------------------------------

func _render_steps(t: Dictionary) -> void:
	_clear(steps_box)
	var cl = t.get("checklist", [])
	for i in (cl.size() if cl is Array else 0):
		# Cada paso: el checkbox con el texto corto y, si tiene detalle, ▸ para desplegarlo debajo.
		var row := VBoxContainer.new()
		var line := HBoxContainer.new()
		row.add_child(line)
		# El cuadradito tilda; el texto (y ▸) despliega el detalle. Tildar al tocar el texto era contraintuitivo.
		var cb := CheckBox.new()
		cb.button_pressed = cl[i].get("done", false)
		cb.disabled = not view.online
		cb.size_flags_vertical = SIZE_SHRINK_BEGIN
		cb.tooltip_text = "Marcar como hecho"
		var id: String = t.id
		cb.toggled.connect(func(on: bool): view.update_task(id, func(cur): return { "checklist": _toggled(cur, i, on) }))
		var cb_box := MarginContainer.new() # para alinear el cuadradito con la primera línea del texto
		cb_box.size_flags_vertical = SIZE_SHRINK_BEGIN
		cb_box.add_child(cb)
		line.add_child(cb_box)
		var detail_text := str(cl[i].get("detail", ""))
		var key := "%s:%d" % [id, i]
		var open: bool = _steps_open.get(key, false)
		var toggle_detail := func(): _steps_open[key] = not open; render()
		var label := Button.new()
		label.flat = true
		label.alignment = HORIZONTAL_ALIGNMENT_LEFT
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		label.custom_minimum_size.x = WRAP_MIN_WIDTH
		label.size_flags_horizontal = SIZE_EXPAND_FILL
		label.text = str(cl[i].get("text", "")).replace("`", "")
		label.focus_mode = Control.FOCUS_NONE if detail_text == "" else Control.FOCUS_ALL
		label.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if detail_text != "" else Control.CURSOR_ARROW
		label.tooltip_text = ("Ocultar detalle" if open else "Ver detalle") if detail_text != "" else ""
		if cl[i].get("done", false):
			label.add_theme_color_override("font_color", MUTED_COLOR)
		if detail_text != "":
			label.pressed.connect(toggle_detail)
		line.add_child(label)
		# El centro del cuadradito, a la altura del centro de la primera línea del texto (el botón tiene relleno).
		var sb := label.get_theme_stylebox("normal")
		var first_line := label.get_theme_font("font").get_height(label.get_theme_font_size("font_size"))
		var center := sb.get_margin(SIDE_TOP) + first_line / 2.0
		cb_box.add_theme_constant_override("margin_top", maxi(0, roundi(center - cb.get_combined_minimum_size().y / 2.0)))
		if detail_text != "":
			var toggle := Button.new()
			toggle.flat = true
			view.fold_icon(open, toggle)
			toggle.tooltip_text = "Ocultar detalle" if open else "Ver detalle"
			toggle.size_flags_vertical = SIZE_SHRINK_BEGIN
			toggle.pressed.connect(toggle_detail)
			line.add_child(toggle)
			if open:
				var detail_label := _wrapping_label()
				detail_label.text = detail_text.replace("`", "")
				detail_label.add_theme_color_override("font_color", MUTED_COLOR)
				var margin := MarginContainer.new()
				margin.add_theme_constant_override("margin_left", 28)
				margin.add_child(detail_label)
				row.add_child(margin)
		steps_box.add_child(row)


static func _toggled(t: Dictionary, index: int, on: bool) -> Array:
	var out := []
	var cl = t.get("checklist", [])
	for j in (cl.size() if cl is Array else 0):
		var c: Dictionary = cl[j].duplicate()
		if j == index:
			c["done"] = on
		out.append(c)
	return out


## El checkbox del paso i (para los tests).
func step_checkbox(i: int) -> CheckBox:
	return steps_box.get_child(i).get_child(0).get_child(0).get_child(0)


# --- Capturas (18.4) -----------------------------------------------------------------------------

func _render_images(t: Dictionary) -> void:
	_clear(images_box)
	var images = t.get("images", [])
	images_box.visible = images is Array and not images.is_empty()
	if not images_box.visible:
		return
	for p in images:
		var abs_path: String = view.project_root.path_join(str(p))
		if not FileAccess.file_exists(abs_path):
			var gone := Label.new()
			gone.text = "⚠ " + str(p).get_file()
			gone.tooltip_text = str(p) + "\nNo está en el disco"
			gone.add_theme_color_override("font_color", OVERDUE_COLOR)
			images_box.add_child(gone)
			continue
		var tex = _thumb(abs_path)
		var b: BaseButton
		if tex == null:
			# Godot no carga GIF, y una imagen rota tampoco: un botón con el nombre, que igual la abre.
			b = Button.new()
			b.text = "▣ " + str(p).get_file()
			b.flat = true
		else:
			var tb := TextureButton.new()
			tb.ignore_texture_size = true
			tb.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
			tb.custom_minimum_size = Vector2(96, 72)
			tb.texture_normal = tex
			b = tb
		b.tooltip_text = str(p) + "\nAbrir con el visor del sistema"
		b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		b.pressed.connect(func(): OS.shell_open(abs_path))
		images_box.add_child(b)


## La miniatura de una captura (192 px de ancho como mucho), decodificada una sola vez mientras el archivo no cambie.
## null si Godot no la puede cargar (un GIF, una imagen rota); eso también se recuerda, para no reintentar.
func _thumb(abs_path: String):
	var stamp := "%d:%d" % [FileAccess.get_modified_time(abs_path), FileAccess.get_size(abs_path)]
	var hit = _thumbs.get(abs_path)
	if hit is Dictionary and hit.stamp == stamp:
		return hit.tex
	var tex = null
	# Image.load_from_file imprime un error con un GIF: se mira la firma antes.
	var f := FileAccess.open(abs_path, FileAccess.READ)
	var head := f.get_buffer(4) if f else PackedByteArray()
	f = null
	if head.size() == 4 and head.get_string_from_ascii() != "GIF8":
		var img := Image.new()
		if img.load(abs_path) == OK and not img.is_empty():
			if img.get_width() > 192:
				img.resize(192, maxi(1, int(192.0 * img.get_height() / img.get_width())))
			tex = ImageTexture.create_from_image(img)
	_thumbs[abs_path] = { "stamp": stamp, "tex": tex }
	return tex


# --- Vínculos entre tareas -----------------------------------------------------------------------

func _render_links(t: Dictionary) -> void:
	_clear(links_box)
	var board = view.board
	var v: Dictionary = board.link_view(t.id)
	if v.blocks.is_empty() and v.blocked_by.is_empty() and v.related.is_empty():
		return
	links_box.add_child(_section_label("Vínculos"))
	for kind in LINK_KINDS:
		for id in v[kind[0]]:
			var other = board.task(id)
			var b := Button.new()
			b.flat = true
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			b.custom_minimum_size.x = WRAP_MIN_WIDTH
			var status := ""
			for s in Board.STATUSES:
				if other != null and s.id == other.status:
					status = " · " + s.label
			b.text = "%s: %s%s" % [kind[1], board.task_name(id), status]
			# En rojo: el vínculo roto, o la tarea sin terminar que bloquea a esta.
			if other == null or (kind[0] == "blocked_by" and other.status != "done" and t.status != "done"):
				b.add_theme_color_override("font_color", BLOCKED_COLOR)
			if other == null:
				b.disabled = true
			else:
				b.tooltip_text = "Ir a la tarea"
				b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
				b.pressed.connect(view.go_to_task.bind(id))
			links_box.add_child(b)


# --- Archivos del repo (15.3, 15.4) --------------------------------------------------------------

## Archivos del repo que toca la tarea (15.3): un clic lo abre en el editor. En rojo, el que ya no está en el disco.
## Con hub, el script o la escena que se editan y la tarea no cita se pueden vincular (15.4).
func _render_files(t: Dictionary) -> void:
	_clear(files_box)
	var files := files_of(t)
	var linkable := []
	for kind in ["script", "scene"]:
		var editing: String = view.editing[kind]
		if view.online and editing != "" and not files.has(editing):
			linkable.append(editing)
	if files.is_empty() and linkable.is_empty():
		return
	files_box.add_child(_section_label("Archivos"))
	for f in files:
		var b := Button.new()
		b.flat = true
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		b.custom_minimum_size.x = WRAP_MIN_WIDTH
		b.text = str(f)
		b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		if FileAccess.file_exists(view.project_root.path_join(str(f))):
			b.tooltip_text = "Abrir en el editor"
		else:
			b.tooltip_text = "No está en el disco: se movió o se borró"
			b.add_theme_color_override("font_color", BLOCKED_COLOR)
		b.pressed.connect(open_task_file.bind(str(f)))
		files_box.add_child(b)
	for p in linkable:
		var add := Button.new()
		add.flat = true
		add.alignment = HORIZONTAL_ALIGNMENT_LEFT
		add.text = "+ Vincular " + str(p).get_file()
		add.tooltip_text = "Agregar a la tarea %s, que estás editando" % p
		var id: String = t.id
		add.pressed.connect(func(): view.update_task(id, func(cur): return {} if files_of(cur).has(p) else { "files": files_of(cur) + [p] }))
		files_box.add_child(add)


## Un archivo de la tarea: en el editor si Godot lo ve; si no (markdown, compass/, lo que tiene .gdignore), en la
## pestaña Archivos de la web.
func open_task_file(path: String) -> void:
	if view.open_file.call(path):
		return
	if view.online:
		OS.shell_open(view.web_url("#files/" + path.uri_encode()))
	else:
		view.show_notice("Godot no abre %s. Con el hub iniciado, se abre en la pestaña Archivos del navegador." % path)


# --- Referencias a documentos (6.7) ----------------------------------------------------------------

func _render_refs(t: Dictionary) -> void:
	_clear(refs_box)
	var refs = t.get("refs", [])
	if not refs is Array or refs.is_empty():
		return
	refs_box.add_child(_section_label("Referencias"))
	for r in refs:
		var d = view.board.doc(str(r.get("doc", "")))
		# Sin sección, la referencia es al documento entero (12.1): no se despliega, se abre en el navegador.
		if str(r.get("section", "")) == "":
			_render_whole_ref(r, d)
			continue
		var s = view.board.section(d, str(r.get("section", "")))
		var key := "%s#%s" % [r.get("doc", ""), r.get("section", "")]
		if s == null:
			var broken := Label.new()
			broken.text = "⚠ Referencia rota: " + key
			broken.add_theme_color_override("font_color", BLOCKED_COLOR)
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
		view.fold_icon(open, toggle, str(s.title).replace("`", ""))
		toggle.tooltip_text = "%s#%s" % [d.alias, s.id]
		toggle.pressed.connect(func(): _refs_open[key] = not open; render())
		head.add_child(toggle)
		if view.online:
			var web: Button = view.icon_button("browser", "Abrir en el navegador")
			web.pressed.connect(func(): OS.shell_open(view.web_url("#docs/%s/%s" % [str(d.alias).uri_encode(), str(s.id).uri_encode()])))
			head.add_child(web)
		if open:
			var section_box := VBoxContainer.new()
			section_box.name = "Section"
			refs_box.add_child(section_box)
			_fill_section(section_box, d, s)


func _render_whole_ref(r: Dictionary, d) -> void:
	if d == null:
		var broken := Label.new()
		broken.text = "⚠ Referencia rota: %s no está" % r.get("doc", "")
		broken.add_theme_color_override("font_color", BLOCKED_COLOR)
		refs_box.add_child(broken)
		return
	var head := HBoxContainer.new()
	refs_box.add_child(head)
	var title := Label.new()
	title.name = "WholeDoc"
	title.text = "▤ " + _doc_title(d)
	title.tooltip_text = "%s · documento entero" % d.path
	title.mouse_filter = Control.MOUSE_FILTER_PASS
	title.size_flags_horizontal = SIZE_EXPAND_FILL
	title.clip_text = true
	head.add_child(title)
	if view.online:
		var web: Button = view.icon_button("browser", "Abrir en el navegador")
		web.pressed.connect(func(): OS.shell_open(view.web_url("#docs/" + str(d.alias).uri_encode())))
		head.add_child(web)


## Título de un documento: su primer título de nivel 1, o la ruta (como docTitle en web/app.js).
static func _doc_title(d: Dictionary) -> String:
	for s in d.sections:
		if int(s.level) == 1:
			return str(s.title).replace("`", "")
	return str(d.path)


## La sección en bloques: texto en RichTextLabel y cada snippet en un CodeEdit de solo lectura, con el resaltado
## del editor. Con hub, los bloques los arma el hub (texto en BBCode); sin hub, se parte el markdown de disco.
func _fill_section(section_box: VBoxContainer, d: Dictionary, s: Dictionary) -> void:
	var key := "%s#%s" % [d.alias, s.id]
	var blocks = _blocks.get(key)
	if blocks == null and view.online:
		var wait := Label.new()
		wait.text = "Cargando…"
		section_box.add_child(wait)
		var r: Dictionary = await view.client.request("GET", "/api/docs/%s/sections/%s?format=blocks" % [str(d.alias).uri_encode(), str(s.id).uri_encode()])
		if not is_instance_valid(section_box):
			return
		wait.queue_free()
		if r.code != 200:
			var err := Label.new()
			err.text = "No se pudo traer la sección."
			section_box.add_child(err)
			return
		blocks = r.json.blocks
		_blocks[key] = blocks
	elif blocks == null:
		var lines: PackedStringArray = d.get("lines", PackedStringArray())
		blocks = split_blocks(lines.slice(s.start, s.end))
	for b in blocks:
		if b.type == "code":
			section_box.add_child(_code_view(str(b.code), str(b.get("lang", ""))))
		else:
			var text := RichTextLabel.new()
			text.fit_content = true
			text.selection_enabled = true
			text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			text.custom_minimum_size.x = WRAP_MIN_WIDTH
			text.bbcode_enabled = b.has("bbcode")
			text.text = str(b.get("bbcode", b.get("text", "")))
			section_box.add_child(text)


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
	ce.syntax_highlighter = view.make_highlighter.call(lang)
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
