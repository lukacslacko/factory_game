extends SceneTree

const Ground = preload("res://scripts/ground.gd")

func _initialize() -> void:
	var mesh: ArrayMesh = Ground._herb_mesh()
	var arrays: Array = mesh.surface_get_arrays(0)
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var minimum_y := 1.0
	var failures := 0
	for normal in normals:
		minimum_y = minf(minimum_y, normal.y)
		if normal.y <= 0.0 or absf(normal.length() - 1.0) > 0.001:
			failures += 1
	# Check the same clockwise geometric plane independently of the generated array.
	for triangle in range(0, vertices.size(), 3):
		var outward := Plane(vertices[triangle], vertices[triangle + 1], vertices[triangle + 2]).normal
		if outward.y <= 0.0:
			failures += 1
	print("GROUND_NORMALS ", JSON.stringify({"vertices": vertices.size(), "triangles": vertices.size() / 3, "minimum_upward_normal_y": minimum_y, "failures": failures, "passed": failures == 0}))
	quit(0 if failures == 0 else 1)
