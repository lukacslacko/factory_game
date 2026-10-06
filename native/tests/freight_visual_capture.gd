extends SceneTree
## Dedicated deterministic two-shot GPU QA. No browser or simulation service.
const W=preload("res://scripts/game_world.gd")
const UI=preload("res://scripts/game_ui.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:
		set_process(false);set_process_input(false);set_process_unhandled_input(false)
var game:MainHarness
func _initialize()->void:_run.call_deferred()
func _settle()->void:
	for i in range(24):
		await process_frame
		RenderingServer.force_draw(false)
func _capture(name:String)->void:
	await _settle()
	root.get_texture().get_image().save_png("res://captures/freight-"+name+".png")
func _run()->void:
	if RenderingServer.get_rendering_device()==null:
		push_error("Freight visual capture needs a GPU renderer");quit(1);return
	Engine.max_fps=60
	root.size=Vector2i(1920,1080);root.content_scale_size=Vector2i(1920,1080)
	root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	game=MainHarness.new();root.add_child(game)
	game.capture_mode=true
	game.world=W.new();game.add_child(game.world);game.world.setup()
	game._setup_environment();game.add_child(game.camera)
	game.camera.current=true;game.camera.fov=38;game.camera.near=.2;game.camera.far=650
	game.ui=UI.new();game.add_child(game.ui);game.ui.setup();game.ui.startup.hide();game.ui.started=true
	game._set_lighting(false)
	var index:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/freight-index.json"))
	var report:Array=[]
	for shot in index.shots:
		var message:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/"+str(shot.filename)))
		game.state=message.state;game.world.sync_snapshot(message);game.world.advance(.4);game.world.set_grid(false)
		game.ui.update_snapshot(message);game.ui.show_tab("Yard");game.ui.show_entity(shot.orderId)
		game.ui.refresh_pending=true;game.ui.inspector_pending=true
		game.target=Vector3(float(shot.focus.x)-7,0,float(shot.focus.z));game.distance=97;game.pitch=deg_to_rad(53);game.yaw=deg_to_rad(-7)
		game._update_camera(0,true)
		await _capture(str(shot.name))
		report.append({"name":shot.name,"carCount":game.world.render.carriers[0].cars.size(),"models":game.world.models.size(),"status":shot.status})
	game.ui.show_tab("Help")
	await _capture("help")
	print("FREIGHT_VISUAL_CAPTURE ",JSON.stringify({"passed":true,"shots":report,"helpCaptured":true,"serviceStarted":false,"size":"1920x1080"}))
	quit(0)
