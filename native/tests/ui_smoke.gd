extends SceneTree

const UI = preload("res://scripts/game_ui.gd")
var failures: Array[String] = []
var actions: Array[Dictionary] = []
var entity_emissions: int = 0

func _initialize() -> void:
	_run.call_deferred()

func _check(condition: bool,text: String) -> void:
	if not condition: failures.append(text)

func _run() -> void:
	var ui: CanvasLayer = UI.new()
	root.add_child(ui)
	ui.setup()
	ui.command.connect(func(action: String,args: Dictionary) -> void: actions.append({"action":action,"args":args}))
	ui.entity_selected.connect(func(_id: String) -> void: entity_emissions+=1)
	var file: FileAccess = FileAccess.open("res://../examples/willow-siding.json",FileAccess.READ)
	var state: Dictionary = JSON.parse_string(file.get_as_text())
	file.close()
	ui.update_snapshot({"state":state,"storage":{"hasSave":true},"inventory":[],"workRows":[]})
	_check(ui.menu.get_theme_color("font_color")==Color("304b40"),"Native popup menu uses readable dark-green font")
	_check(not ui.continue_button.disabled,"Continue recognizes nested storage.hasSave")
	ui.receive_reply({"action":"new_game","ok":true})
	_check(ui.started and not ui.startup.visible,"Successful startup reply dismisses choice screen")
	for tab: String in UI.TABS:
		ui.show_tab(tab)
		for table: Control in ui.tables:
			table._sort(0,MOUSE_BUTTON_LEFT)
			table.set_search("rail")
			table.set_search("")
			table.show_filters(true)
			table.show_filters(false)
	for key: String in ["workers","equipment","stacks","buildings","rails","zones","jobs","jobGroups","orders","notices"]:
		if not state.get(key,[]).is_empty():
			ui.show_entity(str(state[key][0].id))
			await process_frame
	_check(entity_emissions==0,"Programmatic show_entity must not emit and recurse")
	if not state.workers.is_empty():
		ui._user_entity(str(state.workers[0].id))
	_check(entity_emissions==1,"User selection emits exactly once")
	state.jobGroups=[{"id":"WORK-9991","label":"Connected rail installation","x":20,"z":4,"w":10,"d":2,"track":{},"created":0}]
	state.jobs=[{"id":"JOB-9992","kind":"rail","parentId":"WORK-9991","status":"todo","progress":0,"x":20,"z":4,"w":5,"d":2,"qty":1,"created":0,"reason":"Awaiting rail"}]
	ui.update_snapshot({"state":state,"storage":{"hasSave":true},"inventory":[],"workRows":[{"id":"WORK-9991","label":"Connected rail installation","group":true,"status":"todo","depth":0,"progress":0},{"id":"JOB-9992","label":"Install rail","group":false,"status":"todo","parentId":"WORK-9991","depth":1,"progress":0}]})
	ui.show_tab("Work")
	_check(ui.tables[0].rows.size()==1,"Work defaults to collapsed parent")
	ui.group_expansion["WORK-9991"]=true
	ui._refresh_register()
	_check(ui.tables[0].rows.size()==2,"Expanding a work reveals its child task")
	ui.show_entity("WORK-9991")
	ui.show_tab("SQL")
	ui.receive_reply({"action":"sql","ok":true,"result":[{"columns":["id","fuel"],"values":[["EQ-0001",42.5]]}]})
	_check(ui.sql_table.rows.size()==1,"SQLite array result renders into native table")
	ui.show_purchase()
	await process_frame
	(ui.purchase_quantity["builder"] as SpinBox).get_line_edit().text="6"
	(ui.purchase_quantity["builder"] as SpinBox).get_line_edit().text_changed.emit("6")
	(ui.purchase_quantity["slab"] as SpinBox).get_line_edit().text="10"
	(ui.purchase_quantity["slab"] as SpinBox).get_line_edit().text_changed.emit("10")
	ui._place_purchase()
	var batch: Dictionary = {}
	for action: Dictionary in actions:
		if action.action=="purchase_batch": batch=action.args
	_check(batch.get("lines",[]).size()==2,"Batch combines worker/material order quantities")
	var typed_slabs: int = 0
	for line: Dictionary in batch.get("lines",[]):
		if line.item=="slab": typed_slabs=int(line.qty)
	_check(typed_slabs==10,"Uncommitted typed quantity is included without Enter")
	var table: Control = ui.sql_table
	_check(table.row_id_pattern.search("PO-0074")!=null,"Delivery IDs clickable")
	_check(table.row_id_pattern.search("WORK-0074")!=null,"Work-order IDs clickable")
	_check(table.row_id_pattern.search("N-0074")!=null,"Notice IDs clickable")
	var result: Dictionary = {"passed":failures.is_empty(),"failures":failures,"tabs":UI.TABS.size(),"commands":actions.size(),"inspectorTypes":10}
	print("UI_SMOKE ",JSON.stringify(result))
	quit(0 if failures.is_empty() else 1)
