@tool
extends EditorPlugin
## Plugin de Scope Compass: el dock "Tablero" con las tareas del proyecto (spec §11.1, D19).

const DockView := preload("dock_view.gd")
const SCOMPASS_SETTING := "scope_compass/scompass_path"

var _dock: EditorDock
var _view: DockView


func _enter_tree() -> void:
	_view = DockView.new()
	var es := EditorInterface.get_editor_settings()
	if not es.has_setting(SCOMPASS_SETTING):
		es.set_setting(SCOMPASS_SETTING, "")
	es.set_initial_value(SCOMPASS_SETTING, "", false)
	es.add_property_info({ "name": SCOMPASS_SETTING, "type": TYPE_STRING, "hint": PROPERTY_HINT_GLOBAL_FILE })
	_view.scompass_setting = func(): return str(es.get_setting(SCOMPASS_SETTING))
	_view.get_pref = func(key: String, default): return es.get_project_metadata("scope_compass", key, default)
	_view.set_pref = func(key: String, value): es.set_project_metadata("scope_compass", key, value)

	_dock = EditorDock.new()
	_dock.title = "Tablero"
	_dock.layout_key = "scope_compass"
	_dock.default_slot = EditorDock.DOCK_SLOT_RIGHT_UL
	_dock.add_child(_view)
	add_dock(_dock)
	_view.setup(ProjectSettings.globalize_path("res://").trim_suffix("/"))


func _exit_tree() -> void:
	if _view:
		_view.stop_hub() # solo si lo abrió el dock
	if _dock:
		remove_dock(_dock)
		_dock.queue_free()
		_dock = null
		_view = null
