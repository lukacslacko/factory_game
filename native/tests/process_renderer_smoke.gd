extends SceneTree
## Real process meshes, dimensional ports, phased assembly and bounded live updates.
## Parent runs this serially; the optional GPU path uses an isolated renderer only.
const W=preload("res://scripts/game_world.gd")
const P=preload("res://scripts/process_models.gd")
const G=preload("res://scripts/geometry.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
var checks:int=0
var failures:Array[String]=[]
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _pose(x:float,y:float,z:float,yaw:float=0.)->Dictionary:return {"x":x,"y":y,"z":z,"yaw":yaw}
func _building(id:String,kind:String,x:float,z:float,w:int=1,d:int=1,rotation:int=0)->Dictionary:return {"id":id,"kind":kind,"x":x,"z":z,"w":w,"d":d,"rotation":rotation}
func _check_port(model:Node3D,path:String,expected:Vector3,label:String)->void:
	var marker:Node3D=model.get_node_or_null(path)
	_check(marker!=null and marker.global_position.distance_to(expected)<.001,label)
func _bounds(node:Node3D)->AABB:
	var result:AABB
	var first:bool=true
	for mesh:MeshInstance3D in node.find_children("*","MeshInstance3D",true,false):
		var local:AABB=(node.global_transform.affine_inverse()*mesh.global_transform)*mesh.get_aabb()
		result=local if first else result.merge(local);first=false
	return result
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1440,810);root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.buildings=[_building("BLD-TANK","processTank",70,20,4,4),_building("BLD-PUMP","transferPump",76,22,2,2),_building("BLD-PIPE","processPipe",74,22),_building("BLD-ELBOW","pipeElbow",75,22),_building("BLD-TEE","pipeTee",75,21,1,1,1),_building("BLD-VALVE","processValve",75,20,1,1,1),_building("BLD-GAUGE","processGauge",74,20)]
	fixture.state.paving={"70,20":["JOB-PAVING"],"76,22":["JOB-PAVING"]}
	fixture.render.processRows=[{"id":"BLD-TANK","liters":15000.,"capacity":30000.},{"id":"BLD-VALVE","open":true},{"id":"BLD-GAUGE","flow":30.,"maxFlow":60.},{"id":"BLD-PUMP","running":true}]
	fixture.render.processHoses=[{"id":"BLD-PUMP/hose","pumpId":"BLD-PUMP","points":[_pose(77,1.66,16.5),_pose(77,.2,18),_pose(76,.2,21),_pose(76,1.1,22.5)]}]
	var asset_id:String="BLD-ASSEMBLY";var component_ids:Dictionary={}
	var components:Array=[]
	for component:String in P.components("processTank"):
		component_ids[component]=asset_id+"/"+component
		var local:Vector3=P.component_position("processTank",component)
		components.append({"id":component_ids[component],"kind":component,"pose":_pose(83+local.x,local.y,23+local.z),"installed":component in ["base","shell0"]})
	var assembly:Dictionary={"jobId":"JOB-PROCESS","assetId":asset_id,"kind":"processTank","rotation":0,"phase":"lift","completed":2,"recovering":false,"componentIds":component_ids,"components":components,"kitPose":_pose(88,.1,23),"part":{"kind":"shell1","pose":_pose(85,2.6,23)}}
	fixture.render.processAssemblies=[assembly]
	fixture.state.jobs=[{"id":"JOB-PROCESS","kind":"processTank","x":81,"z":21,"w":4,"d":4,"status":"doing"}]
	var game:=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.add_child(game.sun)
	game.world=W.new();game.add_child(game.world);game.world.setup();game.world.sync_snapshot(fixture);game.world.advance(.3)
	var world:Node3D=game.world
	var packed:Node3D=P.kit(world,"processTank")
	var packed_bounds:AABB=_bounds(packed)
	_check(packed_bounds.size.x<=3.001 and packed_bounds.size.z<=2.001,"Transported tank kit fits its actual3×2m catalog/storage footprint")
	world.remove_child(packed);packed.queue_free()
	var tank:Node3D=world.statics["BLD-TANK"]
	_check(tank.get_meta("process_kind")=="processTank","Tank uses a detailed opaque process vessel")
	_check((tank.get_node("shell0/ContainedShell").mesh as CylinderMesh).radial_segments==64,"Tank shells stay smooth at close zoom")
	_check(is_equal_approx((tank.get_node("shell0/ContainedShell").mesh as CylinderMesh).top_radius,1.7),"The30m³ vessel has the physical3.4m diameter")
	_check_port(tank,"fittings/PortE",Vector3(74,.85,22.5),"Tank nozzle reaches its exact east grid port")
	_check_port(world.statics["BLD-PUMP"],"manifold/PortHose",Vector3(76,1.1,22.5),"Flexible hose connects at the pump's actual west coupler")
	_check_port(world.statics["BLD-TEE"],"connections/PortN",Vector3(76,.85,21.5),"Rotated tee uses clockwise cardinal ports")
	_check(not world.statics.has(asset_id),"Unfinished construction has no magically complete tank")
	_check(world.models.has(asset_id+"/base") and world.models.has(asset_id+"/shell0") and not world.models.has(asset_id+"/roof"),"Only actually installed process components appear")
	_check(world.models[asset_id+"/shell1"].position.distance_to(Vector3(85,2.6,23))<.001,"The active shell follows its real lifting pose")
	_check(world.models.has("JOB-PROCESS/process-kit"),"Remaining components stay visibly crated at the actual kit")
	_check(world.models["BLD-PUMP/hose"].get_meta("inspect_id")=="BLD-PUMP","Physical hose inspection points back to its pump")
	var tank_instance:int=tank.get_instance_id();var needle:Node3D=world.statics["BLD-GAUGE"].get_node("fitting/GaugeDial/Needle")
	var needle_angle:float=needle.rotation.z;var shell_instance:int=world.models[asset_id+"/shell1"].get_instance_id();var meshes:int=G.meshes.size()
	for i in range(30):
		fixture.render.processRows[0].liters=1000+i*100
		fixture.render.processRows[1].open=false
		fixture.render.processRows[2].flow=i
		fixture.render.processHoses[0].points[1].x=77.+i*.001
		world.sync_snapshot(fixture);world.advance(.3)
	_check(world.statics["BLD-TANK"].get_instance_id()==tank_instance,"Contents changes retain the installed vessel and shared geometry")
	_check(not is_equal_approx(needle.rotation.z,needle_angle),"Gauge needle follows actual measured flow")
	_check(is_equal_approx(world.statics["BLD-VALVE"].get_node("fitting/ValveWheel").rotation.y,PI*.5),"Valve handwheel indicates the real closed state")
	_check(G.meshes.size()==meshes,"Moving hose and live readings do not accumulate new cached meshes")
	assembly.part={};assembly.components[2].installed=true;assembly.completed=3
	world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models[asset_id+"/shell1"].get_instance_id()==shell_instance,"A placed component retains its stable physical identity")
	_check(world.models[asset_id+"/shell1"].position.distance_to(Vector3(83,1.87,23))<.001,"Completed shell snaps only to its actual installed assembly pose")
	var captured:bool=false
	if RenderingServer.get_rendering_device()!=null:
		game.remove_child(game.sun);game._setup_environment();game._set_lighting(false)
		game.camera.current=true;game.camera.fov=38;game.target=Vector3(78,0,22);game.distance=42;game.pitch=deg_to_rad(48);game.yaw=deg_to_rad(-22);game._update_camera(0,true);world.set_grid(false)
		for i in range(18):await process_frame
		RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/process-equipment.png");captured=true
	fixture.state.buildings=[];fixture.state.jobs=[];fixture.state.paving={"70,20":["JOB-PAVING"],"76,22":["JOB-PAVING"]}
	fixture.render.processRows=[];fixture.render.processAssemblies=[];fixture.render.processHoses=[]
	world.sync_snapshot(fixture)
	_check(world.models.is_empty() and not world.statics.has("BLD-TANK"),"Removing a process scene frees all assembly and hose nodes")
	game.queue_free();await process_frame
	print("PROCESS_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"gpuCaptured":captured}))
	quit(0 if failures.is_empty() else 1)
