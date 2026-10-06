extends Node3D
const G=preload("res://scripts/geometry.gd")
const Ground=preload("res://scripts/ground.gd")
const R=preload("res://scripts/rail_yard.gd")
const Models=preload("res://scripts/game_models.gd")
var state:Dictionary={}
var render:Dictionary={}
var models:Dictionary={}
var records:Dictionary={}
var statics:Dictionary={}
var static_keys:Dictionary={}
var plants:Array[Dictionary]=[]
var soil:ShaderMaterial
var paving:MultiMeshInstance3D
var paving_key:String=""
var selected:String=""
var grid:bool=true
var dusk:bool=false
var age:float=0.0
var span:float=.2
var last_snapshot:int=0
var preview_node:Node3D
var selection_node:Node3D
var intent_node:Node3D
var masking_key:String=""
var wear_key:String=""
var wear_node:MultiMeshInstance3D
var initialized:bool=false
var vegetation_cleared:Dictionary={}

func setup()->void:
	if initialized:return
	initialized=true
	name="ActualSimulationYard"
	soil=Ground._surface(0,"9a855f","c1ad87")
	var terrain:=MeshInstance3D.new(); var plane:=PlaneMesh.new(); plane.size=Vector2(760,500)
	terrain.mesh=plane; terrain.material_override=soil; terrain.position=Vector3(70,0,55)
	terrain.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; add_child(terrain)
	_corridor()
	_vegetation()
	paving=MultiMeshInstance3D.new(); paving.name="PurchasedAndInstalledPaving"
	var mm:=MultiMesh.new(); mm.transform_format=MultiMesh.TRANSFORM_3D; mm.use_colors=true
	var slab:=BoxMesh.new(); slab.size=Vector3(.992,.105,.992); mm.mesh=slab
	paving.multimesh=mm; paving.material_override=Ground._surface(1,"a8a18b","c1b99f"); add_child(paving)
	wear_node=MultiMeshInstance3D.new(); wear_node.name="ActualEquipmentWear"; add_child(wear_node)
	preview_node=Node3D.new(); preview_node.name="PlacementPreview"; add_child(preview_node)
	selection_node=Node3D.new(); selection_node.name="Selection"; add_child(selection_node)
	intent_node=Node3D.new(); intent_node.name="SelectedEquipmentIntent"; add_child(intent_node)
	set_grid(grid)

func sync_snapshot(message:Dictionary)->void:
	if not initialized:setup()
	var incoming:Dictionary=message.get("state",{})
	if float(incoming.get("elapsed",0))<float(state.get("elapsed",0)) or int(incoming.get("next",0))<int(state.get("next",0)):vegetation_cleared.clear();masking_key=""
	state=incoming
	render=message.get("render",{})
	var now:=Time.get_ticks_msec()
	if last_snapshot:span=clampf(float(now-last_snapshot)/1000.0,.03,.4)
	last_snapshot=now; age=0.0
	var live:Dictionary={}
	var actors:Array=render.get("actors",[])
	if actors.is_empty():
		for worker in state.get("workers",[]):
			var p:Dictionary=worker.duplicate(); p["kind"]="worker"; actors.append(p)
		for machine in state.get("equipment",[]): actors.append(machine)
	for data in actors:
		var id:=str(data.get("id","")); var kind:=str(data.get("kind","worker"))
		if id.is_empty():continue
		live[id]=true
		var model:Node3D=_ensure_dynamic(id,kind,data)
		model.visible=bool(data.get("visible",true))
		_new_pose(id,data)
	for data in render.get("carriers",[]):
		var id:=str(data.id)
		if str(data.kind)=="rail":
			var locomotive=data.get("locomotive",data)
			if locomotive is Dictionary and not locomotive.is_empty():
				var engine_id:=str(locomotive.get("id",id));live[engine_id]=true
				_ensure_dynamic(engine_id,"rail",data,true).set_meta("inspect_id",str(locomotive.get("inspectId",engine_id)))
				_new_pose(engine_id,locomotive)
			if data.has("cars"):
				for car in data.cars:
					var car_id:=str(car.id);live[car_id]=true
					_ensure_wagon(car_id,float(car.get("length",16.8))-.8)
					(models[car_id] as Node3D).set_meta("inspect_id",car_id)
					_new_pose(car_id,car)
			else:
				var freight:Dictionary=data.get("freight",{})
				if not freight.is_empty():
					var wagon_id:=id+"/wagon";live[wagon_id]=true
					_ensure_wagon(wagon_id);_new_pose(wagon_id,freight)
		else:
			live[id]=true;_ensure_dynamic(id,str(data.kind),data,true);_new_pose(id,data)
		for slot in data.get("cargo",[]):
			var cargo_id:=id+"/freight/"+str(slot.get("id",slot.get("index",0)))
			if int(slot.get("qty",0))<=0:continue
			live[cargo_id]=true
			_ensure_load(cargo_id,str(slot.get("item","slab")),int(slot.get("qty",1)),int(slot.get("hand",1)))
			var pose:Dictionary=slot.duplicate()
			if slot.has("carId"):
				pose["parentRailCarId"]=str(slot.carId)
				(models[cargo_id] as Node3D).set_meta("inspect_id",str(slot.carId))
			_new_pose(cargo_id,pose)
	# Exact physical cargo and intermediate panels are supplied by the same pure simulation.
	for load in render.get("loads",[]):
		var id:=str(load.get("id","")); if id.is_empty():continue
		live[id]=true; _ensure_load(id,str(load.get("item","slab")),int(load.get("qty",1)),int(load.get("hand",1)))
		_new_pose(id,_attachment_pose(load.get("pose",load),str(load.get("parentEquipmentId","")),bool(load.get("carried",false))))
	for task in render.get("railWork",[]):
		var job:Dictionary=_entity(str(task.get("jobId","")),"jobs")
		var panel:Dictionary=task.get("panel",{})
		if not panel.is_empty() and (str(panel.get("state","stored")) in ["carried","placed"] or str(task.get("phase",""))=="configure-staged-panel"):
			var id:=str(task.jobId)+"/panel"; live[id]=true
			var qty:int=int(task.get("stagingBatch",{}).get("qty",1))
			var physical_hand:int=int(task.get("configuredHand",job.get("track",{}).get("hand",1)))
			_ensure_load(id,str(job.get("item","rail")),qty,physical_hand); _new_pose(id,_attachment_pose(panel,str(task.get("equipmentId","")),str(panel.get("state",""))=="carried"))
		var buffer:Dictionary=task.get("buffer",{})
		if not buffer.is_empty():
			var id:=str(task.jobId)+"/buffer"; live[id]=true
			if not models.has(id):
				models[id]=Models.buffer(self);(models[id] as Node3D).set_meta("cargo_item","buffer")
			(models[id] as Node3D).set_meta("inspect_id",str(buffer.get("id",job.get("bufferId","BUFFER-001"))))
			_new_pose(id,_attachment_pose(buffer,str(task.get("equipmentId","")),bool(buffer.get("carried",false))))
	for work in render.get("construction",[]):
		if str(work.get("state","stored")) in ["stored","installed"]:continue
		var id:=str(work.jobId)+"/handling"; live[id]=true
		_ensure_load(id,str(work.get("item","slab")),int(work.get("qty",1)),1,str(work.get("item",""))=="bufferStop"); _new_pose(id,_attachment_pose(work.get("pose",{}),str(work.get("equipmentId","")),str(work.get("state",""))=="carried"))
	for assembly in render.get("sheds",[]):
		for index in range(assembly.get("anchorPoses",[]).size()):
			var id:=str(assembly.jobId)+"/anchor/"+str(index);live[id]=true
			if not models.has(id):models[id]=Models.anchor(self)
			_new_pose(id,assembly.anchorPoses[index])
		var kit:Dictionary=assembly.get("kitPose",{})
		if not kit.is_empty():
			var remaining:Dictionary={"posts":maxi(0,6-int(assembly.get("posts",0))),"beams":maxi(0,3-int(assembly.get("beams",0))),"roof":maxi(0,4-int(assembly.get("roofSheets",0))),"walls":maxi(0,2-int(assembly.get("wallPanels",0))),"brace":maxi(0,1-int(assembly.get("braces",0)))}
			var id:=str(assembly.jobId)+"/kit";live[id]=true;var key:=JSON.stringify(remaining)
			if not models.has(id) or str((models[id] as Node3D).get_meta("kit_key",""))!=key:
				if models.has(id):var old:Node3D=models[id];remove_child(old);old.queue_free()
				models[id]=Models.shed_kit(self,remaining);(models[id] as Node3D).set_meta("kit_key",key)
			_new_pose(id,kit)
		var w:float=float(assembly.get("w",8)); var d:float=float(assembly.get("d",6))
		if int(assembly.get("rotation",0))%2==1:var swap:=w; w=d; d=swap
		for part in assembly.get("parts",[]):
			var id:=str(assembly.jobId)+"/assembly/"+str(part.kind)+"/"+str(part.index); live[id]=true
			if not models.has(id):models[id]=Models.shed_part(self,str(part.kind),w,d,int(part.index))
			var job:Dictionary=_entity(str(assembly.jobId),"jobs")
			(models[id] as Node3D).set_meta("cargo_item","shedPart")
			(models[id] as Node3D).set_meta("cargo_width",w*.28 if str(part.kind) in ["beam","roof","wall"] else .16)
			(models[id] as Node3D).set_meta("cargo_height",2.15 if str(part.kind)=="post" else 1.90 if str(part.kind)=="wall" else 1.95 if str(part.kind)=="brace" else .4)
			_new_pose(id,_attachment_pose(part.get("pose",{}),str(job.get("equipment","")),bool(part.get("carried",false))))
	for id in models.keys():
		if not live.has(id):
			var model:Node3D=models[id]; remove_child(model); model.queue_free(); models.erase(id); records.erase(id)
	_sync_statics()
	_sync_paving()
	_sync_wear()
	_mask_vegetation()
	_update_selection()
	set_dusk(dusk)

func _ensure_dynamic(id:String,kind:String,data:Dictionary,carrier:bool=false)->Node3D:
	if models.has(id):return models[id] as Node3D
	var model:Node3D=Models.carrier(self,kind) if carrier else Models.actor(self,kind,data)
	model.set_meta("kind",kind); model.set_meta("id",id); model.name=id.replace("/","_")
	models[id]=model
	return model

func _ensure_wagon(id:String,length:float=16.0)->void:
	if models.has(id) and is_equal_approx(float((models[id] as Node3D).get_meta("deck_length",16)),length):return
	if models.has(id):
		var old:Node3D=models[id];remove_child(old);old.queue_free()
	var wagon:=Models.flatcar(self,length,id if not "/" in id else "FLAT 014 · 40 t");wagon.set_meta("kind","wagon");wagon.set_meta("id",id)
	models[id]=wagon

func _ensure_load(id:String,item:String,qty:int,hand:int=1,buffer_contact:bool=false)->void:
	var key:=item+"/"+str(qty)+"/"+str(hand)+"/"+str(buffer_contact)
	if models.has(id) and str((models[id] as Node3D).get_meta("load_key",""))==key:return
	if models.has(id):
		var old:Node3D=models[id]; remove_child(old); old.queue_free()
	var model:=Models.buffer(self) if buffer_contact else Models.stock(self,item,qty,hand); model.set_meta("load_key",key); model.set_meta("id",id)
	model.set_meta("forward","+X");model.set_meta("cargo_item",item);model.set_meta("cargo_qty",qty); models[id]=model

func _new_pose(id:String,pose:Dictionary)->void:
	var to:Dictionary=pose.duplicate()
	if not to.has("yaw"):to["yaw"]=float(to.get("heading",0))*PI*.5
	var previous:Dictionary=records.get(id,{}).get("current",to).duplicate()
	records[id]={"from":previous,"to":to,"current":previous}
	if not (models[id] as Node3D).has_meta("posed"):
		_apply_pose(models[id],to); (models[id] as Node3D).set_meta("posed",true); records[id]["current"]=to

func advance(delta:float)->void:
	age+=delta
	var alpha:=clampf(age/span,0,1)
	for id in models:
		(models[id] as Node3D).set_meta("suspended_load",false)
		var rig:Node3D=(models[id] as Node3D).get_node_or_null("SuspensionSlings")
		if rig:rig.visible=false
	for id in records:
		var parent_id:=str(records[id].to.get("parentEquipmentId",""))
		if models.has(parent_id):(models[parent_id] as Node3D).set_meta("suspended_load",true)
	for id in records:
		if not models.has(id):continue
		var record:Dictionary=records[id]; var a:Dictionary=record.from; var b:Dictionary=record.to
		var p:Dictionary=b.duplicate()
		for field in ["x","z","y","lift","reach","travel","pitch","clock","workClock","forkSupportY","ramp"]:
			if b.has(field):p[field]=lerpf(float(a.get(field,b[field])),float(b[field]),alpha)
		p["yaw"]=lerp_angle(float(a.get("yaw",0)),float(b.get("yaw",0)),alpha)
		if b.has("bogies"):
			p["bogies"]=[]
			for index in range(b.bogies.size()):
				var target:Dictionary=b.bogies[index];var prior:Dictionary=target
				if a.get("bogies",[]).size()>index:prior=a.bogies[index]
				var bogie:Dictionary=target.duplicate()
				for field in ["x","z","y"]:bogie[field]=lerpf(float(prior.get(field,target.get(field,0))),float(target.get(field,0)),alpha)
				bogie.yaw=lerp_angle(float(prior.get("yaw",target.get("yaw",0))),float(target.get("yaw",0)),alpha)
				p.bogies.append(bogie)
		# A swivel crossing +/-PI must take the short arc, including when an
		# incoming snapshot interrupts a partially displayed turn.
		if b.has("upperYaw"):p["upperYaw"]=lerp_angle(float(a.get("upperYaw",b.upperYaw)),float(b.upperYaw),alpha)
		record.current=p
		var model:Node3D=models[id]; _apply_pose(model,p)
		if str(model.get_meta("kind","")) in ["worker","excavator","forklift"]:Models.animate_actor(model,p,delta)
		elif str(model.get_meta("kind",""))=="lowloader":Models.animate_carrier(model,p)
	for id in records:
		var record:Dictionary=records[id];var parent_id:=str(record.to.get("parentEquipmentId",record.to.get("parentRailCarId","")))
		if parent_id.is_empty() or not records.has(parent_id):continue
		var parent:Dictionary=records[parent_id];var current:Dictionary=record.current
		var local_to:=_relative_pose(record.to,parent.to);var local_from:=_relative_pose(record.from,parent.from)
		var offset:=local_from.lerp(local_to,alpha);var angle:=float(parent.current.get("yaw",0))
		current.x=float(parent.current.get("x",0))+offset.x*cos(angle)-offset.z*sin(angle)
		current.z=float(parent.current.get("z",0))+offset.x*sin(angle)+offset.z*cos(angle)
		current.y=float(parent.current.get("y",0))+offset.y
		current.yaw=float(parent.current.get("yaw",0))+lerp_angle(float(record.from.get("yaw",0))-float(parent.from.get("yaw",0)),float(record.to.get("yaw",0))-float(parent.to.get("yaw",0)),alpha)
		_apply_pose(models[id],current)
		if record.to.has("parentEquipmentId"):Models.rig_cargo(models[id],models[parent_id])
	if not selected.is_empty():_update_selection(false)

func _apply_pose(model:Node3D,p:Dictionary)->void:
	model.position=Vector3(float(p.get("x",0)),float(p.get("y",0)),float(p.get("z",0)))
	var offset:float=-PI*.5 if str(model.get_meta("forward","+X"))=="-Z" else 0.0
	model.rotation.y=-float(p.get("yaw",0))+offset
	if offset!=0.0:
		model.rotation.x=float(p.get("pitch",0));model.rotation.z=float(model.get_meta("base_roll",0))
	else:
		model.rotation.x=0.0;model.rotation.z=float(p.get("pitch",0))+float(model.get_meta("base_roll",0))
	# The undercarriages follow separate samples of the actual track. A long
	# flatcar's body spans the bogies rather than forcing both axles off a curve.
	for index in range(p.get("bogies",[]).size()):
		var bogie:Node3D=model.get_node_or_null("RailBogie"+str(index))
		if not bogie:continue
		var sample:Dictionary=p.bogies[index]
		bogie.global_transform=Transform3D(Basis(Vector3.UP,-float(sample.get("yaw",p.get("yaw",0)))),Vector3(float(sample.x),float(sample.get("y",p.get("y",0))),float(sample.z)))

func _sync_statics()->void:
	var live:Dictionary={}
	var planned_tracks:Dictionary={}
	for data in state.get("buildings",[]):
		var id:=str(data.id); live[id]=true
		var key:=JSON.stringify(data)
		if static_keys.get(id,"")!=key:
			_drop_static(id); var model:=Models.building(self,data); statics[id]=model; static_keys[id]=key
			model.position=Vector3(float(data.x)+float(data.w)*.5,_surface_height(data)+.0,float(data.z)+float(data.d)*.5)
			model.rotation.y=-float(int(data.get("rotation",0))%2)*PI*.5
	for data in state.get("stacks",[]):
		var id:=str(data.id); live[id]=true
		var hidden:bool=int(data.get("qty",0))<=0 and str(data.get("item",""))!="diesel"
		for work in render.get("construction",[]):
			if str(work.get("placedStack",""))==id and str(work.get("state",""))=="placed":hidden=true
		for work in render.get("railWork",[]):
			if str(work.get("phase",""))=="configure-staged-panel" and str(work.get("panel",{}).get("stackId",""))==id:hidden=true
		var key:=JSON.stringify([data.get("item"),data.get("qty"),data.get("trackHand"),data.get("baseHeight"),hidden])
		if static_keys.get(id,"")!=key:
			_drop_static(id)
			var model:=Models.stock(self,str(data.item),int(data.get("qty",0)),int(data.get("trackHand",1)))
			statics[id]=model; static_keys[id]=key; model.visible=not hidden
			if float(data.get("baseHeight",0))>0:
				var support:float=float(data.baseHeight); var wood:Material=Models.materials().wood
				for x in [-1.56,1.56]:
					for z in [-.82,.82]:G.beveled_box(model,Vector3(x,-support*.5,z),Vector3(.22,support,.17),wood)
		var model:Node3D=statics[id]
		model.position=Vector3(float(data.x)+float(data.w)*.5,_surface_height(data)+float(data.get("baseHeight",0)),float(data.z)+float(data.d)*.5)
		model.rotation.y=-float(data.get("yaw",0))
	for entry in render.get("railGeometry",[]):
		var id:=str(entry.id)
		if bool(entry.get("planned",false)):
			planned_tracks[id]=entry.geometry
			continue
		live[id]=true
		var key:=JSON.stringify(entry.geometry)
		if static_keys.get(id,"")!=key:
			_drop_static(id); var group:=Node3D.new(); add_child(group)
			_track_paths(group,entry.geometry.get("paths",[]),false)
			statics[id]=group; static_keys[id]=key
	for zone in state.get("zones",[]):
		var id:=str(zone.id); live[id]=true; var key:=JSON.stringify(zone)
		if static_keys.get(id,"")!=key:
			_drop_static(id); var group:=Node3D.new(); add_child(group)
			_outline(group,zone,Color("82a18a"),.018)
			var label:=G.label(group,str(zone.get("name",id)),Vector3(float(zone.x)+float(zone.w)*.5,.018,float(zone.z)+float(zone.d)+.3),32,.010)
			label.rotation.x=-PI*.5; statics[id]=group; static_keys[id]=key
	for job in state.get("jobs",[]):
		if str(job.get("status","")) in ["done","canceled"]:continue
		var id:=str(job.id)+"/plan"; live[id]=true
		var geometry:Dictionary=planned_tracks.get(str(job.id),{})
		var key:=JSON.stringify([job.x,job.z,job.w,job.d,job.status,job.kind,geometry,_ghost_surface_height(geometry.get("rect",job))])
		if static_keys.get(id,"")!=key:
			_drop_static(id); var group:=Node3D.new(); add_child(group)
			group.name="PlannedConstruction";group.set_meta("ghost",true)
			var color:=Color("ffc45c") if str(job.status)=="doing" else Color("42d5ff")
			if not geometry.is_empty():_rail_ghost(group,geometry,color)
			else:_construction_ghost(group,job,color)
			statics[id]=group; static_keys[id]=key
	var moving_buffers:Dictionary={}
	for work in render.get("railWork",[]):
		var moving:Dictionary=work.get("buffer",{})
		if not moving.is_empty():
			var job:Dictionary=_entity(str(work.get("jobId","")),"jobs")
			moving_buffers[str(moving.get("id",job.get("bufferId","BUFFER-001")))]=true
	for stop in _buffer_records():
		var id:=str(stop.id)
		if moving_buffers.has(id):continue
		live[id]=true
		if not statics.has(id):statics[id]=Models.buffer(self);static_keys[id]="buffer"
		var pose:Dictionary=stop.duplicate()
		# Older saves retain only the opening stop; its temporarily parked
		# group pose remains authoritative until the next rail-work phase.
		if not state.has("buffers") and not render.has("buffers"):
			for group in state.get("jobGroups",[]):
				var shared:Dictionary=group.get("railBuffer",{}).get("pose",{})
				if not shared.is_empty() and not bool(shared.get("secured",false)):pose=shared;break
		(statics[id] as Node3D).position=Vector3(float(pose.x),float(pose.get("y",.2)),float(pose.z))
		(statics[id] as Node3D).rotation.y=-float(pose.get("yaw",0))
	for entry in render.get("railLocations",[]):
		var id:=str(entry.id); live[id]=true
		var key:=JSON.stringify(entry)
		if static_keys.get(id,"")!=key:
			_drop_static(id); var group:=Node3D.new(); add_child(group)
			var pose:Dictionary=entry.get("pose",{})
			G.label(group,str(_entity(id,"railLocations").get("name",id)),Vector3(float(pose.get("x",0)),.70,float(pose.get("z",0))+1.4),28,.012)
			_path_lines(group,entry.get("path",[]),Color("8fba96"),.10)
			statics[id]=group; static_keys[id]=key
	for id in statics.keys():
		if not live.has(id):_drop_static(id)

func _drop_static(id:String)->void:
	if statics.has(id):
		var model:Node3D=statics[id]; remove_child(model); model.queue_free(); statics.erase(id)
	static_keys.erase(id)

func _sync_paving()->void:
	var cells:Dictionary=state.get("paving",{})
	var key:=str(hash(JSON.stringify(cells)))
	if key==paving_key:return
	paving_key=key
	paving.multimesh.instance_count=cells.size()
	var index:int=0
	for cell in cells:
		var xy:=str(cell).split(","); if xy.size()!=2:continue
		var x:=float(xy[0]); var z:=float(xy[1])
		paving.multimesh.set_instance_transform(index,Transform3D(Basis.IDENTITY,Vector3(x+.5,.0525,z+.5)))
		var shade:=.96+.05*sin(x*37.19+z*19.73)
		paving.multimesh.set_instance_color(index,Color(shade,shade,shade,1)); index+=1

func _sync_wear()->void:
	var wear:Dictionary=state.get("groundWear",{})
	var key:=str(hash(JSON.stringify(wear)))
	if key==wear_key:return
	wear_key=key
	var cells:Array=[]
	for cell in wear:
		if float(wear[cell])>.15 and not state.get("paving",{}).has(cell):cells.append(cell)
	var mesh:=MultiMesh.new(); mesh.transform_format=MultiMesh.TRANSFORM_3D; mesh.use_colors=true
	var slab:=PlaneMesh.new(); slab.size=Vector2(.9,.9); mesh.mesh=slab; mesh.instance_count=cells.size()
	for i in range(cells.size()):
		var xy:=str(cells[i]).split(","); if xy.size()!=2:continue
		mesh.set_instance_transform(i,Transform3D(Basis.IDENTITY,Vector3(float(xy[0])+.5,.006,float(xy[1])+.5)))
		mesh.set_instance_color(i,Color(.67,.55,.38,clampf(float(wear[cells[i]])*.045,.03,.29)))
	var material:=StandardMaterial3D.new(); material.vertex_color_use_as_albedo=true; material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; material.roughness=1
	wear_node.multimesh=mesh; wear_node.material_override=material; wear_node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _surface_height(point:Dictionary)->float:
	return .105 if state.get("paving",{}).has(str(int(floor(float(point.get("x",0)))))+","+str(int(floor(float(point.get("z",0)))))) else 0.0

func _entity(id:String,table:String)->Dictionary:
	for entity in state.get(table,[]):
		if str(entity.get("id",""))==id:return entity
	return {}

func pick_ground(point:Vector3)->String:
	var best:String=""; var distance:float=INF
	for id in models:
		var model:Node3D=models[id]
		if not model.visible or "/" in str(id):continue
		var d:=Vector2(point.x-model.position.x,point.z-model.position.z).length()
		var radius:=1.45 if str(model.get_meta("kind",""))=="worker" else 2.4
		if d<radius and d<distance:distance=d; best=str(id)
	if not best.is_empty():return best
	for stop in _buffer_records():
		if statics.has(str(stop.id)) and Vector2(point.x-float(stop.x),point.z-float(stop.z)).length()<1.15:return str(stop.id)
	for table in ["stacks","buildings","jobs","zones"]:
		for entity in state.get(table,[]):
			if table=="jobs" and str(entity.get("status","")) in ["done","canceled"]:continue
			if Rect2(float(entity.x),float(entity.z),float(entity.get("w",1)),float(entity.get("d",1))).has_point(Vector2(point.x,point.z)):return str(entity.id)
	for entry in render.get("railGeometry",[]):
		for cell in entry.geometry.get("cells",[]):
			if Rect2(float(cell.x),float(cell.z),1,1).has_point(Vector2(point.x,point.z)):return str(entry.id)
	return ""

func entity_position(id:String)->Vector3:
	for endpoint in render.get("railOpenEndpoints",[]):
		if str(endpoint.get("id",""))==id:return Vector3(float(endpoint.x),0,float(endpoint.z))
	if models.has(id):return (models[id] as Node3D).position
	for entry in render.get("railGeometry",[]):
		if str(entry.id)==id:
			var rect:Dictionary=entry.geometry.get("rect",{})
			if not rect.is_empty():return Vector3(float(rect.x)+float(rect.w)*.5,0,float(rect.z)+float(rect.d)*.5)
			var paths:Array=entry.geometry.get("paths",[])
			if not paths.is_empty():
				var points:Array=paths[0].get("points",[])
				if not points.is_empty():var point:Dictionary=points[int(points.size()/2)];return Vector3(float(point.x),0,float(point.z))
	for entry in render.get("railLocations",[]):
		if str(entry.id)==id:return Vector3(float(entry.pose.x),0,float(entry.pose.z))
	for table in ["workers","equipment","stacks","buildings","jobs","zones","orders","jobGroups"]:
		var entity:=_entity(id,table)
		if not entity.is_empty():return Vector3(float(entity.get("x",entity.get("vehicle",{}).get("x",28)))+float(entity.get("w",0))*.5,0,float(entity.get("z",entity.get("vehicle",{}).get("z",25)))+float(entity.get("d",0))*.5)
	if statics.has(id):return (statics[id] as Node3D).position
	return Vector3(28,0,25)

func preview(rect:Dictionary,valid:bool)->void:
	_clear_children(preview_node)
	if rect.is_empty():return
	_construction_ghost(preview_node,rect,Color("54f1b2") if valid else Color("ff7168"))

func set_selected(id:String)->void:
	selected=id; _update_selection()

func set_grid(enabled:bool)->void:
	grid=enabled
	if soil:soil.set_shader_parameter("show_grid",enabled)
	if paving and paving.material_override:
		(paving.material_override as ShaderMaterial).set_shader_parameter("show_grid",enabled)

func set_dusk(enabled:bool)->void:
	dusk=enabled
	for id in statics:
		_set_lamps(statics[id])

func _set_lamps(node:Node)->void:
	if node is OmniLight3D:
		var light:OmniLight3D=node
		light.light_energy=7.5 if dusk and bool(light.get_meta("connected",false)) else 0.0
		var material:StandardMaterial3D=light.get_meta("lamp_glass",null)
		if material:material.emission_enabled=light.light_energy>0; material.emission=Color("ffe3a9"); material.emission_energy_multiplier=1.3
	for child in node.get_children():_set_lamps(child)

func _update_selection(rebuild:bool=true)->void:
	if not selection_node:return
	if rebuild:
		_clear_children(selection_node); _clear_children(intent_node)
		if selected.is_empty():return
		var rect:Dictionary={"x":-1.1,"z":-1.1,"w":2.2,"d":2.2}
		if not models.has(selected):
			for table in ["stacks","buildings","jobs","zones"]:
				var entity:=_entity(selected,table)
				if not entity.is_empty():rect={"x":0,"z":0,"w":entity.get("w",1),"d":entity.get("d",1)};break
		_outline(selection_node,rect,Color("edd68a"),.15)
		for intent in render.get("equipmentIntents",[]):
			if str(intent.id)!=selected:continue
			var route:Array=intent.get("route",[])
			if not route.is_empty():route=[{"x":entity_position(selected).x,"z":entity_position(selected).z}]+route
			if route.is_empty():
				var target:Dictionary=intent.get("target",{})
				if not target.is_empty():route=[{"x":entity_position(selected).x,"z":entity_position(selected).z},target]
			_path_lines(intent_node,route,Color("e5b95a"),.18)
			var blocker:Dictionary=intent.get("blocker",{})
			if not blocker.is_empty():_outline(intent_node,blocker.get("rect",{}),Color("df7558"),.20)
	selection_node.position=entity_position(selected)
	if not models.has(selected):
		for table in ["stacks","buildings","jobs","zones"]:
			var entity:=_entity(selected,table)
			if not entity.is_empty():selection_node.position=Vector3(float(entity.x),0,float(entity.z));break

func _clear_children(node:Node)->void:
	for child in node.get_children():node.remove_child(child); child.queue_free()

func _outline(parent:Node3D,rect:Dictionary,color:Color,y:float,dashed:bool=false)->void:
	var x:=float(rect.get("x",0)); var z:=float(rect.get("z",0)); var w:=float(rect.get("w",1)); var d:=float(rect.get("d",1))
	_path_lines(parent,[{"x":x,"z":z},{"x":x+w,"z":z},{"x":x+w,"z":z+d},{"x":x,"z":z+d},{"x":x,"z":z}],color,y,dashed)

func _path_lines(parent:Node3D,path:Array,color:Color,y:float,dashed:bool=false)->void:
	if path.size()<2:return
	var b:=R.Batch.new(); var material:=StandardMaterial3D.new(); material.albedo_color=color; material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	for i in range(path.size()-1):
		var a:=Vector3(float(path[i].get("x",0)),y,float(path[i].get("z",0))); var c:=Vector3(float(path[i+1].get("x",0)),y,float(path[i+1].get("z",0)))
		var length:=a.distance_to(c)
		if length<.001:continue
		if dashed:
			for step in range(int(ceil(length/.7))):
				var begin:=minf(length,float(step)*.7); var end:=minf(length,begin+.4)
				b.box(a.lerp(c,(begin+end)*.5/length),Vector3(end-begin,.012,.045),material,-atan2(c.z-a.z,c.x-a.x))
		else:b.box((a+c)*.5,Vector3(length,.014,.065),material,-atan2(c.z-a.z,c.x-a.x))
	b.finish(parent)

func _corridor()->void:
	var group:=Node3D.new(); group.name="ExistingPublicInfrastructure"; add_child(group)
	var asphalt:=Ground._surface(2,"4e5255","53565a"); var paint:=G.mat("d9dac5",.92)
	G.box(group,Vector3(70,.018,-13),Vector3(760,.035,8.4),asphalt)
	for z in [-17.05,-8.95]:G.box(group,Vector3(70,.041,z),Vector3(760,.004,.11),paint)
	for x in range(-290,441,6):
		if absf(x+8)>6:G.box(group,Vector3(x,.042,-13),Vector3(3,.005,.11),paint)
	G.box(group,Vector3(-8,.018,1.5),Vector3(8.4,.035,29),asphalt)
	for z in range(-8,14,6):G.box(group,Vector3(-8,.042,z),Vector3(.11,.005,2.5),paint)
	var paths:Array=[]
	paths.append({"points":[{"x":-150,"z":0},{"x":300,"z":0}]})
	var branch:Array=[]
	for i in range(101):
		var x:float=i*.25;var t:=x/25.0;branch.append({"x":x,"z":5*(3*t*t-2*t*t*t)})
	paths.append({"points":branch});paths.append({"points":[{"x":25,"z":5},{"x":125,"z":5}]})
	_track_paths(group,paths,true)

# Retained roadside asset builder; the playable corridor has no overhead
# powerline while underground electrical construction is tracked in issue #13.
func _roadside_powerline(parent:Node3D)->void:
	var steel:=G.mat("54615e",.57,.35); var wood:=G.mat("7c704b",.90)
	for x in range(-140,301,28):
		G.cylinder(parent,Vector3(x,4.1,-19.5),.13,8.2,wood,12)
		G.box(parent,Vector3(x,7.65,-19.5),Vector3(.18,.17,2.1),steel)
		for z in [-20.25,-19.5,-18.75]:
			G.cylinder(parent,Vector3(x,7.85,z),.06,.20,G.mat("c9d1c6",.38),12)
			if x<272:
				var previous:=Vector3(x,7.97,z)
				for step in range(1,9):
					var t:float=step/8.0;var next:=Vector3(x+t*28,7.97-.58*sin(t*PI),z)
					G.rod(parent,previous,next,.012,steel,6);previous=next

func _track_paths(parent:Node3D,paths:Array,ballast:bool)->void:
	var b:=R.Batch.new(); var m:=Models.materials(); var rail:Array=[G.mat("dbddd5",.18,.88),G.mat("955532",.82,.26),m.steel]
	var gravel:=R._ballast_material()
	for path in paths:
		var points:Array=path.get("points",[])
		if points.size()<2:continue
		var distance:float=0;var next_tie:float=.25
		for i in range(points.size()-1):
			var a:=Vector3(float(points[i].x),0,float(points[i].z));var c:=Vector3(float(points[i+1].x),0,float(points[i+1].z))
			var delta:=c-a;var length:=delta.length();if length<.001:continue
			var normal:=Vector3(-delta.z,0,delta.x).normalized();var yaw:float=-atan2(delta.z,delta.x)
			if ballast:b.ballast((a+c)*.5+Vector3(0,-.01,0),length+.012,gravel,yaw)
			for side in [-1,1]:R._rail_segment(b,a+normal*.7525*side+Vector3(0,-.125,0),c+normal*.7525*side+Vector3(0,-.125,0),rail)
			while next_tie<distance+length:
				var p:=a.lerp(c,(next_tie-distance)/length)
				R._tie(b,p+Vector3(0,-.125,0),1.95,yaw,G.mat("64513b",.96),m.steel,G.mat("969b8d",.54,.66))
				next_tie+=.625
			distance+=length
	b.finish(parent)

func _vegetation()->void:
	var foliage:=StandardMaterial3D.new(); foliage.vertex_color_use_as_albedo=true;foliage.vertex_color_is_srgb=true;foliage.roughness=.95;foliage.cull_mode=BaseMaterial3D.CULL_DISABLED
	var crown:=StandardMaterial3D.new(); crown.vertex_color_use_as_albedo=true;crown.vertex_color_is_srgb=true;crown.roughness=.93
	var rng:=RandomNumberGenerator.new();rng.seed=3021047
	for variant in range(6):
		var transforms:Array[Transform3D]=[];var colors:Array[Color]=[]
		var count:int=2400 if variant<2 else 230 if variant<5 else 700
		for i in range(count):
			var x:=rng.randf_range(-42,220);var z:=rng.randf_range(-34,124)
			if absf(z+13)<5 or absf(x+8)<5 and z<17 or absf(z)<1.8 or x>25 and x<127 and absf(z-5)<1.8:continue
			if x>0 and x<25:
				var t:=x/25.;if absf(z-5*(3*t*t-2*t*t*t))<1.9:continue
			var size:=rng.randf_range(.9,1.7) if variant<2 else rng.randf_range(.8,1.5) if variant<5 else rng.randf_range(.08,.27)
			var basis:=Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(size,size*rng.randf_range(.8,1.1),size))
			transforms.append(Transform3D(basis,Vector3(x,.005,z)))
			colors.append(Color.from_hsv(rng.randf_range(.20,.26),rng.randf_range(.42,.63),rng.randf_range(.42,.64)) if variant<5 else Color.from_hsv(.11,.11,rng.randf_range(.52,.73)))
		var mesh:Mesh=Ground._grass_mesh(variant==1) if variant<2 else Ground._crown_mesh(variant-2) if variant<5 else Ground._boulder_mesh()
		var node:=MultiMeshInstance3D.new();var mm:=MultiMesh.new();mm.transform_format=MultiMesh.TRANSFORM_3D;mm.use_colors=true;mm.mesh=mesh;mm.instance_count=transforms.size()
		for i in range(transforms.size()):mm.set_instance_transform(i,transforms[i]);mm.set_instance_color(i,colors[i])
		node.multimesh=mm;node.material_override=foliage if variant<2 else crown;node.name="StableVegetation%d"%variant;add_child(node)
		plants.append({"node":node,"transforms":transforms,"bounds":mesh.get_aabb()})

func _mask_vegetation()->void:
	var masks:Dictionary=state.get("paving",{}).duplicate()
	# A first pass clears plants; snapshots never reroll or move remaining foliage.
	for actor in render.get("actors",[]):
		if str(actor.get("kind",""))!="worker" and bool(actor.get("visible",true)):_clear_vehicle_plants(actor,4.5,2.9)
	for carrier in render.get("carriers",[]):
		_clear_vehicle_plants(carrier,10.0 if str(carrier.kind)=="rail" else 8.8,3.0)
		if str(carrier.kind)=="rail":
			if carrier.has("cars"):
				for car in carrier.cars:_clear_vehicle_plants(car,float(car.get("length",16.8))-.8,3.0)
			elif not carrier.get("freight",{}).is_empty():_clear_vehicle_plants(carrier.freight,11.5,3.0)
	for cell in vegetation_cleared:masks[cell]=true
	for table in ["buildings","stacks"]:
		for entity in state.get(table,[]):
			if table=="stacks" and int(entity.get("qty",0))<=0:continue
			for x in range(int(floor(float(entity.x)-.3)),int(ceil(float(entity.x)+float(entity.get("w",1))+.3))):
				for z in range(int(floor(float(entity.z)-.3)),int(ceil(float(entity.z)+float(entity.get("d",1))+.3))):masks[str(x)+","+str(z)]=true
	for rail in render.get("railGeometry",[]):
		if bool(rail.get("planned",false)):continue
		for cell in rail.geometry.get("cells",[]):masks[str(int(cell.x))+","+str(int(cell.z))]=true
	for cell in state.get("groundWear",{}):
		if float(state.groundWear[cell])>.001:masks[cell]=true
	for cell in masks:vegetation_cleared[cell]=true
	var key:=str(hash(JSON.stringify(masks)))
	if key==masking_key:return
	masking_key=key
	for patch in plants:
		var node:MultiMeshInstance3D=patch.node;var transforms:Array=patch.transforms
		for i in range(transforms.size()):
			var t:Transform3D=transforms[i]
			var bounds:AABB=patch.bounds;var scale:Vector3=t.basis.get_scale()
			var radius:float=Vector2(bounds.size.x*scale.x,bounds.size.z*scale.z).length()*.5
			var blocked:bool=false
			for x in range(int(floor(t.origin.x-radius)),int(ceil(t.origin.x+radius))+1):
				for z in range(int(floor(t.origin.z-radius)),int(ceil(t.origin.z+radius))+1):
					if masks.has(str(x)+","+str(z)):blocked=true;break
				if blocked:break
			if blocked:t.basis=Basis.IDENTITY.scaled(Vector3.ZERO)
			node.multimesh.set_instance_transform(i,t)

# Pure presentation picking: ray proxies never become simulation collision bodies.
func pick_screen(camera:Camera3D,screen:Vector2)->String:
	var origin:=camera.project_ray_origin(screen);var direction:=camera.project_ray_normal(screen)
	var closest:float=INF;var selected_entity:String=""
	for id in models:
		var node:Node3D=models[id]
		if not node.visible:continue
		var kind:=str(node.get_meta("kind",""))
		var bounds:=AABB(Vector3(-1.3,0,-2.6),Vector3(2.6,3.3,4.3))
		if kind=="worker":bounds=AABB(Vector3(-.39,0,-.38),Vector3(.78,1.95,.78))
		elif kind=="excavator":bounds=AABB(Vector3(-1.35,0,-maxf(3.5,float(records.get(id,{}).get("current",{}).get("reach",3)))),Vector3(2.70,3.55,5.0))
		elif kind=="bus":bounds=AABB(Vector3(-1.22,0,-4.15),Vector3(2.44,2.60,8.3))
		elif kind=="rail":bounds=AABB(Vector3(-5.3,.35,-1.35),Vector3(10.6,4.0,2.7))
		elif kind=="wagon":bounds=AABB(Vector3(-8.4,.35,-1.45),Vector3(16.8,1.05,2.90))
		elif node.has_meta("cargo_item") or "/" in str(id):bounds=_local_model_bounds(node,Transform3D.IDENTITY)
		var owner_id:=str(records.get(id,{}).get("to",{}).get("parentEquipmentId",""))
		if owner_id.is_empty():owner_id=str(node.get_meta("inspect_id",str(id).get_slice("/",0)))
		var inverse:=node.global_transform.affine_inverse()
		var distance:=_ray_aabb(inverse*origin,inverse.basis*direction,bounds)
		if distance>=0 and distance<closest:closest=distance;selected_entity=owner_id
	for stop in _buffer_records():
		var id:=str(stop.id)
		if not statics.has(id):continue
		var node:Node3D=statics[id]
		var inverse:=node.global_transform.affine_inverse()
		var distance:=_ray_aabb(inverse*origin,inverse.basis*direction,_local_model_bounds(node,Transform3D.IDENTITY))
		if distance>=0 and distance<closest:closest=distance;selected_entity=id
	for table in ["stacks","buildings"]:
		for entity in state.get(table,[]):
			var id:=str(entity.id)
			if not statics.has(id) or not (statics[id] as Node3D).visible:continue
			var height:float=3.1
			if table=="stacks":
				var item:=str(entity.item);var qty:int=int(entity.get("qty",1))
				height=.02+qty*.18 if item=="slab" else .325+maxi(0,qty-1)*.36 if item.begins_with("rail") else .95 if item=="diesel" else 1.15 if item=="bufferStop" else 3.1
			else:
				height=5.4 if str(entity.kind) in ["shed","store"] else 4.7 if str(entity.kind)=="lamp" else 2.1 if str(entity.kind)=="fence" else 3.1
			var box:=AABB(Vector3(float(entity.x),_surface_height(entity)+float(entity.get("baseHeight",0)),float(entity.z)),Vector3(float(entity.w),height,float(entity.d)))
			var distance:=_ray_aabb(origin,direction,box)
			if distance>=0 and distance<closest:closest=distance;selected_entity=id
	return selected_entity

func _ray_aabb(origin:Vector3,direction:Vector3,box:AABB)->float:
	var enter:float=0;var leave:float=INF
	for axis in range(3):
		if absf(direction[axis])<.000001:
			if origin[axis]<box.position[axis] or origin[axis]>box.end[axis]:return -1
			continue
		var a:float=(box.position[axis]-origin[axis])/direction[axis];var b:float=(box.end[axis]-origin[axis])/direction[axis]
		enter=maxf(enter,minf(a,b));leave=minf(leave,maxf(a,b))
		if enter>leave:return -1
	return enter

func preview_track(geometries:Array,valid:bool)->void:
	_clear_children(preview_node)
	var color:=Color("54f1b2") if valid else Color("ff7168")
	for geometry in geometries:
		if geometry.has("geometry"):geometry=geometry.geometry
		_rail_ghost(preview_node,geometry,color)

func _ghost_material(color:Color,alpha:float=1.0,priority:int=2)->StandardMaterial3D:
	var material:=StandardMaterial3D.new()
	material.albedo_color=Color(color,alpha)
	material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	# Solid strokes participate in depth, motion vectors and temporal AA.
	# Late transparent strokes bypass temporal reconstruction and visibly
	# follow its subpixel jitter; disabling depth also paints over workers.
	material.no_depth_test=false
	material.transparency=BaseMaterial3D.TRANSPARENCY_DISABLED if alpha>=1.0 else BaseMaterial3D.TRANSPARENCY_ALPHA
	material.render_priority=priority if alpha<1.0 else 0
	return material

func _ghost_surface_height(rect:Dictionary)->float:
	# Foundations lift a plan only when installed paving overlaps it. Cache
	# keys include this height so an existing plan follows new foundations.
	var cells:Dictionary=state.get("paving",{})
	var x:float=float(rect.get("x",0));var z:float=float(rect.get("z",0))
	for cz in range(floori(z),ceili(z+float(rect.get("d",1)))):
		for cx in range(floori(x),ceili(x+float(rect.get("w",1)))):
			if cells.has(str(cx)+","+str(cz)):return .105
	return 0.0

func _finish_ghost(batch:RefCounted,parent:Node3D)->void:
	var first:int=parent.get_child_count()
	batch.finish(parent)
	for index in range(first,parent.get_child_count()):
		var mesh:=parent.get_child(index) as MeshInstance3D
		mesh.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh.set_meta("ghost",true)

func _ghost_edge(batch:RefCounted,a:Vector3,b:Vector3,ink:Material,color:Material,width:float=.11)->void:
	var length:=a.distance_to(b)
	if length<.001:return
	var yaw:float=-atan2(b.z-a.z,b.x-a.x)
	batch.box((a+b)*.5,Vector3(length,.016,width+.10),ink,yaw)
	batch.box((a+b)*.5+Vector3(0,.015,0),Vector3(length,.012,width),color,yaw)

func _rail_ghost(parent:Node3D,geometry:Dictionary,color:Color)->void:
	var batch:=R.Batch.new()
	var ink:=_ghost_material(Color("123c4a"),1.0,1)
	var bright:=_ghost_material(color)
	var wash:=_ghost_material(color,.12,0)
	var surface:float=_ghost_surface_height(geometry.get("rect",{}))
	for path in geometry.get("paths",[]):
		var points:Array=path.get("points",[])
		var traveled:float=0.0;var next_tie:float=.28
		for index in range(points.size()-1):
			var a:=Vector3(float(points[index].x),surface+.030,float(points[index].z))
			var b:=Vector3(float(points[index+1].x),surface+.030,float(points[index+1].z))
			var length:float=a.distance_to(b)
			if length<.001:continue
			var normal:=Vector3(-(b.z-a.z),0,b.x-a.x).normalized()
			var yaw:float=-atan2(b.z-a.z,b.x-a.x)
			batch.box((a+b)*.5-Vector3(0,.018,0),Vector3(length,.006,2.0),wash,yaw)
			for side in [-1,1]:
				_ghost_edge(batch,a+normal*R.RAIL_OFFSET*side,b+normal*R.RAIL_OFFSET*side,ink,bright,.12)
			while next_tie<traveled+length:
				var center:=a.lerp(b,(next_tie-traveled)/length)-Vector3(0,.008,0)
				_ghost_edge(batch,center-normal*.96,center+normal*.96,ink,bright,.07)
				next_tie+=.625
			traveled+=length
	_finish_ghost(batch,parent)

func _construction_ghost(parent:Node3D,rect:Dictionary,color:Color)->void:
	var x:float=float(rect.get("x",0));var z:float=float(rect.get("z",0))
	var w:float=float(rect.get("w",1));var d:float=float(rect.get("d",1))
	var batch:=R.Batch.new();var ink:=_ghost_material(Color("123c4a"),1.0,1);var bright:=_ghost_material(color)
	var surface:float=_ghost_surface_height(rect)
	batch.box(Vector3(x+w*.5,surface+.012,z+d*.5),Vector3(w,.006,d),_ghost_material(color,.12,0))
	var corners:Array[Vector3]=[Vector3(x,surface+.030,z),Vector3(x+w,surface+.030,z),Vector3(x+w,surface+.030,z+d),Vector3(x,surface+.030,z+d)]
	for index in range(4):_ghost_edge(batch,corners[index],corners[(index+1)%4],ink,bright)
	var kind:String=str(rect.get("kind",""))
	var height:float=3.0 if kind in ["office","sanitary"] else 4.3 if kind in ["shed","store"] else 0.0
	if height>0:
		for index in range(4):
			var at:Vector3=corners[index]+Vector3(0,height*.5,0)
			batch.box(at,Vector3(.11,height,.11),bright)
			_ghost_edge(batch,corners[index]+Vector3(0,height,0),corners[(index+1)%4]+Vector3(0,height,0),ink,bright)
	_finish_ghost(batch,parent)

func _buffer_records()->Array:
	if state.has("buffers"):return state.buffers
	if render.has("buffers"):return render.buffers
	var legacy:Dictionary=state.get("buffer",{})
	if legacy.is_empty():return []
	var stop:Dictionary=legacy.duplicate();stop["id"]=str(stop.get("id","BUFFER-001"))
	return [stop]

func _attachment_pose(pose:Dictionary,parent_id:String,carried:bool)->Dictionary:
	var value:=pose.duplicate()
	if carried and not parent_id.is_empty():value["parentEquipmentId"]=parent_id
	return value

func _relative_pose(pose:Dictionary,parent:Dictionary)->Vector3:
	var dx:=float(pose.get("x",0))-float(parent.get("x",0));var dz:=float(pose.get("z",0))-float(parent.get("z",0));var angle:=float(parent.get("yaw",0))
	return Vector3(dx*cos(angle)+dz*sin(angle),float(pose.get("y",0))-float(parent.get("y",0)),-dx*sin(angle)+dz*cos(angle))

func _clear_vehicle_plants(pose:Dictionary,length:float,width:float)->void:
	var yaw:float=float(pose.get("yaw",0));var radius:float=maxf(length,width)*.5+1
	var cx:float=float(pose.get("x",0));var cz:float=float(pose.get("z",0))
	for x in range(int(floor(cx-radius)),int(ceil(cx+radius))):
		for z in range(int(floor(cz-radius)),int(ceil(cz+radius))):
			var dx:=float(x)+.5-cx;var dz:=float(z)+.5-cz
			if absf(dx*cos(yaw)+dz*sin(yaw))<length*.5+.65 and absf(-dx*sin(yaw)+dz*cos(yaw))<width*.5+.65:vegetation_cleared[str(x)+","+str(z)]=true

func _local_model_bounds(node:Node3D,transform:Transform3D)->AABB:
	var bounds:=AABB();var first:bool=true
	if node is MeshInstance3D:
		bounds=transform*(node as MeshInstance3D).mesh.get_aabb();first=false
	for child in node.get_children():
		if child is Node3D and child.name!="SuspensionSlings":
			var part:=_local_model_bounds(child,transform*(child as Node3D).transform)
			if part.size!=Vector3.ZERO:bounds=part if first else bounds.merge(part);first=false
	return bounds
