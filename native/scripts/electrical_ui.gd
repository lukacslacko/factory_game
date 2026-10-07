extends RefCounted
## Text-first power records. Plans name both assets and submit real meter cells.
var plan_window: Window
var source_choice: OptionButton
var target_choice: OptionButton
var draw_button: Button
var choice_note: Label
var capacity_note: Label

static func data(ui) -> Dictionary:
	return ui.metadata.get("electrical",{})

static func records(ui, key: String) -> Array[Dictionary]:
	var result: Array[Dictionary]=[]
	var values: Array=data(ui).get(key,ui.state.get("electrical",{}).get(key,[]))
	for value: Variant in values:
		if value is Dictionary:result.append(value)
	return result

static func record(ui, id: String, key: String="runs") -> Dictionary:
	for value: Dictionary in records(ui,key):
		if str(value.get("id",""))==id:return value
	return {}

static func source_records(ui) -> Array[Dictionary]:
	var result: Array[Dictionary]=records(ui,"sources")
	result.append_array(records(ui,"junctions"))
	return result

static func terminal_cells(building: Dictionary) -> Array[Dictionary]:
	var result: Array[Dictionary]=[]
	for cell: Dictionary in building.get("terminalCells",[]):result.append({"x":int(cell.x),"z":int(cell.z)})
	if not result.is_empty():return result
	var x: int=int(building.get("x",0));var z: int=int(building.get("z",0))
	var w: int=int(building.get("w",1));var d: int=int(building.get("d",1))
	for dx: int in range(w):result.append({"x":x+dx,"z":z-1});result.append({"x":x+dx,"z":z+d})
	for dz: int in range(d):result.append({"x":x-1,"z":z+dz});result.append({"x":x+w,"z":z+dz})
	return result

static func nearest_terminal(cells: Array[Dictionary], point: Vector3) -> Dictionary:
	var chosen: Dictionary={};var score: float=INF
	for cell: Dictionary in cells:
		var distance: float=Vector2(float(cell.x)+.5-point.x,float(cell.z)+.5-point.z).length_squared()
		if distance<score:score=distance;chosen=cell
	return chosen.duplicate()

static func manhattan_cells(start: Dictionary, end: Dictionary, vertical_first: bool) -> Array[Dictionary]:
	var result: Array[Dictionary]=[]
	if start.is_empty() or end.is_empty():return result
	var x: int=int(start.x);var z: int=int(start.z)
	var end_x: int=int(end.x);var end_z: int=int(end.z)
	if absi(end_x-x)+absi(end_z-z)>512:return result
	result.append({"x":x,"z":z})
	for axis: String in (["z","x"] if vertical_first else ["x","z"]):
		while (x!=end_x if axis=="x" else z!=end_z):
			if axis=="x":x+=1 if end_x>x else -1
			else:z+=1 if end_z>z else -1
			result.append({"x":x,"z":z})
	return result

func build_register(ui) -> void:
	capacity_note=ui._note(ui.register_body,"")
	var tools:=HFlowContainer.new();ui.register_body.add_child(tools)
	ui._button(tools,"Plan underground cable…",func()->void:plan_dialog(ui))
	ui._button(tools,"Order cable reels…",func()->void:
		ui._open_purchase()
		if ui.purchase_quantity.has("cableReel"):ui.purchase_quantity.cableReel.get_line_edit().grab_focus())
	ui._button(tools,"Order 16 kW utility station…",func()->void:station_dialog(ui))
	ui._button(tools,"Electrical help",func()->void:help_dialog(ui))
	ui._note(ui.register_body,"Each circuit connects an incoming cabinet or commissioned light-base junction to one light or rail pump. Select a route to inspect real trench, spoil, cable, crew, and commissioning progress. No nearby or crossing cable creates a connection.")
	_table(ui,"Utility stations",["ID","Position","Capacity kW","Demand kW","Available kW","State"])
	_table(ui,"Light-base junctions · capacity is inherited from the incoming cabinet",["ID","Incoming station","Available kW","State"])
	_table(ui,"Consumers",["ID","Kind","Rated kW","Demand kW","Source","Incoming station","Cable route","Powered","State / reason"])
	_table(ui,"Underground cable runs",["ID","Source","Consumer","Length m","Installed m","State","Work","Phase / waiting"])
	_table(ui,"Cable meter ledger · reels, worker, and buried cable remain accounted for",["Time","Run","From","To","Meters","Reason"])
	for table: Control in ui.tables:table.tree.custom_minimum_size.y=48

static func _table(ui,title: String,headers: Array[String]) -> void:
	ui._table(ui.register_body,title,headers)

static func _option(ui,parent: Node,labels: Array[String]) -> OptionButton:
	return ui._option(parent,labels)

func refresh_register(ui) -> void:
	var sources: Array[Dictionary]=records(ui,"sources")
	var capacity: float=0.;var demand: float=0.
	var rows: Array[Dictionary]=[]
	for e: Dictionary in sources:
		capacity+=float(e.get("capacityKw",16));demand+=float(e.get("demandKw",0))
		rows.append(ui._row(str(e.id),[e.id,ui._position(e),e.get("capacityKw",16),e.get("demandKw",0),e.get("availableKw",0),"Energized" if e.get("energized",false) else "Service not commissioned"],[],{"0":str(e.id)}))
	if is_instance_valid(capacity_note):capacity_note.text="%.2f / %.2f kW connected load · %d utility station(s) · lights and pumps require a tested physical circuit."%[demand,capacity,sources.size()]
	ui._set_table(0,rows);rows=[]
	for e: Dictionary in records(ui,"junctions"):
		rows.append(ui._row(str(e.id),[e.id,e.get("rootSourceId","—"),e.get("availableKw",0),"Powered" if e.get("powered",false) else e.get("reason","Not powered")],[],{"0":str(e.id),"1":str(e.get("rootSourceId",""))}))
	ui._set_table(1,rows);rows=[]
	for e: Dictionary in records(ui,"consumers"):
		var run_ids: Array=e.get("runIds",[])
		rows.append(ui._row(str(e.id),[e.id,ui._name(str(e.get("kind",""))),e.get("ratedKw",e.get("loadKw",0)),e.get("loadKw",0),e.get("sourceId","—"),e.get("rootSourceId",e.get("sourceId","—"))," · ".join(run_ids),"Yes" if e.get("powered",false) else "No",e.get("reason",e.get("status",""))],[],{"0":str(e.id),"4":str(e.get("sourceId","")),"5":str(e.get("rootSourceId",e.get("sourceId",""))),"6":str(run_ids[0]) if not run_ids.is_empty() else ""}))
	ui._set_table(2,rows);rows=[]
	for e: Dictionary in records(ui,"runs"):
		if not ui._status_matches("done" if e.get("status")=="commissioned" else str(e.get("status",""))):continue
		var installed: int=0
		for cell: Dictionary in e.get("cells",[]):
			if cell.get("cableInstalled",false):installed+=1
		rows.push_front(ui._row(str(e.id),[e.id,e.get("sourceId",""),e.get("targetId",""),e.get("length",e.get("cells",[]).size()),e.get("installedMeters",installed),e.get("status",""),"Opening assets" if e.get("opening",false) else e.get("jobId",""),str(e.get("phase",""))+" · "+str(e.get("reason",""))],[],{"0":str(e.id),"1":str(e.get("sourceId","")),"2":str(e.get("targetId","")),"6":"" if e.get("opening",false) else str(e.get("jobId",""))}))
	ui._set_table(3,rows);rows=[]
	for e: Dictionary in records(ui,"meterLedger"):
		rows.push_front(ui._row(str(e.get("id","")),[ui._clock(e.get("time",0)),e.get("runId",""),e.get("from",""),e.get("to",""),e.get("meters",0),e.get("reason","")],[],{"1":str(e.get("runId","")),"2":str(e.get("from","")).get_slice("/",0),"3":str(e.get("to","")).get_slice("/",0)}))
	ui._set_table(4,rows)

func plan_dialog(ui, source_id: String="", target_id: String="") -> void:
	if is_instance_valid(plan_window):plan_window.queue_free()
	var dialog: Dictionary=ui._rail_dialog("Plan underground electrical circuit",Vector2i(690,450));plan_window=dialog.window
	ui._note(dialog.body,"Choose the incoming station or a wired light-base junction and the exact light or pump. In Yard, click a highlighted outside terminal at the source, then click a highlighted terminal at the consumer, or drag between them. R swaps the elbow; Escape cancels the preview. The route follows 1 m cells and is validated before work is planned.")
	ui._label(dialog.body,"Source · incoming station or commissioned light-base junction")
	source_choice=_option(ui,dialog.body,["Choose an incoming station or wired light base…"]);source_choice.set_item_metadata(0,"")
	var sources: Array[Dictionary]=source_records(ui)
	for e: Dictionary in sources:
		source_choice.add_item("%s · %s · %.2f kW available%s"%[e.id,ui._position(e),float(e.get("availableKw",0))," · inherited from "+str(e.get("rootSourceId","")) if e.get("kind")=="lamp" else ""]);source_choice.set_item_metadata(source_choice.item_count-1,str(e.id))
		if str(e.id)==source_id:source_choice.select(source_choice.item_count-1)
	ui._label(dialog.body,"Consumer · one light or rail transfer pump")
	target_choice=_option(ui,dialog.body,["Choose the consumer to connect…"]);target_choice.set_item_metadata(0,"")
	for e: Dictionary in records(ui,"consumers"):
		target_choice.add_item("%s · %s · %.2f kW rated · %s"%[e.id,ui._name(str(e.get("kind",""))),float(e.get("ratedKw",e.get("loadKw",0))),"Connected" if e.get("connected",false) else "Not connected"]);target_choice.set_item_metadata(target_choice.item_count-1,str(e.id))
		if str(e.id)==target_id:target_choice.select(target_choice.item_count-1)
	choice_note=ui._note(dialog.body,"")
	draw_button=ui._button(dialog.body,"Draw this circuit in Yard",func()->void:
		ui._send("electrical_draw",{"sourceId":ui._selection(source_choice),"targetId":ui._selection(target_choice)})
		plan_window.queue_free())
	source_choice.item_selected.connect(func(_index: int)->void:_update_choices(ui))
	target_choice.item_selected.connect(func(_index: int)->void:_update_choices(ui))
	ui._button(dialog.body,"Electrical help",func()->void:help_dialog(ui))
	ui._button(dialog.footer,"Close",func()->void:plan_window.queue_free())
	_update_choices(ui);plan_window.popup_centered()

func _update_choices(ui) -> void:
	var source_id: String=ui._selection(source_choice);var target_id: String=ui._selection(target_choice)
	draw_button.disabled=source_id.is_empty() or target_id.is_empty()
	if source_choice.item_count==1:choice_note.text="No incoming station or wired light base. Order station service, and let its utility crew install it first."
	elif target_choice.item_count==1:choice_note.text="Build a light pole or rail transfer pump first. Only these consumers are supported by the starter electrical system."
	elif draw_button.disabled:choice_note.text="Select both named assets. Highlighted terminal cells will show where their circuit can start and end."
	else:choice_note.text="%s → %s. Keep the trench, neighboring spoil cells, staged paving, machine approach, and reel storage clear."%[source_id,target_id]

static func station_dialog(ui) -> void:
	var dialog: Dictionary=ui._rail_dialog("Order low-power electrical service",Vector2i(590,310))
	ui._note(dialog.body,"A utility company brings its crew and connection equipment by road and installs a physical station. The starter 16 kVA connection is modeled with a 16 kW load limit. This order supplies the station only; you build separate underground circuits to each light or pump.")
	ui._note(dialog.body,"Service price: %s before carrier charges. The visiting crew is external; your site still needs its own excavator, operator, site engineer, and delivered cable reels for downstream circuits."%ui._money(ui.catalog.get("power",{}).get("price",1800)))
	var existing: String="";var incoming: String=""
	for building: Dictionary in ui.state.get("buildings",[]):
		if building.get("kind")=="power":existing=str(building.id)
	for order: Dictionary in ui.state.get("orders",[]):
		if order.get("item")=="power" and order.get("status")!="done":incoming=str(order.id)
	if not existing.is_empty() or not incoming.is_empty():
		ui._note(dialog.body,"This starter site supports one incoming station. Inspect the installed or incoming connection, then extend its supply using separately built cable branches from commissioned light bases. Each branch inherits the same remaining 16 kW capacity.")
		var station_id: String=existing if not existing.is_empty() else incoming
		ui._button(dialog.footer,"Inspect existing station" if not existing.is_empty() else "Inspect incoming service",func()->void:ui._user_entity(station_id);dialog.window.queue_free())
	else:
		ui._button(dialog.footer,"Order station service",func()->void:ui._send("purchase",{"item":"power","qty":1,"mode":"road"});dialog.window.queue_free())
	ui._button(dialog.footer,"Close",func()->void:dialog.window.queue_free())
	dialog.window.popup_centered()

func asset_inspector(ui, asset: Dictionary) -> void:
	var id: String=str(asset.id);var source: Dictionary=record(ui,id,"sources");var junction: Dictionary=record(ui,id,"junctions");var consumer: Dictionary=record(ui,id,"consumers")
	if source.is_empty() and consumer.is_empty():return
	ui._label(ui.inspector_body,"Electrical connection")
	if not source.is_empty():
		ui._detail("Modeled capacity","%.2f kW"%float(source.get("capacityKw",16)))
		ui._detail("Connected demand","%.2f kW"%float(source.get("demandKw",0)))
		ui._detail("Available capacity","%.2f kW"%float(source.get("availableKw",0)))
		ui._button(ui.inspector_body,"Plan cable from this station…",func()->void:plan_dialog(ui,id))
	else:
		ui._detail("Rated load","%.2f kW"%float(consumer.get("ratedKw",consumer.get("loadKw",0))))
		ui._detail("Current demand","%.2f kW"%float(consumer.get("loadKw",0)))
		ui._detail("Circuit source",consumer.get("sourceId","—"))
		ui._detail("Incoming station",consumer.get("rootSourceId",consumer.get("sourceId","—")))
		ui._reference_controls(ui.inspector_body,[consumer.get("sourceId",""),consumer.get("rootSourceId","")])
		ui._detail("Circuit"," · ".join(consumer.get("runIds",[])))
		ui._detail("Electrically connected","Yes" if consumer.get("connected",false) else "No")
		ui._detail("Powered","Yes" if consumer.get("powered",false) else "No")
		ui._detail("Power status",consumer.get("reason",consumer.get("status","")))
		ui._button(ui.inspector_body,"Plan cable to this consumer…",func()->void:plan_dialog(ui,"",id))
		ui._reference_controls(ui.inspector_body,consumer.get("runIds",[]))
	if not junction.is_empty():
		ui._detail("Junction incoming station",junction.get("rootSourceId","—"))
		ui._detail("Inherited available capacity","%.2f kW"%float(junction.get("availableKw",0)))
		ui._reference_controls(ui.inspector_body,[junction.get("rootSourceId","")])
		ui._button(ui.inspector_body,"Extend cable from this light base…",func()->void:plan_dialog(ui,id))
	ui._button(ui.inspector_body,"Open Electrical register",func()->void:ui._switch_tab("Electrical"))

static func run_inspector(ui, run: Dictionary) -> void:
	var id: String=str(run.id)
	for pair: Array in [["Source","sourceId"],["Consumer","targetId"],["State","status"],["Current phase","phase"],["Waiting","reason"],["Work","jobId"],["Electrical worker","workerId"],["Operator","operatorId"],["Excavator","equipmentId"],["Selected reel","reelId"]]:
		ui._detail(pair[0],"Opening assets" if pair[1]=="jobId" and run.get("opening",false) else run.get(pair[1],"—"))
	var cells: Array=run.get("cells",[]);var installed: int=0;var open: int=0;var spoil: float=0.
	for cell: Dictionary in cells:
		if cell.get("cableInstalled",false):installed+=1
		if float(cell.get("excavation",0))>float(cell.get("backfilled",0))+.001:open+=1
		spoil+=float(cell.get("spoilM3",0))
	ui._detail("Cable","%d / %d m installed"%[installed,cells.size()])
	ui._detail("Open trench cells",open);ui._detail("Spoil on site","%.3f m³"%spoil)
	ui._detail("Cable in hand","%.1f m"%float(run.get("cableInHand",0)))
	ui._detail("Terminations","Source %s · consumer %s"%["done" if run.get("sourceTerminated",false) else "pending","done" if run.get("targetTerminated",false) else "pending"])
	ui._detail("Electrical test","Passed" if run.get("tested",false) else "Pending")
	ui._reference_controls(ui.inspector_body,[run.get("sourceId",""),run.get("targetId",""),"" if run.get("opening",false) else run.get("jobId",""),run.get("equipmentId",""),run.get("workerId",""),run.get("operatorId","")])
	var status: String=str(run.get("status",""))
	var recovering: bool=bool(run.get("recovering",false))
	if recovering:
		ui._detail("Operation","Physical cable recovery" if status!="canceled" else ("Cable recovery complete" if installed==0 else "Recovery safely stopped; installed cable remains"))
	if status=="canceled" and not recovering:ui._button(ui.inspector_body,"Resume canceled circuit",func()->void:ui._send("electrical_resume",{"id":id}))
	if status in ["commissioned","canceled"] and installed>0:
		ui._button(ui.inspector_body,"Recover installed circuit",func()->void:ui._send("electrical_recover",{"id":id}))
	elif status not in ["canceling","canceled"]:ui._button(ui.inspector_body,"Cancel recovery safely" if recovering else "Cancel remaining circuit work",func()->void:ui._send("electrical_cancel",{"id":id}))
	ui._note(ui.inspector_body,"Canceling safely restores open ground and keeps installed cable recorded as uncommissioned. Resume continues that same circuit. Recovery sends the engineer to physically isolate both terminals before digging; queued work alone does not disconnect power. It then digs, retrieves measured cable into a real reel, and restores the ground. Recover downstream branches first and keep a reel with enough spare capacity accessible. Active installation must be safely canceled before recovery.")
	ui._button(ui.inspector_body,"Electrical help",func()->void:help_dialog(ui))

static func help_paragraphs() -> Array[String]:
	return [
		"Order the 16 kW utility station from Electrical. Its external utility crew arrives by road and installs the connection. A station does not power the whole yard automatically. This first system connects individual light poles and rail transfer pumps; buildings with other uses are not electrical consumers yet.",
		"Purchase 50 m cable reels, an excavator, fuel, and your own crew. An equipment operator moves the excavator; an available site engineer performs the electrical work. Deliveries must be unloaded into real accessible storage. In the equipment inspector, enable Construction under Automatic work, or assign the machine through the linked Work task.",
		"Choose Plan underground cable, then explicitly select the source station or a commissioned light-base junction and the consumer. A light-base junction passes on its incoming station's remaining capacity; it does not create another 16 kW supply. Each branch still needs its own complete physical cable run. Yard highlights their outside terminal cells. Click a source terminal, then a consumer terminal, or drag between them. R swaps which direction the elbow takes. A green route has passed the host's current placement checks; amber is still checking and red explains an invalid route. Escape abandons the preview without placing work.",
		"The plan reserves meter cells, neighboring spoil space, any temporary lifted paving, cable, crew, and a real machine approach. Keep these areas clear. The crew brings and stages reels, lifts paving where necessary, digs the trench, lays measured cable, backfills with the actual spoil, restores paving, makes both terminations, and tests the circuit. Crossing or touching another circuit does not join it, and this first system does not share trenches. Completed cable is buried and hidden; select its run or consumer for a temporary dashed route overlay. Click an open trench, spoil, or route marker to inspect that circuit.",
		"A light or pump needs a complete tested circuit and spare station capacity before it has power. The station's 16 kVA rating is modeled as a 16 kW limit; the register shows each consumer's load and the remaining capacity. Inspect linked route, station, consumer, worker, equipment, and Work IDs to understand a delay. Lamp illumination still follows the day/night clock; a powered pump also needs its normal fluid route, controls, and interlocks.",
		"Cancel remaining circuit work to stop safely; open ground is restored and cable already installed stays recorded but uncommissioned. Resume canceled circuit continues that route. Recover installed circuit first isolates both ends, then excavates and returns each exposed meter to a real reel before restoring the ground. Recover downstream branches first; a reel with enough free capacity must be accessible. Safely cancel unfinished installation before recovering its installed cable. A fully recovered route has no installed cable to recover again. The cable meter ledger tracks reel withdrawals and installed/recovered cable rather than inventing electric energy metering. These operations preserve their identities and progress when saved."
	]

static func help_dialog(ui) -> void:
	var dialog: Dictionary=ui._rail_dialog("Underground electrical guide",Vector2i(790,650))
	for paragraph: String in help_paragraphs():ui._note(dialog.body,paragraph)
	ui._button(dialog.footer,"Close",func()->void:dialog.window.queue_free())
	dialog.window.popup_centered()
