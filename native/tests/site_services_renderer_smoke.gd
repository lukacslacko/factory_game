extends SceneTree
const World=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1440,900);root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	var game:=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.camera.far=650;game.camera.fov=38;game.camera.current=true;game._setup_environment()
	game.world=World.new();game.add_child(game.world);game.world.setup();game.world.set_grid(false)
	var fixtures:Array=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/collection-fixtures.json"))
	for record:Dictionary in fixtures:
		var name:String=str(record.name)
		var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/"+name+".json"))
		game.state=fixture.state;game._update_lighting(0,true);game.world.sync_snapshot(fixture);game.world.advance(.3)
		for actor:Dictionary in fixture.render.actors:_check(game.world.models.has(str(actor.id)),name+" retains actual actor "+str(actor.id))
		for load:Dictionary in fixture.render.get("loads",[]):_check(game.world.models.has(str(load.id)),name+" shows actual supported cargo "+str(load.id))
		for stack:Dictionary in fixture.state.stacks:
			if int(stack.get("qty",0))<=0 and fixture.state.collections[0].task.get("lifted",false):_check(not game.world.statics[str(stack.id)].visible,name+" has no duplicate emptied source stock")
		var c:Dictionary=fixture.state.collections[0];var id:String=str(c.get("equipmentId",c.get("task",{}).get("equipmentId","")))
		if name=="collection-lowloader-ramp":
			_check(float(game.world.models[id].position.y)>.2,"Actual machine climbs above ground on its lowloader ramp")
			_check(fixture.state.workers[0].get("vehicle","")==id,"Actual ramp machine has its operator seated")
			var carrier:Node3D=game.world.models[str(c.carrierOrderId)]
			_check(str(carrier.get_meta("kind"))=="lowloader" and carrier.has_node("RampL") and carrier.has_node("RampR"),"Importing a yard with reused IDs replaces the previous freight truck with real lowloader geometry")
			for ramp_name:String in ["RampL","RampR"]:
				var ramp:Node3D=carrier.get_node(ramp_name)
				var foot:Vector3=ramp.to_global(Vector3(0,0,float(ramp.get_meta("length"))))
				_check(absf(foot.y)<.001 and absf(foot.distance_to(Vector3(float(carrier.position.x),0,float(carrier.position.z)))-sqrt(9.75*9.75+.897*.897))<.001,"Deployed ramp meets the ground at the simulation's exact rear run")
		game.target=Vector3(float(record.focus.x),0,float(record.focus.z));game.distance=27 if name=="collection-lowloader-ramp" else 34;game.yaw=deg_to_rad(-35);game.pitch=deg_to_rad(38);game._update_camera(0,true)
		for frame:int in range(15):await process_frame
		if RenderingServer.get_rendering_device()!=null:
			RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/"+name+".png")
	# A reserved source footprint stays in the save for cancellation, but a drum
	# already lifted must have exactly one visible physical representation.
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/collection-carry.json"))
	var source:String=str(fixture.state.collections[0].lines[0].stackId)
	for stack:Dictionary in fixture.state.stacks:
		if str(stack.id)==source:stack.item="diesel";stack.qty=0;stack.liters=0;stack.w=1;stack.d=1
	game.world.sync_snapshot(fixture);game.world.advance(.3)
	_check(not game.world.statics[source].visible,"A lifted empty drum is not also rendered at its retained source record")
	var demo:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).demo
	game.world.set_lamp_amount(1);game.world.sync_snapshot(demo)
	_check(game.world.lamp_nodes.size()>0,"Newly installed lamps enter the bounded light-node cache")
	for lights:Array in game.world.lamp_nodes.values():
		for light:OmniLight3D in lights:
			_check(is_equal_approx(light.light_energy,7.5) if bool(light.get_meta("connected",false)) else light.light_energy==0,"Only actually connected lamps light the night")
	game.world.sync_snapshot(JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty)
	_check(game.world.lamp_nodes.is_empty(),"Removed lamps leave the cache without stale nodes")
	game.queue_free();await process_frame
	print("SITE_SERVICES_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
