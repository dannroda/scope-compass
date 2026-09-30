extends SceneTree
## Captura de la vista del dock (para revisar a ojo): godot --path <repo> --script res://hub/test/godot/shot.gd -- <proyecto> <png> [tarea [refs]]
const DockView := preload("res://addons/scope_compass/dock_view.gd")

func _initialize() -> void:
	var a := OS.get_cmdline_user_args()
	get_root().size = Vector2i(380, 900)
	var bg := ColorRect.new()
	bg.color = Color("#252930")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	get_root().add_child(bg)
	var v := DockView.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 8; v.offset_top = 8; v.offset_right = -8; v.offset_bottom = -8
	get_root().add_child(v)
	await v.setup(a[0])
	for i in 120:
		if v.online and not v._loading: break
		await create_timer(0.05).timeout
	if a.size() > 2:
		v.selected_task = a[2]
		# Cuarto argumento "refs": despliega sus referencias.
		if a.size() > 3 and a[3] == "refs":
			for r in v.board.task(a[2]).get("refs", []):
				v._refs_open["%s#%s" % [r.doc, r.section]] = true
		v._render()
	for i in 10:
		await process_frame
	if a.size() > 3 and a[3] == "refs":
		await create_timer(1.0).timeout # el BBCode llega del hub
		v.detail_scroll.scroll_vertical = v.refs_box.position.y
		for i in 5:
			await process_frame
	get_root().get_texture().get_image().save_png(a[1])
	quit()
