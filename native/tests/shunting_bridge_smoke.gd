extends SceneTree
## Real authenticated native client + service dispatch, isolated saves, actual UI snapshots.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
var client: Node
var ui: CanvasLayer
var replies: Dictionary = {}
var snapshots: int = 0
var latest: Dictionary = {}
var failures: Array[String] = []
var checks: int = 0
func _initialize() -> void:_run.call_deferred()
func _check(value: bool,label: String) -> void:
	checks+=1
	if not value:failures.append(label)
func _request(action: String,args: Dictionary = {}) -> Dictionary:
	var id: int = client.send(action,args)
	var deadline: int = Time.get_ticks_msec()+5000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timed out: "+action})
func _ok(action: String,args: Dictionary = {}) -> Dictionary:
	var reply: Dictionary = await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state() -> Dictionary:
	var result: Dictionary = await _ok("export")
	return JSON.parse_string(str(result.get("json","{}")))
func _refresh() -> void:
	await create_timer(0.25).timeout
	ui.update_snapshot(latest)
func _finish() -> void:
	await _request("shutdown")
	client.close()
	print("SHUNTING_BRIDGE_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"snapshots":snapshots,"authenticatedService":true,"gpuRendering":false,"dataDir":client.data_directory}))
	quit(0 if failures.is_empty() else 1)
func _run() -> void:
	root.gui_embed_subwindows=true;root.size=Vector2i(1440,810)
	ui=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	client=Client.new();root.add_child(client)
	# Never use the player's directory, even if this script is invoked without arguments.
	client.test_directory="/tmp/plant01-shunting-bridge-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message: Dictionary) -> void:snapshots+=1;latest=message;ui.update_snapshot(message))
	client.reply_received.connect(func(message: Dictionary) -> void:replies[int(message.id)]=message;ui.receive_reply(message))
	client.start()
	var deadline: int = Time.get_ticks_msec()+15000
	while snapshots==0 and Time.get_ticks_msec()<deadline:await process_frame
	_check(snapshots>0,"The native client authenticates and receives the real service snapshot")
	if snapshots==0:await _finish();return
	await _ok("new_game",{"mode":"empty"})
	await _ok("pause",{"paused":true})
	await _ok("creative",{"enabled":true})
	await _ok("rail_access_plan",{"x":80})
	await _ok("rail_exit_plan")
	await _refresh()
	ui.show_tab("Railway")
	_check(ui.tables[1].rows.size()>0,"Completed access and exit panels appear in the actual native Railway register")
	await _ok("save_rail_location",{"location":{"name":"West reception","kind":"unloading","trackId":"BOOTSTRAP-SIDING","route":"straight","offset":30,"length":40}})
	await _ok("purchase_batch",{"lines":[{"item":"slab","qty":4}],"mode":"rail"})
	var fixture: Dictionary = await _state()
	if fixture.get("orders",[]).is_empty():failures.append("Service failed to create freight order");await _finish();return
	var order: Dictionary = fixture.orders[0]
	var order_id: String = str(order.id)
	var car_id: String = str(order.railFreight.cars[0].id)
	var reply: Dictionary = await _request("rail_detach",{"orderId":order_id})
	_check(not bool(reply.get("ok",true)) and str(reply.get("error","")).contains("stopped"),"Dispatch rejects uncoupling a supplier train that has not arrived")
	# Import a focused arrived checkpoint; all order/cargo/rail fields come from real commands.
	order.status="unloading";order.note="Stopped at reception";order.vehicle={"x":73.4,"z":5};order.erase("drive")
	order.railFreight.receptionLocationId=fixture.railLocations[0].id
	fixture.workers=[{"id":"WRK-9991","name":"Worker #1","role":"operator","duty":"auto","status":"Available","hours":0,"wage":36,"x":108,"z":8,"y":0,"heading":0,"yaw":0,"path":[]}]
	await _ok("import",{"json":JSON.stringify(fixture)})
	await _ok("rail_detach",{"orderId":order_id})
	fixture=await _state();order=fixture.orders[0]
	_check(order.railFreight.detached and order.railFreight.locomotivePhase=="uncoupling","Authentic detach dispatch freezes the cars and starts physical engine departure")
	await _refresh();ui.show_entity(order_id)
	_check(ui.inspector.visible,"The stopped detached delivery is visible through the live native snapshot")
	# Advance the focused checkpoint to an engine-free siding, keeping real frozen car poses.
	order.railFreight.locomotivePhase="gone";order.railFreight.erase("movement")
	await _ok("import",{"json":JSON.stringify(fixture)})
	var ordered: Dictionary = await _ok("shunter_order",{"driverId":"WRK-9991"})
	_check(str(ordered.get("id","")).begins_with("SHUNTER-"),"Ordering through the bridge creates an owned shunter identity")
	fixture=await _state()
	if fixture.get("shunters",[]).is_empty():failures.append("Shunter not present in service state");await _finish();return
	var shunter: Dictionary = fixture.shunters[0]
	var shunter_id: String = str(shunter.id)
	_check(shunter.phase=="ordered" and shunter.driverId=="WRK-9991","Owned shunter remains a pending real delivery with its assigned driver")
	await _refresh();ui.show_tab("Railway")
	_check(ui.tables[5].rows.size()==1,"New owned shunter is delivered to the native UI snapshot")
	ui.show_entity(shunter_id)
	_check(ui.inspector.visible,"New owned shunter can be opened by its actual ID")
	await _ok("shunter_driver",{"shunterId":shunter_id,"workerId":"WRK-9991"})
	reply=await _request("rail_return",{"orderIds":[order_id]})
	_check(not bool(reply.get("ok",true)) and str(reply.get("error","")).contains("Unload"),"Supplier collection dispatch refuses loaded freight")
	# Delivered checkpoint tests transfer dispatch independently of real-time travel duration.
	fixture=await _state();shunter=fixture.shunters[0]
	shunter.phase="parked";shunter.status="Delivered";shunter.x=115;shunter.z=5;shunter.yaw=0
	shunter.anchor={"trackId":"BOOTSTRAP-SIDING","route":"straight","offset":90}
	await _ok("import",{"json":JSON.stringify(fixture)})
	var yard: Dictionary = await _ok("zone",{"rect":{"x":24,"z":26,"w":12,"d":12},"name":"Freight test stockyard"})
	await _ok("configure_rail_freight",{"orderId":order_id,"storageZoneId":yard.zone.id,"railLocationId":fixture.railLocations[0].id})
	await _ok("begin_rail_unloading",{"orderId":order_id,"carIds":[car_id]})
	var unloading: Dictionary = await _state()
	_check(unloading.orders[0].railFreight.unloadRequested and unloading.orders[0].railFreight.unloadCarIds==[car_id],"Real unloading dispatch retains the explicit selected car and stockyard")
	await _ok("pause_rail_unloading",{"orderId":order_id})
	await _ok("rail_shunt",{"orderId":order_id,"carIds":[car_id],"shunterId":shunter_id,"railLocationId":fixture.railLocations[0].id})
	fixture=await _state()
	_check(fixture.shunters[0].phase=="boarding" and fixture.shunters[0].carIds==[car_id],"Shunt dispatch records selected cars and begins driver boarding, rather than teleporting cargo")
	await _refresh();ui.show_entity(shunter_id)
	_check(ui.inspector.visible and ui.state.shunters[0].has("movement"),"The actual route and shunter phase reach native UI state")
	reply=await _request("shunter_park",{"shunterId":shunter_id,"railLocationId":fixture.railLocations[0].id})
	_check(not bool(reply.get("ok",true)) and str(reply.get("error","")).contains("idle"),"Parking dispatch rejects a shunter reserved for a freight movement")
	reply=await _request("shunter_refuel",{"shunterId":shunter_id})
	_check(not bool(reply.get("ok",true)) and str(reply.get("error","")).contains("Stop"),"Refueling dispatch cannot change fuel during a shunting movement")
	# A separate completed-unloading checkpoint exercises the real empty collection dispatch.
	fixture=await _state();order=fixture.orders[0];shunter=fixture.shunters[0]
	order.arrived=order.qty;order.manifest[0].arrived=order.manifest[0].qty
	for car: Dictionary in order.railFreight.cars:
		for line: Dictionary in car.manifest:line.arrived=line.qty
	shunter.phase="ordered";shunter.status="Delivery pending";shunter.x=350;shunter.z=0;shunter.eta=fixture.time+10000
	for key: String in ["anchor","movement","haul","carIds","orderId","direction","driverPhase"]:shunter.erase(key)
	await _ok("import",{"json":JSON.stringify(fixture)})
	var returned: Dictionary = await _ok("rail_return",{"orderIds":[order_id]})
	_check(str(returned.get("id","")).begins_with("RETURN-"),"Empty collection dispatch creates a physical outgoing train identity")
	await _refresh();ui.show_tab("Deliveries")
	_check(ui.tables[1].rows.size()==1,"An outgoing collection appears in the real native Deliveries snapshot")
	if not str(returned.get("id","")).is_empty():ui.show_entity(str(returned.id))
	_check(ui.inspector.visible,"The outgoing train is navigable in the native information panel")
	await _ok("save")
	_check(FileAccess.file_exists(client.data_directory.path_join("yard.json")),"The authenticated bridge saves only into its isolated test directory")
	await _finish()
