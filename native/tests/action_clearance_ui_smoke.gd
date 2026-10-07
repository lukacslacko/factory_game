extends SceneTree
## Synthetic blocked snapshot through the production native UI; no service or GPU.
const UI=preload("res://scripts/game_ui.gd")
var failures:Array[String]=[]
var checks:int=0
var actions:Array[Dictionary]=[]
var focused:Array[String]=[]
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _button(node:Node,text:String)->Button:
	if node is Button and node.text==text:return node
	for child:Node in node.get_children():
		var found:Button=_button(child,text)
		if found:return found
	return null
func _press(node:Node,text:String)->void:
	var button:Button=_button(node,text);_check(button!=null,"Control exists: "+text)
	if button:button.pressed.emit()
func _text(node:Node)->String:
	var result:String=str(node.text) if node is Label or node is RichTextLabel else ""
	for child:Node in node.get_children():result+="\n"+_text(child)
	return result
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.elapsed=100
	fixture.state.workers=[{"id":"WRK-1001","name":"Worker #1","role":"builder","duty":"auto","job":"JOB-1001","status":"Waiting for placement","wage":28,"hours":0},{"id":"WRK-1002","name":"Worker #2","role":"builder","duty":"manual","status":"Manual walking","wage":28,"hours":0},{"id":"WRK-1003","name":"Worker #3","role":"operator","duty":"manual","vehicle":"EQ-1002","status":"Manual driving","wage":36,"hours":0},{"id":"WRK-1004","name":"Worker #4","role":"operator","duty":"auto","vehicle":"EQ-1001","status":"Paving","wage":36,"hours":0}]
	fixture.state.equipment=[{"id":"EQ-1001","kind":"excavator","x":30,"z":20,"fuel":70,"tank":80,"used":10,"operator":"WRK-1004","job":"JOB-1001","path":[]},{"id":"EQ-1002","kind":"forklift","x":32,"z":20,"fuel":40,"tank":45,"used":5,"operator":"WRK-1003","path":[]}]
	fixture.state.jobs=[{"id":"JOB-1001","kind":"slab","x":31,"z":20,"w":1,"d":1,"status":"doing","phase":"Set down slab","reason":"Clear placement area","item":"slab","qty":1,"progress":.5,"worker":"WRK-1001","operator":"WRK-1004","equipment":"EQ-1001"}]
	fixture.state.actionClearances=[{"ownerId":"JOB-1001","requesterEquipmentId":"EQ-1001","action":"place supported slab","blockerIds":["WRK-1002","EQ-1002"],"since":75,"lastSeen":100,"retryAt":101.5,"noticeId":"N-1001","point":{"x":31,"z":20}}]
	fixture.state.notices=[{"id":"N-1002","time":25299,"title":"Delivery approaching","detail":"An ordinary information message.","entity":"EQ-1001","state":"todo","seen":false},{"id":"N-1001","time":25298,"title":"Action clearance blocked","detail":"JOB-1001 with EQ-1001 waits for WRK-1002 and EQ-1002 to clear placement.","entity":"JOB-1001","state":"todo","seen":false,"severity":"warning"}]
	fixture.state.events=[{"id":"EV-1001","time":25298,"type":"Traffic","entity":"JOB-1001","severity":"warning","text":"Placement blocked by WRK-1002 and EQ-1002"},{"id":"EV-1002","time":25299,"type":"Delivery","entity":"EQ-1001","severity":"info","text":"Delivery approaching"}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.focus_entity.connect(func(id:String)->void:focused.append(id))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.update_snapshot(fixture)
	await process_frame;await process_frame
	_check(ui.toast.visible and _text(ui.toast_body).contains("Action clearance blocked"),"An unresolved warning takes popup priority over newer ordinary information")
	_press(ui.toast_body,"Locate")
	_check(focused.back()=="JOB-1001" and actions.back()=={"action":"notice","args":{"id":"N-1001","seen":true}},"Warning Locate targets the actual action and marks only that warning seen")
	ui.show_entity("EQ-1001")
	var body:String=_text(ui.inspector_body)
	_check(body.contains("place supported slab") and body.contains("25.0 seconds") and body.contains("WRK-1002") and body.contains("JOB-1001"),"Requester inspector exposes action, stable owner, duration and linked blockers")
	_check(body.contains("automatic clearance will not move") and body.contains("automatic clearance will not drive"),"Manual worker and manual equipment blockers have distinct actionable explanations")
	_press(ui.inspector_body,"Inspect WRK-1002")
	_check(ui.selected_id=="WRK-1002" and _text(ui.inspector_body).contains("Active clearance"),"Blocking worker links back to the same pending action")
	_press(ui.inspector_body,"Locate EQ-1002")
	_check(focused.back()=="EQ-1002" and ui.active_tab=="Yard","Blocker Locate is a direct focus action")
	ui.show_entity("JOB-1001")
	_check(_text(ui.inspector_body).contains("Active clearance"),"Work inspector exposes the shared action blockage")
	ui.show_entity("WRK-1001")
	_check(_text(ui.inspector_body).contains("place supported slab"),"Assigned worker sees the actual job clearance instead of an unexplained wait")
	ui.show_entity("N-1001")
	_check(_button(ui.inspector_body,"Inspect JOB-1001")!=null and _button(ui.inspector_body,"Locate WRK-1002")!=null,"Notice inspector has direct owner and blocker inspection and location controls")
	ui.show_tab("Inbox")
	_check(is_instance_valid(ui.severity_filter) and ui.severity_filter.item_count==3,"Inbox has an explicit warnings-only selector")
	ui.severity_filter.selected=1;ui.severity_filter.item_selected.emit(1)
	_check(ui.tables[0].rows.size()==1 and ui.tables[0].rows[0].id=="N-1001","Warnings-only Inbox hides ordinary information")
	ui.show_tab("Activity");ui.severity_filter.selected=1;ui.severity_filter.item_selected.emit(1)
	_check(ui.tables[0].rows.size()==1 and ui.tables[0].rows[0].cells[1]=="warning","Activity warnings filter follows actual event severity")
	fixture.state.notices[1].detail="JOB-1001 with EQ-1001 still waits for EQ-1002."
	ui.update_snapshot(fixture)
	_check(_text(ui.toast_body).contains("still waits for EQ-1002"),"Updated blocker context refreshes a persistent warning without requiring a new notice ID")
	fixture.state.actionClearances=[];fixture.state.notices[1].state="done";fixture.state.notices[1].detail+=" Resolved."
	ui.update_snapshot(fixture);ui.show_entity("EQ-1001")
	_check(not _text(ui.inspector_body).contains("Active clearance"),"Resolved blockages disappear from the active machine inspector")
	_check(not _text(ui.toast_body).contains("still waits for EQ-1002") or not ui.toast.visible,"A resolved warning cannot remain visible as an active blocked-action popup")
	ui.show_entity("N-1001")
	_check(_text(ui.inspector_body).contains("Resolved") and _button(ui.inspector_body,"Locate EQ-1002")!=null,"Resolved notice history retains its original inspectable context")
	ui.show_tab("Inbox");ui.severity_filter.selected=1;ui.severity_filter.item_selected.emit(1)
	_check(ui.tables[0].rows.is_empty(),"Active Inbox excludes resolved warnings")
	fixture.state.actionClearances=[{"ownerId":"JOB-1001","requesterEquipmentId":"EQ-1001","action":"Clear placement area","blockerIds":["EQ-1002"],"since":75,"lastSeen":100,"retryAt":101.5,"point":{"x":31,"z":20}}]
	fixture.state.workers[2].erase("vehicle");fixture.state.workers[2].duty="auto";fixture.state.workers[2].actionClearanceEquipment="EQ-1002"
	fixture.state.equipment[1].erase("operator");fixture.state.equipment[1].actionYieldOperator="WRK-1003";fixture.state.equipment[1].actionYieldFor="JOB-1001"
	ui.update_snapshot(fixture);ui.show_entity("WRK-1003")
	_check(_text(ui.inspector_body).contains("Clear placement area") and _text(ui.inspector_body).contains("Clearance equipment"),"A recruited on-foot operator can inspect the actual action and linked equipment before boarding")
	ui.show_entity("EQ-1002")
	_check(_text(ui.inspector_body).contains("Clearance operator") and _text(ui.inspector_body).contains("WRK-1003"),"An unattended blocker exposes the real operator walking to its cab")
	ui.queue_free();await process_frame
	print("ACTION_CLEARANCE_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
