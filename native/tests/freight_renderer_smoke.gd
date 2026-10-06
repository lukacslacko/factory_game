extends SceneTree
## Car identities, independent track samples and supplier departure without GPU.
const W=preload("res://scripts/game_world.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(condition:bool,message:String)->void:
	checks+=1
	if not condition:failures.append(message)
func _pose(x:float,z:float,yaw:float)->Dictionary:return {"x":x,"z":z,"y":0.0,"yaw":yaw}
func _car(id:String,x:float,z:float,yaw:float)->Dictionary:
	var a:=_pose(x-5.5*cos(yaw),z-5.5*sin(yaw),yaw-.08)
	var b:=_pose(x+5.5*cos(yaw),z+5.5*sin(yaw),yaw+.08)
	return {"id":id,"x":x,"z":z,"y":0.0,"yaw":yaw,"deckLength":16,"bogies":[a,b]}
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var first:=_car("CAR-9001",80,5,0)
	var second:=_car("CAR-9002",61.1,8.2,-.3)
	second.deckLength=3.0;second.length=16.8
	var engine:=_pose(93.4,5,.3)
	engine.bogies=[_pose(90.7,4.3,.2),_pose(96.1,5.7,.4)]
	var carrier:Dictionary={"id":"PO-9001","kind":"rail","locomotive":engine,"cars":[first,second],"freight":first,"cargo":[{"id":"LOT-1","item":"slab","qty":3,"carId":"CAR-9002","x":61.1,"z":8.2,"y":1.3,"yaw":-.3}]}
	fixture.render.carriers=[carrier]
	var world:=W.new();root.add_child(world);world.setup();world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.has("PO-9001"),"Train has one supplier locomotive")
	_check(world.models.has("CAR-9001") and world.models.has("CAR-9002"),"Every manifest car has an independent stable native identity")
	_check(not world.models.has("PO-9001/wagon"),"Explicit consist does not render a duplicate legacy first wagon")
	_check(is_equal_approx(float(world.models["CAR-9002"].get_meta("deck_length")),16.0),"Partially loaded car keeps its full physical deck rather than shrinking to cargo length")
	_check(world.models.size()==4,"Two cars, one locomotive and one actual cargo lot are the only dynamic models")
	var first_instance:int=world.models["CAR-9001"].get_instance_id()
	for car in [first,second]:
		var body:Node3D=world.models[car.id]
		_check(body.position.is_equal_approx(Vector3(car.x,0,car.z)),"Car body center uses its own route pose")
		_check(body.get_meta("inspect_id")==car.id,"Car is individually inspectable")
		for index in range(2):
			var bogie:Node3D=body.get_node("RailBogie"+str(index))
			var target:Dictionary=car.bogies[index]
			_check(bogie.global_position.distance_to(Vector3(target.x,0,target.z))<.001,"Bogie center uses its own track sample")
			_check((bogie.global_basis*Vector3.RIGHT).normalized().dot(Vector3(cos(target.yaw),0,sin(target.yaw)))>.999,"Bogie tangent follows track instead of rigid car heading")
			_check(bogie.get_child_count()>4,"Each physical bogie includes both wheelsets and suspension")
	var locomotive:Node3D=world.models["PO-9001"]
	for index in range(2):
		var target:Dictionary=engine.bogies[index]
		var bogie:Node3D=locomotive.get_node("RailBogie"+str(index))
		_check(bogie.global_position.distance_to(Vector3(target.x,0,target.z))<.001,"Supplier locomotive bogies follow separate track samples")
		_check((bogie.global_basis*Vector3.RIGHT).normalized().dot(Vector3(cos(target.yaw),0,sin(target.yaw)))>.99999,"Locomotive undercarriages match route tangents despite scaled body geometry")
		_check(bogie.global_basis.get_scale().is_equal_approx(Vector3.ONE),"Route-sampled bogies retain circular wheels rather than inheriting body stretch")
	world.sync_snapshot(fixture);world.advance(.3)
	_check(first_instance==world.models["CAR-9001"].get_instance_id(),"Repeated snapshots reuse keyed cars")
	var camera:=Camera3D.new();root.add_child(camera);camera.position=Vector3(80,12,23);camera.look_at(Vector3(80,1.15,5));camera.current=true
	await process_frame
	_check(world.pick_screen(camera,camera.unproject_position(Vector3(80,1.18,5)))=="CAR-9001","Clicking a car selects that stable car rather than the train")
	_check(world.pick_ground(Vector3(61.1,0,8.2))=="CAR-9002","Ground picking locates an individual car")
	_check(world.entity_position("CAR-9002").distance_to(Vector3(61.1,0,8.2))<.001,"Locate a car uses its actual position")
	second.x=65.0;second.z=9.0;second.yaw=-.1
	second.bogies=[_pose(59.7,8,-.25),_pose(70.3,10,.05)]
	carrier.cargo[0].x=65.0;carrier.cargo[0].z=9.0;carrier.cargo[0].yaw=-.1
	world.sync_snapshot(fixture);world.advance(world.span*.5)
	var cargo:Node3D=world.models["PO-9001/freight/LOT-1"]
	var car_model:Node3D=world.models["CAR-9002"]
	_check(Vector2(cargo.position.x,cargo.position.z).distance_to(Vector2(car_model.position.x,car_model.position.z))<.001,"Cargo remains supported by its own smoothly interpolated car")
	_check(absf(cargo.position.y-1.3)<.001,"Freight remains on the deck during a turn")
	var intermediate:Dictionary=world.records["CAR-9002"].current
	for index in range(2):
		var expected:Dictionary=intermediate.bogies[index]
		_check(car_model.get_node("RailBogie"+str(index)).global_position.distance_to(Vector3(expected.x,0,expected.z))<.001,"Bogie route samples interpolate smoothly between snapshots")
	carrier.locomotive=null;carrier.cargo=[]
	world.sync_snapshot(fixture);world.advance(.3)
	_check(not world.models.has("PO-9001"),"Departed supplier engine disappears independently from retained cars")
	_check(world.models.has("CAR-9001") and world.models.has("CAR-9002"),"Detached loaded or empty cars remain in the receiving track")
	_check(not world.models.has("PO-9001/freight/LOT-1"),"Only physically removed cargo disappears")
	fixture.render.carriers=[];world.sync_snapshot(fixture);world.advance(.3)
	_check(world.models.is_empty(),"Final collected consist leaves no stale car or bogie model")
	camera.queue_free()
	print("FREIGHT_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
