extends Node3D

const Ground = preload("res://scripts/ground.gd")
const RailYard = preload("res://scripts/rail_yard.gd")
const Machines = preload("res://scripts/machines.gd")

var camera := Camera3D.new()
var environment := Environment.new()
var sky_material := ShaderMaterial.new()
var sun := DirectionalLight3D.new()
var target := Vector3(0.0,0.0,-1.0)
var camera_target := target
var yaw: float = 0.035
var camera_yaw: float = yaw
var pitch: float = deg_to_rad(57.0)
var camera_pitch: float = pitch
var distance: float = 69.0
var camera_distance: float = distance
var drag_point := Vector3.ZERO
var dragging: bool = false
var orbiting: bool = false
var dusk: bool = false
var grid: bool = true
var ui := CanvasLayer.new()
var hud_status := Label.new()
var day_button: Button
var dusk_button: Button
var grid_button: Button
var ground_data: Dictionary = {}
var yard_data: Dictionary = {}
var machine_data: Dictionary = {}
var frame_samples: Array[float] = []
var elapsed: float = 0.0
var last_status: float = 0.0
var capturing: bool = false
var backgrounded: bool = false
var capture_directory: String = "res://captures"
var first_frame: bool = true
var last_frame_us: int = 0
var mode_reports: Array[Dictionary] = []
var last_capture_size := Vector2i.ZERO

func _ready() -> void:
	Engine.max_fps = 60
	DisplayServer.window_set_title("Plant 01 | Godot visual proof")
	var startup: int = Time.get_ticks_msec()
	ground_data = Ground.build(self)
	yard_data = RailYard.build(self)
	machine_data = Machines.build(self)
	(machine_data["excavator"] as Node3D).rotation.y = -PI/2.0
	(machine_data["excavator"] as Node3D).position.y = 0.0
	(machine_data["workers"][0] as Node3D).position.y = 0.0
	(machine_data["forklift"] as Node3D).rotation.y = PI/2.0
	(machine_data["forklift"] as Node3D).position.z -= 4.0
	for worker_index in [1,4]:
		(machine_data["workers"][worker_index] as Node3D).position.z -= 4.0
	if "--plain-materials" in OS.get_cmdline_user_args():
		_plain_materials(self)
	_setup_environment()
	add_child(camera)
	camera.current = true
	camera.fov = 33.0
	camera.near = 0.2
	camera.far = 220.0
	_preset("yard")
	_update_camera(1.0, true)
	_setup_ui()
	_set_lighting(false)
	(ground_data["ground_material"] as ShaderMaterial).set_shader_parameter("show_grid",grid)
	grid_button.set_pressed_no_signal(grid)
	print("PROOF_READY ", JSON.stringify({"engine": Engine.get_version_info().string,"renderer":RenderingServer.get_current_rendering_method(),"device":RenderingServer.get_video_adapter_name(),"build_ms":Time.get_ticks_msec()-startup,"nodes":get_tree().get_node_count(),"ground":{"slabs":ground_data.get("slab_count",0),"vegetation":ground_data.get("vegetation_instances",0)}}))
	var args: PackedStringArray = OS.get_cmdline_user_args()
	print("PROOF_ARGUMENTS ",args)
	if "--capture-suite" in args:
		_run_capture_suite.call_deferred()
	elif "--shadow-study" in args:
		_run_shadow_study.call_deferred()
	elif "--look-study" in args:
		_run_look_study.call_deferred()
	elif "--review-capture" in args or "--dusk-review" in args:
		_run_review_capture.call_deferred()
	elif "--self-test" in args:
		_self_test.call_deferred()

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

func _plain_materials(parent: Node) -> void:
	for child: Node in parent.get_children():
		if child is GeometryInstance3D and child.material_override is ShaderMaterial:
			var plain := StandardMaterial3D.new()
			plain.albedo_color = Color("8d9577")
			plain.roughness = 0.9
			child.material_override = plain
		_plain_materials(child)

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
	for light: OmniLight3D in yard_data.get("lamps",[]):
		light.light_energy = 10.0 if value else 0.0
	for light: OmniLight3D in yard_data.get("lamps",[]):
		var material: StandardMaterial3D = light.get_meta("lamp_glass",null) as StandardMaterial3D
		if material:
			material.emission_enabled = value
			material.emission = Color("ffd99c")
			material.emission_energy_multiplier = 3.5 if value else 0.0
	if is_instance_valid(day_button):
		day_button.set_pressed_no_signal(not value)
		dusk_button.set_pressed_no_signal(value)

func _style(background: Color, border: Color, margins: int = 10) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(3)
	style.content_margin_left = margins
	style.content_margin_right = margins
	style.content_margin_top = 6
	style.content_margin_bottom = 6
	return style

func _button(text: String, callback: Callable, toggle: bool = false) -> Button:
	var button := Button.new()
	button.text = text
	button.toggle_mode = toggle
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_color_override("font_color",Color("2b423b"))
	button.add_theme_color_override("font_pressed_color",Color("17352c"))
	button.add_theme_font_size_override("font_size",16)
	button.add_theme_stylebox_override("normal",_style(Color("f0f1e9"),Color("bfc8bc")))
	button.add_theme_stylebox_override("hover",_style(Color("e0e8db"),Color("8da38e")))
	button.add_theme_stylebox_override("pressed",_style(Color("cadac5"),Color("7f987c")))
	button.pressed.connect(callback)
	return button

func _text(text: String, size: int = 16, color: Color = Color("33483c")) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size",size)
	label.add_theme_color_override("font_color",color)
	return label

func _setup_ui() -> void:
	add_child(ui)
	var top := PanelContainer.new()
	top.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	top.offset_bottom = 48
	top.add_theme_stylebox_override("panel",_style(Color("f4f3eb"),Color("a8b4a0"),20))
	ui.add_child(top)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation",12)
	top.add_child(row)
	row.add_child(_text("P₀₁",25,Color("305747")))
	var heading := VBoxContainer.new()
	heading.add_theme_constant_override("separation",-2)
	row.add_child(heading)
	heading.add_child(_text("PLANT 01",17))
	heading.add_child(_text("NATIVE VISUAL STUDY",10,Color("7a8b78")))
	var space := Control.new()
	space.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(space)
	day_button = _button("Daylight",func(): _set_lighting(false),true)
	dusk_button = _button("Dusk",func(): _set_lighting(true),true)
	row.add_child(day_button)
	row.add_child(dusk_button)
	row.add_child(_button("Yard",func(): _preset("yard")))
	row.add_child(_button("Equipment",func(): _preset("equipment")))
	row.add_child(_button("Trackside",func(): _preset("trackside")))
	grid_button = _button("Grid",_toggle_grid,true)
	row.add_child(grid_button)
	row.add_child(_button("Screenshot",_capture_manual))
	var bottom := PanelContainer.new()
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_top = -37
	bottom.add_theme_stylebox_override("panel",_style(Color("f4f3eb"),Color("a8b4a0"),16))
	ui.add_child(bottom)
	var bottom_row := HBoxContainer.new()
	bottom.add_child(bottom_row)
	bottom_row.add_child(_text("Drag ground to pan  ·  Scroll to zoom  ·  W A S D move  ·  Q E rotate  ·  H hide interface",13))
	var bottom_space := Control.new()
	bottom_space.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bottom_row.add_child(bottom_space)
	hud_status.add_theme_font_size_override("font_size",13)
	hud_status.add_theme_color_override("font_color",Color("5b725d"))
	bottom_row.add_child(hud_status)
	var info := PanelContainer.new()
	info.position = Vector2(20,82)
	info.mouse_filter = Control.MOUSE_FILTER_IGNORE
	info.add_theme_stylebox_override("panel",_style(Color(0.95,0.96,0.92,0.85),Color(0.5,0.6,0.5,0.3),14))
	ui.add_child(info)
	info.visible = false
	var info_text := _text("Concept C · native rendering\n1 m grid · 1,435 mm gauge · visual proof",13)
	info.add_child(info_text)

func _toggle_grid() -> void:
	grid = not grid
	var material: ShaderMaterial = ground_data.get("ground_material") as ShaderMaterial
	if material:
		material.set_shader_parameter("show_grid",grid)
	grid_button.set_pressed_no_signal(grid)

func _preset(name: String) -> void:
	match name:
		"yard":
			target = Vector3(-1,0,-5.0)
			distance = 72
			pitch = deg_to_rad(52)
			yaw = 0.0
		"equipment":
			target = Vector3(2,1.2,0)
			distance = 22
			pitch = deg_to_rad(34)
			yaw = -0.28
		"trackside":
			target = Vector3(4,0,-7)
			distance = 37
			pitch = deg_to_rad(38)
			yaw = 0.52

func _floor_point(screen: Vector2) -> Variant:
	var origin: Vector3 = camera.project_ray_origin(screen)
	var direction: Vector3 = camera.project_ray_normal(screen)
	return Plane(Vector3.UP,0.0).intersects_ray(origin,direction)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mouse := event as InputEventMouseButton
		if mouse.button_index == MOUSE_BUTTON_LEFT:
			dragging = mouse.pressed
			var point: Variant = _floor_point(mouse.position)
			if point is Vector3:
				drag_point = point
			else:
				dragging = false
		elif mouse.button_index == MOUSE_BUTTON_RIGHT:
			orbiting = mouse.pressed
		elif mouse.pressed and mouse.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = clampf(distance*0.90,10,105)
		elif mouse.pressed and mouse.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = clampf(distance*1.10,10,105)
	elif event is InputEventMagnifyGesture:
		distance = clampf(distance / event.factor,10,105)
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		if dragging:
			var point: Variant = _floor_point(motion.position)
			if point is Vector3:
				target += drag_point-(point as Vector3)
				camera_target = target
				_update_camera(0,true)
		elif orbiting:
			yaw -= motion.relative.x*0.005
			pitch = clampf(pitch-motion.relative.y*0.004,deg_to_rad(22),deg_to_rad(76))
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_H: ui.visible = not ui.visible
			KEY_G: _toggle_grid()
			KEY_1: _set_lighting(false)
			KEY_2: _set_lighting(true)
			KEY_HOME: _preset("yard")
			KEY_F12: _capture_manual()
			KEY_ESCAPE: get_tree().quit()

func _input(event: InputEvent) -> void:
	# Release still ends a drag if the pointer has crossed into a toolbar.
	if event is InputEventMouseButton and not event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT: dragging = false
		if event.button_index == MOUSE_BUTTON_RIGHT: orbiting = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		backgrounded = true
		Engine.max_fps = 60 if capturing else 15
		dragging = false
		orbiting = false
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN:
		backgrounded = false
		Engine.max_fps = 60

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
	if first_frame:
		first_frame = false
		print("PROOF_FIRST_FRAME")
	elapsed += dt
	if not capturing and not backgrounded:
		var forward := Vector3(-sin(camera_yaw),0,-cos(camera_yaw))
		var right := Vector3(cos(camera_yaw),0,-sin(camera_yaw))
		var movement := Vector3.ZERO
		if Input.is_physical_key_pressed(KEY_W): movement += forward
		if Input.is_physical_key_pressed(KEY_S): movement -= forward
		if Input.is_physical_key_pressed(KEY_D): movement += right
		if Input.is_physical_key_pressed(KEY_A): movement -= right
		target += movement.limit_length()*dt*distance*0.25
		if Input.is_physical_key_pressed(KEY_Q): yaw -= dt*0.65
		if Input.is_physical_key_pressed(KEY_E): yaw += dt*0.65
		_update_camera(dt)
	var now_us: int = Time.get_ticks_usec()
	if last_frame_us > 0 and elapsed > 3.0:
		frame_samples.append((now_us-last_frame_us)/1000.0)
		if frame_samples.size() > 600:
			frame_samples.pop_front()
	last_frame_us = now_us
	if elapsed-last_status > 0.8:
		last_status = elapsed
		hud_status.text = "%s · %d FPS · Godot 4.7" % ["Dusk" if dusk else "Daylight",Engine.get_frames_per_second()]
	if capturing and not DisplayServer.window_can_draw():
		RenderingServer.viewport_set_update_mode(get_viewport().get_viewport_rid(),RenderingServer.VIEWPORT_UPDATE_ALWAYS)
		RenderingServer.force_draw(false)

func _save_capture(filename: String) -> void:
	print("CAPTURE_REQUEST ",filename," drawable=",DisplayServer.window_can_draw())
	# Window drawing may be suppressed when another macOS window fully covers it.
	# Capture explicitly rather than waiting forever for a skipped draw signal.
	await get_tree().process_frame
	RenderingServer.viewport_set_update_mode(get_viewport().get_viewport_rid(),RenderingServer.VIEWPORT_UPDATE_ALWAYS)
	RenderingServer.force_draw(false)
	var path: String = ProjectSettings.globalize_path(capture_directory.path_join(filename))
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var captured_image: Image = get_viewport().get_texture().get_image()
	last_capture_size = captured_image.get_size()
	var error: Error = captured_image.save_png(path)
	if error != OK:
		push_error("Capture failed: %s (%s)" % [path,error_string(error)])
	else:
		print("CAPTURE_SAVED ",path)

func _capture_manual() -> void:
	var filename: String = "plant01-%s-%s.png" % ["dusk" if dusk else "day",Time.get_datetime_string_from_system().replace(":","-")]
	_save_capture(filename)

func _run_review_capture() -> void:
	_set_lighting("--dusk-review" in OS.get_cmdline_user_args())
	capturing = true
	Engine.max_fps = 60
	await get_tree().create_timer(4.0).timeout
	_preset("yard")
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	await _save_capture("review-dusk.png" if dusk else "review-daylight.png")
	_preset("equipment")
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	await _save_capture("review-dusk-equipment.png" if dusk else "review-equipment.png")
	_write_performance()
	get_tree().quit()

func _run_shadow_study() -> void:
	capturing = true
	_preset("equipment")
	_update_camera(0,true)
	_set_lighting(true)
	await get_tree().create_timer(4.0).timeout
	await _save_capture("shadow-original.png")
	sun.shadow_enabled = false
	await get_tree().create_timer(2.0).timeout
	await _save_capture("shadow-no-sun.png")
	sun.shadow_enabled = true
	for lamp: OmniLight3D in yard_data.get("lamps",[]):
		lamp.shadow_enabled = false
	await get_tree().create_timer(2.0).timeout
	await _save_capture("shadow-no-lamp.png")
	get_tree().quit()

func _run_look_study() -> void:
	capturing = true
	Engine.max_fps = 60
	await get_tree().create_timer(4.0).timeout
	_preset("yard")
	_update_camera(0,true)
	var modes := [Environment.TONE_MAPPER_ACES,Environment.TONE_MAPPER_AGX,Environment.TONE_MAPPER_FILMIC]
	for index in range(modes.size()):
		environment.tonemap_mode = modes[index]
		environment.tonemap_exposure = 0.90 if index < 2 else 1.6
		environment.tonemap_agx_contrast = 1.35
		await get_tree().create_timer(2.0).timeout
		await _save_capture("look-%d.png"%index)
	get_tree().quit()

func _run_capture_suite() -> void:
	print("CAPTURE_SUITE_START")
	capturing = true
	Engine.max_fps = 60
	await get_tree().create_timer(4.0).timeout
	print("CAPTURE_WARMUP_DONE")
	_set_lighting(false)
	_preset("yard")
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	frame_samples.clear()
	await get_tree().create_timer(2.0).timeout
	await _save_capture("01-daylight.png")
	_collect_mode_report("daylight")
	_set_lighting(true)
	await get_tree().create_timer(2.0).timeout
	frame_samples.clear()
	await get_tree().create_timer(2.0).timeout
	await _save_capture("02-dusk.png")
	_collect_mode_report("dusk")
	_set_lighting(false)
	_preset("equipment")
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	frame_samples.clear()
	await get_tree().create_timer(2.0).timeout
	await _save_capture("03-equipment.png")
	_collect_mode_report("equipment")
	_preset("trackside")
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	frame_samples.clear()
	await get_tree().create_timer(2.0).timeout
	await _save_capture("04-trackside.png")
	_collect_mode_report("trackside")
	_preset("equipment")
	_set_lighting(true)
	_update_camera(0,true)
	await get_tree().create_timer(2.0).timeout
	frame_samples.clear()
	await get_tree().create_timer(2.0).timeout
	await _save_capture("06-dusk-equipment.png")
	_collect_mode_report("dusk-equipment")
	_set_lighting(false)
	_preset("yard")
	_update_camera(0,true)
	ui.visible = false
	await get_tree().create_timer(1.0).timeout
	await _save_capture("05-daylight-clean.png")
	_write_performance()
	get_tree().quit()

func _write_performance() -> void:
	frame_samples.sort()
	var report: Dictionary = {"engine":Engine.get_version_info().string,"renderer":RenderingServer.get_current_rendering_method(),"gpu":RenderingServer.get_video_adapter_name(),"sample_count":frame_samples.size(),"viewport":str(get_viewport().get_visible_rect().size),"output_size":str(last_capture_size),"stretched_viewport_size":str(get_viewport().get_texture().get_size()),"native_window_size":str(DisplayServer.window_get_size()),"hidpi_allowed":ProjectSettings.get_setting("display/window/dpi/allow_hidpi"),"taa":get_viewport().use_taa,"msaa":get_viewport().msaa_3d,"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"objects":Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),"nodes":get_tree().get_node_count(),"static_memory_bytes":Performance.get_monitor(Performance.MEMORY_STATIC),"video_memory_bytes":Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),"ground":{"slabs":ground_data.get("slab_count",0),"vegetation_instances":ground_data.get("vegetation_instances",0)}}
	if not frame_samples.is_empty():
		report["median_frame_ms"] = frame_samples[frame_samples.size()/2]
		report["p95_frame_ms"] = frame_samples[int(frame_samples.size()*0.95)]
	report["modes"] = mode_reports
	var file := FileAccess.open(capture_directory.path_join("performance.json"),FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(report,"\t"))
	print("PROOF_PERFORMANCE ",JSON.stringify(report))

func _collect_mode_report(name: String) -> void:
	var samples: Array[float] = frame_samples.duplicate()
	samples.sort()
	if samples.is_empty(): return
	mode_reports.append({"name":name,"frames":samples.size(),"median_wall_frame_ms":samples[samples.size()/2],"p95_wall_frame_ms":samples[int(samples.size()*0.95)],"fps_counter":Engine.get_frames_per_second(),"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"native_window_drawable":DisplayServer.window_can_draw(),"forced_offscreen_draws":not DisplayServer.window_can_draw()})

func _self_test() -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	if grid: _toggle_grid()
	assert(camera.projection == Camera3D.PROJECTION_PERSPECTIVE)
	assert(not yard_data.get("lamps",[]).is_empty())
	assert(ground_data.get("ground_material") is ShaderMaterial)
	_set_lighting(true)
	for light: OmniLight3D in yard_data.get("lamps",[]):
		assert(light.light_energy > 0)
	_set_lighting(false)
	for light: OmniLight3D in yard_data.get("lamps",[]):
		assert(light.light_energy == 0)
	_toggle_grid()
	assert(grid)
	_toggle_grid()
	assert(not grid)
	_preset("equipment")
	_update_camera(0,true)
	assert(camera_target.distance_to(target)<0.001)
	assert(camera_distance == 22.0)
	assert(is_equal_approx(yard_data["rail_gauge_m"],1.435))
	var face_report: Dictionary = _verify_faces(self,{})
	assert(face_report.failures == 0,"Custom mesh normals must match clockwise outward faces: " + str(face_report))
	print("PROOF_FACE_NORMALS ",JSON.stringify(face_report))
	print("PROOF_INPUT_LAYOUT ",get_viewport().get_visible_rect()," button=",dusk_button.get_global_rect())
	await _click_ui(dusk_button)
	assert(dusk,"The actual Dusk button must switch lighting")
	await _click_ui(day_button)
	assert(not dusk,"The actual Daylight button must switch lighting")
	await _click_ui(grid_button)
	assert(grid,"The actual Grid button must switch the terrain shader")
	await _click_ui(grid_button)
	assert(not grid)
	_preset("yard")
	_update_camera(0,true)
	var before_drag: Vector3 = target
	var mouse := InputEventMouseButton.new()
	mouse.button_index = MOUSE_BUTTON_LEFT
	mouse.position = Vector2(800,450)
	mouse.global_position = mouse.position
	mouse.pressed = true
	mouse.button_mask = MOUSE_BUTTON_MASK_LEFT
	Input.parse_input_event(mouse)
	await get_tree().process_frame
	assert(dragging,"Unconsumed ground input must begin a drag")
	var motion := InputEventMouseMotion.new()
	motion.position = Vector2(860,450)
	motion.global_position = motion.position
	motion.relative = Vector2(60,0)
	motion.button_mask = MOUSE_BUTTON_MASK_LEFT
	Input.parse_input_event(motion)
	await get_tree().process_frame
	assert(target.distance_to(before_drag)>0.1,"Dragging must move the ground-anchored camera")
	mouse.pressed = false
	mouse.button_mask = 0
	mouse.position = day_button.get_global_rect().get_center()
	mouse.global_position = mouse.position
	Input.parse_input_event(mouse)
	await get_tree().process_frame
	assert(not dragging,"Releasing over a toolbar must end the ground drag")
	yaw = PI/2
	_update_camera(0,true)
	var before_walk: Vector3 = target
	var key := InputEventKey.new()
	key.physical_keycode = KEY_W
	key.keycode = KEY_W
	key.pressed = true
	Input.parse_input_event(key)
	await get_tree().create_timer(0.1).timeout
	key.pressed = false
	Input.parse_input_event(key)
	await get_tree().process_frame
	assert(target.x < before_walk.x-0.05 and absf(target.z-before_walk.z)<0.05,"W must move forward relative to the rotated camera")
	print("PROOF_INPUT_SMOKE_OK")
	print("PROOF_SELF_TEST_OK")
	get_tree().quit()

func _click_ui(button: Button) -> void:
	var event := InputEventMouseButton.new()
	event.position = button.get_global_rect().get_center()
	event.global_position = event.position
	event.button_index = MOUSE_BUTTON_LEFT
	event.button_mask = MOUSE_BUTTON_MASK_LEFT
	event.pressed = true
	get_viewport().push_input(event,true)
	await get_tree().process_frame
	event.pressed = false
	event.button_mask = 0
	get_viewport().push_input(event,true)
	await get_tree().process_frame

func _verify_faces(parent: Node, seen: Dictionary) -> Dictionary:
	var report: Dictionary = {"triangles":0,"failures":0}
	for child: Node in parent.get_children():
		var mesh: Mesh = null
		if child is MeshInstance3D:
			mesh = child.mesh
		elif child is MultiMeshInstance3D and child.multimesh:
			mesh = child.multimesh.mesh
		if mesh is ArrayMesh and not seen.has(mesh):
			seen[mesh] = true
			for surface: int in range(mesh.get_surface_count()):
				var arrays: Array = mesh.surface_get_arrays(surface)
				var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
				var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
				for index: int in range(0,vertices.size()-2,3):
					var expected: Vector3 = Plane(vertices[index],vertices[index+1],vertices[index+2]).normal
					if expected.length_squared() < 0.1: continue
					report.triangles += 1
					if normals[index].dot(expected) < 0.5:
						report.failures += 1
						if report.failures < 5: print("FACE_MISMATCH ",child.name," triangle=",index/3," expected=",expected," normal=",normals[index])
		var nested: Dictionary = _verify_faces(child,seen)
		report.triangles += nested.triangles
		report.failures += nested.failures
	return report
