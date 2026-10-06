extends Node3D
## Native presentation of the existing simulation, using the approved Concept C art.
const Client = preload("res://scripts/runtime_client.gd")
const GameWorld = preload("res://scripts/game_world.gd")
const GameUI = preload("res://scripts/game_ui.gd")
var client: Node
var world: Node3D
var ui: CanvasLayer
var camera := Camera3D.new()
var environment := Environment.new()
var sky_material := ShaderMaterial.new()
var sun := DirectionalLight3D.new()
var state: Dictionary = {}
var target := Vector3(26, 0, 23)
var camera_target := target
var yaw: float = 0.0
var camera_yaw: float = yaw
var pitch: float = deg_to_rad(52)
var camera_pitch: float = pitch
var distance: float = 88.0
var camera_distance: float = distance
var grid: bool = true
var dusk: bool = false
var clock_night: bool = false
var preview_point := Vector3.ZERO
var preview_dirty: bool = false
var preview_clock: float = 0.0
var preview_key: String = ""
var preview_request: int = 0
var backgrounded: bool = false
var dragging: bool = false
var orbiting: bool = false
var drag_point := Vector3.ZERO
var click_screen := Vector2.ZERO
var click_point := Vector3.ZERO
var was_dragged: bool = false
var placing: bool = false
var tool: String = "select"
var placement_rotation: int = 0
var rail_hand: int = 1
var selected_id: String = ""
var follow: bool = false
var controlled_worker: String = ""
var closing: bool = false
var close_clock: float = 0.0
var elapsed: float = 0.0
var file_dialog: FileDialog
var file_action: String = ""
var test_mode: bool = false
var capture_mode: bool = false
var received_snapshots: int = 0
var reply_results: Dictionary = {}

func _ready() -> void:
	Engine.max_fps = 60
	get_tree().auto_accept_quit = false
	get_window().title = "Plant 01 | Native factory game"
	test_mode = "--native-self-test" in OS.get_cmdline_user_args()
	capture_mode = "--native-capture" in OS.get_cmdline_user_args() or "--fixture-capture" in OS.get_cmdline_user_args()
	_setup_environment()
	world = GameWorld.new()
	add_child(world)
	world.setup()
	add_child(camera)
	camera.current = true
	camera.fov = 33.0
	camera.near = 0.2
	camera.far = 500.0
	_update_camera(0, true)
	ui = GameUI.new()
	add_child(ui)
	ui.setup()
	ui.command.connect(_command)
	ui.tool_selected.connect(_select_tool)
	ui.entity_selected.connect(_select_entity)
	ui.focus_entity.connect(_focus_entity)
	ui.preset_requested.connect(_preset)
	ui.grid_requested.connect(_set_grid)
	ui.lighting_requested.connect(_set_lighting)
	ui.file_requested.connect(_request_file)
	client = Client.new()
	add_child(client)
	client.snapshot_received.connect(_snapshot)
	client.reply_received.connect(_reply)
	client.connection_changed.connect(_connection)
	client.start()
	_set_lighting(false)
	print("NATIVE_GAME_STARTED ", JSON.stringify({"engine":Engine.get_version_info().string,"data_directory":client.data_directory}))
	if test_mode:
		_run_self_test.call_deferred()
	elif "--fixture-capture" in OS.get_cmdline_user_args():
		_run_fixture_capture.call_deferred()
	elif capture_mode:
		_run_capture.call_deferred()

func _setup_environment() -> void:
	var world := WorldEnvironment.new()
	add_child(world)
	world.environment = environment
	var sky := Sky.new()
	sky_material.shader = preload("res://shaders/daylight_sky.gdshader")
	sky.sky_material = sky_material
	sky.process_mode = Sky.PROCESS_MODE_QUALITY
	sky.radiance_size = Sky.RADIANCE_SIZE_256
	environment.sky = sky
	environment.background_mode = Environment.BG_SKY
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_sky_contribution = 0.60
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.tonemap_exposure = 1.0
	environment.tonemap_white = 4.0
	environment.ssao_enabled = true
	environment.ssao_radius = 0.8
	environment.ssao_intensity = 1.65
	environment.ssao_detail = 0.5
	environment.ssao_light_affect = 0.0
	environment.ssil_enabled = true
	environment.ssil_radius = 2.0
	environment.ssil_intensity = 0.40
	environment.glow_enabled = true
	environment.glow_intensity = 0.18
	environment.glow_bloom = 0.0
	environment.glow_hdr_threshold = 1.5
	environment.adjustment_enabled = true
	environment.adjustment_saturation = 1.06
	environment.adjustment_contrast = 1.10
	environment.fog_enabled = false
	environment.fog_density = 0.00065
	environment.fog_light_color = Color("a6b7b5")
	environment.fog_sky_affect = 0.0
	add_child(sun)
	sun.shadow_enabled = true
	sun.shadow_bias = 0.025
	sun.shadow_normal_bias = 0.55
	sun.directional_shadow_max_distance = 100.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_blend_splits = true
	sun.light_angular_distance = 0.55

func _set_lighting(value: bool) -> void:
	dusk = value
	if value:
		sun.shadow_bias = 0.12
		sun.shadow_normal_bias = 1.25
		sun.rotation_degrees = Vector3(-13,-62,0)
		sun.light_energy = 0.65
		sun.light_color = Color("ffd098")
		sky_material.set_shader_parameter("dusk",true)
		environment.ambient_light_energy = 0.65
		environment.tonemap_exposure = 1.12
	else:
		sun.shadow_bias = 0.025
		sun.shadow_normal_bias = 0.55
		sun.rotation_degrees = Vector3(-48,-144,0)
		sun.light_energy = 1.65
		sun.light_color = Color("fff1d9")
		sky_material.set_shader_parameter("dusk",false)
		environment.ambient_light_energy = 0.32
		environment.tonemap_exposure = 0.90
	if is_instance_valid(world):
		world.set_dusk(value)

func _snapshot(message: Dictionary) -> void:
	state = message.get("state", {})
	received_snapshots += 1
	world.sync_snapshot(message)
	ui.update_snapshot(message)
	var hour: float = fmod(float(state.get("time", 25200)), 86400.0) / 3600.0
	var night: bool = hour < 6.0 or hour >= 19.0
	if night != clock_night:
		clock_night = night
		_set_lighting(night)

func _reply(message: Dictionary) -> void:
	reply_results[int(message.get("id", 0))] = message
	if reply_results.size() > 200:
		reply_results.erase(reply_results.keys()[0])
	if message.get("action") == "rail_preview":
		if int(message.get("id",0)) == preview_request and tool.begins_with("rail") and message.get("ok",false):
			var preview: Dictionary = message.get("result",{})
			world.preview_track(preview.get("geometries",[]),str(preview.get("error","")).is_empty())
		return
	ui.receive_reply(message)
	if not message.get("ok", false):
		ui.show_error(str(message.get("error", "Instruction could not be completed.")))
	elif message.get("action") in ["new_game", "continue", "import"]:
		if message.get("action") != "continue":
			_preset("yard")
	if message.get("action") == "shutdown":
		get_tree().quit()

func _connection(connected: bool, description: String) -> void:
	print("NATIVE_CONNECTION ", connected, " ", description)
	if not connected:
		ui.show_error(description)

func _command(action: String, args: Dictionary = {}) -> void:
	if action == "rotate":
		_rotate_placement()
		return
	if action == "rail_hand":
		rail_hand = -rail_hand
		preview_dirty = true
		return
	if action == "shutdown":
		_begin_close()
		return
	if action in ["control", "take_control"]:
		controlled_worker = str(args.get("id", args.get("workerId", "")))
	if action in ["release", "release_worker"]:
		controlled_worker = ""
	client.send(action, args)

func _select_entity(id: String) -> void:
	selected_id = id
	world.set_selected(id)
	ui.show_entity(id)

func _focus_entity(id: String) -> void:
	_select_entity(id)
	var pos: Vector3 = world.entity_position(id)
	target = Vector3(pos.x, 0.0, pos.z)
	distance = minf(distance, 38.0)

func _select_tool(value: String) -> void:
	tool = value
	placing = false
	preview_key = ""
	preview_request = 0
	preview_dirty = false
	world.preview({}, true)
	if value == "select":
		return
	follow = false

func _set_grid(value: bool) -> void:
	grid = value
	world.set_grid(value)

func _preset(name: String) -> void:
	match name.to_lower():
		"yard", "home":
			target = Vector3(28, 0, 26)
			distance = 103.0
			pitch = deg_to_rad(52)
			yaw = 0.0
		"overview":
			target = Vector3(100, 0, 40)
			distance = 220.0
			pitch = deg_to_rad(57)
			camera.far = 650.0
		"rail end", "rail-end", "rail_end", "trackside":
			var end: Dictionary = state.get("buffer", {"x":125,"z":5})
			target = Vector3(float(end.x),0,float(end.z))
			distance = 50.0
			pitch = deg_to_rad(43)
		"equipment":
			if not selected_id.is_empty():
				_focus_entity(selected_id)
			distance = 23.0
			pitch = deg_to_rad(35)
	follow = false

func _floor_point(screen: Vector2) -> Variant:
	return Plane(Vector3.UP, 0.0).intersects_ray(camera.project_ray_origin(screen),camera.project_ray_normal(screen))

func _rect(a: Vector3, b: Vector3) -> Dictionary:
	var x1: int = floori(minf(a.x,b.x))
	var z1: int = floori(minf(a.z,b.z))
	return {"x":x1,"z":z1,"w":mini(100,absi(floori(a.x)-floori(b.x))+1),"d":mini(100,absi(floori(a.z)-floori(b.z))+1)}

func _rotate_placement() -> void:
	if tool == "relocate":
		ui.show_error("A stock relocation preserves the stack orientation and footprint.")
		return
	placement_rotation = (placement_rotation + 1) % 4
	preview_dirty = true
	_placement_preview(preview_point)

func _placement_preview(point: Vector3) -> void:
	preview_point = point
	if tool.begins_with("rail"):
		preview_dirty = true
		return
	var rect := _rect(click_point if placing else point,point)
	if tool not in ["slab", "zone"]:
		var sizes := {"office":Vector2i(6,3),"sanitary":Vector2i(3,2),"shed":Vector2i(8,6),"store":Vector2i(6,4),"lamp":Vector2i(1,1),"fence":Vector2i(3,1),"power":Vector2i(1,1),"water":Vector2i(1,1),"railStraight":Vector2i(5,2),"railCurve":Vector2i(20,20),"railTurnout":Vector2i(20,7),"parking":Vector2i(3,5),"relocate":Vector2i(5,2)}
		var size: Vector2i = sizes.get(tool,Vector2i(1,1))
		if tool == "relocate":
			for stack: Dictionary in state.get("stacks",[]):
				if str(stack.id) == selected_id: size = Vector2i(int(stack.w),int(stack.d))
		if placement_rotation % 2 and tool != "relocate":
			size = Vector2i(size.y,size.x)
		rect = {"x":floori(point.x),"z":floori(point.z),"w":size.x,"d":size.y}
	world.preview(rect,true)

func _place(a: Vector3, b: Vector3) -> void:
	var rect := _rect(a,b)
	match tool:
		"slab": client.send("pave", {"rect":rect})
		"zone": client.send("zone", {"rect":rect,"name":"Stockyard %d" % (state.get("zones",[]).size()+1)})
		"railStraight", "railCurve", "railTurnout":
			var layout := {"railStraight":"straight","railCurve":"curve","railTurnout":"turnout"}
			client.send("plan_rail", {"layout":layout[tool],"x":roundi(a.x),"z":roundi(a.z),"heading":placement_rotation,"hand":rail_hand,"snap":true})
		"drive":
			var worker_id := controlled_worker
			for e: Dictionary in state.get("equipment",[]):
				if e.id == selected_id:
					worker_id = str(e.get("operator",""))
			if selected_id.begins_with("WRK"):
				worker_id = selected_id
			if worker_id.is_empty():
				ui.show_error("Take control of a worker or board a machine first.")
			else:
				client.send("move_worker", {"id":worker_id,"x":b.x,"z":b.z})
		"parking": client.send("parking", {"id":selected_id,"x":floori(b.x)+0.5,"z":floori(b.z)+0.5,"rotation":placement_rotation})
		"relocate": client.send("move_stock", {"id":selected_id,"x":floori(b.x),"z":floori(b.z),"rotation":placement_rotation})
		_:
			client.send("plan", {"kind":tool,"x":floori(a.x),"z":floori(a.z),"rotation":placement_rotation%2,"foundations":true})

func _unhandled_input(event: InputEvent) -> void:
	if closing:
		return
	if event is InputEventMouseButton:
		var mouse := event as InputEventMouseButton
		var point = _floor_point(mouse.position)
		if mouse.button_index == MOUSE_BUTTON_LEFT:
			if mouse.pressed and point is Vector3:
				click_screen = mouse.position
				click_point = point
				drag_point = point
				was_dragged = false
				if tool != "select":
					placing = true
					_placement_preview(point)
				else:
					dragging = true
			elif not mouse.pressed and point is Vector3:
				if placing:
					_place(click_point,point)
				elif not was_dragged:
					var picked: String = world.pick_screen(camera,mouse.position) if world.has_method("pick_screen") else ""
					if picked.is_empty():
						picked = world.pick_ground(point)
					if not picked.is_empty():
						_select_entity(picked)
					elif not controlled_worker.is_empty():
						client.send("move_worker", {"id":controlled_worker,"x":point.x,"z":point.z})
					else:
						_select_entity("")
				dragging = false
				placing = false
		elif mouse.button_index == MOUSE_BUTTON_RIGHT:
			orbiting = mouse.pressed
		elif mouse.pressed and mouse.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = clampf(distance*0.90,12.0,240.0)
		elif mouse.pressed and mouse.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = clampf(distance*1.10,12.0,240.0)
	elif event is InputEventMagnifyGesture:
		distance = clampf(distance/event.factor,12.0,240.0)
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		var point = _floor_point(motion.position)
		if tool != "select" and point is Vector3:
			_placement_preview(point)
		if dragging and point is Vector3:
			if motion.position.distance_to(click_screen) > 4.0:
				was_dragged = true
			if was_dragged:
				target += drag_point - (point as Vector3)
				camera_target = target
				follow = false
				_update_camera(0,true)
		elif orbiting:
			yaw -= motion.relative.x*0.005
			pitch = clampf(pitch-motion.relative.y*0.004,deg_to_rad(22),deg_to_rad(76))
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.is_command_or_control_pressed() and event.keycode == KEY_S:
			_request_file("save")
			get_viewport().set_input_as_handled()
			return
		match event.keycode:
			KEY_ESCAPE:
				_select_tool("select")
				controlled_worker = ""
				_select_entity("")
			KEY_R: _rotate_placement()
			KEY_TAB:
				rail_hand = -rail_hand
				preview_dirty = true
			KEY_G: _set_grid(not grid)
			KEY_HOME: _preset("yard")
			KEY_F: follow = not follow
			KEY_SPACE: client.send("pause", {"paused":not state.get("paused",false)})
			KEY_1: client.send("speed", {"value":1})
			KEY_2: client.send("speed", {"value":3})
			KEY_3: client.send("speed", {"value":10})
			KEY_B:
				if ui.has_method("show_purchase"): ui.show_purchase()
			KEY_F12: _save_capture("native-%s.png" % Time.get_datetime_string_from_system().replace(":","-"))

func _input(event: InputEvent) -> void:
	# UI can consume release; process only cancellation here and defer valid placement release.
	if event is InputEventMouseButton and not event.pressed:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			orbiting = false
		elif event.button_index == MOUSE_BUTTON_LEFT:
			_reset_drag.call_deferred()

func _reset_drag() -> void:
	dragging = false
	placing = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		backgrounded = true
		Engine.max_fps = 15
		dragging = false
		orbiting = false
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN:
		backgrounded = false
		Engine.max_fps = 60
	elif what == NOTIFICATION_WM_CLOSE_REQUEST:
		_begin_close()

func _begin_close() -> void:
	if closing:
		return
	closing = true
	ui.show_error("Saving the yard before closing…")
	client.close()

func _update_camera(dt: float, snap: bool = false) -> void:
	var fraction: float = 1.0 if snap else 1.0-exp(-dt*12.0)
	camera_target = camera_target.lerp(target,fraction)
	camera_distance = lerpf(camera_distance,distance,fraction)
	camera_yaw = lerp_angle(camera_yaw,yaw,fraction)
	camera_pitch = lerpf(camera_pitch,pitch,fraction)
	var offset := Vector3(sin(camera_yaw)*cos(camera_pitch),sin(camera_pitch),cos(camera_yaw)*cos(camera_pitch))*camera_distance
	camera.position = camera_target+offset
	camera.look_at(camera_target)

func _process(dt: float) -> void:
	elapsed += dt
	preview_clock += dt
	if preview_dirty and preview_clock >= 0.18 and tool.begins_with("rail"):
		preview_clock = 0.0
		preview_dirty = false
		var key := "%s:%d:%d:%d:%d" % [tool,roundi(preview_point.x),roundi(preview_point.z),placement_rotation,rail_hand]
		if key != preview_key:
			preview_key = key
			var layout := {"railStraight":"straight","railCurve":"curve","railTurnout":"turnout"}
			preview_request = client.send("rail_preview", {"layout":layout[tool],"x":roundi(preview_point.x),"z":roundi(preview_point.z),"heading":placement_rotation,"hand":rail_hand,"snap":true})
	if closing:
		close_clock += dt
		if close_clock > 4.5:
			get_tree().quit()
		return
	if is_instance_valid(world):
		world.visible = ui.active_tab == "Yard"
		world.advance(dt)
	var text_input: bool = get_viewport().gui_get_focus_owner() is LineEdit or get_viewport().gui_get_focus_owner() is TextEdit
	if not backgrounded and not text_input and not test_mode and not capture_mode:
		var forward := Vector3(-sin(camera_yaw),0,-cos(camera_yaw))
		var right := Vector3(cos(camera_yaw),0,-sin(camera_yaw))
		var movement := Vector3.ZERO
		if Input.is_physical_key_pressed(KEY_W): movement += forward
		if Input.is_physical_key_pressed(KEY_S): movement -= forward
		if Input.is_physical_key_pressed(KEY_D): movement += right
		if Input.is_physical_key_pressed(KEY_A): movement -= right
		if movement.length_squared() > 0:
			target += movement.limit_length()*dt*distance*0.25
			follow = false
		if Input.is_physical_key_pressed(KEY_Q): yaw -= dt*0.65
		if Input.is_physical_key_pressed(KEY_E): yaw += dt*0.65
	if follow and not selected_id.is_empty():
		var pos: Vector3 = world.entity_position(selected_id)
		target = Vector3(pos.x,0,pos.z)
	_update_camera(dt)
	if capture_mode and not DisplayServer.window_can_draw():
		RenderingServer.viewport_set_update_mode(get_viewport().get_viewport_rid(),RenderingServer.VIEWPORT_UPDATE_ALWAYS)
		RenderingServer.force_draw(false)

func _request_file(action: String) -> void:
	if action == "folder":
		OS.shell_open(client.data_directory)
		return
	if action == "costs":
		action = "export_costs"
	if action == "save":
		client.send("save")
		return
	file_action = action
	if is_instance_valid(file_dialog):
		file_dialog.queue_free()
	file_dialog = FileDialog.new()
	file_dialog.access = FileDialog.ACCESS_FILESYSTEM
	file_dialog.use_native_dialog = true
	file_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE if action in ["import", "load"] else FileDialog.FILE_MODE_SAVE_FILE
	file_dialog.title = {"import":"Import a browser or native save","load":"Open a saved yard","export":"Export a portable save","diagnostics":"Export diagnostic recording","export_costs":"Export cost ledger"}.get(action,action.capitalize())
	file_dialog.filters = PackedStringArray(["*.csv ; CSV file"]) if action == "export_costs" else PackedStringArray(["*.json ; JSON file"])
	file_dialog.current_dir = client.data_directory
	file_dialog.current_file = "plant01-diagnostics.json" if action == "diagnostics" else "plant01-costs.csv" if action == "export_costs" else "plant01-save.json"
	ui.add_child(file_dialog)
	file_dialog.file_selected.connect(func(path: String): client.send("import" if file_action == "load" else file_action, {"path":path}))
	file_dialog.popup_centered_ratio(0.70)

func _save_capture(filename: String) -> void:
	await get_tree().process_frame
	RenderingServer.viewport_set_update_mode(get_viewport().get_viewport_rid(),RenderingServer.VIEWPORT_UPDATE_ALWAYS)
	RenderingServer.force_draw(false)
	var image := get_viewport().get_texture().get_image()
	var path := ProjectSettings.globalize_path(("res://captures/" if capture_mode else "user://captures/") + filename)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var error := image.save_png(path)
	print("NATIVE_CAPTURE ",path," result=",error)

func _await_reply(id: int, timeout: float = 8.0) -> Dictionary:
	var deadline: int = Time.get_ticks_msec() + int(timeout*1000)
	while not reply_results.has(id) and Time.get_ticks_msec() < deadline:
		await get_tree().process_frame
	return reply_results.get(id, {"ok":false,"error":"Timed out waiting for request %d" % id})

func _test_assert(condition: bool, text: String) -> void:
	if not condition:
		push_error("NATIVE_TEST_FAILED: " + text)
		client.close()
		get_tree().quit(1)
	else:
		print("NATIVE_TEST_PASS ", text)

func _wait_connection() -> void:
	var deadline: int = Time.get_ticks_msec()+15000
	while received_snapshots == 0 and Time.get_ticks_msec() < deadline:
		await get_tree().process_frame

func _run_self_test() -> void:
	await _wait_connection()
	_test_assert(received_snapshots > 0,"Authenticated local simulation and initial snapshot")
	var result: Dictionary = await _await_reply(client.send("new_game", {"mode":"example"}))
	_test_assert(result.get("ok",false),"Create example through the real native bridge")
	await get_tree().create_timer(0.5).timeout
	_test_assert(state.get("workers",[]).size() > 0 and state.get("equipment",[]).size() == 2,"Worker and machine models derive from simulation")
	_test_assert(camera.projection == Camera3D.PROJECTION_PERSPECTIVE,"True perspective camera")
	var original := target
	_preset("overview")
	_test_assert(target != original and distance > 100,"Native overview navigation")
	_preset("yard")
	var equipment: Dictionary = state.equipment[0]
	_select_entity(str(equipment.id))
	_focus_entity(str(equipment.id))
	_test_assert(selected_id == equipment.id,"Clickable entity focus and inspection")
	_set_grid(false)
	_test_assert(not grid,"Grid display toggle")
	_set_grid(true)
	result = await _await_reply(client.send("speed", {"value":1}))
	_test_assert(result.get("ok",false),"Set actual real-time simulation speed")
	var before: float = float(state.get("elapsed",0))
	_notification(NOTIFICATION_APPLICATION_FOCUS_OUT)
	await get_tree().create_timer(2.2).timeout
	var advanced: float = float(state.get("elapsed",0))-before
	_test_assert(advanced > 1.5 and advanced < 3.2,"Simulation continues while native window is unfocused at real-time speed")
	_notification(NOTIFICATION_APPLICATION_FOCUS_IN)
	result = await _await_reply(client.send("pause", {"paused":true}))
	_test_assert(result.get("ok",false),"Native pause control")
	await get_tree().create_timer(0.3).timeout
	before = float(state.elapsed)
	await get_tree().create_timer(0.6).timeout
	_test_assert(absf(float(state.elapsed)-before) < 0.1,"Pause stops the independent simulation clock")
	result = await _await_reply(client.send("purchase_batch", {"lines":[{"item":"builder","qty":3}],"mode":"road"}))
	_test_assert(result.get("ok",false),"Batch hiring dispatch")
	result = await _await_reply(client.send("zone", {"rect":{"x":65,"z":40,"w":12,"d":12},"name":"Native test yard"}))
	_test_assert(result.get("ok",false),"Native stockyard planning")
	result = await _await_reply(client.send("pave", {"rect":{"x":60,"z":60,"w":2,"d":2}}))
	_test_assert(result.get("ok",false),"Native multi-cell paving planning")
	result = await _await_reply(client.send("save"))
	_test_assert(result.get("ok",false),"Atomic native file save")
	result = await _await_reply(client.send("sql", {"sql":"SELECT COUNT(*) AS workers FROM workers;"}))
	_test_assert(result.get("ok",false),"SQLite reporting without a browser")
	result = await _await_reply(client.send("diagnostics", {"path":client.data_directory.path_join("test-diagnostics.json")}))
	_test_assert(result.get("ok",false),"Bounded local diagnostic export")
	print("NATIVE_SELF_TEST_COMPLETE ",JSON.stringify({"snapshots":received_snapshots,"background_seconds":advanced,"save_dir":client.data_directory,"nodes":get_tree().get_node_count()}))
	_begin_close()

func _run_capture() -> void:
	await _wait_connection()
	var result: Dictionary = await _await_reply(client.send("new_game", {"mode":"example"}))
	if not result.get("ok",false):
		push_error("Native capture failed to start example")
		_begin_close()
		return
	await _await_reply(client.send("pause", {"paused":true}))
	await get_tree().create_timer(2.0).timeout
	_preset("yard")
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	ui.toast.hide()
	await _save_capture("01-native-yard.png")
	if state.equipment.size() > 0:
		_select_entity(str(state.equipment[0].id))
		_preset("equipment")
		_update_camera(0,true)
		await get_tree().create_timer(1.5).timeout
		await _save_capture("02-native-equipment.png")
	if ui.has_method("show_tab"):
		await _await_reply(client.send("pave", {"rect":{"x":60,"z":50,"w":8,"d":5}}))
		ui.show_tab("Work")
		await get_tree().create_timer(0.5).timeout
		await _save_capture("03-native-work.png")
	ui.show_tab("Yard")
	_select_entity("")
	_preset("yard")
	_update_camera(0,true)
	_set_lighting(true)
	await get_tree().create_timer(1.5).timeout
	ui.toast.hide()
	await _save_capture("04-native-dusk.png")
	print("NATIVE_CAPTURE_COMPLETE")
	_begin_close()


func _run_fixture_capture() -> void:
	await _wait_connection()
	var index = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/index.json"))
	for fixture: Dictionary in index.fixtures:
		var result: Dictionary = await _await_reply(client.send("import", {"path":ProjectSettings.globalize_path("res://tests/"+str(fixture.file))}))
		if not result.get("ok",false):
			push_error("Fixture import failed: "+str(fixture.name))
			_begin_close()
			return
		await get_tree().create_timer(0.35).timeout
		ui.show_tab("Yard")
		_select_entity("")
		var focus: Dictionary = fixture.focus
		if focus.has("id"):
			for e: Dictionary in state.get("equipment",[]):
				if e.id == focus.id: focus = e
		target = Vector3(float(focus.x),0,float(focus.z))
		distance = 42.0
		pitch = deg_to_rad(44)
		yaw = deg_to_rad(-16)
		if fixture.name == "delivered-stockyard": distance = 80;pitch = deg_to_rad(52)
		if fixture.name == "worker-fuel-can": distance = 27
		if fixture.name == "rail-unloading": distance = 65;target.x += 7
		if fixture.name == "rail-buffer-lift": distance = 37
		_update_camera(0,true)
		await get_tree().create_timer(1.0).timeout
		ui.toast.hide()
		await _save_capture("fixture-"+str(fixture.name)+".png")
	print("NATIVE_FIXTURE_CAPTURE_COMPLETE")
	if "--native-capture" in OS.get_cmdline_user_args():
		await _run_capture()
	else:
		_begin_close()
