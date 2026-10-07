extends SceneTree
## Verify the rail shed uses full-sized detailed components and a saved visible bay.
const W=preload("res://scripts/game_world.gd")
const M=preload("res://scripts/game_models.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
class FakeClient:
	extends Node
	var sent:Array=[]
	func send(action:String,args:Dictionary)->int:
		sent.append({"action":action,"args":args});return sent.size()
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _meshes(node:Node)->int:
	var n:int=1 if node is MeshInstance3D else 0
	for child in node.get_children():n+=_meshes(child)
	return n
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.buildings=[{"id":"BLD-9001","kind":"engineShed","x":142,"z":33,"w":6,"d":14,"rotation":0,"name":"Engine shed","connected":true,"parkingLocationId":"BLD-9001/BAY"}]
	fixture.state.railLocations=[{"id":"BLD-9001/BAY","name":"Engine shed bay","kind":"parking","trackId":"RAIL-9001","route":"straight","offset":2,"length":14}]
	fixture.render.railLocations=[{"id":"BLD-9001/BAY","pose":{"x":145,"z":40,"yaw":PI/2},"path":[{"x":145,"z":33},{"x":145,"z":47}],"status":{"connected":true,"valid":true}}]
	var world:=W.new();root.add_child(world);world.setup();world.sync_snapshot(fixture);world.advance(.3)
	_check(world.statics.has("BLD-9001"),"Completed engine shed has a stable static model")
	_check(world.statics.has("BLD-9001/BAY"),"Named locomotive parking bay remains visible and keyed independently")
	var shed:Node3D=world.statics["BLD-9001"]
	_check(shed.position.is_equal_approx(Vector3(145,0,40)),"Shed is centered on its aligned internal track")
	var posts:int=0
	for child in shed.get_children():
		if str(child.name).begins_with("EnginePost"):
			posts+=1
			_check(absf(child.position.x)>2.8,"Columns leave a wide, unobstructed locomotive corridor")
	_check(posts==6,"Six actual structural columns are rendered")
	for i in range(3):_check(shed.has_node("EngineFrame"+str(i)),"Each roof frame is a separately installed component")
	for i in range(8):_check(shed.has_node("EngineRoof"+str(i)),"Eight roof sections cover the complete 14 meter length")
	for i in range(4):_check(shed.has_node("SideWall"+str(i)),"Four corrugated side walls retain both rail entrances")
	for i in range(2):
		var door:Node3D=shed.get_node("RaisedDoor"+str(i))
		_check(door.position.y>5.1,"Raised roller doors preserve over five meters of locomotive clearance")
	_check(_meshes(shed)>30,"Engine shed keeps detailed corrugated roofing, walls and door housings")
	var previous:int=shed.get_instance_id();world.sync_snapshot(fixture)
	_check(previous==world.statics["BLD-9001"].get_instance_id(),"Repeated snapshots reuse the detailed keyed shed model")
	fixture.state.buildings=[];fixture.state.railLocations=[];fixture.render.railLocations=[]
	fixture.state.jobs=[{"id":"JOB-9002","kind":"engineShed","x":142,"z":33,"w":6,"d":14,"rotation":0,"status":"doing"}]
	fixture.render.sheds=[{"jobId":"JOB-9002","kind":"engineShed","x":142,"z":33,"w":6,"d":14,"rotation":0,"anchors":1,"posts":1,"beams":0,"roofSheets":0,"wallPanels":0,"braces":0,"limits":{"post":6,"beam":3,"roof":8,"wall":6,"brace":0},"anchorPoses":[{"x":142.18,"z":33.18,"y":.025}],"parts":[{"kind":"post","index":0,"installed":true,"pose":{"x":142.18,"z":33.18,"y":2.855,"yaw":0}}]}]
	world.sync_snapshot(fixture);world.advance(.3)
	_check(not world.statics.has("BLD-9001"),"Partial work does not reveal a completed engine shed")
	_check(world.models.has("JOB-9002/anchor/0") and world.models.has("JOB-9002/assembly/post/0"),"Installed anchors and tall columns remain individually visible during construction")
	var main:=MainHarness.new();root.add_child(main);main.world=world
	main.add_child(main.camera);main.add_child(main.sun)
	var fake:=FakeClient.new();root.add_child(fake);main.client=fake
	main.tool="engineShed";main.placement_rotation=1
	main._placement_preview(Vector3(100,0,30))
	main._place(Vector3(100,0,30),Vector3(100,0,30))
	_check(fake.sent[0].action=="plan" and fake.sent[0].args.kind=="engineShed" and fake.sent[0].args.rotation==1,"Native engine shed tool commits its own build kind and cardinal orientation")
	main.queue_free();fake.queue_free();world.queue_free()
	await process_frame
	print("ENGINE_SHED_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
