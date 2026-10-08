extends SceneTree
## Authenticated physical stock movement through production UI, host and renderer.
## Synthetic assets and a fresh /tmp directory never use the player's live save.
const Client=preload("res://scripts/runtime_client.gd")
const UI=preload("res://scripts/game_ui.gd")
const World=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:set_process(false);set_process_input(false);set_process_unhandled_input(false)
var game: Node3D
var client: Node
var replies: Dictionary={}
var latest: Dictionary={}
var checks: int=0
var failures: Array[String]=[]
var snapshots: int=0
var started_at: int=0

func _initialize()->void:_run.call_deferred()
func _check(value: bool,label: String)->void:
	checks+=1
	if not value:failures.append(label)
func _wait_reply(id: int,action: String)->Dictionary:
	var deadline: int=Time.get_ticks_msec()+10000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:await process_frame
	return replies.get(id,{"ok":false,"error":"Timeout: "+action})
func _request(action: String,args: Dictionary={})->Dictionary:return await _wait_reply(client.send(action,args),action)
func _ok(action: String,args: Dictionary={})->Dictionary:
	var reply: Dictionary=await _request(action,args)
	_check(bool(reply.get("ok",false)),action+": "+str(reply.get("error","")))
	return reply.get("result",{})
func _state(check_reply: bool=true)->Dictionary:
	var reply: Dictionary=await _request("export")
	if check_reply:_check(bool(reply.get("ok",false)),"Export authoritative physical state")
	return JSON.parse_string(str(reply.get("result",{}).get("json","{}")))
func _record(state: Dictionary,key: String,id: String)->Dictionary:
	for record: Dictionary in state.get(key,[]):
		if str(record.get("id",""))==id:return record
	return {}
func _button(node: Node,text: String)->Button:
	if node is Button and node.text==text:return node
	for child: Node in node.get_children():
		var found: Button=_button(child,text)
		if found:return found
	return null
func _press(node: Node,text: String)->Dictionary:
	var button: Button=_button(node,text)
	_check(button!=null and not button.disabled,"Enabled production control exists: "+text)
	if button==null or button.disabled:return {"error":"Disabled control"}
	button.pressed.emit()
	var reply: Dictionary=await _wait_reply(client.counter,text)
	_check(bool(reply.get("ok",false)),"Production control reaches authenticated host: "+text)
	return reply.get("result",{})
func _choose(option: OptionButton,id: String)->void:
	for index: int in option.item_count:
		if str(option.get_item_metadata(index))==id:option.select(index);option.item_selected.emit(index);return
func _load(state: Dictionary)->void:
	await _ok("import",{"json":JSON.stringify(state)})
	await create_timer(.25).timeout
func _capture(name: String)->void:
	if RenderingServer.get_rendering_device()==null:return
	game.target=Vector3(38,0,43);game.distance=38;game.yaw=-.35;game.pitch=deg_to_rad(43);game._update_camera(0,true)
	for frame: int in range(8):game.world.advance(.016);await process_frame
	var directory: String=OS.get_environment("PLANT01_TEST_CAPTURES")
	if directory.is_empty():directory="/tmp/plant01-storage-move-captures-%d"%OS.get_process_id()
	DirAccess.make_dir_recursive_absolute(directory)
	RenderingServer.force_draw(false)
	_check(root.get_texture().get_image().save_png(directory.path_join(name+".png"))==OK,"Synthetic visual capture saved: "+name)
func _fixture(base: Dictionary,item: String,kind: String)->Dictionary:
	var state: Dictionary=base.duplicate(true)
	state.paused=true;state.speed=10;state.creative=true;state.time=9*3600;state.elapsed=0;state.next=9000
	state.zones=[{"id":"ZONE-8101","name":"Electrical stores","x":52,"z":36,"w":20,"d":20},{"id":"ZONE-8102","name":"East stockyard","x":82,"z":36,"w":20,"d":20}]
	state.workers=[{"id":"WRK-8101","name":"Worker #1","role":"operator","duty":"auto","status":"Available","hours":0,"wage":36,"x":24.5,"z":42.5,"y":0,"heading":0,"yaw":0,"path":[]},{"id":"WRK-8102","name":"Worker #2","role":"builder","duty":"auto","status":"Available","hours":0,"wage":28,"x":28.5,"z":49.5,"y":0,"heading":0,"yaw":0,"path":[]}]
	state.equipment=[{"id":"EQ-8101","kind":kind,"x":25.5,"z":45.5,"y":0,"heading":0,"yaw":0,"path":[],"fuel":45 if kind=="forklift" else 80,"tank":45 if kind=="forklift" else 80,"used":0,"work":0}]
	var stock: Dictionary={"id":"STK-8101","item":item,"qty":1,"reserved":0,"x":35,"z":45,"w":1,"d":1,"source":"opening"}
	if item=="cableReel":stock.cableMeters=18.75
	else:stock.liters=72.5
	state.stacks=[stock]
	return state
func _open_move()->Dictionary:
	game.ui.show_tab("Yard");game.ui.show_entity("STK-8101")
	return await _press(game.ui.inspector_body,"Move to storage…")
func _wait_job(job_id: String,carried: bool)->Dictionary:
	var deadline: int=Time.get_ticks_msec()+45000
	var state: Dictionary={}
	while Time.get_ticks_msec()<deadline:
		await create_timer(.15).timeout
		state=await _state(false)
		var job: Dictionary=_record(state,"jobs",job_id)
		var machine: Dictionary=_record(state,"equipment","EQ-8101")
		if carried and machine.has("cargo") or not carried and job.get("status")=="done":return state
	_check(false,"Physical move reached "+("supported carried phase" if carried else "completion"))
	print("STORAGE_MOVE_TIMEOUT ",JSON.stringify({"jobs":state.get("jobs",[]),"equipment":state.get("equipment",[]),"workers":state.get("workers",[])}))
	return state
func _complete_partial(base: Dictionary,item: String,kind: String,exercise_cancel: bool)->void:
	await _load(_fixture(base,item,kind))
	var before: Dictionary=await _state()
	var preview: Dictionary=await _open_move()
	_check(str(preview.get("error","" )).is_empty() and preview.get("zoneId")=="ZONE-8101","Automatic preview selects nearest accessible named storage: "+item)
	var expected_mass: float=35+3*18.75 if item=="cableReel" else 20+.825*72.5
	_check(absf(float(preview.get("mass",0))-expected_mass)<.000001,"Host quotes exact partly used contents mass: "+item)
	_check(preview.get("requestId")==game.ui.storage_move_ui.preview_request and not game.ui.storage_move_ui.submit_button.disabled,"Actual reply correlation enables correct dialog: "+item)
	var state: Dictionary=await _state()
	_check(JSON.stringify(before)==JSON.stringify(state),"Authoritative preview is read-only: "+item)
	var mover=game.ui.storage_move_ui
	_choose(mover.zone_choice,"ZONE-8102")
	var choice_reply: Dictionary=await _wait_reply(client.counter,"storage_move_preview")
	_check(choice_reply.get("ok",false) and choice_reply.get("result",{}).get("zoneId")=="ZONE-8102","Selecting a named destination changes actual authoritative allocation: "+item)
	_check(mover.preview_note.text.contains("East stockyard"),"Actual host response displays chosen stockyard name: "+item)
	await _capture("storage-move-"+item+"-dialog")
	var plan: Dictionary=await _press(mover.window,"Create move work")
	if not str(plan.get("error","")).is_empty():_check(false,str(plan));return
	var job_id: String=str(plan.get("job",{}).get("id",""));var group_id: String=str(plan.get("groupId",""))
	state=await _state()
	_check(not job_id.is_empty() and game.ui.active_tab=="Work" and game.ui.selected_id==group_id,"Created move opens linked native whole-work inspector: "+item)
	var stack: Dictionary=_record(state,"stacks","STK-8101")
	_check(stack.get("x")==35 and stack.get("z")==45 and stack.get("reserved")==1 and _record(state,"jobs",job_id).get("status")=="todo","Creative still creates physical queued handling without teleporting stock: "+item)
	var blocked: Dictionary=await _ok("storage_move_preview",{"id":"STK-8101","requestId":"blocked-reservation"})
	_check(str(blocked.get("error","")).contains("reserved") and blocked.get("requestId")=="blocked-reservation","Active movement reserves material and returns correlated actionable refusal: "+item)
	await _ok("save");await _ok("load");state=await _state()
	_check(_record(state,"jobs",job_id).get("parentId")==group_id and _record(state,"stacks","STK-8101").get("reserved")==1,"Atomic disk save/load retains queued group and exact source reservation: "+item)
	if exercise_cancel:
		await _ok("cancel_job",{"id":job_id});state=await _state()
		_check(_record(state,"jobs",job_id).get("status")=="canceled" and _record(state,"stacks","STK-8101").get("reserved")==0,"Cancel queued physical move releases stock without removing it")
		_check(_record(state,"stacks","STK-8101").get("cableMeters")==18.75,"Cancel retains exact partly used reel contents")
		preview=await _open_move()
		_check(str(preview.get("error","")).is_empty(),"Canceled material is immediately eligible for a new move")
		plan=await _press(mover.window,"Create move work")
		job_id=str(plan.get("job",{}).get("id",""));group_id=str(plan.get("groupId",""))
		state=await _state()
	await create_timer(.25).timeout
	game.ui.show_entity(group_id)
	var options: Array[Node]=game.ui.inspector_body.find_children("*","OptionButton",true,false)
	_check(not options.is_empty(),"Whole move group offers manual equipment assignment: "+item)
	if not options.is_empty():
		_choose(options[0],"EQ-8101")
		await _press(game.ui.inspector_body,"Apply equipment to this whole work")
	state=await _state()
	_check(_record(state,"jobGroups",group_id).get("preferredEquipment")=="EQ-8101" and _record(state,"jobs",job_id).get("parentId")==group_id,"Production group assignment is inherited by physical child work: "+item)
	await _ok("pause",{"paused":false})
	state=await _wait_job(job_id,true)
	await _ok("pause",{"paused":true});state=await _state()
	var job: Dictionary=_record(state,"jobs",job_id);var machine: Dictionary=_record(state,"equipment","EQ-8101")
	var key: String="cableMeters" if item=="cableReel" else "liters";var contents: float=18.75 if item=="cableReel" else 72.5
	_check(machine.get("cargo",{}).get("item")==item and float(job.get("stockMove",{}).get("load",{}).get(key,0))==contents,"Actual owned machine physically supports exact remaining contents: "+item)
	_check(_record(state,"workers",str(machine.get("operator",""))).get("vehicle")=="EQ-8101","Real qualified operator is boarded during handling: "+item)
	await create_timer(.25).timeout
	_check(game.world.models.has(job_id+"/handling"),"Native renderer receives an attached supported load: "+item)
	game.ui.show_entity(job_id)
	_check(game.ui.inspector.visible,"Carried move remains inspectable through original work ID: "+item)
	await _capture("storage-move-"+item+"-carried")
	var saved_move: String=JSON.stringify(job.get("stockMove",{}))
	await _ok("save");await _ok("load");state=await _state()
	_check(JSON.stringify(_record(state,"jobs",job_id).get("stockMove",{}))==saved_move and _record(state,"equipment","EQ-8101").get("cargo",{}).get("item")==item,"Atomic disk reload preserves supported partial load and destination: "+item)
	await _ok("pause",{"paused":false});state=await _wait_job(job_id,false)
	await _ok("pause",{"paused":true});state=await _state()
	stack=_record(state,"stacks","STK-8101")
	var zone_id: String=str(_record(state,"jobs",job_id).get("stockMove",{}).get("zoneId",""))
	var zone: Dictionary=_record(state,"zones",zone_id)
	_check(not stack.is_empty() and stack.get("qty")==1 and stack.get("reserved")==0 and float(stack.get(key,0))==contents,"Finished physical move preserves drum/reel identity and exact remaining contents: "+item)
	_check(float(stack.get("x",0))>=float(zone.get("x",INF)) and float(stack.get("z",0))>=float(zone.get("z",INF)) and float(stack.get("x",0))+1<=float(zone.get("x",0))+float(zone.get("w",0)) and float(stack.get("z",0))+1<=float(zone.get("z",0))+float(zone.get("d",0)),"Moved material is inside its actual selected finite stockyard: "+item)
	_check(state.get("orders",[]).is_empty() and state.get("equipment",[]).size()==1,"Handling uses owned assets without purchases or magically supplied equipment: "+item)
	await _capture("storage-move-"+item+"-stored")
func _verify_merged_render()->void:
	# Renderer-only supported-placement contract: the seven-unit destination
	# contains five old layers plus two currently shown by the handling model.
	var merged: Dictionary=latest.duplicate(true)
	merged.state.stacks=[{"id":"STK-8201","item":"slab","qty":7,"reserved":0,"x":52,"z":45,"w":1,"d":1}]
	merged.render.construction=[{"jobId":"JOB-8201","item":"slab","qty":2,"state":"placed","placedStack":"STK-8201","pose":{"x":52.5,"z":45.5,"y":.96,"yaw":0}}]
	game.world.sync_snapshot(merged)
	var base: Node3D=game.world.statics.get("STK-8201")
	var incoming: Node3D=game.world.models.get("JOB-8201/handling")
	_check(base!=null and base.visible,"Merging supported stock keeps the preexisting destination layers visible")
	if base:
		var bounds: AABB=game.world._local_model_bounds(base,Transform3D.IDENTITY)
		_check(bounds.size.y>.8 and bounds.size.y<1.1,"Destination geometry contains five existing slab layers, without duplicating the incoming two")
	_check(incoming!=null and incoming.visible and incoming.get_meta("cargo_qty",0)==2,"The two incoming units remain visibly supported until placement finishes")
	game.world.sync_snapshot(latest)
func _run()->void:
	started_at=Time.get_ticks_msec();Engine.max_fps=60;root.size=Vector2i(1440,900);root.gui_embed_subwindows=true;root.msaa_3d=Viewport.MSAA_4X;root.use_taa=false
	game=MainHarness.new();root.add_child(game);game.add_child(game.camera);game.camera.current=true;game.camera.fov=38;game.camera.far=650;game._setup_environment()
	game.world=World.new();game.add_child(game.world);game.world.setup();game.world.set_grid(true)
	game.ui=UI.new();game.add_child(game.ui);game.ui.setup();game.ui.set_process(false)
	client=Client.new();game.add_child(client);game.client=client
	client.test_directory="/tmp/plant01-storage-move-bridge-%d"%OS.get_process_id()
	client.snapshot_received.connect(func(message: Dictionary)->void:latest=message;snapshots+=1;game._snapshot(message))
	client.reply_received.connect(func(message: Dictionary)->void:
		replies[int(message.id)]=message
		if message.get("action")!="shutdown":game._reply(message))
	game.ui.command.connect(game._command)
	process_frame.connect(func()->void:if is_instance_valid(game) and is_instance_valid(game.world):game.world.advance(1.0/60.0))
	client.start()
	var deadline: int=Time.get_ticks_msec()+10000
	while latest.is_empty() and Time.get_ticks_msec()<deadline:await process_frame
	_check(not latest.is_empty(),"Authenticated service supplies actual native snapshots")
	if latest.is_empty():client.close();game.queue_free();await process_frame;quit(1);return
	await _ok("new_game",{"mode":"empty"});await _ok("pause",{"paused":true})
	var base: Dictionary=await _state()
	game.ui.receive_reply({"action":"continue","ok":true})
	await _complete_partial(base,"cableReel","forklift",true)
	await _complete_partial(base,"diesel","excavator",false)
	_verify_merged_render()
	await _ok("shutdown");client.close();game.queue_free();await process_frame;await process_frame
	print("STORAGE_MOVE_BRIDGE_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"authenticatedService":true,"isolatedData":true,"snapshots":snapshots,"seconds":(Time.get_ticks_msec()-started_at)/1000.0}))
	quit(0 if failures.is_empty() else 1)
