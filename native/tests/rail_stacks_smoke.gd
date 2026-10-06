extends SceneTree
## Actual batched rail-stack geometry, physical delivery poses, and inspector data.
## Headless: no GPU, service, browser, or live saved yard is required.
const Models=preload("res://scripts/game_models.gd")
const World=preload("res://scripts/game_world.gd")
const UI=preload("res://scripts/game_ui.gd")
const RAIL_ITEMS: Array[String]=["rail","railCurve","railPoints","railFrog","railClosure","railExit"]
var failures: Array[String]=[]
var checks: int=0
func _initialize()->void:_run.call_deferred()
func _check(condition: bool,message: String)->void:
	checks+=1
	if not condition:failures.append(message)
func _vertices(node: Node,transform: Transform3D,points: Array[Vector3])->void:
	var pose: Transform3D=transform*node.transform if node is Node3D else transform
	if node is MeshInstance3D:
		for surface in range(node.mesh.get_surface_count()):
			for vertex: Vector3 in node.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]:points.append(pose*vertex)
	for child in node.get_children():_vertices(child,pose,points)
func _bounds(node: Node3D)->AABB:
	var points: Array[Vector3]=[]
	_vertices(node,Transform3D.IDENTITY,points)
	var result:=AABB(points[0],Vector3.ZERO)
	for point in points:result=result.expand(point)
	return result
func _global_bounds(node: Node3D)->AABB:
	var points: Array[Vector3]=[]
	_vertices(node,node.get_parent().global_transform,points)
	var result:=AABB(points[0],Vector3.ZERO)
	for point in points:result=result.expand(point)
	return result
func _overlap(a: AABB,b: AABB)->float:return minf(a.end.y,b.end.y)-maxf(a.position.y,b.position.y)
func _fork_pose(height: float)->Dictionary:
	return {"id":"EQ-9000","kind":"forklift","x":20.0,"z":20.0,"y":0.105,"yaw":0.0,"operator":"WRK-9000","forkSupportY":height,"toolLift":height-.105,"reach":2.45}
func _detail(ui: CanvasLayer,key: String)->String:
	for row in ui.inspector_body.get_children():
		if row is HBoxContainer and row.get_child_count()==2 and row.get_child(0) is Label:
			if row.get_child(0).text==key:return row.get_child(1).text
	return ""
func _run()->void:
	var container:=Node3D.new();root.add_child(container)
	for item in RAIL_ITEMS:
		var single_bounds: AABB
		for quantity in [1,4,8]:
			var model: Node3D=Models.stock(container,item,quantity)
			var box:=_bounds(model)
			if quantity==1:single_bounds=box
			_check(box.position.y>=-0.0001,item+" spacers and sleepers stay above their support surface")
			_check(absf(box.end.y-(0.325+(quantity-1)*0.36))<0.0001,item+" has the expected supported height at quantity "+str(quantity))
			_check(absf(box.size.x-single_bounds.size.x)<0.0001 and absf(box.size.z-single_bounds.size.z)<0.0001,item+" adds vertical layers without spreading beyond its footprint")
			_check(box.end.y<3.0,item+" eight-layer stack remains below 3 m")
			model.free()
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.stacks=[];fixture.state.paving={}
	var cars: Array[Dictionary]=[]
	var cargo: Array[Dictionary]=[]
	var materials: Dictionary={}
	for index in range(RAIL_ITEMS.size()):
		var item:=RAIL_ITEMS[index]
		var x:=30.0+index*10.0
		fixture.state.stacks.append({"id":"STK-"+str(9000+index),"item":item,"qty":8,"reserved":0,"x":x,"z":24.0,"w":5 if item=="rail" else 6,"d":3,"source":"PO-9000","trackHand":-1 if index%2 else 1})
		if index%2:fixture.state.paving[str(int(x))+",24"]=true
		var car_id: String="CAR-"+str(9000+index)
		var car_x:=80.0+index*20.0
		cars.append({"id":car_id,"x":car_x,"z":5.0,"y":0.0,"yaw":0.0,"length":16.8})
		cargo.append({"id":"LOT-"+str(9000+index),"item":item,"qty":8,"carId":car_id,"x":car_x,"z":5.0,"y":1.3,"yaw":0.0,"hand":-1 if index%2 else 1})
		materials[item]={"name":item,"mass":1750 if item=="railPoints" else 1520,"max":8}
	fixture.render.carriers=[{"id":"PO-9000","kind":"rail","locomotive":null,"cars":cars,"cargo":cargo}]
	fixture.catalog={"materials":materials}
	var world:=World.new();root.add_child(world);world.setup();world.sync_snapshot(fixture);world.advance(.4)
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.update_snapshot(fixture)
	for index in range(RAIL_ITEMS.size()):
		var item:=RAIL_ITEMS[index]
		var stock_id: String="STK-"+str(9000+index)
		var stock: Node3D=world.statics[stock_id]
		var stock_bounds:=_bounds(stock)
		var surface: float=0.105 if index%2 else 0.0
		_check(absf(stock.position.y-surface)<0.0001,item+" is supported by its actual dirt or concrete surface")
		_check(absf(stock_bounds.end.y-surface-2.845)<0.0001,item+" ground stack exposes all eight layers")
		var load: Node3D=world.models["PO-9000/freight/LOT-"+str(9000+index)]
		_check(absf(load.position.y-1.3)<0.0001,item+" delivery stack sits on its flatcar deck")
		_check(absf(_bounds(load).end.y-4.145)<0.0001,item+" deck cargo retains all eight layers above its support")
		ui.show_entity(stock_id)
		_check(_detail(ui,"Quantity")=="8 / 8 per stack",item+" inspector exposes quantity and capacity")
		_check(_detail(ui,"Stack height")=="2.85 m",item+" inspector shows physical height, excluding paving or deck height")
		_check(_detail(ui,"Mass")!="",item+" inspector retains its total mass")
	# Catalog snapshots are authoritative rather than a second hardcoded UI limit.
	fixture.catalog.materials.railPoints.max=6
	fixture.state.stacks[2].qty=3
	ui.update_snapshot(fixture);ui.show_entity("STK-9002")
	_check(_detail(ui,"Quantity")=="3 / 6 per stack","Inspector reads the current runtime catalog capacity")
	_check(_detail(ui,"Stack height")=="1.04 m","Partially filled stack height follows actual remaining quantity")
	# Exercise the real snapshot interpolator through a high flatcar pickup,
	# its clearance lift, a low carry, and the last panel atop a full stock stack.
	fixture.render.actors=[_fork_pose(.225)]
	world.sync_snapshot(fixture);world.advance(.4)
	var forklift: Node3D=world.models["EQ-9000"]
	var intermediate: Node3D=forklift.get_node("TelescopicMast")
	var inner: Node3D=intermediate.get_node("InnerMast")
	var previous_lift: float=.225
	for target_height in [3.82,4.24,.65,2.64,.225]:
		fixture.render.actors=[_fork_pose(target_height)]
		world.sync_snapshot(fixture);world.span=.2
		for frame in range(100):
			world.advance(.002)
			var current: Dictionary=world.records["EQ-9000"].current
			var support_height: float=float(current.forkSupportY)
			var displayed_forks: float=(forklift.get_node("Carriage") as Node3D).global_position.y+.3125
			_check(absf(displayed_forks-support_height)<.0001,"Fork tips and heels retain the actual interpolated load support height")
			_check(absf(support_height-previous_lift)<.1,"High-stack lift interpolation remains smooth")
			previous_lift=support_height
			for side in ["L","R"]:
				var first:=_global_bounds(intermediate.get_node("Channel"+side))
				var second:=_global_bounds(inner.get_node("Channel"+side))
				var fixed:=AABB(Vector3(0,.25+forklift.global_position.y,0),Vector3(0,2.24,0))
				_check(_overlap(fixed,first)>.4,"Intermediate mast retains mechanical overlap with its fixed upright")
				_check(_overlap(first,second)>.4,"Inner mast retains mechanical overlap throughout the high lift")
			var slider:=_global_bounds(forklift.get_node("MastSlider"))
			var guide:=_global_bounds(inner.get_node("ChannelL"))
			_check(_overlap(slider,guide)>.6 and slider.end.y<=guide.end.y+.01,"Carriage slider and reach linkage stay supported along the inner guide")
		_check(absf(previous_lift-target_height)<.0001,"Forklift settles exactly at the requested physical pickup or placement height")
	container.free();world.free();ui.free()
	print("RAIL_STACKS_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
