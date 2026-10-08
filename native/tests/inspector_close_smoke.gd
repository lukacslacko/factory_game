extends SceneTree
## Real GUI press/release and snapshot refresh, without a service or GPU scene.
const UI=preload("res://scripts/game_ui.gd")
var failures:Array[String]=[]
var checks:int=0
var selections:Array[String]=[]
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
func _mouse(position:Vector2,pressed:bool)->void:
	var event:=InputEventMouseButton.new()
	event.button_index=MOUSE_BUTTON_LEFT
	event.position=position
	event.global_position=position
	event.pressed=pressed
	event.button_mask=MOUSE_BUTTON_MASK_LEFT if pressed else 0
	root.push_input(event,true)
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.orders=[{"id":"PO-9001","item":"slab","qty":8,"mode":"truck","status":"done"},{"id":"PO-9002","mode":"rail","status":"unloading","railFreight":{"locomotiveId":"LOCO-9002","cars":[{"id":"CAR-9002","kind":"flatcar","manifest":[{"item":"slab","qty":8,"arrived":0}]}],"storageZoneId":"ZONE-9001","unloadRequested":false}}]
	fixture.state.zones=[{"id":"ZONE-9001","label":"Test stockyard","x":30,"z":20,"w":10,"d":10}]
	var ui:=UI.new();root.add_child(ui);ui.setup()
	ui.entity_selected.connect(func(id:String)->void:
		selections.append(id)
		# Main's selection handler echoes the new selection back to the UI.
		ui.show_entity(id))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true})
	ui.show_entity("")
	_check(ui._entity("").is_empty(),"Empty selection never resolves to a road order's missing locomotive")
	_check(not ui.inspector.visible,"No panel appears without a selected ID")
	ui.show_entity("LOCO-9002")
	_check(ui.inspector.visible,"A real supplier locomotive remains inspectable")
	ui.show_entity("PO-9001")
	await process_frame;await process_frame
	var close:=_button(ui.inspector,"×")
	_check(close!=null,"Delivery inspector exposes close button")
	var center:=close.get_global_rect().get_center()
	_mouse(center,true)
	await process_frame
	_check(close.is_pressed(),"Viewport mouse-down actually presses the close button")
	ui.update_snapshot(fixture)
	ui._process(0.8)
	_check(is_instance_valid(close) and close.is_inside_tree() and not close.is_queued_for_deletion(),"Snapshot refresh retains a button between pointer press and release")
	_mouse(center,false)
	await process_frame;await process_frame
	_check(ui.selected_id.is_empty() and not ui.inspector.visible,"Click closes panel and clears selection, including main's selection feedback")
	_check(selections==[""],"Close emits one empty selection to clear the world highlight")
	ui.update_snapshot(fixture);ui._process(0.8)
	_check(not ui.inspector.visible,"Later snapshots do not reopen a dismissed inspector")
	ui.show_tab("Deliveries");ui._user_entity("PO-9002")
	_check(not ui._editing(ui.register_panel),"Selected tab toggle does not suppress ongoing register updates")
	_check(ui.inspector.visible and ui.selected_id=="PO-9002","New user selection reopens the inspector normally")
	var start:=_button(ui.inspector,"Start unloading")
	_check(start!=null and not start.disabled,"Stopped train with an applied stockyard offers Start unloading")
	ui.show_entity("");ui.show_tab("Yard")
	_check(not ui.inspector.visible,"Changing tabs retains the cleared selection")
	print("INSPECTOR_CLOSE_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
