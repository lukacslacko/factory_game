extends RefCounted
## Dense process register and physical operation controls; no decorative portraits.
const KINDS: Array[String] = ["processReactor","processTank","transferPump","processPipe","pipeElbow","pipeTee","processValve","processGauge"]
const LABELS: Array[String] = ["Batch reactor","Tank · 30,000 L","Rail pump","Pipe · drag run","Elbow","Tee","Manual valve","Gauge"]

static func records(ui, key: String) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for value: Dictionary in ui.metadata.get("process",{}).get(key,[]): result.append(value)
	return result

static func record(ui, id: String) -> Dictionary:
	for key: String in ["reactors","sales","tanks","pumps","valves","gauges","lines","operations"]:
		for value: Dictionary in records(ui,key):
			if str(value.get("id",""))==id:return value
	return {}

static func operation(ui, value: Variant) -> Dictionary:
	if value is Dictionary:return value
	for op: Dictionary in records(ui,"operations"):
		if str(op.get("id",""))==str(value):return op
	return {}

static func product_name(ui, value: Variant) -> String:
	return ui._name(str(value)).trim_suffix(" (L)")

static func ports(value: Variant) -> String:
	var parts: PackedStringArray = []
	for p: Variant in value:
		if p is Dictionary:parts.append("E%.1f S%.1f"%[float(p.get("x",0)),float(p.get("z",0))])
		else:parts.append(str(p))
	return " · ".join(parts)

static func direction(value: Variant) -> String:
	if not value is Dictionary:return "Stopped" if value==null else str(value)
	var text: String = ""
	if float(value.get("x",0))!=0:text="East" if float(value.x)>0 else "West"
	if float(value.get("z",0))!=0:text+=(" / " if not text.is_empty() else "")+("South" if float(value.z)>0 else "North")
	return text if not text.is_empty() else "Stopped"

static func build_register(ui) -> void:
	var controls: VBoxContainer=ui._section(ui.register_body,"Production and construction")
	ui._note(controls,"Raw reagent → feed tank → powered batch reactor → product tank → tanker → sale. Tanks decouple production from rail schedules. Select an asset to operate it.")
	var tools := HFlowContainer.new()
	controls.add_child(tools)
	for i: int in KINDS.size():
		var kind: String = KINDS[i]
		ui._button(tools,LABELS[i],func() -> void:ui._select_tool(kind))
	ui._button(tools,"How to use",func() -> void:help_dialog(ui))
	ui._button(tools,"Order feedstock",func() -> void:ui._tanker_order_form(2))
	ui._button(tools,"Ship product",func() -> void:shipping_dialog(ui))
	_table(ui,"Storage tanks",["ID","Product","Contents L","Capacity L","Fill","Connections","State"])
	_table(ui,"Rail transfer pumps",["ID","Tanker","Tank","Direction","Hose","Enabled","Actual L/s","Transferred L","State / waiting"])
	_table(ui,"Pipes and fittings · finite DN100 hold-up",["ID","Kind","Product","Contents L","Capacity L","Connections","State"])
	_table(ui,"Manual valves",["ID","Position","Operation","Worker","State"])
	_table(ui,"Gauges · no pressure is invented",["ID","Product","Level L","Capacity L","Flow L/s","Direction","State"])
	_table(ui,"Ground operations",["ID","Kind","Asset","Car","Worker","Phase","Progress","Waiting"])
	var reactor_table: Control=_table(ui,"Batch reactors · 8 kW · 60 s reaction",["ID","Feed tank","Product tank","Batch L","Contents L","Phase","Reaction s","Batches","State / waiting"])
	ui.register_body.move_child(reactor_table,1)
	_table(ui,"Product sales · paid after departure",["ID","Car","Loaded L","Price / L","Revenue","State"])

static func _table(ui, title: String, headers: Array[String]) -> Control:
	return ui._table(ui.register_body,title,headers)

static func refresh_register(ui) -> void:
	var rows: Array[Dictionary] = []
	for e: Dictionary in records(ui,"tanks"):
		rows.append(ui._row(str(e.id),[e.id,product_name(ui,e.get("product","Empty")),"%.2f"%float(e.get("liters",0)),"%.0f"%float(e.get("capacity",30000)),"%.1f%%"%(100*float(e.get("liters",0))/maxf(1,float(e.get("capacity",30000))))," · ".join(e.get("connectedTo",[])),e.get("status","")]))
	ui._set_table(0,rows); rows=[]
	for e: Dictionary in records(ui,"pumps"):
		rows.append(ui._row(str(e.id),[e.id,e.get("carId",""),e.get("tankId",""),e.get("direction","unload"),e.get("hose","disconnected"),"On" if e.get("enabled",false) else "Off","%.2f"%float(e.get("flow",0)),"%.2f"%float(e.get("transferred",0)),e.get("status","")]))
	ui._set_table(1,rows); rows=[]
	for e: Dictionary in records(ui,"lines"):
		rows.append(ui._row(str(e.id),[e.id,e.get("kind",""),product_name(ui,e.get("product","Empty")),"%.3f"%float(e.get("liters",0)),"%.3f"%float(e.get("capacity",0))," · ".join(e.get("connectedTo",[])),e.get("status","")]))
	ui._set_table(2,rows); rows=[]
	for e: Dictionary in records(ui,"valves"):
		var op: Dictionary = operation(ui,e.get("operation",""))
		rows.append(ui._row(str(e.id),[e.id,"Open" if e.get("open",false) else "Closed",op.get("id",""),op.get("workerId",""),e.get("status","")]))
	ui._set_table(3,rows); rows=[]
	for e: Dictionary in records(ui,"gauges"):
		rows.append(ui._row(str(e.id),[e.id,product_name(ui,e.get("product","")),e.get("level","—"),e.get("capacity","—"),e.get("reading","Unavailable"),direction(e.get("direction",null)),e.get("status","")]))
	ui._set_table(4,rows); rows=[]
	var ops: Array[Dictionary] = records(ui,"operations")
	ops.sort_custom(func(a: Dictionary,b: Dictionary) -> bool:
		if a.has("finished") != b.has("finished"):return not a.has("finished")
		return float(a.get("started",0))>float(b.get("started",0)))
	for e: Dictionary in ops:
		rows.append(ui._row(str(e.id),[e.id,e.get("kind",""),e.get("buildingId",""),e.get("carId",""),e.get("workerId",""),e.get("phase",""),e.get("clock",0),e.get("status","")]))
	ui._set_table(5,rows);rows=[]
	for e: Dictionary in records(ui,"reactors"):
		rows.append(ui._row(str(e.id),[e.id,e.get("inputTankId",""),e.get("outputTankId",""),int(e.get("batchSize",1000)),"%.2f"%float(e.get("liters",0)),e.get("phase","idle"),"%.1f / 60"%float(e.get("clock",0)),int(e.get("batches",0)),e.get("status","")]))
	ui._set_table(6,rows);rows=[]
	for e: Dictionary in records(ui,"sales"):
		rows.push_front(ui._row(str(e.id),[e.id,e.get("carId",""),"%.2f"%float(e.get("liters",0)),"$%.2f"%float(e.get("unitPrice",0)),"$%.2f"%float(e.get("revenue",0)),"Paid" if e.has("shippedAt") else "Awaiting shipment"]))
	ui._set_table(7,rows)

static func inspector(ui, building: Dictionary) -> void:
	var id: String = str(building.id)
	var e: Dictionary = record(ui,id)
	ui._detail("Components",building.get("componentIds",{}).size())
	ui._detail("Construction",building.get("source","Creative placement"))
	ui._detail("State",e.get("status","Assembled · waiting for process update"))
	ui._detail("Ports",ports(e.get("ports",[])))
	ui._detail("Connections"," · ".join(e.get("connectedTo",[])) if not e.get("connectedTo",[]).is_empty() else "None")
	if str(building.kind) not in ["processReactor","processTank","transferPump"]:
		ui._detail("Material","DN100 steel · "+str(building.kind))
		ui._detail("Centerline length","%.3f m"%float(e.get("length",0)))
	match str(building.kind):
		"processReactor":
			reactor_inspector(ui,e)
		"processTank":
			ui._detail("Product",product_name(ui,e.get("product","Empty")))
			ui._detail("Contents","%.2f / %.0f L"%[float(e.get("liters",0)),float(e.get("capacity",30000))])
			ui._note(ui._section(ui.inspector_body,"Tank handling"),"Connect a pipe to a port on any side. Tanks stop accepting liquid at capacity. Empty and isolate the tank before recovering it.")
		"transferPump":
			ui._detail("Connected tanker",e.get("carId",""))
			ui._detail("Storage tank",e.get("tankId",""))
			ui._detail("Installed route"," · ".join(e.get("installedRoute",[])) if not e.get("installedRoute",[]).is_empty() else "Incomplete")
			ui._detail("Open route"," · ".join(e.get("route",[])) if not e.get("route",[]).is_empty() else "Blocked / incomplete")
			ui._detail("Hose",e.get("hose","disconnected"))
			ui._detail("Actual flow","%.2f L/s"%float(e.get("flow",0)))
			ui._detail("Transferred","%.2f L"%float(e.get("transferred",0)))
			ui._detail("Electrical load","2 kW · commissioned underground circuit required")
			var destination_controls: VBoxContainer=ui._section(ui.inspector_body,"Tank, direction, and transfer rate")
			var tank: OptionButton=ui._option(destination_controls,["Choose storage tank…"])
			tank.fit_to_longest_item=false;tank.clip_text=true;tank.set_item_metadata(0,"")
			for value: Dictionary in records(ui,"tanks"):
				tank.add_item("%s · %.0f / %.0f L"%[value.id,float(value.get("liters",0)),float(value.get("capacity",30000))])
				tank.set_item_metadata(tank.item_count-1,str(value.id))
				if str(value.id)==str(e.get("tankId","")):tank.select(tank.item_count-1)
			var mode: OptionButton=ui._option(destination_controls,["Unload tanker into tank","Load product from tank"],1 if e.get("direction","unload")=="load" else 0)
			var rate: SpinBox = ui._number(destination_controls,"Requested L/s",float(e.get("rate",5)),0.1,5,0.1)
			ui._button(destination_controls,"Apply destination and rate",func() -> void:ui._send("process_configure",{"id":id,"tankId":str(tank.get_selected_metadata()),"rate":rate.value,"direction":"load" if mode.selected==1 else "unload"}))
			var transfer_controls: VBoxContainer=ui._section(ui.inspector_body,"Tanker hose and pump")
			var car: OptionButton=ui._option(transfer_controls,["Choose stopped tanker…"])
			car.fit_to_longest_item=false;car.clip_text=true;car.set_item_metadata(0,"")
			for value: Dictionary in ui._freight_cars():
				if str(value.get("kind",""))!="tanker" or value.get("returned",false) or str(value.get("status",""))!="unloading":continue
				car.add_item("%s · %s · %.0f L"%[value.id,product_name(ui,value.get("tank",{}).get("product","")),float(value.get("tank",{}).get("liters",0))])
				car.set_item_metadata(car.item_count-1,str(value.id))
				if str(value.id)==str(e.get("carId","")):car.select(car.item_count-1)
			ui._button(transfer_controls,"Request worker to connect hose",func() -> void:ui._send("process_connect",{"id":id,"carId":str(car.get_selected_metadata())}))
			ui._button(transfer_controls,"Stop pump" if e.get("enabled",false) else "Start pump",func() -> void:ui._send("process_run",{"id":id,"running":not e.get("enabled",false)}))
			ui._button(transfer_controls,"Request worker to disconnect hose",func() -> void:ui._send("process_disconnect",{"id":id}))
			ui._note(transfer_controls,"The 8 m hose locks the connected car against movement. Complete the pipe route to the selected tank, open its valves, and connect this pump through Electrical. Loading requires refined reagent and an emptied delivery tanker. Use a separate product line to avoid mixing raw and refined liquid. The status above explains any interlock.")
		"processValve":
			ui._detail("Position","Open" if e.get("open",false) else "Closed")
			ui._detail("Operation",operation(ui,e.get("operation","")).get("id",""))
			var valve_controls: VBoxContainer=ui._section(ui.inspector_body,"Valve operation")
			ui._button(valve_controls,"Request worker to close" if e.get("open",false) else "Request worker to open",func() -> void:ui._send("process_valve",{"id":id,"open":not e.get("open",false)}))
			ui._note(valve_controls,"The valve changes position only after a worker reaches and turns it. Closing isolates the route and retains fluid already in the pipe.")
		"processGauge":
			for pair: Array in [["Product","product"],["Connected tank","tankId"],["Tank contents L","level"],["Tank capacity L","capacity"],["Flow L/s","reading"]]:ui._detail(pair[0],e.get(pair[1],"Unavailable"))
			ui._detail("Direction",direction(e.get("direction",null)))
			ui._detail("Calibration","Factory calibrated" if e.get("calibrated",false) else "Unavailable")
			ui._note(ui._section(ui.inspector_body,"Gauge readings"),"This instrument reports the connected tank level and actual transfer flow. Isolated or incomplete networks have unavailable readings. Pressure is not modeled in this first fluid system.")
		_:
			ui._detail("Product",product_name(ui,e.get("product","Empty")))
			ui._detail("Hold-up","%.3f / %.3f L"%[float(e.get("liters",0)),float(e.get("capacity",0))])
	ui._button(ui._section(ui.inspector_body,"Process help"),"Fluid system help",func() -> void:help_dialog(ui))

static func tank_option(ui, parent: Node, current: String) -> OptionButton:
	var option: OptionButton=ui._option(parent,["Choose tank…"])
	option.fit_to_longest_item=false;option.clip_text=true;option.set_item_metadata(0,"")
	for tank: Dictionary in records(ui,"tanks"):
		option.add_item("%s · %s · %.0f L"%[tank.id,ui._name(str(tank.get("product","Empty"))),float(tank.get("liters",0))])
		option.set_item_metadata(option.item_count-1,str(tank.id))
		if str(tank.id)==current:option.select(option.item_count-1)
	return option

static func reactor_inspector(ui, e: Dictionary) -> void:
	var operation_controls: VBoxContainer=ui._section(ui.inspector_body,"Reactor operation")
	ui._button(operation_controls,"Pause reactor" if e.get("enabled",false) else "Start / resume reactor",func() -> void:ui._send("reactor_run",{"id":e.id,"running":not e.get("enabled",false)}))
	ui._note(operation_controls,"Repeats while enabled. A full product tank pauses discharge; pause preserves the current batch. See How to use for pipe ports and the recipe.")


	for pair: Array in [["Feed tank","inputTankId"],["Product tank","outputTankId"],["Batches","batches"]]:ui._detail(pair[0],e.get(pair[1],"—"))
	ui._detail("Vessel contents","%.2f / 1,000 L"%float(e.get("liters",0)))
	ui._detail("Reaction time","%.1f / 60 s"%float(e.get("clock",0)))
	ui._detail("Electrical load","8 kW · underground circuit required")
	ui._detail("Inlet route"," · ".join(e.get("inputRoute",[])))
	ui._detail("Outlet route"," · ".join(e.get("outputRoute",[])))
	var settings: VBoxContainer=ui._section(ui.inspector_body,"Batch setup")
	ui._label(settings,"Feed tank · raw reagent")
	var feed: OptionButton=tank_option(ui,settings,str(e.get("inputTankId","")))
	ui._label(settings,"Product tank · refined reagent")
	var product: OptionButton=tank_option(ui,settings,str(e.get("outputTankId","")))
	var amount: SpinBox=ui._number(settings,"Batch L",float(e.get("batchSize",1000)),100,1000,100)
	ui._button(settings,"Apply batch setup",func() -> void:ui._send("reactor_configure",{"id":e.id,"inputTankId":str(feed.get_selected_metadata()),"outputTankId":str(product.get_selected_metadata()),"batchSize":int(amount.value)}))
static func shipping_dialog(ui) -> void:
	var dialog: Dictionary=ui._rail_dialog("Ship refined reagent",Vector2i(650,490))
	var body: VBoxContainer=ui._section(dialog.body,"Product collection")
	ui._note(body,"Stop loading and have a worker disconnect every hose. Release the supplier locomotive; shunt the cars together at a connected collection point and park clear. The pickup locomotive couples and carries the product away. Payment is $0.85 per loaded liter after departure; pickup and waiting costs remain separate.")
	var choices: Array[CheckBox]=[]
	for order: Dictionary in ui._records("orders"):
		if str(order.get("status",""))!="unloading" or not order.has("railFreight"):continue
		var amount: float=0
		for sale: Dictionary in records(ui,"sales"):
			if sale.has("shippedAt"):continue
			for car: Dictionary in order.railFreight.get("cars",[]):
				if str(sale.get("carId",""))==str(car.id):amount+=float(sale.get("liters",0))
		if amount<=0:continue
		var check:=CheckBox.new();check.text="%s · %.2f L · $%.2f"%[order.id,amount,amount*.85];check.set_meta("orderId",str(order.id));body.add_child(check);choices.append(check)
	if choices.is_empty():ui._note(body,"No loaded product cars are awaiting shipment. Store product in a tank, then use a rail pump in Load product from tank mode to fill an emptied delivery tanker.")
	ui._label(body,"Collection point")
	var location: OptionButton=ui._reception_option(body)
	var send: Button=ui._button(dialog.footer,"Request product pickup",func() -> void:
		var ids: Array[String]=[]
		for choice: CheckBox in choices:
			if choice.button_pressed:ids.append(str(choice.get_meta("orderId")))
		var args: Dictionary={"orderIds":ids}
		if not ui._selection(location).is_empty():args.railLocationId=ui._selection(location)
		ui._send("product_ship",args);dialog.window.queue_free())
	send.disabled=true
	for choice: CheckBox in choices:choice.toggled.connect(func(_enabled: bool) -> void:
		send.disabled=true
		for item: CheckBox in choices:
			if item.button_pressed:send.disabled=false)
	dialog.window.popup_centered()

static func help_dialog(ui) -> void:
	var dialog: Dictionary = ui._rail_dialog("Fluid production and sales",Vector2i(760,660))
	var paragraphs: Array[String]=[
		"Build two storage tanks, a batch reactor building, an unloading pump, and a product loading pump. Order their kits and foundation slabs through Purchase / hire; an excavator and construction crew assemble them. Creative mode places the same completed equipment immediately.",
		"Build commissioned underground electrical circuits to both pumps and the reactor from Electrical. Each pump needs 2 kW and the reactor needs 8 kW; the incoming supply has 16 kW available shared with lights and other loads. A site connection alone does not power an unwired asset. Commission cable routes before surrounding them with dense piping; trench crossings through installed process equipment are not supported.",
		"Use Order feedstock here or + Tanker train in Railway to buy Raw reagent. Choose liters per car and a connected receiving point. Build the second mainline connection, release the supplier locomotive after arrival, and shunt cars to your transfer point if needed. Railway help explains those operations. For this first recipe, emptied delivery tankers are reused to carry product out.",
		"Select the unloading pump within 8 meters of the stopped tanker's fitting. Choose Unload tanker into tank, select the feed tank, and apply. Connect the pump's pipe port to the feed tank with a continuous route. Drag straight pipes; rotate elbows and fittings with R. A worker must open any manual valves and connect the tanker hose. Start the pump to fill the feed tank. Stop and disconnect when the car is empty.",
		"Connect the feed tank to the reactor's west inlet and its east outlet to the separate product tank at default rotation. R rotates the building and its two ports. Tank ports sit on all four sides. Keep the raw and product circuits separate. Pipe centerlines are 0.85 meters above ground. Liquid fills the pipe first; DN100 pipes hold real liquid before the next vessel fills. Inspect an asset to see port positions and connections.",
		"Select the reactor, choose the feed and product tanks, set a 100–1,000 L batch, and apply. Start the reactor. Its built-in pumps fill at up to 5 L/s, the batch reacts for 60 seconds, then discharges into the product tank. This fictional first recipe converts one liter of raw reagent into one liter of refined reagent. Production repeats while enabled. Pause preserves contents and progress. A full product tank, missing feed, closed valve, incompatible liquid, or power loss stops progress and gives a persistent warning.",
		"The product tank is a buffer: the reactor can run while no tanker is connected. Later, select the product loading pump, choose Load product from tank, select the product tank, and apply. Connect a fully emptied delivery tanker, then start loading. Use a separate pipe line from unloading so raw residue does not contaminate the product. Stop and have a worker disconnect the hose before moving the car.",
		"Use Ship product here or in Railway to request collection. Select the delivery orders containing loaded product, and optionally their named collection point. Cars must form a reachable consist; the shunter must be parked clear. The mainline locomotive arrives, the railway crew couples and tests brakes, then the loaded train departs. Revenue is paid once the train leaves: $0.85 per liter actually loaded. Feedstock, equipment, labor, power infrastructure, locomotive service and waiting charges remain costs. Costs shows revenue as negative entries and the net total.",
		"Process tables are sortable and filterable; click IDs for linked details. Product sales records track loaded liters, price, shipment and payment. SQL includes process_reactors, production_totals, product_sales, process_tanks, process_pumps, process_lines, and fluid_movements. Save/load preserves every batch, line, hose operation and sale. Empty and isolate assets before recovering them."
	]
	var titles: Array[String]=["1 · Build the plant","2 · Supply electricity","3 · Receive feedstock","4 · Unload into feed storage","5 · Connect the reactor","6 · Produce and store product","7 · Load a tanker later","8 · Ship and receive payment","9 · Inspect and save"]
	for i: int in paragraphs.size():ui._note(ui._section(dialog.body,titles[i]),paragraphs[i])
	ui._button(dialog.footer,"Close",func() -> void:dialog.window.queue_free())
	dialog.window.popup_centered()
