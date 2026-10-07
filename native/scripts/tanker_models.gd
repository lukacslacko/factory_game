extends RefCounted
## Detailed contained-liquid rolling stock, using the shared physical bogie frame.
const G=preload("res://scripts/geometry.gd")
const Models=preload("res://scripts/game_models.gd")
static func tanker(parent:Node3D,length:float,id:String,product:String)->Node3D:
	var root:Node3D=Models.flatcar(parent,length,id+" · 30 m³",true)
	root.set_meta("car_type","tanker")
	root.set_meta("liquid",product)
	var paint:StandardMaterial3D=G.mat("cbd6d2" if product=="bulkWater" else "c5c9c1",.29,.42)
	var steel:StandardMaterial3D=G.mat("bac4c7",.22,.85)
	var dark:StandardMaterial3D=G.mat("283c3d",.45,.65)
	var safety:StandardMaterial3D=G.mat("eabf3f",.42,.2)
	for x:float in [-4.7,4.7]:
		G.beveled_box(root,Vector3(x,1.48,0),Vector3(.85,.56,2.3),dark,.08)
	var body:MeshInstance3D=G.cylinder(root,Vector3(0,2.8,0),1.18,11.6,paint,48)
	body.name="ContainedTank";body.rotation.z=PI*.5
	for x:float in [-5.8,5.8]:
		var cap:MeshInstance3D=G.sphere(root,Vector3(x,2.8,0),1.18,paint)
		cap.scale.x=.55;cap.name="DishedHead"+str(x)
	for x:float in [-4.7,0,4.7]:
		var band:MeshInstance3D=G.cylinder(root,Vector3(x,2.8,0),1.195,.09,steel,48)
		band.rotation.z=PI*.5
	G.cylinder(root,Vector3(0,4.03,0),.4,.16,dark,24)
	G.cylinder(root,Vector3(0,4.14,0),.34,.08,steel,24)
	G.rod(root,Vector3(-.25,4.2,0),Vector3(.25,4.2,0),.025,dark)
	# Non-slip manway platform and side ladder, with actual rails and rungs.
	G.box(root,Vector3(0,4.05,-.65),Vector3(2,.07,.65),dark)
	for x:float in [-1.,1.]:
		G.rod(root,Vector3(x,4.08,-.95),Vector3(x,4.82,-.95),.025,safety)
	G.rod(root,Vector3(-1,4.82,-.95),Vector3(1,4.82,-.95),.025,safety)
	for x:float in [-.31,.31]:G.rod(root,Vector3(x,1.05,-1.28),Vector3(x,4.15,-1.28),.03,steel)
	for rung:int in range(11):
		G.rod(root,Vector3(-.31,1.1+rung*.28,-1.3),Vector3(.31,1.1+rung*.28,-1.3),.023,steel)
	G.rod(root,Vector3(0,1.66,0),Vector3(0,1.66,1.6),.07,dark)
	G.cylinder(root,Vector3(0,1.82,1.48),.13,.12,safety,16)
	G.rod(root,Vector3(-.17,1.91,1.48),Vector3(.17,1.91,1.48),.025,safety)
	for x:float in [-6.7,6.7]:
		for z:float in [-1.12,1.12]:
			G.rod(root,Vector3(x,1.2,z),Vector3(x,2.05,z),.025,safety)
		G.rod(root,Vector3(x,2.05,-1.12),Vector3(x,2.05,1.12),.025,safety)
	# Side identification plates remain crisp and readable from either platform side.
	for z:float in [-1.19,1.19]:
		G.box(root,Vector3(2.7,2.62,z),Vector3(2.9,.58,.035),dark)
		var label:Label3D=G.label(root,id+" · "+("WATER" if product=="bulkWater" else "DIESEL"),Vector3(2.7,2.65,z*1.02),28,.003)
		label.rotation.y=PI if z<0 else 0
		label.modulate=Color("f4eee0")
	root.set_meta("deck_length",length)
	return root
