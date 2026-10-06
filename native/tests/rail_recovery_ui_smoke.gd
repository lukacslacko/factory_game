extends SceneTree
## Verify commands against selected installed assets without starting the JS service.
const UI=preload("res://scripts/game_ui.gd")
class RecoveryWorld:
	extends "res://scripts/game_world.gd"
	# Exercise actual snapshot/load rendering without constructing unrelated terrain.
	func setup()->void:initialized=true
	func _sync_statics()->void:pass
	func _sync_paving()->void:pass
	func _sync_wear()->void:pass
	func _mask_vegetation()->void:pass
	func _update_selection(_rebuild:bool=true)->void:pass
	func set_dusk(_enabled:bool)->void:pass
var actions:Array[Dictionary]=[]
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _button(node:Node,text:String)->Button:
	if node is Button and node.text==text:return node
	for child in node.get_children():
		var found:=_button(child,text)
		if found:return found
	return null
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.rails=[
		{"id":"RAIL-9001","item":"rail","x":130,"z":5,"length":5,"rotation":0,"track":{"layout":"straight","groupId":"WORK-9001"}},
		{"id":"RAIL-9002","item":"railCurve","x":135,"z":5,"length":5,"rotation":0,"track":{"layout":"curve","groupId":"WORK-9002"}},
		{"id":"RAIL-9003","item":"railCurve","x":140,"z":5,"length":5,"rotation":0,"track":{"layout":"curve","groupId":"WORK-9002"}},
		{"id":"RAIL-9004","item":"railTurnout","x":145,"z":5,"length":5,"rotation":0,"selectedRoute":"straight","track":{"layout":"turnout","groupId":"WORK-9003"}},
		{"id":"RAIL-9005","item":"railExit","x":150,"z":5,"length":5,"rotation":0,"track":{"layout":"turnout","groupId":"WORK-9003"}},
		{"id":"BOOTSTRAP-SIDING","item":"rail","x":25,"z":5,"length":100,"rotation":0}
	]
	var ui:=UI.new();root.add_child(ui);ui.setup()
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"new_game","ok":true})
	ui.show_entity("RAIL-9001")
	var recover:=_button(ui.inspector_body,"Recover this rail panel")
	_check(recover!=null and not recover.disabled,"Installed straight panel has an enabled recovery control")
	if recover:recover.pressed.emit()
	_check(actions.back()=={"action":"remove_rail","args":{"id":"RAIL-9001","scope":"panel"}},"Single-panel recovery preserves the selected installed identity")
	_check(_button(ui.inspector_body,"Recover whole assembly (1 panels)")==null,"A lone straight panel does not show a redundant assembly operation")
	ui.show_entity("RAIL-9002")
	recover=_button(ui.inspector_body,"Recover whole curve (2 panels)")
	_check(recover!=null,"Curve inspector counts the installed panels in its assembly")
	if recover:recover.pressed.emit()
	_check(actions.back()=={"action":"remove_rail","args":{"id":"RAIL-9002","scope":"assembly"}},"Curve recovery explicitly sends assembly scope")
	ui.show_entity("RAIL-9005")
	recover=_button(ui.inspector_body,"Recover whole turnout (2 panels)")
	_check(recover!=null,"Any installed turnout section exposes its complete assembly recovery")
	if recover:recover.pressed.emit()
	_check(actions.back()=={"action":"remove_rail","args":{"id":"RAIL-9005","scope":"assembly"}},"Turnout recovery retains the selected section rather than guessing a different group")
	fixture.state.jobs=[{"id":"JOB-9101","kind":"remove","status":"todo","phase":"Awaiting equipment","reason":"","progress":0,"x":135,"z":5,"w":5,"d":2,"qty":1,"railRecovery":{"railId":"RAIL-9002","recoveredItem":"railCurve","buffers":["BUFFER-001"]}}]
	ui.update_snapshot(fixture);ui.show_entity("RAIL-9002")
	_check(_button(ui.inspector_body,"Recover this rail panel").disabled,"Pending panel recovery cannot be requested twice")
	_check(_button(ui.inspector_body,"Recover whole curve (2 panels)").disabled,"Assembly recovery cannot overlap existing member recovery")
	var open:=_button(ui.inspector_body,"Open recovery work")
	_check(open!=null,"The installed panel links directly to its pending recovery job")
	if open:open.pressed.emit()
	_check(ui.selected_id=="JOB-9101","Recovery link opens the actual work inspector for assignment and progress")
	ui.show_entity("RAIL-9003")
	_check(not _button(ui.inspector_body,"Recover this rail panel").disabled,"A different installed panel can still have its own recovery requested")
	_check(_button(ui.inspector_body,"Recover whole curve (2 panels)").disabled,"Selecting another curve member still protects the ongoing group operation")
	fixture.state.jobs[0].status="canceled"
	ui.update_snapshot(fixture);ui.show_entity("RAIL-9002")
	_check(not _button(ui.inspector_body,"Recover this rail panel").disabled,"Canceled recovery releases the panel for a new request")
	ui.show_entity("BOOTSTRAP-SIDING")
	_check(_button(ui.inspector_body,"Recover this rail panel")==null,"Protected starter infrastructure cannot request recovery through the inspector")
	var help:String="\n".join(ui._rail_help_paragraphs())
	_check(help.contains("worker unfastens") and help.contains("stockyard storage"),"Help explains physical recovery instead of instant material deletion")
	_check(help.contains("Replace straight track with a switch") and help.contains("newly exposed endpoint"),"Help describes the requested replacement workflow")
	_check(help.contains("Rail layouts can form loops") and help.contains("opposite directions") and help.contains("supplier reception remains restricted"),"Loop help distinguishes physical endpoint connections from the available supplier reception")
	_check(help.contains("not available in this checkpoint"),"Recovery help does not claim the planned shunting controls exist")
	var world:=RecoveryWorld.new();root.add_child(world)
	var carried:Dictionary={"state":{"jobs":[{"id":"JOB-9201","kind":"remove","item":"railCurve","status":"doing","railRecovery":{"railId":"RAIL-9201"}}]},"render":{"railWork":[{"jobId":"JOB-9201","phase":"stage-travel","configuredHand":-1,"panel":{"x":135,"z":20,"y":.65,"yaw":0,"state":"carried"}}]}}
	world.sync_snapshot(carried)
	_check(world.models.has("JOB-9201/panel") and str(world.models["JOB-9201/panel"].get_meta("load_key",""))=="railCurve/1/-1/false","Recovered left-hand curve stays left-handed while carried without construction-track metadata")
	var left_id:int=world.models["JOB-9201/panel"].get_instance_id()
	world.sync_snapshot(carried)
	_check(world.models["JOB-9201/panel"].get_instance_id()==left_id,"Unchanged physical hand reuses the carried panel model")
	carried.render.railWork[0].configuredHand=1
	world.sync_snapshot(carried)
	_check(str(world.models["JOB-9201/panel"].get_meta("load_key",""))=="railCurve/1/1/false" and world.models["JOB-9201/panel"].get_instance_id()!=left_id,"A physical hand configuration change updates the actual carried geometry")
	carried.render.railWork[0].erase("configuredHand")
	carried.state.jobs[0].track={"hand":-1}
	world.sync_snapshot(carried)
	_check(str(world.models["JOB-9201/panel"].get_meta("load_key",""))=="railCurve/1/-1/false","Legacy rendering snapshots still honor the construction track's hand")
	print("RAIL_RECOVERY_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
