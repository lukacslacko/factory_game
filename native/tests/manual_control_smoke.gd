extends SceneTree

const UI = preload("res://scripts/game_ui.gd")
var failures: Array[String] = []
var actions: Array[Dictionary] = []

func _initialize() -> void:
	_run.call_deferred()

func _check(condition: bool,text: String) -> void:
	if not condition: failures.append(text)

func _button(node: Node,text: String) -> Button:
	for child: Node in node.get_children():
		if child is Button and child.text==text: return child
		var found: Button = _button(child,text)
		if found!=null: return found
	return null

func _has_label(node: Node,text: String) -> bool:
	for child: Node in node.get_children():
		if child is Label and child.text==text: return true
		if _has_label(child,text): return true
	return false

func _run() -> void:
	var ui: CanvasLayer = UI.new()
	root.add_child(ui)
	ui.setup()
	ui.command.connect(func(action: String,args: Dictionary) -> void: actions.append({"action":action,"args":args}))
	var worker: Dictionary = {"id":"WRK-9001","name":"Worker #1","role":"operator","duty":"manual","vehicle":"EQ-9001","x":30,"z":30}
	var equipment: Dictionary = {"id":"EQ-9001","kind":"excavator","operator":"WRK-9001","x":30,"z":30,"fuel":120,"tank":180,"used":0,"allowedWork":["rail"]}
	var state: Dictionary = {"workers":[worker],"equipment":[equipment],"time":25200,"paused":true,"jobs":[],"costs":[],"notices":[],"orders":[]}
	ui.update_snapshot({"state":state,"storage":{"hasSave":true}})
	ui.show_tab("Equipment")
	ui.show_entity("EQ-9001")
	_check(_has_label(ui.inspector_body,"Control: Manual driving"),"Manual control appears near the top of the equipment inspector")
	_check(ui.tables[0].rows[0].cells[2]=="Manual driving","Equipment register shows control separately from allowed automatic work")
	var release: Button = _button(ui.inspector_body,"Return to automatic work")
	_check(release!=null,"Manual machine has a prominent automatic-work action")
	ui.controlled_worker=worker.id
	ui.active_tool="drive"
	release.pressed.emit()
	_check(actions[-1]=={"action":"release","args":{"id":"WRK-9001"}},"Equipment releases its real worker through one atomic command")
	_check(ui.controlled_worker.is_empty() and ui.active_tool=="select","Releasing clears direct-control selection and the driving tool")
	_check(ui.active_tab=="Equipment","Release does not close the equipment register")
	worker.duty="auto"
	ui.show_entity("EQ-9001")
	_check(_has_label(ui.inspector_body,"Control: Automatic"),"Automatic duty has a visible control indicator")
	_check(_button(ui.inspector_body,"Return to automatic work")==null,"Automatic machine does not suggest releasing nonexistent manual control")
	worker.duty="rest"
	ui.show_entity("EQ-9001")
	_check(_has_label(ui.inspector_body,"Control: Resting"),"A seated resting operator is distinguished from an automatic one")
	worker.erase("vehicle")
	ui.show_entity("EQ-9001")
	_check(_has_label(ui.inspector_body,"Control: No operator"),"An assigned worker who is not seated is not reported as an operator")
	_check(_button(ui.inspector_body,"Drive manually").disabled,"An unattended machine cannot enter the drive tool")
	worker.vehicle=equipment.id
	worker.duty="manual"
	equipment.deliveryOrder="PO-9001"
	state.orders=[{"id":"PO-9001","unloadPaused":true,"unload":{"equipmentId":"EQ-9001","operatorId":"WRK-9001","phase":"carry"}}]
	ui.show_entity("EQ-9001")
	ui.controlled_worker=worker.id
	ui._select_tool("drive")
	_check(ui.tool_label.text=="Manual driving · EQ-9001","Drive banner identifies the manually controlled vehicle")
	_check(ui.release_control_button.visible,"Drive banner includes an immediate release action")
	var before: int = actions.size()
	_button(ui.inspector_body,"Resume automatic unloading").pressed.emit()
	_check(actions.size()==before+1 and actions[-1].action=="release","Paused unloading resumes through the same single atomic release command")
	_check(ui.controlled_worker.is_empty() and ui.active_tool=="select" and not ui.release_control_button.visible,"Delivery resume clears both direct-control indicators")
	ui.show_entity("WRK-9001")
	ui.controlled_worker=worker.id
	ui._select_tool("drive")
	_button(ui.inspector_body,"Return to automatic duty").pressed.emit()
	_check(ui.controlled_worker.is_empty() and ui.active_tool=="select","Worker inspector also exits the drive tool on release")
	print("MANUAL_CONTROL_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"failures":failures,"commands":actions.size()}))
	quit(0 if failures.is_empty() else 1)
