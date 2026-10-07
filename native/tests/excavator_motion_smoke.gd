extends SceneTree
const Models=preload("res://scripts/game_models.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _metal_bottom(node:Node3D,model:Node3D)->float:
	var bottom:float=INF
	if node is MeshInstance3D and node.name!="ActualExcavatedSoil":
		var mesh:Mesh=(node as MeshInstance3D).mesh
		for surface:int in mesh.get_surface_count():
			var vertices:PackedVector3Array=mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
			for vertex:Vector3 in vertices:bottom=minf(bottom,model.to_local(node.to_global(vertex)).y)
	for child:Node in node.get_children():
		if child is Node3D:bottom=minf(bottom,_metal_bottom(child,model))
	return bottom
func _run()->void:
	var scene:=Node3D.new();root.add_child(scene)
	var model:Node3D=Models.actor(scene,"excavator",{})
	model.set_meta("kind","excavator");model.position=Vector3(28,0,30);model.rotation.y=.83
	var bucket:Node3D=model.get_node("Upper/ArmRig/Boom/Stick/Bucket")
	_check(bucket.get_child(0).mesh.get_aabb().size.x<.6,"Trenching bucket fits the actual0.6m trench")
	# Measure rendered metal, rather than merely repeating the inverse-kinematics formula.
	for reach:float in [3.5,4.5,5.5,6.5]:
		for lift:float in [-.6,-.4,.25,1.1]:
			for pitch:float in [-.6,.1,.55]:
				Models.animate_actor(model,{"lift":lift,"reach":reach,"bucketPitch":pitch,"bucketBottomReference":true,"soilInBucketM3":.12},0)
				model.force_update_transform();bucket.force_update_transform()
				var lip:Vector3=model.to_local(bucket.to_global(Vector3(0,-.55,-.81)))
				_check(Vector2(lip.x,lip.z).distance_to(Vector2(0,-reach))<.001,"Cutting lip reaches accepted target %.1fm at bottom %.2fm/curl %.2f"%[reach,lift,pitch])
				var bottom:float=_metal_bottom(bucket,model)
				_check(bottom>=lift-.001 and bottom<lift+.01,"Actual beveled metal bottom follows conservative accepted core height %.2fm (actual %.4f)"%[lift,bottom])
				if lift>1:_check(bottom>.54,"Loaded swing clears the complete spoil mound")
				_check(is_equal_approx(float(bucket.get_node("ActualExcavatedSoil").get_meta("soil_m3")),.12),"Lift/swing/curl retain actual conserved soil")
	# Empty bucket stows above the chassis before retracting to its compact
	# transport reach; unlike a work pose this must clear the unequal-link fold.
	for reach:float in [1.8,2.1,2.5]:
		for pitch:float in [-.6,.1,.55]:
			Models.animate_actor(model,{"lift":1.6,"reach":reach,"bucketPitch":pitch,"bucketBottomReference":true},0)
			var lip:Vector3=model.to_local(bucket.to_global(Vector3(0,-.55,-.81)))
			_check(Vector2(lip.x,lip.z).distance_to(Vector2(0,-reach))<.001,"Raised compact stow remains physically reachable")
			_check(_metal_bottom(bucket,model)>=1.599 and _metal_bottom(bucket,model)<1.61,"Raised compact stow retains actual bucket bottom clearance")
	Models.animate_actor(model,{"lift":1.1,"reach":6.5,"bucketPitch":-.6,"bucketBottomReference":true,"soilInBucketM3":0},0)
	_check(not bucket.get_node("ActualExcavatedSoil").visible,"Bucket empties only when core transfers soil")
	var before:Transform3D=bucket.global_transform
	Models.animate_actor(model,{"lift":1.1,"reach":6.5,"bucketPitch":-.6,"bucketBottomReference":true,"soilInBucketM3":0},20)
	_check(bucket.global_transform.is_equal_approx(before),"No wall-time animation advances a blocked accepted pose")
	scene.queue_free()
	if failures.is_empty():print("EXCAVATOR_MOTION_OK ",checks," checks");quit(0)
	else:
		for failure:String in failures:print("CHECK_FAILED ",failure)
		quit(1)
