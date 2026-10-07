extends RefCounted
## A20L hand-carried tool. The hand remains on its handle as the can is raised
## and tilted; two-segment arms follow the grip instead of swinging through it.
const G=preload("res://scripts/geometry.gd")
const M=preload("res://scripts/machines.gd")

static func add_filler(machine:Node3D,kind:String)->void:
	var m:Dictionary=M.materials()
	var point:=Vector3(.65,.9,.2) if kind=="forklift" else Vector3(1.15,1.1,.2)
	var filler:=Node3D.new();filler.name="FuelFiller";machine.add_child(filler);filler.position=point
	G.beveled_box(filler,Vector3(-.035,-.065,0),Vector3(.09,.17,.19),m.yellow_dark,.018)
	G.cylinder(filler,Vector3(0,-.025,0),.043,.05,m.bright_steel,16)
	var cap:MeshInstance3D=G.cylinder(filler,Vector3(0,.014,0),.051,.025,m.black,12);cap.name="Cap"
	var port:=Marker3D.new();port.name="Port";filler.add_child(port)
	var label:Label3D=G.label(filler,"DIESEL",Vector3(.016,-.09,.102),17,.0012);label.rotation.y=PI*.5

static func _rig(worker:Node3D)->Node3D:
	var rig:=Node3D.new();rig.name="FuelHandling";worker.add_child(rig)
	var m:Dictionary=M.materials()
	var can:=Node3D.new();can.name="Can";rig.add_child(can)
	can.set_meta("capacity_liters",20.0)
	var paint:Material=G.mat("ad5b28",.58,.22)
	var highlight:Material=G.mat("ce793b",.55,.20)
	var body:MeshInstance3D=G.beveled_box(can,Vector3(0,-.29,0),Vector3(.34,.42,.18),paint,.035);body.name="Body"
	# Stamped reinforcing ribs on both broad faces; nothing protrudes into the grip.
	for z:float in [-.095,.095]:
		G.rod(can,Vector3(-.105,-.41,z),Vector3(.105,-.17,z),.010,highlight,8)
		G.rod(can,Vector3(.105,-.41,z),Vector3(-.105,-.17,z),.010,highlight,8)
	for y:float in [-.475,-.105]:G.beveled_box(can,Vector3(0,y,0),Vector3(.35,.025,.19),highlight,.006)
	G.rod(can,Vector3(-.10,-.09,0),Vector3(-.10,0,0),.016,m.steel,10)
	G.rod(can,Vector3(.10,-.09,0),Vector3(.10,0,0),.016,m.steel,10)
	var handle:MeshInstance3D=G.rod(can,Vector3(-.10,0,0),Vector3(.10,0,0),.019,m.black,10);handle.name="Handle"
	var neck:MeshInstance3D=G.cylinder(can,Vector3(.105,-.075,-.05),.029,.05,m.steel,12);neck.name="Neck"
	var cap:MeshInstance3D=G.cylinder(can,Vector3(.105,-.044,-.05),.034,.018,m.black,12);cap.name="Cap"
	var label:Label3D=G.label(can,"DIESEL\n20 L",Vector3(0,-.28,-.101),20,.0015);label.name="Contents";label.rotation.y=PI
	for side:int in [-1,1]:
		var suffix:String="Left" if side<0 else "Right"
		var upper:MeshInstance3D=G.cylinder(rig,Vector3.ZERO,.065,1,m.navy,12);upper.name="Upper"+suffix
		var lower:MeshInstance3D=G.cylinder(rig,Vector3.ZERO,.052,1,m.navy,12);lower.name="Lower"+suffix
		var elbow:MeshInstance3D=G.sphere(rig,Vector3.ZERO,.057,m.navy);elbow.name="Elbow"+suffix
		var hand:Node3D=Node3D.new();hand.name="Grip"+suffix;rig.add_child(hand)
		G.sphere(hand,Vector3.ZERO,.059,m.skin)
		if side>0:
			for x:float in [-.038,-.014,.010,.034]:
				G.rod(hand,Vector3(x,.015,-.036),Vector3(x,-.027,-.027),.010,m.skin,8)
	var hose:=Node3D.new();hose.name="Hose";rig.add_child(hose)
	for i:int in range(6):
		var section:MeshInstance3D=G.cylinder(hose,Vector3.ZERO,.017,1,m.black,10);section.name="Section"+str(i)
	var stream:MeshInstance3D=G.cylinder(rig,Vector3.ZERO,.007,1,G.mat("a98c3a",.3,.05),8);stream.name="DieselStream";stream.visible=false
	return rig

static func _segment(mesh:Node3D,a:Vector3,b:Vector3)->void:
	mesh.position=(a+b)*.5
	mesh.scale.y=maxf(.001,a.distance_to(b))
	mesh.quaternion=Quaternion(Vector3.UP,(b-a).normalized())

static func _arm(rig:Node3D,side:int,wrist:Vector3,hand_basis:Basis)->void:
	var suffix:String="Left" if side<0 else "Right"
	var shoulder:=Vector3(side*.25,1.37,0)
	var direction:Vector3=(wrist-shoulder).normalized()
	var distance:float=clampf(shoulder.distance_to(wrist),.03,.579)
	var along:float=(.30*.30-.28*.28+distance*distance)/(2*distance)
	var bend:=Vector3(side*.40,-.12,-.60)
	bend=(bend-direction*bend.dot(direction)).normalized()
	var elbow:Vector3=shoulder+direction*along+bend*sqrt(maxf(0.0,.30*.30-along*along))
	_segment(rig.get_node("Upper"+suffix),shoulder,elbow)
	_segment(rig.get_node("Lower"+suffix),elbow,wrist)
	(rig.get_node("Elbow"+suffix) as Node3D).position=elbow
	var hand:Node3D=rig.get_node("Grip"+suffix);hand.position=wrist;hand.basis=hand_basis

static func animate(worker:Node3D,p:Dictionary,delta:float)->bool:
	var value:Variant=p.get("fuelCan",{})
	var fuel:Dictionary=value if value is Dictionary else {}
	var rig:Node3D=worker.get_node_or_null("FuelHandling")
	if fuel.is_empty():
		if rig:rig.visible=false;rig.set_meta("active",false)
		(worker.get_node("ArmL") as Node3D).visible=true
		(worker.get_node("ArmR") as Node3D).visible=true
		return false
	if not rig:rig=_rig(worker)
	rig.visible=true
	(worker.get_node("ArmL") as Node3D).visible=false
	(worker.get_node("ArmR") as Node3D).visible=false
	var can:Node3D=rig.get_node("Can")
	var phase:String=str(fuel.get("phase","carry"))
	var clock:float=float(p.get("workClock",fuel.get("clock",0)))
	var walking:bool=bool(p.get("walking",false))
	var stride:float=float(p.get("travel",0))*5.4
	var pose:=Vector3(.42,.96,-.10)
	var tilt:float=sin(stride)*.035 if walking else 0.0
	if phase=="fill":
		pose=Vector3(.37,.94,-.30);tilt=-.08
	elif phase=="pour":
		var amount:float=smoothstep(0.0,.7,clock)
		pose=Vector3(.27,1.28,-.36);tilt=-.95*amount
	var blend:float=1.0-exp(-maxf(0.0,delta)*10.0)
	if not bool(rig.get_meta("active",false)):blend=1.0
	can.position=can.position.lerp(pose,blend)
	can.rotation.x=lerp_angle(can.rotation.x,tilt,blend)
	rig.set_meta("active",true);rig.set_meta("phase",phase)
	var liters:float=maxf(0.0,float(fuel.get("liters",0)))
	can.set_meta("liters",liters)
	(can.get_node("Contents") as Label3D).text="DIESEL\n%.1f L"%liters if liters>.001 else "DIESEL\nEMPTY"
	(can.get_node("Cap") as Node3D).visible=phase not in ["fill","pour"]
	# The right palm is the exact same transform origin as the handle midpoint.
	_arm(rig,1,can.position,can.basis)
	var left:=Vector3(-.32,.94,-.11+sin(stride)*.11 if walking else -.11)
	if phase=="pour":left=can.transform*Vector3(-.12,-.32,0)
	elif phase=="fill":left=Vector3(.10,1.10,-.29)
	_arm(rig,-1,left,Basis.IDENTITY)
	var hose:Node3D=rig.get_node("Hose");hose.visible=false
	var stream:Node3D=rig.get_node("DieselStream");stream.visible=false
	var target:Dictionary=fuel.get("target",{}) if fuel.get("target",{}) is Dictionary else {}
	if phase in ["fill","pour"] and not target.is_empty():
		var end:Vector3=worker.to_local(Vector3(float(target.get("x",0)),float(target.get("y",1.1)),float(target.get("z",0))))
		var start:Vector3=can.transform*Vector3(.105,-.04,-.05)
		# A short flexible neck reaches the actual barrel/filler. Never draw an
		# unbounded hose across the yard when a crew is displaced or yielding.
		if start.distance_to(end)<=1.0:
			hose.visible=true
			var outlet:Vector3=end+Vector3(0,.035,0)
			var control:Vector3=(start+outlet)*.5+Vector3(0,.13,0)
			for i:int in range(6):
				var a:float=float(i)/6.0;var b:float=float(i+1)/6.0
				var pa:Vector3=(1-a)*(1-a)*start+2*(1-a)*a*control+a*a*outlet
				var pb:Vector3=(1-b)*(1-b)*start+2*(1-b)*b*control+b*b*outlet
				_segment(hose.get_child(i),pa,pb)
			if phase=="pour" and liters>.001:
				stream.visible=true;_segment(stream,outlet,end)
	return true
