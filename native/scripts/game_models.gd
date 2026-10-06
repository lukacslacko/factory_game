extends RefCounted
const G=preload("res://scripts/geometry.gd")
const M=preload("res://scripts/machines.gd")
const R=preload("res://scripts/rail_yard.gd")
static var palette:Dictionary={}

static func materials()->Dictionary:
	if palette.is_empty(): palette=M.materials()
	return palette

static func actor(parent:Node3D,kind:String,data:Dictionary)->Node3D:
	var m:=materials()
	var result:Node3D
	if kind=="excavator":
		result=M._excavator(parent,Vector3.ZERO,m)
		var upper:Node3D=result.get_node("Upper")
		var old:Node=upper.get_node("ProofArm")
		upper.remove_child(old)
		old.free()
		_articulated_arm(upper,m)
	elif kind=="forklift":
		result=M._forklift(parent,Vector3.ZERO,m,false)
		_seated_operator(result,Vector3(0,.98,.26),m)
		_fork_reach_links(result,m)
	else:
		result=M._worker(parent,Vector3.ZERO,0,m,str(data.get("name",data.get("id","Worker"))))
		_worker_joints(result)
	_asset_labels(result,str(data.get("id","")))
	result.set_meta("forward","-Z")
	return result

static func _worker_joints(worker:Node3D)->void:
	var children:=worker.get_children()
	for side in [-1,1]:
		var leg:=Node3D.new(); leg.name="LegL" if side<0 else "LegR"
		var arm:=Node3D.new(); arm.name="ArmL" if side<0 else "ArmR"
		leg.position=Vector3(side*.13,.83,0); arm.position=Vector3(side*.25,1.37,0)
		worker.add_child(leg); worker.add_child(arm)
		for child in children:
			if not child is Node3D: continue
			var mesh:Node3D=child
			var p:Vector3=mesh.position
			if signf(p.x)!=side: continue
			var bone:Node3D=leg if p.y<.85 and absf(p.x)>.06 else arm if absf(p.x)>.20 and p.y>.85 and p.y<1.46 else null
			if bone:
				worker.remove_child(mesh); bone.add_child(mesh); mesh.position-=bone.position

static func _seated_operator(parent:Node3D,at:Vector3,m:Dictionary)->void:
	var person:=Node3D.new(); person.name="Operator"; person.position=at; parent.add_child(person)
	G.beveled_box(person,Vector3(0,.28,0),Vector3(.34,.42,.22),m.orange)
	for side in [-1,1]:
		G.rod(person,Vector3(side*.10,.04,0),Vector3(side*.10,.02,-.28),.08,m.navy)
		G.rod(person,Vector3(side*.10,.02,-.28),Vector3(side*.10,-.30,-.33),.07,m.navy)
		G.beveled_box(person,Vector3(side*.10,-.33,-.40),Vector3(.15,.10,.23),m.black)
		G.rod(person,Vector3(side*.20,.39,0),Vector3(side*.24,.21,-.28),.06,m.navy)
		G.sphere(person,Vector3(side*.24,.21,-.28),.055,m.skin)
	G.sphere(person,Vector3(0,.60,0),.12,m.skin)
	G.cylinder(person,Vector3(0,.72,0),.16,.03,m.hardhat)
	var hat:=G.sphere(person,Vector3(0,.75,0),.14,m.hardhat); hat.scale.y=.65

static func _articulated_arm(parent:Node3D,m:Dictionary)->void:
	var rig:=Node3D.new(); rig.name="ArmRig"; rig.position=Vector3(.42,1.52,-1); parent.add_child(rig)
	var boom:=Node3D.new(); boom.name="Boom"; rig.add_child(boom)
	M._profile(boom,[Vector2(.02,-.10),Vector2(-2.60,-.10),Vector2(-2.68,.08),Vector2(-2.46,.25),Vector2(-.10,.20)],.37,m.yellow_light)
	G.cylinder(boom,Vector3.ZERO,.12,.53,m.steel).rotation.z=PI*.5
	for side in [-1,1]: G.cylinder(boom,Vector3(side*.28,0,0),.07,.022,m.bright_steel).rotation.z=PI*.5
	G.rod(boom,Vector3(.24,.1,-.3),Vector3(.24,.25,-1.9),.08,m.yellow)
	G.rod(boom,Vector3(.24,.25,-1.4),Vector3(.24,.16,-2.46),.035,m.bright_steel)
	var stick:=Node3D.new(); stick.name="Stick"; stick.position=Vector3(0,0,-2.65); boom.add_child(stick)
	M._profile(stick,[Vector2(.08,-.12),Vector2(-2.15,-.12),Vector2(-2.28,.02),Vector2(-2.08,.17),Vector2(-.05,.16)],.25,m.yellow)
	G.cylinder(stick,Vector3.ZERO,.11,.45,m.steel).rotation.z=PI*.5
	G.rod(stick,Vector3(.17,.20,-.1),Vector3(.17,.19,-1.60),.055,m.yellow)
	G.rod(stick,Vector3(.17,.19,-1.2),Vector3(.17,.10,-2.08),.025,m.bright_steel)
	for x in [-.20,.20]:
		G.rod(boom,Vector3(x,.13,-.25),Vector3(x,.24,-2.55),.015,m.black)
		G.rod(stick,Vector3(x,.14,-.20),Vector3(x,.12,-2.1),.013,m.black)
	var bucket:=Node3D.new(); bucket.name="Bucket"; bucket.position=Vector3(0,0,-2.2); stick.add_child(bucket)
	M._profile(bucket,[Vector2(.1,.11),Vector2(.33,-.10),Vector2(.21,-.42),Vector2(-.09,-.59),Vector2(-.68,-.58),Vector2(-.81,-.34),Vector2(-.47,.07)],.73,m.steel)
	G.beveled_box(bucket,Vector3(0,-.46,-.42),Vector3(.62,.09,.42),m.black)
	for x in [-.27,-.09,.09,.27]: G.beveled_box(bucket,Vector3(x,-.55,-.81),Vector3(.10,.07,.25),m.bright_steel)
	G.cylinder(bucket,Vector3.ZERO,.09,.48,m.steel).rotation.z=PI*.5

static func animate_actor(model:Node3D,p:Dictionary,delta:float)->void:
	var kind:=str(model.get_meta("kind",""))
	var operator:Node3D=model.get_node_or_null("Upper/Cab/Operator") if kind=="excavator" else model.get_node_or_null("Operator")
	if operator: operator.visible=not str(p.get("operator","")).is_empty()
	if kind=="excavator":
		var upper:Node3D=model.get_node("Upper")
		upper.rotation.y=float(p.get("upperYaw",0))
		var rig:Node3D=upper.get_node("ArmRig")
		var goal:=Vector3(0,float(p.get("lift",1.8)),-maxf(1.05,float(p.get("reach",2.7))))-rig.position
		rig.rotation.y=atan2(-goal.x,-goal.z)
		var r:=Vector2(goal.x,goal.z).length(); var dy:=goal.y
		var distance:=clampf(Vector2(r,dy).length(),.65,4.82)
		var angle:=atan2(dy,r)+acos(clampf((2.65*2.65+distance*distance-2.2*2.2)/(2*2.65*distance),-1,1))
		var boom:Node3D=rig.get_node("Boom"); var stick:Node3D=boom.get_node("Stick")
		boom.rotation.x=angle
		var elbow_y:=2.65*sin(angle); var elbow_r:=2.65*cos(angle)
		var stick_angle:=atan2(dy-elbow_y,r-elbow_r)
		stick.rotation.x=stick_angle-angle
		(stick.get_node("Bucket") as Node3D).rotation.x=-stick_angle+(.95 if bool(model.get_meta("suspended_load",false)) else .10)
	elif kind=="forklift":
		var carriage:Node3D=model.get_node("Carriage")
		carriage.position.y=maxf(-.21,float(p.get("forkSupportY",float(p.get("y",0))+float(p.get("toolLift",.12))))-float(p.get("y",0))-.3125)
		# Nested channels retain overlap with the fixed mast and with each other.
		# Drive them from the displayed carriage pose so rendering interpolation
		# raises the complete mechanism smoothly, including high flatcar pickups.
		var mast_travel:=maxf(0.0,carriage.position.y-.55)
		var intermediate:Node3D=model.get_node("TelescopicMast")
		intermediate.position.y=mast_travel*.5
		(intermediate.get_node("InnerMast") as Node3D).position.y=mast_travel*.5
		var extension:=maxf(0.0,float(p.get("reach",2.45))-2.45)
		carriage.position.z=-extension
		var slider:Node3D=model.get_node("MastSlider");slider.position.y=carriage.position.y
		var links:Node3D=slider.get_node("Pantograph")
		for side in [-1,1]:
			var x:=float(side)*.41
			var base:=Vector3(x,.49,-.99);var tip:=Vector3(x,.99,-1.06-extension)
			_place_link(links.get_node("Link"+str(side)+"A"),base,tip,.085)
			_place_link(links.get_node("Link"+str(side)+"B"),base+Vector3(0,.50,0),tip-Vector3(0,.50,0),.085)
			var pin:Node3D=links.get_node("Pin"+str(side));pin.position=(base+tip)*.5
	else:
		var can:Node3D=model.get_node_or_null("ArmR/FuelCan")
		var fuel:Dictionary=p.get("fuelCan",{})
		if not fuel.is_empty() and not can:
			can=Node3D.new();can.name="FuelCan";(model.get_node("ArmR") as Node3D).add_child(can)
			G.beveled_box(can,Vector3(.07,-.57,-.11),Vector3(.20,.24,.14),G.mat("b36c32",.59,.24))
			G.rod(can,Vector3(.015,-.45,-.11),Vector3(.015,-.415,-.11),.012,materials().steel)
			G.rod(can,Vector3(.125,-.45,-.11),Vector3(.125,-.415,-.11),.012,materials().steel)
			G.rod(can,Vector3(.015,-.415,-.11),Vector3(.125,-.415,-.11),.012,materials().steel)
			G.cylinder(can,Vector3(.14,-.44,-.11),.020,.05,materials().black,10)
		if can:can.visible=not fuel.is_empty()
		var walking:=bool(p.get("walking",false)); var work:=str(p.get("workPhase","")).contains("rig") or str(p.get("workPhase","")).contains("fasten") or str(p.get("workPhase","")).contains("join")
		var phase:=float(p.get("travel",0))*5.4
		var amount:=.39 if walking else 0.0
		for side in [-1,1]:
			var leg:Node3D=model.get_node("LegL" if side<0 else "LegR")
			var arm:Node3D=model.get_node("ArmL" if side<0 else "ArmR")
			leg.rotation.x=sin(phase)*amount*side
			arm.rotation.x=-sin(phase)*amount*.8*side if not work else -.85+sin(float(p.get("workClock",0))*4)*.12*side

static func stock(parent:Node3D,item:String,qty:int,hand:int=1)->Node3D:
	var root:=Node3D.new(); parent.add_child(root)
	var b:=R.Batch.new(); var m:=materials()
	var rail: Array=[G.mat("dbddd5",.18,.88),G.mat("955532",.82,.26),m.steel]
	if item=="slab":
		for i in range(qty):
			R._slab_with_lifting_slots(b,Vector3(0,.14+i*.18,0),R._panel_concrete("b8b6a7",.94,146),m.black)
			for x in [-.48,0,.48]: b.box(Vector3(x,.04+i*.18,0),Vector3(.045,.07,1),m.wood)
	elif item.begins_with("rail"):
		for i in range(qty):
			if item=="rail": R._rail_panel(b,Vector3(0,i*.36,0),rail,m.wood)
			else: _curved_panel(b,item,i*.36,hand,rail,m)
			for x in [-1.55,1.55]:
				for z in [-.82,.82]:
					b.box(Vector3(x,i*.36-(.010 if i>0 else -.0075),z),Vector3(.20,.05 if i>0 else .015,.14),m.wood)
	elif item=="bufferStop":
		R._buffer(root,b,Vector3(-.5,-.20,0),m.steel,m.bright_steel)
		for z in [-.74,.74]:b.box(Vector3(.05,.035,z),Vector3(1.8,.07,.16),m.wood)
	elif item=="diesel":
		G.cylinder(root,Vector3(0,.46,0),.3,.9,G.mat("b95d3e",.44,.35),24)
		for y in [.13,.72]: G.cylinder(root,Vector3(0,y,0),.307,.03,m.steel,24)
		G.cylinder(root,Vector3(.13,.94,.06),.045,.035,m.black)
		G.label(root,"DIESEL",Vector3(0,.55,.311),26,.004)
	elif item in ["office","sanitary"]:
		R._container(root,b,Vector3.ZERO,6.0 if item=="office" else 3.0,"OFFICE" if item=="office" else "WC",G.mat("deded0",.72),m.black,m.steel)
		if item=="sanitary": root.scale.z=2.0/3.0
	else:
		var dims:Dictionary={"shed":Vector2(4,2),"store":Vector2(4,3),"lamp":Vector2(4,1),"fence":Vector2(3,1)}
		var size:Vector2=dims.get(item,Vector2(1,1))
		b.box(Vector3(0,.12,0),Vector3(size.x,.19,size.y),m.wood)
		if item=="lamp":
			for i in range(qty): G.rod(root,Vector3(-2,.32+i*.16,0),Vector3(2,.32+i*.16,0),.075,m.steel)
		else:
			for i in range(5): b.box(Vector3(0,.30+i*.14,0),Vector3(size.x-.15,.10,size.y-.15),G.mat("8b9e98",.65,.15))
		for x in [-size.x*.32,size.x*.32]: b.box(Vector3(x,.60,0),Vector3(.065,1,size.y+.03),m.black)
	b.finish(root)
	return root

static func _curved_panel(b:R.Batch,item:String,y:float,hand:int,rail:Array,m:Dictionary)->void:
	var points:Array[Vector3]=[]
	for i in range(23):
		var a:float=(float(i)/22.0-.5)*PI/12.0
		points.append(Vector3(20*sin(a),y,hand*20*(1-cos(a))))
	for i in range(points.size()-1):
		var delta:=points[i+1]-points[i]; var normal:=Vector3(-delta.z,0,delta.x).normalized()
		for side in [-1,1]: R._rail_segment(b,points[i]+normal*.7525*side+Vector3(0,-.15,0),points[i+1]+normal*.7525*side+Vector3(0,-.15,0),rail)
	for i in range(9):
		var index:int=int(i*22.0/8.0)
		var p:Vector3=points[index]; var yaw:float=-atan2(p.z-points[maxi(0,index-1)].z,p.x-points[maxi(0,index-1)].x)
		b.crown(p+Vector3(0,.09,0),1.95,.25,.15,R._panel_concrete("b8b6a7",.94,146),yaw+PI*.5)
	if item=="railPoints":
		for side in [-1,1]: b.box(Vector3(0,y+.21,side*.50),Vector3(4.0,.07,.04),rail[0])

static func carrier(parent:Node3D,kind:String)->Node3D:
	var m:=materials(); var root:Node3D
	if kind in ["truck","lowloader","service"]:
		root=M._truck(parent,Vector3.ZERO,m,false,.82 if kind=="lowloader" else 1.15); root.scale=Vector3(1.15,1.0,1.40)
		if kind=="lowloader":_loading_ramps(root,m)
	elif kind=="bus":
		root=Node3D.new(); parent.add_child(root)
		G.beveled_box(root,Vector3(0,1.25,0),Vector3(2.35,1.70,8.0),m.cream)
		G.beveled_box(root,Vector3(0,2.22,0),Vector3(2.37,.15,8.05),m.cream)
		for z in [-2.6,2.55]:
			for side in [-1,1]: M._wheel(root,Vector3(side*1.10,.43,z),.43,.26,m)
		for side in [-1,1]:
			for z in [-2.8,-1.5,-.2,1.1,2.4]: G.beveled_box(root,Vector3(side*1.183,1.65,z),Vector3(.025,.71,1.17),m.glass_light)
		G.beveled_box(root,Vector3(0,1.65,-4.015),Vector3(2.08,.74,.03),m.glass_light)
		G.beveled_box(root,Vector3(.89,1.24,-2.9),Vector3(.028,1.62,.86),m.steel)
		for x in [-.8,.8]: G.beveled_box(root,Vector3(x,.68,-4.03),Vector3(.27,.15,.04),m.light)
	else:
		root=_locomotive(parent)
	root.set_meta("forward","+X" if kind=="rail" else "-Z")
	return root

static func flatcar(parent:Node3D,length:float=16.0,identification:String="FLAT 014 · 40 t")->Node3D:
	var root:=Node3D.new(); parent.add_child(root); var b:=R.Batch.new(); var m:=materials()
	R._flatcar(root,b,Vector3.ZERO,[m.bright_steel,G.mat("955532",.82,.26),m.steel],m.black,m.steel,m.wood,m.bright_steel,false,length,false,identification)
	b.finish(root)
	for index in range(2):
		var bogie:=rail_bogie(root,false);bogie.name="RailBogie"+str(index)
		bogie.position.x=(-1.0 if index==0 else 1.0)*(length*.5-2.5)
	root.set_meta("forward","+X");root.set_meta("deck_length",length)
	return root

static func rail_bogie(parent:Node3D,locomotive:bool=false)->Node3D:
	var root:=Node3D.new();parent.add_child(root);var m:=materials();var b:=R.Batch.new()
	var radius:float=.355 if locomotive else .32
	var axle_y:float=.705 if locomotive else .67
	b.box(Vector3(0,.80 if locomotive else .76,0),Vector3(1.9,.19,1.96 if locomotive else 1.75),m.black)
	for dx in [-.6,.6]:
		G.rod(root,Vector3(dx,axle_y,-1.06),Vector3(dx,axle_y,1.06),.065,m.steel)
		for side in [-1,1]:
			var wheel:=G.cylinder(root,Vector3(dx,axle_y,side*.76),radius,.15,m.steel,24);wheel.rotation.x=PI*.5
			var hub:=G.cylinder(root,Vector3(dx,axle_y,side*.86),.15 if locomotive else .105,.025,m.bright_steel,16);hub.rotation.x=PI*.5
	for side in [-1,1]:
		b.box(Vector3(0,.69,side*.91),Vector3(1.9,.14,.10),m.steel)
		for spring_x in [-.14,.14]:G.cylinder(root,Vector3(spring_x,.78,side*.87),.06,.18,m.black,10)
	b.finish(root)
	return root

static func _locomotive(parent:Node3D)->Node3D:
	var n:=Node3D.new(); parent.add_child(n); var m:=materials()
	G.beveled_box(n,Vector3(0,1.05,0),Vector3(9.8,.45,2.55),m.steel)
	G.beveled_box(n,Vector3(1.0,2.0,0),Vector3(6.7,1.65,1.93),G.mat("67795a",.54,.30))
	G.beveled_box(n,Vector3(-3.1,2.72,0),Vector3(2.8,2.8,2.4),G.mat("728365",.48,.25))
	for z in [-1.21,1.21]:
		G.beveled_box(n,Vector3(-3.1,3.22,z),Vector3(2.22,.82,.023),m.glass_light)
		for x in [-1.7,0,1.7,3.4]:
			for y in [1.42,1.67,1.92,2.17]: G.box(n,Vector3(x,y,z*.83),Vector3(.9,.025,.028),m.black)
	G.beveled_box(n,Vector3(-3.1,4.17,0),Vector3(2.91,.13,2.54),m.cream)
	for index in range(2):
		var bogie:=rail_bogie(n,true);bogie.name="RailBogie"+str(index)
		bogie.position.x=-3.1 if index==0 else 3.1
	for x in [-5.15,5.15]:
		G.beveled_box(n,Vector3(x,1.18,0),Vector3(.18,.38,2.6),m.yellow)
		G.box(n,Vector3(x*1.019,1.18,0),Vector3(.035,.22,.70),m.black)
	G.cylinder(n,Vector3(1.4,3.18,0),.10,.54,m.black)
	var b:=R.Batch.new();var handrail:=G.mat("d4c389",.42,.46)
	# Walkways, safety rails, access steps and maintenance hatches belong to this
	# real delivery locomotive rather than being scenery around it.
	for side in [-1,1]:
		var z:float=float(side)*1.20
		b.box(Vector3(1.1,1.30,z),Vector3(7.2,.08,.36),m.bright_steel)
		for x in [-1.1,.6,2.3,4.5]:
			G.rod(n,Vector3(x,1.35,z),Vector3(x,2.32,z),.032,handrail,8)
		G.rod(n,Vector3(-1.1,2.32,z),Vector3(4.5,2.32,z),.031,handrail,8)
		G.rod(n,Vector3(-1.1,1.83,z),Vector3(4.5,1.83,z),.023,handrail,8)
		for x in [-4.65,4.65]:
			for y in [.56,.80,1.04]:b.box(Vector3(x,y,z),Vector3(.48,.045,.31),m.steel)
		for x in [-.7,1.0,2.7]:
			b.box(Vector3(x,2.02,float(side)*.983),Vector3(1.52,1.27,.018),G.mat("62735d",.47,.34))
			for y in [1.60,1.80,2.0,2.20]:b.box(Vector3(x,y,float(side)*.999),Vector3(1.12,.038,.018),m.black)
			for dx in [-.60,.60]:
				for y in [1.46,2.57]:G.cylinder(n,Vector3(x+dx,y,float(side)*1.016),.018,.013,m.bright_steel,6).rotation.x=PI*.5
		b.box(Vector3(-3.1,3.23,float(side)*1.229),Vector3(.056,.90,.023),m.cream)
		b.box(Vector3(-3.82,2.52,float(side)*1.229),Vector3(.05,1.43,.025),m.steel)
		G.rod(n,Vector3(-3.92,1.94,float(side)*1.24),Vector3(-3.92,2.51,float(side)*1.24),.021,m.bright_steel,8)
		var badge:=G.label(n,"LINE 01",Vector3(1.1,2.62,float(side)*1.023),29,.006)
		badge.modulate=Color("e5e9e0");badge.rotation.y=PI if side<0 else 0.0
	for x in [-4.515,-1.685]:
		b.box(Vector3(x,3.23,0),Vector3(.022,.81,1.98),m.glass_light)
		b.box(Vector3(x+(-.018 if x< -3 else .018),3.23,0),Vector3(.025,.86,.059),m.cream)
		for z in [-.72,.72]:G.rod(n,Vector3(x,2.96,z),Vector3(x,3.31,z+.07),.017,m.black,8)
	b.box(Vector3(4.37,2.04,0),Vector3(.04,1.17,1.58),m.black)
	for z in range(12):b.box(Vector3(4.397,2.04,-.715+float(z)*.13),Vector3(.034,1.12,.038),m.steel)
	for x in [-5.25,5.25]:
		for z in [-.70,.70]:
			var lamp:=G.cylinder(n,Vector3(x*.838,2.55,z),.12,.065,m.light,16);lamp.rotation.z=PI*.5
			G.rod(n,Vector3(x*.96,.98,z),Vector3(x*1.025,.98,z),.08,m.steel,12)
			var buffer:=G.cylinder(n,Vector3(x*1.025,.98,z),.16,.045,m.black,16);buffer.rotation.z=PI*.5
		for z in [-1.02,-.62,-.22,.18,.58,.98]:
			b.box(Vector3(x*1.019,1.18,z),Vector3(.020,.29,.13),m.black)
		G.rod(n,Vector3(x*.91,.95,0),Vector3(x*1.06,.95,0),.075,m.steel,12)
		b.box(Vector3(x*1.06,.95,0),Vector3(.18,.14,.22),m.black)
	G.cylinder(n,Vector3(2.6,2.89,0),.39,.075,m.black,24)
	for side in [-1,1]:
		b.box(Vector3(.55,.69,float(side)*.43),Vector3(2.18,.31,.39),m.steel)
	b.finish(n);n.scale.x=.90
	return n

static func building(parent:Node3D,data:Dictionary)->Node3D:
	var kind:=str(data.get("kind","")); var root:=Node3D.new(); parent.add_child(root)
	var b:=R.Batch.new(); var m:=materials()
	if kind in ["office","sanitary"]:
		R._container(root,b,Vector3.ZERO,6.0 if kind=="office" else 3.0,"OFFICE" if kind=="office" else "WC",G.mat("deded0",.72),m.black,m.steel)
		if kind=="sanitary": root.scale.z=2.0/3.0
	elif kind=="lamp":
		var lamp:=R._lamp(root,b,Vector3.ZERO,m.steel,m.bright_steel)
		lamp.set_meta("connected",data.get("connected",false))
	elif kind in ["shed","store"]:
		var w:float=float(data.get("w",8)); var d:float=float(data.get("d",6))
		if int(data.get("rotation",0))%2==1: var swap:=w; w=d; d=swap
		for x in [-w*.5+.18,w*.5-.18]:
			for z in [-d*.5+.18,0,d*.5-.18]:
				var post:=shed_part(root,"post",w,d,0); post.position=Vector3(x,2.255,z)
		for i in range(3):
			var beam:=shed_part(root,"beam",w,d,i); beam.position=Vector3(0,4.405,[-d*.5+.18,0,d*.5-.18][i])
		for i in range(4):
			var roof:=shed_part(root,"roof",w,d,i); var x:float=-w*.5+(i+.5)*w/4
			roof.position=Vector3(x,4.855-absf(x)/w*1.5,0)
		if kind=="store":
			for i in range(2):
				var wall:=shed_part(root,"wall",w,d,i); wall.position=Vector3((i-.5)*w*.5,2.105,-d*.5)
	elif kind=="fence":
		for x in [-1.45,1.45]: G.cylinder(root,Vector3(x,1,0),.04,2,m.steel,8)
		for y in [.3,.6,.9,1.2,1.5,1.8]: b.box(Vector3(0,y,0),Vector3(3,.015,.015),m.steel)
		for x in range(12): b.box(Vector3(-1.4+x*.25,1,0),Vector3(.012,2,.015),m.steel)
	else:
		G.beveled_box(root,Vector3(0,.7,0),Vector3(.8,1.4,.65),G.mat("789077" if kind=="power" else "698c8b",.70,.18))
		G.label(root,"16 kVA" if kind=="power" else "WATER",Vector3(0,1,.34),28,.006)
	b.finish(root)
	return root

static func shed_part(parent:Node3D,kind:String,w:float,d:float,index:int)->Node3D:
	var root:=Node3D.new(); parent.add_child(root); var b:=R.Batch.new(); var m:=materials()
	var galvanized:=G.mat("a9b5b5",.36,.58)
	if kind=="post":
		b.box(Vector3.ZERO,Vector3(.15,4.30,.15),galvanized)
		b.box(Vector3(0,-2.07,0),Vector3(.37,.16,.37),m.concrete)
	elif kind=="beam":
		G.beam(root,Vector3(-w*.5+.12,-.40,0),Vector3(0,.40,0),.13,galvanized)
		G.beam(root,Vector3(0,.40,0),Vector3(w*.5-.12,-.40,0),.13,galvanized)
		b.box(Vector3(0,-.40,0),Vector3(w-.24,.11,.18),galvanized)
	elif kind=="roof":
		_corrugated_roof(root,w,d,index,galvanized)
		root.set_meta("base_roll",0.0)
	elif kind=="wall":
		b.box(Vector3.ZERO,Vector3(w*.5-.10,3.90,.12),G.mat("9dafa8",.51,.28))
		for i in range(int(w/.24)): b.box(Vector3(-w*.25+i*.12,0,.08),Vector3(.035,3.8,.025),galvanized)
	else:
		G.beam(root,Vector3(-w*.5,1.80,0),Vector3(w*.5,-1.80,0),.10,galvanized)
		G.beam(root,Vector3(-w*.5,-1.80,0),Vector3(w*.5,1.80,0),.10,galvanized)
	b.finish(root); return root

static func buffer(parent:Node3D)->Node3D:
	var root:=Node3D.new(); parent.add_child(root); var b:=R.Batch.new(); var m:=materials()
	R._buffer(root,b,Vector3(0,-.2,0),m.steel,m.bright_steel); b.finish(root); return root

static func _asset_labels(node:Node,id:String)->void:
	if node is Label3D and str((node as Label3D).text) in ["EX-001","FL-001"]:(node as Label3D).text=id
	for child in node.get_children():_asset_labels(child,id)

static func _fork_reach_links(root:Node3D,m:Dictionary)->void:
	# A three-section mast: the original upright stays fixed, while these two
	# nested steel channels extend to support ~4 m lifts without a floating
	# carriage. Both sections retain over 0.4 m overlap at the highest pickup.
	var intermediate:=Node3D.new();intermediate.name="TelescopicMast";root.add_child(intermediate)
	var inner:=Node3D.new();inner.name="InnerMast";intermediate.add_child(inner)
	for stage in [intermediate,inner]:
		var first:bool=stage==intermediate
		var depth:float=-1.025 if first else -1.085
		var width:float=.13 if first else .10
		for side in [-1,1]:
			var x:float=side*.46
			var channel:=G.beveled_box(stage,Vector3(x,1.33,depth),Vector3(width,2.14,.09 if first else .065),m.steel)
			channel.name="ChannelL" if side<0 else "ChannelR"
			G.beveled_box(stage,Vector3(x,1.33,depth-.05),Vector3(width*.32,2.03,.016),m.bright_steel)
			G.rod(stage,Vector3(x*.67,.42,depth),Vector3(x*.67,2.16,depth),.013,m.black,8)
			G.cylinder(stage,Vector3(x*.67,2.15,depth),.058,.035,m.steel,12).rotation.x=PI*.5
		G.beveled_box(stage,Vector3(0,2.33,depth),Vector3(1.0,.075,.07),m.steel)
	var slider:=Node3D.new();slider.name="MastSlider";root.add_child(slider)
	for x in [-.46,.46]:G.beveled_box(slider,Vector3(x,.77,-.995),Vector3(.19,.83,.085),m.steel)
	var links:=Node3D.new();links.name="Pantograph";slider.add_child(links)
	for side in [-1,1]:
		for letter in ["A","B"]:
			var link:=G.box(links,Vector3.ZERO,Vector3(.085,1,.085),m.steel);link.name="Link"+str(side)+letter
		var pin:=G.cylinder(links,Vector3.ZERO,.06,.17,m.bright_steel,12);pin.rotation.z=PI*.5;pin.name="Pin"+str(side)

static func _place_link(link:Node3D,a:Vector3,b:Vector3,width:float)->void:
	link.position=(a+b)*.5;link.scale=Vector3(1,a.distance_to(b),1);link.quaternion=Quaternion(Vector3.UP,(b-a).normalized())

static func _corrugated_roof(parent:Node3D,w:float,d:float,index:int,material:Material)->void:
	# All four strips share one analytical slope and corrugation phase. Their
	# horizontal bounds touch exactly, even while each real strip is lifted alone.
	var center:float=-w*.5+(float(index)+.5)*w*.25
	var xmin:float=-w*.125-(.16 if index==0 else 0.0)
	var xmax:float=w*.125+(.16 if index==3 else 0.0)
	var slope:float=1.5/w*(1.0 if index<2 else -1.0)
	var count:=int(ceil((xmax-xmin)/.045))
	var vertices:Array[Vector3]=[];var normals:Array[Vector3]=[]
	var zmin:float=-d*.5-.225;var zmax:float=d*.5+.225
	for i in range(count):
		var x0:float=lerpf(xmin,xmax,float(i)/count);var x1:float=lerpf(xmin,xmax,float(i+1)/count)
		var y0:float=slope*x0+.014*(1.0+cos((center+x0)*TAU/.18))
		var y1:float=slope*x1+.014*(1.0+cos((center+x1)*TAU/.18))
		var n:=Vector3(-(y1-y0)/(x1-x0),1,0).normalized()
		var a:=Vector3(x0,y0,zmin);var b:=Vector3(x1,y1,zmin);var c:=Vector3(x1,y1,zmax);var e:=Vector3(x0,y0,zmax)
		G.triangle(vertices,normals,a,b,c,n,n,n);G.triangle(vertices,normals,a,c,e,n,n,n)
		var down:=Vector3(0,-.035,0)
		G.triangle(vertices,normals,a+down,e+down,c+down,-n,-n,-n);G.triangle(vertices,normals,a+down,c+down,b+down,-n,-n,-n)
		for edge in [[a,b,Vector3.FORWARD],[c,e,Vector3.BACK]]:
			G.triangle(vertices,normals,edge[0],edge[0]+down,edge[1]+down,edge[2],edge[2],edge[2]);G.triangle(vertices,normals,edge[0],edge[1]+down,edge[1],edge[2],edge[2],edge[2])
		if i==0 or i==count-1:
			var l:Vector3=a if i==0 else b;var r:Vector3=e if i==0 else c;var side:Vector3=Vector3.LEFT if i==0 else Vector3.RIGHT
			G.triangle(vertices,normals,l,r,r+down,side,side,side);G.triangle(vertices,normals,l,r+down,l+down,side,side,side)
	G.instance(parent,G.surface(vertices,normals),material,Vector3.ZERO)
	# Folded edge trims run continuously along the eaves, not across sheet seams.
	if index==0 or index==3:
		var x:float=xmin if index==0 else xmax
		G.beveled_box(parent,Vector3(x,slope*x-.04,0),Vector3(.05,.13,d+.50),material)

static func _loading_ramps(root:Node3D,m:Dictionary)->void:
	var deck:Node3D=root.get_node("Deck")
	# Machinery trailers have an open platform, unlike freight sideboards.
	for child in deck.get_children():
		if child is Node3D and (child as Node3D).position.y>1.0:deck.remove_child(child);child.free()
	for side in [-1,1]:
		var ramp:=Node3D.new();ramp.name="RampL" if side<0 else "RampR";root.add_child(ramp)
		ramp.position=Vector3(float(side)*.66,.82,2.965)
		var length:float=4.5/1.40
		G.beveled_box(ramp,Vector3(0,-.035,length*.5),Vector3(.56,.07,length),m.steel)
		for z in range(22):G.beveled_box(ramp,Vector3(0,.006,(float(z)+.5)*length/22),Vector3(.52,.04,.045),m.bright_steel)
		G.cylinder(ramp,Vector3.ZERO,.07,.64,m.steel,12).rotation.z=PI*.5
		ramp.rotation.x=-PI*.5

static func animate_carrier(model:Node3D,p:Dictionary)->void:
	if str(model.get_meta("kind",""))!="lowloader":return
	for name in ["RampL","RampR"]:
		var ramp:Node3D=model.get_node_or_null(name)
		if ramp:ramp.rotation.x=lerpf(-PI*.5,atan2(.82,4.5),clampf(float(p.get("ramp",0)),0,1))

static func rig_cargo(cargo:Node3D,equipment:Node3D)->void:
	var rig:Node3D=cargo.get_node_or_null("SuspensionSlings")
	if str(equipment.get_meta("kind",""))!="excavator":
		if rig:rig.visible=false
		return
	if not rig:
		rig=Node3D.new();rig.name="SuspensionSlings";cargo.add_child(rig)
		for i in range(4):
			var chain:=G.cylinder(rig,Vector3.ZERO,.014,1,materials().steel,8);chain.name="Chain"+str(i)
		G.sphere(rig,Vector3.ZERO,.055,materials().bright_steel).name="Hook"
	rig.visible=true
	var bucket:Node3D=equipment.get_node("Upper/ArmRig/Boom/Stick/Bucket")
	var hook:Vector3=cargo.to_local(bucket.global_position)
	var item:=str(cargo.get_meta("cargo_item",""));var qty:int=int(cargo.get_meta("cargo_qty",1))
	var width:float=float(cargo.get_meta("cargo_width",1.55 if item.begins_with("rail") else .37))
	var depth:float=.70 if item.begins_with("rail") else .37
	var height:float=.325+maxi(0,qty-1)*.36 if item.begins_with("rail") else .18*qty if item=="slab" else .91 if item=="diesel" else 1.15 if item in ["buffer","bufferStop"] else 2.8 if item in ["office","sanitary"] else .4
	height=float(cargo.get_meta("cargo_height",height))
	if item in ["buffer","bufferStop"]:width=.35;depth=.74
	var index:=0
	for x in [-width,width]:
		for z in [-depth,depth]:
			_place_link(rig.get_node("Chain"+str(index)),Vector3(x,height,z),hook,.028);index+=1
	(rig.get_node("Hook") as Node3D).position=hook

static func anchor(parent:Node3D)->Node3D:
	var root:=Node3D.new();parent.add_child(root);var m:=materials()
	G.beveled_box(root,Vector3(0,.013,0),Vector3(.32,.026,.32),m.bright_steel)
	for x in [-.11,.11]:
		for z in [-.11,.11]:G.cylinder(root,Vector3(x,.042,z),.027,.034,m.steel,6)
	return root

static func shed_kit(parent:Node3D,remaining:Dictionary)->Node3D:
	var root:=Node3D.new();parent.add_child(root);var b:=R.Batch.new();var m:=materials()
	for x in [-1.5,1.5]:b.box(Vector3(x,0,0),Vector3(.22,.15,1.75),m.wood)
	var galvanized:=G.mat("a9b5b5",.36,.58)
	for i in range(int(remaining.posts)):
		b.box(Vector3(0,.15+int(i/4)*.17,-.60+(i%4)*.18),Vector3(4.30,.15,.15),galvanized)
	for i in range(int(remaining.beams)):
		b.box(Vector3(0,.20+i*.14,.34),Vector3(4.0,.12,.45),galvanized)
	for i in range(int(remaining.roof)):
		b.box(Vector3(0,.61+i*.045,0),Vector3(3.7,.035,1.8),galvanized)
	for i in range(int(remaining.walls)):
		b.box(Vector3(0,.84+i*.055,0),Vector3(3.7,.045,1.8),galvanized)
	if int(remaining.brace)>0:b.box(Vector3(0,1.00,.8),Vector3(3.7,.07,.09),m.steel)
	b.finish(root);return root
