extends RefCounted
## Dense process register and physical operation controls; no decorative portraits.
const KINDS: Array[String] = ["processTank","transferPump","processPipe","pipeElbow","pipeTee","processValve","processGauge"]
const LABELS: Array[String] = ["Tank · 30,000 L","Rail pump","Pipe · drag run","Elbow","Tee","Manual valve","Gauge"]

static func records(ui, key: String) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for value: Dictionary in ui.metadata.get("process",{}).get(key,[]): result.append(value)
	return result

static func record(ui, id: String) -> Dictionary:
	for key: String in ["tanks","pumps","valves","gauges","lines","operations"]:
		for value: Dictionary in records(ui,key):
			if str(value.get("id",""))==id:return value
	return {}

static func operation(ui, value: Variant) -> Dictionary:
	if value is Dictionary:return value
	for op: Dictionary in records(ui,"operations"):
		if str(op.get("id",""))==str(value):return op
	return {}

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
	ui._note(ui.register_body,"DN100 pipe runs occupy meter cells. Only assembled, connected equipment can transfer liquid. Select a pump to configure its tank and connect a stopped tanker; workers physically operate hoses and valves.")
	var tools := HFlowContainer.new()
	ui.register_body.add_child(tools)
	for i: int in KINDS.size():
		var kind: String = KINDS[i]
		ui._button(tools,LABELS[i],func() -> void:ui._select_tool(kind))
	ui._button(tools,"How to use",func() -> void:help_dialog(ui))
	_table(ui,"Storage tanks",["ID","Product","Contents L","Capacity L","Fill","Connections","State"])
	_table(ui,"Rail transfer pumps",["ID","Tanker","Destination","Hose","Enabled","Actual L/s","Transferred L","State / waiting"])
	_table(ui,"Pipes and fittings · finite DN100 hold-up",["ID","Kind","Product","Contents L","Capacity L","Connections","State"])
	_table(ui,"Manual valves",["ID","Position","Operation","Worker","State"])
	_table(ui,"Gauges · no pressure is invented",["ID","Product","Level L","Capacity L","Flow L/s","Direction","State"])
	_table(ui,"Ground operations",["ID","Kind","Asset","Car","Worker","Phase","Progress","Waiting"])

static func _table(ui, title: String, headers: Array[String]) -> void:
	ui._table(ui.register_body,title,headers)

static func refresh_register(ui) -> void:
	var rows: Array[Dictionary] = []
	for e: Dictionary in records(ui,"tanks"):
		rows.append(ui._row(str(e.id),[e.id,e.get("product","Empty"),"%.2f"%float(e.get("liters",0)),e.get("capacity",30000),"%.1f%%"%(100*float(e.get("liters",0))/maxf(1,float(e.get("capacity",30000))))," · ".join(e.get("connectedTo",[])),e.get("status","")]))
	ui._set_table(0,rows); rows=[]
	for e: Dictionary in records(ui,"pumps"):
		rows.append(ui._row(str(e.id),[e.id,e.get("carId",""),e.get("tankId",""),e.get("hose","disconnected"),"On" if e.get("enabled",false) else "Off","%.2f"%float(e.get("flow",0)),"%.2f"%float(e.get("transferred",0)),e.get("status","")]))
	ui._set_table(1,rows); rows=[]
	for e: Dictionary in records(ui,"lines"):
		rows.append(ui._row(str(e.id),[e.id,e.get("kind",""),e.get("product","Empty"),"%.3f"%float(e.get("liters",0)),"%.3f"%float(e.get("capacity",0))," · ".join(e.get("connectedTo",[])),e.get("status","")]))
	ui._set_table(2,rows); rows=[]
	for e: Dictionary in records(ui,"valves"):
		var op: Dictionary = operation(ui,e.get("operation",""))
		rows.append(ui._row(str(e.id),[e.id,"Open" if e.get("open",false) else "Closed",op.get("id",""),op.get("workerId",""),e.get("status","")]))
	ui._set_table(3,rows); rows=[]
	for e: Dictionary in records(ui,"gauges"):
		rows.append(ui._row(str(e.id),[e.id,e.get("product",""),e.get("level","—"),e.get("capacity","—"),e.get("reading","Unavailable"),direction(e.get("direction",null)),e.get("status","")]))
	ui._set_table(4,rows); rows=[]
	var ops: Array[Dictionary] = records(ui,"operations")
	ops.sort_custom(func(a: Dictionary,b: Dictionary) -> bool:
		if a.has("finished") != b.has("finished"):return not a.has("finished")
		return float(a.get("started",0))>float(b.get("started",0)))
	for e: Dictionary in ops:
		rows.append(ui._row(str(e.id),[e.id,e.get("kind",""),e.get("buildingId",""),e.get("carId",""),e.get("workerId",""),e.get("phase",""),e.get("clock",0),e.get("status","")]))
	ui._set_table(5,rows)

static func inspector(ui, building: Dictionary) -> void:
	var id: String = str(building.id)
	var e: Dictionary = record(ui,id)
	ui._detail("Components",building.get("componentIds",{}).size())
	ui._detail("Construction",building.get("source","Creative placement"))
	ui._detail("State",e.get("status","Assembled · waiting for process update"))
	ui._detail("Ports",ports(e.get("ports",[])))
	ui._detail("Connections"," · ".join(e.get("connectedTo",[])) if not e.get("connectedTo",[]).is_empty() else "None")
	if str(building.kind) not in ["processTank","transferPump"]:
		ui._detail("Material","DN100 steel · "+str(building.kind))
		ui._detail("Centerline length","%.3f m"%float(e.get("length",0)))
	match str(building.kind):
		"processTank":
			ui._detail("Product",e.get("product","Empty"))
			ui._detail("Contents","%.2f / %.0f L"%[float(e.get("liters",0)),float(e.get("capacity",30000))])
			ui._note(ui.inspector_body,"Connect a pipe to a port on any side. Tanks stop accepting liquid at capacity. Empty and isolate the tank before recovering it.")
		"transferPump":
			ui._detail("Source tanker",e.get("carId",""))
			ui._detail("Destination tank",e.get("tankId",""))
			ui._detail("Installed route"," · ".join(e.get("installedRoute",[])) if not e.get("installedRoute",[]).is_empty() else "Incomplete")
			ui._detail("Open route"," · ".join(e.get("route",[])) if not e.get("route",[]).is_empty() else "Blocked / incomplete")
			ui._detail("Hose",e.get("hose","disconnected"))
			ui._detail("Actual flow","%.2f L/s"%float(e.get("flow",0)))
			ui._detail("Transferred","%.2f L"%float(e.get("transferred",0)))
			ui._detail("Electrical load","2 kW · commissioned underground circuit required")
			var tank: OptionButton = OptionButton.new()
			tank.size_flags_horizontal=Control.SIZE_EXPAND_FILL
			tank.add_item("Choose destination tank…");tank.set_item_metadata(0,"")
			for value: Dictionary in records(ui,"tanks"):
				tank.add_item("%s · %.0f / %.0f L"%[value.id,float(value.get("liters",0)),float(value.get("capacity",30000))])
				tank.set_item_metadata(tank.item_count-1,str(value.id))
				if str(value.id)==str(e.get("tankId","")):tank.select(tank.item_count-1)
			ui.inspector_body.add_child(tank)
			var rate: SpinBox = ui._number(ui.inspector_body,"Requested L/s",float(e.get("rate",5)),0.1,5,0.1)
			ui._button(ui.inspector_body,"Apply destination and rate",func() -> void:ui._send("process_configure",{"id":id,"tankId":str(tank.get_selected_metadata()),"rate":rate.value}))
			var car: OptionButton = OptionButton.new()
			car.size_flags_horizontal=Control.SIZE_EXPAND_FILL
			car.add_item("Choose stopped tanker…");car.set_item_metadata(0,"")
			for value: Dictionary in ui._freight_cars():
				if str(value.get("kind",""))!="tanker" or value.get("returned",false) or str(value.get("status",""))!="unloading":continue
				car.add_item("%s · %s · %.0f L"%[value.id,value.get("tank",{}).get("product",""),float(value.get("tank",{}).get("liters",0))])
				car.set_item_metadata(car.item_count-1,str(value.id))
				if str(value.id)==str(e.get("carId","")):car.select(car.item_count-1)
			ui.inspector_body.add_child(car)
			ui._button(ui.inspector_body,"Request worker to connect hose",func() -> void:ui._send("process_connect",{"id":id,"carId":str(car.get_selected_metadata())}))
			ui._button(ui.inspector_body,"Stop pump" if e.get("enabled",false) else "Start pump",func() -> void:ui._send("process_run",{"id":id,"running":not e.get("enabled",false)}))
			ui._button(ui.inspector_body,"Request worker to disconnect hose",func() -> void:ui._send("process_disconnect",{"id":id}))
			ui._note(ui.inspector_body,"The 8 m hose locks the connected car against movement. Complete the outlet pipe route to the selected tank, open its valves, and connect this pump through Electrical. The status above explains any interlock.")
		"processValve":
			ui._detail("Position","Open" if e.get("open",false) else "Closed")
			ui._detail("Operation",operation(ui,e.get("operation","")).get("id",""))
			ui._button(ui.inspector_body,"Request worker to close" if e.get("open",false) else "Request worker to open",func() -> void:ui._send("process_valve",{"id":id,"open":not e.get("open",false)}))
			ui._note(ui.inspector_body,"The valve changes position only after a worker reaches and turns it. Closing isolates the route and retains fluid already in the pipe.")
		"processGauge":
			for pair: Array in [["Product","product"],["Connected tank","tankId"],["Tank contents L","level"],["Tank capacity L","capacity"],["Flow L/s","reading"]]:ui._detail(pair[0],e.get(pair[1],"Unavailable"))
			ui._detail("Direction",direction(e.get("direction",null)))
			ui._detail("Calibration","Factory calibrated" if e.get("calibrated",false) else "Unavailable")
			ui._note(ui.inspector_body,"This instrument reports the connected tank level and actual transfer flow. Isolated or incomplete networks have unavailable readings. Pressure is not modeled in this first fluid system.")
		_:
			ui._detail("Product",e.get("product","Empty"))
			ui._detail("Hold-up","%.3f / %.3f L"%[float(e.get("liters",0)),float(e.get("capacity",0))])
	ui._button(ui.inspector_body,"Fluid system help",func() -> void:help_dialog(ui))

static func help_dialog(ui) -> void:
	var dialog: Dictionary = ui._rail_dialog("Tanks, pumps, pipes, valves, and gauges",Vector2i(760,620))
	for text: String in [
		"Build a storage tank and a rail transfer pump from the Process register. These require their own delivered kits, foundations, equipment, and workers. The crew unpacks and assembles real components. Creative mode completes the same assets immediately.",
		"Place the pump close to a stopped tanker: its flexible hose reaches 8 meters. The pump outlet is on its east side at default rotation; R rotates a placement. Tank ports sit on all four sides. Pipe centerlines are 0.85 meters above ground. Drag the pipe tool to plan a straight, connected meter-grid run. Use elbows and tees to change direction or branch; their orientation also follows R.",
		"A closed manual valve blocks flow. Select it and request a worker to open it. Workers must be on duty and able to walk to the fitting. Gauges are inline components and show the connected tank quantity and actual flow; they do not invent pressure readings.",
		"Receive a tanker train from Railway, then release its supplier locomotive and shunt the car to your named transfer location if needed. Select the pump, choose the destination tank and transfer rate, apply them, choose the stopped tanker, and request a hose connection. A worker walks to the car and pump to attach the hose.",
		"Start the pump after the hose is connected and the pipe route is complete. Its 2 kW motor needs a commissioned underground circuit from an energized incoming station or connected light junction. Build that route in Electrical; a site connection alone is insufficient. The pump status explains missing power, closed valves, incomplete routes, incompatible products, a full tank, or an empty car. Liquid fills the pipe first; the pipe, tank, and car quantities balance exactly.",
		"Stop the pump and request a worker to disconnect before shunting or returning the car. A connected hose physically locks the car against movement. Pipe contents remain when pumping stops or a valve closes. Empty and isolate equipment before removing it. Save/load preserves contents, valve settings, hose operations, and transfer totals.",
		"Process tables are sortable and filterable. Click asset, car, and worker IDs to inspect them. SQL exposes process tanks, pumps, lines, valves, gauges, ground operations, and the fluid movement ledger. This first system transfers water and diesel from rail tankers; reactions and pressurized hydraulics are later work."
	]:ui._note(dialog.body,text)
	ui._button(dialog.body,"Close",func() -> void:dialog.window.queue_free())
