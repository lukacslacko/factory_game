extends SceneTree
const Electrical=preload("res://scripts/electrical_models.gd")
const World=preload("res://scripts/game_world.gd")
const Models=preload("res://scripts/game_models.gd")
const Process=preload("res://scripts/process_models.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _run()->void:
	var scene:=Node3D.new();root.add_child(scene)
	var cuts:Array=[{"x":30,"z":30.2,"w":1,"d":.6,"depth":.6}]
	var mesh:ArrayMesh=Electrical.terrain_mesh(cuts)
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var normals:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_NORMAL]
	_check(normals[0].y>.99,"Excavatable terrain normals face up")
	_check((mesh.surface_get_arrays(0)[Mesh.ARRAY_TANGENT] as PackedFloat32Array).size()>0,"Terrain retains tangent basis for existing photographic normal maps")
	var covered:bool=false
	for index:int in range(0,vertices.size(),3):
		var center:Vector3=(vertices[index]+vertices[index+1]+vertices[index+2])/3.
		if center.x>30 and center.x<31 and center.z>30.2 and center.z<30.8:covered=true
	_check(not covered,"Native ground genuinely removes triangles under the trench")
	_check(mesh.get_aabb().position.is_equal_approx(Vector3(-310,0,-195)) and is_equal_approx(mesh.get_aabb().size.x,760) and is_equal_approx(mesh.get_aabb().size.z,500),"Terrain extent stays aligned to the original yard")
	var cell:Dictionary={"id":"ELE-1/cell/0","runId":"ELE-1","x":30,"z":30,"depth":.6,"cuts":cuts,"spoilRect":{"x":30,"z":31,"w":1,"d":2},"spoilM3":.36,"cableInstalled":true,"cableSegments":[{"a":{"x":30,"z":30.5},"b":{"x":31,"z":30.5}}]}
	var trench:Node3D=Electrical.trench(scene,cell,cuts)
	_check(float(trench.get_meta("depth_m"))==.6,"Trench below-grade depth comes from physical excavation")
	var below:bool=false
	for child:Node in trench.get_children():
		if child is MeshInstance3D and child.position.y<-.5:below=true
	_check(below,"Open trench has a real floor below ground")
	var spoil:Node3D=Electrical.spoil(scene,cell)
	_check(is_equal_approx(float(spoil.get_meta("soil_m3")),.36),"Spoil model retains conserved excavated cubic meters")
	var soil_vertices:PackedVector3Array=(spoil.get_child(0) as MeshInstance3D).mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var soil_volume:float=0.
	for index:int in range(0,soil_vertices.size(),3):
		var a:Vector3=soil_vertices[index];var b:Vector3=soil_vertices[index+1];var c:Vector3=soil_vertices[index+2]
		soil_volume+=absf((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))*.5*(a.y+b.y+c.y)/3.
	_check(absf(soil_volume-.36)<.00001,"Rough spoil triangle mesh has the exact conserved volume")
	_check(soil_vertices.size()>100,"Soil mound uses deterministic clod detail instead of a perfect pyramid")
	var reel:Node3D=Models.stock(scene,"cableReel",1,1,17)
	var empty:Node3D=Models.stock(scene,"cableReel",1,1,0)
	_check(float(reel.get_meta("cable_meters"))==17 and float(empty.get_meta("cable_meters"))==0,"Partial and empty reels render actual remaining cable")
	_check(reel.get_child_count()>empty.get_child_count(),"Empty wooden reel remains while wound cable disappears")
	var cabinet:Node3D=Models.building(scene,{"id":"BLD-1","kind":"power","energized":false})
	_check(float(cabinet.get_meta("capacity_kw"))==16 and not cabinet.get_node("SupplyIndicator").visible,"Modest incoming cabinet shows actual 16 kW supply state")
	Electrical.update_station(cabinet,{"energized":true});_check(cabinet.get_node("SupplyIndicator").visible,"Incoming service indicator follows energized network state")
	var pump:Node3D=Process.building(scene,{"id":"BLD-2","kind":"transferPump","x":40,"z":30,"w":2,"d":2})
	_check(pump.has_node("manifold/ElectricalIsolator"),"Pump includes its real closed isolator and conduit")
	Process.update(pump,{"powered":false,"flow":5})
	_check(not pump.get_node("manifold/RunningLamp").visible and not pump.get_node("manifold/ElectricalIsolator/PoweredIndicator").visible,"Unpowered pump never displays operation from flow alone")
	Process.update(pump,{"powered":true,"flow":5})
	_check(pump.get_node("manifold/RunningLamp").visible and pump.get_node("manifold/ElectricalIsolator/PoweredIndicator").visible,"Pump actual powered/operating states drive separate indicators")
	var world:=World.new();scene.add_child(world);world.setup()
	var snapshot:Dictionary={"state":{"buildings":[],"stacks":[],"paving":{},"groundWear":{"30,30":2},"jobs":[],"workers":[],"equipment":[],"rails":[],"zones":[]},"render":{"electrical":{"cuts":cuts,"trenches":[cell],"restored":[],"runs":[{"id":"ELE-1","jobId":"JOB-1","targetId":"BLD-2","points":[{"x":30.5,"z":30.5},{"x":31.5,"z":30.5}]}]}}}
	world.sync_snapshot(snapshot)
	_check(world.wear_node.multimesh.instance_count==0,"Worn-path decals cannot float across an excavated hole")
	_check(world.pick_ground(Vector3(30.5,0,30.5))=="ELE-1","Open trench cell inspects its real electrical run")
	var stable:Node3D=world.electrical_nodes[cell.id];var ground_mesh:Mesh=world.terrain.mesh
	world.sync_snapshot(snapshot)
	_check(world.electrical_nodes[cell.id]==stable and world.terrain.mesh==ground_mesh,"Unchanged snapshots preserve trench models and terrain mesh")
	_check(world.intent_node.get_child_count()==0,"Buried route never glows without selection")
	world.set_selected("ELE-1");_check(world.intent_node.get_child_count()>0,"Selected underground circuit has an optional route trace")
	snapshot.render.electrical.trenches=[];snapshot.render.electrical.cuts=[];snapshot.render.electrical.restored=[{"id":"ELE-1/restored/0","runId":"ELE-1","x":30,"z":30,"paved":false,"marker":true}]
	world.sync_snapshot(snapshot)
	_check(not world.electrical_nodes.has(cell.id) and world.electrical_nodes.has("ELE-1/restored/0"),"Backfilled route restores actual ground and leaves a discreet marker")
	_check(world.wear_node.multimesh.instance_count==1,"Backfilled ground can display its real existing equipment wear again")
	scene.queue_free();await process_frame
	print("ELECTRICAL_RENDERER_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
