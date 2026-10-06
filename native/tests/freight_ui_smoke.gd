extends SceneTree
## Actual native freight controls and ID navigation, without a service or GPU.
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
	for child in node.get_children():
		var found:=_button(child,text)
		if found:return found
	return null
func _choose(option:OptionButton,id:String)->void:
	for index in option.item_count:
		if str(option.get_item_metadata(index))==id:option.selected=index;return
func _run()->void:
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.zones=[{"id":"ZONE-9001","name":"Rail cargo stockyard","x":34,"z":15,"w":20,"d":16}]
	fixture.state.railLocations=[
		{"id":"RLOC-9001","name":"Receiving East","kind":"unloading","trackId":"BOOTSTRAP-SIDING","route":"straight","offset":50,"length":60},
		{"id":"RLOC-9002","name":"Future shunting dock","kind":"unloading","trackId":"RAIL-9001","route":"straight","offset":2,"length":5},
		{"id":"RLOC-9003","name":"Locomotive parking","kind":"parking","trackId":"BOOTSTRAP-SIDING","route":"straight","offset":20,"length":20}]
	var order:Dictionary={"id":"ORD-9001","item":"slab","qty":180,"arrived":4,"mode":"rail","status":"ordered","eta":39000,"note":"Waiting for arrival","total":7080,"vehicle":{"x":-75,"z":0},"manifest":[{"item":"slab","qty":180,"arrived":4}],"railFreight":{"locomotiveId":"LOCO-9001","receptionLocationId":"RLOC-9001","storageZoneId":"ZONE-9001","unloadRequested":false,"cars":[
		{"id":"CAR-9001","length":16.8,"centerOffset":13.4,"mass":25200,"manifest":[{"item":"slab","qty":90,"arrived":4,"orderLineIndex":0}]},
		{"id":"CAR-9002","length":16.8,"centerOffset":31.0,"mass":25200,"manifest":[{"item":"slab","qty":90,"arrived":0,"orderLineIndex":0}]}]}}
	fixture.state.orders=[order]
	var ui:=UI.new();root.add_child(ui);ui.setup()
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true})
	ui.show_tab("Railway")
	await process_frame
	await process_frame
	_check(ui.tables[4].get_global_rect().end.y<=ui.register_panel.get_global_rect().end.y,"All five freight/track registers remain inside the actual information panel")
	_check(ui.tables.size()==5,"Railway adds a freight-car register while retaining existing four registers")
	_check(ui.tables[4].rows.size()==2,"Both cars of one supplier train appear individually")
	_check(ui.tables[4].rows[0].cells[2]=="Receiving East","Car records show the named reception instead of an opaque ID")
	_check(ui.tables[4].rows[0].cells[4]=="24.08 t","Remaining car mass reflects its actual unloaded quantity")
	var first:TreeItem=ui.tables[4].tree.get_root().get_first_child()
	first.select(0);ui.tables[4]._selected()
	_check(ui.selected_id=="CAR-9001","Selecting a car ID opens that actual car inspector")
	var controls:=_button(ui.inspector_body,"Open train delivery controls")
	_check(controls!=null,"Car inspector links back to the complete train delivery")
	if controls:controls.pressed.emit()
	_check(ui.selected_id=="ORD-9001","Linked car controls select the train order")
	var start:=_button(ui.inspector_body,"Start unloading")
	_check(start!=null and start.disabled,"Unloading cannot be requested while train is still ordered")
	var apply:=_button(ui.inspector_body,"Apply rail freight destinations")
	_check(apply!=null and not apply.disabled,"Destinations can be configured before approach")
	if apply:apply.pressed.emit()
	_check(actions.back()=={"action":"configure_rail_freight","args":{"orderId":"ORD-9001","railLocationId":"RLOC-9001","storageZoneId":"ZONE-9001"}},"Apply preserves the explicit named point and chosen stockyard")
	order.status="unloading";ui.update_snapshot(fixture);ui.show_entity("ORD-9001")
	start=_button(ui.inspector_body,"Start unloading")
	_check(start!=null and not start.disabled,"A stopped train with an applied stockyard has a Start unloading action")
	if start:start.pressed.emit()
	_check(actions.back()=={"action":"begin_rail_unloading","args":{"orderId":"ORD-9001"}},"Start unloading uses the whole linked train order")
	apply=_button(ui.inspector_body,"Apply rail freight destinations")
	if apply:apply.pressed.emit()
	_check(actions.back().args.get("railLocationId")=="RLOC-9001","Stockyard changes after arrival preserve the locked receiving point")
	order.unload={"phase":"rig","equipmentId":"EQ-9001"};ui.show_entity("ORD-9001")
	apply=_button(ui.inspector_body,"Apply rail freight destinations")
	_check(apply!=null and apply.disabled,"The destination cannot be changed in the middle of an ongoing lift")
	order.erase("unload");order.railFreight.erase("storageZoneId");ui.show_entity("ORD-9001")
	start=_button(ui.inspector_body,"Start unloading")
	_check(start!=null and start.disabled,"Choose and apply an explicit destination stockyard before unloading")
	ui.show_entity("LOCO-9001")
	_check(_button(ui.inspector_body,"Open train delivery controls")!=null,"Supplier locomotive identity is clickable and links to its train")
	ui.show_purchase();ui.purchase_mode.selected=1;ui.purchase_mode.item_selected.emit(1)
	_check(ui.purchase_rail_controls.visible,"Rail mode reveals reception and stockyard fields")
	_check(ui.purchase_reception.item_count==2,"Reception options exclude custom shunting docks and parking designations")
	_choose(ui.purchase_reception,"RLOC-9001");_choose(ui.purchase_stockyard,"ZONE-9001")
	ui.purchase_quantity.slab.value=180
	ui.purchase_quantity.slab.get_line_edit().text="180"
	ui._place_purchase()
	_check(actions.back()=={"action":"purchase_batch","args":{"lines":[{"item":"slab","qty":180}],"mode":"rail","railLocationId":"RLOC-9001","storageZoneId":"ZONE-9001"}},"One multi-car batch order carries the chosen receiving point and storage target")
	ui.receive_reply({"action":"purchase_preview","ok":true,"result":{"loads":[{"mode":"rail"},{"mode":"rail"}],"mass":50400,"railCars":2,"trainLength":43.7,"transportCost":240}})
	_check(ui.purchase_total.text.contains("2 rail cars") and ui.purchase_total.text.contains("43.7 m train"),"Preview reports total connected cars and train length")
	_check(ui.tables[4].row_id_pattern.search("CAR-9002")!=null and ui.tables[4].row_id_pattern.search("RLOC-9001")!=null and ui.tables[4].row_id_pattern.search("LOCO-9001")!=null,"Rail car, reception, and locomotive IDs are all navigable references")
	ui.show_tab("Help")
	_check(ui.active_tab=="Help" and not ui.inspector.visible and ui.register_panel.offset_right==0,"The in-game help page uses the full information panel")
	var text:String="\n".join(ui._rail_help_paragraphs())
	_check(text.contains("Start unloading") and text.contains("BOOTSTRAP-SIDING") and text.contains("not available in this checkpoint"),"Simple help paragraphs explain working controls and clearly label future shunting")
	_check(_button(ui.register_body,"Back to Railway")!=null,"Help has a direct return to Railway")
	ui.show_tab("Yard");ui._menu_action(11)
	_check(ui.active_tab=="Help","The game menu can open the rail-management help page")
	print("FREIGHT_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
