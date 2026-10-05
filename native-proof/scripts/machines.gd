extends RefCounted

# Native proof models: every dimension is in meters, with contact at local y = 0.
const G = preload("res://scripts/geometry.gd")

static func build(root: Node3D) -> Dictionary:
	var m: Dictionary = {
		"yellow": G.mat("db9b15", 0.25, 0.08),
		"yellow_light": G.mat("ebb21c", 0.22, 0.06),
		"yellow_dark": G.mat("a87913", 0.43, 0.07),
		"steel": G.mat("46545b", 0.36, 0.55),
		"bright_steel": G.mat("c0c8c9", 0.14, 0.94),
		"rubber": G.mat("1b2429", 0.83),
		"tread": G.mat("4a5558", 0.54, 0.38),
		"black": G.mat("172629", 0.73),
		"glass": G.mat("182e3b", 0.115, 0.24),
		"glass_light": G.mat("345766", 0.16, 0.28),
		"seat": G.mat("333f40", 0.97),
		"cream": G.mat("e5e9e0", 0.29, 0.09),
		"orange": G.mat("ed7f24", 0.52),
		"navy": G.mat("334553", 0.95),
		"skin": G.mat("cb9872", 0.94),
		"reflective": G.mat("e5e9b7", 0.55),
		"hardhat": G.mat("f5c32d", 0.29),
		"white_hat": G.mat("f0f0e5", 0.30),
		"red": G.mat("be4e38", 0.42),
		"light": G.mat("ffecd4", 0.23),
		"concrete": G.mat("b4b6a6", 0.92),
		"wood": G.mat("927347", 0.96),
	}
	# Separate thin glazing makes the interior readable without a solid glass cube.
	for glass_key: String in ["glass", "glass_light"]:
		var glazing: StandardMaterial3D = m[glass_key] as StandardMaterial3D
		glazing.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		glazing.albedo_color.a = 0.86
	var excavator: Node3D = _excavator(root, Vector3(2, 0.12, 1), m)
	var forklift: Node3D = _forklift(root, Vector3(12, 0.12, 13), m)
	var truck: Node3D = _truck(root, Vector3(-23, 0.12, -1), m)
	var workers: Array[Node3D] = []
	workers.append(_worker(root, Vector3(-1.2, 0.12, -2.0), 0.18, m, "Worker #1"))
	workers.append(_worker(root, Vector3(9.5, 0.13, 12), -0.5, m, "Worker #2"))
	workers.append(_worker(root, Vector3(-20.5, 0.13, -1.8), -0.3, m, "Worker #3"))
	workers.append(_worker(root,Vector3(15,0,5),-0.55,m,"Worker #4"))
	workers.append(_worker(root,Vector3(0,0.13,12),0.40,m,"Worker #5"))
	workers.append(_worker(root,Vector3(-21,0.13,2),-0.65,m,"Worker #6"))
	return {"excavator": excavator, "forklift": forklift, "truck": truck, "workers": workers}

static func _node(parent: Node3D, name_text: String, position: Vector3) -> Node3D:
	var node: Node3D = Node3D.new()
	node.name = name_text
	parent.add_child(node)
	node.position = position
	return node

# An extruded outline gives the bucket, boom, and counterweight actual shaped sides.
static func _profile(parent: Node3D, points: Array[Vector2], width: float, material: Material, x_offset: float = 0.0) -> MeshInstance3D:
	var vertices: Array[Vector3] = []
	var normals: Array[Vector3] = []
	var count: int = points.size()
	var area: float = 0.0
	var minimum_edge: float = 1000.0
	for i: int in range(count):
		var j: int = (i+1)%count
		area += points[i].x*points[j].y-points[j].x*points[i].y
		minimum_edge = minf(minimum_edge,points[i].distance_to(points[j]))
	var bevel: float = minf(0.055,minf(width*0.16,minimum_edge*0.16))
	var edge_normals: Array[Vector2] = []
	for i: int in range(count):
		var edge: Vector2 = (points[(i+1)%count]-points[i]).normalized()
		edge_normals.append(Vector2(edge.y,-edge.x) if area>0.0 else Vector2(-edge.y,edge.x))
	var inset: Array[Vector2] = []
	var corner_normals: Array[Vector2] = []
	for i: int in range(count):
		var average: Vector2 = (edge_normals[(i+count-1)%count]+edge_normals[i]).normalized()
		var inset_distance: float = bevel/maxf(0.35,average.dot(edge_normals[i]))
		inset.append(points[i]-average*inset_distance)
		corner_normals.append(average)
	var triangles: PackedInt32Array = Geometry2D.triangulate_polygon(PackedVector2Array(inset))
	for side: int in [-1,1]:
		var side_normal: Vector3 = Vector3(side,0,0)
		for i: int in range(0,triangles.size(),3):
			var pa: Vector2 = inset[triangles[i]]
			var pb: Vector2 = inset[triangles[i+1]]
			var pc: Vector2 = inset[triangles[i+2]]
			G.triangle(vertices,normals,Vector3(x_offset+side*width*0.5,pa.y,pa.x),Vector3(x_offset+side*width*0.5,pb.y,pb.x),Vector3(x_offset+side*width*0.5,pc.y,pc.x),side_normal,side_normal,side_normal)
		for i: int in range(count):
			var j: int = (i+1)%count
			for segment: int in range(4):
				var angle_a: float = float(segment)*PI/8.0
				var angle_b: float = float(segment+1)*PI/8.0
				var ai: Vector2 = inset[i].lerp(points[i],sin(angle_a))
				var aj: Vector2 = inset[j].lerp(points[j],sin(angle_a))
				var bi: Vector2 = inset[i].lerp(points[i],sin(angle_b))
				var bj: Vector2 = inset[j].lerp(points[j],sin(angle_b))
				var xa: float = x_offset+side*(width*0.5-bevel+bevel*cos(angle_a))
				var xb: float = x_offset+side*(width*0.5-bevel+bevel*cos(angle_b))
				var a: Vector3 = Vector3(xa,ai.y,ai.x)
				var b: Vector3 = Vector3(xa,aj.y,aj.x)
				var c: Vector3 = Vector3(xb,bj.y,bj.x)
				var d: Vector3 = Vector3(xb,bi.y,bi.x)
				var ni: Vector3 = Vector3(0,corner_normals[i].y,corner_normals[i].x)
				var nj: Vector3 = Vector3(0,corner_normals[j].y,corner_normals[j].x)
				var na: Vector3 = (side_normal*cos(angle_a)+ni*sin(angle_a)).normalized()
				var nb: Vector3 = (side_normal*cos(angle_a)+nj*sin(angle_a)).normalized()
				var nc: Vector3 = (side_normal*cos(angle_b)+nj*sin(angle_b)).normalized()
				var nd: Vector3 = (side_normal*cos(angle_b)+ni*sin(angle_b)).normalized()
				G.triangle(vertices,normals,a,b,c,na,nb,nc)
				G.triangle(vertices,normals,a,c,d,na,nc,nd)
	for i: int in range(count):
		var j: int = (i+1)%count
		var x_left: float = x_offset-width*0.5+bevel
		var x_right: float = x_offset+width*0.5-bevel
		var a: Vector3 = Vector3(x_left,points[i].y,points[i].x)
		var b: Vector3 = Vector3(x_right,points[i].y,points[i].x)
		var c: Vector3 = Vector3(x_right,points[j].y,points[j].x)
		var d: Vector3 = Vector3(x_left,points[j].y,points[j].x)
		var ni: Vector3 = Vector3(0,corner_normals[i].y,corner_normals[i].x)
		var nj: Vector3 = Vector3(0,corner_normals[j].y,corner_normals[j].x)
		G.triangle(vertices,normals,a,b,c,ni,ni,nj)
		G.triangle(vertices,normals,a,c,d,ni,nj,nj)
	return G.instance(parent,G.surface(vertices,normals),material,Vector3.ZERO)

static func _axle(parent: Node3D, at: Vector3, radius: float, width: float, material: Material, sides: int = 20) -> MeshInstance3D:
	var wheel: MeshInstance3D = G.cylinder(parent, at, radius, width, material, sides)
	wheel.rotation.z = PI * 0.5
	return wheel

static func _bolt(parent: Node3D, at: Vector3, material: Material, radius: float = 0.035) -> void:
	_axle(parent, at, radius, 0.025, material, 6)

static func _hose(parent: Node3D, points: Array[Vector3], material: Material, radius: float = 0.021) -> void:
	for i: int in range(points.size() - 1):
		G.rod(parent, points[i], points[i + 1], radius, material, 8)

static func _hydraulic(parent: Node3D, a: Vector3, b: Vector3, m: Dictionary, radius: float = 0.08) -> void:
	var midpoint: Vector3 = a.lerp(b, 0.57)
	G.rod(parent, a, midpoint, radius, m.yellow, 16)
	G.rod(parent, midpoint, b, radius * 0.49, m.bright_steel, 12)
	G.rod(parent, a.lerp(b, 0.04), a.lerp(b, 0.12), radius * 1.15, m.steel, 16)
	G.rod(parent, a.lerp(b, 0.52), a.lerp(b, 0.59), radius * 1.16, m.steel, 16)
	for p: Vector3 in [a, b]:
		_axle(parent, p, radius * 0.82, 0.16, m.steel, 16)

static func _track(parent: Node3D, x: float, m: Dictionary) -> void:
	# Capsule outline: curved tread returns, rather than a rectangular black box.
	var track: Node3D = _node(parent, "Track", Vector3(x, 0, 0))
	G.beveled_box(track, Vector3(0, 0.43, 0), Vector3(0.45, 0.39, 2.9), m.black)
	for z: float in [-1.25, -0.8, -0.4, 0, 0.4, 0.8, 1.25]:
		var radius: float = 0.29 if absf(z) > 1 else 0.205
		_axle(track, Vector3(0, 0.35, z), radius, 0.52, m.steel, 20)
		for sign_x: int in [-1, 1]:
			_axle(track, Vector3(sign_x * 0.273, 0.35, z), radius * 0.69, 0.018, m.tread, 16)
			_axle(track, Vector3(sign_x * 0.29, 0.35, z), radius * 0.26, 0.023, m.bright_steel, 12)
	for i: int in range(18):
		var z: float = -1.35 + float(i) * 0.159
		for y: float in [0.045, 0.655]:
			G.beveled_box(track, Vector3(0, y, z), Vector3(0.66, 0.075, 0.14), m.tread)
			G.beveled_box(track, Vector3(0, y + 0.046, z), Vector3(0.58, 0.027, 0.035), m.steel)
	for end_sign: int in [-1, 1]:
		for i: int in range(8):
			var angle: float = -PI * 0.5 + (float(i) + 0.5) * PI / 8.0
			var z: float = end_sign * (1.38 + cos(angle) * 0.305)
			var y: float = 0.35 + sin(angle) * 0.305
			var pad: MeshInstance3D = G.beveled_box(track, Vector3(0, y, z), Vector3(0.66, 0.075, 0.135), m.tread)
			pad.rotation.x = -end_sign * angle + PI * 0.5
	G.beveled_box(track, Vector3(0, 0.57, 0), Vector3(0.29, 0.10, 2.5), m.yellow_dark)

static func _excavator(parent: Node3D, at: Vector3, m: Dictionary) -> Node3D:
	var e: Node3D = _node(parent, "EX_001", at)
	_track(e, -0.88, m)
	_track(e, 0.88, m)
	G.beveled_box(e, Vector3(0, 0.62, 0), Vector3(1.55, 0.32, 2.35), m.steel)
	G.cylinder(e, Vector3(0, 0.88, 0), 0.7, 0.18, m.black, 32)
	G.cylinder(e, Vector3(0, 1.00, 0), 0.8, 0.12, m.steel, 32)
	G.beveled_box(e, Vector3(0, 1.11, 0.08), Vector3(2.17, 0.23, 2.42), m.yellow)
	_profile(e, [Vector2(0.35, 1.21), Vector2(1.15, 1.21), Vector2(1.43, 1.42), Vector2(1.42, 1.89), Vector2(1.21, 2.0), Vector2(0.35, 2.0)], 2.14, m.yellow)
	G.beveled_box(e, Vector3(0.54, 1.955, 0.61), Vector3(0.97, 0.035, 0.85), m.black, 0.008)
	G.beveled_box(e, Vector3(0.54, 1.987, 0.61), Vector3(0.91, 0.045, 0.77), m.yellow_light, 0.011)
	for hatch_x: float in [0.19,0.89]:
		for hatch_z: float in [0.33,0.90]:
			G.cylinder(e,Vector3(hatch_x,2.016,hatch_z),0.026,0.014,m.steel,6)
	G.rod(e,Vector3(0.56,2.04,0.73),Vector3(0.56,2.04,0.90),0.018,m.bright_steel,10)
	G.rod(e,Vector3(0.56,2.012,0.73),Vector3(0.56,2.04,0.73),0.016,m.steel,10)
	G.rod(e,Vector3(0.56,2.012,0.90),Vector3(0.56,2.04,0.90),0.016,m.steel,10)
	G.beveled_box(e, Vector3(0.77, 1.57, 0.35), Vector3(0.43, 0.66, 1.23), m.yellow)
	# Service door gaskets and hinges break up the broad painted body panels.
	G.box(e,Vector3(1.092,1.57,0.41),Vector3(0.012,0.56,1.04),m.yellow_dark)
	G.beveled_box(e,Vector3(1.10,1.57,0.41),Vector3(0.015,0.515,0.99),m.yellow_light)
	for hinge_z: float in [0.0,0.73]:
		G.cylinder(e,Vector3(1.115,1.53,hinge_z),0.035,0.16,m.steel,12)
	G.beveled_box(e,Vector3(1.115,1.47,0.60),Vector3(0.025,0.035,0.16),m.black)
	for rivet_z: float in [0.07,0.81]:
		for rivet_y: float in [1.37,1.77]:
			_bolt(e,Vector3(1.13,rivet_y,rivet_z),m.steel,0.022)
	# Rear radiator and side ventilation, with inset louvers.
	G.beveled_box(e, Vector3(0, 1.58, 1.441), Vector3(1.4, 0.47, 0.023), m.black)
	for i: int in range(10):
		G.beveled_box(e, Vector3(0, 1.38 + i * 0.041, 1.456), Vector3(1.32, 0.014, 0.025), m.steel)
	for i: int in range(9):
		G.beveled_box(e, Vector3(1.085, 1.54, 0.20 + i * 0.079), Vector3(0.013, 0.38, 0.03), m.black)
	G.cylinder(e, Vector3(0.76, 2.19, 0.71), 0.049, 0.47, m.black, 12)
	G.cylinder(e, Vector3(0.76, 2.43, 0.71), 0.068, 0.035, m.steel, 12)
	# Cab separate from the engine housing. Glass panels sit within structural frames.
	var cab: Node3D = _node(e, "Cab", Vector3(-0.61, 0, -0.34))
	G.beveled_box(cab, Vector3(0, 1.26, 0), Vector3(0.9, 0.27, 1.30), m.yellow)
	for window_x: float in [-0.43,0.43]:
		G.box(cab, Vector3(window_x,2.03,0),Vector3(0.014,1.19,1.13),m.glass)
	G.box(cab,Vector3(0,2.03,0.57),Vector3(0.85,1.19,0.014),m.glass)
	G.box(cab,Vector3(0,1.69,-0.645),Vector3(0.85,0.54,0.014),m.glass)
	G.beveled_box(cab,Vector3(0,1.44,0.12),Vector3(0.47,0.12,0.48),m.seat)
	G.beveled_box(cab,Vector3(0,1.72,0.35),Vector3(0.47,0.49,0.13),m.seat)
	G.beveled_box(cab,Vector3(0,1.61,-0.41),Vector3(0.65,0.14,0.20),m.black)
	for control_x: float in [-0.25,0.25]:
		G.rod(cab,Vector3(control_x,1.47,-0.11),Vector3(control_x,1.69,-0.21),0.016,m.steel,10)
		G.sphere(cab,Vector3(control_x,1.69,-0.21),0.035,m.black)
	# Seated operator, feet at the controls and hands on the twin joysticks.
	G.beveled_box(cab,Vector3(0,1.82,0.11),Vector3(0.36,0.41,0.22),m.orange)
	G.box(cab,Vector3(0,1.78,-0.01),Vector3(0.37,0.035,0.01),m.reflective)
	for side: int in [-1,1]:
		G.rod(cab,Vector3(side*0.11,1.58,0.10),Vector3(side*0.11,1.57,-0.22),0.082,m.navy,10)
		G.rod(cab,Vector3(side*0.11,1.57,-0.22),Vector3(side*0.11,1.31,-0.31),0.073,m.navy,10)
		G.beveled_box(cab,Vector3(side*0.11,1.28,-0.35),Vector3(0.15,0.10,0.27),m.black)
		G.rod(cab,Vector3(side*0.22,1.96,0.1),Vector3(side*0.26,1.77,-0.11),0.047,m.navy,10)
		G.rod(cab,Vector3(side*0.26,1.77,-0.11),Vector3(side*0.25,1.7,-0.21),0.042,m.navy,10)
		G.sphere(cab,Vector3(side*0.25,1.7,-0.21),0.045,m.skin)
	G.sphere(cab,Vector3(0,2.17,0.08),0.105,m.skin)
	G.cylinder(cab,Vector3(0,2.27,0.08),0.14,0.025,m.hardhat,20)
	var driver_hat: MeshInstance3D = G.sphere(cab,Vector3(0,2.30,0.08),0.123,m.hardhat)
	driver_hat.scale.y=0.62
	G.beveled_box(cab, Vector3(0, 2.69, -0.035), Vector3(1.05, 0.11, 1.43), m.black)
	G.beveled_box(cab, Vector3(0, 2.76, -0.035), Vector3(1.03, 0.045, 1.40), m.yellow_light)
	G.beveled_box(cab,Vector3(0.10,2.79,0.13),Vector3(0.52,0.025,0.53),m.yellow,0.005)
	for roof_x: float in [-0.44,0.44]:
		for roof_z: float in [-0.60,0.52]:
			G.cylinder(cab,Vector3(roof_x,2.79,roof_z),0.02,0.014,m.steel,6)
	for x: float in [-0.46, 0.46]:
		for z: float in [-0.64, 0.57]:
			G.beam(cab, Vector3(x, 1.37, z), Vector3(x, 2.64, z), 0.066, m.black)
		G.beam(cab, Vector3(x, 1.94, -0.64), Vector3(x, 1.94, 0.57), 0.042, m.black)
		G.beam(cab, Vector3(x, 1.38, 0.03), Vector3(x, 2.62, 0.03), 0.046, m.black)
	for y: float in [1.39, 1.95, 2.64]:
		G.beam(cab, Vector3(-0.46, y, -0.65), Vector3(0.46, y, -0.65), 0.05, m.black)
	# Slightly lighter windshield distinguishes front from side glass.
	G.beveled_box(cab, Vector3(0, 2.29, -0.655), Vector3(0.80, 0.62, 0.014), m.glass_light)
	G.rod(cab, Vector3(-0.32, 2.02, -0.671), Vector3(0.19, 2.49, -0.671), 0.012, m.black, 8)
	G.beveled_box(cab, Vector3(-0.488, 1.79, 0.22), Vector3(0.03, 0.031, 0.19), m.bright_steel)
	G.beveled_box(cab, Vector3(-0.61, 1.09, 0.19), Vector3(0.40, 0.08, 0.55), m.steel)
	G.beveled_box(cab, Vector3(-0.63, 0.85, 0.19), Vector3(0.31, 0.07, 0.50), m.tread)
	G.beam(cab, Vector3(-0.53, 1.20, 0.62), Vector3(-0.53, 2.29, 0.62), 0.035, m.bright_steel)
	# Twin lifting plates follow the rising boom outline.
	var boom_shape: Array[Vector2] = [Vector2(-0.88, 1.33), Vector2(-1.15, 1.40), Vector2(-2.70, 3.03), Vector2(-2.66, 3.35), Vector2(-2.41, 3.43), Vector2(-0.90, 1.73)]
	_profile(e, boom_shape, 0.37, m.yellow_light, 0.42)
	var dipper_shape: Array[Vector2] = [Vector2(-2.62, 3.24), Vector2(-2.84, 3.23), Vector2(-3.68, 0.96), Vector2(-3.47, 0.84), Vector2(-3.28, 1.13), Vector2(-2.48, 3.06)]
	_profile(e, dipper_shape, 0.25, m.yellow, 0.42)
	for pivot: Vector3 in [Vector3(0.42, 1.52, -1.0), Vector3(0.42, 3.20, -2.64), Vector3(0.42, 1.06, -3.5)]:
		_axle(e, pivot, 0.116, 0.52, m.steel, 20)
		for side: int in [-1, 1]:
			_bolt(e, pivot + Vector3(side * 0.275, 0, 0), m.bright_steel, 0.069)
	_hydraulic(e, Vector3(0.42, 1.48, -0.63), Vector3(0.42, 2.74, -2.01), m, 0.105)
	_hydraulic(e, Vector3(0.42, 3.48, -2.52), Vector3(0.42, 2.06, -3.27), m, 0.075)
	_hydraulic(e, Vector3(0.42, 2.10, -3.26), Vector3(0.42, 1.24, -3.66), m, 0.054)
	# Bucket bowl has a curved rear and flared open lip; dark interior is visible.
	var bucket_shape: Array[Vector2] = [Vector2(-3.46, 1.06), Vector2(-3.27, 0.77), Vector2(-3.26, 0.36), Vector2(-3.43, 0.15), Vector2(-4.11, 0.12), Vector2(-4.25, 0.23), Vector2(-3.85, 0.51), Vector2(-3.73, 0.96)]
	_profile(e, bucket_shape, 0.73, m.steel, 0.42)
	G.beveled_box(e, Vector3(0.42, 0.26, -3.85), Vector3(0.59, 0.08, 0.43), m.black)
	for wear_x: float in [0.10,0.42,0.74]:
		G.beam(e,Vector3(wear_x,0.20,-3.43),Vector3(wear_x,0.17,-4.05),0.038,m.tread)
	for side_x: float in [0.035,0.805]:
		G.rod(e,Vector3(side_x,0.98,-3.60),Vector3(side_x,0.38,-3.32),0.035,m.bright_steel,10)
	for x: float in [0.12, 0.32, 0.52, 0.72]:
		var tooth: MeshInstance3D = G.beveled_box(e, Vector3(x, 0.15, -4.24), Vector3(0.09, 0.09, 0.24), m.bright_steel)
		tooth.rotation.x = -0.15
	G.beam(e, Vector3(0.42, 1.04, -3.55), Vector3(0.42, 1.32, -3.85), 0.08, m.steel)
	G.beam(e, Vector3(0.42, 1.32, -3.85), Vector3(0.42, 0.90, -3.77), 0.08, m.steel)
	_hose(e, [Vector3(0.59, 1.46, -0.5), Vector3(0.63, 1.95, -1.2), Vector3(0.63, 2.96, -2.33), Vector3(0.63, 3.40, -2.59), Vector3(0.63, 3.16, -2.91), Vector3(0.60, 1.21, -3.63)], m.black)
	_hose(e, [Vector3(0.25, 1.44, -0.5), Vector3(0.25, 2.01, -1.25), Vector3(0.25, 3.00, -2.35), Vector3(0.23, 3.36, -2.62), Vector3(0.23, 3.14, -2.88), Vector3(0.25, 1.26, -3.55)], m.black, 0.016)
	for p: Vector3 in [Vector3(-0.99, 2.71, -1.03), Vector3(-0.19, 2.71, -1.03)]:
		G.beveled_box(e, p, Vector3(0.19, 0.12, 0.1), m.black)
		G.beveled_box(e, p + Vector3(0, 0, -0.06), Vector3(0.14, 0.08, 0.015), m.light)
	G.cylinder(e, Vector3(0.75, 2.09, 0.90), 0.075, 0.11, m.orange, 12)
	var decal: Label3D = G.label(e, "EX-001", Vector3(1.09, 1.26, 0.22), 32, 0.006)
	decal.rotation.y = PI * 0.5
	return e

static func _wheel(parent: Node3D, at: Vector3, radius: float, width: float, m: Dictionary, treads: bool = true) -> void:
	_axle(parent, at, radius, width, m.rubber, 24)
	for side: int in [-1, 1]:
		var x: float = at.x + side * (width * 0.5 + 0.008)
		_axle(parent, Vector3(x, at.y, at.z), radius * 0.61, 0.021, m.steel, 20)
		_axle(parent, Vector3(x + side * 0.014, at.y, at.z), radius * 0.39, 0.025, m.cream, 20)
		_axle(parent, Vector3(x + side * 0.034, at.y, at.z), radius * 0.13, 0.04, m.steel, 12)
		for bolt_i: int in range(6):
			var angle: float = float(bolt_i) * TAU / 6.0
			_bolt(parent, Vector3(x + side * 0.035, at.y + sin(angle) * radius * 0.26, at.z + cos(angle) * radius * 0.26), m.bright_steel, 0.018)
	if treads:
		for i: int in range(20):
			var angle: float = float(i) * TAU / 20.0
			var tread: MeshInstance3D = G.beveled_box(parent, at + Vector3(0, sin(angle) * radius, cos(angle) * radius), Vector3(width * 0.98, 0.046, 0.09), m.rubber)
			tread.rotation.x = -angle + PI * 0.5

static func _forklift(parent: Node3D, at: Vector3, m: Dictionary) -> Node3D:
	var f: Node3D = _node(parent, "FL_001", at)
	G.beveled_box(f, Vector3(0, 0.42, 0.15), Vector3(1.24, 0.46, 2.04), m.yellow)
	G.beveled_box(f, Vector3(0, 0.73, 0.72), Vector3(1.21, 0.55, 0.64), m.yellow_light)
	_profile(f, [Vector2(0.45, 0.45), Vector2(1.14, 0.48), Vector2(1.23, 0.64), Vector2(1.13, 0.97), Vector2(0.44, 1.06)], 1.22, m.yellow)
	for x: float in [-0.64, 0.64]:
		_wheel(f, Vector3(x, 0.38, -0.52), 0.38, 0.29, m)
		_wheel(f, Vector3(x * 0.84, 0.31, 0.80), 0.31, 0.24, m)
	G.beveled_box(f, Vector3(0, 0.68, -0.05), Vector3(0.97, 0.12, 0.81), m.black)
	G.beveled_box(f, Vector3(0, 0.94, 0.30), Vector3(0.47, 0.11, 0.42), m.seat)
	G.beveled_box(f, Vector3(0, 1.18, 0.49), Vector3(0.48, 0.54, 0.10), m.seat)
	for x: float in [-0.49, 0.49]:
		for z: float in [-0.47, 0.62]:
			G.beam(f, Vector3(x, 0.76, z), Vector3(x, 2.13, z), 0.06, m.steel)
	G.beveled_box(f, Vector3(0, 2.17, 0.06), Vector3(1.15, 0.07, 1.28), m.steel)
	for i: int in range(7):
		G.beveled_box(f, Vector3(-0.48 + i * 0.16, 2.24, 0.06), Vector3(0.055, 0.045, 1.19), m.steel)
	G.beveled_box(f, Vector3(0, 1.29, -0.46), Vector3(0.70, 0.18, 0.16), m.black)
	G.rod(f, Vector3(0.12, 0.87, -0.35), Vector3(0.12, 1.24, -0.41), 0.024, m.steel, 12)
	var steering: MeshInstance3D = G.cylinder(f, Vector3(0.12, 1.30, -0.43), 0.17, 0.035, m.black, 20)
	steering.rotation.x = 0.43
	for z: float in [-0.18, -0.03]:
		G.rod(f, Vector3(0.31, 0.8, z), Vector3(0.31, 1.19, z), 0.014, m.bright_steel, 8)
		G.sphere(f, Vector3(0.31, 1.19, z), 0.04, m.black)
	# Upright mast with recessed channels, chains, cylinder, and backrest.
	for x: float in [-0.46, 0.46]:
		G.beveled_box(f, Vector3(x, 1.37, -0.91), Vector3(0.16, 2.24, 0.14), m.steel)
		G.beveled_box(f, Vector3(x, 1.43, -0.994), Vector3(0.052, 2.14, 0.025), m.bright_steel)
		G.rod(f, Vector3(x * 0.63, 0.34, -0.97), Vector3(x * 0.63, 2.25, -0.97), 0.023, m.black, 8)
		_axle(f, Vector3(x * 0.63, 2.22, -0.97), 0.076, 0.047, m.steel, 16)
	G.beam(f, Vector3(-0.52, 2.49, -0.91), Vector3(0.52, 2.49, -0.91), 0.13, m.steel)
	G.beveled_box(f, Vector3(0, 0.50, -1.06), Vector3(1.19, 0.23, 0.12), m.steel)
	G.rod(f, Vector3(0, 0.35, -0.83), Vector3(0, 1.65, -0.83), 0.064, m.black, 16)
	G.rod(f, Vector3(0, 1.10, -0.83), Vector3(0, 2.32, -0.83), 0.028, m.bright_steel, 12)
	for x: float in [-0.51, -0.26, 0, 0.26, 0.51]:
		G.beveled_box(f, Vector3(x, 0.83, -1.085), Vector3(0.025, 0.93, 0.035), m.steel)
	for y: float in [0.41, 0.82, 1.29]:
		G.beveled_box(f, Vector3(0, y, -1.085), Vector3(1.13, 0.035, 0.04), m.steel)
	# Fork heels meet carriage, and load center lies over the full blades.
	for x: float in [-0.31, 0.31]:
		G.beveled_box(f, Vector3(x, 0.51, -1.13), Vector3(0.12, 0.51, 0.085), m.steel)
		G.beveled_box(f, Vector3(x, 0.28, -1.71), Vector3(0.12, 0.065, 1.23), m.bright_steel)
	for x: float in [-0.43, 0, 0.43]:
		G.beveled_box(f, Vector3(x, 0.385, -1.68), Vector3(0.13, 0.15, 1.03), m.wood)
	for i: int in range(5):
		G.beveled_box(f, Vector3(0, 0.483, -2.10 + i * 0.21), Vector3(1.10, 0.045, 0.18), m.wood)
	G.beveled_box(f, Vector3(0, 0.59, -1.68), Vector3(1.0, 0.17, 1.0), m.concrete)
	for x: float in [-0.40, 0.40]:
		for z: float in [-2.07, -1.29]:
			G.cylinder(f, Vector3(x, 0.679, z), 0.018, 0.008, m.steel, 8)
	G.beveled_box(f, Vector3(0, 0.59, 1.245), Vector3(0.68, 0.15, 0.023), m.black)
	for x: float in [-0.43, 0.43]:
		G.beveled_box(f, Vector3(x, 0.89, 1.14), Vector3(0.15, 0.08, 0.022), m.red)
	G.cylinder(f, Vector3(0.38, 2.33, 0.52), 0.058, 0.11, m.orange, 12)
	var decal: Label3D = G.label(f, "FL-001", Vector3(0.64, 0.72, 0.80), 28, 0.005)
	decal.rotation.y = PI * 0.5
	return f

static func _worker(parent: Node3D, at: Vector3, yaw: float, m: Dictionary, name_text: String) -> Node3D:
	var w: Node3D = _node(parent, name_text.replace(" ", "_"), at)
	w.rotation.y = yaw
	# Boots are in contact with the concrete rather than hovering above their shadows.
	for x: float in [-0.13, 0.13]:
		G.beveled_box(w, Vector3(x, 0.075, -0.045), Vector3(0.19, 0.15, 0.33), m.black)
		G.beveled_box(w, Vector3(x, 0.023, -0.045), Vector3(0.20, 0.035, 0.34), m.rubber)
		G.rod(w, Vector3(x, 0.15, 0), Vector3(x, 0.83, 0.02), 0.092, m.navy, 10)
	G.beveled_box(w, Vector3(0, 0.91, 0), Vector3(0.34, 0.20, 0.23), m.navy)
	G.beveled_box(w, Vector3(0, 1.20, 0), Vector3(0.42, 0.47, 0.24), m.orange)
	G.beveled_box(w, Vector3(0, 1.15, -0.127), Vector3(0.44, 0.055, 0.012), m.reflective)
	G.beveled_box(w, Vector3(0, 1.39, -0.127), Vector3(0.43, 0.043, 0.012), m.reflective)
	G.beveled_box(w, Vector3(0, 1.15, 0.127), Vector3(0.44, 0.055, 0.012), m.reflective)
	for x: float in [-0.12, 0.12]:
		G.beveled_box(w, Vector3(x, 1.26, -0.134), Vector3(0.035, 0.41, 0.014), m.reflective)
	for sign_x: int in [-1, 1]:
		var shoulder: Vector3 = Vector3(sign_x * 0.25, 1.37, 0)
		var elbow: Vector3 = Vector3(sign_x * 0.29, 1.13, -0.014)
		var wrist: Vector3 = Vector3(sign_x * 0.32, 0.94, -0.11)
		G.rod(w, shoulder, elbow, 0.065, m.navy, 10)
		G.rod(w, elbow, wrist, 0.052, m.navy, 10)
		G.sphere(w, wrist, 0.065, m.skin)
	G.cylinder(w, Vector3(0, 1.49, 0), 0.066, 0.08, m.skin, 12)
	var head: MeshInstance3D = G.sphere(w, Vector3(0, 1.62, -0.008), 0.124, m.skin)
	head.scale = Vector3(0.84, 1.04, 0.89)
	G.sphere(w, Vector3(0, 1.62, -0.12), 0.026, m.skin)
	G.cylinder(w, Vector3(0, 1.75, 0), 0.164, 0.032, m.white_hat, 20)
	var hat: MeshInstance3D = G.sphere(w, Vector3(0, 1.786, 0), 0.145, m.white_hat)
	hat.scale = Vector3(1, 0.62, 1)
	G.beveled_box(w, Vector3(0, 1.87, 0), Vector3(0.029, 0.024, 0.18), m.cream)
	return w

static func _truck(parent: Node3D, at: Vector3, m: Dictionary) -> Node3D:
	var t: Node3D = _node(parent, "Delivery_Truck", at)
	G.beveled_box(t, Vector3(0, 0.49, 0.42), Vector3(1.6, 0.23, 5.74), m.steel)
	for axle_z: float in [-1.66, 1.84]:
		G.rod(t, Vector3(-1.08, 0.44, axle_z), Vector3(1.08, 0.44, axle_z), 0.09, m.steel, 12)
		for x: float in [-1.02, 1.02]:
			_wheel(t, Vector3(x, 0.44, axle_z), 0.44, 0.28, m)
	G.beveled_box(t, Vector3(0, 0.81, 0.88), Vector3(2.03, 0.18, 4.17), m.steel)
	for i: int in range(16):
		G.beveled_box(t, Vector3(-0.96 + i * 0.128, 0.918, 0.88), Vector3(0.12, 0.06, 4.11), m.wood)
	# Low folded sideboards with latches and upright corner stakes.
	for x: float in [-1.045, 1.045]:
		G.beveled_box(t, Vector3(x, 1.08, 0.89), Vector3(0.06, 0.27, 4.18), m.cream)
		for z: float in [-1.12, 0.19, 1.54, 2.85]:
			G.beveled_box(t, Vector3(x, 1.08, z), Vector3(0.08, 0.30, 0.055), m.steel)
			G.beveled_box(t, Vector3(x * 1.047, 1.02, z + 0.09), Vector3(0.024, 0.06, 0.05), m.steel)
	G.beveled_box(t, Vector3(0, 1.07, 2.99), Vector3(2.12, 0.29, 0.07), m.cream)
	# Shaped nose profile with cab glazing and metal pillars.
	_profile(t, [Vector2(-2.41, 0.7), Vector2(-2.53, 1.32), Vector2(-2.36, 2.29), Vector2(-2.21, 2.57), Vector2(-1.21, 2.57), Vector2(-1.16, 0.70)], 2.03, m.cream)
	G.beveled_box(t, Vector3(0, 2.63, -1.78), Vector3(2.10, 0.08, 1.51), m.cream)
	var windshield: MeshInstance3D = G.beveled_box(t, Vector3(0, 2.00, -2.41), Vector3(1.81, 0.81, 0.025), m.glass_light)
	windshield.rotation.x = -0.17
	G.beveled_box(t, Vector3(0, 2.01, -2.436), Vector3(0.065, 0.80, 0.04), m.cream)
	for x: float in [-1.025, 1.025]:
		G.beveled_box(t, Vector3(x, 2.06, -1.81), Vector3(0.017, 0.77, 0.93), m.glass)
		G.beveled_box(t, Vector3(x * 1.01, 1.68, -1.82), Vector3(0.019, 0.034, 1.08), m.steel)
		G.beveled_box(t, Vector3(x * 1.015, 1.49, -1.38), Vector3(0.025, 0.032, 0.15), m.steel)
		G.beveled_box(t, Vector3(x * 1.015, 1.09, -1.78), Vector3(0.03, 0.031, 1.13), m.steel)
		G.beam(t, Vector3(x, 1.97, -2.27), Vector3(x * 1.20, 2.0, -2.35), 0.026, m.steel)
		G.beveled_box(t, Vector3(x * 1.20, 2.05, -2.35), Vector3(0.075, 0.25, 0.18), m.black)
		G.beveled_box(t, Vector3(x * 1.20, 2.05, -2.25), Vector3(0.056, 0.21, 0.016), m.bright_steel)
		G.beveled_box(t, Vector3(x * 0.93, 0.78, -1.92), Vector3(0.45, 0.06, 0.55), m.tread)
	G.beveled_box(t, Vector3(0, 0.89, -2.57), Vector3(2.07, 0.19, 0.12), m.steel)
	G.beveled_box(t, Vector3(0, 1.25, -2.57), Vector3(0.90, 0.24, 0.028), m.black)
	for i: int in range(4):
		G.beveled_box(t, Vector3(0, 1.16 + i * 0.058, -2.59), Vector3(0.82, 0.014, 0.024), m.bright_steel)
	for x: float in [-0.78, 0.78]:
		G.beveled_box(t, Vector3(x, 1.21, -2.58), Vector3(0.28, 0.18, 0.045), m.light)
		G.beveled_box(t, Vector3(x, 1.05, -2.58), Vector3(0.15, 0.06, 0.044), m.orange)
		G.beveled_box(t, Vector3(x, 0.81, 3.03), Vector3(0.29, 0.12, 0.044), m.red)
	G.beveled_box(t, Vector3(0, 0.81, -2.65), Vector3(0.43, 0.11, 0.025), m.cream)
	for x: float in [-0.47, 0.47]:
		G.rod(t, Vector3(x - 0.19, 1.65, -2.5), Vector3(x + 0.19, 1.97, -2.45), 0.015, m.black, 8)
	# Three strapped concrete deliveries. Deck top = .948; pallet blocks start
	# exactly there, with each slab resting on the previous .10 m layer.
	for cargo_z: float in [-0.43,0.84,2.11]:
		for block_x: float in [-0.43,0,0.43]:
			G.beveled_box(t,Vector3(block_x,1.008,cargo_z),Vector3(0.12,0.12,1.10),m.wood,0.01)
		for plank_i: int in range(5):
			G.box(t,Vector3(0,1.083,cargo_z-0.44+plank_i*0.22),Vector3(1.10,0.03,0.18),m.wood)
		for layer: int in range(6):
			G.beveled_box(t,Vector3(0,1.148+layer*0.10,cargo_z),Vector3(1.0,0.10,1.0),m.concrete,0.006)
		for bolt_x: float in [-0.43,0.43]:
			for bolt_z: float in [-0.39,0.39]:
				G.cylinder(t,Vector3(bolt_x,1.104,cargo_z+bolt_z),0.019,0.008,m.steel,6)
		for insert_x: float in [-0.39,0.39]:
			for insert_z: float in [-0.39,0.39]:
				G.cylinder(t,Vector3(insert_x,1.703,cargo_z+insert_z),0.016,0.006,m.steel,12)
		for strap_z: float in [-0.26,0.26]:
			G.box(t,Vector3(0,1.708,cargo_z+strap_z),Vector3(1.027,0.012,0.026),m.steel)
			for strap_x: float in [-0.508,0.508]:
				G.box(t,Vector3(strap_x,1.386,cargo_z+strap_z),Vector3(0.012,0.65,0.026),m.steel)
	return t
