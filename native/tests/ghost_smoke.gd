extends SceneTree
## Recorded src/track.ts trackGeometry output: a straight panel, a curved
## panel, and the dual-route turnout points module. No JS service is started.
const W = preload("res://scripts/game_world.gd")
const SAMPLES_JSON = """[{"id":"JOB-GHOST-1","track":{"layout":"straight","origin":{"x":140,"z":5},"heading":0,"hand":1,"section":0},"geometry":{"paths":[{"route":"straight","length":5,"points":[{"x":140,"z":5,"yaw":0},{"x":145,"z":5,"yaw":0}]}],"entry":{"x":140,"z":5,"yaw":3.141592653589793,"route":"straight","end":"entry"},"entries":[{"x":140,"z":5,"yaw":3.141592653589793,"route":"straight","end":"entry"}],"end":{"x":145,"z":5,"yaw":0,"route":"straight","end":"exit"},"ends":[{"x":145,"z":5,"yaw":0,"route":"straight","end":"exit"}],"ports":[{"x":140,"z":5,"yaw":3.141592653589793,"route":"straight","end":"entry"},{"x":145,"z":5,"yaw":0,"route":"straight","end":"exit"}],"pose":{"x":142.5,"z":5,"yaw":0},"rect":{"x":140,"z":4,"w":5,"d":2},"cells":[{"x":140,"z":4},{"x":141,"z":4},{"x":142,"z":4},{"x":143,"z":4},{"x":144,"z":4},{"x":140,"z":5},{"x":141,"z":5},{"x":142,"z":5},{"x":143,"z":5},{"x":144,"z":5}],"length":5}},{"id":"JOB-GHOST-2","track":{"layout":"curve","origin":{"x":160,"z":20},"heading":0,"hand":1,"section":3},"geometry":{"paths":[{"route":"straight","length":5.235987755982988,"points":[{"x":174.14213562373095,"z":25.85786437626905,"yaw":0.7853981633974483},{"x":174.31733698519437,"z":26.035263638278543,"yaw":0.7978648009116935},{"x":174.49031321718545,"z":26.214833230321055,"yaw":0.8103314384259387},{"x":174.66103743659653,"z":26.39654524458161,"yaw":0.8227980759401838},{"x":174.82948311031654,"z":26.580371440280594,"yaw":0.8352647134544291},{"x":174.99562405935467,"z":26.76628324806281,"yaw":0.8477313509686742},{"x":175.15943446290905,"z":26.954251774437573,"yaw":0.8601979884829195},{"x":175.32088886237955,"z":27.144247806269213,"yaw":0.8726646259971647},{"x":175.47996216532454,"z":27.3362418153172,"yaw":0.8851312635114099},{"x":175.6366296493606,"z":27.53020396282533,"yaw":0.8975979010256551},{"x":175.7908669660047,"z":27.72610410415905,"yaw":0.9100645385399003},{"x":175.94265014445844,"z":27.92391179349045,"yaw":0.9225311760541455},{"x":176.09195559533336,"z":28.123596288529964,"yaw":0.9349978135683906},{"x":176.23876011431713,"z":28.3251265553042,"yaw":0.947464451082636},{"x":176.38304088577985,"z":28.528471272979075,"yaw":0.9599310885968811},{"x":176.5247754863199,"z":28.73359883872756,"yaw":0.9723977261111264},{"x":176.66394188824898,"z":28.940477372641208,"yaw":0.9848643636253716},{"x":176.80051846301544,"z":29.14907472268481,"yaw":0.9973310011396167},{"x":176.93448398456567,"z":29.35935846969327,"yaw":1.009797638653862},{"x":177.0658176326431,"z":29.571295932410035,"yaw":1.0222642761681071},{"x":177.1944989960238,"z":29.784854172566284,"yaw":1.0347309136823524},{"x":177.32050807568876,"z":30,"yaw":1.0471975511965976}]}],"entry":{"x":174.14213562373095,"z":25.85786437626905,"yaw":-2.356194490192345,"route":"straight","end":"entry"},"entries":[{"x":174.14213562373095,"z":25.85786437626905,"yaw":-2.356194490192345,"route":"straight","end":"entry"}],"end":{"x":177.32050807568876,"z":30,"yaw":1.0471975511965976,"route":"straight","end":"exit"},"ends":[{"x":177.32050807568876,"z":30,"yaw":1.0471975511965976,"route":"straight","end":"exit"}],"ports":[{"x":174.14213562373095,"z":25.85786437626905,"yaw":-2.356194490192345,"route":"straight","end":"entry"},{"x":177.32050807568876,"z":30,"yaw":1.0471975511965976,"route":"straight","end":"exit"}],"pose":{"x":175.8670668058247,"z":27.824771419825588,"yaw":0.9162978572970231},"rect":{"x":173.4350288425444,"z":25.150757595082503,"w":4.751504636928814,"d":5.349242404917497},"cells":[{"x":174,"z":25},{"x":175,"z":25},{"x":173,"z":26},{"x":174,"z":26},{"x":175,"z":26},{"x":176,"z":26},{"x":173,"z":27},{"x":174,"z":27},{"x":175,"z":27},{"x":176,"z":27},{"x":177,"z":27},{"x":174,"z":28},{"x":175,"z":28},{"x":176,"z":28},{"x":177,"z":28},{"x":175,"z":29},{"x":176,"z":29},{"x":177,"z":29},{"x":178,"z":29},{"x":176,"z":30},{"x":177,"z":30}],"length":5.235987755982988}},{"id":"JOB-GHOST-3","track":{"layout":"turnout","origin":{"x":190,"z":20},"heading":0,"hand":1,"section":0},"geometry":{"paths":[{"route":"straight","length":5,"points":[{"x":190,"z":20,"yaw":0},{"x":195,"z":20,"yaw":0}]},{"route":"branch","length":5.076681512436171,"points":[{"x":190,"z":20,"yaw":0},{"x":190.23809523809524,"z":20.00210897851204,"yaw":0.017642727069228235},{"x":190.47619047619048,"z":20.008368426735775,"yaw":0.034849830224046384},{"x":190.71428571428572,"z":20.018677113702623,"yaw":0.0516122856296183},{"x":190.95238095238096,"z":20.032933808444014,"yaw":0.0679225647535203},{"x":191.1904761904762,"z":20.051037279991363,"yaw":0.08377455516812067},{"x":191.42857142857142,"z":20.072886297376094,"yaw":0.09916347445886513},{"x":191.66666666666666,"z":20.09837962962963,"yaw":0.11408577916815948},{"x":191.9047619047619,"z":20.12741604578339,"yaw":0.1285390705488362},{"x":192.14285714285714,"z":20.159894314868804,"yaw":0.14252199872421614},{"x":192.38095238095238,"z":20.195713205917286,"yaw":0.15603416666263942},{"x":192.61904761904762,"z":20.234771487960263,"yaw":0.16907603518091735},{"x":192.85714285714286,"z":20.276967930029155,"yaw":0.18164883000001192},{"x":193.0952380952381,"z":20.32220130115538,"yaw":0.19375445169258348},{"x":193.33333333333334,"z":20.37037037037037,"yaw":0.2053953891897674},{"x":193.57142857142858,"z":20.42137390670554,"yaw":0.21657463735639956},{"x":193.8095238095238,"z":20.475110679192312,"yaw":0.2272956190015955},{"x":194.04761904761904,"z":20.531479456862108,"yaw":0.23756211156593432},{"x":194.28571428571428,"z":20.590379008746357,"yaw":0.24737817861762454},{"x":194.52380952380952,"z":20.651708103876473,"yaw":0.2567481061974945},{"x":194.76190476190476,"z":20.715365511283878,"yaw":0.2656763439756109},{"x":195,"z":20.78125,"yaw":0.27416745111965873}]}],"entry":{"x":190,"z":20,"yaw":3.141592653589793,"route":"straight","end":"entry"},"entries":[{"x":190,"z":20,"yaw":3.141592653589793,"route":"straight","end":"entry"},{"x":190,"z":20,"yaw":3.141592653589793,"route":"branch","end":"entry"}],"end":{"x":195,"z":20,"yaw":0,"route":"straight","end":"exit"},"ends":[{"x":195,"z":20,"yaw":0,"route":"straight","end":"exit"},{"x":195,"z":20.78125,"yaw":0.27416745111965873,"route":"branch","end":"exit"}],"ports":[{"x":190,"z":20,"yaw":3.141592653589793,"route":"straight","end":"entry"},{"x":195,"z":20,"yaw":0,"route":"straight","end":"exit"},{"x":195,"z":20.78125,"yaw":0.27416745111965873,"route":"branch","end":"exit"}],"pose":{"x":192.63537278845914,"z":20.37195047007695,"yaw":0},"rect":{"x":190,"z":19,"w":5.270745576918273,"d":2.7439009401538996},"cells":[{"x":190,"z":19},{"x":191,"z":19},{"x":192,"z":19},{"x":193,"z":19},{"x":194,"z":19},{"x":195,"z":19},{"x":190,"z":20},{"x":191,"z":20},{"x":192,"z":20},{"x":193,"z":20},{"x":194,"z":20},{"x":195,"z":20},{"x":190,"z":21},{"x":191,"z":21},{"x":192,"z":21},{"x":193,"z":21},{"x":194,"z":21}],"length":10.07668151243617}}]"""

var failures: Array[String] = []
var checks: int = 0

func _initialize() -> void:
	_run.call_deferred()

func _check(condition: bool, description: String) -> void:
	checks += 1
	if not condition: failures.append(description)

func _meshes(node: Node) -> Array[MeshInstance3D]:
	var result: Array[MeshInstance3D] = []
	if node is MeshInstance3D: result.append(node)
	for child in node.get_children(): result.append_array(_meshes(child))
	return result

func _bright_vertices(node: Node) -> Array[Vector3]:
	var result: Array[Vector3] = []
	for mesh: MeshInstance3D in _meshes(node):
		var material: StandardMaterial3D = mesh.material_override as StandardMaterial3D
		if not material or material.albedo_color.a<.9 or material.albedo_color.get_luminance()<.4: continue
		for surface in range(mesh.mesh.get_surface_count()):
			var vertices: PackedVector3Array = mesh.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
			for point in vertices: result.append(mesh.global_transform*point)
	return result

func _ghost_properties(node: Node, label: String) -> void:
	var meshes := _meshes(node)
	_check(not meshes.is_empty(),label+" contains visible geometry")
	var shadows_off: bool = true
	var unshaded: bool = true
	var all_ghosts: bool = true
	var normal_depth: bool = true
	var opaque_strokes: bool = true
	var has_strokes: bool = false
	var alpha_footprints: bool = true
	var has_footprints: bool = false
	for mesh: MeshInstance3D in meshes:
		shadows_off = shadows_off and mesh.cast_shadow==GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		all_ghosts = all_ghosts and bool(mesh.get_meta("ghost",false))
		var material: StandardMaterial3D = mesh.material_override as StandardMaterial3D
		unshaded = unshaded and material!=null and material.shading_mode==BaseMaterial3D.SHADING_MODE_UNSHADED
		if not material:
			normal_depth=false
			continue
		normal_depth=normal_depth and not material.no_depth_test
		if material.albedo_color.a>=.99:
			has_strokes=true
			opaque_strokes=opaque_strokes and material.transparency==BaseMaterial3D.TRANSPARENCY_DISABLED and material.depth_draw_mode==BaseMaterial3D.DEPTH_DRAW_OPAQUE_ONLY
		else:
			has_footprints=true
			alpha_footprints=alpha_footprints and material.transparency==BaseMaterial3D.TRANSPARENCY_ALPHA
	_check(shadows_off,label+" meshes never cast shadows")
	_check(unshaded and all_ghosts,label+" uses ghost presentation instead of built-track materials")
	_check(normal_depth,label+" permits workers, equipment, and stock to occlude plans through normal depth testing")
	_check(has_strokes and opaque_strokes,label+" uses opaque depth-writing strokes eligible for temporal antialiasing")
	_check(has_footprints and alpha_footprints,label+" keeps footprint washes translucent without bypassing scene depth")

func _surface_properties(node: Node, surface: float, label: String, floor_only: bool = true) -> void:
	var wash_min: float = INF
	var wash_max: float = -INF
	var stroke_min: float = INF
	var stroke_max: float = -INF
	for mesh: MeshInstance3D in _meshes(node):
		var material: StandardMaterial3D = mesh.material_override as StandardMaterial3D
		if not material:continue
		for index in range(mesh.mesh.get_surface_count()):
			var vertices: PackedVector3Array = mesh.mesh.surface_get_arrays(index)[Mesh.ARRAY_VERTEX]
			for vertex in vertices:
				var y: float = (mesh.global_transform*vertex).y
				if material.albedo_color.a<.99:
					wash_min=minf(wash_min,y);wash_max=maxf(wash_max,y)
				else:
					stroke_min=minf(stroke_min,y);stroke_max=maxf(stroke_max,y)
	_check(wash_min>surface+.005 and wash_max<surface+.05,label+" footprint sits just above its installed ground surface")
	_check(stroke_min>surface+.005,label+" strokes remain above the ground instead of z-fighting with it")
	if floor_only:_check(stroke_max<surface+.075,label+" ground strokes stay near the floor rather than floating through equipment")

func _follows_paths(node: Node, geometry: Dictionary, label: String) -> void:
	var vertices := _bright_vertices(node)
	_check(not vertices.is_empty(),label+" has bright rail-shaped geometry")
	var worst: float = 0.0
	for path in geometry.paths:
		var points: Array = path.points
		for index: int in [0,int(points.size()/2),points.size()-1]:
			var point: Dictionary = points[index]
			for side: int in [-1,1]:
				var expected := Vector2(float(point.x)-sin(float(point.yaw))*.7525*side,float(point.z)+cos(float(point.yaw))*.7525*side)
				var nearest: float = INF
				for vertex: Vector3 in vertices: nearest=minf(nearest,Vector2(vertex.x,vertex.z).distance_to(expected))
				worst=maxf(worst,nearest)
	_check(worst<.22,label+" rails follow both canonical centerline offsets, including curve/branch endpoints")

func _vegetation(world: Node3D) -> Array:
	var transforms: Array = []
	for patch in world.plants:
		var node: MultiMeshInstance3D = patch.node
		for index in range(node.multimesh.instance_count):transforms.append(node.multimesh.get_instance_transform(index))
	return transforms

func _has_color(node: Node, amber: bool) -> bool:
	for mesh: MeshInstance3D in _meshes(node):
		var material: StandardMaterial3D = mesh.material_override as StandardMaterial3D
		if not material or material.albedo_color.a<.9:continue
		var color: Color = material.albedo_color
		if amber and color.r>.8 and color.g>.5 and color.b<.6:return true
		if not amber and color.b>.8 and color.g>.6 and color.r<.5:return true
	return false

func _run() -> void:
	var fixture: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var samples: Array = JSON.parse_string(SAMPLES_JSON)
	var world := W.new()
	root.add_child(world)
	world.setup()
	world.sync_snapshot(fixture)
	var original_plants: Array = _vegetation(world)
	for sample in samples:
		var rect: Dictionary = sample.geometry.rect
		fixture.state.jobs.append({"id":sample.id,"kind":"rail","item":"rail" if sample.track.layout!="turnout" else "railPoints","qty":1,"status":"todo","rotation":0,"x":rect.x,"z":rect.z,"w":rect.w,"d":rect.d,"track":sample.track})
		fixture.render.railGeometry.append({"id":sample.id,"geometry":sample.geometry,"planned":true})
	var original_state: String = JSON.stringify(fixture.state)
	world.sync_snapshot(fixture)
	var ids: Dictionary = {}
	for sample in samples:
		var key: String = str(sample.id)+"/plan"
		_check(world.statics.has(key),"Queued "+str(sample.track.layout)+" has a persistent ghost")
		if not world.statics.has(key):continue
		var group: Node3D = world.statics[key]
		ids[key]=group.get_instance_id()
		_check(bool(group.get_meta("ghost",false)),"Queued ghost group is marked as presentation")
		_check(not world.statics.has(str(sample.id)),"Queued rail does not create an invented installed-track asset")
		_check(_has_color(group,false),"Queued construction is conspicuously cyan")
		_ghost_properties(group,str(sample.track.layout))
		_surface_properties(group,0.0,"Soil "+str(sample.track.layout))
		_follows_paths(group,sample.geometry,str(sample.track.layout))
	_check(world.models.is_empty() and fixture.state.rails.is_empty(),"Rail planning creates no workers, equipment, cargo, or built tracks")
	_check(JSON.stringify(fixture.state)==original_state,"Ghost rendering never mutates authoritative simulation state")
	_check(_vegetation(world)==original_plants,"Planned work does not clear or redistribute vegetation")
	world.sync_snapshot(fixture)
	for key in ids:_check(world.statics.has(key) and world.statics[key].get_instance_id()==ids[key],"Unchanged queued geometry reuses its native nodes")

	fixture.state.jobs[1].status="doing"
	world.sync_snapshot(fixture)
	var doing: Node3D = world.statics.get(str(samples[1].id)+"/plan")
	_check(doing!=null and _has_color(doing,true),"Active construction changes its ghost to amber")
	if doing:_ghost_properties(doing,"Active curved work")

	# A real installed tile lifts an existing plan, without adding fictional
	# paving or lifting unrelated plans. The max overlapping surface protects
	# the whole footprint when only part of it has been paved.
	fixture.state.paving["175,27"]={"id":"PAV-GHOST-1"}
	world.sync_snapshot(fixture)
	if world.statics.has(str(samples[1].id)+"/plan"):
		_surface_properties(world.statics[str(samples[1].id)+"/plan"],.105,"Queued curve after paving")
	if world.statics.has(str(samples[0].id)+"/plan"):
		_surface_properties(world.statics[str(samples[0].id)+"/plan"],0.0,"Unrelated soil straight")
	world.preview_track([samples[1].geometry],true)
	_surface_properties(world.preview_node,.105,"Paved curve cursor preview")
	world.preview({},true)

	# Keep the planned render entries deliberately: lifecycle follows live job
	# status, so even a stale geometry descriptor must not resurrect a ghost.
	fixture.state.jobs[0].status="done"
	world.sync_snapshot(fixture)
	_check(not world.statics.has(str(samples[0].id)+"/plan"),"Finished work removes its ghost")
	fixture.state.jobs[1].status="canceled"
	world.sync_snapshot(fixture)
	_check(not world.statics.has(str(samples[1].id)+"/plan"),"Canceled work removes its ghost")
	fixture.state.jobs.remove_at(2)
	world.sync_snapshot(fixture)
	_check(not world.statics.has(str(samples[2].id)+"/plan"),"Removed work removes its ghost")
	_check(world.statics.size()==1,"Ghost lifecycle leaves only the actual opening buffer")

	# The same ghost presentation is used for cursor previews, and clearing a
	# placement tool must remove all previous rails and translucent footprints.
	world.preview_track([samples[1].geometry,samples[2].geometry],true)
	_ghost_properties(world.preview_node,"Rail cursor preview")
	_follows_paths(world.preview_node,samples[1].geometry,"Curved cursor preview")
	_follows_paths(world.preview_node,samples[2].geometry,"Turnout cursor preview")
	world.preview({},true)
	_check(world.preview_node.get_child_count()==0,"Switching placement tools clears the entire old rail preview")
	world.preview_track([samples[2].geometry],false)
	_ghost_properties(world.preview_node,"Invalid rail cursor preview")
	world.preview({},true)

	var building: Dictionary = {"id":"JOB-GHOST-OFFICE","kind":"office","status":"todo","x":20,"z":45,"w":6,"d":3}
	fixture.state.jobs.append(building)
	world.sync_snapshot(fixture)
	var building_key: String = str(building.id)+"/plan"
	_check(world.statics.has(building_key),"Queued building has a visible construction footprint")
	if world.statics.has(building_key):
		var ghost: Node3D = world.statics[building_key]
		_ghost_properties(ghost,"Building wireframe")
		_surface_properties(ghost,0.0,"Soil building wireframe",false)
		var highest: float = 0.0
		for mesh: MeshInstance3D in _meshes(ghost):
			var box: AABB = mesh.global_transform*mesh.mesh.get_aabb()
			highest=maxf(highest,box.end.y)
		_check(highest>2.9,"Queued office shows a 3D wireframe, not only a faint ground rectangle")
	fixture.state.paving["19,45"]={"id":"PAV-GHOST-ADJACENT"}
	world.sync_snapshot(fixture)
	if world.statics.has(building_key):_surface_properties(world.statics[building_key],0.0,"Building beside paved tile",false)
	fixture.state.paving["20,45"]={"id":"PAV-GHOST-BUILDING"}
	world.sync_snapshot(fixture)
	if world.statics.has(building_key):_surface_properties(world.statics[building_key],.105,"Building partly over paving",false)
	world.preview({"x":20,"z":45,"w":6,"d":3,"kind":"office"},true)
	_ghost_properties(world.preview_node,"Paved building preview")
	_surface_properties(world.preview_node,.105,"Paved building preview",false)
	world.preview({},true)
	_check(world.preview_node.get_child_count()==0,"Clearing a paved building preview removes strokes and wash")
	building.status="done"
	world.sync_snapshot(fixture)
	_check(not world.statics.has(building_key),"Completed building removes its wireframe")
	# A completed task never invents rails. Only an actual installed rail record
	# may replace a plan with the normal physical track model.
	var installed_id: String = "RAIL-GHOST-ACTUAL"
	var actual: Dictionary = {"id":installed_id,"x":samples[1].geometry.rect.x,"z":samples[1].geometry.rect.z,"w":samples[1].geometry.rect.w,"d":samples[1].geometry.rect.d,"track":samples[1].track}
	fixture.state.rails.append(actual)
	fixture.render.railGeometry.append({"id":installed_id,"geometry":samples[1].geometry,"planned":false})
	world.sync_snapshot(fixture)
	_check(world.statics.has(installed_id),"An actual installed rail record produces its physical track model")
	_check(not world.statics.has(str(samples[1].id)+"/plan"),"Installed geometry does not revive its former construction ghost")
	if world.statics.has(installed_id):
		var installed: Node3D = world.statics[installed_id]
		var physical: bool = not bool(installed.get_meta("ghost",false))
		for mesh: MeshInstance3D in _meshes(installed): physical=physical and not bool(mesh.get_meta("ghost",false)) and mesh.cast_shadow!=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_check(physical,"Installed tracks remain physical assets rather than shadow-free blueprints")
	var result := {"passed":failures.is_empty(),"checks":checks,"failures":failures,"canonicalPaths":4,"serviceStarted":false,"gpuRendering":false}
	print("GHOST_SMOKE ",JSON.stringify(result))
	quit(0 if failures.is_empty() else 1)
