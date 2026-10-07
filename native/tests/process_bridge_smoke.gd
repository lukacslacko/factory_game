extends SceneTree
## Actual native host/UI/render integration. Uses a public fixture and isolated files.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
const W=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false)
var client:Node
var game:Node3D
var ui:CanvasLayer
var replies:Dictionary={}
var latest:Dictionary={}
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
func _ok(action:String,args:Dictionary={})->Variant:
	var reply:Dictionary=await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state()->Dictionary:
	var result:Dictionary=await _ok("export")
	return JSON.parse_string(str(result.get("json","{}")))
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true;root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	game=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.add_child(game.sun)
	game.world=W.new();game.add_child(game.world);game.world.setup()
	game.remove_child(game.sun);game._setup_environment();game._set_lighting(false)
	game.camera.current=true;game.camera.fov=38;game.target=Vector3(49,0,12);game.distance=45;game.pitch=deg_to_rad(48);game.yaw=deg_to_rad(-15);game._update_camera(0,true);game.world.set_grid(false)
	ui=UI.new();root.add_child(ui);ui.setup();game.ui=ui
	client=Client.new();root.add_child(client);client.test_directory="/tmp/plant01-process-bridge-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message:Dictionary)->void:latest=message;game.world.sync_snapshot(message);ui.update_snapshot(message))
	client.reply_received.connect(func(message:Dictionary)->void:replies[int(message.id)]=message;ui.receive_reply(message))
	ui.command.connect(func(action:String,args:Dictionary)->void:client.send(action,args))
	client.start()
	var deadline:int=Time.get_ticks_msec()+10000
	while latest.is_empty() and Time.get_ticks_msec()<deadline:await process_frame
	_check(not latest.is_empty(),"Authenticated native service supplies snapshots")
	if latest.is_empty():client.close();quit(1);return
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/process-fluid-system.json"))
	await _ok("import",{"json":JSON.stringify(fixture.state)})
	var state:Dictionary=await _state();var pump:Dictionary=state.process.pumps[0];var tank:Dictionary=state.process.tanks[0]
	ui.show_tab("Process");ui.show_entity(str(pump.id));await process_frame
	_check(ui.tables.size()==6 and ui.tables[1].rows.size()==1,"Real service fills all dense process registers")
	_check(game.world.statics.has(str(tank.id)) and game.world.models.has("HOSE-"+str(pump.id)),"Actual filled tank and physically connected hose render from service records")
	await _ok("speed",{"value":10});await create_timer(1.3).timeout;await _ok("pause",{"paused":true})
	state=await _state();var moved:float=float(state.process.pumps[0].transferred)-float(pump.transferred)
	_check(moved>40 and moved<100,"Background service moves real liters at requested simulated speed")
	var car:Dictionary=state.orders[0].railFreight.cars[0]
	_check(absf(float(car.tank.liters)+float(state.process.tanks[0].liters)+47.1238898038469-20000)<.0001,"Car, six pipe/fitting volumes and storage tank conserve liquid")
	var valve_id:String=str(state.process.valves[0].id)
	await _ok("process_valve",{"id":valve_id,"open":false});await _ok("speed",{"value":10})
	deadline=Time.get_ticks_msec()+8000
	while Time.get_ticks_msec()<deadline:
		await create_timer(.1).timeout
		state=await _state()
		if not state.process.valves[0].open:break
	await _ok("pause",{"paused":true});state=await _state()
	_check(not state.process.valves[0].open,"Actual worker walks to and closes the real valve")
	await _ok("save");await _ok("import",{"json":JSON.stringify(state)})
	var restored:Dictionary=await _state()
	_check(restored.process.pumps[0].transferred==state.process.pumps[0].transferred and restored.process.tanks[0].liters==state.process.tanks[0].liters,"Atomic reload retains exact accepted transfer and stored contents")
	ui.show_tab("Yard");ui.show_entity(str(tank.id))
	for i in range(12):game.world.advance(.016);await process_frame
	if RenderingServer.get_rendering_device()!=null:
		RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/first-fluid-transfer.png")
	await _ok("shutdown");client.close();game.queue_free();ui.queue_free();await process_frame
	print("PROCESS_BRIDGE_SMOKE ",JSON.stringify({"checks":checks,"passed":failures.is_empty(),"failures":failures,"authenticatedService":true,"isolatedData":true}))
	quit(0 if failures.is_empty() else 1)
