extends RefCounted
## Moving existing physical stock is owned-equipment work, including in Creative.
var window: Window
var quantity: SpinBox
var zone_choice: OptionButton
var zone_search: LineEdit
var source_note: Label
var preview_note: Label
var submit_button: Button
var refresh_button: Button
var source_id: String=""
var selected_zone: String=""
var request_serial: int=0
var preview_request: String=""
var move_request: String=""
var preview_arguments: Dictionary={}
var submitting: bool=false

func _stack(ui) -> Dictionary:
	for stack: Dictionary in ui._records("stacks"):
		if str(stack.get("id",""))==source_id:return stack
	return {}

func _zone_label(zone: Dictionary) -> String:
	return "%s · %s"%[zone.get("name","Stockyard"),zone.get("id","")]

func _next_request() -> String:
	request_serial+=1
	return "storage-move-%d"%request_serial

func _arguments() -> Dictionary:
	var args: Dictionary={"id":source_id,"quantity":int(quantity.value)}
	if not selected_zone.is_empty():args.zoneId=selected_zone
	return args

func _fill_zones(ui) -> void:
	zone_choice.clear()
	zone_choice.add_item("Automatic · choose a reachable stockyard")
	zone_choice.set_item_metadata(0,"")
	var zones: Array[Dictionary]=ui._records("zones")
	zones.sort_custom(func(a: Dictionary,b: Dictionary)->bool:return _zone_label(a).naturalnocasecmp_to(_zone_label(b))<0)
	var query: String=zone_search.text.to_lower().strip_edges()
	var found: bool=selected_zone.is_empty()
	for zone: Dictionary in zones:
		var label: String=_zone_label(zone)
		if not query.is_empty() and not label.to_lower().contains(query) and str(zone.id)!=selected_zone:continue
		zone_choice.add_item(label+" · %s × %s m"%[zone.get("w",0),zone.get("d",0)])
		zone_choice.set_item_metadata(zone_choice.item_count-1,str(zone.id))
		if str(zone.id)==selected_zone:zone_choice.select(zone_choice.item_count-1);found=true
	if not found:
		zone_choice.add_item(selected_zone+" · unavailable; choose another stockyard")
		zone_choice.set_item_metadata(zone_choice.item_count-1,selected_zone)
		zone_choice.set_item_disabled(zone_choice.item_count-1,true)
		zone_choice.select(zone_choice.item_count-1)

func open(ui, stack_id: String) -> void:
	if is_instance_valid(window):window.hide();window.queue_free()
	source_id=stack_id;selected_zone="";submitting=false;move_request=""
	var stack: Dictionary=_stack(ui)
	if stack.is_empty():ui.show_error("This stock is no longer on site.");return
	var dialog: Dictionary=ui._rail_dialog("Move material to storage",Vector2i(680,480))
	window=dialog.window
	var source: VBoxContainer=ui._section(dialog.body,"Source material")
	ui._label(source,"%s · %s"%[source_id,ui._name(str(stack.get("item","")))])
	source_note=ui._note(source,"")
	_show_source(ui,stack)
	ui._note(source,"Owned equipment and qualified workers physically lift and carry the selected units. Fuel and cable stay in their original drum or reel; moving them does not refill them. Active work must release its material first. This handling also takes place physically in Creative.")
	var available: int=maxi(0,int(stack.get("qty",0))-int(stack.get("reserved",0)))
	var options: VBoxContainer=ui._section(dialog.body,"Quantity and destination")
	quantity=ui._number(options,"Units to move",maxi(1,available),1,maxi(1,available))
	quantity.editable=available>0
	ui._label(options,"Destination stockyard · optional")
	zone_search=LineEdit.new()
	zone_search.placeholder_text="Filter stockyards by name or ID…";zone_search.clear_button_enabled=true
	options.add_child(zone_search)
	zone_choice=ui._option(options,[])
	zone_choice.fit_to_longest_item=false;zone_choice.clip_text=true
	_fill_zones(ui)
	zone_search.text_changed.connect(func(_text: String)->void:_fill_zones(ui))
	zone_choice.item_selected.connect(func(_index: int)->void:selected_zone=ui._selection(zone_choice);_request_preview(ui))
	quantity.value_changed.connect(func(_value: float)->void:_request_preview(ui))
	preview_note=ui._note(ui._section(dialog.body,"Move preview"),"")
	refresh_button=ui._button(dialog.footer,"Refresh preview",func()->void:_request_preview(ui))
	submit_button=ui._button(dialog.footer,"Create move work",func()->void:_submit(ui))
	submit_button.disabled=true
	ui._button(dialog.footer,"Cancel",func()->void:window.hide();window.queue_free())
	window.popup_centered()
	_request_preview(ui)

func _show_source(ui, stack: Dictionary) -> void:
	source_note.text="At %s · %d units · %d reserved"%[ui._position(stack),int(stack.get("qty",0)),int(stack.get("reserved",0))]
	if stack.get("item")=="cableReel":
		source_note.text+="\nCable remaining: %.1f / 50 m · %.1f m reserved for electrical work"%[float(stack.get("cableMeters",50)),float(stack.get("cableReservedMeters",0))]
		if float(stack.get("cableReservedSpaceMeters",0))>0:source_note.text+=" · %.1f m recovery capacity reserved"%float(stack.cableReservedSpaceMeters)
	elif stack.get("item")=="diesel":source_note.text+="\nDiesel remaining: %.1f L"%float(stack.get("liters",0))

func _request_preview(ui) -> void:
	if not is_instance_valid(window) or submitting:return
	preview_arguments=_arguments()
	preview_request=_next_request()
	var args: Dictionary=preview_arguments.duplicate(true);args.requestId=preview_request
	submit_button.disabled=true
	preview_note.text="Checking source reservations, a clear handling route, and finite storage space…"
	var stack: Dictionary=_stack(ui)
	if not stack.is_empty():_show_source(ui,stack)
	ui._send("storage_move_preview",args)

func _submit(ui) -> void:
	quantity.apply()
	if submitting or _arguments()!=preview_arguments or submit_button.disabled:return
	submitting=true;submit_button.disabled=true;refresh_button.disabled=true
	quantity.editable=false;zone_choice.disabled=true;zone_search.editable=false
	preview_note.text="Reserving the material and creating physical move work…"
	var args: Dictionary=preview_arguments.duplicate(true)
	move_request=_next_request();args.requestId=move_request
	ui._send("move_to_storage",args)

func receive(ui, message: Dictionary) -> void:
	if not is_instance_valid(window):return
	var action: String=str(message.get("action",""))
	if action not in ["storage_move_preview","move_to_storage"]:return
	var result: Dictionary=message.get("result",{})
	var request_id: String=str(result.get("requestId",message.get("requestId","")))
	if action=="storage_move_preview":
		if request_id!=preview_request or submitting or _arguments()!=preview_arguments:return
		var error: String=str(result.get("error",message.get("error","")))
		if not bool(message.get("ok",false)) and error.is_empty():error="Storage preview unavailable. Refresh and try again."
		if not error.is_empty():preview_note.text="Cannot move: "+error;submit_button.disabled=true;return
		var zone_id: String=str(result.get("zoneId",""))
		var label: String=zone_id
		for zone: Dictionary in ui._records("zones"):
			if str(zone.id)==zone_id:label=_zone_label(zone);break
		var destination: Dictionary=result.get("destination",{})
		if zone_id.is_empty() or destination.is_empty():preview_note.text="No reachable storage destination was returned. Refresh the preview.";submit_button.disabled=true;return
		preview_note.text="%d units · %s\n%s → %s\nPlacement: %s · %s × %s m\nSpace and reservations are checked again when work is created."%[int(result.get("quantity",quantity.value)),ui._mass(float(result.get("mass",0))),"Automatic choice" if selected_zone.is_empty() else "Selected stockyard",label,ui._position(destination),destination.get("w",1),destination.get("d",1)]
		submit_button.disabled=false
	elif request_id==move_request and submitting:
		var error: String=str(result.get("error",message.get("error","")))
		if not bool(message.get("ok",false)) or not error.is_empty():
			preview_note.text="Could not create move work: "+(error if not error.is_empty() else "Source or destination changed. Refresh and try again.")
			submitting=false;refresh_button.disabled=false;quantity.editable=true;zone_choice.disabled=false;zone_search.editable=true
			return
		var work_id: String=str(result.get("groupId",result.get("job",{}).get("id","")))
		window.hide();window.queue_free()
		ui.show_tab("Work")
		if not work_id.is_empty():ui.show_entity(work_id)
