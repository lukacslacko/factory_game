extends SceneTree

const W=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false);set_process_unhandled_input(false)

func _initialize()->void:_run.call_deferred()

func _run()->void:
	if RenderingServer.get_rendering_device()==null:
		push_error("Vegetation capture requires a real GPU renderer");quit(1);return
	Engine.max_fps=60;root.size=Vector2i(1600,900);root.content_scale_size=Vector2i(1600,900)
	root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	var game:=MainHarness.new();root.add_child(game);game.capture_mode=true
	game.world=W.new();game.add_child(game.world);game.world.setup();game._setup_environment();game.add_child(game.camera)
	game.camera.current=true;game.camera.fov=38;game.camera.near=.2;game.camera.far=650
	game.target=Vector3(34,0,26);game.distance=90;game.pitch=deg_to_rad(49);game.yaw=deg_to_rad(-12);game._update_camera(0,true)
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).demo.duplicate(true)
	fixture.state["vegetationLastDisturbed"]={}
	game.state=fixture.state;game.world.sync_snapshot(fixture);game.world.advance(.4);game.world.set_grid(false)
	game._set_lighting(false);game.state.time=12*3600;game._update_lighting(0,true)
	for i:int in range(24):await process_frame
	RenderingServer.force_draw(false)
	var directory:String=OS.get_environment("PLANT01_CAPTURE_DIR")
	if directory.is_empty():directory="/private/tmp"
	DirAccess.make_dir_recursive_absolute(directory)
	var output:String=directory.path_join("plant01-vegetation.png")
	var error:Error=root.get_texture().get_image().save_png(output)
	fixture.state.elapsed=3600.0
	for x:int in range(30,86):
		for z:int in [42,44]:fixture.state.groundWear[str(x)+","+str(z)]=1.0
		for z:int in range(41,46):fixture.state.vegetationLastDisturbed[str(x)+","+str(z)]=3600.0
	game.world.wear_last_update_ms=0;game.world.vegetation_last_update_ms=0
	game.world.sync_snapshot(fixture)
	for i:int in range(24):await process_frame
	RenderingServer.force_draw(false)
	var worn_output:String=directory.path_join("plant01-vegetation-worn.png")
	var worn_error:Error=root.get_texture().get_image().save_png(worn_output)
	var patch_count:int=game.world.plants.size()
	game.queue_free();await process_frame
	print("VEGETATION_VISUAL_CAPTURE ",JSON.stringify({"passed":error==OK and worn_error==OK,"initial":output,"worn":worn_output,"patches":patch_count}))
	quit(0 if error==OK and worn_error==OK else 1)
