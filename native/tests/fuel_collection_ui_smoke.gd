extends SceneTree
const UI=preload("res://scripts/game_ui.gd")
var failures: Array[String]=[]
var checks: int=0
var actions: Array=[]
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
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.equipment=[{"id":"EQ-1001","kind":"excavator","x":35,"z":20,"fuel":10,"tank":80,"used":70,"refueling":"JOB-1001","path":[]}]
	fixture.state.jobs=[{"id":"JOB-1001","kind":"refuel","x":35,"z":20,"w":1,"d":1,"status":"doing","phase":"Fill service can","target":"EQ-1001","equipment":"EQ-1001","stack":"STK-1001","worker":"WRK-1001","fuelLiters":12.5,"fuelWork":{"mode":"station","barrelId":"STK-1001","station":{"x":37,"z":20},"delivered":20}}]
	fixture.state.stacks=[{"id":"STK-1001","item":"diesel","qty":1,"reserved":0,"liters":120,"x":40,"z":20,"w":1,"d":1},{"id":"STK-1002","item":"slab","qty":8,"reserved":3,"x":42,"z":20,"w":1,"d":1},{"id":"STK-1003","item":"slab","qty":4,"reserved":0,"x":44,"z":20,"w":1,"d":1}]
	fixture.state.collections=[{"id":"COL-1001","carrierOrderId":"PO-1001","kind":"materials","status":"loading","phase":"rig","note":"Waiting for helper","massKg":560,"fees":{"transport":90,"disposal":22.4,"total":112.4,"invoiced":true},"lines":[{"stackId":"STK-1002","item":"slab","qty":2,"reserved":1,"loaded":1,"collected":0}],"task":{"equipmentId":"EQ-1001","operatorId":"WRK-1001","helperId":"WRK-1002"}}]
	fixture.state.retiredEquipment=[{"id":"EQ-1002","kind":"forklift","fuel":12,"used":300,"collectionId":"COL-1002"}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action: String,args: Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true})
	ui.show_entity("EQ-1001")
	var text: String=_text(ui.inspector_body)
	_check(text.contains("Drive to diesel drum") and text.contains("12.5 / 20 L") and text.contains("20.0 L") and text.contains("STK-1001"),"Equipment shows service mode, actual can, delivered fuel, drum and station")
	ui.show_entity("JOB-1001")
	_check(_text(ui.inspector_body).contains("Fuel service"),"Refuel task has the same service detail")
	ui.show_tab("Deliveries");_check(ui.tables.size()==3 and ui.tables[2].rows.size()==1,"Outbound collection has a separate sortable register")
	ui.show_entity("COL-1001")
	_check(_text(ui.inspector_body).contains("WRK-1002") and _text(ui.inspector_body).contains(ui._money(112.4)),"Collection inspector resolves crew, linked assets, status and fee")
	_check(_text(ui.inspector_body).contains("[url=STK-1002]"),"Collection source IDs use clickable inspector links")
	_button(ui.inspector_body,"Pause collection").pressed.emit()
	_check(actions.back()=={"action":"collection_pause","args":{"id":"COL-1001"}},"Pause targets the selected collection")
	ui.show_entity("EQ-1002");_check(_text(ui.inspector_body).contains("Collected off site") and _text(ui.inspector_body).contains("12.0 L"),"Historical equipment remains inspectable with retained fuel")
	ui.collection_ui.open(ui,"STK-1002")
	_check(ui.collection_ui.window.visible,"Clicking collection opens a visible quote dialog")
	_check(not ui.collection_ui.quantities.has("STK-1002"),"A stack reserved by active work cannot be selected for collection")
	fixture.state.stacks[1].reserved=0;ui.update_snapshot(fixture);ui.collection_ui.open(ui,"STK-1002")
	_check(ui.collection_ui.quantities["STK-1002"].max_value==8,"Released stock exposes its actual physical quantity")
	ui.collection_ui.quantities["STK-1002"].value=2
	ui.collection_ui.quantities["STK-1003"].value=3
	ui.collection_ui.quote_button.pressed.emit()
	_check(actions.back().action=="collection_quote" and actions.back().args.lines.size()==2,"One quote includes multiple selected physical stacks")
	ui.receive_reply({"action":"collection_quote","ok":true,"result":{"valid":true,"massKg":1400,"transportFee":90,"disposalFee":56,"total":146,"loads":[{}]}})
	_check(not ui.collection_ui.confirm_button.disabled and ui.collection_ui.quote_label.text.contains(ui._money(146)),"A valid quote exposes the concrete total before confirmation")
	ui.collection_ui.quantities["STK-1003"].value=1
	_check(ui.collection_ui.confirm_button.disabled,"Changing quantity invalidates the old price")
	ui.collection_ui.quote_button.pressed.emit()
	ui.receive_reply({"action":"collection_quote","ok":true,"result":{"valid":false,"error":"No reachable stock"}})
	_check(ui.collection_ui.confirm_button.disabled and ui.collection_ui.quote_label.text=="No reachable stock","Invalid quotes cannot submit collection")
	fixture.state.collections[0].lines[0].loaded=0;fixture.state.collections[0].lines[0].collected=2
	fixture.state.collections.append({"id":"COL-1003","lines":[{"stackId":"STK-1002","item":"slab","qty":4,"loaded":1,"collected":3}]})
	fixture.state.stacks.remove_at(1);ui.update_snapshot(fixture)
	var history: Dictionary=ui._entity("STK-1002")
	_check(history.get("type")=="collectedStock" and history.entity.collected==5 and history.entity.loaded==1 and history.entity.collectionIds.size()==2,"Exhausted original stock IDs retain aggregate history across multiple collections")
	ui.collection_ui.window.queue_free();ui.queue_free();await process_frame
	print("FUEL_COLLECTION_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
