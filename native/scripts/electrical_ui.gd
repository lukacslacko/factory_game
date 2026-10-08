extends RefCounted
## Text-first power records. Plans name both assets and submit real meter cells.
var plan_window: Window
var source_choice: OptionButton
var target_choice: OptionButton
var draw_button: Button
var choice_note: Label
var capacity_note: Label
var source_filter: LineEdit
var target_filter: LineEdit
var source_selected: String=""
var target_selected: String=""

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
	for junction: Dictionary in records(ui,"junctions"):
		if junction.get("connected",false):result.append(junction)
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
	ui._button(tools,"Plan underground cable…",func()->void:resume_plan_dialog(ui))
	ui._button(tools,"Order cable reels…",func()->void:
		ui._open_purchase()
		if ui.purchase_quantity.has("cableReel"):ui.purchase_quantity.cableReel.get_line_edit().grab_focus())
	ui._button(tools,"Incoming station…",func()->void:station_dialog(ui))
	ui._button(tools,"Build junction cabinet",func()->void:ui._select_tool("electricalJunction"))
	ui._button(tools,"Electrical help",func()->void:help_dialog(ui))
	ui._note(ui.register_body,"Each circuit connects an incoming cabinet or commissioned junction to another junction cabinet, light, or rail pump. Select a route to inspect real trench, spoil, cable, crew, and commissioning progress. No nearby or crossing cable creates a connection.")
	_table(ui,"Utility stations",["ID","Position","Capacity kW","Demand kW","Available kW","State","Name"])
	_table(ui,"Junction cabinets and light bases · capacity is inherited from the incoming cabinet",["ID","Incoming station","Available kW","State","Name"])
	_table(ui,"Consumers",["ID","Kind","Rated kW","Demand kW","Source","Incoming station","Cable route","Powered","State / reason","Name"])
	_table(ui,"Underground cable runs",["ID","Source","Consumer","Length m","Installed m","State","Work","Phase / waiting"])
	_table(ui,"Cable meter ledger · reels, worker, and buried cable remain accounted for",["Time","Run","From","To","Meters","Reason"])

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
		rows.append(ui._row(str(e.id),[e.id,ui._position(e),e.get("capacityKw",16),e.get("demandKw",0),e.get("availableKw",0),"Energized" if e.get("energized",false) else "Service not commissioned",e.get("name",ui._name(str(e.get("kind","power"))))],[],{"0":str(e.id)}))
	if is_instance_valid(capacity_note):capacity_note.text="%.2f / %.2f kW connected load · %d utility station(s) · lights and pumps require a tested physical circuit."%[demand,capacity,sources.size()]
	ui._set_table(0,rows);rows=[]
	for e: Dictionary in records(ui,"junctions"):
		rows.append(ui._row(str(e.id),[e.id,e.get("rootSourceId","—"),e.get("availableKw",0),"Powered" if e.get("powered",false) else e.get("reason","Not powered"),e.get("name",ui._name(str(e.get("kind","electricalJunction"))))],[],{"0":str(e.id),"1":str(e.get("rootSourceId",""))}))
	ui._set_table(1,rows);rows=[]
	for e: Dictionary in records(ui,"consumers"):
		var run_ids: Array=e.get("runIds",[])
		rows.append(ui._row(str(e.id),[e.id,ui._name(str(e.get("kind",""))),e.get("ratedKw",e.get("loadKw",0)),e.get("loadKw",0),e.get("sourceId","—"),e.get("rootSourceId",e.get("sourceId","—"))," · ".join(run_ids),"Yes" if e.get("powered",false) else "No",e.get("reason",e.get("status","")),e.get("name",ui._name(str(e.get("kind",""))))],[],{"0":str(e.id),"4":str(e.get("sourceId","")),"5":str(e.get("rootSourceId",e.get("sourceId",""))),"6":str(run_ids[0]) if not run_ids.is_empty() else ""}))
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

static func asset_label(ui, asset: Dictionary) -> String:
	var kind: String=ui._name(str(asset.get("kind","")))
	var name: String=str(asset.get("name",kind))
	if name.is_empty():name=kind
	return "%s · %s · %s"%[name,asset.get("id",""),kind] if name!=kind else "%s · %s"%[name,asset.get("id","")]

static func matches_asset(ui, asset: Dictionary, query: String) -> bool:
	var haystack: String=(asset_label(ui,asset)+" "+ui._position(asset)).to_lower()
	for word: String in query.to_lower().strip_edges().split(" ",false):
		if not haystack.contains(word):return false
	return true

func _fill_choices(ui, role: String) -> void:
	var option: OptionButton=source_choice if role=="source" else target_choice
	var filter: LineEdit=source_filter if role=="source" else target_filter
	var selected: String=source_selected if role=="source" else target_selected
	var assets: Array[Dictionary]=source_records(ui) if role=="source" else records(ui,"consumers")
	assets.sort_custom(func(a: Dictionary,b: Dictionary)->bool:return asset_label(ui,a).naturalnocasecmp_to(asset_label(ui,b))<0)
	option.clear();option.add_item("Choose a source…" if role=="source" else "Choose a destination…");option.set_item_metadata(0,"")
	var selected_found: bool=false
	for asset: Dictionary in assets:
		if not matches_asset(ui,asset,filter.text) and str(asset.id)!=selected:continue
		var label: String=asset_label(ui,asset)
		label+=" · %.2f kW available"%float(asset.get("availableKw",0)) if role=="source" else " · "+("Connected" if asset.get("connected",false) else "Needs cable")
		option.add_item(label);option.set_item_metadata(option.item_count-1,str(asset.id))
		if str(asset.id)==selected:option.select(option.item_count-1);selected_found=true
	if not selected.is_empty() and not selected_found:
		option.add_item(selected+" · unavailable; choose another asset")
		option.set_item_metadata(option.item_count-1,selected);option.set_item_disabled(option.item_count-1,true);option.select(option.item_count-1)

func _choice_section(ui, parent: Node, role: String) -> void:
	parent=ui._section(parent,"Source · incoming station or commissioned junction" if role=="source" else "Destination · junction cabinet, light, or pump")
	var search:=LineEdit.new();search.placeholder_text="Search by name, ID, or type…";search.clear_button_enabled=true;parent.add_child(search)
	search.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	var option: OptionButton=_option(ui,parent,[]);option.fit_to_longest_item=false;option.clip_text=true
	if role=="source":source_filter=search;source_choice=option
	else:target_filter=search;target_choice=option
	var buttons:=HBoxContainer.new();parent.add_child(buttons)
	ui._button(buttons,"Pick source on map" if role=="source" else "Pick destination on map",func()->void:
		ui._send("electrical_pick",{"role":role,"sourceId":source_selected,"targetId":target_selected})
		plan_window.queue_free())
	ui._button(buttons,"Locate selected",func()->void:
		var id: String=source_selected if role=="source" else target_selected
		if not id.is_empty():
			ui._send("electrical_locate",{"id":id,"sourceId":source_selected,"targetId":target_selected});plan_window.queue_free())
	search.text_changed.connect(func(_text: String)->void:_fill_choices(ui,role);_update_choices(ui))
	option.item_selected.connect(func(_index: int)->void:
		if role=="source":source_selected=ui._selection(option)
		else:target_selected=ui._selection(option)
		_update_choices(ui))
	_fill_choices(ui,role)

func resume_plan_dialog(ui) -> void:
	plan_dialog(ui,source_selected,target_selected)

func plan_dialog(ui, source_id: String="", target_id: String="") -> void:
	if is_instance_valid(plan_window):plan_window.queue_free()
	var dialog: Dictionary=ui._rail_dialog("Plan underground electrical circuit",Vector2i(760,460));plan_window=dialog.window
	source_selected=source_id;target_selected=target_id
	ui._note(ui._section(dialog.body,"Choose circuit endpoints"),"Search by name or ID for a large site, or pick either object directly in Yard. Both methods select the same stable asset IDs. Locate selected keeps your choices and takes you to that object; reopen Cable to continue. Then draw between the highlighted terminals. R swaps the elbow; Escape cancels the preview.")
	_choice_section(ui,dialog.body,"source")
	_choice_section(ui,dialog.body,"target")
	choice_note=ui._note(ui._section(dialog.body,"Selected circuit"),"")
	draw_button=ui._button(dialog.footer,"Draw this circuit in Yard",func()->void:
		ui._send("electrical_draw",{"sourceId":source_selected,"targetId":target_selected})
		plan_window.queue_free())
	ui._button(dialog.footer,"Close",func()->void:plan_window.queue_free())
	_update_choices(ui);plan_window.popup_centered()

func _update_choices(ui) -> void:
	var source: Dictionary={};var target: Dictionary={}
	for asset: Dictionary in source_records(ui):
		if str(asset.id)==source_selected:source=asset
	for asset: Dictionary in records(ui,"consumers"):
		if str(asset.id)==target_selected:target=asset
	draw_button.disabled=source.is_empty() or target.is_empty() or source_selected==target_selected
	if source_records(ui).is_empty():choice_note.text="No incoming station or commissioned junction in this saved yard. Every new factory includes a connected incoming station."
	elif records(ui,"consumers").is_empty():choice_note.text="Build a junction cabinet, light pole, or rail transfer pump first."
	elif draw_button.disabled:choice_note.text="Select different source and destination objects using search or the map. Each circuit has one explicit source and destination."
	else:choice_note.text=asset_label(ui,source)+" → "+asset_label(ui,target)+". Keep the trench and adjacent spoil/handling space clear."

func rename_dialog(ui, asset: Dictionary) -> void:
	var dialog: Dictionary=ui._rail_dialog("Name electrical asset · "+str(asset.id),Vector2i(570,235))
	var fields: VBoxContainer=ui._section(dialog.body,"Asset name")
	ui._note(fields,"Use a recognizable name, such as North yard lights or Tanker bay pump. IDs and wiring stay unchanged; duplicate names remain distinguishable by ID.")
	var name:=LineEdit.new();name.max_length=80;name.text=str(asset.get("name",ui._name(str(asset.get("kind","")))));fields.add_child(name)
	var save: Button=ui._button(dialog.footer,"Save name",func()->void:ui._send("electrical_rename",{"id":str(asset.id),"name":name.text});dialog.window.queue_free())
	save.disabled=name.text.strip_edges().is_empty()
	name.text_changed.connect(func(text: String)->void:save.disabled=text.strip_edges().is_empty())
	name.text_submitted.connect(func(_text: String)->void:
		if not save.disabled:save.pressed.emit())
	ui._button(dialog.footer,"Cancel",func()->void:dialog.window.queue_free())
	dialog.window.popup_centered();name.grab_focus();name.select_all()

static func station_dialog(ui) -> void:
	var dialog: Dictionary=ui._rail_dialog("Incoming electrical supply",Vector2i(590,310))
	ui._note(ui._section(dialog.body,"Incoming supply"),"Every new factory, including Empty yard, starts with a connected incoming electrical station. Its 16 kVA rating is modeled as a shared 16 kW load limit. The station is opening infrastructure, so no installation order or service charge is needed.")
	ui._note(ui._section(dialog.body,"Local circuits"),"The station does not automatically power the yard. Build and commission underground circuits to junction cabinets, lights, and rail pumps using an excavator, operator, site engineer, and delivered cable reels. Every branch shares the incoming capacity.")
	var existing: String="";var incoming: String=""
	for building: Dictionary in ui.state.get("buildings",[]):
		if building.get("kind")=="power":existing=str(building.id)
	for order: Dictionary in ui.state.get("orders",[]):
		if order.get("item")=="power" and order.get("status")!="done":incoming=str(order.id)
	if not existing.is_empty() or not incoming.is_empty():
		ui._note(ui._section(dialog.body,"Installed supply"),"Inspect the installed station to see its position, capacity, and connected circuits. An incoming service retained from an older save can still finish its installation.")
		var station_id: String=existing if not existing.is_empty() else incoming
		ui._button(dialog.footer,"Inspect existing station" if not existing.is_empty() else "Inspect incoming service",func()->void:ui._user_entity(station_id);dialog.window.queue_free())
	else:
		ui._note(ui._section(dialog.body,"Saved factory"),"This older saved yard has no incoming station. Existing saves are preserved; start a new yard to use the pre-installed supply.")
	ui._button(dialog.footer,"Close",func()->void:dialog.window.queue_free())
	dialog.window.popup_centered()

func asset_inspector(ui, asset: Dictionary) -> void:
	var id: String=str(asset.id);var source: Dictionary=record(ui,id,"sources");var junction: Dictionary=record(ui,id,"junctions");var consumer: Dictionary=record(ui,id,"consumers")
	if source.is_empty() and consumer.is_empty():return
	ui._label(ui.inspector_body,"Electrical connection")
	ui._detail("Name",asset.get("name",ui._name(str(asset.get("kind","")))))
	if not source.is_empty():
		ui._detail("Modeled capacity","%.2f kW"%float(source.get("capacityKw",16)))
		ui._detail("Connected demand","%.2f kW"%float(source.get("demandKw",0)))
		ui._detail("Available capacity","%.2f kW"%float(source.get("availableKw",0)))
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
		ui._reference_controls(ui.inspector_body,consumer.get("runIds",[]))
	if not junction.is_empty():
		ui._detail("Junction incoming station",junction.get("rootSourceId","—"))
		ui._detail("Inherited available capacity","%.2f kW"%float(junction.get("availableKw",0)))
		ui._reference_controls(ui.inspector_body,[junction.get("rootSourceId","")])
	var actions: VBoxContainer=ui._section(ui.inspector_body,"Electrical actions")
	ui._button(actions,"Rename electrical asset…",func()->void:rename_dialog(ui,asset))
	if not source.is_empty():ui._button(actions,"Plan cable from this station…",func()->void:plan_dialog(ui,id))
	else:ui._button(actions,"Plan cable to this consumer…",func()->void:plan_dialog(ui,"",id))
	if not junction.is_empty():
		if junction.get("connected",false):
			ui._button(actions,"Extend cable from this junction…" if asset.get("kind")=="electricalJunction" else "Extend cable from this light base…",func()->void:plan_dialog(ui,id))
		else:ui._note(actions,"Commission an incoming circuit to this cabinet before using it as a branch source.")
	ui._button(actions,"Open Electrical register",func()->void:ui._switch_tab("Electrical"))

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
	ui._detail("Construction stage",run.get("workStage","Opening / legacy phase"))
	ui._detail("Cable in hand","%.1f m"%float(run.get("cableInHand",0)))
	ui._detail("Terminations","Source %s · consumer %s"%["done" if run.get("sourceTerminated",false) else "pending","done" if run.get("targetTerminated",false) else "pending"])
	ui._detail("Electrical test","Passed" if run.get("tested",false) else "Pending")
	ui._reference_controls(ui.inspector_body,[run.get("sourceId",""),run.get("targetId",""),"" if run.get("opening",false) else run.get("jobId",""),run.get("equipmentId",""),run.get("workerId",""),run.get("operatorId","")])
	var status: String=str(run.get("status",""))
	var recovering: bool=bool(run.get("recovering",false))
	if recovering:
		ui._detail("Operation","Physical cable recovery" if status!="canceled" else ("Cable recovery complete" if installed==0 else "Recovery safely stopped; installed cable remains"))
	var actions: VBoxContainer=ui._section(ui.inspector_body,"Circuit controls")
	if status=="canceled" and not recovering:ui._button(actions,"Resume canceled circuit",func()->void:ui._send("electrical_resume",{"id":id}))
	if status in ["commissioned","canceled"] and installed>0:
		ui._button(actions,"Recover installed circuit",func()->void:ui._send("electrical_recover",{"id":id}))
	elif status not in ["canceling","canceled"]:ui._button(actions,"Cancel recovery safely" if recovering else "Cancel remaining circuit work",func()->void:ui._send("electrical_cancel",{"id":id}))
	ui._note(actions,"Canceling safely restores open ground and keeps installed cable recorded as uncommissioned. Resume continues that same circuit. Recovery sends the engineer to physically isolate both terminals before digging; queued work alone does not disconnect power. It then digs, retrieves measured cable into a real reel, and restores the ground. Recover downstream branches first and keep a reel with enough spare capacity accessible. Canceling restores every open trench cell. Active installation must be safely canceled before recovery.")
	ui._button(actions,"Electrical help",func()->void:help_dialog(ui))

static func help_paragraphs() -> Array[String]:
	return [
		"Every new factory, including Empty yard, includes a connected 16 kW incoming electrical station. Use Incoming power or Electrical → Incoming station to inspect it. A station does not power the whole yard automatically. Build underground circuits to junction cabinets, light poles, and rail transfer pumps; other buildings are not electrical consumers yet.",
		"Purchase 50 m cable reels, an excavator, fuel, an equipment operator, and a site engineer. Deliveries must be unloaded into accessible storage. Enable Construction under the excavator's Automatic work, or assign it through the linked Work task. For branches, purchase an Electrical junction cabinet kit and use Electrical → Build junction cabinet. Its foundation and cabinet are physical construction work, like other assets.",
		"Choose Plan underground cable. For either endpoint, search by name, ID, or type, or choose Pick source/destination on map and click an outlined object. Drag to pan and scroll to zoom while choosing; Escape or Back to cable plan returns without changing the prior selection. Locate selected takes you to that object; Cable… reopens the same choices. Rename electrical asset in an object's inspector gives it a memorable label while retaining its stable ID. Railway's existing named locations retain their names and IDs.",
		"Draw this circuit in Yard highlights both assets' outside terminal cells. Click a green source terminal, then a blue destination terminal, or drag between them. R swaps the elbow; Escape abandons the preview. Green means the host accepted the route, amber is checking, and red explains a conflict. A junction must receive a complete commissioned circuit before it can supply another branch. A wired lamp base can also pass supply onward. Every branch shares the original station's remaining 16 kW; no junction creates power.",
		"One work order excavates the entire run to the selected endpoint or junction before laying cable. The excavator lifts soil clear before swinging it to adjacent spoil. The engineer then pulls cable progressively along the open trench from a real staged reel, without returning to the reel for every meter. Both ends are connected, then the crew backfills the run with its conserved spoil, restores lifted paving, and tests the circuit. Power becomes available only when everything is finished. Keep neighboring spoil, reel staging, and machine/walking approaches clear. Open trenches block movement. Crossing or touching cables does not join them; this first system does not share trenches.",
		"Electrical shows linked source, destination, crew, machine, reels, phase, installed meters, and spoil. A light requires 0.1 kW; an enabled pump with its tanker hose connected requires 2 kW. A powered pump also needs its normal fluid route, controls, and interlocks. The station's 16 kVA rating is modeled as a 16 kW limit. Inspect the linked IDs to understand a delay, or export the local rolling diagnostic log.",
		"Cancel remaining circuit work to stop safely. The crew returns held cable and restores every open trench and paving cell before releasing the assignment. Installed cable stays recorded but uncommissioned; Resume continues the same run. Recover installed circuit first physically isolates both ends, then excavates, retrieves measured cable into real reels, and restores the ground. Recover downstream branches before their feed and keep enough accessible reel capacity. Safely cancel installation before recovery. Saving retains work phases and every meter. Creative mode commissions an explicitly drawn valid circuit instantly; recovery still uses the physical crew."
	]

static func help_dialog(ui) -> void:
	var dialog: Dictionary=ui._rail_dialog("Underground electrical guide",Vector2i(790,650))
	var titles: Array[String]=["Incoming power","Supplies and equipment","Choose endpoints","Draw the circuit","Construction sequence","Capacity and status","Cancel, resume, and recover"]
	var paragraphs: Array[String]=help_paragraphs()
	for i: int in paragraphs.size():ui._note(ui._section(dialog.body,titles[i]),paragraphs[i])
	ui._button(dialog.footer,"Close",func()->void:dialog.window.queue_free())
	dialog.window.popup_centered()
