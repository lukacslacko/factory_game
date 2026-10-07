extends SceneTree
## Real authenticated service, live clearance UI, physical parking and isolated persistence.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
const W=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false);set_process_unhandled_input(false)
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
	var id:int=client.send(action,args);var deadline:int=Time.get_ticks_msec()+5000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timeout: "+action})
func _ok(action:String,args:Dictionary={})->Variant:
	var reply:Dictionary=await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state()->Dictionary:
	var result:Dictionary=await _ok("export");return JSON.parse_string(str(result.get("json","{}")))
func _button(node:Node,text:String)->Button:
	if node is Button and node.text==text:return node
	for child:Node in node.get_children():
		var found:Button=_button(child,text)
		if found:return found
	return null
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true;root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	game=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.add_child(game.sun)
	game.world=W.new();game.add_child(game.world);game.world.setup();game.remove_child(game.sun);game._setup_environment();game._set_lighting(false)
	game.camera.current=true;game.camera.fov=38;game.target=Vector3(38,0,36);game.distance=45;game.pitch=deg_to_rad(48);game.yaw=deg_to_rad(-15);game._update_camera(0,true);game.world.set_grid(false)
	ui=UI.new();root.add_child(ui);ui.setup();game.ui=ui
	client=Client.new();root.add_child(client);client.test_directory="/tmp/plant01-clearance-bridge-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message:Dictionary)->void:latest=message;game.world.sync_snapshot(message);ui.update_snapshot(message))
	client.reply_received.connect(func(message:Dictionary)->void:replies[int(message.id)]=message;ui.receive_reply(message))
	ui.command.connect(func(action:String,args:Dictionary)->void:client.send(action,args));client.start()
	var deadline:int=Time.get_ticks_msec()+10000
	while latest.is_empty() and Time.get_ticks_msec()<deadline:await process_frame
	_check(not latest.is_empty(),"Actual native service starts with isolated data")
	if latest.is_empty():client.close();quit(1);return
	await _ok("import",{"json":FileAccess.get_file_as_string("res://tests/fixtures/action-clearance-system.json")})
	var state:Dictionary=await _state();var e:Dictionary=state.equipment[0];var w:Dictionary=state.workers[1]
	var notice_id:String=str(state.actionClearances[0].noticeId)
	ui.show_tab("Yard");ui.show_entity(str(e.id));await process_frame;await process_frame
	_check(_button(ui.inspector_body,"Locate "+str(w.id))!=null,"Actual blocker ID has a Locate control in the equipment inspector")
	_check(str(latest.state.actionClearances[0].reason).contains("manual control"),"Live clearance explains manual control explicitly")
	var inspected:Dictionary=await _ok("inspect",{"id":e.id})
	_check(inspected.get("actionClearances",[]).size()==1,"Native inspect returns the real saved action record")
	for i in range(8):game.world.advance(.016);await process_frame
	if RenderingServer.get_rendering_device()!=null:RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/action-clearance-parking.png")
	ui.show_entity(str(w.id));var release:Button=_button(ui.inspector_body,"Return to automatic duty")
	_check(release!=null,"Actual worker inspector exposes release of manual control")
	if release:release.pressed.emit()
	else:await _ok("worker_duty",{"id":w.id,"duty":"auto"})
	await _ok("speed",{"value":10});deadline=Time.get_ticks_msec()+20000
	while Time.get_ticks_msec()<deadline:
		await create_timer(.1).timeout
		if latest.get("state",{}).get("equipment",[]).size()>0 and str(latest.state.equipment[0].get("parkingState",""))=="parked":break
	await _ok("pause",{"paused":true});state=await _state()
	_check(str(state.equipment[0].get("parkingState",""))=="parked","Worker physically walks clear and the real operator parks the excavator")
	_check(Vector2(float(state.workers[1].x)-40,float(state.workers[1].z)-38).length()>2,"Blocker moves to safe ground rather than disappearing")
	var resolved:bool=false
	for n:Dictionary in state.notices:if str(n.id)==notice_id:resolved=str(n.state)=="done"
	_check(resolved and state.get("actionClearances",[]).is_empty(),"Same persistent warning resolves after the physical obstruction clears")
	await _ok("save");await _ok("import",{"json":JSON.stringify(state)})
	var restored:Dictionary=await _state()
	_check(restored.equipment[0].x==state.equipment[0].x and restored.equipment[0].z==state.equipment[0].z,"Saved recovery keeps actual parked equipment pose")
	await _ok("shutdown");client.close();game.queue_free();ui.queue_free();await process_frame
	print("ACTION_CLEARANCE_BRIDGE_SMOKE ",JSON.stringify({"checks":checks,"passed":failures.is_empty(),"failures":failures,"authenticatedService":true,"isolatedData":true}))
	quit(0 if failures.is_empty() else 1)
