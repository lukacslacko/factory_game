extends RefCounted

const G = preload("res://scripts/geometry.gd")
const GAUGE := 1.435
const RAIL_OFFSET := (GAUGE + 0.07) * 0.5

# Static construction parts are grouped by material, rather than thousands of nodes.
class Batch:
	extends RefCounted
	var groups: Dictionary = {}
	func box(pos: Vector3, size: Vector3, material: Material, yaw: float = 0.0) -> void:
		var h := size * 0.5
		var corners: Array[Vector3] = [Vector3(-h.x,-h.y,-h.z),Vector3(h.x,-h.y,-h.z),Vector3(h.x,h.y,-h.z),Vector3(-h.x,h.y,-h.z),Vector3(-h.x,-h.y,h.z),Vector3(h.x,-h.y,h.z),Vector3(h.x,h.y,h.z),Vector3(-h.x,h.y,h.z)]
		_solid(pos,corners,material,yaw)
	func ballast(pos: Vector3, length: float, material: Material, yaw: float = 0.0) -> void:
		# Sloping shoulders meet the dirt instead of presenting a concrete-like curb.
		var x := length * 0.5
		var corners: Array[Vector3] = [Vector3(-x,-0.09,-1.65),Vector3(x,-0.09,-1.65),Vector3(x,0.09,-1.325),Vector3(-x,0.09,-1.325),Vector3(-x,-0.09,1.65),Vector3(x,-0.09,1.65),Vector3(x,0.09,1.325),Vector3(-x,0.09,1.325)]
		_solid(pos,corners,material,yaw)
	func _solid(pos: Vector3, corners: Array[Vector3], material: Material, yaw: float) -> void:
		if not groups.has(material):
			var surface := SurfaceTool.new()
			surface.begin(Mesh.PRIMITIVE_TRIANGLES)
			groups[material] = surface
		var st: SurfaceTool = groups[material]
		var faces := [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]
		var rotation := Basis(Vector3.UP, yaw)
		for face in faces:
			var a: Vector3 = corners[face[0]]
			var b: Vector3 = corners[face[1]]
			var c: Vector3 = corners[face[2]]
			var normal := (b-a).cross(c-a).normalized()
			for index in [face[0],face[2],face[1],face[0],face[3],face[2]]:
				st.set_normal(rotation * normal)
				st.add_vertex(pos + rotation * corners[index])
	func finish(parent: Node3D) -> void:
		for material in groups:
			var instance := MeshInstance3D.new()
			instance.mesh = groups[material].commit()
			instance.material_override = material
			parent.add_child(instance)

static func build(root: Node3D) -> Dictionary:
	var yard := Node3D.new()
	yard.name = "RailwayBuildingsAndStocks"
	root.add_child(yard)
	var batch := Batch.new()
	var steel := G.mat("58636a", 0.43, 0.72)
	var rail_top := G.mat("a4a9a6", 0.30, 0.85)
	var rust := G.mat("754731", 0.84, 0.36)
	var dark := G.mat("263132", 0.76, 0.35)
	var sleeper := G.mat("584535", 0.97)
	var bolts := G.mat("9a9b8d", 0.55, 0.68)
	var gravel := _ballast_material()
	var rail_materials := [rail_top, rust, steel]
	# Raised ballast and I-section rails leave the gauge clear and measurable.
	batch.ballast(Vector3(0,0.09,-14),122.0,gravel)
	for rail_side in [-1, 1]:
		_rail_segment(batch, Vector3(-61,0,-14 + rail_side * RAIL_OFFSET),Vector3(61,0,-14 + rail_side * RAIL_OFFSET),rail_materials)
	for i in range(-88,89):
		var x := float(i) * 0.68
		if x > -27.2 and x < -19.0:
			continue
		_tie(batch, Vector3(x,0,-14),2.55,0.0,sleeper,dark,bolts)
	var branch: Array[Vector3] = []
	for i in range(51):
		var t := float(i)/50.0
		var p := _bezier(Vector3(-27,0,-14),Vector3(-22,0,-14),Vector3(-16,0,-8),Vector3(-11,0,-8),t)
		branch.append(p)
		if i % 2 == 0 and i > 26:
			var ahead := _bezier(Vector3(-27,0,-14),Vector3(-22,0,-14),Vector3(-16,0,-8),Vector3(-11,0,-8), minf(t + 0.001, 1.0))
			var before := _bezier(Vector3(-27,0,-14),Vector3(-22,0,-14),Vector3(-16,0,-8),Vector3(-11,0,-8), maxf(t - 0.001, 0.0))
			var yaw := -atan2((ahead-before).z,(ahead-before).x)
			_tie(batch,p,2.55,yaw,sleeper,dark,bolts)
	for i in range(branch.size()-1):
		var p: Vector3 = branch[i]
		var q: Vector3 = branch[i+1]
		var tangent := (q-p).normalized()
		var perpendicular := Vector3(-tangent.z,0,tangent.x)
		batch.ballast((p+q)*0.5 + Vector3(0,0.09,0),p.distance_to(q)+0.02,gravel,-atan2(tangent.z,tangent.x))
		for side in [-1,1]:
			_rail_segment(batch,p+perpendicular*RAIL_OFFSET*side,q+perpendicular*RAIL_OFFSET*side,rail_materials)
	for i in range(12):
		var x := -27.0 + i * 0.68
		var branch_z := _branch_z_at_x(branch,x)
		var length := absf(branch_z+14.0) + 2.7
		_tie(batch,Vector3(x,0,(-14+branch_z)*0.5),length,0.0,sleeper,dark,bolts)
	batch.ballast(Vector3(6,0.09,-8),34.0,gravel)
	for side in [-1,1]:
		_rail_segment(batch,Vector3(-11,0,-8+RAIL_OFFSET*side),Vector3(23,0,-8+RAIL_OFFSET*side),rail_materials)
	for i in range(51):
		_tie(batch,Vector3(-11+i*0.68,0,-8),2.55,0.0,sleeper,dark,bolts)
	# Switch blades, linkage, check rails, and a hand-operated switch stand.
	G.beam(yard,Vector3(-26.7,0.47,-13.247),Vector3(-23.5,0.47,-12.98),0.038,rail_top)
	G.beam(yard,Vector3(-26.7,0.47,-14.75),Vector3(-23.5,0.47,-14.53),0.032,rail_top)
	G.rod(yard,Vector3(-25.8,0.29,-15.8),Vector3(-25.8,0.29,-12.7),0.028,steel)
	batch.box(Vector3(-25.8,0.3,-16.05),Vector3(0.38,0.24,0.35),dark)
	G.rod(yard,Vector3(-25.8,0.39,-16.05),Vector3(-25.8,1.0,-16.05),0.035,steel)
	G.rod(yard,Vector3(-25.8,1.0,-16.05),Vector3(-26.15,1.2,-16.05),0.029,steel)
	# Guard rails leave an open flange channel alongside the running rail.
	for x in [-21.6,-20.9]:
		batch.box(Vector3(x,0.43,-14.58),Vector3(1.2,0.13,0.055),rail_top)
	# Angled wing rails guide wheels through the frog on the diverging route.
	G.beam(yard,Vector3(-22.45,0.445,-13.47),Vector3(-21.15,0.445,-12.93),0.044,rail_top)
	G.beam(yard,Vector3(-21.15,0.445,-12.93),Vector3(-20.6,0.445,-12.72),0.044,rail_top)
	G.beam(yard,Vector3(-22.42,0.445,-13.38),Vector3(-21.08,0.445,-13.38),0.044,rail_top)
	_buffer(yard,batch,Vector3(23,0,-8),dark,steel)
	_flatcar(yard,batch,Vector3(5,0,-8),rail_materials,dark,steel,sleeper,bolts)
	_container(yard,batch,Vector3(-15,0.12,11),6.0,"SITE OFFICE",G.mat("e2e2cc",0.76),dark,steel)
	_container(yard,batch,Vector3(-9,0.12,11),3.0,"WC / SHOWERS",G.mat("cbd7cd",0.76),dark,steel)
	_stock(yard,batch,rail_materials,dark)
	_fuel(yard,batch,Vector3(18,0.12,4),dark,steel)
	var lamps: Array[OmniLight3D] = []
	for place in [Vector2(-20,5),Vector2(-5,7),Vector2(17,10),Vector2(22,-4)]:
		lamps.append(_lamp(yard,batch,Vector3(place.x,0.12,place.y),dark,steel))
	_powerline(yard,batch,dark,sleeper)
	batch.finish(yard)
	return {"lamps":lamps,"rail_gauge_m":GAUGE,"static_draw_groups":batch.groups.size(),"branch_end":Vector3(23,0,-8)}

static func _bezier(a: Vector3,b: Vector3,c: Vector3,d: Vector3,t: float)->Vector3:
	return a*pow(1-t,3)+b*(3*pow(1-t,2)*t)+c*(3*(1-t)*t*t)+d*t*t*t

static func _branch_z_at_x(points: Array[Vector3], x: float) -> float:
	for i in range(points.size()-1):
		if points[i+1].x >= x:
			return lerpf(points[i].z,points[i+1].z,(x-points[i].x)/maxf(0.001,points[i+1].x-points[i].x))
	return points[-1].z

static func _rail_segment(b: Batch,a: Vector3,c: Vector3,m: Array)->void:
	var delta := c-a
	var yaw := -atan2(delta.z,delta.x)
	var center := (a+c)*0.5
	var length := a.distance_to(c)+0.008
	b.box(center+Vector3(0,0.31,0),Vector3(length,0.038,0.14),m[2],yaw)
	b.box(center+Vector3(0,0.375,0),Vector3(length,0.10,0.018),m[1],yaw)
	b.box(center+Vector3(0,0.45,0),Vector3(length,0.05,0.07),m[0],yaw)

static func _tie(b: Batch,p: Vector3,length: float,yaw: float,wood: Material,plate: Material,bolt: Material)->void:
	b.box(p+Vector3(0,0.215,0),Vector3(0.22,0.17,length),wood,yaw)
	var rotate := Basis(Vector3.UP,yaw)
	for side in [-1,1]:
		var pad := p+rotate*Vector3(0,0,RAIL_OFFSET*side)
		b.box(pad+Vector3(0,0.303,0),Vector3(0.29,0.022,0.28),plate,yaw)
		for z in [-0.105,0.105]:
			b.box(pad+rotate*Vector3(0,0.328,z),Vector3(0.045,0.04,0.035),bolt,yaw)

static func _buffer(parent:Node3D,b:Batch,p:Vector3,dark:Material,steel:Material)->void:
	var red := G.mat("bb4835",0.66)
	for side in [-1,1]:
		G.beam(parent,p+Vector3(0,0.32,side*0.74),p+Vector3(0,1.25,side*0.74),0.13,dark)
		G.beam(parent,p+Vector3(1.25,0.33,side*0.74),p+Vector3(0,1.12,side*0.74),0.11,dark)
		b.box(p+Vector3(0,0.39,side*0.74),Vector3(0.4,0.13,0.21),steel)
	b.box(p+Vector3(-0.09,1.08,0),Vector3(0.19,0.35,2.0),red)
	b.box(p+Vector3(-0.21,1.08,0),Vector3(0.08,0.19,0.60),dark)

static func _flatcar(parent:Node3D,b:Batch,p:Vector3,rail:Array,dark:Material,steel:Material,wood:Material,bolts:Material)->void:
	var wagon := G.mat("5c6a53",0.71,0.40)
	var tire := G.mat("343b3c",0.68,0.6)
	b.box(p+Vector3(0,1.05,0),Vector3(11,0.24,2.75),wagon)
	for z in [-1.37,1.37]:
		b.box(p+Vector3(0,1.23,z),Vector3(11,0.17,0.07),steel)
		b.box(p+Vector3(0,0.92,z),Vector3(10.7,0.08,0.04),dark)
	for i in range(43):
		b.box(p+Vector3(-5.35+i*0.25,1.2,0),Vector3(0.235,0.11,2.65),wood)
	for truck_x in [-3.55,3.55]:
		b.box(p+Vector3(truck_x,0.76,0),Vector3(1.85,0.16,1.75),dark)
		for axle_x in [-0.6,0.6]:
			G.rod(parent,p+Vector3(truck_x+axle_x,0.67,-1.06),p+Vector3(truck_x+axle_x,0.67,1.06),0.065,steel)
			for side in [-1,1]:
				var wheel := G.cylinder(parent,p+Vector3(truck_x+axle_x,0.67,side*0.76),0.32,0.12,tire,24)
				wheel.rotation.x=PI*0.5
				var hub := G.cylinder(parent,p+Vector3(truck_x+axle_x,0.67,side*0.84),0.105,0.08,bolts,16)
				hub.rotation.x=PI*0.5
		for side in [-1,1]:
			b.box(p+Vector3(truck_x,0.69,side*0.91),Vector3(1.9,0.14,0.10),wagon)
			for spring_x in [-0.14,0.14]:
				G.cylinder(parent,p+Vector3(truck_x+spring_x,0.78,side*0.87),0.06,0.18,dark,10)
	for end in [-1,1]:
		b.box(p+Vector3(end*5.7,0.9,0),Vector3(0.5,0.12,0.13),dark)
		for z in [-0.9,0.9]:
			G.rod(parent,p+Vector3(end*5.5,0.9,z),p+Vector3(end*5.8,0.9,z),0.07,steel)
			var buffer := G.cylinder(parent,p+Vector3(end*5.85,0.9,z),0.14,0.05,dark,16)
			buffer.rotation.z=PI*0.5
	for load_x in [-2.8,2.8]:
		for support_x in [-1.9,1.9]:
			b.box(p+Vector3(load_x+support_x,1.34,0),Vector3(0.15,0.15,2.1),wood)
		for level in range(3):
			_rail_panel(b,p+Vector3(load_x,1.32+level*0.27,0),rail,wood,5.0)
		for strap_x in [-1.7,1.7]:
			var strap := G.mat("5b4033",0.76)
			b.box(p+Vector3(load_x+strap_x,2.095,0),Vector3(0.045,0.025,2.08),strap)
			for z in [-1.02,1.02]:
				b.box(p+Vector3(load_x+strap_x,1.72,z),Vector3(0.045,0.76,0.025),strap)
	# Small legible identification rather than billboard-sized labels.
	var plate := G.label(parent,"FLAT 014 · 40 t",p+Vector3(0,1.07,1.415),28,0.004)
	plate.modulate = Color("e6e4c7")

static func _rail_panel(b:Batch,p:Vector3,rail:Array,wood:Material,length:float=5.0)->void:
	for i in range(8):
		b.box(p+Vector3(-length*0.45+i*length*0.9/7.0,0.05,0),Vector3(0.21,0.10,2.15),wood)
	for side in [-1,1]:
		var center := p+Vector3(0,0,side*RAIL_OFFSET)
		b.box(center+Vector3(0,0.12,0),Vector3(length,0.025,0.14),rail[2])
		b.box(center+Vector3(0,0.17,0),Vector3(length,0.08,0.017),rail[1])
		b.box(center+Vector3(0,0.22,0),Vector3(length,0.04,0.07),rail[0])

static func _container(parent:Node3D,b:Batch,p:Vector3,width:float,caption:String,siding:Material,dark:Material,steel:Material)->void:
	var roof := G.mat("eff0df",0.64,0.23)
	var glass := G.mat("364e57",0.23,0.44)
	var frame := G.mat("d9e0d6",0.54,0.45)
	for x in [-width*0.5+0.2,width*0.5-0.2]:
		for z in [-1.25,1.25]:
			b.box(p+Vector3(x,0.13,z),Vector3(0.38,0.26,0.40),dark)
	b.box(p+Vector3(0,1.57,0),Vector3(width,2.68,3.0),siding)
	for i in range(int(width/0.12)):
		var x := -width*0.5+0.05+i*0.12
		for z in [-1.515,1.515]:
			b.box(p+Vector3(x,1.59,z),Vector3(0.042,2.56,0.030),roof)
	for z_index in range(24):
		var z := -1.43 + z_index*0.12
		for x in [-width*0.5-0.015,width*0.5+0.015]:
			b.box(p+Vector3(x,1.59,z),Vector3(0.03,2.56,0.038),roof)
	b.box(p+Vector3(0,2.97,0),Vector3(width+0.16,0.12,3.12),steel)
	for i in range(int(width/0.16)):
		b.box(p+Vector3(-width*0.5+i*0.16,3.046,0),Vector3(0.055,0.04,3.11),roof)
	for x in [-width*0.5,width*0.5]:
		for z in [-1.52,1.52]:
			b.box(p+Vector3(x,1.56,z),Vector3(0.09,2.85,0.1),steel)
	var door_x := -width*0.5+0.84
	b.box(p+Vector3(door_x,1.27,1.546),Vector3(0.91,2.1,0.045),dark)
	b.box(p+Vector3(door_x,1.26,1.58),Vector3(0.79,1.98,0.05),frame)
	b.box(p+Vector3(door_x,1.85,1.616),Vector3(0.58,0.55,0.017),glass)
	b.box(p+Vector3(door_x+0.27,1.15,1.62),Vector3(0.06,0.10,0.08),steel)
	for i in range(3):
		b.box(p+Vector3(door_x,0.07+i*0.075,2.07-i*0.18),Vector3(1.1,0.10,0.5),dark)
	for side in [-1,1]:
		G.rod(parent,p+Vector3(door_x+0.53*side,0.12,2.2),p+Vector3(door_x+0.53*side,1.05,1.55),0.025,steel)
	if width > 4:
		for window_x in [0.45,1.92]:
			b.box(p+Vector3(window_x,1.82,1.545),Vector3(1.17,1.0,0.045),dark)
			b.box(p+Vector3(window_x,1.82,1.59),Vector3(1.04,0.85,0.025),glass)
			b.box(p+Vector3(window_x,1.82,1.61),Vector3(0.035,0.91,0.022),frame)
			b.box(p+Vector3(window_x,1.36,1.61),Vector3(1.16,0.07,0.06),frame)
			b.box(p+Vector3(window_x,2.28,1.61),Vector3(1.16,0.07,0.06),frame)
	else:
		b.box(p+Vector3(0.7,2.48,1.55),Vector3(0.7,0.3,0.035),dark)
		for i in range(5):
			b.box(p+Vector3(0.7,2.37+i*0.052,1.58),Vector3(0.65,0.016,0.032),steel)
	var sign_width := 3.2 if width>4 else 2.25
	b.box(p+Vector3(0,2.65,1.57),Vector3(sign_width,0.38,0.04),G.mat("253d3b",0.80))
	var text := G.label(parent,caption,p+Vector3(0,2.65,1.608),34,0.008)
	text.modulate=Color("eff2da")

static func _stock(parent:Node3D,b:Batch,rail:Array,dark:Material)->void:
	var slab := G.mat("c9c8b4",0.94)
	var timber := G.mat("8f693c",0.88)
	for stack_x in [0.0,1.25]:
		for x in [-0.32,0.32]:
			b.box(Vector3(stack_x+x,0.23,14),Vector3(0.11,0.18,1.0),timber)
		for i in range(8):
			b.box(Vector3(stack_x,0.35+i*0.115,14),Vector3(0.98,0.105,0.98),slab)
		for x in [-0.33,0.33]:
			for z in [-0.33,0.33]:
				var hole:=G.cylinder(parent,Vector3(stack_x+x,1.212,14+z),0.028,0.004,dark,8)
				hole.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for level in range(4):
		_rail_panel(b,Vector3(6.0,0.20+level*0.28,14),rail,timber)
	for x in [4.1,7.9]:
		b.box(Vector3(x,0.19,14),Vector3(0.18,0.14,2.15),timber)
	var bin_mat:=G.mat("aaa994",0.96)
	var bin_p:=Vector3(-4,0.12,14)
	for x in [-1.47,1.47]:
		b.box(bin_p+Vector3(x,0.5,0),Vector3(0.16,1.0,3.0),bin_mat)
	for z in [-1.47,1.47]:
		b.box(bin_p+Vector3(0,0.5,z),Vector3(3.0,1.0,0.16),bin_mat)
	var rubble:=G.mat("73786d",0.98)
	var rng:=RandomNumberGenerator.new()
	rng.seed=71035
	for i in range(95):
		var x:=rng.randf_range(-1.25,1.25)
		var z:=rng.randf_range(-1.25,1.25)
		var rise:=maxf(0.0,1.0-Vector2(x,z).length()/1.8)*0.43
		var rock:=G.sphere(parent,bin_p+Vector3(x,0.22+rise,z),rng.randf_range(0.10,0.23),rubble)
		rock.scale=Vector3(1.25,rng.randf_range(0.60,1.0),0.95)
		rock.rotation=Vector3(rng.randf(),rng.randf(),rng.randf())

static func _fuel(parent:Node3D,b:Batch,p:Vector3,dark:Material,steel:Material)->void:
	var red:=G.mat("ae563b",0.72,0.32)
	G.cylinder(parent,p+Vector3(0,0.48,0),0.33,0.91,red,24)
	for y in [0.12,0.39,0.72,0.92]:
		G.cylinder(parent,p+Vector3(0,y,0),0.341,0.023,steel,24)
	G.cylinder(parent,p+Vector3(0.12,0.965,0.08),0.05,0.045,dark,12)
	b.box(p+Vector3(0.89,0.36,0),Vector3(0.42,0.72,0.40),G.mat("d3a72d",0.62,0.25))
	b.box(p+Vector3(0.89,0.70,0.209),Vector3(0.30,0.25,0.028),dark)
	b.box(p+Vector3(0.89,0.72,0.228),Vector3(0.23,0.095,0.012),G.mat("ddd9b9",0.75))
	var previous:=p+Vector3(0.0,0.98,0.0)
	for i in range(1,17):
		var t:=float(i)/16.0
		var next:=p+Vector3(0.84*t,0.98+sin(t*PI)*0.20-0.25*t,0.15*sin(t*PI))
		G.rod(parent,previous,next,0.025,dark,8)
		previous=next
	G.label(parent,"DIESEL",p+Vector3(0,0.55,0.355),28,0.004)

static func _lamp(parent:Node3D,b:Batch,p:Vector3,dark:Material,steel:Material)->OmniLight3D:
	b.box(p+Vector3(0,0.11,0),Vector3(0.66,0.22,0.66),G.mat("aaa99b",0.93))
	b.box(p+Vector3(0,0.25,0),Vector3(0.32,0.06,0.32),steel)
	G.cylinder(parent,p+Vector3(0,2.37,0),0.058,4.26,dark,16)
	G.rod(parent,p+Vector3(0,4.5,0),p+Vector3(0.45,4.5,0),0.027,dark,12)
	var bulb:=G.mat("fff4c9",0.45)
	var globe:=G.sphere(parent,p+Vector3(0.45,4.24,0),0.19,bulb)
	globe.scale.y=1.18
	globe.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	G.cylinder(parent,p+Vector3(0.45,4.48,0),0.21,0.055,dark,16)
	var lamp:=OmniLight3D.new()
	lamp.position=p+Vector3(0.45,4.24,0)
	lamp.light_color=Color("ffd699")
	lamp.light_energy=0.0
	lamp.omni_range=10.0
	lamp.omni_attenuation=1.2
	lamp.shadow_enabled=true
	lamp.shadow_bias=0.035
	lamp.light_size=0.20
	lamp.set_meta("lamp_glass",bulb)
	parent.add_child(lamp)
	return lamp

static func _powerline(parent:Node3D,b:Batch,dark:Material,wood:Material)->void:
	var insulator:=G.mat("c8d4cd",0.35)
	for x in [-48,-24,0,24,48]:
		G.cylinder(parent,Vector3(x,3.1,-29),0.10,6.2,wood,12)
		b.box(Vector3(x,5.92,-29),Vector3(0.16,0.16,2.0),dark)
		for z in [-29.75,-29.0,-28.25]:
			G.cylinder(parent,Vector3(x,6.14,z),0.062,0.22,insulator,12)
	for first_x in [-48,-24,0,24]:
		for z in [-29.75,-29.0,-28.25]:
			var previous:=Vector3(first_x,6.25,z)
			for i in range(1,13):
				var t:=float(i)/12.0
				var next:=Vector3(first_x+t*24,6.25-0.48*sin(t*PI),z)
				G.rod(parent,previous,next,0.015,dark,6)
				previous=next

static func _ballast_material() -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode specular_disabled;
varying vec3 world_position;
vec2 stone_hash(vec2 p) {
	return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
}
void vertex() {
	world_position = (MODEL_MATRIX * vec4(VERTEX,1.0)).xyz;
}
void fragment() {
	vec2 p = world_position.xz * 12.0;
	vec2 cell = floor(p);
	vec2 local = fract(p);
	float nearest = 2.0;
	float stone_color = 0.0;
	for (int x = -1; x <= 1; x++) {
		for (int z = -1; z <= 1; z++) {
			vec2 offset = vec2(float(x),float(z));
			vec2 center = offset + 0.12 + stone_hash(cell+offset)*0.76;
			float distance_to_center = length((center-local)*vec2(1.0,1.25));
			if (distance_to_center < nearest) {
				nearest = distance_to_center;
				stone_color = stone_hash(cell+offset).x;
			}
		}
	}
	float fine = fract(sin(dot(floor(world_position.xz*105.0),vec2(12.9898,78.233)))*43758.5453);
	float dark_edge = smoothstep(0.20,0.58,nearest);
	vec3 gray_stone = mix(vec3(0.29,0.30,0.27),vec3(0.55,0.54,0.47),stone_color);
	ALBEDO = gray_stone * (1.0-dark_edge*0.30) * mix(0.88,1.10,fine);
	ROUGHNESS = 0.97;
}
"""
	var material := ShaderMaterial.new()
	material.shader = shader
	return material
