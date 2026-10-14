extends SceneTree

const W=preload("res://scripts/game_world.gd")
var checks:int=0
var failures:Array[String]=[]

func _initialize()->void:_run.call_deferred()

func _check(ok:bool,label:String)->void:
	checks+=1
	if not ok:failures.append(label)

func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state["groundWear"]={}
	fixture.state["vegetationLastDisturbed"]={}
	fixture.state["elapsed"]=0.0
	var world:=W.new();root.add_child(world);world.setup();world.sync_snapshot(fixture)
	var stage_counts:Dictionary={"grass":0,"weed":0,"bush":0}
	for patch:Dictionary in world.plants:
		if stage_counts.has(str(patch.stage)):stage_counts[str(patch.stage)]+=patch.transforms.size()
	_check(stage_counts.grass>8000 and stage_counts.weed>500 and stage_counts.bush>300,"The opening yard has layered, patchy ground cover")
	var bush:Dictionary={};var index:int=-1
	for patch:Dictionary in world.plants:
		if str(patch.stage)!="bush":continue
		for i:int in range(patch.transforms.size()):
			var t:Transform3D=patch.transforms[i]
			if t.origin.x>35 and t.origin.x<130 and t.origin.z>35 and t.origin.z<110 and t.basis.get_scale().x>.1:
				bush=patch;index=i;break
		if index>=0:break
	_check(index>=0,"Found an initially mature bush on open dirt")
	if index<0:
		print("VEGETATION_REGROWTH ",JSON.stringify({"passed":false,"checks":checks,"failures":failures}))
		quit(1);return
	var original:Transform3D=bush.transforms[index]
	var cell:=str(int(floor(original.origin.x)))+","+str(int(floor(original.origin.z)))
	fixture.state.vegetationLastDisturbed[cell]=0.0
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	_check(world.vegetation_last_impacted_count>0 and world.vegetation_last_impacted_count<stage_counts.grass/4,"Disturbing one cell updates nearby plants without rescanning the full meadow")
	_check(world._plant_growth("bush",0.0,0.0,0.0)<.001,"Traffic immediately removes bush foliage")
	_check(world._plant_growth("weed",0.0,0.0,0.0)<.001 and world._plant_growth("grass",0.0,0.0,.05)>.9,"Weeds clear while grass survives a first pass")
	fixture.state.elapsed=12.0*3600.0
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	var growing:float=world._plant_growth("bush",12.0*3600.0,0.0,0.0)
	_check(growing>0 and growing<1,"Bush grows gradually at the same spot")
	fixture.state.elapsed=18.0*3600.0
	fixture.state.vegetationLastDisturbed.clear()
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	var mature:Transform3D=bush.transforms[index]
	_check(mature.origin==original.origin and mature.basis.is_equal_approx(original.basis) and world._plant_growth("bush",18.0*3600.0,-1.0,0.0)==1.0,"Fully recovered bush retains its original location and size")
	fixture.state.groundWear[cell]=1.0
	world.wear_last_update_ms=0;world.sync_snapshot(fixture)
	var ix:=int(floor(original.origin.x))+50;var iz:=int(floor(original.origin.z))+40
	_check(world.cover_image.get_pixel(ix,iz).r<.2,"Wheel rut visibly thins ground grass")
	fixture.state.groundWear.clear()
	world.wear_last_update_ms=0;world.sync_snapshot(fixture)
	_check(world.cover_image.get_pixel(ix,iz).r>.99,"Recovered ground restores grass without moving plants")
	fixture.state.paving[cell]=true
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	_check(bool(world.vegetation_cells_previous.get(cell,[])[0]) and world.vegetation_last_impacted_count>0,"A new slab masks only vegetation around its cell")
	fixture.state.paving.erase(cell)
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	_check(not world.vegetation_cells_previous.has(cell) and world.vegetation_last_impacted_count>0,"Removing a slab reveals vegetation at its original location")
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	_check(world.vegetation_last_impacted_count==0,"An unchanged yard does not rescan vegetation")
	fixture.state.elapsed=20.0;fixture.state.groundWear[cell]=1.0
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	fixture.state.elapsed=0.0;fixture.state.groundWear.clear()
	world.vegetation_last_update_ms=0;world.sync_snapshot(fixture)
	_check(not world.vegetation_cells_previous.has(cell) and world.vegetation_last_impacted_count>0,"Loading an earlier save restores plants from removed wear cells")
	world.queue_free();await process_frame
	print("VEGETATION_REGROWTH ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
