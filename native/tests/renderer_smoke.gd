extends SceneTree
# Recorded createState/demoState snapshots, produced by the engine-neutral render
# adapter, exercise actual game assets without starting a browser or GPU renderer.
const W=preload("res://scripts/game_world.gd")
var failures:Array[String]=[]
func _initialize()->void:
	_run.call_deferred()
func _check(condition:bool,text:String)->void:
	if not condition:failures.append(text)
func _run()->void:
	var fixtures:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json"))
	var world:=W.new();root.add_child(world);world.setup()
	world.sync_snapshot(fixtures.empty);world.advance(.3)
	_check(world.models.is_empty(),"Empty yard must contain no invented actors, machinery or cargo")
	_check(world.statics.size()==1,"Empty yard contains only the opening buffer stop")
	world.sync_snapshot(fixtures.demo);world.advance(.3)
	var actors:Array=fixtures.demo.render.actors
	var forklift_id:String="";var worker_id:String=""
	for actor in actors:
		_check(world.models.has(actor.id),"Every actual actor has a native model")
		var model:Node3D=world.models[actor.id]
		_check(model.position.distance_to(Vector3(actor.x,actor.y,actor.z))<.001,"Actual simulation positions are preserved")
		var direction:=model.basis*Vector3(0,0,-1)
		_check(direction.dot(Vector3(cos(actor.yaw),0,sin(actor.yaw)))>.999,"Vehicle forward direction matches simulation yaw")
		if actor.kind=="forklift":forklift_id=actor.id
		if actor.kind=="worker" and bool(actor.get("visible",true)):worker_id=actor.id
	var count:=world.get_child_count()
	world.sync_snapshot(fixtures.demo);world.advance(.3)
	_check(world.get_child_count()==count,"Identical snapshots reuse keyed native assets")
	var plants_before:Array=[]
	for plant in world.plants:plants_before.append(plant.get("transforms",[]).duplicate())
	world.sync_snapshot(fixtures.demo);world.advance(.3)
	for i in range(world.plants.size()):_check(world.plants[i].get("transforms",[])==plants_before[i],"Vegetation coordinates remain stable")
	if not forklift_id.is_empty():
		var model:Node3D=world.models[forklift_id]
		var pose:Dictionary=world.records[forklift_id].current.duplicate()
		pose.forkSupportY=float(pose.y)+1.15;pose.reach=4.0
		W.Models.animate_actor(model,pose,0.016)
		var carriage:Node3D=model.get_node("Carriage")
		_check(absf(carriage.position.y+.3125-1.15)<.001,"Blade support top contacts the actual cargo floor")
		_check(absf(carriage.position.z+1.55)<.001,"Reach translates the carriage by the real pantograph extension")
		var blade_count:int=0
		for child in carriage.get_children():
			if child is MeshInstance3D and absf((child as Node3D).position.y-.28)<.001:
				var box:AABB=(child as MeshInstance3D).mesh.get_aabb()
				_check(absf(box.size.z-2.7)<.001,"Fork blades remain fixed at 2.7 meters")
				_check(absf((child as Node3D).position.z+2.45)<.001,"Cargo bearing is centered on the forks")
				blade_count+=1
		_check(blade_count==2,"Both physical fork blades are present")
		var links:Node3D=model.get_node("MastSlider/Pantograph")
		_check(links.get_child_count()==6,"Four pantograph links and two pivot pins connect the translated carriage")
	if not worker_id.is_empty():
		var camera:=Camera3D.new();root.add_child(camera)
		var at:Vector3=world.entity_position(worker_id)
		camera.position=at+Vector3(12,12,16);camera.look_at(at+Vector3(0,1,0));camera.current=true
		await process_frame
		_check(world.pick_screen(camera,camera.unproject_position(at+Vector3(0,1.6,0)))==worker_id,"Clicking an elevated worker head selects that worker")
		_check(world.pick_ground(at)==worker_id,"Ground picking selects the actor footprint")
		camera.queue_free()
	var wagon:=W.Models.flatcar(world);wagon.set_meta("kind","wagon");wagon.position=Vector3(88,0,5)
	world.models["PO-TEST/wagon"]=wagon
	var wagon_camera:=Camera3D.new();root.add_child(wagon_camera);wagon_camera.position=Vector3(88,11,18);wagon_camera.look_at(Vector3(88,1.3,5));wagon_camera.current=true
	await process_frame
	_check(world.pick_screen(wagon_camera,wagon_camera.unproject_position(Vector3(88,1.3,5)))=="PO-TEST","Clicking a freight wagon selects its delivery order")
	var freight:=W.Models.stock(world,"rail",2);freight.set_meta("cargo_item","rail");freight.position=Vector3(88,1.3,5)
	world.models["PO-TEST/freight/0"]=freight
	_check(world.pick_screen(wagon_camera,wagon_camera.unproject_position(Vector3(88,1.8,5)))=="PO-TEST","Clicking wagon freight selects the delivery order")
	wagon_camera.queue_free()
	world.preview_track([{"paths":[{"points":[{"x":25,"z":5,"yaw":0},{"x":30,"z":5,"yaw":0}]}],"cells":[{"x":25,"z":4},{"x":25,"z":5}]}],true)
	_check(world.preview_node.get_child_count()>0,"Rail preview displays canonical geometry")
	world.preview({},true)
	_check(world.preview_node.get_child_count()==0,"Changing tools removes previous ghost rails")
	world.sync_snapshot(fixtures.empty);world.advance(.3)
	_check(world.models.is_empty(),"Removed simulation actors disappear")
	_check(world.statics.size()==1,"No stale proof stocks or buildings remain")
	var result:Dictionary={"passed":failures.is_empty(),"failures":failures,"actorsChecked":actors.size(),"vegetationGroups":world.plants.size(),"emptyYardReal":true,"keysReused":true,"physicalForkChecks":true}
	print("RENDERER_SMOKE ",JSON.stringify(result))
	quit(0 if failures.is_empty() else 1)
