extends SceneTree
## Production Process register and inspectors, exercised without service or GPU.
const UI=preload("res://scripts/game_ui.gd")
const ProcessUI=preload("res://scripts/process_ui.gd")
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
	for child:Node in node.get_children():
		var found:Button=_button(child,text)
		if found:return found
	return null
func _press(node:Node,text:String)->void:
	var button:Button=_button(node,text)
	_check(button!=null,"Production control exists: "+text)
	if button:button.pressed.emit()
func _nodes(node:Node,type:String)->Array:
	var result:Array=[]
	if node.get_class()==type:result.append(node)
	for child:Node in node.get_children():result.append_array(_nodes(child,type))
	return result
func _text(node:Node)->String:
	var value:String=str(node.text) if node is Label or node is RichTextLabel else ""
	for child:Node in node.get_children():value+="\n"+_text(child)
	return value
func _choose(node:Node,id:String)->OptionButton:
	for option:OptionButton in _nodes(node,"OptionButton"):
		for index:int in option.item_count:
			if str(option.get_item_metadata(index))==id:option.selected=index;option.item_selected.emit(index);return option
	return null
func _window(ui:Node,title:String)->Window:
	for node:Node in ui.find_children("*","Window",true,false):
		if node.title==title:return node
	return null
func _building(id:String,kind:String,w:int=1,d:int=1)->Dictionary:return {"id":id,"kind":kind,"x":70,"z":15,"w":w,"d":d,"rotation":0,"componentIds":{"base":id+"/base"}}
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.buildings=[_building("BLD-1001","processTank",4,4),_building("BLD-1002","processTank",4,4),_building("BLD-1003","transferPump",2,2),_building("BLD-1004","processValve"),_building("BLD-1005","processGauge"),_building("BLD-1006","processPipe")]
	fixture.state.workers=[{"id":"WRK-1001","name":"Worker #1","role":"builder","status":"Connect transfer hose","processAssignment":"PROCESS-1001"}]
	fixture.state.orders=[{"id":"ORD-1001","item":"bulkWater","qty":20000,"arrived":0,"status":"unloading","mode":"rail","railFreight":{"cars":[{"id":"CAR-1001","kind":"tanker","length":16.8,"manifest":[],"tank":{"product":"bulkWater","liters":20000,"capacity":30000}},{"id":"CAR-1002","kind":"flatcar","manifest":[]},{"id":"CAR-1003","kind":"tanker","returned":true,"manifest":[],"tank":{"product":"bulkWater","liters":0,"capacity":30000}}]}}]
	fixture.process={"tanks":[{"id":"BLD-1001","product":"bulkWater","liters":20000,"capacity":30000,"ports":["W","E","N","S"],"status":"Ready"},{"id":"BLD-1002","product":"bulkDiesel","liters":400,"capacity":30000,"ports":["W","E","N","S"],"status":"Ready"}],"pumps":[{"id":"BLD-1003","carId":"CAR-1001","tankId":"BLD-1001","connectedTo":["BLD-1006"],"route":["BLD-1003","BLD-1006","BLD-1001"],"installedRoute":["BLD-1003","BLD-1006","BLD-1001"],"rate":5,"enabled":false,"hose":"connected","flow":0,"transferred":250,"status":"Stopped"}],"lines":[{"id":"BLD-1006","kind":"processPipe","product":"bulkWater","liters":7.854,"capacity":7.854,"ports":["W","E"],"status":"Filled"}],"valves":[{"id":"BLD-1004","open":false,"operation":"PROCESS-1001","status":"Closed"}],"gauges":[{"id":"BLD-1005","product":"bulkWater","liters":7.854,"level":20000,"capacity":30000,"flow":0,"reading":0,"direction":"Stopped","calibrated":true,"status":"Connected"}],"operations":[{"id":"PROCESS-1001","kind":"connect","buildingId":"BLD-1003","carId":"CAR-1001","workerId":"WRK-1001","phase":"at-car","clock":2,"status":"Connect hose"}]}
	fixture.process.lines.append({"id":"BLD-1004","kind":"processValve","liters":0,"capacity":7.854})
	fixture.process.lines.append({"id":"BLD-1005","kind":"processGauge","liters":7.854,"capacity":7.854})
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.tool_selected.connect(func(kind:String)->void:tools.append(kind))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.show_tab("Process")
	await process_frame;await process_frame
	_check(ui.tables.size()==8,"Process has dense tanks, pumps, pipes, valves, gauges and ground-work registers")
	_check(ui.tables[0].rows.size()==2 and ui.tables[1].rows.size()==1 and ui.tables[5].rows.size()==1,"Production metadata reaches all process tables")
	for i:int in ProcessUI.KINDS.size():
		ui.show_tab("Process")
		_press(ui.register_body,ProcessUI.LABELS[i])
		_check(ui.active_tool==ProcessUI.KINDS[i] and tools.back()==ProcessUI.KINDS[i] and ui.active_tab=="Yard","Process placement button selects "+ProcessUI.KINDS[i]+" and returns to the yard")
	ui.show_tab("Process")
	var table:Control=ui.tables[0]
	table.tree.column_title_clicked.emit(0,MOUSE_BUTTON_LEFT);table.tree.column_title_clicked.emit(0,MOUSE_BUTTON_LEFT)
	_check(table.sort_column==0 and table.descending and table.tree.get_root().get_first_child().get_text(0)=="BLD-1002","Process headers sort the visible register in both directions")
	table.show_filters(true);table.filters[1].text="Process water";table.filters[1].text_changed.emit("Process water")
	_check(table.tree.get_root().get_child_count()==1 and table.tree.get_root().get_first_child().get_text(0)=="BLD-1001","Per-column filters narrow process records")
	table.filters[1].text="";table.set_search("BLD-1002")
	_check(table.tree.get_root().get_child_count()==1 and table.tree.get_root().get_first_child().get_text(0)=="BLD-1002","Dense process tables support text search")
	table.set_search("")
	var pump_row:TreeItem=ui.tables[1].tree.get_root().get_first_child();pump_row.select(1);ui.tables[1]._selected()
	_check(ui.selected_id=="CAR-1001","A pump's source car ID opens the actual tanker record")
	ui.show_entity("BLD-1001")
	_check(_text(ui.inspector_body).contains("20000.00 / 30000 L") and _text(ui.inspector_body).contains("Process water"),"Tank inspector shows real contents, capacity, product and components")
	ui.show_entity("BLD-1003")
	_check(_text(ui.inspector_body).contains("BLD-1006") and _text(ui.inspector_body).contains("Installed route"),"Pump inspector links actual installed pipe route")
	_check(_choose(ui.inspector_body,"BLD-1002")!=null,"Pump destination lists the installed storage tanks")
	var rates:Array=_nodes(ui.inspector_body,"SpinBox")
	_check(rates.size()==1 and is_equal_approx(rates[0].max_value,5.),"Transfer rate control stays within the real5L/s pump capability")
	if not rates.is_empty():rates[0].value=2.5
	_press(ui.inspector_body,"Apply destination and rate")
	_check(actions.back()=={"action":"process_configure","args":{"id":"BLD-1003","tankId":"BLD-1002","rate":2.5,"direction":"unload"}},"Pump configuration sends chosen tank and exact transfer rate")
	var car:OptionButton=_choose(ui.inspector_body,"CAR-1001")
	_check(car!=null and car.item_count==2,"Hose source choices include stopped tankers and exclude flatcars and returned cars")
	_press(ui.inspector_body,"Request worker to connect hose")
	_check(actions.back()=={"action":"process_connect","args":{"id":"BLD-1003","carId":"CAR-1001"}},"Hose connection is an explicit worker operation bound to the selected car")
	_press(ui.inspector_body,"Start pump")
	_check(actions.back()=={"action":"process_run","args":{"id":"BLD-1003","running":true}},"Start control sends an explicit pump request")
	fixture.process.pumps[0].enabled=true;ui.show_entity("BLD-1003")
	_press(ui.inspector_body,"Stop pump")
	_check(actions.back()=={"action":"process_run","args":{"id":"BLD-1003","running":false}},"Stop control follows the actual current pump state")
	_press(ui.inspector_body,"Request worker to disconnect hose")
	_check(actions.back()=={"action":"process_disconnect","args":{"id":"BLD-1003"}},"Disconnect control retains the exact pump identity")
	ui.show_entity("BLD-1004");_press(ui.inspector_body,"Request worker to open")
	_check(actions.back()=={"action":"process_valve","args":{"id":"BLD-1004","open":true}},"Closed manual valve requests physical opening")
	fixture.process.valves[0].open=true;ui.show_entity("BLD-1004");_press(ui.inspector_body,"Request worker to close")
	_check(actions.back()=={"action":"process_valve","args":{"id":"BLD-1004","open":false}},"Open manual valve requests physical closing")
	ui.show_entity("BLD-1005")
	_check(_text(ui.inspector_body).contains("20000") and _text(ui.inspector_body).contains("30000") and _text(ui.inspector_body).contains("Pressure is not modeled"),"Gauge inspector presents measured level and flow without inventing pressure")
	ui.show_entity("PROCESS-1001")
	_check(_text(ui.inspector_body).contains("WRK-1001") and _text(ui.inspector_body).contains("CAR-1001"),"Ground operation inspector exposes assigned worker and car references")
	fixture.state.buildings.append(_building("BLD-1010","processReactor",6,6))
	fixture.process.reactors=[{"id":"BLD-1010","inputTankId":"BLD-1001","outputTankId":"BLD-1002","batchSize":1000,"liters":1000,"clock":10,"phase":"reacting","enabled":false,"batches":2,"status":"Paused; contents retained"}]
	fixture.process.sales=[{"id":"SALE-1001","carId":"CAR-1001","liters":2000,"unitPrice":.85,"revenue":0,"created":36000}]
	ui.update_snapshot(fixture);ui.show_tab("Process");ui.show_entity("BLD-1010");await process_frame
	_check(ui.tables[6].rows.size()==1 and ui.tables[7].rows.size()==1,"Reactor and product sale registers display their records")
	_check(_choose(ui.inspector_body,"BLD-1001")!=null,"Reactor feed tank uses selectable linked IDs")
	_press(ui.inspector_body,"Apply batch setup")
	_check(actions.back()=={"action":"reactor_configure","args":{"id":"BLD-1010","inputTankId":"BLD-1001","outputTankId":"BLD-1002","batchSize":1000}},"Reactor configuration keeps distinct feed and product tanks")
	_press(ui.inspector_body,"Start / resume reactor")
	_check(actions.back()=={"action":"reactor_run","args":{"id":"BLD-1010","running":true}},"Reactor start uses the selected building")
	ui.show_entity("SALE-1001")
	_check(_text(ui.inspector_body).contains("Awaiting shipment") and _text(ui.inspector_body).contains("CAR-1001"),"Pending product payment has a linked inspector")
	ui.show_entity("BLD-1003")
	for option: OptionButton in _nodes(ui.inspector_body,"OptionButton"):
		if option.item_count==2 and option.get_item_text(1)=="Load product from tank":option.select(1)
	_press(ui.inspector_body,"Apply destination and rate")
	_check(actions.back().args.get("direction")=="load","Product loading explicitly reverses the rail pump")
	ui.show_tab("Process");_press(ui.register_body,"Ship product");await process_frame
	var shipment: Window=_window(ui,"Ship refined reagent")
	_check(shipment!=null,"Product shipment dialog is available in Process")
	if shipment:
		var checks_list: Array=_nodes(shipment,"CheckBox")
		_check(not checks_list.is_empty(),"Pending product loads are offered for pickup")
		if not checks_list.is_empty():checks_list[0].button_pressed=true
		_press(shipment,"Request product pickup")
		_check(actions.back().action=="product_ship" and actions.back().args.orderIds==["ORD-1001"],"Product shipment requests physical collection of the chosen order")
		await process_frame
	for size: Vector2i in [Vector2i(1440,900),Vector2i(1280,800)]:
		root.content_scale_size=size;root.size=size;ui.show_tab("Process");ui.show_entity("BLD-1010");await process_frame;await process_frame;await process_frame;await process_frame
		_check(ui.inspector.get_global_rect().end.x<=ui.screen.get_viewport_rect().size.x+1,"Reactor inspector fits the viewport")
		if "--capture" in OS.get_cmdline_user_args() and DisplayServer.get_name()!="headless":
			for i in range(6):await process_frame
			RenderingServer.force_draw(false);root.get_texture().get_image().save_png("res://captures/production-ui-%dx%d.png"%[size.x,size.y])
	ui.show_entity("BLD-1003");_press(ui.inspector_body,"Fluid system help");await process_frame
	var help:Window=_window(ui,"Fluid production and sales")
	_check(help!=null and help.visible,"Process help opens from the actual asset inspector")
	if help:
		var text:String=_text(help)
		_check(text.contains("8 meters") and text.contains("0.85") and text.contains("Liquid fills the pipe first") and text.contains("Save/load"),"Simple help explains physical reach, ports, pipe hold-up, interlocks and saving")
		_press(help,"Close");await process_frame;await process_frame
		_check(not is_instance_valid(help),"Process help closes cleanly")
	ui.queue_free();await process_frame
	print("PROCESS_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":DisplayServer.get_name()!="headless"}))
	quit(0 if failures.is_empty() else 1)
