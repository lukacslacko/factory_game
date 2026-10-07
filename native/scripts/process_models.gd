extends RefCounted
## Grid-sized process equipment. Physical parts share meshes and materials; live
## readings move small indicators without rebuilding the installed asset.
const G=preload("res://scripts/geometry.gd")
const R=preload("res://scripts/rail_yard.gd")
const LINE_Y:float=.85
const KINDS:Array[String]=["processTank","transferPump","processPipe","pipeElbow","pipeTee","processValve","processGauge"]
static var ring_meshes:Dictionary={}

static func handles(kind:String)->bool:return kind in KINDS
static func _steel()->Material:return G.mat("c7d4d4",.22,.86)
static func _dark()->Material:return G.mat("344842",.58,.62)
static func _paint()->Material:return G.mat("eee9d8",.35,.18)
static func components(kind:String)->Array[String]:
	if kind=="processTank":return ["base","shell0","shell1","shell2","roof","fittings"]
	if kind=="transferPump":return ["base","motor","pump","manifold"]
	return ["support","fitting","connections"]
static func component_position(kind:String,component:String)->Vector3:
	if kind=="processTank":
		return {"base":Vector3(0,.11,0),"shell0":Vector3(0,.77,0),"shell1":Vector3(0,1.87,0),"shell2":Vector3(0,2.97,0),"roof":Vector3(0,3.52,0)}.get(component,Vector3.ZERO)
	if kind=="transferPump":
		return {"base":Vector3(0,.09,0),"motor":Vector3(-.42,.51,-.5),"pump":Vector3(.30,.47,-.5)}.get(component,Vector3.ZERO)
	return Vector3.ZERO if component=="support" else Vector3(0,LINE_Y,0)
static func building(parent:Node3D,data:Dictionary)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="ProcessEquipment"
	var kind:=str(data.get("kind","processPipe"));root.set_meta("process_kind",kind)
	for component:String in components(kind):
		var piece:=part(root,kind,component);piece.position=component_position(kind,component)
	update(root,data)
	return root
static func part(parent:Node3D,kind:String,component:String)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name=component
	root.set_meta("process_kind",kind);root.set_meta("process_component",component)
	var batch:=R.Batch.new()
	if kind=="processTank":_tank_part(root,batch,component)
	elif kind=="transferPump":_pump_part(root,batch,component)
	else:_line_part(root,batch,kind,component)
	batch.finish(root)
	return root
static func _ring(parent:Node3D,at:Vector3,radius:float,tube:float,material:Material)->MeshInstance3D:
	var key:String="%.3f/%.3f"%[radius,tube]
	if not ring_meshes.has(key):
		var mesh:=TorusMesh.new();mesh.inner_radius=radius-tube;mesh.outer_radius=radius+tube;mesh.rings=64;mesh.ring_segments=8;ring_meshes[key]=mesh
	return G.instance(parent,ring_meshes[key],material,at)
static func _flange(parent:Node3D,at:Vector3,direction:Vector3,radius:float=.105)->void:
	var disk:=G.cylinder(parent,at,radius,.027,_steel(),24);disk.quaternion=Quaternion(Vector3.UP,direction.normalized())
	var gasket:=G.cylinder(parent,at+direction*.018,radius*.90,.007,G.mat("273832",.8),24);gasket.quaternion=disk.quaternion
	# Four visible bolt heads provide scale without generating unbounded detail.
	var side:Vector3=direction.cross(Vector3.UP).normalized()
	if side.length()<.5:side=Vector3.RIGHT
	var up:Vector3=side.cross(direction).normalized()
	for i in range(4):
		var angle:float=TAU*i/4.;var p:Vector3=at+direction*.022+(side*cos(angle)+up*sin(angle))*radius*.76
		var bolt:=G.cylinder(parent,p,.011,.018,_dark(),6);bolt.quaternion=disk.quaternion
static func _port(parent:Node3D,name:String,at:Vector3)->void:
	var marker:=Node3D.new();marker.name="Port"+name;marker.position=at;parent.add_child(marker)
static func _pipe(parent:Node3D,a:Vector3,b:Vector3,radius:float=.057)->void:
	if a.distance_to(b)>.001:G.rod(parent,a,b,radius,_steel(),20)
static func _tank_part(root:Node3D,batch:RefCounted,component:String)->void:
	if component=="base":
		G.cylinder(root,Vector3.ZERO,1.88,.22,G.mat("aaa38f",.95),64)
		for i in range(12):
			var a:float=i*TAU/12.;var p:=Vector3(cos(a)*1.77,.15,sin(a)*1.77)
			G.cylinder(root,p,.055,.028,_dark(),6);G.cylinder(root,p+Vector3(0,.025,0),.024,.065,_steel(),8)
	elif component.begins_with("shell"):
		var shell:=G.cylinder(root,Vector3.ZERO,1.70,1.10,_paint(),64);shell.name="ContainedShell"
		_ring(root,Vector3(0,-.54,0),1.704,.014,_steel());_ring(root,Vector3(0,.54,0),1.704,.014,_steel())
		for i in range(12):
			var a:float=i*TAU/12.;batch.box(Vector3(cos(a)*1.701,0,sin(a)*1.701),Vector3(.008,1.04,.018),G.mat("d6d2c1",.47,.23),-a)
	elif component=="roof":
		var roof:=CylinderMesh.new();roof.bottom_radius=1.70;roof.top_radius=1.43;roof.height=.16;roof.radial_segments=64
		G.instance(root,roof,_paint(),Vector3(0,.08,0))
		_ring(root,Vector3(0,.012,0),1.71,.022,_steel())
		G.cylinder(root,Vector3(-.45,.20,.24),.28,.08,_steel(),32)
		G.cylinder(root,Vector3(-.45,.25,.24),.25,.025,_dark(),32)
		_pipe(root,Vector3(.35,.16,.25),Vector3(.35,.46,.25),.065)
		var cap:=G.sphere(root,Vector3(.35,.46,.25),.12,_steel());cap.scale.y=.35
	else:
		# Four DN100 nozzles reach the exact grid boundary at the simulated ports.
		for ends:Array in [[Vector3(-1.625,LINE_Y,.5),Vector3(-2.,LINE_Y,.5)],[Vector3(1.625,LINE_Y,.5),Vector3(2.,LINE_Y,.5)],[Vector3(.5,LINE_Y,-1.625),Vector3(.5,LINE_Y,-2.)],[Vector3(.5,LINE_Y,1.625),Vector3(.5,LINE_Y,2.)]]:
			_pipe(root,ends[0],ends[1]);_flange(root,ends[1],(ends[1]-ends[0]).normalized())
		_port(root,"W",Vector3(-2.,LINE_Y,.5));_port(root,"E",Vector3(2.,LINE_Y,.5));_port(root,"N",Vector3(.5,LINE_Y,-2.));_port(root,"S",Vector3(.5,LINE_Y,2.))
		# Fixed access ladder and small grated service platform, entirely inside4×4m.
		for z in [-.65,-.20]:_pipe(root,Vector3(1.78,.25,z),Vector3(1.78,4.45,z),.022)
		for i in range(13):_pipe(root,Vector3(1.78,.35+i*.28,-.65),Vector3(1.78,.35+i*.28,-.20),.018)
		batch.box(Vector3(1.45,3.70,-.42),Vector3(.85,.09,.98),_dark())
		for z in [-.88,.04]:
			for x in [1.05,1.84]:_pipe(root,Vector3(x,3.75,z),Vector3(x,4.60,z),.018)
			_pipe(root,Vector3(1.05,4.60,z),Vector3(1.84,4.60,z),.018)
			_pipe(root,Vector3(1.05,4.18,z),Vector3(1.84,4.18,z),.014)
		for i in range(8):batch.box(Vector3(1.45,3.755,-.84+i*.12),Vector3(.80,.016,.025),_steel())
		# An external magnetic level indicator is truthful; the vessel stays opaque.
		var indicator:=Node3D.new();indicator.name="TankLevel";root.add_child(indicator)
		G.beveled_box(indicator,Vector3(-.52,1.88,1.65),Vector3(.13,2.98,.06),_dark())
		var fill:=G.box(indicator,Vector3(-.52,.42,1.69),Vector3(.065,1,.022),G.mat("db9b39",.44,.25));fill.name="LevelStrip";fill.scale.y=.001
		for i in range(7):batch.box(Vector3(-.41,.42+i*.47,1.70),Vector3(.07,.012,.015),_steel())
		var badge:=G.label(root,"30 m³",Vector3(.28,1.38,1.68),28,.004);badge.modulate=Color("35473b")
static func _pump_part(root:Node3D,batch:RefCounted,component:String)->void:
	if component=="base":
		batch.box(Vector3.ZERO,Vector3(1.82,.18,1.75),G.mat("849b88",.5,.42))
		for x in [-.80,.80]:
			for z in [-.73,.73]:G.cylinder(root,Vector3(x,.12,z),.045,.035,_steel(),6)
	elif component=="motor":
		var motor:=G.cylinder(root,Vector3.ZERO,.22,.56,G.mat("e8b334",.3,.35),32);motor.rotation.z=PI*.5;motor.name="Motor"
		for i in range(7):
			var ring:=_ring(root,Vector3(-.23+i*.075,0,0),.22,.012,G.mat("be8c22",.44,.38));ring.rotation.z=PI*.5
		G.beveled_box(root,Vector3(0,.24,.03),Vector3(.21,.11,.19),G.mat("ebbb48",.36,.35))
		batch.box(Vector3(0,-.25,0),Vector3(.59,.09,.47),_dark())
		G.cylinder(root,Vector3(.33,0,0),.09,.14,_steel(),20).rotation.z=PI*.5
	elif component=="pump":
		var casing:=G.cylinder(root,Vector3.ZERO,.23,.25,_steel(),40);casing.rotation.z=PI*.5
		G.sphere(root,Vector3(.10,0,0),.21,_steel()).scale.x=.60
		batch.box(Vector3(0,-.25,0),Vector3(.43,.10,.40),_dark())
		_pipe(root,Vector3(0,.1,0),Vector3(0,.38,0),.07)
		_flange(root,Vector3(.18,0,0),Vector3.RIGHT,.14)
		# Coupling is covered by a real perforated safety guard.
		batch.box(Vector3(-.23,.03,0),Vector3(.20,.26,.29),G.mat("e5ad2f",.48,.35))
		for i in range(5):batch.box(Vector3(-.31+i*.036,.17,0),Vector3(.013,.016,.31),_dark())
	else:
		_pipe(root,Vector3(.30,LINE_Y,-.5),Vector3(1.,LINE_Y,-.5));_flange(root,Vector3(1.,LINE_Y,-.5),Vector3.RIGHT)
		_pipe(root,Vector3(.48,.47,-.5),Vector3(.70,.47,-.5));_pipe(root,Vector3(.70,.47,-.5),Vector3(.70,LINE_Y,-.5))
		_pipe(root,Vector3(-1.,1.10,-.5),Vector3(-.77,1.10,-.5));_flange(root,Vector3(-1.,1.10,-.5),Vector3.LEFT,.12)
		# Intake goes around the motor, rather than through its casing.
		_pipe(root,Vector3(-.77,1.10,-.5),Vector3(-.77,.47,-.5));_pipe(root,Vector3(-.77,.47,-.5),Vector3(-.77,.47,.18))
		_pipe(root,Vector3(-.77,.47,.18),Vector3(.60,.47,.18));_pipe(root,Vector3(.60,.47,.18),Vector3(.60,.47,-.5));_pipe(root,Vector3(.60,.47,-.5),Vector3(.48,.47,-.5))
		_port(root,"Hose",Vector3(-1.,1.10,-.5));_port(root,"E",Vector3(1.,LINE_Y,-.5))
		var status:=G.sphere(root,Vector3(.64,.39,.58),.035,G.mat("67c98a",.3));status.name="RunningLamp"
		G.beveled_box(root,Vector3(.64,.31,.58),Vector3(.21,.18,.17),_dark())
static func _line_part(root:Node3D,batch:RefCounted,kind:String,component:String)->void:
	if component=="support":
		var feet:Array=[Vector3(-.29,0,0),Vector3(0,0,-.29)] if kind=="pipeElbow" else [Vector3(-.29,0,0),Vector3(.29,0,0)]
		for foot:Vector3 in feet:
			batch.box(foot+Vector3(0,.045,0),Vector3(.25,.09,.30),G.mat("aaa38f",.94))
			batch.box(foot+Vector3(0,.39,0),Vector3(.055,.69,.055),_dark())
			batch.box(foot+Vector3(0,.73,0),Vector3(.23,.035,.15),_steel())
		return
	if component=="connections":
		_port(root,"W",Vector3(-.5,0,0))
		if kind!="pipeElbow":_port(root,"E",Vector3(.5,0,0))
		if kind in ["pipeElbow","pipeTee"]:_port(root,"N",Vector3(0,0,-.5))
		_flange(root,Vector3(-.48,0,0),Vector3.LEFT)
		if kind!="pipeElbow":_flange(root,Vector3(.48,0,0),Vector3.RIGHT)
		if kind in ["pipeElbow","pipeTee"]:_flange(root,Vector3(0,0,-.48),Vector3.FORWARD)
		return
	if kind=="pipeElbow":
		# True quarter arc, not two square rods intersecting at a right angle.
		_pipe(root,Vector3(-.5,0,0),Vector3(-.20,0,0))
		for i in range(12):
			var a:float=i*PI*.5/12.;var b:float=(i+1)*PI*.5/12.
			_pipe(root,Vector3(-.2+.2*sin(a),0,-.2+.2*cos(a)),Vector3(-.2+.2*sin(b),0,-.2+.2*cos(b)))
		_pipe(root,Vector3(0,0,-.20),Vector3(0,0,-.5))
	else:
		_pipe(root,Vector3(-.5,0,0),Vector3(.5,0,0))
		if kind=="pipeTee":_pipe(root,Vector3(0,0,0),Vector3(0,0,-.5))
		elif kind=="processValve":
			G.sphere(root,Vector3.ZERO,.115,_dark());_pipe(root,Vector3(0,0,0),Vector3(0,.28,0),.025)
			var wheel:=Node3D.new();wheel.name="ValveWheel";wheel.position.y=.30;root.add_child(wheel)
			_ring(wheel,Vector3.ZERO,.17,.018,G.mat("c64b37",.4,.25))
			for i in range(4):_pipe(wheel,Vector3.ZERO,Vector3(cos(i*PI*.5),0,sin(i*PI*.5))*.16,.012)
			var flag:=G.box(wheel,Vector3(.13,.025,0),Vector3(.06,.018,.045),G.mat("f2d773",.5));flag.name="OpenIndicator"
		elif kind=="processGauge":
			_pipe(root,Vector3.ZERO,Vector3(0,.25,0),.018)
			var gauge:=Node3D.new();gauge.name="GaugeDial";gauge.position=Vector3(0,.33,.02);root.add_child(gauge)
			var body:=G.cylinder(gauge,Vector3.ZERO,.17,.07,_steel(),40);body.rotation.x=PI*.5
			var face:=G.cylinder(gauge,Vector3(0,0,.039),.145,.009,G.mat("f4f0df",.5),40);face.rotation.x=PI*.5
			for i in range(11):
				var a:float=lerpf(-PI*.75,PI*.75,i/10.);var tick:=G.box(gauge,Vector3(sin(a)*.12,cos(a)*.12,.05),Vector3(.009,.027,.007),_dark());tick.rotation.z=-a
			var needle:=Node3D.new();needle.name="Needle";gauge.add_child(needle)
			G.box(needle,Vector3(0,.048,.058),Vector3(.008,.105,.009),G.mat("c64b37",.4,.22))
			G.sphere(gauge,Vector3(0,0,.061),.015,_dark())
			var units:=G.label(gauge,"L/s",Vector3(0,-.065,.052),22,.0017);units.modulate=Color("344842")
static func update(root:Node3D,data:Dictionary)->void:
	var kind:=str(root.get_meta("process_kind",data.get("kind","")))
	if kind=="processTank":
		var strip:Node3D=root.get_node_or_null("fittings/TankLevel/LevelStrip")
		if strip:
			var tank:Dictionary=data.get("tank",data);var ratio:float=clampf(float(tank.get("liters",0))/maxf(1.,float(tank.get("capacity",30000))),0.,1.)
			strip.scale.y=maxf(.001,2.82*ratio);strip.position.y=.42+1.41*ratio
	elif kind=="processValve":
		var wheel:Node3D=root.get_node_or_null("fitting/ValveWheel")
		if wheel:wheel.rotation.y=0. if bool(data.get("open",true)) else PI*.5
	elif kind=="processGauge":
		var needle:Node3D=root.get_node_or_null("fitting/GaugeDial/Needle")
		if needle:needle.rotation.z=lerpf(PI*.75,-PI*.75,clampf(absf(float(data.get("flow",0)))/maxf(1.,float(data.get("maxFlow",5))),0.,1.))
	elif kind=="transferPump":
		var lamp:Node3D=root.get_node_or_null("manifold/RunningLamp")
		if lamp:lamp.visible=float(data.get("flow",0))>0.000001
static func kit(parent:Node3D,kind:String,remaining:Array=[])->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="ProcessCratedKit"
	var batch:=R.Batch.new();var width:float=3.0 if kind=="processTank" else 1.8 if kind=="transferPump" else .9
	var depth:float=2. if kind=="processTank" else 1.5 if kind=="transferPump" else .8
	batch.box(Vector3(0,.08,0),Vector3(width,.16,depth),G.mat("a28353",.9))
	for x in [-width*.35,width*.35]:batch.box(Vector3(x,.31,0),Vector3(.08,.52,depth),_dark())
	var count:int=remaining.size() if not remaining.is_empty() else components(kind).size()
	for i in range(mini(count,6)):
		if kind=="processTank":
			var plate:=G.cylinder(root,Vector3(0,.22+i*.16,0),1.40,.10,_paint(),64);plate.scale.z=.53
		else:batch.box(Vector3(0,.23+i*.13,0),Vector3(width*.86,.09,depth*.82),_steel())
	batch.finish(root);return root
static func hose(parent:Node3D)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="ConnectedTransferHose"
	return root
static func update_hose(root:Node3D,points:Array)->void:
	# A fixed unit cylinder is transformed, never cached by changing segment length.
	var count:int=mini(maxi(0,points.size()-1),32)
	for i in range(count):
		var piece:Node3D=root.get_node_or_null("Segment"+str(i))
		if not piece:piece=G.cylinder(root,Vector3.ZERO,.055,1.,G.mat("263b32",.87,.06),12);piece.name="Segment"+str(i)
		var a:Dictionary=points[i];var b:Dictionary=points[i+1]
		var av:=Vector3(float(a.get("x",0)),float(a.get("y",.2)),float(a.get("z",0)));var bv:=Vector3(float(b.get("x",0)),float(b.get("y",.2)),float(b.get("z",0)))
		var length:float=av.distance_to(bv);piece.visible=length>.001
		if piece.visible:piece.position=(av+bv)*.5;piece.scale=Vector3(1.,length,1.);piece.quaternion=Quaternion(Vector3.UP,(bv-av).normalized())
	for i in range(count,root.get_child_count()):root.get_child(i).visible=false
	root.set_meta("hose_segments",count)
