extends SceneTree
## Detached trains, owned yard locomotive, and independent pickup engine.
const W=preload("res://scripts/game_world.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(condition:bool,message:String)->void:
	checks+=1
	if not condition:failures.append(message)
func _pose(x:float,z:float,yaw:float)->Dictionary:return {"x":x,"z":z,"y":0.0,"yaw":yaw}
func _bogies(p:Dictionary)->Array:
	var result:Array=[]
	for offset in [-2.79,2.79]:result.append(_pose(p.x+offset*cos(p.yaw),p.z+offset*sin(p.yaw),p.yaw))
	return result
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var first:Dictionary={"id":"CAR-9001","length":16.8,"x":80.,"z":5.,"yaw":0.,"bogies":[_pose(74.5,5,0),_pose(85.5,5,0)]}
	var second:Dictionary={"id":"CAR-9002","length":16.8,"x":62.4,"z":5.,"yaw":0.,"bogies":[_pose(56.9,5,0),_pose(67.9,5,0)]}
	var cargo:Dictionary={"id":"LOT-1","item":"rail","qty":2,"carId":"CAR-9002","x":62.4,"z":5.,"y":1.3,"yaw":0.}
	var train:Dictionary={"id":"PO-9001","kind":"rail","locomotive":null,"cars":[first,second],"cargo":[cargo]}
	var shunter:=_pose(94,5,0);shunter.id="SHUNTER-9001";shunter.driverId="WRK-9001";shunter.bogies=_bogies(shunter)
	fixture.render.carriers=[train];fixture.render.railShunters=[shunter]
	var world:=W.new();root.add_child(world);world.setup();world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.size()==4,"Detached two-car train, actual cargo, and owned shunter have exactly four keyed models")
	_check(not world.models.has("PO-9001"),"Departed line engine has no phantom model")
	var engine:Node3D=world.models[shunter.id]
	_check(engine.get_meta("kind")=="railShunter" and engine.get_meta("forward")=="+X","Owned shunter uses rail forward convention and independent kind")
	_check(engine.get_meta("inspect_id")==shunter.id,"Shunter is individually clickable")
	_check(engine.get_node("Operator").visible,"Assigned driver visibly occupies owned engine cab")
	_check(world.entity_position(shunter.id).distance_to(Vector3(94,0,5))<.001,"Locate follows owned engine instead of delivery default")
	var camera:=Camera3D.new();root.add_child(camera);camera.position=Vector3(94,12,23);camera.look_at(Vector3(94,2,5));camera.current=true
	await process_frame
	_check(world.pick_screen(camera,camera.unproject_position(Vector3(94,2,5)))==shunter.id,"Owned locomotive can be selected by clicking its physical cab and body")
	for index in range(2):
		var target:Dictionary=shunter.bogies[index]
		_check(engine.get_node("RailBogie"+str(index)).global_position.distance_to(Vector3(target.x,0,target.z))<.001,"Shunter has independently sampled bogies")
	var initial_car:int=world.models[first.id].get_instance_id()
	var initial_engine:int=engine.get_instance_id()
	# Shunt onto a curved branch. Both carriage and its cargo follow the same
	# interpolated transform instead of cargo sliding sideways between snapshots.
	second.x=65.;second.z=11.;second.yaw=.35;second.bogies=[_pose(59.8,8.7,.25),_pose(70.2,13.3,.45)]
	cargo.x=65.;cargo.z=11.;cargo.yaw=.35
	shunter.x=97.;shunter.z=10.;shunter.yaw=.4;shunter.bogies=[_pose(94.5,8.7,.3),_pose(99.5,11.3,.5)]
	world.sync_snapshot(fixture);world.advance(world.span*.5)
	_check(world.models[first.id].get_instance_id()==initial_car and engine.get_instance_id()==initial_engine,"Shunting reuses car and engine models across movement")
	_check(engine.position.x>94 and engine.position.x<97,"Yard engine movement interpolates between simulation snapshots")
	var load:Node3D=world.models["PO-9001/freight/LOT-1"]
	var car:Node3D=world.models[second.id]
	_check(Vector2(load.position.x,load.position.z).distance_to(Vector2(car.position.x,car.position.z))<.001,"Cargo stays supported by its own moving car")
	_check(absf(load.position.y-1.3)<.001,"Moving cargo retains deck height")
	# Uncoupled yard engine can remain present while a separate pickup engine
	# arrives. There are no duplicated cars in the pickup carrier record.
	var pickup:=_pose(150,0,0);pickup.id="LOCO-RETURN-9001";pickup.inspectId="RETURN-9001";pickup.bogies=_bogies(pickup)
	fixture.render.carriers.append({"id":"RETURN-9001","kind":"rail","locomotive":pickup,"cars":[],"cargo":[]})
	shunter.driverId="";world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.size()==5,"Independent pickup engine adds one model without duplicating assigned empty or loaded cars")
	_check(world.models[pickup.id].get_meta("inspect_id")=="RETURN-9001","Pickup engine opens its return operation")
	_check(not engine.get_node("Operator").visible,"Driver exiting cab removes seated operator")
	train.cars=[first];train.cargo=[];world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.has(first.id) and not world.models.has(second.id),"Only physically returned car disappears; retained car stays in yard")
	fixture.render.carriers=[];world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.size()==1 and world.models.has(shunter.id),"Collected supplier train departs while owned engine remains on site")
	fixture.render.railShunters=[];world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.is_empty(),"No abandoned locomotive, bogie, or cargo node after all assets leave")
	# The completed return junction owns its straight main-line panels; the
	# preinstalled running rail must stop at each end to avoid z-fighting.
	fixture.state.rails=[]
	for section in range(7):fixture.state.rails.append({"id":"EXIT-"+str(section),"track":{"layout":"turnout","origin":{"x":145,"z":0},"heading":2,"hand":-1,"flow":"converging","section":section}})
	world.sync_snapshot(fixture)
	_check(world.mainline_exit_present,"Completed exit turnout replaces overlapping static main-line running rails")
	fixture.state.rails=[];world.sync_snapshot(fixture)
	_check(not world.mainline_exit_present,"Removing the exit restores continuous preinstalled main-line rendering")
	fixture.render.mainlineExitCut=true;world.sync_snapshot(fixture)
	_check(world.mainline_exit_present,"Recovery of commissioned exit panels leaves the original main-line gap instead of inventing steel")
	fixture.render.sidingCuts=[{"x":80,"end":100,"complete":true}];world.sync_snapshot(fixture)
	_check(world.siding_access_key=="[80]","Factory switch cuts only its commissioned original siding span")
	camera.queue_free();world.queue_free();await process_frame
	print("SHUNTING_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
