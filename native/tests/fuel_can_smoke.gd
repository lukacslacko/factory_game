extends SceneTree
## Geometry regression fixture; no user save is loaded or modified.
const Models=preload("res://scripts/game_models.gd")
const G=preload("res://scripts/geometry.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _run()->void:
	var parent:=Node3D.new();root.add_child(parent)
	var worker:Node3D=Models.actor(parent,"worker",{"name":"Worker #1","id":"WK-CAN"});worker.set_meta("kind","worker")
	var p:Dictionary={"walking":true,"travel":2.0,"fuelCan":{"phase":"empty","liters":0.,"clock":0.}}
	Models.animate_actor(worker,p,.1)
	var rig:Node3D=worker.get_node_or_null("FuelHandling")
	_check(rig!=null and rig.visible,"The empty carried service can remains visible")
	var can:Node3D=rig.get_node("Can");var body:MeshInstance3D=can.get_node("Body")
	_check(body.mesh.get_aabb().size.is_equal_approx(Vector3(.34,.42,.18)),"The service can has plausible20L outer body dimensions")
	_check(float(can.get_meta("capacity_liters"))==20.,"Visible can capacity agrees with the20L fuel ledger")
	_check((rig.get_node("GripRight") as Node3D).global_position.distance_to((can.get_node("Handle") as Node3D).global_position)<.001,"Right hand actually grips the handle midpoint")
	_check(can.global_position.y-.5>.35,"Carried can clears the ground without hovering outside the hand")
	_check(not worker.get_node("ArmR").visible,"Original rigid arm cannot overlap the held-tool arm")
	for kind:String in ["excavator","forklift"]:
		var machine:Node3D=Models.actor(parent,kind,{"id":"EQ-CHECK"});machine.set_meta("kind",kind)
		var port:Node3D=machine.get_node("FuelFiller/Port")
		var expected:Vector3=Vector3(.65,.9,.2) if kind=="forklift" else Vector3(1.15,1.1,.2)
		_check(port.position==Vector3.ZERO and port.global_position.distance_to(expected)<.001,kind+" has a real filler neck at the simulation target")
		for yaw:float in [0.,PI*.5,PI,PI*1.5]:
			machine.rotation.y=-yaw-PI*.5
			var side:float=.65 if kind=="forklift" else 1.15
			var point:=Vector3(-.2*cos(yaw)-side*sin(yaw),expected.y,-.2*sin(yaw)+side*cos(yaw))
			_check(port.global_position.distance_to(point)<.001,kind+" filler follows canonical simulation yaw")
		parent.remove_child(machine);machine.free()
	var instance:int=can.get_instance_id();var mesh_count:int=G.meshes.size()
	for phase:String in ["fill","carry","pour","empty"]:
		p.fuelCan={"phase":phase,"liters":11. if phase!="empty" else 0.,"clock":2.}
		p.workClock=2.;p.walking=phase in ["carry","empty"]
		for i:int in range(30):Models.animate_actor(worker,p,1.0/60.0)
		_check(can.get_instance_id()==instance,"Phase "+phase+" reuses the same held can")
		_check((rig.get_node("GripRight") as Node3D).global_position.distance_to((can.get_node("Handle") as Node3D).global_position)<.001,"Phase "+phase+" keeps grip attached during interpolation")
		for suffix:String in ["Left","Right"]:
			var hand:Vector3=(rig.get_node("Grip"+suffix) as Node3D).position
			var shoulder:=Vector3(-.25 if suffix=="Left" else .25,1.37,0)
			_check(hand.distance_to(shoulder)<.585,"Phase "+phase+" stays within articulated arm reach")
		if phase=="pour":
			_check(can.rotation.x<-.85,"Pouring raises and visibly tips the can")
			_check((rig.get_node("GripLeft") as Node3D).position.distance_to(can.transform*Vector3(-.12,-.32,0))<.001,"Second hand supports the can body while pouring")
		if phase=="empty":_check((can.get_node("Contents") as Label3D).text.contains("EMPTY"),"An emptied can remains present and is identified as empty")
	_check(G.meshes.size()==mesh_count,"Animating phases does not allocate new shared meshes")
	p.fuelCan={};Models.animate_actor(worker,p,.1)
	_check(not rig.visible and worker.get_node("ArmL").visible and worker.get_node("ArmR").visible,"Finishing fuel work restores normal worker arms")
	parent.queue_free();await process_frame
	print("FUEL_CAN_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
