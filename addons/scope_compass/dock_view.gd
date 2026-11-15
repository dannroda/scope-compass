@tool
extends VBoxContainer
## Vista del dock "Tablero" (mockups Dock_Tasks y Dock_Offline). Es un Control común: el plugin la pone
## dentro de un EditorDock y los tests la instancian sin editor.
## Con hub: carga por HTTP, cambios en vivo por WebSocket y edición. Sin hub: compass/ en solo lectura.
## Acá están la vida del hub, la lista y las escrituras; el detalle de la tarea es task_detail.gd y los procesos
## que lanza el dock (scompass, el hub), hub_process.gd.

signal state_changed(online: bool)
signal loaded

const Reader := preload("compass_reader.gd")
const Board := preload("board.gd")
const HubClient := preload("hub_client.gd")
const HubProcess := preload("hub_process.gd")
const TaskDetail := preload("task_detail.gd")

const WRAP_MIN_WIDTH := TaskDetail.WRAP_MIN_WIDTH
const BLOCKED_COLOR := TaskDetail.BLOCKED_COLOR
const OVERDUE_COLOR := TaskDetail.OVERDUE_COLOR
const TODAY_COLOR := TaskDetail.TODAY_COLOR

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
var hub := HubProcess.new()
var online := false
var current_milestone := ""
var selected_task := ""
var _collapsed := { "done": true }
var _uncommitted := -1
var _loading := false
var _reload_again := false
var _queues := {}
## Iniciar hub en curso (19.10): un segundo clic no lanza otro proceso que pise la tubería del primero.
var _starting := false
## Firma de compass/ en la última lectura sin hub (19.9): si no cambió, el poll no relee ni re-renderiza.
var _compass_stamp := ""

var banner: PanelContainer
var banner_title: Label
var banner_text: Label
var init_button: Button
## Plantilla para "Crear compass/" (8.14): juego por defecto, porque desde el dock es un proyecto de Godot.
var template_select: OptionButton
const TEMPLATES := [["juego", "Juego"], ["personal", "Personal"], ["vacio", "Vacío"]]
var start_button: Button
var open_tasks_button: Button
var warnings_label: Label
## Aviso de que compass/ tiene archivos generados viejos (schema/, AGENTS.md), con el botón para actualizarlos.
var update_row: HFlowContainer
var update_label: Label
## Aviso de que el hub conectado es de otra versión que el addon.
var version_label: Label
## Archivos desactualizados según `scompass update --check`.
var outdated: Array = []
var milestone_select: OptionButton
var reload_button: Button
var browser_button: Button
var files_button: Button
var new_row: HBoxContainer
## Cargar un bug (21.4): menú con la captura que lleva (del juego, del editor o ninguna).
var bug_button: MenuButton
const BUG_SOURCES := [["game", "Con captura del juego"], ["editor", "Con captura del editor"], ["", "Sin captura"]]
## Capturas para los bugs (las pone el plugin): la ventana del juego que corre desde el editor (por el depurador) y la
## pantalla principal del editor. Devuelven un Image, o null si no se pudo; game_running dice si hay juego.
var capture_game: Callable = func(): return null
var capture_editor: Callable = func(): return null
var game_running: Callable = func() -> bool: return false
## Tareas sin terminar que citan el script o la escena que se editan (15.4).
var editing_box: VBoxContainer
## Lo que se edita en Godot, con la ruta desde la raíz del proyecto ("" si nada): lo avisa el plugin.
var editing := { "script": "", "scene": "" }
var new_title: LineEdit
var tree: Tree
## Lista de tareas y detalle, con divisor arrastrable; el bloque de tareas se puede plegar.
var split: VSplitContainer
var tasks_header: Button
## Filtra la lista por código, título o id en todos los hitos (21.5); vacía, la lista es la del hito.
var search: LineEdit
var tasks_collapsed := false
## La tarea abierta (task_detail.gd), debajo de la lista.
var detail: TaskDetail
## Abre un archivo del repo en el editor (lo pone el plugin, 15.3). false si Godot no lo ve: el dock va a la web.
var open_file: Callable = func(_path: String) -> bool: return false
## Resaltado para los CodeEdit de los snippets. El plugin pasa el GDScriptSyntaxHighlighter del editor; fuera
## del editor (tests) queda un CodeHighlighter básico.
var make_highlighter: Callable = func(lang: String): return TaskDetail.basic_highlighter(lang)
var notice: Label
var footer_dot: ColorRect
var footer_label: Label
var footer_right: Label
var restart_button: Button
var _poll: Timer
## Puerto del Inicio que se negó a servir el proyecto (21.1): el sondeo no le vuelve a pedir; -1 si ninguno.
var _home_refused := -1
var _notice_timer: Timer


func _init() -> void:
	name = "Tablero"
	size_flags_vertical = SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 6)
	add_child(client)
	add_child(hub)
	client.went_online.connect(_on_online)
	client.went_offline.connect(_on_offline)
	client.event_received.connect(_on_event)
	_build()


## Punto de entrada: la raíz del proyecto (donde está compass/).
func setup(root: String) -> void:
	project_root = root
	client.project_root = root
	hub.project_root = root
	await reload()
	await check_compass()
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
		var pre := ""
		if data == null:
			pre = _stamp_compass()
			data = Reader.read(project_root)
		board.load_from(data)
		# Lo de compass/ se firma antes de leer (un cambio durante la lectura se ve en el próximo poll); los
		# documentos, con la config recién leída.
		_compass_stamp = pre + _stamp_docs() if pre != "" else ""
		if not _reload_again:
			break
	_loading = false
	# Solo el puerto de la config: el que se usa lo elige detect() (que vuelve a la config si no encuentra hub).
	# Pisarlo acá, mientras el WebSocket recién encontrado abre, dejaba el dock en ese puerto con la base del Inicio.
	client.config_port = board.port()
	_uncommitted = _count_uncommitted()
	tasks_collapsed = bool(get_pref.call("tasks_collapsed", false))
	var remembered: String = get_pref.call("milestone", "")
	if current_milestone == "" or board.milestone(current_milestone) == null:
		current_milestone = remembered if board.milestone(remembered) != null else board.default_milestone()
	if selected_task != "" and board.task(selected_task) == null:
		selected_task = ""
	_render()
	loaded.emit()


func _on_retry() -> void:
	client.reset()
	_home_refused = -1
	await reload()
	await _try_hub()
	_render()


## Busca el hub y, si no lo hay pero el Inicio corre, le pide que sirva el proyecto (21.1): el Inicio lo hace al
## primer pedido (D29) y, sin esto, el dock decía "No hay hub" hasta apretar Iniciar hub.
func _try_hub() -> void:
	if online or await client.detect():
		return
	var home := client.home_port()
	if home <= 0 or home == _home_refused or not has_compass():
		return
	var r := await client.request_url("POST", "http://%s:%d/api/projects/activate" % [client.HOST, home], { "path": project_root }, [], 1.0)
	if r.code == 200:
		await client.detect()
	elif r.code != 0:
		# El Inicio respondió que no: no se insiste en cada sondeo (Reintentar vuelve a probar). Si no respondió,
		# puede estar arrancando o ser una entrada vieja del registro: se prueba de nuevo en el próximo.
		_home_refused = home


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
				# Se borró el hito abierto: el que toca por defecto, como al abrir (19.10).
				if msg.collection == "milestones" and msg.id == current_milestone:
					current_milestone = board.default_milestone()
				_render()
		"doc_changed":
			# El documento cambió: se olvida el BBCode de sus secciones y se recarga el índice.
			detail.forget_doc(str(msg.get("alias", "")))
			await reload()
		"git":
			# El hub recuenta después de cada cambio (y mientras haya algo sin commitear, por si se commitea).
			_uncommitted = int(msg.get("uncommitted", 0)) if msg.get("repo", false) else -1
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
	if body.is_empty():
		return
	var r := await client.request("PATCH", "/api/tasks/" + id.uri_encode(), body, ["If-Match: \"%s\"" % t.get("etag", "")])
	if r.code == 200:
		board.apply("tasks", id, r.json)
		_render()
	elif r.code == 409 and r.json is Dictionary and r.json.get("error") is Dictionary and r.json.error.get("current") is Dictionary:
		# Alguien la cambió antes: se toma la versión actual y se avisa (spec §5.3).
		var cur: Dictionary = r.json.error.current
		var doc: Dictionary = cur.doc.duplicate()
		doc["id"] = cur.id
		doc["etag"] = cur.etag
		board.apply("tasks", id, doc)
		_render()
		show_notice("Otra pestaña o la CLI cambió esta tarea; se actualizó. Revisá y volvé a aplicar tu cambio.")
	else:
		show_notice("No se pudo guardar: " + _error_of(r))
		# La casilla o el selector quedaron con lo que no se guardó: se vuelve a mostrar lo que hay (19.10).
		detail.render()


## El mensaje de error de una respuesta del hub, o por qué no hubo respuesta.
static func _error_of(r: Dictionary) -> String:
	if r.json is Dictionary and r.json.get("error") is Dictionary and r.json.error.get("message") is String:
		return r.json.error.message
	return "sin respuesta del hub" if r.code == 0 else "HTTP %d" % r.code


func create_task(title: String) -> void:
	title = title.strip_edges()
	if title == "" or current_milestone == "" or not online:
		return
	await _post_task({ "title": title })


## Crea la tarea en el hito elegido (fields: title y lo que se agregue) y la abre. Devuelve su id, o "" si falló.
func _post_task(fields: Dictionary) -> String:
	var body := { "milestone": current_milestone, "code": "", "status": "todo", "checklist": [], "test": "", "notes": "", "refs": [] }
	body.merge(fields, true)
	var r := await client.request("POST", "/api/tasks", body)
	if r.code != 201:
		show_notice("No se pudo crear la tarea: " + _error_of(r))
		return ""
	board.apply("tasks", r.json.id, r.json)
	selected_task = r.json.id
	# El título se borra recién ahora: si falla, queda para corregirlo o reintentar (19.10).
	if new_title.text.strip_edges() == body.title:
		new_title.clear()
	_render()
	return r.json.id


## Carga un bug (21.4): una tarea con el título de la caja, la etiqueta bug y su plantilla de descripción
## (config.json › description_templates, como al etiquetar en la web o la CLI) y, según source, la captura del juego
## ("game"), la del editor ("editor") o ninguna (""). La captura se toma antes de crear la tarea, para que sea lo que
## se veía; si no se puede, el bug se carga igual y se avisa.
func create_bug(title: String, source := "") -> void:
	title = title.strip_edges()
	if current_milestone == "" or not online:
		return
	if title == "":
		show_notice("Escribí en la caja qué pasa: es el título del bug.")
		if new_title.is_inside_tree():
			new_title.grab_focus()
		return
	var img = null
	if source != "":
		img = await (capture_game if source == "game" else capture_editor).call()
	var fields := { "title": title, "tags": ["bug"] }
	var templates = board.config.get("description_templates") if board.config is Dictionary else null
	if templates is Dictionary and templates.get("bug") is String and str(templates.bug).strip_edges() != "":
		fields["description"] = templates.bug
	var id := await _post_task(fields)
	if id == "":
		return
	var what := "Bug cargado"
	if img is Image and not img.is_empty():
		var r := await client.request("POST", "/api/tasks/%s/images" % id.uri_encode(), { "data": encode_image(img) }, [], 30.0)
		if r.code == 201:
			board.apply("tasks", id, r.json)
			_render()
			what += " con la captura del " + ("juego" if source == "game" else "editor")
		else:
			what += ", pero no se pudo guardar la captura (%s)" % _error_of(r)
	elif source == "game":
		what += " sin captura: el juego no contestó (¿está corriendo, o frenado en un breakpoint?)"
	elif source == "editor":
		what += " sin captura: no se pudo capturar el editor"
	show_notice(what + ". Completá la descripción en el navegador (↗)." if fields.has("description") else what + ".")


## La captura en base64 para POST /api/tasks/<id>/images: PNG, o JPEG si el PNG pasa de 9 MB (el hub acepta hasta 10).
static func encode_image(img: Image) -> String:
	var buf := img.save_png_to_buffer()
	if buf.size() > 9 << 20:
		buf = img.save_jpg_to_buffer(0.9)
	return Marshalls.raw_to_base64(buf)


## La UI web del hub conectado (un hub suelto o el Inicio, con su base), con un #hash opcional.
func web_url(hash := "") -> String:
	return client.base_url() + "/" + hash


## Versión del addon (plugin.cfg, al lado de este script).
func addon_version() -> String:
	var cfg := ConfigFile.new()
	if cfg.load((get_script() as Script).resource_path.get_base_dir().path_join("plugin.cfg")) != OK:
		return ""
	return str(cfg.get_value("plugin", "version", ""))


# --- Crear compass/ ------------------------------------------------------------------------------

## ¿El proyecto ya tiene compass/config.json? (lo mismo que mira `scompass init` para negarse a pisarla).
func has_compass() -> bool:
	return FileAccess.file_exists(project_root.path_join("compass/config.json"))


## La plantilla elegida para crear compass/ ("juego", "personal" o "vacio").
func selected_template() -> String:
	return str(template_select.get_item_metadata(template_select.selected)) if template_select.selected >= 0 else "juego"


## Corre `scompass init --template <elegida>` en el proyecto y recarga el tablero.
func init_compass() -> bool:
	if has_compass():
		return true
	var cmd := scompass_command()
	if cmd.is_empty():
		show_notice("No encontré scompass. Configurá su ruta en Editor Settings › scope_compass/scompass_path.")
		return false
	var r: Array = await _scompass(["init", "--template", selected_template()])
	if r[0] != 0 or not has_compass():
		show_notice("No se pudo crear compass/: " + (r[1] if r[1] != "" else "sin salida de scompass"))
		return false
	show_notice("Creada compass/ (plantilla %s). Ya podés iniciar el hub." % template_select.get_item_text(template_select.selected))
	await reload()
	return true


## Corre scompass en el proyecto, en otro hilo (hub_process.gd): [código, salida]; código -1 si no se encontró.
func _scompass(args: Array) -> Array:
	return await hub.run(scompass_command(), args)


## ¿compass/ tiene archivos generados de una versión anterior de Scope Compass (schema/, AGENTS.md)?
## Se mira al abrir el dock; sin scompass a mano no se puede saber y no se avisa nada.
func check_compass() -> void:
	outdated = []
	if has_compass():
		var r: Array = await _scompass(["update", "--check", "--json"])
		var data = HubClient.parse_json(r[1]) if r[0] == 1 else null
		if data is Dictionary and data.get("outdated") is Array:
			outdated = data.outdated
	_render_update()


## Corre `scompass update`: copia el schema y la guía para agentes de esta versión de Scope Compass.
func update_compass() -> bool:
	var r: Array = await _scompass(["update"])
	if r[0] != 0:
		show_notice("No encontré scompass. Configurá su ruta en Editor Settings › scope_compass/scompass_path." if r[0] == -1 \
			else "No se pudo actualizar compass/: " + r[1])
		return false
	var n := outdated.size()
	await check_compass()
	show_notice("compass/ actualizada (%d archivos). Revisá el cambio y commitealo." % n)
	return true


func _render_update() -> void:
	update_row.visible = not outdated.is_empty()
	update_label.text = "compass/ tiene archivos de una versión anterior de Scope Compass: " + ", ".join(outdated.map(func(p): return str(p).trim_prefix("compass/")))


# --- Iniciar el hub (5.5) ----------------------------------------------------------------------

## Dónde está scompass (hub_process.gd): [programa, args previos], o [] si no se encontró.
func scompass_command() -> Array:
	return hub.command(str(scompass_setting.call()))


## Levanta `scompass serve` para este proyecto y espera a conectarse (hasta 8 s). Con el Inicio corriendo no
## levanta otro proceso: le pide al Inicio que sirva el proyecto (D29) y se conecta ahí.
func start_hub() -> bool:
	if online:
		return true
	if _starting:
		return false
	_starting = true
	start_button.disabled = true
	var ok := await _start_hub()
	_starting = false
	start_button.disabled = false
	return ok


func _start_hub() -> bool:
	var home := client.home_port()
	if home > 0:
		var r := await client.request_url("POST", "http://%s:%d/api/projects/activate" % [client.HOST, home], { "path": project_root })
		if r.code == 200 and await client.detect():
			show_notice("Conectado al Inicio, que sirve este proyecto.")
			return true
		show_notice("El Inicio no pudo servir el proyecto (%s); se levanta un hub propio." % _error_of(r))
	var cmd := scompass_command()
	if cmd.is_empty():
		show_notice("No encontré scompass. Configurá su ruta en Editor Settings › scope_compass/scompass_path.")
		return false
	if not hub.launch(cmd, bool(keep_hub_setting.call())):
		show_notice("No se pudo iniciar el hub con %s." % cmd[0])
		return false
	for i in 32:
		await get_tree().create_timer(0.25).timeout
		if await client.detect() or online:
			break
		if not OS.is_process_running(hub.pid):
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
	if hub.pid > 0:
		var h := await client.request("GET", "/api/health")
		if h.code == 200:
			hub.pid = int(h.json.pid)
	show_notice("Hub reiniciado.")
	return true


## Cierra el hub solo si lo abrió este dock y no está en modo "mantener" (salvo force).
func stop_hub(force := false) -> void:
	hub.stop(force)


func show_notice(text: String) -> void:
	notice.text = text
	notice.visible = true
	_notice_timer.start()


# --- Íconos -------------------------------------------------------------------------------------

## Íconos de @icons (assets/node/…, MIT). Su .import los escala con el editor y los adapta al tema.
const ICONS := {
	"reload": preload("assets/node/arrow_clockwise.svg"),
	"restart": preload("assets/node/arrow_counterclockwise.svg"),
	"browser": preload("assets/node/arrow_up_right.svg"),
	"start": preload("assets/node/play.svg"),
	"folder": preload("assets/node/folder_open.svg"),
}


func icon_button(name: String, tip: String) -> Button:
	var b := Button.new()
	b.icon = ICONS[name]
	b.tooltip_text = tip
	return b


## Flecha de plegado: la del editor (la misma que usa el Tree), o ▸/▾ fuera del editor.
func fold_icon(open: bool, b: Button, label := "") -> void:
	var name := "GuiTreeArrowDown" if open else "GuiTreeArrowRight"
	if has_theme_icon(name, "EditorIcons"):
		b.icon = get_theme_icon(name, "EditorIcons")
		b.text = label
	else:
		b.icon = null
		b.text = ("▾" if open else "▸") + (" " + label if label != "" else "")


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
	# Con autowrap: un error largo ("es el hub de otro proyecto: /ruta/…") pedía casi 1000 px de ancho (19.11).
	banner_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	banner_title.custom_minimum_size.x = WRAP_MIN_WIDTH
	banner_title.add_theme_color_override("font_color", Color("#ffde66"))
	bv.add_child(banner_title)
	banner_text = Label.new()
	banner_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	banner_text.custom_minimum_size.x = WRAP_MIN_WIDTH
	bv.add_child(banner_text)
	# Los botones bajan de renglón en un dock angosto.
	var bb := HFlowContainer.new()
	bv.add_child(bb)
	# Proyecto sin compass/: en lugar de "Iniciar hub" se ofrece crearla.
	init_button = Button.new()
	init_button.text = "Crear compass/"
	init_button.tooltip_text = "Corre `scompass init` en este proyecto"
	init_button.pressed.connect(init_compass)
	template_select = OptionButton.new()
	template_select.tooltip_text = "Plantilla: Juego trae el hito M0, listas de ideas y assets, y docs/gdd.md (si no existe)"
	for t in TEMPLATES:
		template_select.add_item(t[1])
		template_select.set_item_metadata(template_select.item_count - 1, t[0])
	bb.add_child(template_select)
	bb.add_child(init_button)
	start_button = Button.new()
	start_button.text = "Iniciar hub"
	start_button.icon = ICONS.start
	start_button.pressed.connect(start_hub)
	bb.add_child(start_button)
	var retry := Button.new()
	retry.text = "Reintentar"
	retry.pressed.connect(_on_retry)
	bb.add_child(retry)
	open_tasks_button = Button.new()
	open_tasks_button.text = "Abrir compass/tasks"
	open_tasks_button.icon = ICONS.folder
	open_tasks_button.pressed.connect(func(): OS.shell_open(project_root.path_join("compass/tasks")))
	bb.add_child(open_tasks_button)
	add_child(banner)

	warnings_label = Label.new()
	warnings_label.add_theme_color_override("font_color", Color("#e8806e"))
	warnings_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	warnings_label.custom_minimum_size.x = WRAP_MIN_WIDTH
	add_child(warnings_label)

	update_row = HFlowContainer.new()
	update_row.visible = false
	update_label = Label.new()
	update_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	update_label.custom_minimum_size.x = WRAP_MIN_WIDTH
	update_label.size_flags_horizontal = SIZE_EXPAND_FILL
	update_label.add_theme_color_override("font_color", Color("#e0a95a"))
	update_row.add_child(update_label)
	var update_button := Button.new()
	update_button.text = "Actualizar"
	update_button.tooltip_text = "Corre `scompass update` en este proyecto"
	update_button.pressed.connect(update_compass)
	update_row.add_child(update_button)
	add_child(update_row)

	version_label = Label.new()
	version_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	version_label.custom_minimum_size.x = WRAP_MIN_WIDTH
	version_label.add_theme_color_override("font_color", Color("#e0a95a"))
	version_label.visible = false
	add_child(version_label)

	var head := HBoxContainer.new()
	add_child(head)
	milestone_select = OptionButton.new()
	milestone_select.size_flags_horizontal = SIZE_EXPAND_FILL
	milestone_select.clip_text = true
	# Sin esto el ancho mínimo del dock es el del hito con el nombre más largo.
	milestone_select.fit_to_longest_item = false
	milestone_select.tooltip_text = "Hito"
	milestone_select.item_selected.connect(_on_milestone_selected)
	head.add_child(milestone_select)
	reload_button = icon_button("reload", "Recargar")
	reload_button.pressed.connect(reload)
	head.add_child(reload_button)
	browser_button = icon_button("browser", "Abrir el tablero en el navegador")
	browser_button.pressed.connect(func(): OS.shell_open(web_url()))
	head.add_child(browser_button)
	files_button = icon_button("folder", "Ver los archivos del repo y su estado de git en el navegador")
	files_button.pressed.connect(func(): OS.shell_open(web_url("#files")))
	head.add_child(files_button)

	new_row = HBoxContainer.new()
	add_child(new_row)
	new_title = LineEdit.new()
	new_title.placeholder_text = "Nueva tarea en este hito"
	new_title.size_flags_horizontal = SIZE_EXPAND_FILL
	new_title.text_submitted.connect(func(t): create_task(t))
	new_row.add_child(new_title)
	var add := Button.new()
	add.text = "Agregar"
	add.pressed.connect(func(): create_task(new_title.text))
	new_row.add_child(add)
	bug_button = MenuButton.new()
	bug_button.text = "Bug"
	bug_button.flat = false
	bug_button.tooltip_text = "Cargar un bug con el título de la caja: etiqueta bug, su plantilla de descripción y una captura"
	var bug_menu := bug_button.get_popup()
	for i in BUG_SOURCES.size():
		bug_menu.add_item(BUG_SOURCES[i][1], i)
	bug_button.about_to_popup.connect(func(): bug_menu.set_item_disabled(0, not game_running.call()))
	bug_menu.id_pressed.connect(func(i: int): create_bug(new_title.text, BUG_SOURCES[i][0]))
	new_row.add_child(bug_button)

	editing_box = VBoxContainer.new()
	editing_box.visible = false
	add_child(editing_box)

	split = VSplitContainer.new()
	split.size_flags_vertical = SIZE_EXPAND_FILL
	split.dragged.connect(func(offset: int): set_pref.call("split", offset))
	add_child(split)
	var tasks_panel := VBoxContainer.new()
	tasks_panel.size_flags_vertical = SIZE_EXPAND_FILL
	split.add_child(tasks_panel)
	tasks_header = Button.new()
	tasks_header.flat = true
	tasks_header.alignment = HORIZONTAL_ALIGNMENT_LEFT
	tasks_header.tooltip_text = "Plegar o desplegar la lista de tareas"
	tasks_header.pressed.connect(func():
		tasks_collapsed = not tasks_collapsed
		set_pref.call("tasks_collapsed", tasks_collapsed)
		_apply_split())
	tasks_panel.add_child(tasks_header)
	search = LineEdit.new()
	search.placeholder_text = "Buscar en todos los hitos"
	search.tooltip_text = "Código, título o id; todas las palabras, sin importar tildes ni mayúsculas"
	search.clear_button_enabled = true
	search.text_changed.connect(func(_t): _render_tree())
	search.gui_input.connect(func(e: InputEvent):
		if e is InputEventKey and e.pressed and e.keycode == KEY_ESCAPE and search.text != "":
			search.clear()
			_render_tree()
			search.accept_event())
	tasks_panel.add_child(search)
	tree = Tree.new()
	tree.hide_root = true
	tree.columns = 2
	tree.set_column_expand(0, true)
	tree.set_column_expand(1, false)
	tree.set_column_custom_minimum_width(1, 44)
	tree.size_flags_vertical = SIZE_EXPAND_FILL
	tree.custom_minimum_size.y = 80
	tree.item_selected.connect(_on_item_selected)
	tree.item_collapsed.connect(_on_item_collapsed)
	tasks_panel.add_child(tree)

	detail = TaskDetail.new(self)
	split.add_child(detail)

	notice = Label.new()
	notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	notice.custom_minimum_size.x = WRAP_MIN_WIDTH
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
	# El pie no fija el ancho del dock (19.11): los textos se recortan con … y el tooltip los dice enteros.
	footer_label = Label.new()
	footer_label.clip_text = true
	footer_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	footer_label.size_flags_horizontal = SIZE_EXPAND_FILL
	footer_label.size_flags_stretch_ratio = 0.8
	footer_label.mouse_filter = Control.MOUSE_FILTER_PASS
	foot.add_child(footer_label)
	footer_right = Label.new()
	footer_right.clip_text = true
	footer_right.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	footer_right.size_flags_horizontal = SIZE_EXPAND_FILL
	footer_right.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	footer_right.mouse_filter = Control.MOUSE_FILTER_PASS
	foot.add_child(footer_right)
	restart_button = Button.new()
	# Solo el ícono: con el texto, el pie pedía casi 470 px (19.11). El tooltip dice qué hace.
	restart_button.icon = ICONS.restart
	restart_button.flat = true
	restart_button.tooltip_text = "Reiniciar hub (para que cargue código nuevo de Scope Compass)"
	restart_button.pressed.connect(restart_hub)
	foot.add_child(restart_button)

	# Sin hub: cada 3 s se busca el hub y se relee compass/ (una edición a mano o un git pull se ven solos).
	_poll = Timer.new()
	_poll.wait_time = 3.0
	_poll.timeout.connect(func():
		if not online and project_root != "":
			await _try_hub()
			if not online:
				# Solo si algo cambió en compass/ (una edición a mano, un git pull); si no, el conteo de git.
				if _stamp() != _compass_stamp:
					await reload()
				else:
					var n := _count_uncommitted()
					if n != _uncommitted:
						_uncommitted = n
						_render())
	add_child(_poll)


func _ready() -> void:
	_poll.start()


## Al mover el dock de lugar o hacerlo flotante, el editor lo saca del árbol y lo vuelve a poner: _exit_tree cerró
## el WebSocket, así que se vuelve a "sin hub" y el poll lo reconecta (19.9). Antes quedaba "conectado" sin eventos.
func _enter_tree() -> void:
	if online and not client.online:
		online = false
		state_changed.emit(false)
		_render()


func _exit_tree() -> void:
	client.close()


# --- Render ----------------------------------------------------------------------------------

func _render() -> void:
	banner.visible = not online
	var compass := has_compass()
	if compass:
		banner_title.text = "No hay hub en 127.0.0.1:%d" % board.port() + ((" (" + client.last_error + ")") if client.last_error != "" else "")
		banner_text.text = "Mostrando las tareas desde compass/ en solo lectura. Para editarlas, iniciá el hub o editá los JSON y commiteá con git."
	else:
		banner_title.text = "Este proyecto no tiene compass/"
		banner_text.text = "Ahí se guardan las tareas y los hitos del proyecto. Creala para empezar a usar el tablero."
	init_button.visible = not compass
	template_select.visible = not compass
	start_button.visible = compass
	open_tasks_button.visible = compass
	warnings_label.visible = board.warnings.size() > 0
	warnings_label.text = "\n".join(board.warnings.map(func(w): return "%s · %s" % [w.path, w.message]))
	browser_button.disabled = not online
	files_button.disabled = not online
	# Sin views en la config se ven todas las pestañas; con views, solo si incluye files.
	var views = board.config.get("views") if board.config is Dictionary else null
	files_button.visible = not (views is Array) or views.has("files")
	new_row.visible = online

	milestone_select.clear()
	for m in board.milestones:
		var p := board.progress(m.id)
		# Fecha objetivo (18.2): atrasado si pasó con tareas sin terminar.
		var late: bool = str(m.get("due", "")) != "" and Board.due_state({ "due": m.due, "status": "done" if Board.complete(p) else "todo" }) == "overdue"
		var review: String = (", %d en revisión" % p[2]) if p[2] > 0 else ""
		milestone_select.add_item("%s · %s (%d/%d%s)%s" % [m.code, m.title, p[0], p[1], review, (" · atrasado " + Board.show_due(m.due)) if late else ""])
		milestone_select.set_item_metadata(milestone_select.item_count - 1, m.id)
		if m.id == current_milestone:
			milestone_select.select(milestone_select.item_count - 1)

	_render_editing()
	_render_tree()
	detail.render()

	footer_dot.color = Color("#6fbf94") if online else Color("#e0655a")
	footer_label.text = ("127.0.0.1:%d" % client.port) if online else "Sin hub · solo lectura"
	footer_label.tooltip_text = footer_label.text
	# Un proyecto que sirve el Inicio no se reinicia solo (su hub no tiene /api/restart): se reinicia el Inicio (19.10).
	restart_button.visible = online and client.base == ""
	# Hub y addon de versiones distintas: uno de los dos quedó viejo (o el hub no se reinició tras actualizar).
	var mine := addon_version()
	version_label.visible = online and client.hub_version != "" and mine != "" and client.hub_version != mine
	version_label.text = "El hub es la versión %s y el addon la %s. Reiniciá el hub; si sigue, actualizá el que quedó viejo." % [client.hub_version, mine]
	footer_right.text = ("compass: %d sin commitear" % _uncommitted) if _uncommitted >= 0 else ""
	footer_right.tooltip_text = "Cambios del tablero que todavía no están en git: commitealos cuando quieras." if _uncommitted > 0 else ""
	if _uncommitted > 0:
		footer_right.add_theme_color_override("font_color", TODAY_COLOR)
	else:
		footer_right.remove_theme_color_override("font_color")


func _render_tree() -> void:
	_apply_split()
	# Seleccionar la fila de la tarea abierta emitía item_selected, que volvía a armar el detalle (19.9).
	tree.set_block_signals(true)
	_build_tree()
	tree.set_block_signals(false)


func _build_tree() -> void:
	tree.clear()
	var root := tree.create_item()
	var q := search.text.strip_edges()
	var ts := board.search(q) if q != "" else board.tasks_of(current_milestone)
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
		# Buscando, todo desplegado: lo encontrado no queda escondido en Hecho.
		g.collapsed = _collapsed.get(s.id, false) and q == ""
		for t in items:
			var it := tree.create_item(g)
			var code := str(t.get("code", ""))
			# Como la tarjeta de la web: la prioridad solo si es alta, el responsable y las etiquetas.
			var marks := ([TaskDetail.PRIORITIES.high] if t.get("priority") == "high" else []) + TaskDetail.who_and_tags(t)
			# Un resultado de otro hito lleva su código.
			if t.milestone != current_milestone and board.milestone(t.milestone) != null:
				marks.append(str(board.milestone(t.milestone).code))
			# Cómo salió el playtest (21.3): ✓ anda, ✗ falla; sin marca, sin probar.
			var pt := Board.playtest_of(t)
			var mark: String = { "pass": "✓ ", "fail": "✗ " }.get(pt.get("result"), "")
			# Decisiones que esperan al usuario (§31): ? si hay preguntas abiertas, ! si hay sin revisar o a revertir.
			var dc := Board.decision_counts(t)
			mark = ("? " if dc.open else "! " if dc.pending + dc.revert else "") + mark
			it.set_text(0, mark + ((code + "  " if code != "" else "") + str(t.title)).replace("`", "") + "".join(marks.map(func(m): return " · " + m)))
			var st := Board.steps(t)
			var col1 := "%d/%d" % st if st[1] > 0 else ""
			var ds := Board.due_state(t)
			if str(t.get("due", "")) != "":
				col1 = Board.show_due(str(t.due)) + ("  " + col1 if col1 != "" else "")
			it.set_text(1, col1)
			it.set_text_alignment(1, HORIZONTAL_ALIGNMENT_RIGHT)
			if ds == "overdue":
				it.set_custom_color(1, OVERDUE_COLOR)
			elif ds == "today":
				it.set_custom_color(1, TODAY_COLOR)
			it.set_metadata(0, t.id)
			var tip := str(t.title)
			if not pt.is_empty():
				tip += "\nPlaytest: %s%s" % [{ "pass": "anda", "fail": "falla" }.get(pt.get("result"), "sin probar"), (" · " + str(pt.note)) if pt.has("note") else ""]
			var waiting := [("%d preguntas abiertas" % dc.open) if dc.open else "", ("%d sin revisar" % dc.pending) if dc.pending else "", ("%d a revertir" % dc.revert) if dc.revert else ""].filter(func(x): return x != "")
			if not waiting.is_empty():
				tip += "\nDecisiones: " + ", ".join(waiting)
			it.set_tooltip_text(0, tip)
			var blockers := board.open_blockers(t.id)
			if not blockers.is_empty():
				it.set_custom_color(0, BLOCKED_COLOR)
				it.set_tooltip_text(0, "%s\nBloqueada por: %s" % [tip, "; ".join(blockers.map(board.task_name))])
			elif not board.review_blockers(t.id).is_empty():
				it.set_custom_color(0, TODAY_COLOR)
				it.set_tooltip_text(0, "%s\nDesbloqueada, en Revisión: %s" % [tip, "; ".join(board.review_blockers(t.id).map(board.task_name))])
			if t.id == selected_task:
				it.select(0)


## Encabezado del bloque de tareas y estado del divisor (plegado: el detalle usa todo el alto).
func _apply_split() -> void:
	var q := search.text.strip_edges()
	if q != "":
		var n := board.search(q).size()
		fold_icon(not tasks_collapsed, tasks_header, "Tareas · %d encontrada%s" % [n, "" if n == 1 else "s"])
	else:
		fold_icon(not tasks_collapsed, tasks_header, "Tareas · %d" % board.tasks_of(current_milestone).size())
	tree.visible = not tasks_collapsed
	search.visible = not tasks_collapsed
	split.collapsed = tasks_collapsed
	if not tasks_collapsed:
		split.split_offset = int(get_pref.call("split", split.split_offset))


## El plugin avisa qué script o escena se edita (kind "script" o "scene"; res_path "" si ninguno). Un script
## incorporado a una escena ("res://x.tscn::GDScript_…") no es un archivo propio y no cuenta.
func set_editing(kind: String, res_path: String) -> void:
	editing[kind] = res_path.trim_prefix("res://") if res_path.begins_with("res://") and not res_path.contains("::") else ""
	_render_editing()
	detail.render()


## Firma de compass/ y de los documentos: nombre, fecha y tamaño de cada archivo. Barata comparada con leerlos.
func _stamp() -> String:
	return _stamp_compass() + _stamp_docs()


func _stamp_compass() -> String:
	var compass := project_root.path_join("compass")
	var parts := PackedStringArray()
	for sub in ["", "milestones", "tasks", "lists"]:
		var dir := compass.path_join(sub) if sub != "" else compass
		if not DirAccess.dir_exists_absolute(dir):
			continue
		for f in DirAccess.get_files_at(dir):
			if f.ends_with(".json") or f.ends_with(".md"):
				var path := dir.path_join(f)
				parts.append("%s/%s:%d:%d" % [sub, f, FileAccess.get_modified_time(path), FileAccess.get_size(path)])
	return "|".join(parts) + "|"


## Los documentos (config.json › docs) también se leen sin hub: un cambio ahí también cuenta.
func _stamp_docs() -> String:
	var parts := PackedStringArray()
	if board.config is Dictionary:
		for d in board.config.get("docs", []):
			if d is Dictionary and not str(d.get("path", "")).contains("*"):
				var path := project_root.path_join(str(d.path))
				parts.append("%s:%d" % [d.path, FileAccess.get_modified_time(path)])
	return "|".join(parts)


## Arriba de la lista: las tareas sin terminar que citan el script o la escena abiertos, de cualquier hito.
func _render_editing() -> void:
	for c in editing_box.get_children():
		editing_box.remove_child(c)
		c.queue_free()
	for kind in ["script", "scene"]:
		var path: String = editing[kind]
		if path == "":
			continue
		for t in board.tasks:
			if t.get("status") == "done" or not TaskDetail.files_of(t).has(path):
				continue
			var b := Button.new()
			b.flat = true
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			b.custom_minimum_size.x = WRAP_MIN_WIDTH
			b.text = "%s · %s" % [path.get_file(), board.task_name(t.id)]
			b.tooltip_text = "Cita %s que estás editando. Ir a la tarea" % ("el script" if kind == "script" else "la escena")
			b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			b.pressed.connect(go_to_task.bind(t.id))
			editing_box.add_child(b)
	editing_box.visible = editing_box.get_child_count() > 0


## Abre otra tarea en el detalle (cambia de hito si hace falta).
func go_to_task(id: String) -> void:
	var t = board.task(id)
	if t == null:
		return
	current_milestone = t.milestone
	set_pref.call("milestone", current_milestone)
	selected_task = id
	_render()


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
		detail.render()


func _on_item_collapsed(it: TreeItem) -> void:
	var m = it.get_metadata(0)
	# Buscando todo va desplegado: lo que se pliega ahí no cambia la lista del hito.
	if m is String and m.begins_with("status:") and search.text.strip_edges() == "":
		_collapsed[m.trim_prefix("status:")] = it.collapsed


## Archivos de compass/ (y del export markdown) con cambios sin commitear; -1 si no hay git o no es un repo.
## Lo mismo que cuenta el hub (hub/src/git.js); con hub, el número llega por el evento `git`.
func _count_uncommitted() -> int:
	if project_root == "":
		return -1
	var paths := ["compass"]
	var export_md := str(board.config.get("export_md", "")) if board.config is Dictionary else ""
	if export_md != "" and not export_md.begins_with("..") and not export_md.begins_with("/"):
		paths.append(export_md)
	var out := []
	var code := OS.execute("git", ["-C", project_root, "status", "--porcelain", "--untracked-files=all", "--"] + paths, out)
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
