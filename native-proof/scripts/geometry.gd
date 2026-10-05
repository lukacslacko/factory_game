extends RefCounted

# Shared meshes and materials keep the deliberately detailed study inexpensive.
static var materials: Dictionary = {}
static var meshes: Dictionary = {}

static func mat(hex: String, roughness: float = 0.7, metallic: float = 0.0) -> StandardMaterial3D:
	var key: String = "%s/%.3f/%.3f" % [hex, roughness, metallic]
	if materials.has(key):
		return materials[key] as StandardMaterial3D
	var result := StandardMaterial3D.new()
	result.albedo_color = Color(hex)
	result.roughness = roughness
	result.metallic = metallic
	materials[key] = result
	return result

static func instance(parent: Node3D, mesh: Mesh, material: Material, position: Vector3) -> MeshInstance3D:
	var result := MeshInstance3D.new()
	result.mesh = mesh
	result.material_override = material
	result.position = position
	parent.add_child(result)
	return result

static func box(parent: Node3D, position: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	var key: String = "box/" + str(size)
	if not meshes.has(key):
		var mesh := BoxMesh.new()
		mesh.size = size
		meshes[key] = mesh
	return instance(parent, meshes[key] as Mesh, material, position)

static func cylinder(parent: Node3D, position: Vector3, radius: float, height: float, material: Material, segments: int = 16) -> MeshInstance3D:
	var key: String = "cyl/%.4f/%.4f/%d" % [radius, height, segments]
	if not meshes.has(key):
		var mesh := CylinderMesh.new()
		mesh.top_radius = radius
		mesh.bottom_radius = radius
		mesh.height = height
		mesh.radial_segments = segments
		meshes[key] = mesh
	return instance(parent, meshes[key] as Mesh, material, position)

static func sphere(parent: Node3D, position: Vector3, radius: float, material: Material) -> MeshInstance3D:
	var key: String = "sphere/%.4f" % radius
	if not meshes.has(key):
		var mesh := SphereMesh.new()
		mesh.radius = radius
		mesh.height = radius * 2.0
		mesh.radial_segments = 16
		mesh.rings = 8
		meshes[key] = mesh
	return instance(parent, meshes[key] as Mesh, material, position)

static func beam(parent: Node3D, a: Vector3, b: Vector3, width: float, material: Material) -> MeshInstance3D:
	var result: MeshInstance3D = box(parent, (a+b)*0.5, Vector3(width,a.distance_to(b),width), material)
	result.quaternion = Quaternion(Vector3.UP,(b-a).normalized())
	return result

static func rod(parent: Node3D, a: Vector3, b: Vector3, radius: float, material: Material, segments: int = 12) -> MeshInstance3D:
	var result: MeshInstance3D = cylinder(parent,(a+b)*0.5,radius,a.distance_to(b),material,segments)
	result.quaternion = Quaternion(Vector3.UP,(b-a).normalized())
	return result

static func label(parent: Node3D, text: String, position: Vector3, font_size: int = 40, pixel_size: float = 0.01) -> Label3D:
	var result := Label3D.new()
	result.text = text
	result.font_size = font_size
	result.pixel_size = pixel_size
	result.modulate = Color("233a32")
	result.outline_size = 0
	result.no_depth_test = false
	result.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	result.position = position
	parent.add_child(result)
	return result

# A real rounded cuboid, not an outline shader. Planar panels retain broad faces;
# edge fillets and spherical corners catch continuous highlights with shared normals.
# All generated surfaces are deindexed and use Godot's clockwise winding.
static func beveled_box(parent: Node3D, position: Vector3, size: Vector3, material: Material, radius: float = 0.035) -> MeshInstance3D:
	var smallest: float = minf(size.x, minf(size.y, size.z))
	if smallest < 0.055:
		return box(parent, position, size, material)
	var actual_radius: float = minf(radius, smallest * 0.23)
	var key: String = "rounded/%s/%.5f" % [str(size), actual_radius]
	if not meshes.has(key):
		meshes[key] = _rounded_box_mesh(size, actual_radius)
	return instance(parent, meshes[key] as Mesh, material, position)

static func triangle(vertices: Array[Vector3], normals: Array[Vector3], a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3) -> void:
	if (b-a).cross(c-a).dot(na+nb+nc) > 0.0:
		vertices.append(a)
		vertices.append(c)
		vertices.append(b)
		normals.append(na)
		normals.append(nc)
		normals.append(nb)
	else:
		vertices.append(a)
		vertices.append(b)
		vertices.append(c)
		normals.append(na)
		normals.append(nb)
		normals.append(nc)

static func surface(vertices: Array[Vector3], normals: Array[Vector3]) -> ArrayMesh:
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array(vertices)
	arrays[Mesh.ARRAY_NORMAL] = PackedVector3Array(normals)
	var mesh: ArrayMesh = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

static func _rounded_box_mesh(size: Vector3, radius: float) -> ArrayMesh:
	var vertices: Array[Vector3] = []
	var normals: Array[Vector3] = []
	var half: Vector3 = size * 0.5
	var core: Vector3 = half - Vector3.ONE * radius
	for axis: int in range(3):
		var u_axis: int = (axis + 1) % 3
		var v_axis: int = (axis + 2) % 3
		var hu: float = half[u_axis]
		var hv: float = half[v_axis]
		var cu: float = core[u_axis]
		var cv: float = core[v_axis]
		# 22.5-degree edge samples provide four segments around each 90-degree fillet.
		var u_values: PackedFloat32Array = PackedFloat32Array([-hu, -cu-radius*0.41421356, -cu, cu, cu+radius*0.41421356, hu])
		var v_values: PackedFloat32Array = PackedFloat32Array([-hv, -cv-radius*0.41421356, -cv, cv, cv+radius*0.41421356, hv])
		for face_sign: int in [-1, 1]:
			for ui: int in range(5):
				for vi: int in range(5):
					var corners: Array[Vector3] = []
					var corner_normals: Array[Vector3] = []
					for ij: Vector2i in [Vector2i(ui,vi),Vector2i(ui+1,vi),Vector2i(ui+1,vi+1),Vector2i(ui,vi+1)]:
						var p: Vector3 = Vector3.ZERO
						p[axis] = face_sign * half[axis]
						p[u_axis] = u_values[ij.x]
						p[v_axis] = v_values[ij.y]
						var q: Vector3 = p.clamp(-core,core)
						var normal: Vector3 = (p-q).normalized()
						corners.append(q+normal*radius)
						corner_normals.append(normal)
					triangle(vertices,normals,corners[0],corners[1],corners[2],corner_normals[0],corner_normals[1],corner_normals[2])
					triangle(vertices,normals,corners[0],corners[2],corners[3],corner_normals[0],corner_normals[2],corner_normals[3])
	return surface(vertices,normals)
