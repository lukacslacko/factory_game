extends RefCounted
## Paid outbound collection. Quotes are previews; the host revalidates on request.
var window: Window
var quantities: Dictionary = {}
var arguments: Dictionary = {}
var quoted_arguments: Dictionary = {}
var quote_label: Label
var confirm_button: Button
var quote_button: Button
var awaiting: bool = false

func _price(value: Variant) -> String:
	return "$%.2f"%float(value)

func open(ui, stack_id: String = "", equipment_id: String = "") -> void:
	if is_instance_valid(window):window.hide();window.queue_free()
	quantities.clear();arguments.clear();quoted_arguments.clear();awaiting=false
	var dialog: Dictionary=ui._rail_dialog("Collect unwanted assets",Vector2i(750,610))
	window=dialog.window
	ui._note(ui._section(dialog.body,"Collection service"),"A paid road carrier arrives at receiving. Owned equipment and qualified workers load stored material; a real operator drives retired equipment onto a low-loader. Assets leave the site only with the carrier. Installed assets must be recovered first.")
	if not equipment_id.is_empty():
		arguments={"equipmentId":equipment_id}
		var retirement: VBoxContainer=ui._section(dialog.body,"Selected equipment")
		ui._label(retirement,"Retire "+equipment_id)
		ui._note(retirement,"Stop its work, empty its cargo, and return its operator to automatic duty before requesting collection. Release dedicated support and parking assignments. Its ID, service history, and remaining sealed tank fuel stay in the archive after departure.")
	else:
		var assets: VBoxContainer=ui._section(dialog.body,"Stored materials")
		ui._note(assets,"Choose units from unreserved physical stacks. Finish or release any work reserving a stack first. Empty diesel drums can be collected; drain or use their fuel first. Rail panels must be reachable for rigging and lifting.")
		var scroll:=ScrollContainer.new();scroll.custom_minimum_size.y=230;scroll.size_flags_vertical=Control.SIZE_EXPAND_FILL
		assets.add_child(scroll)
		var list:=VBoxContainer.new();list.size_flags_horizontal=Control.SIZE_EXPAND_FILL;scroll.add_child(list)
		for stack: Dictionary in ui._records("stacks"):
			if int(stack.get("reserved",0))>0:continue
			var available: int=maxi(0,int(stack.get("qty",0))-int(stack.get("reserved",0)))
			if available==0:continue
			var input: SpinBox=ui._number(list,"%s · %s · %d available"%[stack.id,ui._name(str(stack.item)),available],1 if str(stack.id)==stack_id else 0,0,available)
			quantities[str(stack.id)]=input
			input.value_changed.connect(func(_value: float)->void:_invalidate())
	quote_label=ui._note(ui._section(dialog.body,"Collection quote"),"Get a quote to see total weight, carrier count, transport, and disposal charges before ordering.")
	quote_button=ui._button(dialog.footer,"Get collection quote",func()->void:
		arguments=_arguments();quoted_arguments=arguments.duplicate(true);awaiting=true
		quote_button.disabled=true;confirm_button.disabled=true
		quote_label.text="Checking assets, capacity, and price…"
		ui._send("collection_quote",arguments))
	confirm_button=ui._button(dialog.footer,"Order paid collection",func()->void:
		confirm_button.disabled=true
		ui._send("collection_request",quoted_arguments))
	confirm_button.disabled=true
	ui._button(dialog.footer,"Close",func()->void:window.queue_free())
	window.popup_centered()

func _arguments() -> Dictionary:
	if arguments.has("equipmentId"):return arguments.duplicate(true)
	var lines: Array=[]
	for id: String in quantities:
		if is_instance_valid(quantities[id]) and int(quantities[id].value)>0:lines.append({"stackId":id,"qty":int(quantities[id].value)})
	return {"lines":lines}

func _invalidate() -> void:
	if is_instance_valid(confirm_button):confirm_button.disabled=true
	if is_instance_valid(quote_label):quote_label.text="Quantities changed. Get a new quote."

func receive(ui, message: Dictionary) -> void:
	if not is_instance_valid(window):return
	if message.get("action")=="collection_quote":
		awaiting=false;quote_button.disabled=false
		var quote: Dictionary=message.get("result",{})
		if not bool(message.get("ok",false)) or not bool(quote.get("valid",false)):
			quote_label.text=str(quote.get("error",message.get("error","Quote unavailable.")));return
		if _arguments()!=quoted_arguments:
			_invalidate();return
		quote_label.text="%s · %d carrier loads\nTransport %s · Disposal / handling %s · Total %s"%[ui._mass(float(quote.get("massKg",0))),quote.get("loads",[]).size(),_price(quote.get("transportFee",0)),_price(quote.get("disposalFee",0)),_price(quote.get("total",0))]
		confirm_button.disabled=false
	elif message.get("action")=="collection_request":
		if bool(message.get("ok",false)):
			window.queue_free();ui.show_tab("Deliveries")
		else:quote_label.text=str(message.get("error","Assets changed; get a new quote."));quote_button.disabled=false

func build_register(ui) -> void:
	ui._button(ui.register_body,"Collect unwanted material…",func()->void:open(ui))
	var headers: Array[String]=["ID","Carrier","Asset / stacks","Weight","State","Phase / waiting","Total"]
	ui._table(ui.register_body,"Outbound paid collections",headers)

func refresh_register(ui, index: int) -> void:
	var rows: Array[Dictionary]=[]
	for e: Dictionary in ui._records("collections"):
		if not ui._status_matches(str(e.get("status",""))):continue
		var ids: PackedStringArray=[]
		for line: Dictionary in e.get("lines",[]):ids.append("%s × %s"%[line.get("qty",0),line.get("stackId","")])
		rows.push_front(ui._row(str(e.id),[e.id,e.get("carrierOrderId",""),e.get("equipmentId","; ".join(ids)),ui._mass(float(e.get("massKg",0))),e.get("status",""),str(e.get("phase",""))+" · "+str(e.get("note","")),ui._money(e.get("fees",{}).get("total",0))]))
	ui._set_table(index,rows)

func inspector(ui, e: Dictionary) -> void:
	for pair: Array in [["State","status"],["Phase","phase"],["Waiting","note"],["Carrier","carrierOrderId"],["Retiring equipment","equipmentId"]]:ui._detail(pair[0],e.get(pair[1],"—"))
	ui._detail("Weight",ui._mass(float(e.get("massKg",0))))
	var fees: Dictionary=e.get("fees",{})
	ui._detail("Transport",_price(fees.get("transport",0)))
	ui._detail("Disposal / handling",_price(fees.get("disposal",0)))
	ui._detail("Total",_price(fees.get("total",0)))
	ui._detail("Actually charged",_price(fees.get("charged",0)))
	ui._detail("Invoice","Invoiced" if fees.get("invoiced",false) else "Not invoiced yet")
	for line: Dictionary in e.get("lines",[]):
		ui._detail("Source stock","%s · %s × %s · reserved %s · loaded %s · collected %s"%[line.get("stackId",""),line.get("qty",0),ui._name(str(line.get("item",""))),line.get("reserved",0),line.get("loaded",0),line.get("collected",0)])
	var task: Dictionary=e.get("task",{})
	for pair: Array in [["Loading equipment","equipmentId"],["Operator","operatorId"],["Helper","helperId"]]:ui._detail(pair[0],task.get(pair[1],"—"))
	var handling: VBoxContainer=ui._section(ui.inspector_body,"Collection handling")
	ui._note(handling,"Pause is available when handling is safely stationary. Canceling releases material still in storage and safely returns a carried load. Cargo already secured to the carrier still leaves; an incurred arrival service fee remains payable.")
	if str(e.get("status","")) not in ["done","canceled"]:
		var id: String=str(e.id)
		ui._button(handling,"Resume collection" if e.get("status")=="paused" else "Pause collection",func()->void:ui._send("collection_resume" if e.get("status")=="paused" else "collection_pause",{"id":id}))
		ui._button(handling,"Cancel remaining collection",func()->void:ui._send("collection_cancel",{"id":id}))
