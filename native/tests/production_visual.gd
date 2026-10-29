extends SceneTree
const W=preload("res://scripts/game_world.gd")
const P=preload("res://scripts/process_models.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
func _initialize()->void:_run.call_deferred()
func _run()->void:
	Engine.max_fps=60;root.content_scale_size=Vector2i(1440,900);root.size=Vector2i(1440,900);root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/production-cycle.json"))
	var game:=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.add_child(game.sun)
	game.world=W.new();game.add_child(game.world);game.world.setup();game.world.sync_snapshot(fixture);game.world.advance(.3)
	var id: String=str(fixture.productionFixture.reactorId)
	var reactor: Node3D=game.world.statics[id]
	assert(reactor.get_meta("process_kind")=="processReactor")
	assert(P.components("processReactor").size()==6)
	var inlet: Node3D=reactor.get_node("pumps/PortInlet")
	var outlet: Node3D=reactor.get_node("pumps/PortOutlet")
	var datum: float=reactor.position.y
	var data: Dictionary={}
	for b: Dictionary in fixture.state.buildings:
		if str(b.id)==id:data=b
	assert(inlet.global_position.distance_to(Vector3(float(data.x),datum+.85,float(data.z)+2.5))<.001)
	assert(outlet.global_position.distance_to(Vector3(float(data.x)+6,datum+.85,float(data.z)+2.5))<.001)
	var original: int=reactor.get_instance_id()
	for i in range(10):game.world.sync_snapshot(fixture);game.world.advance(.1)
	assert(game.world.statics[id].get_instance_id()==original)
	if RenderingServer.get_rendering_device()!=null:
		game.remove_child(game.sun);game._setup_environment();game._set_lighting(false)
		game.camera.current=true;game.camera.fov=38;game.target=Vector3(float(data.x)-3,0,float(data.z));game.distance=62;game.pitch=deg_to_rad(47);game.yaw=deg_to_rad(-18);game._update_camera(0,true);game.world.set_grid(false)
		for i in range(25):await process_frame
		RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/production-cycle.png")
	if RenderingServer.get_rendering_device()!=null:
		game.ui=game.GameUI.new();game.add_child(game.ui);game.ui.setup();game.ui.update_snapshot(fixture);game.ui.receive_reply({"action":"continue","ok":true})
		for size: Vector2i in [Vector2i(1440,900),Vector2i(1280,800)]:
			root.content_scale_size=size;root.size=size;game.ui.show_tab("Process");game.ui.show_entity(id)
			for i in range(8):await process_frame
			RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/production-register-%dx%d.png"%[size.x,size.y])
	print("PRODUCTION_VISUAL_PASS ports, assembly and persistent models")
	game.queue_free();await process_frame;quit(0)
