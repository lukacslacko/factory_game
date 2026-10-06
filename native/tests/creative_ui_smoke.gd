extends SceneTree
const UI=preload("res://scripts/game_ui.gd")
var actions:Array[Dictionary]=[]
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var ui:=UI.new();root.add_child(ui);ui.setup()
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture)
	_check(not ui.creative_button.button_pressed,"Normal mode is the default")
	ui.creative_button.button_pressed=true
	_check(actions.back()=={"action":"creative","args":{"enabled":true}},"Creative toggle sends the authoritative mode command")
	fixture.state.creative=true;ui.update_snapshot(fixture)
	_check(ui.creative_button.button_pressed,"Saved creative mode is reflected in the toggle")
	_check(ui.summary_label.text.begins_with("CREATIVE"),"Mode stays visible in the status bar")
	var count:int=actions.size();ui.update_snapshot(fixture)
	_check(actions.size()==count,"Snapshots do not send recursive mode commands")
	ui.creative_button.button_pressed=false
	_check(actions.back()=={"action":"creative","args":{"enabled":false}},"Normal construction can be restored with one click")
	_check(ui.creative_button.tooltip_text.contains("foundations"),"Placement bypass and foundation behavior are explained")
	print("CREATIVE_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
