@tool
extends EditorPlugin
## Plugin de Scope Compass: el dock "Tablero" con las tareas del proyecto (spec §11.1, D19).

const DockView := preload("dock_view.gd")
const SCOMPASS_SETTING := "scope_compass/scompass_path"
const KEEP_SETTING := "scope_compass/keep_hub_running"

var _dock: EditorDock
var _view: DockView


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
		return DockView.basic_highlighter(lang)
	_view.get_pref = func(key: String, default): return es.get_project_metadata("scope_compass", key, default)
	_view.set_pref = func(key: String, value): es.set_project_metadata("scope_compass", key, value)

	_dock = EditorDock.new()
	_dock.title = "Tablero"
	_dock.layout_key = "scope_compass"
	_dock.default_slot = EditorDock.DOCK_SLOT_RIGHT_UL
	_dock.add_child(_view)
	add_dock(_dock)
	_view.set_icon_scale(EditorInterface.get_editor_scale())
	_view.setup(ProjectSettings.globalize_path("res://").trim_suffix("/"))


func _exit_tree() -> void:
	if _view:
		_view.stop_hub() # solo si lo abrió el dock y no está en modo "mantener"
	if _dock:
		remove_dock(_dock)
		_dock.queue_free()
		_dock = null
		_view = null
