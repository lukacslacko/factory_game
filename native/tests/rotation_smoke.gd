extends SceneTree

# Exercise the real native interpolator and articulated excavator/load models.
# Protocol poses are canonical adapter outputs; render.ts has separate tests
# proving accumulated simulation yaw becomes these bounded upper-body angles.
const World = preload("res://scripts/game_world.gd")
const MACHINE: String = "EQ-9001"
const PANEL: String = "JOB-9001/panel"
var failures: Array[String] = []
var frames: int = 0
var snapshot_index: int = 0

func _initialize() -> void:
	_run.call_deferred()

func _check(condition: bool,text: String) -> void:
	if not condition and not text in failures: failures.append(text)

func _snapshot(yaw: float,upper_yaw: float,carried: bool = false,x: float = 20.0) -> Dictionary:
	snapshot_index+=1
	var actor: Dictionary = {"id":MACHINE,"kind":"excavator","x":x,"z":25.0,"y":0.0,"yaw":yaw,"upperYaw":upper_yaw,"reach":4.0,"lift":1.675,"operator":"WRK-9001","work":1}
	var bearing: float = yaw-upper_yaw
	var panel: Dictionary = {"x":x+4.0*cos(bearing),"z":25.0+4.0*sin(bearing),"y":0.65,"yaw":yaw+PI/2.0,"state":"carried" if carried else "stored"}
	return {"state":{"elapsed":float(snapshot_index),"next":20,"workers":[{"id":"WRK-9001","vehicle":MACHINE}],"equipment":[actor],"jobs":[{"id":"JOB-9001","item":"rail","kind":"rail","status":"doing","x":24.0,"z":24.0,"w":5.0,"d":2.0,"rotation":0}],"buffer":{"x":125.0,"z":5.0}},"render":{"actors":[actor],"railWork":[{"jobId":"JOB-9001","equipmentId":MACHINE,"phase":"panel-carry" if carried else "source-rig","panel":panel}]}}

func _bearing(node: Node3D) -> float:
	var direction: Vector3 = node.global_basis*Vector3.FORWARD
	return atan2(direction.z,direction.x)

func _upper(world: Node3D) -> Node3D:
	return (world.models[MACHINE] as Node3D).get_node("Upper")

func _settle(world: Node3D,message: Dictionary) -> void:
	world.sync_snapshot(message)
	world.span=0.2
	world.advance(0.2)

func _sweep(world: Node3D,message: Dictionary,expected_turn: float,label_text: String) -> void:
	var before: float = _bearing(_upper(world))
	world.sync_snapshot(message)
	world.span=0.2
	var traveled: float = 0.0
	for i: int in range(100):
		world.advance(0.002)
		frames+=1
		var current: float = _bearing(_upper(world))
		var step: float = absf(angle_difference(before,current))
		_check(step<0.012,label_text+": every frame follows a short smooth angular step")
		traveled+=step
		before=current
	_check(absf(traveled-expected_turn)<0.003,label_text+": total turn excludes an accidental full revolution")
	var pose: Dictionary = world.records[MACHINE].current
	_check(absf(angle_difference(before,float(pose.yaw)-float(pose.upperYaw)))<0.0002,label_text+": actual articulated model follows interpolated bearing")

func _run() -> void:
	var world: Node3D = World.new()
	root.add_child(world)
	world.setup()
	# Empty rail-pickup machine, after many turns of its accumulated chassis yaw.
	var accumulated: float = 9.0*TAU+0.31
	_settle(world,_snapshot(accumulated,-0.20))
	_check(not world.models.has(PANEL),"An empty pickup bucket has no invented carried panel")
	_sweep(world,_snapshot(accumulated,-0.55),0.35,"Empty rail-pickup upper-body alignment")
	_settle(world,_snapshot(accumulated,PI-0.04))
	_sweep(world,_snapshot(accumulated,-PI+0.06),0.10,"Forward angular branch-cut crossing")
	_sweep(world,_snapshot(accumulated,PI-0.03),0.09,"Reverse angular branch-cut crossing")
	# A new snapshot arrives before the previous one has finished. Starting the
	# new segment must use the currently displayed angle, with no snap or unwind.
	world.sync_snapshot(_snapshot(accumulated,-PI+0.10))
	world.span=0.2
	world.advance(0.08)
	var interrupted: float = _bearing(_upper(world))
	world.sync_snapshot(_snapshot(accumulated,-PI+0.16))
	world.span=0.2
	world.advance(0.0)
	_check(absf(angle_difference(interrupted,_bearing(_upper(world))))<0.0002,"Interrupted snapshot begins at the actual displayed upper-body pose")
	var before: float = interrupted
	for i: int in range(100):
		world.advance(0.002)
		frames+=1
		var current: float = _bearing(_upper(world))
		_check(absf(angle_difference(before,current))<0.005,"Interrupted branch-cut interpolation never creates a sudden spin")
		before=current
	# Carried rail moves with its parent, retaining its true tool-relative
	# bearing and panel yaw even while the chassis crosses +/- PI snapshots.
	var tool_angle: float = 0.42
	_settle(world,_snapshot(accumulated,tool_angle,true))
	_check(world.models.has(PANEL),"The real carried rail panel has its native model")
	_check(bool((world.models[MACHINE] as Node3D).get_meta("suspended_load",false)),"Carried rail uses the articulated machine's suspension rig")
	var finish_yaw: float = accumulated+0.34
	world.sync_snapshot(_snapshot(finish_yaw,tool_angle,true,23.0))
	world.span=0.2
	before=_bearing(_upper(world))
	for i: int in range(100):
		world.advance(0.002)
		frames+=1
		var parent: Dictionary = world.records[MACHINE].current
		var load: Dictionary = world.records[PANEL].current
		var dx: float = float(load.x)-float(parent.x)
		var dz: float = float(load.z)-float(parent.z)
		_check(absf(Vector2(dx,dz).length()-4.0)<0.0002,"Attached cargo retains its real four-meter tool reach")
		_check(absf(angle_difference(atan2(dz,dx),float(parent.yaw)-tool_angle))<0.0002,"Attached cargo retains fixed bearing relative to the upper body")
		_check(absf(angle_difference(float(load.yaw)-float(parent.yaw),PI/2.0))<0.0002,"Attached rail retains its fixed orientation relative to its chassis")
		_check((world.models[PANEL] as Node3D).position.distance_to(Vector3(float(load.x),float(load.y),float(load.z)))<0.0002,"The physical load model follows its interpolated attachment pose")
		var current: float = _bearing(_upper(world))
		_check(absf(angle_difference(before,current))<0.012,"Carried-panel chassis turning remains smooth")
		before=current
	world.sync_snapshot(_snapshot(finish_yaw+0.14,tool_angle,true,24.0))
	world.span=0.2
	world.advance(0.08)
	var load_interrupted: Vector3 = (world.models[PANEL] as Node3D).position
	var upper_interrupted: float = _bearing(_upper(world))
	finish_yaw+=0.24
	world.sync_snapshot(_snapshot(finish_yaw,tool_angle,true,25.0))
	world.span=0.2
	world.advance(0.0)
	_check((world.models[PANEL] as Node3D).position.distance_to(load_interrupted)<0.0002,"Interrupted carried-load snapshot preserves the displayed cargo position")
	_check(absf(angle_difference(upper_interrupted,_bearing(_upper(world))))<0.0002,"Interrupted carried-load snapshot preserves the displayed machine articulation")
	for i: int in range(100):
		world.advance(0.002)
		frames+=1
		var parent: Dictionary = world.records[MACHINE].current
		var load: Dictionary = world.records[PANEL].current
		var offset: Vector2 = Vector2(float(load.x)-float(parent.x),float(load.z)-float(parent.z))
		_check(absf(offset.length()-4.0)<0.0002,"Interrupted cargo interpolation retains physical tool reach")
		_check(absf(angle_difference(atan2(offset.y,offset.x),float(parent.yaw)-tool_angle))<0.0002,"Interrupted cargo interpolation retains fixed tool-relative bearing")
	# Equivalent +/- PI chassis representations cannot move or rotate cargo.
	var equivalent: float = wrapf(finish_yaw,-PI,PI)
	var cargo_before: Vector3 = (world.models[PANEL] as Node3D).position
	_sweep(world,_snapshot(equivalent,tool_angle,true,25.0),0.0,"Equivalent accumulated and normalized chassis angles")
	_check((world.models[PANEL] as Node3D).position.distance_to(cargo_before)<0.0002,"Normalizing accumulated yaw cannot displace an attached load")
	print("ROTATION_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"failures":failures,"frames":frames,"emptyPickup":true,"carriedRail":true,"interruptedSnapshot":true}))
	quit(0 if failures.is_empty() else 1)
