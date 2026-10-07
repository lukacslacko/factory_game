extends SceneTree
## Exercise production native freight controls, selectable cars, IDs, and help.
const UI = preload("res://scripts/game_ui.gd")
var failures: Array[String] = []
var checks: int = 0
var actions: Array[Dictionary] = []
func _initialize() -> void:_run.call_deferred()
func _check(value: bool,text: String) -> void:
	checks+=1
	if not value:failures.append(text)
func _button(node: Node,text: String) -> Button:
	if node is Button and node.text==text:return node
	for child: Node in node.get_children():
		var found: Button = _button(child,text)
		if found:return found
	return null
func _nodes(node: Node,type: String) -> Array:
	var result: Array = []
	if node.get_class()==type:result.append(node)
	for child: Node in node.get_children():result.append_array(_nodes(child,type))
	return result
func _choose(options: Array,id: String) -> OptionButton:
	for option: OptionButton in options:
		for index: int in option.item_count:
			if str(option.get_item_metadata(index))==id:
				option.selected=index;option.item_selected.emit(index);return option
	return null
func _window(ui: Node,title: String) -> Window:
	for node: Node in ui.find_children("*","Window",true,false):
		if node.title==title:return node
	return null
func _run() -> void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.workers=[{"id":"WRK-9001","name":"Worker #1","role":"operator","status":"idle"},{"id":"WRK-9002","name":"Worker #2","role":"builder","status":"idle"}]
	fixture.state.zones=[{"id":"ZONE-9001","name":"East storage","x":70,"z":16,"w":20,"d":20}]
	fixture.state.railLocations=[{"id":"RLOC-9001","name":"Reception","kind":"unloading","trackId":"BOOTSTRAP-SIDING","route":"straight","offset":50,"length":70},{"id":"RLOC-9002","name":"Plant loading track","kind":"unloading","trackId":"RAIL-9010","route":"straight","offset":20,"length":40}]
	fixture.state.shunters=[{"id":"SHUNTER-9001","name":"Yard engine","status":"idle","driverId":"WRK-9001","x":115,"z":5,"fuel":160,"tank":200,"used":2}]
	var order: Dictionary = {"id":"ORD-9001","item":"slab","qty":20,"arrived":0,"mode":"rail","status":"unloading","eta":39000,"total":2000,"vehicle":{"x":80,"z":5},"manifest":[{"item":"slab","qty":20,"arrived":0}],"railFreight":{"locomotiveId":"LOCO-9001","receptionLocationId":"RLOC-9001","storageZoneId":"ZONE-9001","unloadRequested":false,"detached":false,"locomotivePhase":"attached","cars":[{"id":"CAR-9001","length":16.8,"mass":2800,"locationId":"RLOC-9001","manifest":[{"item":"slab","qty":10,"arrived":0}]},{"id":"CAR-9002","length":16.8,"mass":2800,"locationId":"RLOC-9001","manifest":[{"item":"slab","qty":10,"arrived":0}]}]}}
	fixture.state.orders=[order]
	fixture.state.railReturns=[]
	var ui := UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action: String,args: Dictionary) -> void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.show_tab("Railway")
	await process_frame;await process_frame
	_check(ui.tables.size()==8,"Railway shows owned locomotives beside freight and track registers")
	_check(ui.tables[5].get_global_rect().end.y<=ui.register_panel.get_global_rect().end.y,"The final shunter table fits the 810-pixel information panel")
	_check(ui.tables[5].rows[0].cells[0]=="SHUNTER-9001","Owned shunter ID is shown in the real table")
	_check(ui.tables[5].row_id_pattern.search("SHUNTER-9001")!=null and ui.tables[5].row_id_pattern.search("RETURN-9001")!=null,"Owned engine and return-train IDs are recognized as navigable")
	_button(ui.register_body,"+ Yard access switch").pressed.emit()
	await process_frame
	var access_window := _window(ui,"Factory yard access switch")
	_check(access_window!=null and access_window.visible,"The yard access switch has a real placement form")
	var access_fields: Array = _nodes(access_window,"SpinBox")
	_check(access_fields.size()==1 and access_fields[0].value==80 and access_fields[0].step==5,"Access switch starts at E80 with five-meter placement increments")
	access_fields[0].value=70
	_button(access_window,"Plan yard access switch").pressed.emit()
	_check(actions.back()=={"action":"rail_access_plan","args":{"x":70.0}},"Internal siding switch construction uses the chosen location")
	await process_frame
	_button(ui.register_body,"Build siding exit").pressed.emit()
	_check(actions.back()=={"action":"rail_exit_plan","args":{}},"Exit construction action plans the rail connection")
	ui.show_entity("ORD-9001")
	var release := _button(ui.inspector_body,"Release supplier locomotive")
	_check(release!=null and not release.disabled,"A stopped attached train exposes locomotive release")
	release.pressed.emit()
	_check(actions.back()=={"action":"rail_detach","args":{"orderId":"ORD-9001"}},"Release targets the correct supplier delivery")
	_check(_button(ui.inspector_body,"Shunt selected cars").disabled,"Attached cars cannot be moved before engine release")
	order.railFreight.detached=true;order.railFreight.locomotivePhase="leaving";ui.show_entity("ORD-9001")
	_choose(_nodes(ui.inspector_body,"OptionButton"),"SHUNTER-9001");_choose(_nodes(ui.inspector_body,"OptionButton"),"RLOC-9002")
	_check(_button(ui.inspector_body,"Shunt selected cars").disabled,"Cars wait until the supplier locomotive has actually left")
	order.railFreight.locomotivePhase="gone";ui.show_entity("ORD-9001")
	_check(not _button(ui.inspector_body,"Shunt selected cars").disabled,"Remembered shunter and named destination remain selected after live refresh")
	var car_checks: Array = _nodes(ui.inspector_body,"CheckBox")
	_check(car_checks.size()==2,"Individual cars can be selected with checkboxes")
	car_checks[1].button_pressed=false
	_button(ui.inspector_body,"Shunt selected cars").pressed.emit()
	_check(actions.back()=={"action":"rail_shunt","args":{"orderId":"ORD-9001","carIds":["CAR-9001"],"shunterId":"SHUNTER-9001","railLocationId":"RLOC-9002"}},"Shunt passes selected car IDs, locomotive, and custom named destination")
	_button(ui.inspector_body,"Start unloading").pressed.emit()
	_check(actions.back()=={"action":"begin_rail_unloading","args":{"orderId":"ORD-9001","carIds":["CAR-9001"]}},"Unloading can target one selected car rather than the complete train")
	ui.show_entity("ORD-9001")
	_check(ui._selected_freight_cars(order)==["CAR-9001"],"Car selection survives inspector rebuilds")
	car_checks=_nodes(ui.inspector_body,"CheckBox");car_checks[0].button_pressed=false
	_check(_button(ui.inspector_body,"Start unloading").disabled and _button(ui.inspector_body,"Shunt selected cars").disabled,"Empty selection disables both freight operations")
	order.railFreight.unloadRequested=true;ui.show_entity("ORD-9001")
	var pause_button := _button(ui.inspector_body,"Pause unloading after current lift")
	_check(pause_button!=null and not pause_button.disabled,"An active unloading request can be stopped without abandoning its physical lift")
	pause_button.pressed.emit()
	_check(actions.back()=={"action":"pause_rail_unloading","args":{"orderId":"ORD-9001"}},"Pause dispatches the explicit rail unloading command")
	order.railFreight.unloadRequested=false
	order.unload={"phase":"rig"};ui.show_entity("ORD-9001")
	_check(_button(ui.inspector_body,"Apply rail freight destinations").disabled and _button(ui.inspector_body,"Shunt selected cars").disabled,"An ongoing physical lift cannot be rerouted or moved by shunting")
	order.erase("unload");order.railFreight.cars[0].locationId="RLOC-9002";ui.show_tab("Railway");ui._refresh_register()
	_check(ui.tables[4].rows[0].cells[2]=="Plant loading track","The freight register follows the car's current named location after transfer")
	ui.show_entity("SHUNTER-9001")
	_check(_button(ui.inspector_body,"Apply shunter driver")!=null,"A clicked shunter opens its driver controls")
	var drivers: Array = _nodes(ui.inspector_body,"OptionButton")
	_check((drivers[0] as OptionButton).item_count==2,"Only equipment operators appear as shunter drivers")
	_button(ui.inspector_body,"Apply shunter driver").pressed.emit()
	_check(actions.back()=={"action":"shunter_driver","args":{"shunterId":"SHUNTER-9001","workerId":"WRK-9001"}},"Apply driver targets this owned locomotive and worker")
	_choose(drivers,"RLOC-9002");_button(ui.inspector_body,"Drive shunter to named location").pressed.emit()
	_check(actions.back()=={"action":"shunter_park","args":{"shunterId":"SHUNTER-9001","railLocationId":"RLOC-9002"}},"Parking drives the locomotive to a chosen connected named point")
	_button(ui.inspector_body,"Refuel stopped shunter").pressed.emit()
	_check(actions.back()=={"action":"shunter_refuel","args":{"shunterId":"SHUNTER-9001"}},"Owned locomotive has an explicit refueling action")
	ui._shunter_order_form();await process_frame
	var window := _window(ui,"Order owned diesel shunter")
	_check(window!=null and window.visible,"The order dialog is visible and describes real rail delivery")
	_choose(_nodes(window,"OptionButton"),"WRK-9001");_button(window,"Order shunter").pressed.emit()
	_check(actions.back()=={"action":"shunter_order","args":{"driverId":"WRK-9001"}},"Ordering owns a persistent locomotive with an optional driver")
	await process_frame
	for car: Dictionary in order.railFreight.cars:car.manifest[0].arrived=car.manifest[0].qty
	ui._return_train_form("ORD-9001");await process_frame
	window=_window(ui,"Collect empty return train")
	_check(window!=null and not _button(window,"Request mainline locomotive").disabled,"Empty detached deliveries can be selected for supplier collection")
	_choose(_nodes(window,"OptionButton"),"RLOC-9001");_button(window,"Request mainline locomotive").pressed.emit()
	_check(actions.back()=={"action":"rail_return","args":{"orderIds":["ORD-9001"],"railLocationId":"RLOC-9001"}},"Collection requests an empty return train at the chosen receiving point")
	await process_frame
	fixture.state.railReturns=[{"id":"RETURN-9001","locomotiveId":"LOCO-9011","orderIds":["ORD-9001"],"carIds":["CAR-9001","CAR-9002"],"phase":"coupling","status":"Coupling return cars"}]
	ui.update_snapshot(fixture);ui.show_tab("Deliveries")
	_check(ui.tables.size()==2 and ui.tables[1].rows.size()==1,"Deliveries shows the actual empty return train lifecycle")
	ui.show_entity("LOCO-9011")
	_check(_button(ui.inspector_body,"Open empty return train")!=null,"The collection locomotive identity opens the return consist")
	_button(ui.inspector_body,"Open empty return train").pressed.emit()
	_check(ui.selected_id=="RETURN-9001","Collection engine links to its actual outgoing train")
	ui.show_entity("RETURN-9001")
	_check(ui.inspector.visible,"An outgoing train ID opens its own linked inspector")
	order.railFreight.cars[0].returned=true;ui.show_tab("Railway")
	_check(ui.tables[4].rows.size()==1,"Returned cars are removed from the on-site freight register")
	var help: String = "\n".join(ui._rail_help_paragraphs())
	_check(help.contains("+ Yard access switch") and help.contains("Build siding exit") and help.contains("Release supplier locomotive") and help.contains("Shunt selected cars") and help.contains("Collect empty cars"),"Simple in-game help describes the complete release, shunt, unload, and return workflow")
	ui.queue_free();await process_frame
	print("SHUNTING_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
