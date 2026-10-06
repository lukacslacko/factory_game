extends SceneTree
## Native controls and physical buffer identities, without a JS service or GPU.
const UI=preload("res://scripts/game_ui.gd")
const W=preload("res://scripts/game_world.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:
		set_process(false)
		set_process_input(false)
class FakeClient:
	extends Node
	var sent:Array=[]
	func send(action:String,args:Dictionary)->int:
		sent.append({"action":action,"args":args})
		return sent.size()
var failures:Array[String]=[]
var checks:int=0
var actions:Array[Dictionary]=[]
var tools:Array[String]=[]
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
func _red_vertices(node:Node3D)->Array[Vector3]:
	var points:Array[Vector3]=[]
	for child in node.get_children():
		if child is MeshInstance3D and child.material_override is StandardMaterial3D:
			var material:StandardMaterial3D=child.material_override
			if material.albedo_color.is_equal_approx(Color("bb4835")):
				for surface in range(child.mesh.get_surface_count()):
					for point in child.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]:points.append(child.global_transform*point)
		if child is Node3D:points.append_array(_red_vertices(child))
	return points
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.buffers=[{"id":"BUFFER-001","x":125,"z":5,"y":.2,"yaw":0,"secured":true,"carried":false},{"id":"BUFFER-9002","x":95,"z":30,"y":.2,"yaw":PI/2,"secured":true,"carried":false,"source":"STK-9002"}]
	fixture.render.railOpenEndpoints=[{"id":"END:RAIL-9001:1","x":125,"z":5,"yaw":0,"trackId":"RAIL-9001","panelId":"RAIL-9001","route":"straight","occupiedBy":"BUFFER-001"},{"id":"END:RAIL-9002:1","x":150,"z":5,"yaw":0,"trackId":"RAIL-9002","panelId":"RAIL-9002","route":"straight","occupiedBy":""}]
	var ui:=UI.new();root.add_child(ui);ui.setup()
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.tool_selected.connect(func(kind:String)->void:tools.append(kind))
	ui.update_snapshot(fixture)
	ui.receive_reply({"action":"new_game","ok":true})
	_check(ui.catalog.has("bufferStop"),"Purchase catalog includes physical buffer stops")
	_check(_button(ui.screen,"Diverging switch")!=null and _button(ui.screen,"Converging switch")!=null,"Both switch directions have direct placement buttons")
	_check(_button(ui.screen,"Turnout")==null,"The ambiguous single Turnout button is removed")
	(ui.rail_tool_buttons["railConverging"] as Button).pressed.emit()
	_check(tools.back()=="railConverging" and ui.active_tool=="railConverging","Converging switch button selects its independent rail tool")
	_check((ui.rail_tool_buttons["railConverging"] as Button).button_pressed and not (ui.rail_tool_buttons["railTurnout"] as Button).button_pressed,"Selected switch tool has a visible active state")
	_check(ui.tool_label.text.begins_with("Converging switch"),"Construction banner clearly names the selected switch direction")
	ui.show_tab("Railway")
	_check(ui.tables.size()==5 and ui.tables[2].rows.size()==2 and ui.tables[3].rows.size()==2,"Railway register lists actual endpoints and independent buffers")
	var endpoints:Control=ui.tables[2]
	var endpoint_item:TreeItem=endpoints.tree.get_root().get_first_child().get_next()
	endpoint_item.select(0)
	endpoints._selected()
	_check(ui.selected_id=="END:RAIL-9002:1","Clicking a compound endpoint ID selects the endpoint instead of its embedded rail ID")
	_check(_button(ui.inspector_body,"Install buffer stop here")!=null,"Actual endpoint table selection exposes the direct install control")
	_check(endpoints.row_id_pattern.search("BUFFER-9002")!=null,"Every independently numbered buffer ID remains clickable in reference columns")
	ui.show_entity("END:RAIL-9002:1")
	var install:=_button(ui.inspector_body,"Install buffer stop here")
	_check(install!=null and not install.disabled,"Open endpoint exposes an installation action")
	if install:install.pressed.emit()
	_check(actions.back()=={"action":"plan_buffer","args":{"x":150.0,"z":5.0}},"Installation command uses the actual endpoint coordinates")
	ui.show_entity("END:RAIL-9001:1")
	install=_button(ui.inspector_body,"Install buffer stop here")
	_check(install!=null and install.disabled,"Occupied endpoint does not invite duplicate stops")
	ui.show_entity("BUFFER-9002")
	var remove:=_button(ui.inspector_body,"Remove and store buffer stop")
	_check(remove!=null and not remove.disabled,"Independent installed buffer opens its recovery inspector")
	if remove:remove.pressed.emit()
	_check(actions.back()=={"action":"remove_buffer","args":{"id":"BUFFER-9002"}},"Recovery keeps the chosen physical stop identity")
	fixture.state.buffers[1].carried=true;fixture.state.buffers[1].secured=false
	ui.update_snapshot(fixture);ui.show_entity("BUFFER-9002")
	remove=_button(ui.inspector_body,"Remove and store buffer stop")
	_check(remove!=null and remove.disabled,"Carried/unsecured buffer cannot create another recovery job")
	fixture.state.buffers[1].carried=false;fixture.state.buffers[1].secured=true
	var world:=W.new();root.add_child(world);world.setup();world.sync_snapshot(fixture)
	_check(world.statics.has("BUFFER-001") and world.statics.has("BUFFER-9002"),"All actual buffer assets render independently")
	_check(world.entity_position("END:RAIL-9002:1").is_equal_approx(Vector3(150,0,5)),"Endpoint Locate targets its actual track position")
	_check(world.statics.size()==2,"Legacy compatibility buffer does not create a duplicate model")
	_check(world.entity_position("BUFFER-9002").is_equal_approx(Vector3(95,.2,30)),"Second buffer uses its actual pose")
	_check(world.pick_ground(Vector3(95,0,30))=="BUFFER-9002","Buffer floor picking preserves stable asset identity")
	var camera:=Camera3D.new();root.add_child(camera);camera.position=Vector3(95,8,43);camera.look_at(Vector3(95,1,30));camera.current=true
	var click:=camera.unproject_position(Vector3(95,1.05,30))
	_check(world.pick_screen(camera,click)=="BUFFER-9002","Elevated buffer crossbar is clickable through analytical model bounds")
	var reused:int=world.statics["BUFFER-9002"].get_instance_id();world.sync_snapshot(fixture)
	_check(world.statics["BUFFER-9002"].get_instance_id()==reused,"Unchanged buffer models reuse native nodes")
	fixture.state.jobs.append({"id":"JOB-9001","item":"rail","kind":"rail","status":"doing","x":125,"z":4,"w":5,"d":2,"qty":1,"bufferId":"BUFFER-001"})
	fixture.render.railWork=[{"jobId":"JOB-9001","buffer":{"id":"BUFFER-001","x":130,"z":9,"y":.2,"yaw":0,"carried":false,"secured":false},"panel":{},"phase":"park-buffer"}]
	world.sync_snapshot(fixture)
	_check(not world.statics.has("BUFFER-001") and world.statics.has("BUFFER-9002"),"Moving one buffer suppresses only its static representation")
	_check(world.models.has("JOB-9001/buffer"),"Actual rail-work buffer pose renders during relocation")
	_check(world.models["JOB-9001/buffer"].get_meta("inspect_id")=="BUFFER-001","Moving buffer retains an inspectable physical identity")
	fixture.render.railWork=[];fixture.state.jobs=[];fixture.state.buffers.remove_at(1)
	fixture.state.stacks=[{"id":"STK-9002","item":"bufferStop","qty":1,"reserved":0,"x":93,"z":30,"w":2,"d":2,"assetId":"BUFFER-9002"}]
	world.sync_snapshot(fixture)
	_check(not world.statics.has("BUFFER-9002") and world.statics.has("STK-9002"),"Recovered buffer is a physical stock asset rather than a ghost installed stop")
	var stock:Node3D=world.statics["STK-9002"]
	_check(world._local_model_bounds(stock,Transform3D.IDENTITY).size.y<1.5,"Recovered stock uses the actual compact buffer model, not a generic tall kit")
	# The stored footprint is centered, while installation uses the actual
	# contact endpoint. Final clamping must not shift the visible crossbar.
	fixture.state.stacks=[]
	fixture.state.jobs=[{"id":"JOB-9003","kind":"bufferStop","item":"bufferStop","status":"doing","x":94,"z":29.5,"w":2,"d":2,"qty":1}]
	fixture.render.construction=[{"jobId":"JOB-9003","item":"bufferStop","qty":1,"state":"placed","pose":{"x":95,"z":30,"y":.2,"yaw":PI/2}}]
	world.sync_snapshot(fixture)
	_check(world.models.has("JOB-9003/handling"),"Buffer installation draws its actual contact-point handling pose")
	var before:Array[Vector3]=_red_vertices(world.models["JOB-9003/handling"])
	_check(not before.is_empty(),"Installation has a real visible buffer crossbar")
	fixture.render.construction=[];fixture.state.jobs=[]
	fixture.state.buffers.append({"id":"BUFFER-9002","x":95,"z":30,"y":.2,"yaw":PI/2,"secured":true,"carried":false})
	world.sync_snapshot(fixture)
	var after:Array[Vector3]=_red_vertices(world.statics["BUFFER-9002"])
	_check(before==after,"Fastening a buffer preserves all crossbar vertices without a final sideways jump")
	_check(not world.models.has("JOB-9003/handling"),"Finished buffer installation removes its temporary handling model")
	var main:=MainHarness.new();root.add_child(main);main.world=world;main.ui=ui;var client:=FakeClient.new();main.client=client;main.add_child(client);main.add_child(main.camera);main.add_child(main.sun)
	ui.tool_selected.connect(main._select_tool)
	main.placement_rotation=2;main.rail_hand=-1
	# Exercise the exact old failure: choose convergence, then another rail
	# tool, without moving the cursor or touching another hidden mode.
	for selection: Dictionary in [
		{"tool":"railConverging","layout":"turnout","flow":"converging"},
		{"tool":"railStraight","layout":"straight","flow":"diverging"},
		{"tool":"railCurve","layout":"curve","flow":"diverging"},
		{"tool":"railConverging","layout":"turnout","flow":"converging"},
		{"tool":"railTurnout","layout":"turnout","flow":"diverging"}]:
		(ui.rail_tool_buttons[selection.tool] as Button).pressed.emit()
		_check(main.tool==selection.tool,"Actual %s button updates the native placement tool"%selection.tool)
		main._placement_preview(Vector3(150,0,5));main._process(.2)
		var expected: Dictionary = {"layout":selection.layout,"flow":selection.flow,"x":150,"z":5,"heading":2,"hand":-1,"snap":true}
		_check(client.sent.back()=={"action":"rail_preview","args":expected},"%s preview uses only its own flow and keeps orientation"%selection.tool)
		main._place(Vector3(150,0,5),Vector3(150,0,5))
		_check(client.sent.back()=={"action":"plan_rail","args":expected},"%s placement matches the preview after convergence selection"%selection.tool)
		var pressed_count: int = 0
		for key: String in ui.rail_tool_buttons:
			if (ui.rail_tool_buttons[key] as Button).button_pressed: pressed_count+=1
		_check(pressed_count==1,"Only the selected %s placement button stays active"%selection.tool)
	ui._select_tool("select")
	_check(not (ui.rail_tool_buttons["railTurnout"] as Button).button_pressed and not (ui.rail_tool_buttons["railConverging"] as Button).button_pressed,"Selecting another tool clears both switch indicators")
	# Old saves contain only {x,z} in state.buffer. The bridge resolves
	# protected orientation/provenance without mutating the imported save.
	var legacy:Dictionary=fixture.duplicate(true)
	legacy.state.erase("buffers")
	legacy.state.buffer={"x":125,"z":5}
	legacy.render.buffers=[{"id":"BUFFER-001","x":125,"z":5,"y":.2,"yaw":PI,"secured":true,"carried":false,"source":"opening"}]
	ui.update_snapshot(legacy);ui.show_tab("Railway")
	_check(ui.tables[3].rows.size()==1 and ui.tables[3].rows[0].cells[2]=="Yes" and ui.tables[3].rows[0].cells[4]=="opening","Legacy buffer register uses bridge-resolved secured state and provenance")
	ui.show_entity("BUFFER-001")
	remove=_button(ui.inspector_body,"Remove and store buffer stop")
	_check(remove!=null and not remove.disabled,"Protected legacy buffer supports physical recovery through the inspector")
	world.sync_snapshot(legacy)
	_check(world.statics.has("BUFFER-001") and is_equal_approx(world.statics["BUFFER-001"].rotation.y,-PI),"Legacy buffer model uses resolved orientation instead of a default east-facing pose")
	_check(world._buffer_records()==legacy.render.buffers and ui._buffer_records()==legacy.render.buffers,"World and UI share the exact resolved legacy buffer assets")
	legacy.state.buffers=[]
	ui.update_snapshot(legacy);world.sync_snapshot(legacy)
	_check(ui._buffer_records().is_empty() and world._buffer_records().is_empty() and not world.statics.has("BUFFER-001"),"An explicit empty modern buffer array never resurrects a legacy stop")
	print("SWITCH_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
