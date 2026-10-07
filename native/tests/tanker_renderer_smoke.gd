extends SceneTree
## Stable contained-liquid models and optional isolated GPU visual QA.
const W=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
var checks:int=0
var failures:Array[String]=[]
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _pose(x:float,z:float)->Dictionary:return {"x":x,"z":z,"y":0.,"yaw":0.}
func _mesh_count(node:Node)->int:
	var count:int=1 if node is MeshInstance3D else 0
	for child in node.get_children():count+=_mesh_count(child)
	return count
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1440,810);root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var cars:Array=[]
	for i in range(2):
		var x:float=80.-17.6*i
		cars.append({"id":"CAR-TEST-"+str(i),"kind":"tanker","length":16.8,"x":x,"z":5.,"yaw":0.,"bogies":[_pose(x-5.5,5),_pose(x+5.5,5)],"tank":{"product":"bulkWater" if i==0 else "bulkDiesel","liters":20000,"capacity":30000}})
	fixture.render.carriers=[{"id":"ORD-TEST-1","kind":"rail","locomotive":null,"cars":cars,"cargo":[]}]
	var game:=MainHarness.new();root.add_child(game)
	game.add_child(game.camera);game.add_child(game.sun)
	game.world=W.new();game.add_child(game.world);game.world.setup();game.world.sync_snapshot(fixture);game.world.advance(.3)
	var world:Node3D=game.world
	_check(world.models.size()==2,"Two liquid cars have two stable models and no phantom deck cargo")
	for car:Dictionary in cars:
		var body:Node3D=world.models[car.id]
		_check(body.get_meta("car_type")=="tanker","Contained liquid uses a rounded tank instead of a flatcar load")
		_check(body.get_meta("liquid")==car.tank.product,"Water and diesel retain distinct physical car metadata")
		_check(body.get_meta("inspect_id")==car.id,"Each tanker selects its own car record")
		_check(body.has_node("ContainedTank"),"Tanker has a separate contained cylindrical vessel")
		_check((body.get_node("ContainedTank").mesh as CylinderMesh).radial_segments==48,"Tank cylinder stays smooth at close zoom")
		_check(_mesh_count(body)>70,"Tank car includes bogies, ladders, platforms, handrails and fittings")
		for j in range(2):
			var p:Dictionary=car.bogies[j]
			_check(body.get_node("RailBogie"+str(j)).global_position.distance_to(Vector3(p.x,0,p.z))<.001,"Loaded tanker's bogies follow independent rail samples")
	var instance:int=world.models[cars[0].id].get_instance_id()
	cars[0].tank.liters=15000;world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models[cars[0].id].get_instance_id()==instance,"A contents update does not recreate or move the vessel")
	var captured:bool=false
	if RenderingServer.get_rendering_device()!=null:
		# Use the real game's daylight and reflections; never start a service or open a private yard.
		game.remove_child(game.sun);game._setup_environment();game._set_lighting(false)
		game.camera.current=true;game.camera.fov=38;game.camera.near=.2;game.camera.far=650
		game.target=Vector3(72,0,6);game.distance=68;game.pitch=deg_to_rad(48);game.yaw=deg_to_rad(-12);game._update_camera(0,true)
		world.set_grid(false)
		for i in range(18):await process_frame
		RenderingServer.force_draw(false)
		root.get_texture().get_image().save_png("res://captures/v0220-tankers.png");captured=true
	fixture.render.carriers=[];world.sync_snapshot(fixture)
	_check(world.models.is_empty(),"Departed tankers leave no abandoned vessel or bogie nodes")
	game.queue_free();await process_frame
	print("TANKER_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"gpuCaptured":captured}))
	quit(0 if failures.is_empty() else 1)
