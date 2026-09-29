extends SceneTree
## Corre los tests de Godot del dock: godot --headless --path <repo> --script res://hub/test/godot/runner.gd -- <caso> <args…>
## Imprime "OK <caso>" o "FAIL <caso>: <motivo>" y sale con 0 o 1.

const DockView := preload("res://addons/scope_compass/dock_view.gd")

var _failed := false


func _initialize() -> void:
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
	v.setup(root_dir)
	await process_frame
	return v


# Sin hub: muestra las tareas del hito por defecto agrupadas por estado, en solo lectura.
func test_offline(a: Array) -> void:
	var v := await _view(a[0])
	var c := "offline"
	if not _check(c, v.banner.visible, "falta el aviso de solo lectura"): return
	if not _check(c, v.banner_title.text == "No hay hub en 127.0.0.1:4711", "título del aviso: " + v.banner_title.text): return
	if not _check(c, v.current_milestone == a[1], "hito por defecto %s, esperado %s" % [v.current_milestone, a[1]]): return
	var listed := v.listed()
	if not _check(c, JSON.stringify(listed) == a[2], "tareas listadas %s, esperado %s" % [JSON.stringify(listed), a[2]]): return
	if not _check(c, v.footer_label.text == "Sin hub · solo lectura", "pie: " + v.footer_label.text): return
	# Elegir otra tarea muestra su detalle, con el estado deshabilitado.
	v.tree.get_root().get_child(0).get_child(0).select(0)
	await process_frame
	if not _check(c, v.detail.visible and v.status_select.disabled, "detalle visible y en solo lectura"): return
	if not _check(c, v.steps_box.get_child_count() > 0 and v.steps_box.get_child(0).disabled, "pasos en solo lectura"): return


# Elegir un hito lo recuerda (preferencia del proyecto) y cambia la lista.
func test_pick_milestone(a: Array) -> void:
	var saved := {}
	var v := DockView.new()
	v.set_pref = func(k, val): saved[k] = val
	get_root().add_child(v)
	v.setup(a[0])
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
