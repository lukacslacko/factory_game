extends SceneTree
## Native model study only. No simulation state or player save is changed.
const Models=preload("res://scripts/game_models.gd")
const G=preload("res://scripts/geometry.gd")
func _initialize()->void:_run.call_deferred()
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1100,900);root.msaa_3d=Viewport.MSAA_4X
	var scene:=Node3D.new();root.add_child(scene)
	var env:=WorldEnvironment.new();scene.add_child(env);env.environment=Environment.new()
	env.environment.background_mode=Environment.BG_COLOR;env.environment.background_color=Color("d9dfd8")
	env.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;env.environment.ambient_light_color=Color("e8e8dd");env.environment.ambient_light_energy=.65
	var sun:=DirectionalLight3D.new();scene.add_child(sun);sun.rotation_degrees=Vector3(-47,-25,0);sun.light_energy=1.5;sun.shadow_enabled=true;sun.directional_shadow_max_distance=30
	G.box(scene,Vector3(0,-.06,0),Vector3(22,.12,22),G.mat("969888",.9))
	var camera:=Camera3D.new();scene.add_child(camera);camera.current=true;camera.fov=35
	var worker:Node3D=Models.actor(scene,"worker",{"id":"WK-CAN","name":"Worker #1"});worker.set_meta("kind","worker")
	var barrel:Node3D=Models.stock(scene,"diesel",1);barrel.position=Vector3(0,0,-.75)
	var machine:Node3D=Models.actor(scene,"excavator",{"id":"EX6"});machine.set_meta("kind","excavator");machine.visible=false
	var p:Dictionary={"walking":false,"travel":2.,"workClock":2.,"fuelCan":{}}
	for phase:String in ["empty","fill","carry","pour-excavator","pour-forklift"]:
		var pouring:bool=phase.begins_with("pour")
		worker.position=Vector3.ZERO;worker.rotation=Vector3.ZERO;barrel.visible=phase=="fill";machine.visible=pouring
		var target:Dictionary={}
		if phase=="fill":target={"x":.13,"y":.94,"z":-.69}
		if pouring:
			var kind:String="forklift" if phase.ends_with("forklift") else "excavator"
			machine.free();machine=Models.actor(scene,kind,{"id":"FL25" if kind=="forklift" else "EX6"});machine.set_meta("kind",kind)
			Models.animate_actor(machine,{"refueling":"JOB-CAN"},.1)
			var side:float=1.35 if kind=="forklift" else 1.75
			worker.position=Vector3(side,0,.2);worker.rotation.y=PI*.5
			var port:Vector3=machine.get_node("FuelFiller/Port").global_position
			target={"x":port.x,"y":port.y,"z":port.z}
		p.walking=phase in ["empty","carry"]
		p.fuelCan={"phase":"pour" if pouring else phase,"liters":0. if phase in ["empty","fill"] else 11.,"clock":2.,"target":target}
		for i:int in range(45):
			Models.animate_actor(worker,p,1.0/60.0)
			await process_frame
		var focus:Vector3=worker.position+Vector3(0,1.0,0)
		camera.position=focus+(Vector3(1.3,1.1,-3.5) if pouring else Vector3(2.5,1.1,-3.5));camera.look_at(focus)
		for i:int in range(6):await process_frame
		RenderingServer.force_draw(false)
		root.get_texture().get_image().save_png("res://captures/fuel-can-"+phase+".png")
	print("FUEL_CAN_CAPTURE ",JSON.stringify({"passed":true,"poses":5,"fixtureOnly":true}))
	quit(0)
