extends SceneTree
## Real review buttons through the authenticated local runtime; never reads a player save.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
var client: Node
var ui: CanvasLayer
var replies: Dictionary = {}
var latest: Dictionary = {}
var snapshots: int = 0
var failures: Array[String] = []
var checks: int = 0
func _initialize() -> void:_run.call_deferred()
func _check(value: bool,label: String) -> void:
	checks+=1
	if not value:failures.append(label)
func _button(node: Node,text: String) -> Button:
	if node is Button and node.text==text:return node
	for child: Node in node.get_children():
		var found: Button = _button(child,text)
		if found:return found
	return null
func _request(action: String,args: Dictionary = {}) -> Dictionary:
	var id: int = client.send(action,args)
	var deadline: int = Time.get_ticks_msec()+5000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timed out: "+action})
func _ok(action: String,args: Dictionary = {}) -> Dictionary:
	var reply: Dictionary = await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _press(node: Node,text: String,action: String) -> Dictionary:
	var button: Button = _button(node,text)
	_check(button!=null and not button.disabled,"Enabled actual UI control: "+text)
	if not button or button.disabled:return {}
	var previous: int = int(client.counter)
	button.pressed.emit()
	var deadline: int = Time.get_ticks_msec()+5000
	while Time.get_ticks_msec()<deadline:
		for id: int in replies:
			if id>previous and replies[id].get("action")==action:
				_check(bool(replies[id].get("ok",false)),"Actual UI dispatch "+action+": "+str(replies[id].get("error","")))
				return replies[id].get("result",{})
		await process_frame
	_check(false,"Timed out waiting for UI dispatch "+action)
	return {}
func _state() -> Dictionary:
	var result: Dictionary = await _ok("export")
	return JSON.parse_string(str(result.get("json","{}")))
func _refresh() -> void:
	await create_timer(.25).timeout
	ui.update_snapshot(latest)
func _finish() -> void:
	await _request("shutdown")
	client.close()
	print("RAIL_EDIT_BRIDGE_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"snapshots":snapshots,"authenticatedService":true,"gpuRendering":false,"dataDir":client.data_directory}))
	ui.queue_free();await process_frame
	quit(0 if failures.is_empty() else 1)
func _run() -> void:
	root.gui_embed_subwindows=true;root.size=Vector2i(1440,866)
	ui=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	client=Client.new();root.add_child(client)
	client.test_directory="/tmp/plant01-rail-edit-bridge-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message: Dictionary) -> void:snapshots+=1;latest=message;ui.update_snapshot(message))
	client.reply_received.connect(func(message: Dictionary) -> void:replies[int(message.id)]=message;ui.receive_reply(message))
	ui.command.connect(func(action: String,args: Dictionary) -> void:client.send(action,args))
	client.start()
	var deadline: int = Time.get_ticks_msec()+15000
	while snapshots==0 and Time.get_ticks_msec()<deadline:await process_frame
	_check(snapshots>0,"Native UI receives an authenticated snapshot from the real service")
	if snapshots==0:await _finish();return
	await _ok("new_game",{"mode":"empty"})
	await _ok("pause",{"paused":true})
	await _ok("creative",{"enabled":true})
	await _ok("zone",{"rect":{"x":35,"z":30,"w":20,"d":20},"name":"Rail editing test stockyard"})
	await _ok("plan_rail",{"layout":"straight","x":125,"z":5,"heading":0,"hand":1,"snap":true})
	var state: Dictionary = await _state()
	_check(state.rails.size()==1,"Real Creative rail placement creates one installed panel")
	if state.rails.is_empty():await _finish();return
	var rail_id: String = str(state.rails[0].id)
	var stop_id: String = str(state.buffers[0].id)
	await _refresh();ui.show_tab("Railway");ui.show_entity(rail_id)
	var before: String = str((await _ok("export")).get("json",""))
	var preview: Dictionary = await _press(ui.inspector_body,"Review this panel recovery…","rail_edit_preview")
	_check(preview.get("constraint","")=="" and preview.get("mode")=="creative","Actual read-only preview reaches the native review window with the correct edit mode")
	_check(preview.get("destinations",[]).size()==2,"Real preview accounts for the installed panel and its attached stop")
	var after: String = str((await _ok("export")).get("json",""))
	_check(before==after,"Opening the real UI preview preserves the entire authoritative game state")
	await _press(ui.rail_edit_window,"Recover instantly","remove_rail")
	state=await _state()
	_check(state.rails.is_empty() and state.buffers.is_empty(),"Submitting the real review immediately recovers installed assets in Creative")
	var rail_preserved: bool = false
	var stop_preserved: bool = false
	for stock: Dictionary in state.stacks:
		if stock.get("item")=="rail" and rail_id in stock.get("railAssetIds",[]):rail_preserved=true
		if stock.get("item")=="bufferStop" and stock.get("assetId")==stop_id:stop_preserved=true
	_check(rail_preserved and stop_preserved,"Recovered rail and stop identities both survive in physical inventory")
	await _refresh()
	var endpoint_id: String = ""
	for endpoint: Dictionary in latest.get("render",{}).get("railOpenEndpoints",[]):
		if is_equal_approx(float(endpoint.x),125) and is_equal_approx(float(endpoint.z),5):endpoint_id=str(endpoint.id)
	_check(not endpoint_id.is_empty(),"Recovery exposes the real original siding endpoint in the native snapshot")
	if endpoint_id.is_empty():await _finish();return
	ui.show_entity(endpoint_id)
	preview=await _press(ui.inspector_body,"Review buffer installation…","rail_edit_preview")
	_check(preview.get("constraint","")=="" and int(preview.get("availableStops",0))==1,"Endpoint review recognizes the actual recovered stop in stock")
	await _press(ui.rail_edit_window,"Install instantly","plan_buffer")
	state=await _state()
	_check(state.buffers.size()==1 and str(state.buffers[0].id)==stop_id,"Creative reinstall reuses the stored stop identity through the actual UI and runtime")
	await _refresh();ui._purchase_buffer_form()
	await _press(ui.screen,"Order buffer stops","purchase_batch")
	state=await _state()
	_check(state.orders.size()==1 and state.orders[0].get("item")=="bufferStop" and int(state.orders[0].get("qty",0))==1,"Focused purchase UI orders one real buffer asset rather than bypassing delivery")
	await _refresh();ui.show_tab("Railway")
	_check(ui.tables[6].rows.size()==1,"Actual outstanding buffer delivery appears in the unified Railway stock/orders register")
	await _ok("save")
	_check(FileAccess.file_exists(client.data_directory.path_join("yard.json")),"Bridge persistence stays inside its isolated test directory")
	await _finish()
