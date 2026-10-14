extends SceneTree
## Read-only blocked-work diagnosis with existing persistent warnings; no service or GPU.
const UI=preload("res://scripts/game_ui.gd")
var failures:Array[String]=[]
var checks:int=0
var actions:Array[Dictionary]=[]

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
	fixture.state.jobs=[{"id":"JOB-1001","kind":"slab","parentId":"WORK-1001","status":"doing","reason":"Placement blocked by WRK-1001","x":31,"z":20,"w":1,"d":1,"progress":0.5},{"id":"JOB-1002","kind":"slab","parentId":"WORK-1001","status":"todo","reason":"Waiting for existing paving","x":32,"z":20,"w":1,"d":1,"progress":0},{"id":"JOB-1003","kind":"lamp","status":"todo","reason":"Waiting for concrete slabs","x":40,"z":20,"w":1,"d":1,"progress":0},{"id":"JOB-1004","kind":"rail","status":"doing","reason":"Waiting for JOB-1005 to physically clear STK-1001 from the rail pickup","railPickupRecovery":{"activeJobId":"JOB-1005","activeBlockerId":"STK-1001","attemptedIds":["STK-1001"]},"x":52,"z":8,"w":5,"d":2,"progress":0.1},{"id":"JOB-1005","kind":"moveStock","status":"doing","phase":"Carry to storage","reason":"Moving railCurve to a clear bay","stockMove":{"sourceId":"STK-1001","toStorage":true,"destination":{"x":70,"z":30,"w":6,"d":3}},"x":70,"z":30,"w":6,"d":3,"progress":0.4}]
	fixture.state.stacks=[{"id":"STK-1001","item":"railCurve","x":43,"z":48,"w":6,"d":3,"qty":1,"reserved":1,"source":"delivery"}]
	fixture.state.jobGroups=[{"id":"WORK-1001","label":"Pave foundation","x":31,"z":20,"w":2,"d":1}]
	fixture.state.actionClearances=[{"ownerId":"JOB-1001","requesterEquipmentId":"EQ-1001","action":"place supported slab","blockerIds":["WRK-1001"],"since":30,"lastSeen":90,"retryAt":91,"noticeId":"N-1001","point":{"x":31,"z":20}}]
	fixture.state.notices=[{"id":"N-1001","time":25260,"title":"Action blocked","detail":"JOB-1001 cannot place a slab until WRK-1001 moves clear.","entity":"JOB-1001","state":"todo","severity":"warning","seen":true},{"id":"N-1002","time":25240,"title":"Work blocked","detail":"JOB-1003: Waiting for concrete slabs","entity":"JOB-1003","state":"doing","severity":"warning","seen":true},{"id":"N-1003","time":25280,"title":"Delivery approaching","detail":"Routine information","entity":"JOB-1003","state":"todo","severity":"info"},{"id":"N-1004","time":25200,"title":"Work blocked","detail":"Past resolved shortage","entity":"JOB-1003","state":"done","severity":"warning"}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.update_snapshot(fixture)
	ui.show_tab("Work")
	_check(ui.tables.size()==4 and ui.tables[1].rows.size()==3,"Work register exposes unresolved warnings and an active physical prerequisite without requiring a warning")
	_check(actions.is_empty() and ui.tables[2].rows.is_empty(),"Opening Work never polls dependency diagnosis")
	_check(ui.tables[3].rows.size()==3 and ui.tables[3].rows[0].cells[0]=="Worker clearance · WRK-1001" and ui.tables[3].rows[0].cells[1]==2,"Live cause groups summarize a known blocker and affected work without diagnosis polling")
	_check(ui.tables[3].rows[0].cells[2]=="1:00" and ui.tables[3].rows[0].cells[4].contains("E31.0, S20.0"),"Cause group exposes longest actual wait and physical work area")
	var physical_group:Dictionary=ui.tables[3].rows[2]
	_check(physical_group.cells[0]=="Physical recovery · STK-1001" and physical_group.cells[4].contains("6 × 3 m"),"Active rail-pickup group identifies the blocking stock footprint")
	_check(physical_group.cells[5]=="JOB-1005" and physical_group.cells[6].contains("40%") and physical_group.refs["0"]=="STK-1001","Cause group links blocker and physical prerequisite progress")
	ui.tables[3].entity_clicked.emit("STK-1001")
	_check(ui.selected_id=="STK-1001","Grouped blocker opens its physical stock inspector")
	var diagnose:Button=_button(ui,"Diagnose dependencies")
	_check(diagnose!=null and ui.diagnosis_note.text.contains("on demand"),"Diagnosis is an explicit action with a read-only limitation")
	if diagnose:diagnose.pressed.emit();diagnose.pressed.emit()
	_check(actions.size()==1 and actions[0].action=="dependency_diagnosis" and ui.dependency_pending,"One pending request cannot be duplicated")
	ui.receive_reply({"action":"dependency_diagnosis","ok":true,"result":{"diagnoses":[{"id":"JOB-1004","classification":"physical-relocation","reason":"Waiting for JOB-1005","waitSeconds":12.5,"blockerIds":["JOB-1005"],"edges":[{"from":"JOB-1004","to":"JOB-1005","kind":"recovery-prerequisite","entity":"job","mobility":"temporary"}]},{"id":"JOB-1001","classification":"cycle","reason":"Waiting for clearance","waitSeconds":4.0,"blockerIds":["WRK-1001"],"cycle":["JOB-1001","WRK-1001","JOB-1001"],"edges":[{"from":"JOB-1001","to":"WRK-1001","kind":"action-clearance","entity":"worker","mobility":"player-action"}]}],"inspected":{"jobs":5,"clearances":1,"actors":1,"edges":2},"truncated":true}})
	_check(ui.tables[2].rows.size()==2 and str(ui.tables[2].rows[0].cells[1]).to_lower()=="physical relocation" and ui.tables[2].rows[0].cells[2]=="JOB-1005","Typed dependency class and blocker are visible")
	_check(ui.tables[2].rows[0].cells[3]=="12.5" and ui.tables[2].rows[1].cells[4].contains("WRK-1001") and ui.tables[2].rows[1].cells[5].contains("action-clearance"),"Wait, cycle links, and typed edge are visible")
	_check(ui.diagnosis_note.text.contains("truncated") and ui.diagnosis_note.text.contains("not a move approval") and not ui.dependency_pending,"Bounded diagnosis labels uncertainty and remains distinct from physical recovery approval")
	ui.tables[2].entity_clicked.emit("JOB-1005")
	_check(ui.selected_id=="JOB-1005","Diagnosis blocker/job ID links to existing inspector")
	ui.update_snapshot(fixture)
	_check(actions.size()==1 and ui.tables[2].rows.size()==2,"Later snapshots reuse the captured diagnosis without polling")
	diagnose.pressed.emit()
	_check(actions.size()==2 and ui.dependency_pending,"Refresh is available only by another explicit request")
	ui.receive_reply({"action":"dependency_diagnosis","ok":false,"error":"Survey unavailable"})
	_check(ui.tables[2].rows.is_empty() and ui.diagnosis_note.text.contains("Survey unavailable") and not ui.dependency_pending,"Failed refresh clears stale results and permits a retry")
	var first:Dictionary=ui.tables[1].rows[0];var second:Dictionary=ui.tables[1].rows[1]
	_check(first.id=="N-1001" and first.cells[1].contains("WRK-1001") and first.cells[4]==2,"Action clearance shows its actual blocker and two related active tasks")
	_check(first.cells[5]=="1:00" and second.cells[5]=="0:50","Elapsed wait uses the actual clearance start when known, otherwise warning time")
	_check(first.cells[6].contains("release manual control") and second.cells[6].contains("order"),"Suggested steps distinguish manual clearance from missing material")
	_check(first.refs["0"]=="N-1001" and first.refs["2"]=="JOB-1001","Rows link both the persistent notice and affected work")
	var physical:Dictionary=ui.tables[1].rows[2]
	_check(physical.id=="JOB-1004" and physical.cells[0]=="—" and physical.cells[3].contains("STK-1001"),"Pending rail recovery appears even before its parent has a warning notice")
	_check(physical.cells[7]=="JOB-1005" and physical.cells[8].contains("40% · doing · Carry to storage") and physical.refs["7"]=="JOB-1005","Physical prerequisite links its child work and shows actual phase and progress")
	_check(physical.cells[6].contains("must complete") and not physical.cells[6].contains("move STK"),"UI does not prescribe another move while the checked recovery is underway")
	ui.show_entity("JOB-1004")
	_check(_button(ui.inspector_body,"Inspect JOB-1005")!=null and _button(ui.inspector_body,"Inspect STK-1001")!=null,"Rail work inspector links the physical prerequisite and blocker stock")
	ui.show_entity("JOB-1005")
	_check(_button(ui.inspector_body,"Inspect JOB-1004")!=null,"Stock-move child links back to suspended rail work")
	fixture.state.notices.push_front({"id":"N-1005","time":25285,"title":"Rail pickup blocked","detail":"Old pickup face obstruction at STK-1001","entity":"JOB-1004","state":"todo","severity":"warning"})
	ui.update_snapshot(fixture);ui.show_tab("Work")
	_check(ui.tables[1].rows.size()==3 and ui.tables[1].rows[0].id=="N-1005" and ui.tables[1].rows[0].cells[7]=="JOB-1005","Existing rail warning is enriched with live recovery progress, without duplicate parent rows")
	_check(ui.tables[3].rows.size()==3 and ui.tables[3].rows[2].cells[1]==1,"A new warning for the same rail recovery does not double-count its work")
	ui.show_entity("N-1005")
	_check(_button(ui.inspector_body,"Inspect JOB-1005")!=null and _button(ui.inspector_body,"Inspect STK-1001")!=null,"Warning inspector exposes current physical recovery links even if its old text is stale")
	var jump:Button=_button(ui,"Review blocked work")
	_check(jump!=null,"Blockage register has an explicit jump control")
	if jump:jump.pressed.emit()
	ui.tables[1].entity_clicked.emit("N-1001")
	_check(ui.selected_id=="N-1001" and _button(ui.inspector_body,"Inspect WRK-1001")!=null,"Notice opens linked blocker controls without an officer")
	ui.tables[1].entity_clicked.emit("WRK-1001")
	_check(ui.selected_id=="WRK-1001","Linked worker is inspectable from the same register")
	fixture.state.actionClearances=[];fixture.state.notices[1].state="done"
	ui.update_snapshot(fixture);ui.show_tab("Work")
	_check(ui.tables[1].rows.size()==2 and ui.tables[1].rows[1].id=="N-1002","Resolved clearance leaves the active diagnosis while physical recovery remains visible")
	fixture.state.jobs[3].erase("railPickupRecovery");fixture.state.notices[0].state="done"
	ui.update_snapshot(fixture);ui.show_tab("Work")
	_check(ui.tables[1].rows.size()==1 and ui.tables[1].rows[0].id=="N-1002","Completed prerequisite disappears when rail pickup resumes")
	_check(ui.tables[3].rows.size()==1 and ui.tables[3].rows[0].cells[0]=="Material supply","Resolved causes disappear from the live grouped view")
	fixture.state.workers.append({"id":"WRK-1006","name":"Worker #6","role":"logisticsOfficer","duty":"auto","status":"Coordinating logistics"})
	fixture.logisticsPolicy={"automaticStockRelocation":false,"automaticIdleClearance":true,"minimumWaitSeconds":45,"maxActiveRelocations":2}
	fixture.logisticsOfficerStatus={"onDutyOfficerIds":["WRK-1006"]}
	ui.update_snapshot(fixture);ui.show_tab("Work")
	_check(ui.catalog.has("logisticsOfficer") and ui.logistics_officer_status_label.text.contains("Hired: 1") and ui.logistics_officer_status_label.text.contains("On duty: 1"),"Work shows hired and on-duty logistics officer status")
	ui.logistics_officer_status_label.meta_clicked.emit("WRK-1006")
	_check(ui.selected_id=="WRK-1006","Officer status ID opens the worker inspector")
	_check(not ui.logistics_policy_buttons["automaticStockRelocation"].button_pressed and ui.logistics_policy_buttons["automaticIdleClearance"].button_pressed,"Saved officer switches restore independently")
	_check(int(ui.logistics_wait_seconds.value)==45 and int(ui.logistics_active_moves.value)==2,"Saved wait and concurrency thresholds restore to controls")
	var action_count:int=actions.size()
	ui.logistics_policy_buttons["automaticStockRelocation"].toggled.emit(true)
	_check(actions.size()==action_count+1 and actions[-1].action=="logistics_policy_configure" and actions[-1].args.changes=={"automaticStockRelocation":true},"Officer stock-recovery toggle sends one policy change")
	ui.logistics_wait_seconds.value=60;ui.logistics_active_moves.value=3
	var apply_policy:Button=_button(ui,"Apply logistics thresholds")
	if apply_policy:apply_policy.pressed.emit()
	_check(apply_policy!=null and actions.size()==action_count+2 and actions[-1].args.changes=={"minimumWaitSeconds":60,"maxActiveRelocations":3},"Officer thresholds submit both bounded settings together")
	fixture.logisticsOfficerStatus={"onDutyOfficerIds":[]}
	ui.update_snapshot(fixture);ui._refresh_register()
	_check(ui.logistics_officer_status_label.text.contains("On duty: 0") and ui.logistics_officer_status_label.text.contains("no automatic logistics dispatch"),"Off-shift officer status explains why saved policies cannot dispatch")
	ui.queue_free();await process_frame
	print("BLOCKED_WORK_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
