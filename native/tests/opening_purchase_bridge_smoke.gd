extends SceneTree
## Real packaged renderer, purchasing controls and authenticated host; synthetic saves only.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
const World=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false);set_process_unhandled_input(false)
var game:Node3D
var client:Node
var latest:Dictionary={}
var replies:Dictionary={}
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _request(action:String,args:Dictionary={})->Dictionary:
	var id:int=client.send(action,args)
	var deadline:int=Time.get_ticks_msec()+5000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timeout: "+action})
func _ok(action:String,args:Dictionary={})->Dictionary:
	var reply:Dictionary=await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state()->Dictionary:
	var result:Dictionary=await _ok("export")
	return JSON.parse_string(str(result.get("json","{}")))
func _capture(name:String)->void:
	for frame:int in range(10):await process_frame
	if RenderingServer.get_rendering_device()==null:return
	var directory:String=OS.get_environment("PLANT01_TEST_CAPTURES")
	if directory.is_empty():directory="/tmp/plant01-opening-purchase-%d"%OS.get_process_id()
	DirAccess.make_dir_recursive_absolute(directory)
	RenderingServer.force_draw(false)
	root.get_texture().get_image().save_png(directory.path_join(name+".png"))
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1440,900);root.gui_embed_subwindows=true;root.msaa_3d=Viewport.MSAA_4X
	game=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.camera.current=true;game.camera.fov=38;game.camera.far=650;game._setup_environment()
	game.world=World.new();game.add_child(game.world);game.world.setup()
	game.ui=UI.new();game.add_child(game.ui);game.ui.setup();game.ui.set_process(false)
	client=Client.new();game.add_child(client);game.client=client;client.test_directory="/tmp/plant01-opening-purchase-save-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message:Dictionary)->void:latest=message;game._snapshot(message))
	client.reply_received.connect(func(message:Dictionary)->void:
		replies[int(message.id)]=message
		if message.get("action")!="shutdown":game._reply(message))
	game.ui.command.connect(game._command);game.ui.tool_selected.connect(game._select_tool);client.start()
	var deadline:int=Time.get_ticks_msec()+10000
	while latest.is_empty() and Time.get_ticks_msec()<deadline:await process_frame
	_check(not latest.is_empty(),"Authenticated real host connects without a browser")
	if latest.is_empty():client.close();game.queue_free();await process_frame;quit(1);return
	await _ok("new_game",{"mode":"empty"});await _ok("pause",{"paused":true})
	await create_timer(.2).timeout
	game.ui.receive_reply({"action":"continue","ok":true})
	var state:Dictionary=await _state()
	_check(state.buildings.size()==1 and state.buildings[0].id=="BLD-0000" and state.buildings[0].kind=="power" and state.buildings[0].connected,"Empty yard has its real connected opening station")
	_check(state.orders.is_empty() and state.costs.is_empty() and state.electrical.runs.is_empty(),"Opening supply does not fabricate orders, costs or circuits")
	_check(latest.electrical.sources.size()==1 and latest.electrical.sources[0].capacityKw==16,"Electrical report exposes exactly one 16 kW supply")
	game.target=Vector3(3.5,0,15.5);game.distance=18;game.yaw=-.35;game.pitch=deg_to_rad(43);game._update_camera(0,true)
	game.ui.show_entity("BLD-0000");await _capture("opening-station")
	_check(game.world.entity_position("BLD-0000").distance_to(Vector3(3.5,0,15.5))<2,"Opening station is present in the native world")
	game.ui.show_purchase();await process_frame
	_check(not game.ui.purchase_quantity.has("power"),"Installation is absent from the real catalog")
	_check(game.ui._purchase_groups()[0].id=="workers" and game.ui._purchase_groups().size()==8,"Real host metadata supplies all eight themes with workers first")
	for line:Dictionary in [{"item":"builder","qty":6},{"item":"slab","qty":10}]:
		var edit:LineEdit=game.ui.purchase_quantity[line.item].get_line_edit()
		edit.text=str(line.qty);edit.text_changed.emit(edit.text)
	game.ui.purchase_quantity.builder.get_line_edit().grab_focus()
	await create_timer(.35).timeout
	_check(game.ui.purchase_rows.builder.get_meta("in_batch") and game.ui.purchase_rows.slab.get_meta("in_batch"),"Typed quantities highlight their real purchase rows")
	_check(game.ui.purchase_total.text.contains("2 carrier loads") and game.ui.purchase_total.text.contains(game.ui._money(1100)),"Authenticated packing returns one bus plus one truck and correct total")
	await _capture("grouped-purchase")
	game.ui.purchase_mode.select(1);game.ui.purchase_mode.item_selected.emit(1)
	await create_timer(.25).timeout
	_check(game.ui.purchase_rail_controls.visible and game.ui.purchase_total.text.contains("1 rail cars"),"Rail selection reveals real reception choices and a one-car load")
	await _capture("grouped-purchase-rail")
	game.ui.purchase_mode.select(0);game.ui.purchase_mode.item_selected.emit(0)
	game.ui._place_purchase();await create_timer(.3).timeout
	state=await _state()
	_check(state.orders.size()==2,"Actual batch submission creates two correctly packed carriers")
	var crew:int=0;var slabs:int=0
	for order:Dictionary in state.orders:
		for line:Dictionary in order.get("manifest",[{"item":order.item,"qty":order.qty}]):
			if line.item=="builder":crew+=int(line.qty)
			if line.item=="slab":slabs+=int(line.qty)
	_check(crew==6 and slabs==10,"Submitted manifest matches the quantities shown to the player")
	_check(game.ui._purchase_lines().is_empty(),"Successful order clears committed and uncommitted quantities")
	await _ok("save");await _ok("shutdown");client.close();game.queue_free();await process_frame
	print("OPENING_PURCHASE_BRIDGE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"isolated":true}))
	quit(0 if failures.is_empty() else 1)
