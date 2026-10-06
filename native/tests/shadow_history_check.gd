extends SceneTree
## One GPU process, no service: compare ground history after identical smooth
## motion using production daylight, ground, camera, and real actor meshes.
## Run through run_native_check.py --timeout 50 (resident-memory watchdog).
const Models = preload("res://scripts/game_models.gd")
const Ground = preload("res://scripts/ground.gd")
const OUTPUT = "res://captures/shadow-history-"
const WIDTH = 960
const HEIGHT = 640
const MOTION_FRAMES = 60
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready() -> void:
		set_process(false)
		set_process_input(false)
		set_process_unhandled_input(false)

var game: MainHarness
var worker: Node3D
var excavator: Node3D
var pixels := PackedInt32Array()
var results: Array[Dictionary] = []
var failures: Array[String] = []
var policy_checks: Array[Dictionary] = []
var starting_worker := Vector3(-3.5, 0, -1.4)
var starting_excavator := Vector3(.3, 0, .6)

func _initialize() -> void:
	_run.call_deferred()

func _frame() -> void:
	await process_frame
	RenderingServer.force_draw(false)

func _wait_frames(count: int) -> void:
	for _index in range(count): await _frame()

func _pose(fraction: float) -> void:
	worker.position = starting_worker + Vector3(1.5 * fraction, 0, 0)
	excavator.position = starting_excavator + Vector3(2.1 * fraction, 0, 0)
	# Freeze limbs/tool between captures; only normal continuous translation
	# changes, so the comparison cannot mistake arm movement for ghosting.
	Models.animate_actor(worker, {"walking":false,"work":0,"anim":0}, 0)
	Models.animate_actor(excavator, {"upperYaw":0,"reach":3.0,"lift":1.8,"operator":"WRK-OP"}, 0)

func _capture(name: String) -> Image:
	var image := root.get_texture().get_image()
	image.convert(Image.FORMAT_RGBA8)
	image.save_png(OUTPUT + name + ".png")
	return image

func _mask_meshes(node: Node, excluded: PackedByteArray) -> void:
	if node is MeshInstance3D:
		var mesh: MeshInstance3D = node
		if mesh.visible and mesh.mesh != null:
			var bounds: AABB = mesh.get_aabb()
			var low := Vector2(INF, INF)
			var high := Vector2(-INF, -INF)
			for corner in range(8):
				var screen: Vector2 = game.camera.unproject_position(mesh.global_transform * bounds.get_endpoint(corner))
				low = low.min(screen)
				high = high.max(screen)
			# The margin excludes geometric edges and moving-body AA trails.
			for y in range(maxi(0, int(floor(low.y))-4), mini(HEIGHT, int(ceil(high.y))+5)):
				for x in range(maxi(0, int(floor(low.x))-4), mini(WIDTH, int(ceil(high.x))+5)):
					excluded[y * WIDTH + x] = 1
	for child in node.get_children(): _mask_meshes(child, excluded)

func _make_mask() -> void:
	var excluded := PackedByteArray()
	excluded.resize(WIDTH * HEIGHT)
	# Mask each real mesh throughout the sweep, rather than a broad chassis
	# rectangle that would accidentally discard most of the useful shadow.
	for sample in range(7):
		_pose(float(sample)/6.0)
		_mask_meshes(worker, excluded)
		_mask_meshes(excavator, excluded)
	var mask := Image.create(WIDTH, HEIGHT, false, Image.FORMAT_RGB8)
	var plane := Plane(Vector3.UP, 0)
	for y in range(0, HEIGHT, 2):
		for x in range(0, WIDTH, 2):
			var index := y * WIDTH + x
			if excluded[index] != 0: continue
			var at := Vector2(x+.5, y+.5)
			var hit: Variant = plane.intersects_ray(game.camera.project_ray_origin(at), game.camera.project_ray_normal(at))
			if hit == null: continue
			var ground: Vector3 = hit
			if ground.x < -8 or ground.x > 11 or ground.z < -7 or ground.z > 9: continue
			pixels.append(index)
			mask.set_pixel(x,y,Color.WHITE)
	mask.save_png(OUTPUT + "ground-mask.png")
	_pose(0)

func _difference(a: Image, b: Image, heatmap_name: String = "") -> Dictionary:
	var bytes_a := a.get_data()
	var bytes_b := b.get_data()
	var total: float = 0
	var maximum: float = 0
	var changed := 0
	var trailing := 0
	var histogram := PackedInt32Array()
	histogram.resize(256)
	var heat: Image = null
	if not heatmap_name.is_empty(): heat = Image.create(WIDTH, HEIGHT, false, Image.FORMAT_RGB8)
	for pixel in pixels:
		var i: int = pixel * 4
		var difference: float = (.2126*(int(bytes_a[i])-int(bytes_b[i])) + .7152*(int(bytes_a[i+1])-int(bytes_b[i+1])) + .0722*(int(bytes_a[i+2])-int(bytes_b[i+2]))) / 255.0
		var magnitude := absf(difference)
		total += magnitude
		maximum = maxf(maximum, magnitude)
		histogram[mini(255, int(round(magnitude*255)))] += 1
		if magnitude > 4.0/255: changed += 1
		if difference < -4.0/255: trailing += 1
		if heat != null:
			heat.set_pixel(pixel % WIDTH, pixel / WIDTH, Color(clampf(-difference*12,0,1),0,clampf(difference*12,0,1)))
	if heat != null: heat.save_png(OUTPUT + heatmap_name + ".png")
	var cumulative := 0
	var percentile := 0
	for bin in range(256):
		cumulative += histogram[bin]
		if cumulative >= pixels.size()*.95:
			percentile = bin
			break
	return {"sampledGroundPixels":pixels.size(),"meanAbsLuma":total/maxi(1,pixels.size()),"p95Luma":percentile/255.0,"maxLuma":maximum,"changedAbove4Levels":changed,"darkerTrailingPixels":trailing}

func _mode(name: String, scale: float, temporal: bool, fsr2: bool = false, ssil: bool = true) -> void:
	root.use_taa = false
	root.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2 if fsr2 else Viewport.SCALING_3D_MODE_FSR if scale < 1 else Viewport.SCALING_3D_MODE_BILINEAR
	root.scaling_3d_scale = scale
	root.msaa_3d = Viewport.MSAA_DISABLED if fsr2 else Viewport.MSAA_4X
	root.use_taa = temporal
	game.environment.ssil_enabled = ssil
	_pose(0)
	await _wait_frames(30)
	for frame in range(1, MOTION_FRAMES+1):
		_pose(float(frame)/MOTION_FRAMES)
		await _frame()
	var immediate := _capture(name+"-immediate")
	await _wait_frames(24)
	var settled := _capture(name+"-settled")
	await _wait_frames(12)
	var control := _capture(name+"-stationary-control")
	var result := {"mode":name,"scale":scale,"taa":temporal,"fsr2":fsr2,"msaa4":not fsr2,"ssil":ssil,"motionHistory":_difference(immediate,settled,name+"-ground-history"),"stationaryNoise":_difference(settled,control)}
	results.append(result)
	print("SHADOW_HISTORY_MODE ",JSON.stringify(result))

func _production_policy_checks() -> void:
	# Exercise the actual settings handler after window resize and after the
	# persisted native-resolution preference, rather than just the A/B presets.
	for settings: Dictionary in [
		{"name":"ordinary-window","size":Vector2i(WIDTH,HEIGHT),"native":false},
		{"name":"retina-window","size":Vector2i(3456,1944),"native":false},
		{"name":"retina-native-resolution","size":Vector2i(3456,1944),"native":true},
	]:
		root.size = settings.size
		game.native_resolution = settings.native
		game._update_render_resolution()
		await _frame()
		var reduced: bool = settings.name == "retina-window"
		var expected_mode: int = Viewport.SCALING_3D_MODE_FSR if reduced else Viewport.SCALING_3D_MODE_BILINEAR
		var correct: bool = not root.use_taa and root.msaa_3d == Viewport.MSAA_4X and root.scaling_3d_mode == expected_mode and (root.scaling_3d_scale < .99 if reduced else is_equal_approx(root.scaling_3d_scale,1))
		policy_checks.append({"name":settings.name,"passed":correct,"taa":root.use_taa,"mode":root.scaling_3d_mode,"scale":root.scaling_3d_scale,"msaa":root.msaa_3d})
		if not correct: failures.append("Production rendering policy reintroduced temporal filtering: "+settings.name)
	root.size = Vector2i(WIDTH,HEIGHT)
	game.native_resolution = false
	game._update_render_resolution()
	for result in results:
		if str(result.mode).begins_with("new-") and (result.motionHistory.changedAbove4Levels > 4 or result.motionHistory.meanAbsLuma > .0001):
			failures.append("Moving ground shadows retain visible history: "+str(result.mode))

func _run() -> void:
	if RenderingServer.get_rendering_device() == null:
		push_error("Shadow history comparison requires a GPU renderer")
		quit(1)
		return
	Engine.max_fps = 60
	root.size = Vector2i(WIDTH,HEIGHT)
	root.content_scale_size = Vector2i(WIDTH,HEIGHT)
	game = MainHarness.new()
	root.add_child(game)
	game.capture_mode = true
	game._setup_environment()
	game.add_child(game.camera)
	game.camera.current = true
	game.camera.fov = 33
	game.camera.near = .2
	game.camera.far = 650
	game.target = Vector3(1,0,.8)
	game.distance = 24
	game.pitch = deg_to_rad(52)
	game.yaw = -.25
	game._update_camera(0,true)
	game._set_lighting(false)
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(100,100)
	ground.mesh = plane
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := Ground._surface(1,"a8a18b","c1b99f")
	material.set_shader_parameter("show_grid",false)
	ground.material_override = material
	game.add_child(ground)
	worker = Models.actor(game,"worker",{"id":"WRK-SHADOW","name":"Worker #1"})
	excavator = Models.actor(game,"excavator",{"id":"EQ-SHADOW"})
	worker.set_meta("kind","worker")
	excavator.set_meta("kind","excavator")
	worker.rotation.y = -PI/2
	excavator.rotation.y = -PI/2
	_pose(0)
	await _wait_frames(2)
	_make_mask()
	if game.client != null or pixels.size() < 1000:
		push_error("Invalid shadow harness: service started or insufficient visible ground")
		quit(1)
		return
	await _mode("old-full-taa",1,true)
	await _mode("old-downscaled-fsr2",.6,false,true)
	await _mode("new-full-msaa4",1,false)
	await _mode("new-downscaled-fsr1",.6,false)
	# SSIL has its own history. A fifth isolated comparison distinguishes
	# residual screen-space indirect-light history from AA/upscaler history.
	await _mode("new-full-msaa4-no-ssil",1,false,false,false)
	await _production_policy_checks()
	var report := {"passed":failures.is_empty(),"failures":failures,"policyChecks":policy_checks,"serviceStarted":false,"resolution":[WIDTH,HEIGHT],"motionFrames":MOTION_FRAMES,"motionMeters":{"worker":1.5,"excavator":2.1},"settleFrames":24,"stationaryControlFrames":12,"mask":"Projected swept real mesh bounds excluded; ground rays sampled every 2 pixels","productionEnvironment":true,"environment":{"ssao":game.environment.ssao_enabled,"ssaoIntensity":game.environment.ssao_intensity,"ssilIntensity":game.environment.ssil_intensity,"ssilRadius":game.environment.ssil_radius,"sunEnergy":game.sun.light_energy,"sunShadowBias":game.sun.shadow_bias,"sunShadowNormalBias":game.sun.shadow_normal_bias,"cameraDistance":game.distance},"modes":results}
	var file := FileAccess.open(OUTPUT+"results.json",FileAccess.WRITE)
	file.store_string(JSON.stringify(report,"\t")+"\n")
	print("SHADOW_HISTORY_COMPLETE ",JSON.stringify(report))
	quit(0 if failures.is_empty() else 1)
