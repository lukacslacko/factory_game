extends SceneTree
## Read-only blocked-work diagnosis with existing persistent warnings; no service or GPU.
const UI=preload("res://scripts/game_ui.gd")
var failures:Array[String]=[]
var checks:int=0

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

func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.time=25290;fixture.state.elapsed=90
	fixture.state.workers=[{"id":"WRK-1001","name":"Worker #1","role":"builder","duty":"manual","status":"Standing in the way"}]
	fixture.state.jobs=[{"id":"JOB-1001","kind":"slab","parentId":"WORK-1001","status":"doing","reason":"Placement blocked by WRK-1001","x":31,"z":20,"w":1,"d":1,"progress":0.5},{"id":"JOB-1002","kind":"slab","parentId":"WORK-1001","status":"todo","reason":"Waiting for existing paving","x":32,"z":20,"w":1,"d":1,"progress":0},{"id":"JOB-1003","kind":"lamp","status":"todo","reason":"Waiting for concrete slabs","x":40,"z":20,"w":1,"d":1,"progress":0}]
	fixture.state.jobGroups=[{"id":"WORK-1001","label":"Pave foundation","x":31,"z":20,"w":2,"d":1}]
	fixture.state.actionClearances=[{"ownerId":"JOB-1001","requesterEquipmentId":"EQ-1001","action":"place supported slab","blockerIds":["WRK-1001"],"since":30,"lastSeen":90,"retryAt":91,"noticeId":"N-1001","point":{"x":31,"z":20}}]
	fixture.state.notices=[{"id":"N-1001","time":25260,"title":"Action blocked","detail":"JOB-1001 cannot place a slab until WRK-1001 moves clear.","entity":"JOB-1001","state":"todo","severity":"warning","seen":true},{"id":"N-1002","time":25240,"title":"Work blocked","detail":"JOB-1003: Waiting for concrete slabs","entity":"JOB-1003","state":"doing","severity":"warning","seen":true},{"id":"N-1003","time":25280,"title":"Delivery approaching","detail":"Routine information","entity":"JOB-1003","state":"todo","severity":"info"},{"id":"N-1004","time":25200,"title":"Work blocked","detail":"Past resolved shortage","entity":"JOB-1003","state":"done","severity":"warning"}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.update_snapshot(fixture)
	ui.show_tab("Work")
	_check(ui.tables.size()==2 and ui.tables[1].rows.size()==2,"Work register exposes only unresolved warning causes")
	var first:Dictionary=ui.tables[1].rows[0];var second:Dictionary=ui.tables[1].rows[1]
	_check(first.id=="N-1001" and first.cells[1].contains("WRK-1001") and first.cells[4]==2,"Action clearance shows its actual blocker and two related active tasks")
	_check(first.cells[5]=="1:00" and second.cells[5]=="0:50","Elapsed wait uses the actual clearance start when known, otherwise warning time")
	_check(first.cells[6].contains("release manual control") and second.cells[6].contains("order"),"Suggested steps distinguish manual clearance from missing material")
	_check(first.refs["0"]=="N-1001" and first.refs["2"]=="JOB-1001","Rows link both the persistent notice and affected work")
	var jump:Button=_button(ui,"Review blocked work")
	_check(jump!=null,"Blockage register has an explicit jump control")
	if jump:jump.pressed.emit()
	ui.tables[1].entity_clicked.emit("N-1001")
	_check(ui.selected_id=="N-1001" and _button(ui.inspector_body,"Inspect WRK-1001")!=null,"Notice opens linked blocker controls without an officer")
	ui.tables[1].entity_clicked.emit("WRK-1001")
	_check(ui.selected_id=="WRK-1001","Linked worker is inspectable from the same register")
	fixture.state.actionClearances=[];fixture.state.notices[0].state="done"
	ui.update_snapshot(fixture);ui.show_tab("Work")
	_check(ui.tables[1].rows.size()==1 and ui.tables[1].rows[0].id=="N-1002","Resolved causes leave the active diagnosis while other work remains visible")
	ui.queue_free();await process_frame
	print("BLOCKED_WORK_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
