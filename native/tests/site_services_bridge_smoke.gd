extends SceneTree
## Actual authenticated host, production UI, renderer, lighting and audio; isolated files.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
const World=preload("res://scripts/game_world.gd")
const Audio=preload("res://scripts/game_audio.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
var client: Node
var game: Node3D
var replies: Dictionary={}
var latest: Dictionary={}
var checks: int=0
var failures: Array[String]=[]
func _initialize()->void:_run.call_deferred()
func _check(value: bool,label: String)->void:
	checks+=1
	if not value:failures.append(label)
func _request(action: String,args: Dictionary={})->Dictionary:
	var id: int=client.send(action,args);var deadline: int=Time.get_ticks_msec()+5000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timeout: "+action})
func _ok(action: String,args: Dictionary={})->Variant:
	var reply: Dictionary=await _request(action,args)
	if not bool(reply.get("ok",false)):print("BRIDGE_ACTION_FAILED ",action," ",reply.get("error",""))
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state()->Dictionary:
	var result: Dictionary=await _ok("export")
	return JSON.parse_string(str(result.get("json","{}")))
func _fuel(s: Dictionary)->float:
	var total: float=0
	for e: Dictionary in s.get("equipment",[]):total+=float(e.get("fuel",0))+float(e.get("used",0))
	for t: Dictionary in s.get("stacks",[]):
		if t.get("item")=="diesel":total+=float(t.get("liters",0))
	for j: Dictionary in s.get("jobs",[]):total+=float(j.get("fuelLiters",0))
	return total
func _capture(name: String,point: Vector3,zoom: float,angle: float=-.3)->void:
	game.target=point;game.distance=zoom;game.yaw=angle;game.pitch=deg_to_rad(42);game._update_camera(0,true)
	for frame: int in range(12):game.world.advance(.016);await process_frame
	if RenderingServer.get_rendering_device()!=null:
		RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/"+name+".png")
func _run()->void:
	Engine.max_fps=60;root.size=Vector2i(1440,900);root.gui_embed_subwindows=true;root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	game=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.camera.far=650;game.camera.current=true;game.camera.fov=38;game._setup_environment()
	game.world=World.new();game.add_child(game.world);game.world.setup();game.world.set_grid(false)
	game.ui=UI.new();game.add_child(game.ui);game.ui.setup();game.ui.set_process(false)
	client=Client.new();game.add_child(client);game.client=client;client.test_directory="/tmp/plant01-services-bridge-%d"%OS.get_process_id()
	game.audio=Audio.new();game.add_child(game.audio);game.audio.setup(client.test_directory)
	client.snapshot_received.connect(func(message: Dictionary)->void:latest=message;game._snapshot(message))
	client.reply_received.connect(func(message: Dictionary)->void:replies[int(message.id)]=message;game.ui.receive_reply(message))
	game.ui.command.connect(game._command);client.start()
	var deadline: int=Time.get_ticks_msec()+10000
	while latest.is_empty() and Time.get_ticks_msec()<deadline:await process_frame
	_check(not latest.is_empty(),"Authenticated service supplies actual snapshots")
	if latest.is_empty():client.close();quit(1);return
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/refuel-pouring.save.json"))
	game.audio.reset_history();await _ok("import",{"json":JSON.stringify(fixture)})
	await create_timer(.3).timeout
	var s: Dictionary=await _state();var e: Dictionary=s.equipment[0];var j: Dictionary=s.jobs[0]
	game.ui.receive_reply({"action":"continue","ok":true});game.ui.show_entity(str(e.id))
	game.world.advance(.3)
	_check(game.world.models.has(str(j.worker)) and game.world.models[str(j.worker)].has_node("FuelHandling"),"Real imported fuel worker has a held native service can")
	_check(game.audio.get_status().played.is_empty(),"Loading the yard does not replay historical sound cues")
	var w: Dictionary={}
	for worker: Dictionary in s.workers:
		if str(worker.id)==str(j.worker):w=worker
	await _capture("site-services-fuel",Vector3(float(w.x),0,float(w.z)),12,atan2(float(w.x)-float(e.x),float(w.z)-float(e.z)))
	var balance: float=_fuel(s);var old_fuel: float=float(e.fuel)
	await _ok("speed",{"value":10});await create_timer(.5).timeout;await _ok("pause",{"paused":true});s=await _state()
	_check(float(s.equipment[0].fuel)>old_fuel,"Actual worker pours fuel while host advances")
	_check(absf(_fuel(s)-balance)<.00001,"Live host conserves drum, can, tank and burned diesel")
	var bad_quote: Dictionary=await _ok("collection_quote",{"lines":[{"stackId":s.stacks[0].id,"qty":1}]})
	_check(not bool(bad_quote.get("valid",true)) and str(bad_quote.get("error","")).contains("fuel"),"The quote explains why a fuel-bearing drum cannot be collected")
	var rejected: Dictionary=await _request("collection_request",{"lines":[{"stackId":"STK-MISSING","qty":1}]})
	_check(not bool(rejected.get("ok",true)),"Stale collection selection is a host error instead of false success")
	fixture=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/collection-secure.save.json"))
	fixture.time=86400;game.audio.reset_history();await _ok("import",{"json":JSON.stringify(fixture)});await create_timer(.3).timeout
	s=await _state();var c: Dictionary=s.collections[0]
	game.ui.show_tab("Deliveries");game.ui.show_entity(str(c.id))
	_check(game.ui.tables.size()==3 and game.ui.tables[2].rows.size()==1,"Actual collection appears in its own native register")
	_check(game.moon.visible and not game.sun.visible,"Actual imported midnight clock selects full-moon lighting")
	await _ok("collection_pause",{"id":c.id});s=await _state();_check(s.collections[0].status=="paused","A stationary physical collection can be paused")
	await _ok("save");await _ok("import",{"json":JSON.stringify(s)});s=await _state()
	_check(s.collections[0].status=="paused" and s.collections[0].task.phase==c.task.phase,"Atomic reload preserves paused supported collection phase")
	await _ok("collection_resume",{"id":c.id});game.state.time=9*3600;game._update_lighting(0,true)
	game.ui.show_tab("Yard");game.ui.show_entity(str(c.id));await _capture("site-services-collection",Vector3(21,0,21),34)
	await _ok("collection_cancel",{"id":c.id});s=await _state()
	_check(bool(s.collections[0].get("cancelRequested",false)) or s.collections[0].status=="canceled","Cancellation retains and safely resolves the actual physical collection")
	await _ok("shutdown");client.close();game.queue_free();await process_frame
	print("SITE_SERVICES_BRIDGE_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"authenticatedService":true,"isolatedData":true}))
	quit(0 if failures.is_empty() else 1)
