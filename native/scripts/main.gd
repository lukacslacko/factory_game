extends Node3D
## Native presentation of the existing simulation, using the approved Concept C art.
const Client = preload("res://scripts/runtime_client.gd")
const GameWorld = preload("res://scripts/game_world.gd")
const GameUI = preload("res://scripts/game_ui.gd")
const SiteLighting = preload("res://scripts/site_lighting.gd")
const GameAudio = preload("res://scripts/game_audio.gd")
const ElectricalUI = preload("res://scripts/electrical_ui.gd")
var client: Node
var world: Node3D
var ui: CanvasLayer
var audio: Node3D
var camera := Camera3D.new()
var environment := Environment.new()
var sky_material := ShaderMaterial.new()
var sun := DirectionalLight3D.new()
var moon := DirectionalLight3D.new()
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
var lighting_age: float = 0.0
var sky_clock: float = 1.0
var last_sky_direction: Vector3 = Vector3.ZERO
var last_lamp_amount: float = -1.0
var preview_point := Vector3.ZERO
var preview_dirty: bool = false
var preview_clock: float = 0.0
var preview_key: String = ""
var preview_request: int = 0
var electrical_pick_role: String=""
var electrical_pick_node: Node3D
var cable_source_id: String=""
var cable_target_id: String=""
var cable_anchor: Dictionary={}
var cable_end: Dictionary={}
var cable_sources: Array[Dictionary]=[]
var cable_targets: Array[Dictionary]=[]
var cable_cells: Array[Dictionary]=[]
var cable_vertical_first: bool=false
var cable_pointer_down: bool=false
var cable_first_press: bool=false
var cable_preview_node: Node3D
var cable_preview_mesh: MultiMeshInstance3D
var cable_preview_material: StandardMaterial3D
var cable_preview_request: int=0
var cable_preview_key: String=""
var cable_checked_key: String=""
var cable_error: String=""
var cable_preview_dirty: bool=false
var cable_preview_age: float=0.0
var cable_plan_request: int=0
var backgrounded: bool = false
var dragging: bool = false
var orbiting: bool = false
var drag_point := Vector3.ZERO
var drag_start_target := Vector3.ZERO
var drag_camera_transform := Transform3D.IDENTITY
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
var native_resolution: bool = false
var received_snapshots: int = 0
var reply_results: Dictionary = {}

func _ready() -> void:
	Engine.max_fps = 60
	get_tree().auto_accept_quit = false
	get_window().title = "Plant 01 | Native factory game"
	test_mode = "--native-self-test" in OS.get_cmdline_user_args()
	capture_mode = "--native-capture" in OS.get_cmdline_user_args() or "--fixture-capture" in OS.get_cmdline_user_args() or "--camera-capture" in OS.get_cmdline_user_args() or "--ghost-capture" in OS.get_cmdline_user_args()
	_setup_environment()
	world = GameWorld.new()
	add_child(world)
	world.setup()
	_set_grid(grid)
	add_child(camera)
	camera.current = true
	camera.fov = 33.0
	camera.near = 0.2
	camera.far = 650.0
	get_viewport().size_changed.connect(_update_render_resolution)
	_update_render_resolution()
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
	audio=GameAudio.new();add_child(audio);audio.setup(client.data_directory)
	audio.set_backgrounded(backgrounded)
	audio.settings_error.connect(func(description: String)->void:ui.show_error(description))
	var graphics := ConfigFile.new()
	if graphics.load(client.data_directory.path_join("rendering.cfg")) == OK:
		native_resolution = bool(graphics.get_value("graphics","native_resolution",false))
		_update_render_resolution()
	ui.menu.set_item_checked(ui.menu.get_item_index(10),native_resolution)
	_set_lighting(false)
	print("NATIVE_GAME_STARTED ", JSON.stringify({"engine":Engine.get_version_info().string,"data_directory":client.data_directory}))
	if test_mode:
		_run_self_test.call_deferred()
	elif "--ghost-capture" in OS.get_cmdline_user_args():
		_run_ghost_capture.call_deferred()
	elif "--camera-capture" in OS.get_cmdline_user_args():
		_run_camera_capture.call_deferred()
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
	# Time changes continuously; incremental radiance updates avoid rebaking the
	# entire reflection map at each small movement of the sun.
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
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
	# Cover the visible frustum, rather than dropping shadows behind the yard.
	sun.directional_shadow_max_distance = 650.0
	sun.directional_shadow_fade_start = 1.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_blend_splits = true
	sun.light_angular_distance = 0.55
	add_child(moon)
	moon.light_color=Color("b2c9ff")
	moon.shadow_enabled=true
	moon.shadow_bias=0.025
	moon.shadow_normal_bias=0.55
	moon.directional_shadow_max_distance=650.0
	moon.directional_shadow_fade_start=1.0
	moon.directional_shadow_mode=DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	moon.directional_shadow_blend_splits=true
	moon.light_angular_distance=0.65

func _set_lighting(value: bool) -> void:
	# Checked means an explicit dusk preview; unchecked follows simulation time.
	dusk = value
	if is_instance_valid(ui) and is_instance_valid(ui.lighting_button):
		ui.lighting_button.set_pressed_no_signal(value)
	_update_lighting(0.0,true)

func _update_lighting(dt: float, force: bool=false) -> void:
	lighting_age+=dt;sky_clock+=dt
	var seconds: float=float(state.get("time",32400.0))
	if not bool(state.get("paused",true)):
		# Interpolate only within the next snapshot interval. A disconnected host
		# cannot keep a separate lighting clock running indefinitely.
		seconds+=minf(lighting_age,0.25)*float(state.get("speed",1))
	var profile: Dictionary=SiteLighting.profile(18.1*3600.0 if dusk else seconds)
	sun.rotation=profile.sunRotation;sun.light_energy=profile.sunEnergy;sun.light_color=profile.sunColor
	moon.rotation=profile.moonRotation;moon.light_energy=profile.moonEnergy
	sun.visible=sun.light_energy>0.001;moon.visible=moon.light_energy>0.001
	environment.ambient_light_energy=profile.ambient;environment.tonemap_exposure=profile.exposure
	var sky_change: float=last_sky_direction.distance_to(profile.sunDirection)
	if force or sky_change>.01 or (sky_clock>=0.25 and sky_change>.000001):
		sky_clock=0.0
		last_sky_direction=profile.sunDirection
		for key: String in ["daylight","twilight"]:sky_material.set_shader_parameter(key,profile[key])
		sky_material.set_shader_parameter("sun_direction",profile.sunDirection)
		sky_material.set_shader_parameter("moon_direction",profile.moonDirection)
	var amount: float=1.0 if dusk else float(profile.lamps)
	if is_instance_valid(world) and (force or absf(amount-last_lamp_amount)>.002):
		last_lamp_amount=amount
		world.set_lamp_amount(amount)

func _snapshot(message: Dictionary) -> void:
	state = message.get("state", {})
	lighting_age=0.0
	received_snapshots += 1
	world.sync_snapshot(message)
	ui.update_snapshot(message)
	if is_instance_valid(audio):audio.sync_snapshot(message)
	_update_lighting(0.0)

func _reply(message: Dictionary) -> void:
	reply_results[int(message.get("id", 0))] = message
	if reply_results.size() > 200:
		reply_results.erase(reply_results.keys()[0])
	if message.get("action")=="electrical_preview":
		if tool=="cable" and int(message.get("id",0))==cable_preview_request:
			var result: Dictionary=message.get("result",{})
			cable_checked_key=cable_preview_key
			cable_error=str(result.get("error",message.get("error","")))
			if not bool(message.get("ok",false)) or not bool(result.get("valid",false)):
				if cable_error.is_empty():cable_error="This circuit cannot be built here."
			_set_cable_preview_color()
			_cable_hint()
		return
	if message.get("action")=="electrical_plan" and int(message.get("id",0))==cable_plan_request:
		cable_plan_request=0
		if message.get("ok",false):
			var run_id: String=str(message.get("result",{}).get("runId",""))
			ui._select_tool("select")
			if not run_id.is_empty():_select_entity(run_id)
			ui.status_label.text="Electrical circuit planned. Open its linked Work task for crew, material, or access delays."
			return
		else:
			cable_checked_key=JSON.stringify(_cable_args())
			cable_error=str(message.get("error","Circuit planning failed."));_set_cable_preview_color();_cable_hint()
	if message.get("action") == "rail_preview":
		if int(message.get("id",0)) == preview_request and tool.begins_with("rail") and message.get("ok",false):
			var preview: Dictionary = message.get("result",{})
			world.preview_track(preview.get("geometries",[]),str(preview.get("error","")).is_empty())
		return
	ui.receive_reply(message)
	if message.get("ok",false) and message.get("action") in ["new_game","import","load","restore_backup"]:
		ui._select_tool("select");cable_source_id="";cable_target_id=""
		ui.electrical_ui.source_selected="";ui.electrical_ui.target_selected=""
		if is_instance_valid(ui.electrical_ui.plan_window):ui.electrical_ui.plan_window.queue_free()
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
	if action=="electrical_pick":
		_begin_electrical_pick(args);return
	if action=="electrical_pick_cancel":
		_end_electrical_pick(true);return
	if action=="electrical_locate":
		ui._select_tool("select")
		ui.electrical_ui.source_selected=str(args.get("sourceId",""));ui.electrical_ui.target_selected=str(args.get("targetId",""))
		_focus_entity(str(args.get("id","")))
		ui.status_label.text="Located selected asset. Cable… reopens your saved source and destination choices."
		return
	if action=="electrical_draw":
		cable_source_id=str(args.get("sourceId",""));cable_target_id=str(args.get("targetId",""))
		ui._select_tool("cable")
		return
	if action in ["new_game","import","load","continue","restore_backup"] and is_instance_valid(audio):audio.reset_history()
	if action == "audio_settings":
		if is_instance_valid(audio):audio.show_settings()
		return
	if action == "native_resolution":
		native_resolution = bool(args.get("value",false))
		_update_render_resolution()
		var graphics := ConfigFile.new()
		graphics.set_value("graphics","native_resolution",native_resolution)
		graphics.save(client.data_directory.path_join("rendering.cfg"))
		return
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
	var run: Dictionary=ElectricalUI.record(ui,id)
	if not run.is_empty() and not run.get("cells",[]).is_empty():
		var cell: Dictionary=run.cells[int(run.cells.size()/2)]
		pos=Vector3(float(cell.x)+.5,0,float(cell.z)+.5)
	target = Vector3(pos.x, 0.0, pos.z)
	distance = minf(distance, 38.0)

func _select_tool(value: String) -> void:
	_end_electrical_pick(false)
	_clear_cable_preview()
	tool = value
	placing = false
	preview_key = ""
	preview_request = 0
	preview_dirty = false
	world.preview({}, true)
	if value=="cable":
		_start_cable_preview()
		return
	if value == "select":
		return
	follow = false

func _eligible_electrical_assets() -> Array[Dictionary]:
	return ElectricalUI.source_records(ui) if electrical_pick_role=="source" else ElectricalUI.records(ui,"consumers")

func _begin_electrical_pick(args: Dictionary) -> void:
	ui._select_tool("select")
	cable_source_id=str(args.get("sourceId",""));cable_target_id=str(args.get("targetId",""))
	electrical_pick_role=str(args.get("role","source"))
	follow=false
	electrical_pick_node=Node3D.new();electrical_pick_node.name="ElectricalAssetSelection";add_child(electrical_pick_node)
	var material:=StandardMaterial3D.new();material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color=Color("72d4a3") if electrical_pick_role=="source" else Color("79cce7")
	material.no_depth_test=false
	var mesh:=BoxMesh.new();mesh.size=Vector3.ONE
	var instances:=MultiMeshInstance3D.new();instances.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instances.multimesh=MultiMesh.new();instances.multimesh.transform_format=MultiMesh.TRANSFORM_3D;instances.multimesh.mesh=mesh;instances.material_override=material
	electrical_pick_node.add_child(instances)
	var candidates: Array[Dictionary]=_eligible_electrical_assets()
	instances.multimesh.instance_count=candidates.size()*4
	var index: int=0
	for asset: Dictionary in candidates:
		var x: float=float(asset.get("x",0));var z: float=float(asset.get("z",0));var w: float=float(asset.get("w",1));var d: float=float(asset.get("d",1))
		var y: float=_cable_surface(asset)+.08
		for edge: Array in [[Vector3(w+.2,.04,.1),Vector3(x+w*.5,y,z-.1)],[Vector3(w+.2,.04,.1),Vector3(x+w*.5,y,z+d+.1)],[Vector3(.1,.04,d+.2),Vector3(x-.1,y,z+d*.5)],[Vector3(.1,.04,d+.2),Vector3(x+w+.1,y,z+d*.5)]]:
			instances.multimesh.set_instance_transform(index,Transform3D(Basis.IDENTITY.scaled(edge[0]),edge[1]));index+=1
	ui.set_electrical_pick_hint("Pick %s · click an outlined electrical object. Drag to pan; scroll to zoom. Esc returns to the plan."%electrical_pick_role)
	if candidates.is_empty():ui.show_error("No eligible %s objects. Build or commission the required electrical asset first."%electrical_pick_role)

func _end_electrical_pick(reopen: bool) -> void:
	var was_picking: bool=not electrical_pick_role.is_empty()
	electrical_pick_role=""
	if is_instance_valid(electrical_pick_node):remove_child(electrical_pick_node);electrical_pick_node.queue_free()
	electrical_pick_node=null
	if is_instance_valid(ui):ui.set_electrical_pick_hint("")
	if reopen and was_picking:ui.electrical_ui.plan_dialog(ui,cable_source_id,cable_target_id)

func _pick_electrical_asset(id: String) -> void:
	var asset: Dictionary={}
	for candidate: Dictionary in _eligible_electrical_assets():
		if str(candidate.id)==id:asset=candidate;break
	if asset.is_empty():
		ui.show_error("Choose an outlined %s object; other objects do not change your selections."%electrical_pick_role);return
	if electrical_pick_role=="source":cable_source_id=id
	else:cable_target_id=id
	_end_electrical_pick(true)

func _clear_cable_preview() -> void:
	cable_anchor={};cable_end={};cable_cells.clear();cable_sources.clear();cable_targets.clear()
	cable_preview_request=0;cable_preview_key="";cable_checked_key="";cable_error=""
	cable_preview_dirty=false;cable_preview_age=0.;cable_pointer_down=false;cable_plan_request=0
	if is_instance_valid(cable_preview_node):
		remove_child(cable_preview_node);cable_preview_node.queue_free()
	cable_preview_node=null;cable_preview_mesh=null;cable_preview_material=null

func _electrical_asset(id: String, key: String) -> Dictionary:
	var asset: Dictionary=ui._entity(id).get("entity",{}).duplicate(true)
	asset.merge(ElectricalUI.record(ui,id,key),true)
	if key=="sources":asset.merge(ElectricalUI.record(ui,id,"junctions"),true)
	return asset

func _start_cable_preview() -> void:
	var source: Dictionary=_electrical_asset(cable_source_id,"sources")
	var consumer: Dictionary=_electrical_asset(cable_target_id,"consumers")
	if source.is_empty() or consumer.is_empty() or cable_source_id.is_empty() or cable_target_id.is_empty():
		ui.show_error("Choose an incoming station or commissioned junction and a destination junction, light, or pump in Electrical first.")
		tool="select";ui.active_tool="select";return
	cable_sources=ElectricalUI.terminal_cells(source);cable_targets=ElectricalUI.terminal_cells(consumer)
	cable_vertical_first=false
	cable_preview_node=Node3D.new();cable_preview_node.name="ElectricalRoutePreview";add_child(cable_preview_node)
	cable_preview_material=StandardMaterial3D.new();cable_preview_material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	cable_preview_material.no_depth_test=false;cable_preview_material.vertex_color_use_as_albedo=true
	cable_preview_material.albedo_color=Color.WHITE
	var mesh:=BoxMesh.new();mesh.size=Vector3(.12,.035,1.)
	cable_preview_mesh=MultiMeshInstance3D.new();cable_preview_mesh.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	cable_preview_mesh.multimesh=MultiMesh.new();cable_preview_mesh.multimesh.transform_format=MultiMesh.TRANSFORM_3D
	cable_preview_mesh.multimesh.mesh=mesh;cable_preview_mesh.material_override=cable_preview_material
	cable_preview_node.add_child(cable_preview_mesh)
	for pair: Array in [[cable_sources,Color("8ec6a5"),"SOURCE "+ElectricalUI.asset_label(ui,source)],[cable_targets,Color("82becd"),"DESTINATION "+ElectricalUI.asset_label(ui,consumer)]]:
		var cells: Array=pair[0]
		for cell: Dictionary in cells:
			var marker:=MeshInstance3D.new();var tile:=BoxMesh.new();tile.size=Vector3(.78,.025,.78);marker.mesh=tile
			var material:=StandardMaterial3D.new();material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
			material.albedo_color=pair[1];material.no_depth_test=false;marker.material_override=material
			marker.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			marker.position=Vector3(float(cell.x)+.5,_cable_surface(cell)+.025,float(cell.z)+.5)
			cable_preview_node.add_child(marker)
		if not cells.is_empty():
			var label:=Label3D.new();label.text=str(pair[2]);label.font_size=34;label.pixel_size=.007
			label.modulate=pair[1];label.no_depth_test=false;label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
			label.position=Vector3(float(cells[0].x)+.5,_cable_surface(cells[0])+.75,float(cells[0].z)+.5)
			cable_preview_node.add_child(label)
	var center_source:=Vector3(float(source.get("x",0))+float(source.get("w",1))*.5,0,float(source.get("z",0))+float(source.get("d",1))*.5)
	var center_target:=Vector3(float(consumer.get("x",0))+float(consumer.get("w",1))*.5,0,float(consumer.get("z",0))+float(consumer.get("d",1))*.5)
	target=(center_source+center_target)*.5;distance=clampf(center_source.distance_to(center_target)*1.7+24.,32.,200.)
	follow=false;preview_point=center_source
	_update_cable_preview(center_source)

func _cable_surface(cell: Dictionary) -> float:
	var key: String="%d,%d"%[int(cell.get("x",0)),int(cell.get("z",0))]
	return .105 if state.get("paving",{}).has(key) else .05

func _cable_args() -> Dictionary:
	return {"sourceId":cable_source_id,"targetId":cable_target_id,"cells":cable_cells.duplicate(true)}

func _update_cable_preview(point: Vector3) -> void:
	if not is_instance_valid(cable_preview_mesh) or cable_sources.is_empty() or cable_targets.is_empty():return
	var start: Dictionary=cable_anchor
	if start.is_empty():
		var target_asset: Dictionary=_electrical_asset(cable_target_id,"consumers")
		start=ElectricalUI.nearest_terminal(cable_sources,Vector3(float(target_asset.get("x",0))+.5,0,float(target_asset.get("z",0))+.5))
		cable_end=ElectricalUI.nearest_terminal(cable_targets,Vector3(float(start.x)+.5,0,float(start.z)+.5))
	else:cable_end=ElectricalUI.nearest_terminal(cable_targets,point)
	var cells: Array[Dictionary]=ElectricalUI.manhattan_cells(start,cable_end,cable_vertical_first)
	if cells!=cable_cells:
		cable_cells=cells;cable_error="";cable_preview_dirty=not cable_cells.is_empty()
		var mm: MultiMesh=cable_preview_mesh.multimesh;mm.instance_count=maxi(0,cable_cells.size()-1)
		for index: int in range(mm.instance_count):
			var a: Dictionary=cable_cells[index];var b: Dictionary=cable_cells[index+1]
			var basis:=Basis(Vector3.UP,PI*.5 if a.x!=b.x else 0.)
			mm.set_instance_transform(index,Transform3D(basis,Vector3((float(a.x)+float(b.x))*.5+.5,maxf(_cable_surface(a),_cable_surface(b))+.065,(float(a.z)+float(b.z))*.5+.5)))
	_set_cable_preview_color();_cable_hint()

func _set_cable_preview_color() -> void:
	if not is_instance_valid(cable_preview_material):return
	var checked: bool=cable_checked_key==JSON.stringify(_cable_args())
	cable_preview_material.albedo_color=Color("cf6550") if checked and not cable_error.is_empty() else (Color("79ba92") if checked else Color("d6b46f"))

func _cable_hint() -> void:
	var text: String="%d m · %s → %s · "%[cable_cells.size(),cable_source_id,cable_target_id]
	if cable_checked_key==JSON.stringify(_cable_args()):
		text+="Valid. " if cable_error.is_empty() else cable_error+" · "
	else:text+="Checking route… "
	text+="Click a green source terminal, or drag to a blue destination terminal." if cable_anchor.is_empty() else "Click a blue destination terminal to plan. R swaps elbow; Esc cancels."
	ui.set_electrical_hint(text)

func _request_cable_preview() -> void:
	cable_preview_dirty=false;cable_preview_age=0.
	if cable_cells.is_empty() or not is_instance_valid(client):return
	cable_preview_key=JSON.stringify(_cable_args())
	cable_preview_request=client.send("electrical_preview",_cable_args())

func _cable_click(pressed: bool, point: Vector3, screen_point: Vector2) -> void:
	if cable_plan_request>0:return
	if pressed:
		cable_pointer_down=false;cable_first_press=cable_anchor.is_empty();click_screen=screen_point
		if cable_first_press:
			var cell: Dictionary=ElectricalUI.nearest_terminal(cable_sources,point)
			if cell.is_empty() or Vector2(float(cell.x)+.5-point.x,float(cell.z)+.5-point.z).length()>1.8:
				ui.show_error("Start at a highlighted green terminal beside "+cable_source_id+".");return
			cable_anchor=cell
		cable_pointer_down=true;preview_point=point;_update_cable_preview(point)
	elif cable_pointer_down:
		cable_pointer_down=false
		if cable_first_press and screen_point.distance_to(click_screen)<=4.:return
		_finish_cable(point)

func _finish_cable(point: Vector3) -> void:
	_update_cable_preview(point)
	if cable_end.is_empty() or Vector2(float(cable_end.x)+.5-point.x,float(cable_end.z)+.5-point.z).length()>1.8:
		ui.show_error("Finish at a highlighted blue terminal beside "+cable_target_id+". The start remains selected.");return
	if cable_cells.is_empty():ui.show_error("This circuit is too long to preview; choose a closer consumer.");return
	if cable_checked_key==JSON.stringify(_cable_args()) and not cable_error.is_empty():
		ui.show_error(cable_error);return
	cable_plan_request=client.send("electrical_plan",_cable_args())
	ui.set_electrical_hint("Validating and planning %s → %s…"%[cable_source_id,cable_target_id])

func _set_grid(value: bool) -> void:
	grid = value
	world.set_grid(value)
	if is_instance_valid(ui) and is_instance_valid(ui.grid_button):
		ui.grid_button.set_pressed_no_signal(value)

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

func _drag_floor_point(screen: Vector2) -> Variant:
	# Freeze the picking camera at mouse-down. Picking against the smoothing
	# camera each event would feed its lag back into the pan and cause drift.
	return Plane(Vector3.UP, 0.0).intersects_ray(drag_camera_transform.origin,
		drag_camera_transform.basis * camera.project_local_ray_normal(screen))

func _zoom(scroll_steps: float) -> void:
	distance = clampf(distance * exp(scroll_steps * 0.10), 12.0, 240.0)

func _update_render_resolution() -> void:
	# Retina windows can otherwise quadruple the 3D pixel work. Upscale each
	# current frame spatially; native Controls/text remain at full resolution.
	if RenderingServer.get_rendering_device() == null:
		return
	var viewport := get_viewport()
	# get_visible_rect() is the stretched 1680×945 UI canvas, not the Retina
	# backing resolution. Window.size reports the real drawable pixel count.
	var pixels: float = float(get_window().size.x) * float(get_window().size.y)
	var scale: float = clampf(sqrt(2350000.0 / maxf(1.0,pixels)),0.5,1.0)
	if native_resolution:
		scale = 1.0
	# Shadows move across stationary ground, whose motion vectors cannot track
	# them. TAA/FSR2 retains their earlier positions as trails. Spatial MSAA
	# and FSR1 smooth edges without carrying that history into the next frame.
	viewport.use_taa = false
	viewport.msaa_3d = Viewport.MSAA_4X
	if scale < 0.99:
		viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR
	else:
		viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	viewport.scaling_3d_scale = scale

func _rect(a: Vector3, b: Vector3) -> Dictionary:
	var x1: int = floori(minf(a.x,b.x))
	var z1: int = floori(minf(a.z,b.z))
	return {"x":x1,"z":z1,"w":mini(100,absi(floori(a.x)-floori(b.x))+1),"d":mini(100,absi(floori(a.z)-floori(b.z))+1)}

func _rotate_placement() -> void:
	if tool=="cable":
		cable_vertical_first=not cable_vertical_first
		_update_cable_preview(preview_point)
		return
	if tool == "relocate":
		ui.show_error("A stock relocation preserves the stack orientation and footprint.")
		return
	placement_rotation = (placement_rotation + 1) % 4
	preview_dirty = true
	_placement_preview(preview_point)

func _placement_preview(point: Vector3) -> void:
	preview_point = point
	if tool=="cable":
		_update_cable_preview(point)
		return
	if tool.begins_with("rail"):
		preview_dirty = true
		return
	var rect := _rect(click_point if placing else point,point)
	if tool not in ["slab", "zone"]:
		var sizes := {"electricalJunction":Vector2i(1,1),"office":Vector2i(6,3),"sanitary":Vector2i(3,2),"shed":Vector2i(8,6),"engineShed":Vector2i(6,14),"store":Vector2i(6,4),"processTank":Vector2i(4,4),"transferPump":Vector2i(2,2),"lamp":Vector2i(1,1),"fence":Vector2i(3,1),"power":Vector2i(1,1),"water":Vector2i(1,1),"railStraight":Vector2i(5,2),"railCurve":Vector2i(20,20),"railTurnout":Vector2i(20,7),"railConverging":Vector2i(20,7),"parking":Vector2i(3,5),"relocate":Vector2i(5,2)}
		var size: Vector2i = sizes.get(tool,Vector2i(1,1))
		if tool == "relocate":
			for stack: Dictionary in state.get("stacks",[]):
				if str(stack.id) == selected_id: size = Vector2i(int(stack.w),int(stack.d))
		if placement_rotation % 2 and tool != "relocate":
			size = Vector2i(size.y,size.x)
		rect = {"x":floori(point.x),"z":floori(point.z),"w":size.x,"d":size.y}
	if tool == "processPipe" and placing:
		var dx: int = floori(point.x)-floori(click_point.x)
		var dz: int = floori(point.z)-floori(click_point.z)
		var vertical: bool = placement_rotation%2==1 if dx==0 and dz==0 else absi(dz)>absi(dx)
		rect = {"x":floori(click_point.x) if vertical else mini(floori(click_point.x),floori(point.x)),"z":mini(floori(click_point.z),floori(point.z)) if vertical else floori(click_point.z),"w":1 if vertical else absi(floori(point.x)-floori(click_point.x))+1,"d":absi(floori(point.z)-floori(click_point.z))+1 if vertical else 1}
	rect["rotation"] = placement_rotation
	rect["kind"] = tool
	world.preview(rect,true)

func _rail_placement_args(point: Vector3) -> Dictionary:
	# Flow belongs to the switch tool, never to a persistent dropdown mode.
	# Keep previews and committed plans identical when changing rail tools.
	var layout := {"railStraight":"straight","railCurve":"curve","railTurnout":"turnout","railConverging":"turnout"}
	return {"layout":layout[tool],"x":roundi(point.x),"z":roundi(point.z),"heading":placement_rotation,"hand":rail_hand,"snap":true,"flow":"converging" if tool=="railConverging" else "diverging"}

func _place(a: Vector3, b: Vector3) -> void:
	var rect := _rect(a,b)
	match tool:
		"processPipe": client.send("process_pipe_plan", {"from":{"x":floori(a.x),"z":floori(a.z)},"to":{"x":floori(b.x),"z":floori(b.z)},"rotation":placement_rotation})
		"slab": client.send("pave", {"rect":rect})
		"zone": client.send("zone", {"rect":rect,"name":"Stockyard %d" % (state.get("zones",[]).size()+1)})
		"railStraight", "railCurve", "railTurnout", "railConverging":
			client.send("plan_rail", _rail_placement_args(a))
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
			client.send("plan", {"kind":tool,"x":floori(a.x),"z":floori(a.z),"rotation":placement_rotation if tool in ["processTank","transferPump","pipeElbow","pipeTee","processValve","processGauge"] else placement_rotation%2,"foundations":true})

func _unhandled_input(event: InputEvent) -> void:
	if closing or (event is InputEventKey and _keyboard_controls_blocked()):
		return
	if event is InputEventMouseButton:
		var mouse := event as InputEventMouseButton
		var point = _floor_point(mouse.position)
		if mouse.button_index == MOUSE_BUTTON_LEFT:
			if tool=="cable" and point is Vector3:
				_cable_click(mouse.pressed,point,mouse.position)
				return
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
					drag_start_target = camera_target
					drag_camera_transform = camera.global_transform
					# Stop a previous orbit/zoom at its visible pose for a stable anchor.
					yaw = camera_yaw
					pitch = camera_pitch
					distance = camera_distance
			elif not mouse.pressed and point is Vector3:
				if placing:
					_place(click_point,point)
				elif not was_dragged:
					var picked: String = world.pick_screen(camera,mouse.position) if world.has_method("pick_screen") else ""
					if picked.is_empty():
						picked = world.pick_ground(point)
					if not electrical_pick_role.is_empty():
						_pick_electrical_asset(picked)
					elif not picked.is_empty():
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
			_zoom(-mouse.factor if mouse.factor > 0.0 else -1.0)
		elif mouse.pressed and mouse.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom(mouse.factor if mouse.factor > 0.0 else 1.0)
	elif event is InputEventPanGesture:
		# Cocoa sends phased two-finger scrolls (including momentum) as pan
		# gestures, not wheel buttons. Keep their fractional deltas continuous.
		_zoom(event.delta.y * 0.10)
	elif event is InputEventMagnifyGesture:
		if event.factor > 0.0:
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
				var anchored_point = _drag_floor_point(motion.position)
				if anchored_point is Vector3:
					target = drag_start_target + drag_point - (anchored_point as Vector3)
					follow = false
		elif orbiting:
			yaw -= motion.relative.x*0.005
			pitch = clampf(pitch+motion.relative.y*0.004,deg_to_rad(22),deg_to_rad(76))
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.is_command_or_control_pressed() and event.keycode == KEY_S:
			_request_file("save")
			get_viewport().set_input_as_handled()
			return
		match event.keycode:
			KEY_ESCAPE:
				if not electrical_pick_role.is_empty():
					_end_electrical_pick(true);return
				ui._select_tool("select")
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
	cable_pointer_down=false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		backgrounded = true
		if is_instance_valid(audio):audio.set_backgrounded(true)
		# Automated captures keep measuring/rendering even when covered by Codex.
		Engine.max_fps = 60 if capture_mode else 15
		dragging = false
		orbiting = false
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN:
		backgrounded = false
		if is_instance_valid(audio):audio.set_backgrounded(false)
		Engine.max_fps = 60
	elif what == NOTIFICATION_WM_CLOSE_REQUEST:
		_begin_close()

func _begin_close() -> void:
	if closing:
		return
	closing = true
	if is_instance_valid(audio):audio.set_backgrounded(true)
	ui.show_error("Saving the yard before closing…")
	client.close()

func _update_camera(dt: float, snap: bool = false) -> void:
	var fraction: float = 1.0 if snap else 1.0-exp(-dt*(24.0 if dragging else 12.0))
	camera_target = camera_target.lerp(target,fraction)
	camera_distance = lerpf(camera_distance,distance,fraction)
	camera_yaw = lerp_angle(camera_yaw,yaw,fraction)
	camera_pitch = lerpf(camera_pitch,pitch,fraction)
	var offset := Vector3(sin(camera_yaw)*cos(camera_pitch),sin(camera_pitch),cos(camera_yaw)*cos(camera_pitch))*camera_distance
	camera.position = camera_target+offset
	camera.look_at(camera_target)
	# Keep the four existing shadow maps, concentrating detail around the
	# working distance without increasing their texture size or memory.
	var reach: float = camera.far
	sun.directional_shadow_max_distance = reach
	sun.directional_shadow_split_1 = clampf(camera_distance*1.3+10.0,32.0,reach*0.45)/reach
	sun.directional_shadow_split_2 = clampf(camera_distance*2.25,sun.directional_shadow_split_1*reach+35.0,reach*0.70)/reach
	sun.directional_shadow_split_3 = clampf(camera_distance*3.5,sun.directional_shadow_split_2*reach+60.0,reach*0.90)/reach
	moon.directional_shadow_max_distance=reach
	moon.directional_shadow_split_1=sun.directional_shadow_split_1
	moon.directional_shadow_split_2=sun.directional_shadow_split_2
	moon.directional_shadow_split_3=sun.directional_shadow_split_3

func _keyboard_controls_blocked() -> bool:
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit:
		return true
	# Popups have independent viewport focus. Pause yard keyboard controls
	# for the whole dialog lifetime, including while its buttons have focus.
	for owner: Node in [ui,audio]:
		if not is_instance_valid(owner):continue
		for window: Window in owner.find_children("*","Window",true,false):
			if window.visible:return true
	return false

func _camera_key_pressed(key: Key) -> bool:
	return Input.is_physical_key_pressed(key)

func _process(dt: float) -> void:
	elapsed += dt
	if is_instance_valid(cable_preview_node):cable_preview_node.visible=ui.active_tab=="Yard"
	if is_instance_valid(electrical_pick_node):electrical_pick_node.visible=ui.active_tab=="Yard"
	if tool=="cable":
		cable_preview_age+=dt
		if not cable_cells.is_empty() and cable_preview_age>=1.:cable_preview_dirty=true
		if cable_preview_dirty and cable_preview_age>=.18:_request_cable_preview()
	_update_lighting(dt)
	if is_instance_valid(audio):audio.advance(dt,camera_target+Vector3.UP*2.0,Basis(Vector3.UP,camera_yaw))
	preview_clock += dt
	if preview_dirty and preview_clock >= 0.18 and tool.begins_with("rail"):
		preview_clock = 0.0
		preview_dirty = false
		var key := "%s:%d:%d:%d:%d" % [tool,roundi(preview_point.x),roundi(preview_point.z),placement_rotation,rail_hand]
		if key != preview_key:
			preview_key = key
			preview_request = client.send("rail_preview", _rail_placement_args(preview_point))
	if closing:
		close_clock += dt
		if close_clock > 4.5:
			get_tree().quit()
		return
	if is_instance_valid(world):
		world.visible = ui.active_tab == "Yard"
		world.advance(dt)
	if not backgrounded and not test_mode and not capture_mode and not _keyboard_controls_blocked():
		var forward := Vector3(-sin(camera_yaw),0,-cos(camera_yaw))
		var right := Vector3(cos(camera_yaw),0,-sin(camera_yaw))
		var movement := Vector3.ZERO
		if _camera_key_pressed(KEY_W): movement += forward
		if _camera_key_pressed(KEY_S): movement -= forward
		if _camera_key_pressed(KEY_D): movement += right
		if _camera_key_pressed(KEY_A): movement -= right
		if movement.length_squared() > 0:
			target += movement.limit_length()*dt*distance*0.25
			follow = false
		if _camera_key_pressed(KEY_Q): yaw -= dt*0.65
		if _camera_key_pressed(KEY_E): yaw += dt*0.65
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
	file_dialog.file_selected.connect(func(path: String): _command("import" if file_action == "load" else file_action, {"path":path}))
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
	result = await _await_reply(client.send("new_game", {"mode":"empty"}))
	_test_assert(result.get("ok",false),"Isolated empty yard for creative placement")
	result = await _await_reply(client.send("pause", {"paused":true}))
	result = await _await_reply(client.send("creative", {"enabled":true}))
	_test_assert(result.get("ok",false),"Creative mode native command")
	result = await _await_reply(client.send("plan", {"kind":"shed","x":60,"z":30}))
	_test_assert(result.get("ok",false) and result.get("result",{}).get("job",{}).get("status")=="done","Instant completed shed and foundations")
	result = await _await_reply(client.send("plan_rail", {"layout":"curve","x":125,"z":5,"heading":0,"hand":1,"snap":false}))
	_test_assert(result.get("ok",false) and result.get("result",{}).get("jobs",[]).size()==6,"Instant six-panel rail curve")
	result = await _await_reply(client.send("save"))
	await get_tree().create_timer(.3).timeout
	_test_assert(bool(state.get("creative",false)) and ui.creative_button.button_pressed,"Saved creative state reaches the native toggle")
	var built_sheds:int=0
	var incoming_stations:int=0
	for building:Dictionary in state.get("buildings",[]):
		if building.get("kind")=="shed":built_sheds+=1
		if building.get("kind")=="power" and building.get("id")=="BLD-0000":incoming_stations+=1
	_test_assert(state.get("rails",[]).size()==6 and built_sheds==1 and incoming_stations==1,"Direct assets and opening supply reach the real scene snapshot")
	_test_assert(state.get("orders",[]).is_empty() and state.get("costs",[]).is_empty(),"No hidden delivery or construction invoices")
	var recovered_rail_id: String=str(state.rails[0].id)
	result = await _await_reply(client.send("zone", {"rect":{"x":45,"z":60,"w":50,"d":30},"name":"Recovered track"}))
	_test_assert(result.get("ok",false),"Physical stockyard for instant recovery")
	ui.show_entity(recovered_rail_id)
	result = await _await_reply(client.send("remove_rail", {"id":recovered_rail_id,"scope":"assembly"}))
	_test_assert(result.get("ok",false),"Recover installed curve through packaged native bridge")
	await get_tree().create_timer(.3).timeout
	var recovered_panels:int=0
	var recovered_buffers:int=0
	for stock in state.get("stacks",[]):
		if str(stock.item)=="railCurve":recovered_panels+=int(stock.qty)
		if str(stock.item)=="bufferStop":recovered_buffers+=int(stock.qty)
	_test_assert(state.rails.is_empty() and recovered_panels==6 and recovered_buffers==1,"Six real modules and attached stop are stored without loss")
	result = await _await_reply(client.send("plan_rail", {"layout":"turnout","x":125,"z":5,"heading":0,"hand":1,"snap":false}))
	_test_assert(result.get("ok",false),"Rebuild a turnout from the recovered endpoint")
	await get_tree().create_timer(.3).timeout
	_test_assert(state.rails.size()==7,"Replacement turnout reaches the live renderer")
	result = await _await_reply(client.send("creative", {"enabled":false}))
	_test_assert(result.get("ok",false),"Return to normal construction")
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


func _run_camera_capture() -> void:
	await _wait_connection()
	var result: Dictionary = await _await_reply(client.send("new_game", {"mode":"example"}))
	_test_assert(result.get("ok",false),"Camera capture uses actual example simulation")
	await _await_reply(client.send("pause", {"paused":true}))
	await get_tree().create_timer(0.5).timeout
	_notification(NOTIFICATION_APPLICATION_FOCUS_IN)
	_preset("yard")
	_update_camera(0,true)
	_set_grid(true)
	await get_tree().create_timer(1.5).timeout
	ui.toast.hide()
	await _save_capture("camera-grid-on.png")
	_set_grid(false)
	await get_tree().create_timer(1.0).timeout
	await _save_capture("camera-grid-off.png")
	_preset("overview")
	_update_camera(0,true)
	await get_tree().create_timer(1.0).timeout
	await _save_capture("camera-overview-shadows.png")
	# Keep a comparison image of the former 100 m cutoff for visual verification.
	sun.shadow_enabled = false
	await get_tree().create_timer(0.7).timeout
	await _save_capture("camera-overview-no-sun-shadows.png")
	sun.shadow_enabled = true
	_preset("yard")
	_update_camera(0,true)
	await get_tree().create_timer(1.0).timeout
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.position = get_viewport().get_visible_rect().size * Vector2(0.42,0.62)
	press.pressed = true
	_unhandled_input(press)
	var intervals: Array[float] = []
	var last_time: int = Time.get_ticks_usec()
	var changed_frames: int = 0
	var previous_position := camera.position
	for frame in range(180):
		# Deliberately sparse mouse events: drawing must still advance between them.
		if frame % 12 == 0:
			var motion := InputEventMouseMotion.new()
			motion.position = press.position + Vector2(frame*0.9,frame*0.12)
			_unhandled_input(motion)
		await get_tree().process_frame
		var now: int = Time.get_ticks_usec()
		intervals.append(float(now-last_time)/1000.0)
		last_time = now
		if camera.position.distance_to(previous_position) > 0.001:
			changed_frames += 1
		previous_position = camera.position
	_reset_drag()
	intervals.sort()
	var report := {"frames":intervals.size(),"changedFrames":changed_frames,"inputEvents":15,
		"medianFrameMs":intervals[90],"p95FrameMs":intervals[171],"shadowReachMeters":sun.directional_shadow_max_distance,
		"shadowFadeStart":sun.directional_shadow_fade_start,"gridOnOffCaptured":true,
		"renderScale":get_viewport().scaling_3d_scale,"renderMode":get_viewport().scaling_3d_mode}
	FileAccess.open("res://captures/camera-render-results.json",FileAccess.WRITE).store_string(JSON.stringify(report,"\t"))
	_test_assert(changed_frames > 140,"Pan advances on drawing frames between sparse mouse events")
	print("CAMERA_RENDER_CHECK ",JSON.stringify(report))
	_begin_close()

func _run_ghost_capture() -> void:
	await _wait_connection()
	var result: Dictionary = await _await_reply(client.send("new_game",{"mode":"example"}))
	_test_assert(result.get("ok",false),"Ghost review uses a real paused example yard")
	await _await_reply(client.send("pause",{"paused":true}))
	for plan: Dictionary in [
		{"layout":"curve","x":125,"z":5,"heading":0,"hand":1,"snap":false},
		{"layout":"straight","x":145,"z":25,"heading":1,"hand":1,"snap":false},
		{"layout":"turnout","x":145,"z":30,"heading":1,"hand":1,"snap":false}]:
		result = await _await_reply(client.send("plan_rail",plan))
		_test_assert(result.get("ok",false),"Plan real "+str(plan.layout)+" rail ghosts: "+str(result.get("error","")))
	for plan: Dictionary in [{"kind":"office","x":152,"z":24},{"kind":"shed","x":152,"z":36}]:
		result = await _await_reply(client.send("plan",plan))
		_test_assert(result.get("ok",false),"Plan real building ghost: "+str(result.get("error","")))
	await get_tree().create_timer(0.5).timeout
	ui.show_tab("Yard")
	target = Vector3(141,0,31);distance = 96;pitch = deg_to_rad(50);yaw = deg_to_rad(-15)
	_update_camera(0,true)
	_set_grid(true)
	ui.toast.hide()
	await get_tree().create_timer(1.0).timeout
	await _save_capture("ghost-plans-day.png")
	_set_lighting(true)
	await get_tree().create_timer(1.0).timeout
	await _save_capture("ghost-plans-dusk.png")
	_set_lighting(false)
	result = await _await_reply(client.send("rail_preview",{"layout":"straight","x":145,"z":50,"heading":1,"snap":false}))
	_test_assert(result.get("ok",false),"Real cursor rail preview geometry")
	world.preview_track(result.result.get("geometries",[]),true)
	await get_tree().create_timer(1.0).timeout
	await _save_capture("ghost-preview-valid.png")
	world.preview_track(result.result.get("geometries",[]),false)
	await get_tree().create_timer(0.7).timeout
	await _save_capture("ghost-preview-invalid.png")
	print("GHOST_CAPTURE_COMPLETE ",JSON.stringify({"jobs":state.get("jobs",[]).size(),"railPlans":world.render.get("railGeometry",[]).size()}))
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
