extends SceneTree
## Exercise real catalog grouping, typed batches, popup focus, and bounded scrolling.
const UI=preload("res://scripts/game_ui.gd")
var failures: Array[String]=[]
var checks: int=0
var actions: Array[Dictionary]=[]
func _initialize()->void:_run.call_deferred()
func _check(value: bool,message: String)->void:
	checks+=1
	if not value:failures.append(message)
func _button(node: Node,text: String)->Button:
	if node is Button and node.text==text:return node
	for child: Node in node.get_children():
		var found: Button=_button(child,text)
		if found:return found
	return null
func _text(node: Node)->String:
	var value: String=node.text if node is Label else ""
	for child: Node in node.get_children():value+="\n"+_text(child)
	return value
func _type(ui: CanvasLayer,key: String,value: String)->void:
	var edit: LineEdit=ui.purchase_quantity[key].get_line_edit()
	edit.text=value;edit.text_changed.emit(value)
func _key(key: Key)->InputEventKey:
	var event:=InputEventKey.new()
	event.keycode=key;event.physical_keycode=key;event.pressed=true
	return event
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.erase("purchaseGroups")
	fixture.state.zones=[{"id":"ZONE-1001","name":"Receiving stockyard","x":30,"z":20,"w":12,"d":12}]
	fixture.state.railLocations=[{"id":"LOC-1001","name":"Goods reception","kind":"unloading","length":160}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action: String,args: Dictionary)->void:actions.append({"action":action,"args":args.duplicate(true)}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.show_purchase()
	# The headless display has a 1 px screen; restore the intended popup viewport.
	ui.purchase_window.size=Vector2i(960,760)
	await process_frame;await process_frame
	_check(ui.purchase_window.visible,"Purchase dialog opens with actual controls")
	_check(ui._purchase_groups()[0].id=="workers" and ui._purchase_groups()[1].id=="equipment","Legacy fixtures retain workers first, then equipment")
	_check(not ui.purchase_quantity.has("power"),"Incoming electricity is absent even from a legacy purchase catalog")
	_check(ui.purchase_quantity.slab.max_value==1000,"Quantity editors enforce the API limit of 1,000 per item")
	_check(not ui.purchase_quantity.slab.tooltip_text.is_empty(),"Materials retain their quantity tooltip")
	_check(ui.purchase_quantity.has("water") and ui.purchase_quantity.has("cableReel"),"Water service and electrical materials remain purchasable")
	_check(ui.purchase_catalog_scroll.get_v_scroll_bar().max_value>ui.purchase_catalog_scroll.size.y,"Long catalog is bounded and scrolls inside its dialog")
	_check(ui.purchase_window.size.x==960 and ui.purchase_window.size.y==760,"Purchase dialog remains bounded to the intended desktop size: "+str(ui.purchase_window.size))
	var builder: LineEdit=ui.purchase_quantity.builder.get_line_edit()
	builder.grab_focus();await process_frame
	_check(ui.purchase_window.gui_get_focus_owner()==builder,"Quantity editor owns the actual popup keyboard focus")
	var focused: StyleBoxFlat=ui.purchase_rows.builder.get_theme_stylebox("panel")
	_check(focused.border_color==Color("4c7258") and focused.border_width_top==2,"Focused quantity highlights its complete catalog row")
	ui.purchase_window.push_input(_key(KEY_TAB));await process_frame
	_check(ui.purchase_window.gui_get_focus_owner()==ui.purchase_quantity.operator.get_line_edit(),"Tab advances to the next worker quantity in displayed order")
	_type(ui,"builder","6");_type(ui,"slab","10")
	_check(ui._purchase_lines()==[{"item":"builder","qty":6},{"item":"slab","qty":10}],"Uncommitted whole quantities form the actual grouped batch")
	_check(ui.purchase_rows.builder.get_meta("in_batch") and ui.purchase_rows.slab.get_meta("in_batch"),"Both selected rows retain their batch highlighting")
	_check(ui.purchase_mass_labels.slab.text==ui._mass(2800) and ui.purchase_cost_labels.slab.text==ui._money(380),"Row mass and cost reflect the typed quantity")
	_check(_text(ui.purchase_manifest).contains("× 6") and _text(ui.purchase_manifest).contains("× 10") and _text(ui.purchase_manifest).contains(ui._money(380)),"Batch manifest visibly retains every selected quantity and line cost")
	var old_version: int=ui.purchase_preview_version
	_type(ui,"slab","11")
	ui.receive_reply({"action":"purchase_preview","ok":true,"result":{"requestId":old_version,"mass":2800,"transportCost":180,"loads":[{},{}]}})
	_check(ui.purchase_total.text.contains(ui._mass(3080)) and not ui.purchase_total.text.contains("2 carrier loads"),"Late preview cannot overwrite a changed nonempty batch")
	_type(ui,"slab","10")
	ui.receive_reply({"action":"purchase_preview","ok":true,"result":{"requestId":ui.purchase_preview_version,"mass":2800,"transportCost":180,"loads":[{},{}]}})
	_check(ui.purchase_total.text.contains(ui._money(1100)) and ui.purchase_total.text.contains("2 carrier loads"),"Preview summary includes actual material, hire and freight costs")
	_check(not ui.purchase_batch.disabled,"A nonempty actual batch can be ordered")
	ui.purchase_quantity.water.get_line_edit().grab_focus();await process_frame;await process_frame
	_check(ui.purchase_catalog_scroll.scroll_vertical>0,"Keyboard focus follows a late catalog row into view")
	ui.purchase_rows.slab.mouse_entered.emit()
	_check((ui.purchase_rows.slab.get_theme_stylebox("panel") as StyleBoxFlat).bg_color==Color("d0e0c6"),"Hover adds a distinct treatment to an already selected row")
	ui.purchase_rows.slab.mouse_exited.emit()
	_check((ui.purchase_rows.slab.get_theme_stylebox("panel") as StyleBoxFlat).bg_color==Color("dce9d1"),"Selected styling persists after hover leaves")
	_check(is_equal_approx(ui.purchase_mass_labels.builder.global_position.x,ui.purchase_mass_labels.slab.global_position.x),"Numeric catalog columns stay aligned across groups")
	var headings: HBoxContainer=ui.purchase_window.find_child("PurchaseColumnHeadings",true,false)
	_check(is_equal_approx(ui.purchase_quantity.builder.global_position.x,headings.get_child(3).global_position.x),"Column headings align with their actual quantity editors")
	ui.purchase_mode.select(1);ui.purchase_mode.item_selected.emit(1)
	ui.purchase_reception.select(1);ui.purchase_reception.item_selected.emit(1)
	ui.purchase_stockyard.select(1);ui.purchase_stockyard.item_selected.emit(1)
	_check(ui.purchase_rail_controls.visible,"Rail mode exposes reception and unloading stockyard controls")
	ui._place_purchase()
	_check(actions.back().action=="purchase_batch" and actions.back().args.lines==[{"item":"builder","qty":6},{"item":"slab","qty":10}],"Place order sends the exact visible batch manifest")
	_check(actions.back().args.get("mode")=="rail" and actions.back().args.get("railLocationId")=="LOC-1001" and actions.back().args.get("storageZoneId")=="ZONE-1001","Batch preserves actual transport, reception and stockyard choices")
	ui.receive_reply({"action":"purchase_batch","ok":true});ui.show_purchase();await process_frame
	_check(ui._selection(ui.purchase_reception)=="LOC-1001" and ui._selection(ui.purchase_stockyard)=="ZONE-1001","Reopening preserves the chosen rail destinations")
	_check(ui._purchase_lines().is_empty() and not ui.purchase_rows.slab.get_meta("in_batch") and ui.purchase_batch.disabled,"Successful ordering resets quantities, highlights and submission state")
	ui.receive_reply({"action":"purchase_preview","ok":true,"result":{"mass":2800,"transportCost":180,"loads":[{},{}]}})
	_check(not ui.purchase_total.text.contains("2 carrier loads"),"A stale preview cannot repopulate an empty batch summary")
	_type(ui,"slab","3")
	_button(ui.purchase_window,"Clear quantities").pressed.emit()
	_check(ui._purchase_lines().is_empty() and not ui.purchase_rows.slab.get_meta("in_batch"),"Clear quantities also resets visibly selected rows")
	_type(ui,"slab","1001")
	var before: int=actions.size()
	ui._place_purchase()
	_check(ui.purchase_batch.disabled and actions.size()==before and ui.purchase_total.text.contains("1,000"),"Dirty typed quantities over the API limit cannot submit an altered batch")
	ui.purchase_window.queue_free();ui.queue_free();await process_frame
	var grouped:=UI.new();root.add_child(grouped);grouped.setup();grouped.set_process(false)
	fixture.purchaseGroups=[{"id":"workers","name":"Site crew","items":["operator","builder","power"]},{"id":"electrical","name":"Electrical work","items":["cableReel","lamp"]}]
	grouped.update_snapshot(fixture)
	var groups: Array[Dictionary]=grouped._purchase_groups()
	_check(groups[0].name=="Site crew" and groups[0].items==["operator","builder"] and groups[1].items==["cableReel","lamp"],"Service group order is honored and forbidden utility installation is filtered")
	_check(groups.back().id=="other","Unknown legacy catalog additions remain available in a fallback group")
	grouped.queue_free();await process_frame
	print("PURCHASING_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"gpuRendering":false,"serviceStarted":false}))
	quit(0 if failures.is_empty() else 1)
