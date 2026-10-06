extends Node
## Owns one local simulation process. Rendering/focus never owns simulation time.
signal snapshot_received(message: Dictionary)
signal reply_received(message: Dictionary)
signal connection_changed(connected: bool, description: String)

var stream := StreamPeerTCP.new()
var process_id: int = -1
var port_file: String = ""
var secret: String = ""
var connected: bool = false
var started: bool = false
var stopping: bool = false
var counter: int = 0
var incoming := PackedByteArray()
var outgoing := PackedByteArray()
var startup_seconds: float = 0.0
var shutdown_seconds: float = 0.0
var last_snapshot_seconds: float = 0.0
var requests: Dictionary = {}
var data_directory: String = ""
var latest: Dictionary = {}
var test_directory: String = ""

func start() -> void:
	if started:
		return
	started = true
	var args := OS.get_cmdline_user_args()
	for arg in args:
		if arg.begins_with("--data-dir="):
			test_directory = arg.trim_prefix("--data-dir=")
	data_directory = test_directory if not test_directory.is_empty() else ProjectSettings.globalize_path("user://saves")
	DirAccess.make_dir_recursive_absolute(data_directory)
	port_file = OS.get_cache_dir().path_join("plant01-%d-%d.json" % [OS.get_process_id(), Time.get_ticks_usec()])
	secret = Crypto.new().generate_random_bytes(32).hex_encode()
	var executable := OS.get_environment("PLANT01_NODE")
	if executable.is_empty():
		for candidate in [ProjectSettings.globalize_path("res://runtime/node"), "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]:
			if FileAccess.file_exists(candidate):
				executable = candidate
				break
	if executable.is_empty():
		connection_changed.emit(false, "Node.js runtime was not found. Launch using Open Plant 01.command.")
		return
	var service := ProjectSettings.globalize_path("res://runtime/service.cjs")
	if not FileAccess.file_exists(service):
		connection_changed.emit(false, "Simulation bundle is missing. Run npm run native:build, then reopen.")
		return
	process_id = OS.create_process(executable, PackedStringArray(["--max-old-space-size=384", service, "--port-file=" + port_file, "--token=" + secret, "--data-dir=" + data_directory]))
	if process_id <= 0:
		connection_changed.emit(false, "Could not start the local simulation service.")
		return
	connection_changed.emit(false, "Starting the local simulation…")

func send(action: String, args: Dictionary = {}) -> int:
	counter += 1
	var message := {"id": counter, "action": action, "args": args}
	if action == "hello":
		message["token"] = secret
	requests[counter] = action
	outgoing.append_array((JSON.stringify(message) + "\n").to_utf8_buffer())
	return counter

func _process(delta: float) -> void:
	if not started or process_id <= 0:
		return
	startup_seconds += delta
	if stopping:
		shutdown_seconds += delta
		if shutdown_seconds > 4.0:
			if OS.is_process_running(process_id):
				OS.kill(process_id)
			process_id = -1
			connection_changed.emit(false, "Saved and closed.")
			return
	if not connected:
		if stream.get_status() == StreamPeerTCP.STATUS_NONE and FileAccess.file_exists(port_file):
			var file := FileAccess.open(port_file, FileAccess.READ)
			var info = JSON.parse_string(file.get_as_text())
			if info is Dictionary and int(info.get("port", 0)) > 0:
				var result := stream.connect_to_host("127.0.0.1", int(info.port))
				if result != OK:
					connection_changed.emit(false, "Local connection failed: " + error_string(result))
					return
		if startup_seconds > 15.0 and stream.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			connection_changed.emit(false, "Simulation startup timed out. Your saved game has not been replaced.")
			started = false
			return
	stream.poll()
	var status := stream.get_status()
	if status == StreamPeerTCP.STATUS_CONNECTED:
		if not connected:
			connected = true
			send("hello")
			connection_changed.emit(true, "Connected to the local simulation.")
		if not outgoing.is_empty():
			var sent := stream.put_partial_data(outgoing)
			if sent[0] == OK:
				outgoing = outgoing.slice(int(sent[1]))
			else:
				connection_changed.emit(false, "Could not send an instruction to the simulation.")
		var available := stream.get_available_bytes()
		if available > 0:
			var read := stream.get_partial_data(mini(available, 4 * 1024 * 1024))
			if read[0] == OK:
				incoming.append_array(read[1])
		var consumed: int = 0
		var newest: Dictionary = {}
		for index in range(incoming.size()):
			if incoming[index] != 10:
				continue
			var line := incoming.slice(consumed, index).get_string_from_utf8()
			consumed = index + 1
			var message = JSON.parse_string(line)
			if not message is Dictionary:
				continue
			if message.get("type") == "snapshot":
				newest = message
			elif message.get("type") == "reply":
				message["action"] = requests.get(int(message.get("id", 0)), "")
				requests.erase(int(message.get("id", 0)))
				reply_received.emit(message)
		if consumed > 0:
			incoming = incoming.slice(consumed)
		if not newest.is_empty():
			latest = newest
			last_snapshot_seconds = startup_seconds
			snapshot_received.emit(newest)
		if incoming.size() > 32 * 1024 * 1024:
			connection_changed.emit(false, "Simulation message exceeded the safe receive limit.")
			stream.disconnect_from_host()
	elif connected:
		connected = false
		connection_changed.emit(false, "Saved and closed." if stopping else "Simulation connection closed. Reopen the game to recover the last file save.")
		if stopping:
			process_id = -1
	if connected and not stopping and startup_seconds - last_snapshot_seconds > 10.0 and last_snapshot_seconds > 0:
		connection_changed.emit(false, "Simulation has not responded recently; waiting without replacing your saved game.")

func close() -> void:
	if stopping:
		return
	stopping = true
	if connected:
		send("shutdown")
	else:
		if process_id > 0 and OS.is_process_running(process_id):
			OS.kill(process_id)
		process_id = -1

func _exit_tree() -> void:
	# Closing this socket tells the service to save and stop even if the renderer crashes.
	stream.disconnect_from_host()
	if FileAccess.file_exists(port_file):
		DirAccess.remove_absolute(port_file)
