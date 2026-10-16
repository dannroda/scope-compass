@tool
extends EditorPlugin
## Plugin de Scope Compass: el dock "Tablero" con las tareas del proyecto (spec §11.1, D19).

const DockView := preload("dock_view.gd")
const GameShot := preload("game_shot.gd")
const SCOMPASS_SETTING := "scope_compass/scompass_path"
const KEEP_SETTING := "scope_compass/keep_hub_running"

var _dock: EditorDock
var _view: DockView
## Pide capturas al juego que corre desde el editor (21.4).
var _shots: GameShot


func _enter_tree() -> void:
	_view = DockView.new()
	var es := EditorInterface.get_editor_settings()
	if not es.has_setting(SCOMPASS_SETTING):
		es.set_setting(SCOMPASS_SETTING, "")
	es.set_initial_value(SCOMPASS_SETTING, "", false)
	es.add_property_info({ "name": SCOMPASS_SETTING, "type": TYPE_STRING, "hint": PROPERTY_HINT_GLOBAL_FILE })
	if not es.has_setting(KEEP_SETTING):
		es.set_setting(KEEP_SETTING, false)
	es.set_initial_value(KEEP_SETTING, false, false)
	es.add_property_info({ "name": KEEP_SETTING, "type": TYPE_BOOL })
	_view.scompass_setting = func(): return str(es.get_setting(SCOMPASS_SETTING))
	_view.keep_hub_setting = func(): return bool(es.get_setting(KEEP_SETTING))
	# Los snippets de GDScript se ven como en el editor de scripts: su resaltado, sus colores y su fuente.
	_view.make_highlighter = func(lang: String):
		if lang == "gdscript" and ClassDB.can_instantiate("GDScriptSyntaxHighlighter"):
			return ClassDB.instantiate("GDScriptSyntaxHighlighter")
		return DockView.TaskDetail.basic_highlighter(lang)
	# Como un doble clic en el FileSystem: el script en el editor de scripts, la escena en su pestaña, otro recurso en
	# el inspector. Lo que Godot no abre como recurso (markdown y JSON, o lo que no ve) queda para la web.
	_view.open_file = func(path: String) -> bool:
		var res := "res://" + path
		var type := EditorInterface.get_resource_filesystem().get_file_type(res)
		if type in ["", "TextFile", "JSON"]:
			return false
		if type == "PackedScene":
			EditorInterface.open_scene_from_path(res)
		elif ClassDB.is_parent_class(type, "Script"):
			EditorInterface.edit_script(load(res))
		else:
			EditorInterface.edit_resource(load(res))
		return true
	# Capturas para los bugs (21.4): el juego por el depurador; el editor, su pantalla principal (2D, 3D, Script…).
	_shots = GameShot.new()
	add_debugger_plugin(_shots)
	_view.game_running = func() -> bool: return _shots.running()
	_view.capture_game = func(): return await _shots.game_image()
	_view.capture_editor = _editor_image
	_view.get_pref = func(key: String, default): return es.get_project_metadata("scope_compass", key, default)
	_view.set_pref = func(key: String, value): es.set_project_metadata("scope_compass", key, value)

	_dock = EditorDock.new()
	_dock.title = "Tablero"
	_dock.layout_key = "scope_compass"
	_dock.default_slot = EditorDock.DOCK_SLOT_RIGHT_UL
	_dock.add_child(_view)
	add_dock(_dock)
	_view.setup(ProjectSettings.globalize_path("res://").trim_suffix("/"))
	# Las tareas del script y la escena que se editan (15.4).
	EditorInterface.get_script_editor().editor_script_changed.connect(_on_script_changed)
	scene_changed.connect(_on_scene_changed)
	_on_script_changed(EditorInterface.get_script_editor().get_current_script())
	_on_scene_changed(EditorInterface.get_edited_scene_root())


## Lo que se ve del editor: el viewport 2D o 3D si está a la vista (con sus controles encima, como el gizmo) y, si no
## (Script, Game, Asset Store), la ventana entera. null si no se pudo. Espera a que se dibuje sin el menú que se acaba de
## cerrar. En 4.8 get_editor_main_screen() es un contenedor vacío (el sistema de pantallas cambió): se va por los viewports.
func _editor_image():
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var root := EditorInterface.get_base_control().get_viewport()
	var img := root.get_texture().get_image()
	if img == null or img.is_empty():
		return null
	var area := Rect2()
	for vp in [EditorInterface.get_editor_viewport_2d()] + range(4).map(func(i): return EditorInterface.get_editor_viewport_3d(i)):
		var box := vp.get_parent() as Control if vp else null
		if box and box.is_visible_in_tree() and box.get_global_rect().has_area():
			area = box.get_global_rect() if not area.has_area() else area.merge(box.get_global_rect())
	if not area.has_area():
		return img
	# De coordenadas del viewport a píxeles de la imagen (con la escala del editor pueden no coincidir).
	var k := Vector2(img.get_size()) / root.get_visible_rect().size
	var r := Rect2i(Rect2(area.position * k, area.size * k)).intersection(Rect2i(Vector2i.ZERO, img.get_size()))
	return img.get_region(r) if r.has_area() else img


func _on_script_changed(script: Script) -> void:
	if _view:
		_view.set_editing("script", script.resource_path if script else "")


func _on_scene_changed(root: Node) -> void:
	if _view:
		_view.set_editing("scene", root.scene_file_path if root else "")


func _exit_tree() -> void:
	EditorInterface.get_script_editor().editor_script_changed.disconnect(_on_script_changed)
	if _shots:
		remove_debugger_plugin(_shots)
		_shots = null
	if _view:
		_view.stop_hub() # solo si lo abrió el dock y no está en modo "mantener"
	if _dock:
		remove_dock(_dock)
		_dock.queue_free()
		_dock = null
		_view = null
