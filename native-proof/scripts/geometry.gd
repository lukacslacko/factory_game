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
