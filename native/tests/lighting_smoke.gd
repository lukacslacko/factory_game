extends SceneTree
const Lighting=preload("res://scripts/site_lighting.gd")
const World=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
var failures: Array[String]=[]
var checks: int=0
func _initialize()->void:_run.call_deferred()
func _check(value: bool,label: String)->void:
	checks+=1
	if not value:failures.append(label)
func _run()->void:
	var dawn: Dictionary=Lighting.profile(6*3600)
	var noon: Dictionary=Lighting.profile(12*3600)
	var sunset: Dictionary=Lighting.profile(18*3600)
	var midnight: Dictionary=Lighting.profile(0)
	_check(dawn.sunDirection.x>.99 and sunset.sunDirection.x<-.99,"Sun moves from east to west")
	_check(noon.sunDirection.y>.79 and noon.sunDirection.z>.59,"Noon sun sits high over the south side")
	_check(noon.sunEnergy>1.6 and noon.moonEnergy==0,"Daylight has a single bright sun")
	_check(midnight.sunEnergy==0 and midnight.moonEnergy>.35,"A full moon lights every night")
	_check(midnight.moonDirection.y>.79 and midnight.daylight==0,"Midnight moon is above the horizon in a night sky")
	_check(midnight.ambient>=.14 and midnight.exposure>1,"Night retains ambient readability")
	for hour: int in range(24):
		var p: Dictionary=Lighting.profile(hour*3600)
		var after: Dictionary=Lighting.profile(hour*3600+1)
		_check((p.sunDirection as Vector3).distance_to(after.sunDirection)<.001 and absf(float(p.sunEnergy)-float(after.sunEnergy))<.002,"Continuous sun at hour %d"%hour)
		_check(Lighting.profile((hour+24)*3600)==p,"Lighting repeats on simulation day %d"%hour)
	var game:=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.camera.far=650;game._setup_environment()
	game.world=World.new();game.add_child(game.world);game.world.setup()
	game.state={"time":32400.0,"paused":true,"speed":10}
	game._set_lighting(false)
	var rotation: Vector3=game.sun.rotation
	game._update_lighting(10)
	_check(game.sun.rotation==rotation,"Paused game time freezes light direction even at10×")
	game.state.paused=false;game.lighting_age=0;game._update_lighting(.1)
	_check(game.sun.rotation.distance_to(rotation)>0,"Active lighting interpolates scaled simulated time")
	game._update_lighting(2);var bounded: Vector3=game.sun.rotation;game._update_lighting(2)
	_check(game.sun.rotation==bounded,"Missing snapshots cannot advance a separate light clock")
	game.state={"time":0.0,"paused":true};game.lighting_age=0;game._update_lighting(0,true)
	_check(not game.sun.visible and game.moon.visible and game.world.dusk,"Loading night immediately restores moon and site lamp state")
	_check(game.moon.shadow_enabled and game.moon.directional_shadow_max_distance>=game.camera.far,"Moon shadows reach the visible yard")
	game._set_lighting(true);game.state.time=12*3600;game._update_lighting(0,true)
	_check(game.dusk and game.world.dusk and game.sun.light_energy<.1,"Dusk preview explicitly overrides the clock")
	game._set_lighting(false)
	_check(not game.dusk and not game.world.dusk and game.sun.light_energy>1.6,"Disabling preview returns immediately to actual noon")
	var captured: bool=false
	if RenderingServer.get_rendering_device()!=null:
		root.size=Vector2i(1440,810);root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
		game.camera.current=true;game.camera.fov=38
		game.target=Vector3(32,0,24);game.distance=72;game.pitch=deg_to_rad(48);game.yaw=deg_to_rad(-12);game._update_camera(0,true)
		var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).demo
		game.world.sync_snapshot(fixture);game.world.advance(.3);game.world.set_grid(false)
		for pair: Array in [["morning",8.0],["noon",12.0],["evening",17.0],["midnight",0.0]]:
			game.state={"time":float(pair[1])*3600,"paused":true};game.lighting_age=0;game._update_lighting(0,true)
			for frame: int in range(24):await process_frame
			RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/lighting-"+str(pair[0])+".png")
		captured=true
	game.queue_free();await process_frame
	print("LIGHTING_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"gpuCaptures":captured}))
	quit(0 if failures.is_empty() else 1)
