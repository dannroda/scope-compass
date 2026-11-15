@tool
extends Node
## Los procesos que lanza el dock: scompass para init y update (en otro hilo) y el hub de `scompass serve` (5.5),
## atado a Godot por una tubería (5.8) o suelto en modo "mantener" (5.9). La vista decide cuándo y avisa.

var project_root := ""
## PID del hub que lanzó el dock; -1 si ninguno.
var pid := -1
## Tubería con el hub que lanzó el dock: mientras exista, el hub vive; si Godot muere, el sistema la cierra.
var _pipe := {}
## El hub se lanzó para quedar corriendo: el dock no lo cierra.
var kept := false
## El scompass que corre en otro hilo: al cerrar el dock se espera (si el editor sale antes, el hilo sigue y Godot se cae).
var _thread: Thread = null


func _exit_tree() -> void:
	if _thread:
		var th := _thread
		_thread = null
		th.wait_to_finish()


## Dónde está scompass: la opción de Editor Settings (configured), al lado del proyecto, dentro de él o en el PATH.
## Devuelve [programa, args previos] listos para OS.create_process, o [] si no se encontró.
func command(configured: String) -> Array:
	var candidates: Array = []
	if configured != "":
		# scompass.cmd (lo que da `where` después de npm link): Godot no lanza un .cmd, así que se usa el .js que el
		# shim tiene al lado, como en la búsqueda por el PATH (19.11).
		if configured.get_extension().to_lower() in ["cmd", "ps1"] or configured.get_file().to_lower() == "scompass":
			var js := configured.replace("\\", "/").get_base_dir().path_join("node_modules/scope-compass/bin/scompass.js")
			if FileAccess.file_exists(js):
				configured = js
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
				# El binario de la release (scompass.exe) se lanza directo, sin Node.
				if shim.get_extension().to_lower() == "exe" and FileAccess.file_exists(shim):
					return [shim, []]
				var js := shim.get_base_dir().path_join("node_modules/scope-compass/bin/scompass.js")
				if shim != "" and FileAccess.file_exists(js):
					return ["node", [js]]
		return []
	if OS.execute("sh", ["-c", "command -v scompass"], out) == 0 and str(out[0]).strip_edges() != "":
		return [str(out[0]).strip_edges(), []]
	return []


## Corre scompass (cmd, de command()) en el proyecto y espera, en otro hilo: el editor sigue dibujando mientras tanto.
## Bloquear el cuadro no solo congela el editor: el cuadro siguiente llega con todo ese tiempo de golpe y vence en el
## acto los pedidos HTTP con timeout corto (en Windows, Node tarda ~0,5 s en arrancar y el dock no encontraba el hub).
## Devuelve [código, salida]; código -1 si no se encontró scompass.
func run(cmd: Array, args: Array) -> Array:
	if cmd.is_empty():
		return [-1, ""]
	var all: Array = cmd[1] + ["--dir", project_root] + args
	var work := func() -> Array:
		var out := []
		var code := OS.execute(cmd[0], PackedStringArray(all), out, true)
		return [code, str(out[0]).strip_edges() if out.size() else ""]
	if not is_inside_tree():
		return work.call()
	# Uno a la vez (19.10): dos seguidos (doble clic en Actualizar, o un clic durante el check del arranque)
	# compartían _thread, y el primero devolvía -1 ("no encontré scompass") sin esperar a su hilo.
	while _thread != null and is_inside_tree():
		await get_tree().process_frame
	if not is_inside_tree():
		return [-1, ""]
	var th := Thread.new()
	_thread = th
	th.start(work)
	while th.is_alive() and is_inside_tree():
		await get_tree().process_frame
	if _thread != th: # el dock se cerró y _exit_tree ya lo esperó
		return [-1, ""]
	_thread = null
	return th.wait_to_finish()


## Lanza `scompass serve` (cmd, de command()) para el proyecto; keep: el hub sigue al cerrar el editor, con ícono en
## la bandeja. Devuelve si hay proceso; esperar a que responda queda para quien llama.
func launch(cmd: Array, keep: bool) -> bool:
	# Por sh con la salida a un log: si no, el hub hereda el stdout de Godot. exec conserva el PID.
	var log_path := project_root.path_join(".godot/scope_compass_hub.log")
	DirAccess.make_dir_recursive_absolute(log_path.get_base_dir())
	kept = keep
	if OS.get_name() == "Windows":
		# Sin sh (§18): node directo, y el hub escribe él mismo el log (--log). Godot lo lanza sin consola.
		DirAccess.remove_absolute(log_path)
		var args: Array = cmd[1] + ["--dir", project_root, "serve", "--log", log_path]
		if kept:
			pid = OS.create_process(cmd[0], PackedStringArray(args + ["--tray"]))
		else:
			_pipe = OS.execute_with_pipe(cmd[0], PackedStringArray(args + ["--exit-on-stdin-close"]), false)
			pid = int(_pipe.get("pid", -1))
	elif kept:
		# Independiente del editor (5.9): sin tubería y con ícono en la bandeja para detenerlo. create_process ya
		# pone al hijo en su propia sesión (setsid sobra y, al ser líder, haría un fork que cambia el PID).
		var args: Array = ["-c", 'log="$1"; shift; exec "$@" >"$log" 2>&1 </dev/null', "sh", log_path, cmd[0]] + cmd[1] \
			+ ["--dir", project_root, "serve", "--tray"]
		pid = OS.create_process("sh", PackedStringArray(args))
	else:
		var args: Array = ["-c", 'log="$1"; shift; exec "$@" >"$log" 2>&1', "sh", log_path, cmd[0]] + cmd[1] \
			+ ["--dir", project_root, "serve", "--exit-on-stdin-close"]
		# La entrada del hub es una tubería con Godot: si el editor se cierra, se cuelga o lo matan, el hub se va (5.8).
		_pipe = OS.execute_with_pipe("sh", PackedStringArray(args), false)
		pid = int(_pipe.get("pid", -1))
	if pid <= 0:
		pid = -1
		return false
	return true


## Cierra el hub solo si lo abrió este dock y no está en modo "mantener" (salvo force): corta la tubería
## (el hub termina el export pendiente y sale).
## Si en 3 s sigue vivo, SIGTERM (en Windows, OS.kill: no hay señales).
func stop(force := false) -> void:
	if pid <= 0 or (kept and not force):
		return
	for key in ["stdio", "stderr"]:
		if _pipe.get(key) is FileAccess:
			_pipe[key].close()
	_pipe = {}
	var t0 := Time.get_ticks_msec()
	while pid_alive(pid) and Time.get_ticks_msec() - t0 < 3000:
		OS.delay_msec(50)
	if pid_alive(pid):
		if OS.get_name() == "Windows" or OS.execute("kill", ["-TERM", str(pid)]) != 0:
			OS.kill(pid)
	pid = -1


## ¿Sigue vivo el proceso? OS.is_process_running solo conoce los hijos de Godot, y tras un reinicio el hub es
## nieto: kill -0 en Linux; en Windows, tasklist.
static func pid_alive(p: int) -> bool:
	if OS.get_name() == "Windows":
		var out := []
		OS.execute("tasklist", ["/FI", "PID eq %d" % p, "/NH", "/FO", "CSV"], out)
		return ("\"%d\"" % p) in (str(out[0]) if out.size() else "")
	return OS.execute("kill", ["-0", str(p)]) == 0
