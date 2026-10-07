extends SceneTree
## Authenticated electrical host + production UI/main/world, isolated public fixtures.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
const World=preload("res://scripts/game_world.gd")
const Electrical=preload("res://scripts/electrical_ui.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false);set_process_unhandled_input(false)
var client:Node
var game:Node3D
var replies:Dictionary={}
var latest:Dictionary={}
var checks:int=0
var failures:Array[String]=[]
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _wait_reply(id:int,action:String)->Dictionary:
	var deadline:int=Time.get_ticks_msec()+5000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timeout: "+action})
func _request(action:String,args:Dictionary={})->Dictionary:return await _wait_reply(client.send(action,args),action)
func _ok(action:String,args:Dictionary={})->Variant:
	var reply:Dictionary=await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state()->Dictionary:
	var result:Dictionary=await _ok("export")
	return JSON.parse_string(str(result.get("json","{}")))
func _fixture(name:String)->Dictionary:
	var directory:String=OS.get_environment("PLANT01_TEST_FIXTURES")
	if directory.is_empty():directory="res://tests/fixtures"
	var filename:String=directory.path_join(name+".save.json")
	_check(FileAccess.file_exists(filename),"Generated physical fixture exists: "+name)
	return JSON.parse_string(FileAccess.get_file_as_string(filename)) if FileAccess.file_exists(filename) else {}
func _button(node:Node,text:String)->Button:
	if node is Button and node.text==text:return node
	for child:Node in node.get_children():
		var found:Button=_button(child,text)
		if found:return found
	return null
func _load(state:Dictionary)->void:
	await _ok("import",{"json":JSON.stringify(state)})
	await create_timer(.2).timeout
func _capture(name:String,tab:String)->void:
	game.ui.show_tab(tab);game.ui.show_entity("")
	game.target=Vector3(33,0,31);game.distance=35;game.yaw=-.35;game.pitch=deg_to_rad(43);game._update_camera(0,true)
	game.world.visible=tab=="Yard"
	for frame:int in range(8):game.world.advance(.016);await process_frame
	if RenderingServer.get_rendering_device()!=null:
		var directory:String=OS.get_environment("PLANT01_TEST_CAPTURES")
		if directory.is_empty():directory="res://captures" if DirAccess.dir_exists_absolute("res://tests/fixtures") else "/tmp/plant01-electrical-captures-%d"%OS.get_process_id()
		DirAccess.make_dir_recursive_absolute(directory)
		RenderingServer.force_draw(false);root.get_texture().get_image().save_png(directory.path_join(name+".png"))
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1440,900);root.gui_embed_subwindows=true;root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	game=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.camera.current=true;game.camera.fov=38;game.camera.far=650;game._setup_environment()
	game.world=World.new();game.add_child(game.world);game.world.setup();game.world.set_grid(true)
	game.ui=UI.new();game.add_child(game.ui);game.ui.setup();game.ui.set_process(false)
	client=Client.new();game.add_child(client);game.client=client;client.test_directory="/tmp/plant01-electrical-bridge-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message:Dictionary)->void:latest=message;game._snapshot(message))
	client.reply_received.connect(func(message:Dictionary)->void:
		replies[int(message.id)]=message
		if message.get("action")!="shutdown":game._reply(message))
	game.ui.command.connect(game._command);game.ui.tool_selected.connect(game._select_tool);client.start()
	var deadline:int=Time.get_ticks_msec()+10000
	while latest.is_empty() and Time.get_ticks_msec()<deadline:await process_frame
	_check(not latest.is_empty(),"Authenticated service supplies real electrical snapshots")
	if latest.is_empty():client.close();game.queue_free();await process_frame;quit(1);return
	var laying:Dictionary=_fixture("electrical-laying");var complete:Dictionary=_fixture("electrical-complete")
	if laying.is_empty() or complete.is_empty():await _ok("shutdown");client.close();game.queue_free();await process_frame;quit(1);return
	var opening:Dictionary=laying.duplicate(true)
	opening.creative=true;opening.paused=true;opening.electrical={"runs":[],"meterLedger":[]};opening.jobs=[]
	for worker:Dictionary in opening.workers:
		worker.erase("job");worker.erase("vehicle");worker.path=[]
	for machine:Dictionary in opening.equipment:
		machine.erase("job");machine.erase("operator");machine.path=[]
	for reel:Dictionary in opening.stacks:
		if reel.get("item")=="cableReel":reel.cableMeters=50;reel.reserved=0;reel.cableReservedMeters=0
	var no_station:Dictionary=opening.duplicate(true);no_station.buildings.remove_at(0);no_station.utilities.power=false
	await _load(no_station);game.ui.receive_reply({"action":"continue","ok":true})
	Electrical.station_dialog(game.ui);var order_button:Button=_button(game.ui,"Order station service")
	_check(order_button!=null,"Production utility station purchase button exists")
	if order_button:
		order_button.pressed.emit();var reply:Dictionary=await _wait_reply(int(client.counter),"purchase")
		_check(bool(reply.get("ok",false)),"Station button reaches actual authenticated purchase facade")
	var purchased:Dictionary=await _state();var ordered:bool=false
	for order:Dictionary in purchased.orders:
		if order.get("item")=="power":ordered=true
	_check(ordered,"Station button creates a real utility service order")
	await process_frame
	await _load(opening)
	var source_id:String=str(opening.buildings[0].id);var target_id:String=str(opening.buildings[1].id)
	var cells:Array=[]
	for x:int in range(31,36):cells.append({"x":x,"z":30})
	var args:Dictionary={"sourceId":source_id,"targetId":target_id,"cells":cells}
	var before:Dictionary=await _state()
	var bad:Dictionary=await _ok("electrical_preview",{"sourceId":source_id,"targetId":target_id,"cells":[{"x":31,"z":30},{"x":33,"z":30}]})
	_check(not bool(bad.get("valid",true)) and not str(bad.get("error","")).is_empty(),"Real host explains noncontiguous route rejection")
	var after:Dictionary=await _state()
	_check(JSON.stringify(before)==JSON.stringify(after),"Invalid electrical preview is fully read-only")
	var rejected:Dictionary=await _request("electrical_plan",{"sourceId":source_id,"targetId":target_id,"cells":[{"x":31,"z":30},{"x":33,"z":30}]})
	_check(not bool(rejected.get("ok",true)),"Invalid route cannot create a real host job")
	var preview:Dictionary=await _ok("electrical_preview",args)
	_check(bool(preview.get("valid",false)) and int(preview.get("meters",0))==5,"Real preview returns explicit accepted meter cells")
	var plan:Dictionary=await _ok("electrical_plan",args)
	after=await _state()
	_check(not str(plan.get("runId","")).is_empty() and after.electrical.runs[0].status=="commissioned","Explicit creative plan commissions the named physical circuit")
	await _load(laying);await _capture("electrical-trench","Yard")
	var run_id:String=str(laying.electrical.runs[0].id)
	game.ui.show_tab("Electrical");game.ui._refresh_register()
	_check(game.ui.tables.size()==5 and game.ui.tables[3].rows.size()==1,"Live physical installation appears in dense Electrical register")
	await _capture("electrical-register","Electrical")
	await _ok("electrical_cancel",{"id":run_id});await _ok("speed",{"value":10});await _ok("pause",{"paused":false})
	deadline=Time.get_ticks_msec()+12000
	while Time.get_ticks_msec()<deadline:
		await create_timer(.35).timeout
		after=await _state()
		if after.electrical.runs[0].status=="canceled":break
	await _ok("pause",{"paused":true});after=await _state()
	var canceled:Dictionary=after.electrical.runs[0]
	_check(canceled.status=="canceled","Physical laying can safely finish its open cell and cancel")
	var restored:bool=true
	for cell:Dictionary in canceled.cells:
		if float(cell.excavation)>float(cell.backfilled)+.001 or float(cell.get("spoilM3",0))>.001:restored=false
	_check(restored and float(canceled.get("soilInBucketM3",0))<.001 and float(canceled.get("cableInHand",0))<.001,"Safe cancellation restores ground and clears held soil/cable")
	await _ok("save");await _load(after);var reloaded:Dictionary=await _state()
	_check(reloaded.electrical.runs[0].status=="canceled","Atomic import preserves safely canceled physical circuit")
	await _ok("electrical_resume",{"id":run_id});after=await _state()
	_check(after.electrical.runs[0].status in ["planned","working"],"Canceled physical route resumes through actual host command")
	await _load(complete)
	_check(latest.electrical.consumers[0].powered and latest.electrical.junctions.size()==1,"Commissioned physical fixture powers its consumer and exposes a real branch junction")
	game.ui.show_tab("Electrical");game.ui.record_status.select(2);game.ui._refresh_register()
	_check(game.ui.tables[3].rows.size()==1,"Live completed circuit is visible in Done electrical records")
	await _ok("electrical_recover",{"id":str(complete.electrical.runs[0].id)})
	after=await _state()
	_check(bool(after.electrical.runs[0].get("recovering",false)),"Actual recovery schedules physical isolation and removal work")
	await create_timer(.2).timeout
	_check(latest.electrical.consumers[0].powered,"Queued recovery retains supply until engineer physically isolates the source")
	await _ok("speed",{"value":10});await _ok("pause",{"paused":false})
	deadline=Time.get_ticks_msec()+8000
	while Time.get_ticks_msec()<deadline:
		await create_timer(.2).timeout
		if not latest.electrical.consumers[0].powered:break
	await _ok("pause",{"paused":true})
	_check(not latest.electrical.consumers[0].powered,"Engineer physically isolates supply before cable excavation")
	after=await _state()
	_check(after.electrical.runs[0].phase!="complete","Real recovery advances from the previous commissioned phase")
	await _ok("save");await _load(after);reloaded=await _state()
	_check(bool(reloaded.electrical.runs[0].get("recovering",false)),"Atomic reload retains physical recovery mode")
	await _ok("shutdown");client.close();game.queue_free();await process_frame;await process_frame
	print("ELECTRICAL_BRIDGE_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"authenticatedService":true,"isolatedData":true}))
	quit(0 if failures.is_empty() else 1)
