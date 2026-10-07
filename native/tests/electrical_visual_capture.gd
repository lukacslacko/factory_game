extends SceneTree
## Serial GPU review only: snapshots are real core electrical construction states.
const W=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false);set_process_unhandled_input(false)
func _initialize()->void:_run.call_deferred()
func _run()->void:
	if RenderingServer.get_rendering_device()==null:push_error("Electrical capture needs the granted native GPU slot");quit(1);return
	Engine.max_fps=60;root.size=Vector2i(1600,1000);root.content_scale_size=Vector2i(1600,1000)
	root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	var game:=MainHarness.new();root.add_child(game);game.capture_mode=true
	game.world=W.new();game.add_child(game.world);game.world.setup();game._setup_environment();game.add_child(game.camera)
	game.camera.current=true;game.camera.fov=38;game.camera.near=.2;game.camera.far=650;game._set_lighting(false)
	var index:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/electrical-index.json"))
	var records:Array=[]
	for shot:Dictionary in index.shots:
		var message:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/"+str(shot.filename)))
		game.state=message.state;game.world.sync_snapshot(message);game.world.advance(.4);game.world.set_grid(true);game.world.set_selected("")
		game.target=Vector3(float(shot.focus.x)-1,0,float(shot.focus.z)+1);game.distance=23;game.pitch=deg_to_rad(49);game.yaw=deg_to_rad(135);game._update_camera(0,true)
		for i:int in range(24):await process_frame
		RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/"+str(shot.name)+".png")
		records.append({"name":shot.name,"phase":shot.phase,"openTrenches":game.world.render.electrical.trenches.size(),"selectedRoute":false})
	game.queue_free();await process_frame
	print("ELECTRICAL_VISUAL_CAPTURE ",JSON.stringify({"passed":true,"shots":records,"serviceStarted":false}))
	quit(0)
