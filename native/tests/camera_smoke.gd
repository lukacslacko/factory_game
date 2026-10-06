extends SceneTree
## Native camera regressions run against production event handlers without a
## simulation service, startup UI, browser, or GPU rendering.
class CameraHarness:
	extends "res://scripts/main.gd"
	func _ready() -> void:
		set_process(false)
		set_process_input(false)
		set_process_unhandled_input(false)

var failures: Array[String] = []
var checks: int = 0
var grid_signals: int = 0
var lighting_signals: int = 0
var game: CameraHarness

func _initialize() -> void:
	_run.call_deferred()

func _check(condition: bool, message: String) -> void:
	checks += 1
	if not condition: failures.append(message)

func _button(button: MouseButton, pressed: bool, at: Vector2, factor: float = 1.0) -> InputEventMouseButton:
	var event := InputEventMouseButton.new()
	event.button_index = button
	event.pressed = pressed
	event.position = at
	event.factor = factor
	return event

func _motion(at: Vector2, relative: Vector2) -> InputEventMouseMotion:
	var event := InputEventMouseMotion.new()
	event.position = at
	event.relative = relative
	return event

func _reset_camera() -> void:
	game.dragging = false
	game.orbiting = false
	game.target = Vector3(26,0,23)
	game.yaw = 0.0
	game.pitch = deg_to_rad(52)
	game.distance = 88.0
	game._update_camera(0,true)

func _run() -> void:
	root.size = Vector2i(1680,945)
	game = CameraHarness.new()
	root.add_child(game)
	game.test_mode = true
	game.world = game.GameWorld.new()
	game.add_child(game.world)
	game.world.setup()
	game.ui = game.GameUI.new()
	game.add_child(game.ui)
	game.ui.set_process(false)
	game.ui.grid_button = CheckButton.new()
	game.ui.lighting_button = CheckButton.new()
	game.ui.add_child(game.ui.grid_button)
	game.ui.add_child(game.ui.lighting_button)
	game.ui.grid_button.set_pressed_no_signal(game.grid)
	game.ui.grid_button.toggled.connect(func(_value: bool) -> void: grid_signals += 1)
	game.ui.lighting_button.toggled.connect(func(_value: bool) -> void: lighting_signals += 1)
	game.add_child(game.camera)
	game.camera.current = true
	game.camera.fov = 33.0
	game.camera.near = 0.2
	game.camera.far = 650.0
	game._setup_environment()
	_reset_camera()
	game._set_lighting(false)
	await process_frame
	_check(game.client == null,"Harness must never start the simulation service")
	var center := Vector2(root.size) * .5

	# The visible grid must exist before the first user toggle, on both kinds
	# of walking surface, and turning it off must affect both together.
	var paving: ShaderMaterial = game.world.paving.material_override
	_check(game.ui.grid_button.button_pressed and not game.ui.lighting_button.button_pressed,"Startup Grid and Dusk buttons match the visible world")
	_check(game.grid and game.world.grid,"Grid starts enabled in the game and yard")
	_check(game.world.soil.get_shader_parameter("show_grid") == true,"Soil grid is enabled at startup")
	_check(paving.get_shader_parameter("show_grid") == true,"Paving grid is enabled at startup")
	game._set_grid(false)
	_check(not game.ui.grid_button.button_pressed,"Programmatic grid-off updates the UI button")
	_check(game.world.soil.get_shader_parameter("show_grid") == false and paving.get_shader_parameter("show_grid") == false,"Grid toggle disables soil and paving together")
	game._set_grid(true)
	_check(game.ui.grid_button.button_pressed,"Programmatic grid-on updates the UI button")
	_check(game.world.soil.get_shader_parameter("show_grid") == true and paving.get_shader_parameter("show_grid") == true,"Grid toggle enables soil and paving together")

	var grid_key := InputEventKey.new()
	grid_key.keycode = KEY_G
	grid_key.pressed = true
	game._unhandled_input(grid_key)
	_check(not game.grid and not game.ui.grid_button.button_pressed and game.world.soil.get_shader_parameter("show_grid") == false,"G hotkey keeps the Grid button and visible soil state synchronized")
	game._unhandled_input(grid_key)
	_check(game.grid and game.ui.grid_button.button_pressed and paving.get_shader_parameter("show_grid") == true,"Second G hotkey restores the Grid button and paving state together")
	game._set_lighting(true)
	_check(game.dusk and game.world.dusk and game.ui.lighting_button.button_pressed,"Programmatic dusk-on updates the lighting button and actual yard")
	game._set_lighting(false)
	_check(not game.dusk and not game.world.dusk and not game.ui.lighting_button.button_pressed,"Programmatic daylight restores the lighting button and actual yard")
	_check(grid_signals == 0,"Programmatic grid synchronization emits no toggled feedback signal")
	_check(lighting_signals == 0,"Programmatic lighting synchronization emits no toggled feedback signal")

	# Cocoa delivers trackpad scroll as a pan gesture. It updates the desired
	# distance immediately, while the displayed camera continues over frames.
	var pan := InputEventPanGesture.new()
	pan.position = center
	pan.delta = Vector2(0,3.0)
	var zoom_start: float = game.distance
	var visible_zoom_start: float = game.camera_distance
	game._unhandled_input(pan)
	_check(game.distance > zoom_start,"Positive Mac pan scroll zooms out")
	_check(is_equal_approx(game.camera_distance,visible_zoom_start),"Trackpad scroll does not snap the displayed camera")
	game._process(1.0/60.0)
	var first_zoom_frame: float = game.camera_distance
	game._process(1.0/60.0)
	_check(first_zoom_frame > visible_zoom_start and game.camera_distance > first_zoom_frame,"Trackpad zoom advances on frames with no new gesture")
	pan.delta = Vector2(0,-3.0)
	game._unhandled_input(pan)
	_check(absf(game.distance-zoom_start)<.001,"Opposite pan scroll returns to the original distance")

	game.distance = 80.0
	game._unhandled_input(_button(MOUSE_BUTTON_WHEEL_UP,true,center,.25))
	var quarter_zoom: float = game.distance
	game.distance = 80.0
	game._unhandled_input(_button(MOUSE_BUTTON_WHEEL_UP,true,center,1.0))
	var full_zoom: float = game.distance
	_check(full_zoom < quarter_zoom and quarter_zoom < 80.0,"Fractional wheel events produce smaller zoom than a full notch")
	game.distance = 80.0
	game._unhandled_input(_button(MOUSE_BUTTON_WHEEL_UP,true,center,0.0))
	_check(is_equal_approx(game.distance,full_zoom),"A zero-factor wheel event retains a useful one-notch fallback")
	game.distance = 80.0
	var magnify := InputEventMagnifyGesture.new()
	magnify.factor = 1.25
	magnify.position = center
	game._unhandled_input(magnify)
	_check(absf(game.distance-64.0)<.001,"Pinch zoom remains supported")
	magnify.factor = 0.0
	game._unhandled_input(magnify)
	_check(is_finite(game.distance) and absf(game.distance-64.0)<.001,"Invalid pinch factors do not corrupt camera distance")

	# Freeze an independent reference camera at the visible mouse-down pose.
	# An absolute drag target must not depend on how far the smoothing has
	# progressed, or on how many duplicate position events Cocoa emits.
	_reset_camera()
	var reference := Camera3D.new()
	game.add_child(reference)
	reference.fov = game.camera.fov
	reference.near = game.camera.near
	reference.far = game.camera.far
	reference.global_transform = game.camera.global_transform
	var floor := Plane(Vector3.UP,0.0)
	var initial_floor: Vector3 = game._floor_point(center)
	var initial_target: Vector3 = game.camera_target
	var initial_camera: Vector3 = game.camera.position
	game._unhandled_input(_button(MOUSE_BUTTON_LEFT,true,center))
	var pointer := center + Vector2(180,70)
	game._unhandled_input(_motion(pointer,pointer-center))
	var drag_target: Vector3 = game.target
	_check(game.dragging and game.was_dragged,"Left floor drag activates after the movement threshold")
	_check(drag_target.distance_to(initial_target)>1.0,"Floor drag changes the desired view center")
	_check(game.camera.position.distance_to(initial_camera)<.001,"Floor drag does not snap the displayed camera in an input callback")
	var expected: Vector3 = initial_target + initial_floor - (floor.intersects_ray(reference.project_ray_origin(pointer),reference.project_ray_normal(pointer)) as Vector3)
	_check(game.target.distance_to(expected)<.001,"Floor drag is anchored to its original visible camera")
	game._process(1.0/60.0)
	var frame_one: Vector3 = game.camera.position
	game._process(1.0/60.0)
	_check(frame_one.distance_to(initial_camera)>0.001 and game.camera.position.distance_to(frame_one)>0.001,"Floor drag continues smoothing without another motion event")
	for i in range(24):
		game._unhandled_input(_motion(pointer,Vector2.ZERO))
		game._process(1.0/60.0)
	_check(game.target.distance_to(drag_target)<.001,"Repeated identical drag positions cause no accumulated input drift")
	pointer = center + Vector2(220,95)
	game._unhandled_input(_motion(pointer,Vector2(40,25)))
	expected = initial_target + initial_floor - (floor.intersects_ray(reference.project_ray_origin(pointer),reference.project_ray_normal(pointer)) as Vector3)
	_check(game.target.distance_to(expected)<.001,"Later drag positions still use the frozen mouse-down camera")
	for i in range(60): game._process(1.0/60.0)
	_check((game._floor_point(pointer) as Vector3).distance_to(initial_floor)<.003,"Once settled, the grabbed floor point remains under the pointer")
	game._unhandled_input(_button(MOUSE_BUTTON_LEFT,false,pointer))
	_check(not game.dragging,"Mouse release ends floor dragging")
	reference.queue_free()

	_reset_camera()
	game._unhandled_input(_button(MOUSE_BUTTON_RIGHT,true,center))
	var old_pitch: float = game.pitch
	game._unhandled_input(_motion(center+Vector2(0,30),Vector2(0,30)))
	_check(game.pitch>old_pitch,"Dragging right-button downward raises pitch in the requested reversed direction")
	game._unhandled_input(_button(MOUSE_BUTTON_RIGHT,false,center))
	_check(not game.orbiting,"Right-button release ends orbiting")

	# Cover each native camera preset: the camera's far range must remain
	# shadowed, with four maps biased toward the current working distance.
	var working_split: float = 1.0
	var overview_split: float = 0.0
	for preset: String in ["yard","equipment","overview","rail-end"]:
		game._preset(preset)
		game._update_camera(0,true)
		_check(game.sun.shadow_enabled and game.sun.directional_shadow_max_distance>=game.camera.far-.001,"Shadows cover the full camera range for "+preset)
		var a: float = game.sun.directional_shadow_split_1
		var b: float = game.sun.directional_shadow_split_2
		var c: float = game.sun.directional_shadow_split_3
		_check(a>0.0 and a<b and b<c and c<1.0,"Shadow cascades stay ordered for "+preset)
		if preset=="equipment": working_split=a
		if preset=="overview": overview_split=a
	_check(working_split<.15 and working_split<overview_split,"Close equipment views concentrate the first shadow cascade nearby")
	_check(game.sun.directional_shadow_mode==DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS and game.sun.directional_shadow_blend_splits,"Shadow fix reuses the existing blended four-map setup")
	var result := {"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":game.client!=null,"gpuRendering":false}
	print("CAMERA_SMOKE ",JSON.stringify(result))
	quit(0 if failures.is_empty() else 1)
