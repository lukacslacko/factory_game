extends RefCounted
## Physical underground service props. Completed cable remains buried; these
## models represent excavated soil and installed hardware, never power overlays.
const G=preload("res://scripts/geometry.gd")
const R=preload("res://scripts/rail_yard.gd")
const Ground=preload("res://scripts/ground.gd")
static var excavated_soil:ShaderMaterial
static func cable_reel(parent:Node3D,meters:float=50.0)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="PhysicalCableReel";root.set_meta("cable_meters",maxf(0.,meters))
	var wood:Material=G.mat("ab8450",.86);var edge:Material=G.mat("74522f",.88);var steel:Material=G.mat("c0c8c3",.22,.8)
	for x:float in [-.34,.34]:
		var flange:MeshInstance3D=G.cylinder(root,Vector3(x,.47,0),.45,.055,wood,40);flange.rotation.z=PI*.5
		var rim:MeshInstance3D=G.cylinder(root,Vector3(x+signf(x)*.031,.47,0),.455,.012,edge,40);rim.rotation.z=PI*.5
		for index:int in range(8):
			var angle:float=index*TAU/8.;var bolt:MeshInstance3D=G.cylinder(root,Vector3(x+signf(x)*.042,.47+cos(angle)*.31,sin(angle)*.31),.018,.016,steel,6);bolt.rotation.z=PI*.5
	var core:MeshInstance3D=G.cylinder(root,Vector3(0,.47,0),.13,.65,edge,32);core.rotation.z=PI*.5
	if meters>.0001:
		var radius:float=.14+.25*sqrt(clampf(meters/50.,0.,1.))
		for index:int in range(13):
			var coil:MeshInstance3D=G.cylinder(root,Vector3(-.29+index*.048,.47,0),radius,.043,G.mat("26302e",.55,.12),40);coil.rotation.z=PI*.5
	G.rod(root,Vector3(-.40,.47,0),Vector3(.40,.47,0),.036,steel,16)
	for x:float in [-.34,.34]:G.box(root,Vector3(x,.025,0),Vector3(.16,.05,.7),wood)
	var label:Label3D=G.label(root,"50 m LV" if meters>=49.99 else "EMPTY" if meters<.001 else "%.1f m LV"%meters,Vector3(.378,.47,.05),24,.0028);label.rotation.y=PI*.5
	return root
static func station(parent:Node3D,data:Dictionary)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="LowPowerIncomingStation";root.set_meta("capacity_kw",16.)
	var metal:Material=G.mat("c2c9bb",.42,.44);var dark:Material=G.mat("46584a",.58,.45);var steel:Material=G.mat("cbd2ca",.2,.85)
	G.beveled_box(root,Vector3(0,.075,0),Vector3(.94,.15,.86),G.mat("b8b29f",.95),.025)
	G.beveled_box(root,Vector3(0,.83,0),Vector3(.74,1.35,.55),metal,.03)
	G.beveled_box(root,Vector3(0,1.52,0),Vector3(.80,.065,.61),dark,.02)
	G.beveled_box(root,Vector3(0,.83,.285),Vector3(.65,1.20,.025),G.mat("d8d9ca",.48,.32),.014)
	for y:float in [.35,1.26]:G.box(root,Vector3(-.337,y,.31),Vector3(.035,.12,.035),steel)
	G.beveled_box(root,Vector3(.24,.84,.325),Vector3(.03,.17,.035),dark,.01)
	for index:int in range(7):G.box(root,Vector3(0,.34+index*.035,.304),Vector3(.37,.012,.012),dark)
	G.box(root,Vector3(0,1.13,.306),Vector3(.22,.19,.012),G.mat("e7bf37",.6))
	G.label(root,"⚡",Vector3(0,1.13,.318),30,.0037)
	G.label(root,"16 kW",Vector3(0,1.39,.31),26,.0033)
	G.rod(root,Vector3(-.22,.20,-.18),Vector3(-.22,-.02,-.18),.033,dark,16)
	var indicator:MeshInstance3D=G.sphere(root,Vector3(.23,1.18,.319),.025,G.mat("5d9e67",.28));indicator.name="SupplyIndicator"
	update_station(root,data);return root
static func update_station(root:Node3D,data:Dictionary)->void:
	root.set_meta("energized",bool(data.get("energized",false)))
	var indicator:Node3D=root.get_node_or_null("SupplyIndicator")
	if indicator:indicator.visible=bool(data.get("energized",false))
static func pump_isolator(parent:Node3D)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="ElectricalIsolator"
	var metal:Material=G.mat("c6cbbf",.4,.48);var dark:Material=G.mat("3b4943",.6,.35)
	G.beveled_box(root,Vector3(.69,.46,.62),Vector3(.25,.34,.16),metal,.018)
	G.box(root,Vector3(.69,.46,.707),Vector3(.21,.29,.018),G.mat("deded0",.45,.3))
	var knob:MeshInstance3D=G.cylinder(root,Vector3(.69,.46,.73),.042,.032,G.mat("b94330",.4,.2),16);knob.rotation.x=PI*.5
	G.box(root,Vector3(.69,.46,.752),Vector3(.018,.064,.012),dark)
	G.label(root,"⚡",Vector3(.69,.56,.723),24,.0016)
	G.rod(root,Vector3(.69,.28,.62),Vector3(.69,.12,.62),.019,dark,12)
	G.rod(root,Vector3(.69,.12,.62),Vector3(-.40,.12,.62),.019,dark,12)
	G.rod(root,Vector3(-.40,.12,.62),Vector3(-.40,.12,-.44),.019,dark,12)
	G.rod(root,Vector3(-.40,.12,-.44),Vector3(-.40,.40,-.44),.019,dark,12)
	var lamp:MeshInstance3D=G.sphere(root,Vector3(.76,.36,.72),.013,G.mat("6eb87b",.3));lamp.name="PoweredIndicator";lamp.visible=false
	return root
static func update_isolator(root:Node3D,powered:bool)->void:
	root.set_meta("powered",powered)
	var lamp:Node3D=root.get_node_or_null("PoweredIndicator")
	if lamp:lamp.visible=powered
static func terrain_mesh(cuts:Array)->ArrayMesh:
	# Horizontal interval subtraction actually removes the old surface. No
	# coplanar decal and no cover floating above an uncut infinite plane.
	var z_values:Array[float]=[-195.,305.]
	for cut:Dictionary in cuts:z_values.append(float(cut.z));z_values.append(float(cut.z)+float(cut.d))
	z_values.sort();var unique:Array[float]=[]
	for z:float in z_values:
		if unique.is_empty() or absf(z-unique.back())>.00001:unique.append(z)
	var st:=SurfaceTool.new();st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for index:int in range(unique.size()-1):
		var low:float=unique[index];var high:float=unique[index+1];var middle:float=(low+high)*.5
		var intervals:Array[Vector2]=[]
		for cut:Dictionary in cuts:
			if middle>float(cut.z) and middle<float(cut.z)+float(cut.d):intervals.append(Vector2(float(cut.x),float(cut.x)+float(cut.w)))
		intervals.sort_custom(func(a:Vector2,b:Vector2)->bool:return a.x<b.x)
		var left:float=-310.
		for interval:Vector2 in intervals:
			if interval.x>left:_horizontal(st,left,interval.x,low,high,0.)
			left=maxf(left,interval.y)
		if left<450.:_horizontal(st,left,450.,low,high,0.)
	st.generate_normals();st.generate_tangents();return st.commit()
static func _horizontal(st:SurfaceTool,x0:float,x1:float,z0:float,z1:float,y:float)->void:
	for point:Vector3 in [Vector3(x0,y,z0),Vector3(x1,y,z0),Vector3(x1,y,z1),Vector3(x0,y,z0),Vector3(x1,y,z1),Vector3(x0,y,z1)]:
		st.set_uv(Vector2(point.x,point.z));st.add_vertex(point)
static func _neighbor_depth(point:Vector2,cuts:Array)->float:
	for cut:Dictionary in cuts:
		if point.x>float(cut.x)+.00001 and point.x<float(cut.x)+float(cut.w)-.00001 and point.y>float(cut.z)+.00001 and point.y<float(cut.z)+float(cut.d)-.00001:return float(cut.get("depth",0))
	return 0.0
static func trench(parent:Node3D,cell:Dictionary,cuts:Array)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="OpenElectricalTrench";root.set_meta("depth_m",float(cell.get("depth",0)))
	var depth:float=maxf(.005,float(cell.get("depth",0)));var floor_y:float=-depth
	var floor_material:Material=G.mat("6d5639",.98);var wall_material:Material=G.mat("8c6d45",.98)
	for cut:Dictionary in cell.get("cuts",[]):
		var x0:float=float(cut.x);var x1:float=x0+float(cut.w);var z0:float=float(cut.z);var z1:float=z0+float(cut.d)
		G.box(root,Vector3((x0+x1)*.5,floor_y-.015,(z0+z1)*.5),Vector3(x1-x0,.03,z1-z0),floor_material)
		var edges:Array=[ [Vector2(x0,z0),Vector2(x1,z0),Vector2(0,-.002)], [Vector2(x1,z0),Vector2(x1,z1),Vector2(.002,0)], [Vector2(x1,z1),Vector2(x0,z1),Vector2(0,.002)], [Vector2(x0,z1),Vector2(x0,z0),Vector2(-.002,0)] ]
		for edge:Array in edges:
			var a:Vector2=edge[0];var b:Vector2=edge[1];var normal:Vector2=edge[2]
			# Split at20cm strips; overlapping corner legs never create a wall
			# across the continuous trench interior.
			var pieces:int=ceili(a.distance_to(b)/.2)
			for index:int in range(pieces):
				var p:Vector2=a.lerp(b,float(index)/pieces);var q:Vector2=a.lerp(b,float(index+1)/pieces)
				var neighbor_depth:float=_neighbor_depth((p+q)*.5+normal,cuts)
				if neighbor_depth>=depth-.0001:continue
				var top_y:float=-neighbor_depth
				var mesh:=SurfaceTool.new();mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
				for v:Vector3 in [Vector3(p.x,top_y,p.y),Vector3(q.x,top_y,q.y),Vector3(q.x,floor_y,q.y),Vector3(p.x,top_y,p.y),Vector3(q.x,floor_y,q.y),Vector3(p.x,floor_y,p.y)]:mesh.add_vertex(v)
				mesh.generate_normals();G.instance(root,mesh.commit(),wall_material,Vector3.ZERO)
	if bool(cell.get("cableInstalled",false)) and depth>.555:
		for segment:Dictionary in cell.get("cableSegments",[]):
			var a:Dictionary=segment.a;var b:Dictionary=segment.b
			G.rod(root,Vector3(float(a.x),-.555,float(a.z)),Vector3(float(b.x),-.555,float(b.z)),.022,G.mat("26302e",.58,.12),12)
	return root
static func spoil(parent:Node3D,cell:Dictionary)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="ReservedExcavatedSpoil"
	var rect:Dictionary=cell.get("spoilRect",{});var volume:float=float(cell.get("spoilM3",0));root.set_meta("soil_m3",volume)
	if rect.is_empty() or volume<=.0001:return root
	var x:float=float(rect.x);var z:float=float(rect.z);var w:float=float(rect.get("w",1));var d:float=float(rect.get("d",1))
	# A deterministic rough mound, normalized by the actual triangle integral.
	# Its irregular top never changes the surveyed footprint or creates soil.
	var nx:int=8;var nz:int=12;var heights:Array[float]=[]
	for iz:int in range(nz+1):
		for ix:int in range(nx+1):
			var u:float=float(ix)/nx;var v:float=float(iz)/nz
			heights.append(maxf(0.,sin(PI*u)*sin(PI*v)*(1.+.17*sin(ix*2.17+iz*1.83+x*.7+z*.4))))
	var area:float=w*d/(nx*nz);var integral:float=0.
	for iz:int in range(nz):
		for ix:int in range(nx):
			var a:int=iz*(nx+1)+ix;var b:int=a+1;var c:int=b+nx+1;var e:int=a+nx+1
			integral+=area*(2*heights[a]+heights[b]+2*heights[c]+heights[e])/6.
	var base:float=minf(.003,volume/(w*d)*.1);var scale:float=(volume-base*w*d)/maxf(.00001,integral)
	var st:=SurfaceTool.new();st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for iz:int in range(nz):
		for ix:int in range(nx):
			var a:int=iz*(nx+1)+ix;var b:int=a+1;var c:int=b+nx+1;var e:int=a+nx+1
			for index:int in [a,b,c,a,c,e]:
				var px:float=x+float(index%(nx+1))/nx*w;var pz:float=z+float(index/(nx+1))/nz*d
				st.set_uv(Vector2(px,pz));st.add_vertex(Vector3(px,base+heights[index]*scale,pz))
	st.generate_normals();st.generate_tangents()
	if not excavated_soil:
		excavated_soil=Ground._surface(0,"6d5639","8c6d45")
	G.instance(root,st.commit(),excavated_soil,Vector3.ZERO)
	return root
static func access_marker(parent:Node3D,cell:Dictionary)->Node3D:
	var root:=Node3D.new();parent.add_child(root);root.name="BuriedCableAccessMarker"
	var y:float=.112 if bool(cell.get("paved",false)) else .012
	G.box(root,Vector3(float(cell.x)+.5,y,float(cell.z)+.5),Vector3(.21,.018,.21),G.mat("d7b24b",.8,.25))
	for x:float in [-.07,.07]:G.cylinder(root,Vector3(float(cell.x)+.5+x,y+.012,float(cell.z)+.5),.009,.006,G.mat("616b60",.5,.55),6)
	return root

static func animate_worker(worker:Node3D,data:Dictionary)->void:
	var work:Dictionary=data.get("electricalWork",{})
	var phase:String=str(work.get("phase",""))
	var active:bool=float(work.get("cableInHand",0))>0 and phase in ["collect-cable","lay","approach","recover-cable","return-cable"]
	var cable:Node3D=worker.get_node_or_null("CableInHands")
	if active and not cable:
		cable=Node3D.new();cable.name="CableInHands";worker.add_child(cable)
		G.rod(cable,Vector3(-.32,1.17,-.40),Vector3(.32,1.17,-.40),.017,G.mat("26302e",.6),12)
		G.rod(cable,Vector3(.32,1.17,-.40),Vector3(.32,.81,-.40),.017,G.mat("26302e",.6),12)
	if cable:cable.visible=active
	if active or phase in ["lay","terminate-source","terminate-target","test","recover-cable","isolate-source","isolate-target"]:
		for name:String in ["ArmL","ArmR"]:
			var arm:Node3D=worker.get_node_or_null(name)
			if arm:arm.rotation.x=.85+sin(float(data.get("workClock",work.get("clock",0)))*3.)*.09

static func bucket_soil(bucket:Node3D,volume:float)->void:
	var load:MeshInstance3D=bucket.get_node_or_null("ActualExcavatedSoil")
	if volume>.0001 and not load:
		load=G.beveled_box(bucket,Vector3(0,-.36,-.34),Vector3(.60,.30,.60),G.mat("6d5639",.98),.025);load.name="ActualExcavatedSoil"
	if load:
		load.visible=volume>.0001;load.scale.y=maxf(.001,volume/.108);load.set_meta("soil_m3",volume)

static func lamp_terminal(parent:Node3D)->void:
	var root:=Node3D.new();parent.add_child(root);root.name="ProtectedCableTerminal"
	G.beveled_box(root,Vector3(.15,.35,.10),Vector3(.18,.24,.12),G.mat("b8c2b4",.5,.3),.012)
	G.box(root,Vector3(.15,.35,.168),Vector3(.15,.21,.012),G.mat("cbd0bf",.6,.2))
	G.rod(root,Vector3(.15,.22,.10),Vector3(.15,.02,.10),.016,G.mat("46584a",.6,.3),12)
	for y:float in [.28,.42]:G.cylinder(root,Vector3(.15,y,.18),.008,.008,G.mat("718075",.4,.7),6).rotation.x=PI*.5
