extends SceneTree
## Settings UI without opening the player yard or starting the local service.
const UI=preload("res://scripts/game_ui.gd")
var failures:Array[String]=[]
var checks:int=0
var actions:Array[Dictionary]=[]

func _initialize()->void:_run.call_deferred()
func _check(ok:bool,label:String)->void:
	checks+=1
	if not ok:failures.append(label)
func _button(node:Node,title:String)->Button:
	if node is Button and node.text==title:return node
	for child:Node in node.get_children():
		var found:Button=_button(child,title)
		if found:return found
	return null

func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.automations={"supportWorkers":true,"vehicleRefueling":true,"fuelOrdering":true,"emptyBarrelCollection":true,"refuelAtPercent":25,"fuelReserveLiters":200,"fuelTargetLiters":400,"fuelDemandSeen":false}
	fixture.automationStatus={"storedLiters":0,"incomingLiters":0,"tankLiters":80,"lowEquipment":[],"lowShunters":[],"emptyBarrels":0,"shunterRequests":[]}
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args.duplicate(true)}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});await process_frame
	ui._switch_tab("Automations")
	_check(ui.automation_buttons.size()==4,"Crew and three consumable automation switches appear")
	for key:String in ["supportWorkers","vehicleRefueling","fuelOrdering","emptyBarrelCollection"]:
		_check(bool(ui.automation_buttons[key].button_pressed),"%s defaults on"%key)
	var crew:CheckButton=ui.automation_buttons["supportWorkers"]
	crew.toggled.emit(false)
	_check(actions.size()==1 and actions[0].action=="automation_configure" and actions[0].args.changes=={"supportWorkers":false},"Crew switch sends its saved policy")
	var fuel:CheckButton=ui.automation_buttons["fuelOrdering"]
	fuel.toggled.emit(false)
	_check(actions.size()==2 and actions[1].action=="automation_configure" and actions[1].args.changes=={"fuelOrdering":false},"Fuel switch sends only the changed saved policy")
	ui.automation_refuel_percent.value=30
	ui.automation_reserve_liters.value=250
	ui.automation_target_liters.value=600
	var apply:Button=_button(ui.register_body,"Apply thresholds")
	_check(apply!=null,"Numeric policy thresholds have an apply action")
	if apply:apply.pressed.emit()
	_check(actions.size()==3 and actions[2].args.changes=={"refuelAtPercent":30,"fuelReserveLiters":250,"fuelTargetLiters":600},"Thresholds are submitted atomically")
	_check(ui.automation_status_label.text.contains("Stored barrels: 0.0 L") and ui.automation_status_label.text.contains("first needs fuel"),"Site reserve and first-demand gate are explained")
	fixture.state.automations.fuelOrdering=false
	fixture.state.automations.supportWorkers=false
	fixture.state.automations.fuelDemandSeen=true
	fixture.automationStatus.lowEquipment=["EQ-0001"]
	fixture.automationStatus.shunterRequests=[{"id":"SH-0001","reason":"Park within 8 m of an available diesel barrel"}]
	ui.update_snapshot(fixture);ui._refresh_register();await process_frame
	_check(not ui.automation_buttons["fuelOrdering"].button_pressed,"Saved switch value refreshes from the yard")
	_check(not ui.automation_buttons["supportWorkers"].button_pressed,"Saved crew policy refreshes from the yard")
	_check(ui.automation_status_label.text.contains("EQ-0001") and ui.automation_status_label.text.contains("SH-0001 fuel request"),"Low vehicles and pending shunter service are visible")
	ui.queue_free();await process_frame
	print("CONSUMABLE_AUTOMATIONS_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
