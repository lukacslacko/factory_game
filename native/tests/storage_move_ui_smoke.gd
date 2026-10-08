extends SceneTree
## Production stock dialogs with a command spy; no service, save, or user app.
const UI=preload("res://scripts/game_ui.gd")
var failures: Array[String]=[]
var checks: int=0
var actions: Array[Dictionary]=[]

func _initialize()->void:_run.call_deferred()
func _check(value: bool,label: String)->void:
	checks+=1
	if not value:failures.append(label)
func _text(node: Node)->String:
	var result: String=str(node.text) if node is Label or node is RichTextLabel else ""
	for child: Node in node.get_children():result+="\n"+_text(child)
	return result
func _button(node: Node,text: String)->Button:
	if node is Button and node.text==text:return node
	for child: Node in node.get_children():
		var found: Button=_button(child,text)
		if found:return found
	return null
func _press(node: Node,text: String)->void:
	var button: Button=_button(node,text);_check(button!=null,"Control exists: "+text)
	if button:button.pressed.emit()
func _choose(option: OptionButton,id: String)->void:
	for i: int in option.item_count:
		if str(option.get_item_metadata(i))==id:option.select(i);option.item_selected.emit(i);return
func _reply(ui,request_id: String,error: String="",zone_id: String="ZONE-1001",mass: float=146,quantity: int=1)->void:
	ui.receive_reply({"action":"storage_move_preview","ok":true,"result":{"requestId":request_id,"error":error,"destination":{"x":24,"z":35,"w":1,"d":1},"zoneId":zone_id,"mass":mass,"quantity":quantity}})

func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.stacks=[{"id":"STK-1001","item":"cableReel","qty":1,"reserved":0,"x":12,"z":22,"w":1,"d":1,"cableMeters":37,"cableReservedMeters":0},{"id":"STK-1002","item":"slab","qty":4,"reserved":1,"x":14,"z":22,"w":1,"d":1},{"id":"STK-1003","item":"diesel","qty":1,"reserved":0,"x":16,"z":22,"w":1,"d":1,"liters":71.5},{"id":"STK-1004","item":"railPoints","qty":2,"reserved":0,"x":18,"z":22,"w":5,"d":2}]
	fixture.state.zones=[{"id":"ZONE-1001","name":"North stores","x":24,"z":35,"w":10,"d":12},{"id":"ZONE-1002","name":"West yard","x":4,"z":35,"w":10,"d":12}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action: String,args: Dictionary)->void:actions.append({"action":action,"args":args.duplicate(true)}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});await process_frame
	for id: String in ["STK-1001","STK-1002","STK-1003","STK-1004"]:
		ui.show_entity(id)
		_check(_button(ui.inspector_body,"Move to storage…")!=null,"All physical stock exposes storage move: "+id)
	ui.show_entity("STK-1004")
	_check(_button(ui.inspector_body,"Relocate one exposed rail panel")!=null,"Precise rail-panel relocation remains available")
	ui.show_entity("STK-1001")
	_check(_text(ui.inspector_body).contains("146 kg"),"Partial cable reel mass includes remaining cable and wooden reel")
	_press(ui.inspector_body,"Move to storage…")
	var mover=ui.storage_move_ui
	await process_frame
	_check(mover.window.visible and mover.submit_button.disabled,"Storage move opens with physical preview pending")
	_check(_text(mover.window).contains("37.0 / 50 m"),"Partial cable contents are visible before moving")
	_check(actions.back().action=="storage_move_preview" and actions.back().args.id=="STK-1001" and actions.back().args.quantity==1 and not actions.back().args.has("zoneId"),"Default requests all available units and an automatic stockyard")
	_check(mover.zone_choice.item_count==3,"Automatic and both named stockyards are available")
	var first_request: String=mover.preview_request
	_choose(mover.zone_choice,"ZONE-1002")
	_check(actions.back().args.zoneId=="ZONE-1002","Explicit stockyard selection sends its stable ID")
	var second_request: String=mover.preview_request
	_reply(ui,first_request)
	_check(mover.submit_button.disabled,"Old preview cannot enable a changed destination")
	_reply(ui,second_request,"The selected stockyard has no clear space")
	_check(mover.submit_button.disabled and mover.preview_note.text.contains("no clear space"),"Clear placement failure is visible and prevents submitting")
	mover.zone_search.text="North";mover.zone_search.text_changed.emit("North")
	_check(ui._selection(mover.zone_choice)=="ZONE-1002" and mover.zone_choice.item_count==3,"Filtering keeps an explicit chosen stockyard rather than silently replacing it")
	_choose(mover.zone_choice,"")
	_check(not actions.back().args.has("zoneId"),"Automatic can be restored after explicit selection")
	_reply(ui,mover.preview_request)
	_check(not mover.submit_button.disabled and mover.preview_note.text.contains("North stores") and mover.preview_note.text.contains("146 kg"),"Reachable automatic destination and actual partial-reel mass are explained")
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--capture="):
			await process_frame;await process_frame
			var path: String=argument.trim_prefix("--capture=")
			_check(root.get_texture().get_image().save_png(path)==OK,"Dialog visual capture saved")
	_press(mover.window,"Create move work")
	_check(actions.back().action=="move_to_storage" and actions.back().args.id=="STK-1001","Submitting requests physical movement of the selected stack")
	_check(mover.submit_button.disabled and mover.zone_choice.disabled and not mover.quantity.editable,"Pending creation locks controls and prevents duplicate submissions")
	var move_request: String=mover.move_request
	_reply(ui,mover.preview_request,"Late preview error")
	_check(mover.preview_note.text.contains("creating physical"),"Late preview cannot overwrite an in-flight creation")
	ui.receive_reply({"action":"move_to_storage","ok":true,"result":{"requestId":"unrelated","error":"","job":{"id":"JOB-1001"}}})
	_check(mover.window.visible,"Unrelated creation reply cannot close this dialog")
	ui.receive_reply({"action":"move_to_storage","ok":false,"result":{"requestId":move_request,"error":"Source became reserved"}})
	_check(not mover.submitting and not mover.refresh_button.disabled and mover.submit_button.disabled and mover.preview_note.text.contains("Source became reserved"),"Creation failures are recoverable by refreshing rather than double-submitting old space")
	_press(mover.window,"Refresh preview");_reply(ui,mover.preview_request)
	_press(mover.window,"Create move work")
	fixture.state.jobGroups=[{"id":"WORK-1001","kind":"recovery","name":"Move cable reel to storage","x":12,"z":22,"w":1,"d":1}]
	ui.update_snapshot(fixture)
	ui.receive_reply({"action":"move_to_storage","ok":true,"result":{"requestId":mover.move_request,"error":"","job":{"id":"JOB-1001"},"groupId":"WORK-1001"}})
	_check(ui.active_tab=="Work" and ui.selected_id=="WORK-1001","Successful creation opens the linked whole work for manual equipment assignment")
	await process_frame
	fixture.state.jobs=[{"id":"JOB-1001","kind":"recovery","status":"doing","phase":"carry","progress":.5,"qty":1,"item":"cableReel","stockMove":{"sourceId":"STK-1001","destination":{"x":24,"z":35,"w":1,"d":1},"zoneId":"ZONE-1001","toStorage":true,"afterJobId":"JOB-1000","load":{"item":"cableReel","qty":1,"cableMeters":37}}}]
	ui.update_snapshot(fixture);ui.show_entity("JOB-1001")
	_check(_text(ui.inspector_body).contains("[url=STK-1001]") and _text(ui.inspector_body).contains("[url=ZONE-1001]"),"Active move retains clickable source and destination references after pickup")
	_check(_text(ui.inspector_body).contains("E24.0, S35.0") and _text(ui.inspector_body).contains("37.0 m"),"Move work shows target footprint and preserved carried cable")
	_check(_text(ui.inspector_body).contains("[url=JOB-1000]"),"Batched movement explains the earlier lift it waits for")
	ui.show_entity("STK-1002");_press(ui.inspector_body,"Move to storage…")
	_check(int(mover.quantity.value)==3 and int(mover.quantity.max_value)==3,"Quantity defaults to all unreserved units and cannot exceed that amount")
	mover.quantity.value=2
	_check(actions.back().args.quantity==2 and mover.submit_button.disabled,"Quantity change triggers a new checked preview")
	var previous_stack_request: String=mover.preview_request
	ui.show_entity("STK-1003");_press(ui.inspector_body,"Move to storage…")
	_check(_text(mover.window).contains("71.5 L"),"Partly used diesel is shown with its real remaining contents")
	_reply(ui,previous_stack_request,"Stale slab error")
	_check(not mover.preview_note.text.contains("Stale slab"),"Reply for a closed previous material does not affect a new move")
	_reply(ui,mover.preview_request,"Fuel is reserved by active refueling")
	_check(mover.submit_button.disabled and mover.preview_note.text.contains("active refueling"),"Active resource reservations cannot be moved through the UI")
	_press(mover.window,"Cancel");await process_frame
	ui.receive_reply({"action":"storage_move_preview","ok":true,"result":{"requestId":mover.preview_request,"error":""}})
	ui.queue_free();await process_frame;await process_frame
	print("STORAGE_MOVE_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
