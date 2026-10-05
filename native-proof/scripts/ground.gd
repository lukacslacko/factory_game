extends RefCounted

const G = preload("res://scripts/geometry.gd")
const SURFACE = preload("res://shaders/ground.gdshader")

static func build(root: Node3D) -> Dictionary:
	var group := Node3D.new()
	group.name = "GroundAndVegetation"
	root.add_child(group)
	var ground_material := _surface(0, "9a855f", "c1ad87")
	var terrain := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(180, 150)
	terrain.mesh = plane
	terrain.material_override = ground_material
	terrain.name = "Earth"
	# This flat, undisplaced ground receives object shadows but does not
	# need to be redrawn as a shadow caster.
	terrain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	group.add_child(terrain)
	_road(group)
	var slabs := _paving(group)
	var vegetation := _vegetation(group)
	return {"ground_material": ground_material, "slab_count": slabs, "vegetation_instances": vegetation, "vegetation_draw_calls": 9}

static func _surface(kind: int, a: String, b: String) -> ShaderMaterial:
	var result := ShaderMaterial.new()
	result.shader = SURFACE
	result.set_shader_parameter("surface_kind", kind)
	result.set_shader_parameter("color_a", Color(a))
	result.set_shader_parameter("color_b", Color(b))
	if kind == 0:
		result.set_shader_parameter("dirt_diffuse", load("res://assets/textures/dirt_diff_2k.jpg"))
		result.set_shader_parameter("dirt_normal", load("res://assets/textures/dirt_nor_gl_1k.jpg"))
		result.set_shader_parameter("grass_diffuse", load("res://assets/textures/sparse_grass_diff_2k.jpg"))
		result.set_shader_parameter("grass_normal", load("res://assets/textures/sparse_grass_nor_gl_1k.jpg"))
	return result

static func _road(root: Node3D) -> void:
	var asphalt := _surface(2, "4e5255", "53565a")
	var shoulder := _surface(1, "9b998a", "c0bba4")
	G.box(root, Vector3(0, .018, -23), Vector3(180, .035, 8), asphalt)
	G.box(root, Vector3(0, .013, -27.5), Vector3(180, .024, 1), shoulder)
	G.box(root, Vector3(0, .013, -18.5), Vector3(180, .024, 1), shoulder)
	G.box(root, Vector3(-23, .023, -6.7), Vector3(6, .045, 24.6), asphalt)
	var paint := G.mat("d9dac5", .92)
	G.box(root, Vector3(0, .041, -26.8), Vector3(180, .004, .105), paint)
	G.box(root, Vector3(0, .041, -19.2), Vector3(180, .004, .105), paint)
	for x in range(-88, 89, 6):
		if abs(x + 23) > 5:
			G.box(root, Vector3(x, .042, -23), Vector3(3, .005, .115), paint)
	for z in [-17, -11, -5, 1]:
		G.box(root, Vector3(-23, .053, z), Vector3(.105, .004, 2.4), paint)
	# Wide gravel transitions soften the asphalt edge without a coplanar overlay.
	G.box(root, Vector3(-26.4, .012, -6.2), Vector3(.75, .023, 23.8), shoulder)
	G.box(root, Vector3(-19.6, .012, -6.2), Vector3(.75, .023, 23.8), shoulder)

static func _paved(x: float, z: float, margin := 0.0) -> bool:
	# Separate practical pads leave most of the miniature yard as soil.
	var rects: Array[Rect2] = [Rect2(-19, 4, 7, 7), Rect2(-11, 5, 4, 5), Rect2(-5, 7, 18, 8), Rect2(16, 1, 5, 6), Rect2(-26, -4, 6, 11)]
	for rect in rects:
		if rect.grow(margin).has_point(Vector2(x, z)):
			return true
	return false

static func _paving(root: Node3D) -> int:
	var transforms: Array[Transform3D] = []
	var colors: Array[Color] = []
	var rng := RandomNumberGenerator.new()
	rng.seed = 70193
	for z in range(-4, 20):
		for x in range(-27, 24):
			if not _paved(x + .5, z + .5):
				continue
			transforms.append(Transform3D(Basis.IDENTITY, Vector3(x + .5, .065, z + .5)))
			var shade := rng.randf_range(.92, 1.045)
			colors.append(Color(shade, shade, shade, 1))
	var slab := BoxMesh.new()
	slab.size = Vector3(.988, .13, .988)
	var material := _surface(1, "a8a18b", "c1b99f")
	_instances(root, "OneMeterConcreteSlabs", slab, material, transforms, colors)
	return transforms.size()

static func _clear(x: float, z: float) -> bool:
	if abs(z + 23) < 5.05 or (abs(x + 23) < 3.8 and z > -28 and z < 7):
		return false
	if abs(z + 14) < 2.1:
		return false
	if x > -28 and x < -10:
		var t: float = clampf((x + 27.0) / 16.0, 0, 1)
		var curve_z: float = -14 + 6 * (t * t * (3 - 2 * t))
		if abs(z - curve_z) < 2.2:
			return false
	if x >= -12 and x <= 25 and abs(z + 8) < 2.2:
		return false
	# Soil is exposed here, but machinery and its immediate working clearance remain clear.
	if Rect2(-1.8, -2.7, 7.0, 6.5).has_point(Vector2(x, z)):
		return false
	for lamp in [Vector2(-20,5), Vector2(-5,4), Vector2(17,8), Vector2(22,-4)]:
		if Vector2(x, z).distance_to(lamp) < .65:
			return false
	return not _paved(x, z, .35)

static func _plant_clear(point: Vector2, radius: float) -> bool:
	for offset in [Vector2.ZERO, Vector2(radius,0), Vector2(-radius,0), Vector2(0,radius), Vector2(0,-radius)]:
		if not _clear(point.x + offset.x, point.y + offset.y):
			return false
	return true

static func _vegetation(root: Node3D) -> int:
	var rng := RandomNumberGenerator.new()
	rng.seed = 3021047
	var green_x: Array[Transform3D] = []
	var green_c: Array[Color] = []
	var dry_x: Array[Transform3D] = []
	var dry_c: Array[Color] = []
	var herb_x: Array[Transform3D] = []
	var herb_c: Array[Color] = []
	var crown_x: Array = [[], [], []]
	var crown_c: Array = [[], [], []]
	var flower_x: Array[Transform3D] = []
	var flower_c: Array[Color] = []
	var rock_x: Array[Transform3D] = []
	var rock_c: Array[Color] = []
	var boulder_x: Array[Transform3D] = []
	var boulder_c: Array[Color] = []
	# Broad, visible clumps replace the previous field of barely readable tiny weeds.
	for i in range(8500):
		var x := rng.randf_range(-64, 64)
		var z := rng.randf_range(-43, 39)
		if not _clear(x, z):
			continue
		var patch := sin(x * .37 + sin(z * .21) * 3) * sin(z * .31 + cos(x * .18) * 2)
		var in_yard := x > -27 and x < 25 and z > -5 and z < 22
		var density := .24 if in_yard else .45
		if rng.randf() > density + maxf(patch, 0) * .27:
			continue
		var size := rng.randf_range(.95, 1.65)
		var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(size, size * rng.randf_range(.72, 1.05), size))
		if rng.randf() < .34:
			dry_x.append(Transform3D(basis, Vector3(x, .009, z)))
			dry_c.append(Color.from_hsv(rng.randf_range(.13, .17), rng.randf_range(.24, .39), rng.randf_range(.66, .82)))
		else:
			green_x.append(Transform3D(basis, Vector3(x, .009, z)))
			green_c.append(Color.from_hsv(rng.randf_range(.205, .26), rng.randf_range(.53, .71), rng.randf_range(.33, .53)))
		if rng.randf() < .08:
			herb_x.append(Transform3D(basis.scaled(Vector3(1.3,1.1,1.3)), Vector3(x,.016,z)))
			herb_c.append(Color.from_hsv(.245,.65,rng.randf_range(.34,.52)))
		if rng.randf() < .035 and not in_yard:
			flower_x.append(Transform3D(basis,Vector3(x,.018,z)))
			flower_c.append(Color(1,rng.randf_range(.76,.94),.23))
	var centers: Array[Vector2] = []
	# Foreground and side framing match the clustered little crowns in the selected art.
	for x in range(-37, 40, 4):
		centers.append(Vector2(x + rng.randf_range(-.8,.8),rng.randf_range(22,26)))
		centers.append(Vector2(x + rng.randf_range(-.8,.8),rng.randf_range(-32,-30)))
	for z in range(-5,24,4):
		centers.append(Vector2(rng.randf_range(-33,-29),z))
		centers.append(Vector2(rng.randf_range(26,29),z))
	# The road-to-rail strip has its own row of low crowns, not isolated speckles.
	for x in range(-48,49,4):
		centers.append(Vector2(x+rng.randf_range(-.7,.7),-17.2+rng.randf_range(-.25,.25)))
	# A handful of smaller accents break up the working yard without carpeting it.
	centers.append_array([Vector2(-12,-1),Vector2(-15,3),Vector2(10,-2),Vector2(11,5),Vector2(19,-2),Vector2(-11,18),Vector2(-5,2),Vector2(3,8),Vector2(22,14)])
	for center in centers:
		var is_inside := center.x > -24 and center.x < 24 and center.y > -5 and center.y < 20
		var is_strip := center.y > -19 and center.y < -15
		var count := 1 if is_inside else rng.randi_range(2,4)
		for j in range(count):
			var point := center + Vector2(rng.randf_range(-1.1,1.1),rng.randf_range(-.55,.55))
			var size := (rng.randf_range(.72,1.25) if is_inside or is_strip else rng.randf_range(.9,1.6)) * .87
			if not _plant_clear(point,.7*size):
				continue
			var variant := rng.randi_range(0,2)
			var basis := Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(size,size*rng.randf_range(.85,1.17),size))
			crown_x[variant].append(Transform3D(basis,Vector3(point.x,.015,point.y)))
			crown_c[variant].append(Color.from_hsv(rng.randf_range(.205,.26),rng.randf_range(.49,.70),rng.randf_range(.36,.55)))
			if j == 0 and rng.randf() < .64:
				var stone_p := point + Vector2(rng.randf_range(.8,1.5),rng.randf_range(-.6,.8))
				if _plant_clear(stone_p,.44):
					var scale := rng.randf_range(.38,.75)
					var rb := Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(scale*1.5,scale*.88,scale))
					boulder_x.append(Transform3D(rb,Vector3(stone_p.x,.02,stone_p.y)))
					boulder_c.append(Color.from_hsv(.105,rng.randf_range(.08,.20),rng.randf_range(.55,.72)))
		# Pale and green tuft layers ring the larger bushes, leaving bare soil between clusters.
		for j in range(9):
			var point := center + Vector2(rng.randf_range(-2,2),rng.randf_range(-1.6,1.6))
			if not _clear(point.x,point.y):
				continue
			var scale := rng.randf_range(1.05,1.75)
			var basis := Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(scale,scale*.85,scale))
			if j%3 == 0:
				dry_x.append(Transform3D(basis,Vector3(point.x,.01,point.y)))
				dry_c.append(Color("b8b17b"))
			else:
				green_x.append(Transform3D(basis,Vector3(point.x,.01,point.y)))
				green_c.append(Color.from_hsv(.225,.60,rng.randf_range(.35,.53)))
	# Visible medium rocks inside the yard are intentional composition accents.
	for point in [Vector2(8,4),Vector2(-10,1),Vector2(-9,-4),Vector2(-16,5),Vector2(22,9),Vector2(14,-1),Vector2(-9,17)]:
		if not _plant_clear(point,.5):
			continue
		var scale := rng.randf_range(.28,.55)
		boulder_x.append(Transform3D(Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(scale*1.5,scale,scale)),Vector3(point.x,.02,point.y)))
		boulder_c.append(Color.from_hsv(.11,.12,rng.randf_range(.58,.72)))
	for i in range(280):
		var point := Vector2(rng.randf_range(-44,44),rng.randf_range(-35,28))
		if not _clear(point.x,point.y):
			continue
		var scale := rng.randf_range(.08,.22)
		rock_x.append(Transform3D(Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(scale*1.4,scale*.8,scale)),Vector3(point.x,.006,point.y)))
		rock_c.append(Color.from_hsv(.11,rng.randf_range(.06,.17),rng.randf_range(.50,.70)))
	# Irregular little stone fans read as worked ground rather than evenly scattered dots.
	for center in [Vector2(-9,-1),Vector2(-16,4),Vector2(-20,15),Vector2(-11,19),Vector2(-6,22),Vector2(14,19),Vector2(20,12),Vector2(25,5),Vector2(15,1),Vector2(9,6),Vector2(-2,6),Vector2(-18,-5)]:
		for i in range(rng.randi_range(9,19)):
			var point: Vector2 = center + Vector2(rng.randfn(0,.62),rng.randfn(0,.37))
			if not _clear(point.x,point.y):
				continue
			var scale := rng.randf_range(.045,.135)
			var basis := Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(scale*rng.randf_range(1.1,1.8),scale*rng.randf_range(.5,.9),scale))
			rock_x.append(Transform3D(basis,Vector3(point.x,.004,point.y)))
			rock_c.append(Color.from_hsv(rng.randf_range(.075,.13),rng.randf_range(.08,.23),rng.randf_range(.39,.61)))
	var foliage := StandardMaterial3D.new()
	foliage.vertex_color_use_as_albedo = true
	foliage.vertex_color_is_srgb = true
	foliage.roughness = .95
	foliage.cull_mode = BaseMaterial3D.CULL_DISABLED
	foliage.backlight_enabled = true
	foliage.backlight = Color(.10,.14,.05)
	var crowns := StandardMaterial3D.new()
	crowns.vertex_color_use_as_albedo = true
	crowns.vertex_color_is_srgb = true
	crowns.roughness = .9
	_instances(root,"GreenMeadowTufts",_grass_mesh(),foliage,green_x,green_c)
	_instances(root,"PaleDryTufts",_grass_mesh(true),foliage,dry_x,dry_c)
	_instances(root,"BroadLeafHerbs",_herb_mesh(),foliage,herb_x,herb_c)
	for variant in range(3):
		var transforms: Array[Transform3D] = []
		var colors: Array[Color] = []
		transforms.assign(crown_x[variant])
		colors.assign(crown_c[variant])
		_instances(root,"FacetedShrubCrowns%d"%variant,_crown_mesh(variant),crowns,transforms,colors)
	_instances(root,"YellowWildflowers",_flower_mesh(),foliage,flower_x,flower_c)
	var stone := StandardMaterial3D.new()
	stone.vertex_color_use_as_albedo = true
	stone.vertex_color_is_srgb = true
	stone.roughness = .99
	_instances(root,"SmallAngularFieldstones",_boulder_mesh(),stone,rock_x,rock_c)
	_instances(root,"VisibleFacetedBoulders",_boulder_mesh(),stone,boulder_x,boulder_c)
	var total := green_x.size()+dry_x.size()+herb_x.size()+flower_x.size()+rock_x.size()+boulder_x.size()
	for variants in crown_x:
		total += variants.size()
	root.set_meta("vegetation_stats",{"green_tufts":green_x.size(),"dry_tufts":dry_x.size(),"faceted_crowns":crown_x[0].size()+crown_x[1].size()+crown_x[2].size(),"large_boulders":boulder_x.size(),"small_stones":rock_x.size(),"instances":total,"draw_groups":9})
	return total

static func _instances(root: Node3D, label: String, mesh: Mesh, material: Material, transforms: Array[Transform3D], colors: Array[Color]) -> void:
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_colors = true
	multimesh.mesh = mesh
	multimesh.instance_count = transforms.size()
	for i in range(transforms.size()):
		multimesh.set_instance_transform(i, transforms[i])
		multimesh.set_instance_color(i, colors[i])
	var node := MultiMeshInstance3D.new()
	node.name = label
	node.multimesh = multimesh
	node.material_override = material
	root.add_child(node)

static func _triangle(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, color := Color.WHITE) -> void:
	# SurfaceTool uses Godot's clockwise Plane normal: (a-c).cross(a-b).
	# Leaf points below are ordered so their broad top faces have upward normals.
	st.set_color(color)
	st.add_vertex(a)
	st.set_color(color)
	st.add_vertex(b)
	st.set_color(color)
	st.add_vertex(c)

static func _leaf(st: SurfaceTool, center: Vector3, direction: Vector3, length: float, width: float, color := Color.WHITE) -> void:
	var side := direction.cross(Vector3.UP).normalized() * width
	if side.length_squared() < .001:
		side = Vector3.RIGHT * width
	var tip := center + direction.normalized() * length
	var middle := center + direction.normalized() * length * .48 + Vector3.UP * width * .5
	_triangle(st, center, middle - side, tip, color)
	_triangle(st, center, tip, middle + side, color * .92)

static func _grass_mesh(pale := false) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 12
	for i in range(14):
		var angle := i * TAU / 14.0 + rng.randf_range(-.18,.18)
		var p := Vector3(rng.randf_range(-.06, .06), 0, rng.randf_range(-.06, .06))
		var d := Vector3(cos(angle), 0, sin(angle))
		var side := Vector3(-sin(angle), 0, cos(angle)) * rng.randf_range(.024, .043)
		var height := rng.randf_range(.09, .26)
		if i == 11:
			height = rng.randf_range(.33,.46)
		var bend := d * rng.randf_range(.12, .29)
		var lower := p + Vector3.UP * height * .38 + bend * .10
		var upper := p + Vector3.UP * height * .80 + bend * .50
		var tip := p + Vector3.UP * height + bend
		var base_color := Color(.84,.81,.60) if pale else Color(.70,.80,.49)
		var middle_color := Color(.94,.91,.70) if pale else Color(.81,.88,.58)
		var tip_color := Color(1,.98,.80) if pale else Color(.93,.98,.72)
		_triangle(st,p-side,p+side,lower+side*.8,base_color)
		_triangle(st,p-side,lower+side*.8,lower-side*.8,base_color)
		_triangle(st,lower-side*.8,lower+side*.8,upper+side*.4,middle_color)
		_triangle(st,lower-side*.8,upper+side*.4,upper-side*.4,middle_color)
		_triangle(st,upper-side*.4,upper+side*.4,tip,tip_color)
	st.generate_normals()
	return st.commit()

static func _herb_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(11):
		var a := i * TAU / 11
		_leaf(st, Vector3(0, .04 + (i % 3) * .04, 0), Vector3(cos(a), .6, sin(a)), .28 + (i % 4) * .03, .047)
	st.generate_normals()
	return st.commit()

static func _faceted_lump(st: SurfaceTool, center: Vector3, size: Vector3, yaw: float, shade: Color, irregularity := .08) -> void:
	var t := (1.0 + sqrt(5.0)) * .5
	var points: Array[Vector3] = [Vector3(-1,t,0),Vector3(1,t,0),Vector3(-1,-t,0),Vector3(1,-t,0),Vector3(0,-1,t),Vector3(0,1,t),Vector3(0,-1,-t),Vector3(0,1,-t),Vector3(t,0,-1),Vector3(t,0,1),Vector3(-t,0,-1),Vector3(-t,0,1)]
	var faces: Array = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]
	var rotation := Basis(Vector3.UP,yaw)
	for i in range(points.size()):
		var radial := 1.0 + sin(i*12.71+center.x*3.1+center.z*4.7)*irregularity
		points[i] = center + rotation * (points[i].normalized()*size*radial)
	for face in faces:
		var a: Vector3 = points[face[0]]
		var b: Vector3 = points[face[1]]
		var c: Vector3 = points[face[2]]
		var normal := Plane(a,b,c).normal
		if normal.dot((a+b+c)/3.0-center) < 0.0:
			var swap := b
			b = c
			c = swap
		_triangle(st,a,b,c,shade)

static func _crown_mesh(variant: int) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(-1)
	_faceted_lump(st,Vector3(0,.25,0),Vector3(.12,.29,.11),0,Color(.42,.31,.16))
	if variant == 0:
		_faceted_lump(st,Vector3(-.44,.50,.12),Vector3(.55,.58,.48),.3,Color(.84,.91,.66))
		_faceted_lump(st,Vector3(.46,.51,-.07),Vector3(.54,.61,.51),.9,Color(.95,.99,.78))
		_faceted_lump(st,Vector3(0,.92,0),Vector3(.62,.72,.56),1.2,Color(.91,.96,.70))
		_faceted_lump(st,Vector3(.14,.47,.49),Vector3(.48,.55,.49),.1,Color(.81,.87,.61))
	elif variant == 1:
		_faceted_lump(st,Vector3(-.35,.53,.04),Vector3(.55,.68,.49),.4,Color(.83,.90,.63))
		_faceted_lump(st,Vector3(.32,.85,-.11),Vector3(.57,.76,.51),.8,Color(.94,.97,.73))
		_faceted_lump(st,Vector3(-.11,1.36,.08),Vector3(.53,.72,.47),.2,Color(.90,.96,.69))
		_faceted_lump(st,Vector3(.25,.47,.43),Vector3(.43,.56,.48),1.1,Color(.75,.84,.57))
	else:
		_faceted_lump(st,Vector3(-.67,.38,.15),Vector3(.62,.49,.54),.2,Color(.78,.87,.58))
		_faceted_lump(st,Vector3(.59,.42,-.1),Vector3(.60,.54,.57),.5,Color(.90,.94,.72))
		_faceted_lump(st,Vector3(.08,.69,-.35),Vector3(.64,.71,.58),.9,Color(.95,.99,.77))
		_faceted_lump(st,Vector3(.20,.43,.51),Vector3(.56,.56,.48),1.4,Color(.86,.93,.63))
		_faceted_lump(st,Vector3(-.35,.67,.34),Vector3(.54,.65,.50),.7,Color(.90,.95,.68))
	# Small overlapping leaf clusters keep the broad miniature silhouette while
	# giving sunlit rims and shaded pockets a readable scale of their own.
	var cluster_rng := RandomNumberGenerator.new()
	cluster_rng.seed = 7821 + variant * 107
	for cluster in range(16):
		var t := float(cluster) / 15.0
		var angle := float(cluster) * 2.39996 + variant
		var radius := .72 * sqrt(1.0 - t * .72)
		var height := .43 + t * (.98 if variant == 1 else .72)
		var size := cluster_rng.randf_range(.83,1.15)
		var shade := cluster_rng.randf_range(.71,.98)
		_faceted_lump(st,Vector3(cos(angle)*radius,height,sin(angle)*radius),Vector3(.27,.31,.25)*size,angle,Color(shade*.94,shade,shade*.72),.10)
	st.generate_normals()
	var coarse := st.commit()
	var arrays: Array = coarse.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
	var detailed := SurfaceTool.new()
	detailed.begin(Mesh.PRIMITIVE_TRIANGLES)
	detailed.set_smooth_group(-1)
	# Subdivide each large facet once; matching edge positions keep the crown closed.
	# Small vertical folds create finer leaf-cluster planes without extra draw calls.
	for index in range(0,vertices.size(),3):
		var a: Vector3 = vertices[index]
		var b: Vector3 = vertices[index+1]
		var c: Vector3 = vertices[index+2]
		var ab := (a+b)*.5
		var bc := (b+c)*.5
		var ca := (c+a)*.5
		ab.y += sin(ab.dot(Vector3(17.1,11.7,23.2)))*.028
		bc.y += sin(bc.dot(Vector3(17.1,11.7,23.2)))*.028
		ca.y += sin(ca.dot(Vector3(17.1,11.7,23.2)))*.028
		var shade: Color = colors[index]
		_triangle(detailed,a,ab,ca,shade)
		_triangle(detailed,ab,b,bc,shade*.97)
		_triangle(detailed,ca,bc,c,shade*1.015)
		_triangle(detailed,ab,bc,ca,shade*.985)
	detailed.generate_normals()
	return detailed.commit()

static func _boulder_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(-1)
	_faceted_lump(st,Vector3(0,.49,0),Vector3(1,.65,.8),.1,Color(.88,.87,.81),.16)
	st.generate_normals()
	return st.commit()

static func _bush_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 727
	for branch in range(12):
		var a := branch * TAU / 12
		var dir := Vector3(cos(a) * .7, rng.randf_range(.65, 1.25), sin(a) * .7)
		var base := Vector3(0, .04, 0)
		var end := dir * rng.randf_range(.55, .9)
		var side := Vector3(-sin(a), 0, cos(a)) * .013
		_triangle(st, base - side, base + side, end, Color(.51, .42, .25))
		for j in range(12):
			var fraction := .25 + j * .057
			var center := base.lerp(end, fraction)
			var leaf_angle := a + (PI * .36 if j % 2 == 0 else -PI * .36)
			var leaf_dir := Vector3(cos(leaf_angle), .30 + rng.randf() * .55, sin(leaf_angle))
			_leaf(st, center, leaf_dir, rng.randf_range(.14, .27), rng.randf_range(.04, .077), Color.from_hsv(.02, .1, rng.randf_range(.69, 1)))
	st.generate_normals()
	return st.commit()

static func _flower_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(4):
		var a := i * 2.1
		var p := Vector3(cos(a) * .11, .33 + i * .042, sin(a) * .11)
		_triangle(st, Vector3(p.x - .008, 0, p.z), Vector3(p.x + .008, 0, p.z), p, Color(.3, .5, .18))
		for petal in range(6):
			var b := petal * TAU / 6
			var d := Vector3(cos(b), .1, sin(b)) * .045
			var side := Vector3(-sin(b), 0, cos(b)) * .016
			_triangle(st, p, p + d + side, p + d - side)
	st.generate_normals()
	return st.commit()
