extends RefCounted

const G = preload("res://scripts/geometry.gd")
const SURFACE = preload("res://shaders/ground.gdshader")

static func build(root: Node3D) -> Dictionary:
	var group := Node3D.new()
	group.name = "GroundAndVegetation"
	root.add_child(group)
	var ground_material := _surface(0, "7b7350", "b4a77d")
	var terrain := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(180, 150)
	terrain.mesh = plane
	terrain.material_override = ground_material
	terrain.name = "Earth"
	group.add_child(terrain)
	_road(group)
	var slabs := _paving(group)
	var vegetation := _vegetation(group)
	return {"ground_material": ground_material, "slab_count": slabs, "vegetation_instances": vegetation, "vegetation_draw_calls": 5}

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
	var asphalt := _surface(2, "373d3d", "4b5250")
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
	var rects: Array[Rect2] = [Rect2(-2, -3, 10, 10), Rect2(-20, 8, 14, 7), Rect2(-5, 11, 18, 8), Rect2(16, 1, 5, 6), Rect2(-23, 7, 46, 2), Rect2(-26, -4, 6, 11)]
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
			colors.append(Color.WHITE * rng.randf_range(.95, 1.04))
	var slab := BoxMesh.new()
	slab.size = Vector3(.988, .13, .988)
	var material := _surface(1, "b2b09e", "cdc9b3")
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
	return not _paved(x, z, .35)

static func _vegetation(root: Node3D) -> int:
	var rng := RandomNumberGenerator.new()
	rng.seed = 3021047
	var grass_x: Array[Transform3D] = []
	var grass_c: Array[Color] = []
	var herb_x: Array[Transform3D] = []
	var herb_c: Array[Color] = []
	var bush_x: Array[Transform3D] = []
	var bush_c: Array[Color] = []
	var flower_x: Array[Transform3D] = []
	var flower_c: Array[Color] = []
	var rock_x: Array[Transform3D] = []
	var rock_c: Array[Color] = []
	for i in range(14000):
		var x := rng.randf_range(-75, 75)
		var z := rng.randf_range(-50, 55)
		if not _clear(x, z):
			continue
		var patch := sin(x * .41 + sin(z * .28) * 3) * sin(z * .36 + cos(x * .2) * 2)
		var in_yard := x > -27 and x < 27 and z > -5 and z < 21
		var density := .15 if in_yard else .67
		if rng.randf() > density + maxf(patch, 0) * .37:
			continue
		var size := rng.randf_range(.64, 1.43)
		var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(size, size * rng.randf_range(.7, 1.2), size))
		grass_x.append(Transform3D(basis, Vector3(x, .01, z)))
		grass_c.append(Color.from_hsv(rng.randf_range(.215, .29), rng.randf_range(.52, .77), rng.randf_range(.35, .57)))
		if rng.randf() < .14:
			herb_x.append(Transform3D(basis.scaled(Vector3(1.2, 1, 1.2)), Vector3(x, .018, z)))
			herb_c.append(Color.from_hsv(rng.randf_range(.235, .30), .72, rng.randf_range(.34, .54)))
		if rng.randf() < .075 and not in_yard:
			flower_x.append(Transform3D(basis, Vector3(x + .15, .02, z)))
			flower_c.append(Color(1, rng.randf_range(.77, .95), .23))
	# Shrubs form irregular clusters instead of an evenly scattered forest.
	var centers := [Vector2(-29, 18), Vector2(-11, 24), Vector2(28, 14), Vector2(28, -1), Vector2(-35, -8), Vector2(12, -31), Vector2(34, -30), Vector2(-44, -33), Vector2(40, 25), Vector2(-37, 30), Vector2(1, 28), Vector2(24, -17)]
	for center in centers:
		for j in range(26):
			var p: Vector2 = center + Vector2(rng.randfn(0, 3.0), rng.randfn(0, 2.2))
			if not _clear(p.x, p.y):
				continue
			var size := rng.randf_range(.68, 1.7)
			var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(size, size * rng.randf_range(.8, 1.3), size))
			bush_x.append(Transform3D(basis, Vector3(p.x, .01, p.y)))
			bush_c.append(Color.from_hsv(rng.randf_range(.235, .29), rng.randf_range(.62, .79), rng.randf_range(.29, .49)))
		# Dense undergrowth at the same locations connects shrubs to layered meadow patches.
		for j in range(85):
			var p: Vector2 = center + Vector2(rng.randfn(0, 3.6), rng.randfn(0, 2.9))
			if not _clear(p.x, p.y):
				continue
			var size := rng.randf_range(.76, 1.6)
			var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(size, size * rng.randf_range(.8, 1.3), size))
			grass_x.append(Transform3D(basis, Vector3(p.x, .01, p.y)))
			grass_c.append(Color.from_hsv(rng.randf_range(.225, .29), .64, rng.randf_range(.36, .57)))
			if j % 3 == 0:
				herb_x.append(Transform3D(basis.scaled(Vector3(1.45, 1.3, 1.45)), Vector3(p.x, .016, p.y)))
				herb_c.append(Color.from_hsv(rng.randf_range(.24, .30), .72, rng.randf_range(.34, .56)))
	for i in range(420):
		var x := rng.randf_range(-48, 48)
		var z := rng.randf_range(-37, 36)
		if not _clear(x, z):
			continue
		var size := rng.randf_range(.055, .22)
		rock_x.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(size * 1.4, size * .8, size)), Vector3(x, size * .18, z)))
		rock_c.append(Color.from_hsv(.12, rng.randf_range(.04, .18), rng.randf_range(.39, .68)))
	var foliage := StandardMaterial3D.new()
	foliage.vertex_color_use_as_albedo = true
	foliage.vertex_color_is_srgb = true
	foliage.roughness = .95
	foliage.cull_mode = BaseMaterial3D.CULL_DISABLED
	foliage.backlight_enabled = true
	foliage.backlight = Color(.14, .19, .07)
	_instances(root, "MeadowGrass", _grass_mesh(), foliage, grass_x, grass_c)
	_instances(root, "BroadLeafHerbs", _herb_mesh(), foliage, herb_x, herb_c)
	_instances(root, "LeafyShrubClusters", _bush_mesh(), foliage, bush_x, bush_c)
	_instances(root, "YellowWildflowers", _flower_mesh(), foliage, flower_x, flower_c)
	var rock := SphereMesh.new()
	rock.radial_segments = 7
	rock.rings = 3
	rock.radius = 1
	rock.height = 2
	var stone := StandardMaterial3D.new()
	stone.vertex_color_use_as_albedo = true
	stone.roughness = .99
	_instances(root, "ScatteredFieldstones", rock, stone, rock_x, rock_c)
	return grass_x.size() + herb_x.size() + bush_x.size() + flower_x.size() + rock_x.size()

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

static func _grass_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 12
	for i in range(14):
		var angle := rng.randf() * TAU
		var p := Vector3(rng.randf_range(-.19, .19), 0, rng.randf_range(-.19, .19))
		var d := Vector3(cos(angle), 0, sin(angle))
		var side := Vector3(-sin(angle), 0, cos(angle)) * rng.randf_range(.015, .026)
		var height := rng.randf_range(.18, .56)
		var bend := d * rng.randf_range(.07, .20)
		var mid := p + Vector3.UP * height * .60 + bend * .30
		var tip := p + Vector3.UP * height + bend
		_triangle(st, p - side, p + side, mid + side * .4, Color(.66, .73, .43))
		_triangle(st, p - side, mid + side * .4, mid - side * .4, Color(.74, .82, .52))
		_triangle(st, mid - side * .4, mid + side * .4, tip, Color(.89, .93, .64))
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
