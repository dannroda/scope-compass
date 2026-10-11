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

## Ancho mínimo de los textos con ajuste de línea. Sin esto, mientras el dock está en una pestaña oculta mide 0 de
## ancho, cada palabra va en su renglón y el alto mínimo (miles de px) desacomoda todo el editor.
const WRAP_MIN_WIDTH := 140
const BLOCKED_COLOR := Color("#e8806e")
## Fecha límite: vencida (el mismo rojo) y de hoy.
const OVERDUE_COLOR := Color("#e8806e")
const TODAY_COLOR := Color("#e0a95a")

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
## Tareas sin terminar que citan el script o la escena que se editan (15.4).
var editing_box: VBoxContainer
## Lo que se edita en Godot, con la ruta desde la raíz del proyecto ("" si nada): lo avisa el plugin.
var editing := { "script": "", "scene": "" }
var new_title: LineEdit
var tree: Tree
## Lista de tareas y detalle, con divisor arrastrable; el bloque de tareas se puede plegar.
var split: VSplitContainer
var tasks_header: Button
var tasks_collapsed := false
var detail_scroll: ScrollContainer
var detail: VBoxContainer
var detail_title: Label
## Fecha límite de la tarea abierta (solo lectura: se edita en la web o con `scompass set --due`).
var detail_due: Label
var detail_props: Label
## Qué hay que hacer y por qué (D37). Solo lectura: se edita en la web o con `scompass set --description`.
var detail_description: Label
var status_select: OptionButton
var steps_box: VBoxContainer
var refs_box: VBoxContainer
## Vínculos con otras tareas (solo lectura: se editan en la web o con `scompass link`).
var links_box: VBoxContainer
var files_box: VBoxContainer
## Referencias desplegadas ("ruta#id") y bloques de las secciones pedidas al hub (6.7).
var _refs_open := {}
## Pasos con el detalle desplegado ("tarea:índice").
var _steps_open := {}
var _blocks := {}
## Resaltado para los CodeEdit de los snippets. El plugin pasa el GDScriptSyntaxHighlighter del editor; fuera
## del editor (tests) queda un CodeHighlighter básico.
## Abre un archivo del repo en el editor (lo pone el plugin, 15.3). false si Godot no lo ve: el dock va a la web.
var open_file: Callable = func(_path: String) -> bool: return false
var make_highlighter: Callable = func(lang: String): return basic_highlighter(lang)
var notice: Label
var footer_dot: ColorRect
var footer_label: Label
var footer_right: Label
var restart_button: Button
var _poll: Timer
## El scompass que corre en otro hilo: al cerrar el dock se espera (si el editor sale antes, el hilo sigue y Godot se cae).
var _thread: Thread = null
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
		if data == null:
			data = Reader.read(project_root)
		board.load_from(data)
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
	await reload()
	await _try_hub()
	_render()


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


## Corre scompass en el proyecto y espera, en otro hilo: el editor sigue dibujando mientras tanto. Bloquear el
## cuadro no solo congela el editor: el cuadro siguiente llega con todo ese tiempo de golpe y vence en el acto los
## pedidos HTTP con timeout corto (en Windows, Node tarda ~0,5 s en arrancar y el dock no encontraba el hub).
## Devuelve [código, salida]; código -1 si no se encontró scompass.
func _scompass(args: Array) -> Array:
	var cmd := scompass_command()
	if cmd.is_empty():
		return [-1, ""]
	var all: Array = cmd[1] + ["--dir", project_root] + args
	var run := func() -> Array:
		var out := []
		var code := OS.execute(cmd[0], PackedStringArray(all), out, true)
		return [code, str(out[0]).strip_edges() if out.size() else ""]
	if not is_inside_tree():
		return run.call()
	var th := Thread.new()
	_thread = th
	th.start(run)
	while th.is_alive() and is_inside_tree():
		await get_tree().process_frame
	if _thread != th: # el dock se cerró y _exit_tree ya lo esperó
		return [-1, ""]
	_thread = null
	return th.wait_to_finish()


## ¿compass/ tiene archivos generados de una versión anterior de Scope Compass (schema/, AGENTS.md)?
## Se mira al abrir el dock; sin scompass a mano no se puede saber y no se avisa nada.
func check_compass() -> void:
	outdated = []
	if has_compass():
		var r: Array = await _scompass(["update", "--check", "--json"])
		var data = JSON.parse_string(r[1]) if r[0] == 1 else null
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
	if OS.get_name() == "Windows":
		# `npm link` deja scompass.cmd: Godot no lanza un .cmd sin la consola de por medio, así que se usa el .js
		# que el shim tiene al lado, con node.
		if OS.execute("where", ["scompass"], out) == 0:
			for line in str(out[0]).split("\n"):
				var shim := line.strip_edges().replace("\\", "/")
				var js := shim.get_base_dir().path_join("node_modules/scope-compass/bin/scompass.js")
				if shim != "" and FileAccess.file_exists(js):
					return ["node", [js]]
		return []
	if OS.execute("sh", ["-c", "command -v scompass"], out) == 0 and str(out[0]).strip_edges() != "":
		return [str(out[0]).strip_edges(), []]
	return []


## Levanta `scompass serve` para este proyecto y espera a conectarse (hasta 8 s). Con el Inicio corriendo no
## levanta otro proceso: le pide al Inicio que sirva el proyecto (D29) y se conecta ahí.
func start_hub() -> bool:
	if online:
		return true
	var home := client.home_port()
	if home > 0:
		var r := await client.request_url("POST", "http://%s:%d/api/projects/activate" % [client.HOST, home], { "path": project_root })
		if r.code == 200 and await client.detect():
			show_notice("Conectado al Inicio, que sirve este proyecto.")
			return true
		show_notice("El Inicio no pudo servir el proyecto (%s); se levanta un hub propio." % (r.json.get("error", {}).get("message", "HTTP %d" % r.code) if r.json is Dictionary else "sin respuesta"))
	var cmd := scompass_command()
	if cmd.is_empty():
		show_notice("No encontré scompass. Configurá su ruta en Editor Settings › scope_compass/scompass_path.")
		return false
	# Por sh con la salida a un log: si no, el hub hereda el stdout de Godot. exec conserva el PID.
	var log_path := project_root.path_join(".godot/scope_compass_hub.log")
	DirAccess.make_dir_recursive_absolute(log_path.get_base_dir())
	hub_kept = bool(keep_hub_setting.call())
	if OS.get_name() == "Windows":
		# Sin sh (§18): node directo, y el hub escribe él mismo el log (--log). Godot lo lanza sin consola.
		DirAccess.remove_absolute(log_path)
		var args: Array = cmd[1] + ["--dir", project_root, "serve", "--log", log_path]
		if hub_kept:
			hub_pid = OS.create_process(cmd[0], PackedStringArray(args + ["--tray"]))
		else:
			_hub_pipe = OS.execute_with_pipe(cmd[0], PackedStringArray(args + ["--exit-on-stdin-close"]), false)
			hub_pid = int(_hub_pipe.get("pid", -1))
	elif hub_kept:
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
## Si en 3 s sigue vivo, SIGTERM (en Windows, OS.kill: no hay señales).
func stop_hub(force := false) -> void:
	if hub_pid <= 0 or (hub_kept and not force):
		return
	for key in ["stdio", "stderr"]:
		if _hub_pipe.get(key) is FileAccess:
			_hub_pipe[key].close()
	_hub_pipe = {}
	var t0 := Time.get_ticks_msec()
	while pid_alive(hub_pid) and Time.get_ticks_msec() - t0 < 3000:
		OS.delay_msec(50)
	if pid_alive(hub_pid):
		if OS.get_name() == "Windows" or OS.execute("kill", ["-TERM", str(hub_pid)]) != 0:
			OS.kill(hub_pid)
	hub_pid = -1


## ¿Sigue vivo el proceso? OS.is_process_running solo conoce los hijos de Godot, y tras un reinicio el hub es
## nieto: kill -0 en Linux; en Windows, tasklist.
static func pid_alive(pid: int) -> bool:
	if OS.get_name() == "Windows":
		var out := []
		OS.execute("tasklist", ["/FI", "PID eq %d" % pid, "/NH", "/FO", "CSV"], out)
		return ("\"%d\"" % pid) in (str(out[0]) if out.size() else "")
	return OS.execute("kill", ["-0", str(pid)]) == 0


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


func _icon_button(name: String, tip: String) -> Button:
	var b := Button.new()
	b.icon = ICONS[name]
	b.tooltip_text = tip
	return b


## Flecha de plegado: la del editor (la misma que usa el Tree), o ▸/▾ fuera del editor.
func _fold_icon(open: bool, b: Button, label := "") -> void:
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
	reload_button = _icon_button("reload", "Recargar")
	reload_button.pressed.connect(reload)
	head.add_child(reload_button)
	browser_button = _icon_button("browser", "Abrir el tablero en el navegador")
	browser_button.pressed.connect(func(): OS.shell_open(web_url()))
	head.add_child(browser_button)
	files_button = _icon_button("folder", "Ver los archivos del repo y su estado de git en el navegador")
	files_button.pressed.connect(func(): OS.shell_open(web_url("#files")))
	head.add_child(files_button)

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

	# El detalle se desplaza solo: una tarea con muchos pasos no le quita lugar a la lista.
	detail_scroll = ScrollContainer.new()
	detail_scroll.size_flags_vertical = SIZE_EXPAND_FILL
	detail_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	detail_scroll.custom_minimum_size.y = 60
	split.add_child(detail_scroll)
	detail = VBoxContainer.new()
	detail.size_flags_horizontal = SIZE_EXPAND_FILL
	detail_scroll.add_child(detail)
	detail_title = Label.new()
	detail_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail_title.custom_minimum_size.x = WRAP_MIN_WIDTH
	detail_title.add_theme_font_size_override("font_size", 15)
	detail.add_child(detail_title)
	detail_due = Label.new()
	detail.add_child(detail_due)
	detail_props = Label.new()
	detail_props.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail_props.custom_minimum_size.x = WRAP_MIN_WIDTH
	detail.add_child(detail_props)
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
	detail_description = Label.new()
	detail_description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail_description.custom_minimum_size.x = WRAP_MIN_WIDTH
	detail.add_child(detail_description)
	steps_box = VBoxContainer.new()
	detail.add_child(steps_box)
	links_box = VBoxContainer.new()
	detail.add_child(links_box)
	refs_box = VBoxContainer.new()
	detail.add_child(refs_box)
	files_box = VBoxContainer.new()
	detail.add_child(files_box)

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
	footer_label = Label.new()
	foot.add_child(footer_label)
	footer_right = Label.new()
	footer_right.size_flags_horizontal = SIZE_EXPAND_FILL
	footer_right.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	foot.add_child(footer_right)
	restart_button = Button.new()
	restart_button.text = "Reiniciar hub"
	restart_button.icon = ICONS.restart
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
	if _thread:
		var th := _thread
		_thread = null
		th.wait_to_finish()


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
		milestone_select.add_item("%s · %s (%d/%d)" % [m.code, m.title, p[0], p[1]])
		milestone_select.set_item_metadata(milestone_select.item_count - 1, m.id)
		if m.id == current_milestone:
			milestone_select.select(milestone_select.item_count - 1)

	_render_editing()
	_render_tree()
	_render_detail()

	footer_dot.color = Color("#6fbf94") if online else Color("#e0655a")
	footer_label.text = ("127.0.0.1:%d" % client.port) if online else "Sin hub · solo lectura"
	restart_button.visible = online
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
			# Como la tarjeta de la web: la prioridad solo si es alta, el responsable y las etiquetas.
			var marks := ([PRIORITIES.high] if t.get("priority") == "high" else []) + _who_and_tags(t)
			it.set_text(0, ((code + "  " if code != "" else "") + str(t.title)).replace("`", "") + "".join(marks.map(func(m): return " · " + m)))
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
			it.set_tooltip_text(0, str(t.title))
			var blockers := board.open_blockers(t.id)
			if not blockers.is_empty():
				it.set_custom_color(0, BLOCKED_COLOR)
				it.set_tooltip_text(0, "%s\nBloqueada por: %s" % [t.title, "; ".join(blockers.map(board.task_name))])
			if t.id == selected_task:
				it.select(0)


const PRIORITIES := { "high": "Alta", "medium": "Media", "low": "Baja" }


## Responsable y etiquetas de la tarea (M11, spec §19), para la lista y el detalle: "@ana", "#arte #audio".
func _who_and_tags(t: Dictionary) -> Array:
	var out := []
	if str(t.get("assignee", "")) != "":
		out.append("@" + str(t.assignee))
	var tags = t.get("tags", [])
	if tags is Array and not tags.is_empty():
		out.append(" ".join(tags.map(func(x): return "#" + str(x))))
	return out


## Encabezado del bloque de tareas y estado del divisor (plegado: el detalle usa todo el alto).
func _apply_split() -> void:
	var n := board.tasks_of(current_milestone).size()
	_fold_icon(not tasks_collapsed, tasks_header, "Tareas · %d" % n)
	tree.visible = not tasks_collapsed
	split.collapsed = tasks_collapsed
	if not tasks_collapsed:
		split.split_offset = int(get_pref.call("split", split.split_offset))


func _render_detail() -> void:
	var t = board.task(selected_task)
	detail.visible = t != null
	detail_scroll.visible = t != null
	if t == null:
		return
	detail_title.text = (((str(t.code) + " ") if str(t.get("code", "")) != "" else "") + str(t.title)).replace("`", "")
	var due := str(t.get("due", ""))
	var ds := Board.due_state(t)
	detail_due.visible = due != ""
	detail_due.text = ("Vencida · " if ds == "overdue" else "Vence hoy · " if ds == "today" else "Vence ") + Board.show_due(due) if due != "" else ""
	if ds == "overdue":
		detail_due.add_theme_color_override("font_color", OVERDUE_COLOR)
	elif ds == "today":
		detail_due.add_theme_color_override("font_color", TODAY_COLOR)
	else:
		detail_due.remove_theme_color_override("font_color")
	var prio := str(t.get("priority", ""))
	var props := (["Prioridad " + PRIORITIES[prio].to_lower()] if PRIORITIES.has(prio) else []) + _who_and_tags(t)
	detail_props.visible = not props.is_empty()
	detail_props.text = " · ".join(props)
	for i in status_select.item_count:
		if status_select.get_item_metadata(i) == t.status:
			status_select.select(i)
	status_select.disabled = not online
	var description := str(t.get("description", ""))
	detail_description.visible = description != ""
	detail_description.text = description.replace("`", "")
	for c in steps_box.get_children():
		steps_box.remove_child(c)
		c.queue_free()
	var cl = t.get("checklist", [])
	for i in (cl.size() if cl is Array else 0):
		# Cada paso: el checkbox con el texto corto y, si tiene detalle, ▸ para desplegarlo debajo.
		var row := VBoxContainer.new()
		var line := HBoxContainer.new()
		row.add_child(line)
		# El cuadradito tilda; el texto (y ▸) despliega el detalle. Tildar al tocar el texto era contraintuitivo.
		var cb := CheckBox.new()
		cb.button_pressed = cl[i].get("done", false)
		cb.disabled = not online
		cb.size_flags_vertical = SIZE_SHRINK_BEGIN
		cb.tooltip_text = "Marcar como hecho"
		var id: String = t.id
		cb.toggled.connect(func(on: bool): update_task(id, func(cur): return { "checklist": _toggled(cur, i, on) }))
		var cb_box := MarginContainer.new() # para alinear el cuadradito con la primera línea del texto
		cb_box.size_flags_vertical = SIZE_SHRINK_BEGIN
		cb_box.add_child(cb)
		line.add_child(cb_box)
		var detail_text := str(cl[i].get("detail", ""))
		var key := "%s:%d" % [id, i]
		var open: bool = _steps_open.get(key, false)
		var toggle_detail := func(): _steps_open[key] = not open; _render_detail()
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
			label.add_theme_color_override("font_color", Color("#a69d8c"))
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
			_fold_icon(open, toggle)
			toggle.tooltip_text = "Ocultar detalle" if open else "Ver detalle"
			toggle.size_flags_vertical = SIZE_SHRINK_BEGIN
			toggle.pressed.connect(toggle_detail)
			line.add_child(toggle)
			if open:
				var detail_label := Label.new()
				detail_label.text = detail_text.replace("`", "")
				detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				detail_label.custom_minimum_size.x = WRAP_MIN_WIDTH
				detail_label.add_theme_color_override("font_color", Color("#a69d8c"))
				var margin := MarginContainer.new()
				margin.add_theme_constant_override("margin_left", 28)
				margin.add_child(detail_label)
				row.add_child(margin)
		steps_box.add_child(row)
	_render_links(t)
	_render_refs(t)
	_render_files(t)


# --- Vínculos entre tareas -----------------------------------------------------------------------

const LINK_KINDS := [["blocked_by", "Bloqueada por"], ["blocks", "Bloquea a"], ["related", "Relacionada con"]]


func _render_links(t: Dictionary) -> void:
	for c in links_box.get_children():
		links_box.remove_child(c)
		c.queue_free()
	var v := board.link_view(t.id)
	if v.blocks.is_empty() and v.blocked_by.is_empty() and v.related.is_empty():
		return
	var label := Label.new()
	label.text = "Vínculos"
	label.add_theme_color_override("font_color", Color("#a69d8c"))
	links_box.add_child(label)
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
				b.pressed.connect(_go_to_task.bind(id))
			links_box.add_child(b)


## El plugin avisa qué script o escena se edita (kind "script" o "scene"; res_path "" si ninguno). Un script
## incorporado a una escena ("res://x.tscn::GDScript_…") no es un archivo propio y no cuenta.
func set_editing(kind: String, res_path: String) -> void:
	editing[kind] = res_path.trim_prefix("res://") if res_path.begins_with("res://") and not res_path.contains("::") else ""
	_render_editing()
	_render_detail()


static func _files_of(t) -> Array:
	var f = t.get("files", []) if t is Dictionary else []
	return f if f is Array else []


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
			if t.get("status") == "done" or not _files_of(t).has(path):
				continue
			var b := Button.new()
			b.flat = true
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			b.custom_minimum_size.x = WRAP_MIN_WIDTH
			b.text = "%s · %s" % [path.get_file(), board.task_name(t.id)]
			b.tooltip_text = "Cita %s que estás editando. Ir a la tarea" % ("el script" if kind == "script" else "la escena")
			b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			b.pressed.connect(_go_to_task.bind(t.id))
			editing_box.add_child(b)
	editing_box.visible = editing_box.get_child_count() > 0


## Archivos del repo que toca la tarea (15.3): un clic lo abre en el editor. En rojo, el que ya no está en el disco.
## Con hub, el script o la escena que se editan y la tarea no cita se pueden vincular (15.4).
func _render_files(t: Dictionary) -> void:
	for c in files_box.get_children():
		files_box.remove_child(c)
		c.queue_free()
	var files := _files_of(t)
	var linkable := []
	for kind in ["script", "scene"]:
		if online and editing[kind] != "" and not files.has(editing[kind]):
			linkable.append(editing[kind])
	if files.is_empty() and linkable.is_empty():
		return
	var label := Label.new()
	label.text = "Archivos"
	label.add_theme_color_override("font_color", Color("#a69d8c"))
	files_box.add_child(label)
	for f in files:
		var b := Button.new()
		b.flat = true
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		b.custom_minimum_size.x = WRAP_MIN_WIDTH
		b.text = str(f)
		b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		if FileAccess.file_exists(project_root.path_join(str(f))):
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
		add.pressed.connect(func(): update_task(id, func(cur): return {} if _files_of(cur).has(p) else { "files": _files_of(cur) + [p] }))
		files_box.add_child(add)


## Un archivo de la tarea: en el editor si Godot lo ve; si no (markdown, compass/, lo que tiene .gdignore), en la
## pestaña Archivos de la web.
func open_task_file(path: String) -> void:
	if open_file.call(path):
		return
	if online:
		OS.shell_open(web_url("#files/" + path.uri_encode()))
	else:
		show_notice("Godot no abre %s. Con el hub iniciado, se abre en la pestaña Archivos del navegador." % path)


## Abre otra tarea en el detalle (cambia de hito si hace falta).
func _go_to_task(id: String) -> void:
	var t = board.task(id)
	if t == null:
		return
	current_milestone = t.milestone
	selected_task = id
	_render()


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
		# Sin sección, la referencia es al documento entero (12.1): no se despliega, se abre en el navegador.
		if str(r.get("section", "")) == "":
			_render_whole_ref(r, d)
			continue
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
		_fold_icon(open, toggle, str(s.title).replace("`", ""))
		toggle.tooltip_text = "%s#%s" % [d.alias, s.id]
		toggle.pressed.connect(func(): _refs_open[key] = not open; _render_detail())
		head.add_child(toggle)
		if online:
			var web := _icon_button("browser", "Abrir en el navegador")
			web.pressed.connect(func(): OS.shell_open(web_url("#docs/%s/%s" % [str(d.alias).uri_encode(), str(s.id).uri_encode()])))
			head.add_child(web)
		if open:
			var box := VBoxContainer.new()
			box.name = "Section"
			refs_box.add_child(box)
			_fill_section(box, d, s)


func _render_whole_ref(r: Dictionary, d) -> void:
	if d == null:
		var broken := Label.new()
		broken.text = "⚠ Referencia rota: %s no está" % r.get("doc", "")
		broken.add_theme_color_override("font_color", Color("#e8806e"))
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
	if online:
		var web := _icon_button("browser", "Abrir en el navegador")
		web.pressed.connect(func(): OS.shell_open(web_url("#docs/" + str(d.alias).uri_encode())))
		head.add_child(web)


## Título de un documento: su primer título de nivel 1, o la ruta (como docTitle en web/app.js).
func _doc_title(d: Dictionary) -> String:
	for s in d.sections:
		if int(s.level) == 1:
			return str(s.title).replace("`", "")
	return str(d.path)


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
			text.custom_minimum_size.x = WRAP_MIN_WIDTH
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

## El checkbox del paso i del detalle.
func step_checkbox(i: int) -> CheckBox:
	return steps_box.get_child(i).get_child(0).get_child(0).get_child(0)


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
