extends SceneTree
## Production UI audit using synthetic snapshots only. No client, service, or save is opened.
## Headless: godot --headless --path native --script res://tests/ui_readability_smoke.gd
## Screenshots: omit --headless and append -- --capture-dir=/tmp/plant01-readability
## Packaged assets: append --fixture-path=/absolute/repository/native/tests/renderer-fixtures.json
const UI=preload("res://scripts/game_ui.gd")
const Audio=preload("res://scripts/game_audio.gd")
const REQUIRED_TABS: Array[String]=["Yard","Railway","Process","Electrical","Materials","Workers","Equipment","Deliveries","Work","Activity","Costs","SQL","Inbox"]
const VIEWPORTS: Array[Vector2i]=[Vector2i(1440,900),Vector2i(1280,800)]
var failures: Array[String]=[]
var checks: int=0
var measurements: Array[Dictionary]=[]
var captures: Array[String]=[]
var visited: Array[String]=[]
var states: Array[String]=[]
var audited_colors: Dictionary={}
var horizontal_inventory: Dictionary={}
var icon_images: Dictionary={}
var icon_ink_counts: Dictionary={}
var capture_dir: String=""
var fixture_path: String="res://tests/renderer-fixtures.json"
var ui: CanvasLayer

func _initialize()->void:_run.call_deferred()

func _check(value: bool,message: String)->void:
	checks+=1
	if not value and message not in failures:failures.append(message)

func _settle()->void:
	await process_frame
	await process_frame
	await process_frame

func _nodes(node: Node,type: String)->Array:
	var found: Array=[]
	if node.is_class(type):found.append(node)
	# AcceptDialog buttons and SpinBox editors are engine-owned internal nodes.
	for child: Node in node.get_children(true):found.append_array(_nodes(child,type))
	return found

func _button(node: Node,text: String)->Button:
	for candidate: Button in _nodes(node,"Button"):
		if candidate.text==text:return candidate
	return null

func _window(title: String)->Window:
	for candidate: Window in _nodes(ui,"Window"):
		if candidate.title==title:return candidate
	return null

func _over(front: Color,back: Color)->Color:
	return Color(front.r*front.a+back.r*(1.0-front.a),front.g*front.a+back.g*(1.0-front.a),front.b*front.a+back.b*(1.0-front.a),1)

func _linear(value: float)->float:
	return value/12.92 if value<=0.04045 else pow((value+0.055)/1.055,2.4)

func _luminance(value: Color)->float:
	return .2126*_linear(value.r)+.7152*_linear(value.g)+.0722*_linear(value.b)

func _ratio(front: Color,back: Color)->float:
	var a: float=_luminance(_over(front,back))
	var b: float=_luminance(back)
	return (maxf(a,b)+.05)/(minf(a,b)+.05)

func _contrast(front: Color,back: Color,minimum: float,label: String)->void:
	# Repeated controls still receive layout checks; identical resolved paints
	# need one contrast measurement, keeping the diagnostic report readable.
	var key: String="%s/%s/%s"%[front.to_html(true),back.to_html(true),minimum]
	if audited_colors.has(key):return
	audited_colors[key]=true
	var ratio: float=_ratio(front,back)
	measurements.append({"context":label,"ratio":snappedf(ratio,.01),"required":minimum,"foreground":front.to_html(true),"background":back.to_html(true)})
	_check(ratio+.001>=minimum,"%s contrast %.2f:1 is below %.1f:1"%[label,ratio,minimum])

func _style_background(node: Node,key: String,under: Color)->Color:
	var box: StyleBox=node.get_theme_stylebox(key)
	if box is StyleBoxFlat:return _over(box.bg_color,under) if box.draw_center else under
	return under

func _background(node: Node)->Color:
	var parent: Node=node.get_parent()
	if parent==null:return Color(ProjectSettings.get_setting("rendering/environment/defaults/default_clear_color",Color.WHITE))
	var under: Color=_background(parent)
	if parent is PanelContainer:return _style_background(parent,"panel",under)
	if parent is Window:
		var paper: Node=parent.get_node_or_null("PaperBackground")
		if paper is PanelContainer:return _style_background(paper,"panel",under)
		if parent is AcceptDialog or parent is PopupMenu:return _style_background(parent,"panel",under)
	return under

func _painted(node: Control)->bool:
	if not node.is_visible_in_tree():return false
	var viewport: Viewport=node.get_viewport()
	return not viewport is Window or viewport==root or viewport.visible

func _clip_rect(node: Control)->Rect2:
	var rect: Rect2=node.get_global_rect()
	var parent: Node=node.get_parent()
	while parent:
		if parent is Control and parent.clip_contents:rect=rect.intersection(parent.get_global_rect())
		parent=parent.get_parent()
	return rect.intersection(Rect2(Vector2.ZERO,Vector2(node.get_viewport().size)))

func _font_height(node: Control,key: String="font")->float:
	return node.get_theme_font(key).get_height(node.get_theme_font_size("font_size"))

func _focus(node: Control,label: String)->void:
	var box: StyleBox=node.get_theme_stylebox("focus")
	_check(box is StyleBoxFlat,label+" has a measurable focus outline")
	if box is StyleBoxFlat:
		_check(mini(mini(box.border_width_left,box.border_width_right),mini(box.border_width_top,box.border_width_bottom))>=1,label+" focus outline remains visible on every edge")
		_contrast(box.border_color,_background(node),3,label+" focus outline")

func _icon_ink(icon: Texture2D,modulation: Color,background: Color)->int:
	var texture_id: int=icon.get_instance_id()
	var key: String="%s/%s/%s"%[texture_id,modulation.to_html(true),background.to_html(true)]
	if icon_ink_counts.has(key):return int(icon_ink_counts[key])
	# ImageTexture.get_image() reads back from the real GPU. Themes share their
	# immutable icons, so read each texture once instead of imposing hundreds
	# of GPU synchronization points while auditing repeated controls.
	if not icon_images.has(texture_id):icon_images[texture_id]=icon.get_image()
	var image: Image=icon_images[texture_id]
	var useful: int=0
	if image:
		for y: int in image.get_height():
			for x: int in image.get_width():
				var pixel: Color=image.get_pixel(x,y)*modulation
				if pixel.a>.8 and _ratio(pixel,background)>=3:useful+=1
	icon_ink_counts[key]=useful
	return useful

func _button_colors(button: Button,label: String)->void:
	var under: Color=_background(button)
	var style_keys: Array[String]=["normal","hover","pressed","hover_pressed","disabled"]
	var color_keys: Array[String]=["font_color","font_hover_color","font_pressed_color","font_hover_pressed_color","font_disabled_color"]
	for i: int in style_keys.size():
		_contrast(button.get_theme_color(color_keys[i]),_style_background(button,style_keys[i],under),3.0 if style_keys[i]=="disabled" else 4.5,label+" "+style_keys[i])
	_focus(button,label)
	if button is CheckButton or button is CheckBox:
		for icon_name: String in ["checked","unchecked","checked_disabled","unchecked_disabled"]:
			var icon: Texture2D=button.get_theme_icon(icon_name)
			_check(icon!=null,label+" "+icon_name+" has a visible state indicator")
			if icon:
				var useful: int=_icon_ink(icon,Color.WHITE,_style_background(button,"normal",under))
				_check(useful>=4,label+" "+icon_name+" indicator has discernible ink against its surface")

func _input_colors(input: Control,label: String)->void:
	var back: Color=_style_background(input,"normal",_background(input))
	_contrast(input.get_theme_color("font_color"),back,4.5,label+" text")
	_contrast(input.get_theme_color("font_placeholder_color"),back,4.5,label+" placeholder")
	var read_only: Color=_style_background(input,"read_only",_background(input))
	_contrast(input.get_theme_color("font_readonly_color" if input is TextEdit else "font_uneditable_color"),read_only,4.5,label+" read-only")
	var selected: Color=_over(input.get_theme_color("selection_color"),back)
	var selected_ink: Color=input.get_theme_color("font_selected_color")
	# TextEdit explicitly treats transparent selected ink as the ordinary ink.
	if input is TextEdit and selected_ink==Color.TRANSPARENT:selected_ink=input.get_theme_color("font_color")
	_contrast(selected_ink,selected,4.5,label+" selected text")
	_focus(input,label)

func _spinbox_icons(input: SpinBox,label: String)->void:
	for direction: String in ["up","down"]:
		for suffix: String in ["","_hover","_pressed","_disabled"]:
			var key: String=direction+suffix
			var icon: Texture2D=input.get_theme_icon(key)
			_check(icon!=null,label+" "+key+" arrow exists")
			if not icon:continue
			var modulation: Color=input.get_theme_color(key+"_icon_modulate")
			var background: Color=_style_background(input.get_line_edit(),"read_only" if suffix=="_disabled" else "normal",_background(input))
			var ink_pixels: int=_icon_ink(icon,modulation,background)
			_check(ink_pixels>=4,label+" "+key+" arrow has discernible ink after actual state modulation")

func _tree_colors(tree: Tree,label: String)->void:
	var back: Color=_style_background(tree,"panel",_background(tree))
	_contrast(tree.get_theme_color("font_color"),back,4.5,label+" row text")
	for key: String in ["title_button_normal","title_button_hover","title_button_pressed"]:
		_contrast(tree.get_theme_color("title_button_color"),_style_background(tree,key,back),4.5,label+" "+key)
	for key: String in ["selected","selected_focus"]:
		_contrast(tree.get_theme_color("font_selected_color"),_style_background(tree,key,back),4.5,label+" "+key)
	var item: TreeItem=tree.get_root().get_first_child() if tree.get_root() else null
	while item:
		for column: int in tree.columns:
			var cell_back: Color=_over(item.get_custom_bg_color(column),back)
			var custom: Color=item.get_custom_color(column)
			var ink: Color=custom if custom.a>0 else tree.get_theme_color("font_color")
			_contrast(ink,cell_back,4.5,label+" cell "+item.get_text(column).left(45))
			if custom.a>0:
				_contrast(custom,_style_background(tree,"selected_focus",back),4.5,label+" selected custom cell "+item.get_text(column).left(45))
		item=item.get_next()

func _audit(node: Node,context: String)->void:
	for control: Control in _nodes(node,"Control"):
		if not _painted(control):continue
		var label: String=context+" / "+control.get_class()
		if control is SpinBox:_spinbox_icons(control,label)
		elif control is Button:
			label+=" "+control.text.left(55)
			_button_colors(control,label)
			if not _clip_rect(control).has_area():continue
			_check(control.size.y>=_font_height(control)+6,label+" has usable vertical padding")
		elif control is LineEdit or control is TextEdit:
			_input_colors(control,label)
			if _clip_rect(control).has_area():_check(control.size.y>=_font_height(control)+6,label+" does not clip its text vertically")
		elif control is Tree:_tree_colors(control,label)
		elif control is Label and not control.text.is_empty():
			label+=" "+control.text.left(65)
			_contrast(control.get_theme_color("font_color"),_background(control),4.5,label)
			_check(control.get_theme_font_size("font_size")>=12,label+" remains at least 12 px")
		elif control is RichTextLabel and not control.text.is_empty():
			_contrast(control.get_theme_color("default_color"),_background(control),4.5,label)

func _popup(menu: PopupMenu,label: String)->void:
	var back: Color=_style_background(menu,"panel",_background(menu))
	_contrast(menu.get_theme_color("font_color"),back,4.5,label+" normal")
	_contrast(menu.get_theme_color("font_disabled_color"),back,3,label+" disabled")
	_contrast(menu.get_theme_color("font_hover_color"),_style_background(menu,"hover",back),4.5,label+" keyboard-selected")

func _capture(label: String)->void:
	visited.append(label)
	if capture_dir.is_empty():return
	await RenderingServer.frame_post_draw
	var path: String=capture_dir.path_join(label.validate_filename()+".png")
	var error: Error=root.get_texture().get_image().save_png(path)
	_check(error==OK,"Screenshot saved: "+label)
	if error==OK:captures.append(path)

func _snapshot()->Dictionary:
	_check(FileAccess.file_exists(fixture_path),"Synthetic renderer fixture exists: "+fixture_path)
	if not FileAccess.file_exists(fixture_path):return {}
	var parsed: Variant=JSON.parse_string(FileAccess.get_file_as_string(fixture_path))
	_check(parsed is Dictionary and parsed.get("demo") is Dictionary,"Fixture has the synthetic demo snapshot")
	if not parsed is Dictionary or not parsed.get("demo") is Dictionary:return {}
	var value: Dictionary=parsed.demo.duplicate(true)
	value.state.notices=[{"id":"N-9001","time":36000,"title":"Blocked unloading route","detail":"Warning: receiving forklift is waiting for EQ-0006 to clear the physical stockyard approach.","entity":"EQ-0006","state":"todo","seen":true,"severity":"warning"}]
	value.state.events.append({"id":"EV-9001","time":36001,"type":"Logistics","entity":"EQ-0006","text":"Warning: route blocked by an idle machine; waiting for a safe clearance.","severity":"warning"})
	value.state.jobs=[{"id":"JOB-9001","kind":"foundation","status":"doing","progress":.4,"phase":"Lay concrete slab","reason":"Warning: waiting for physical delivery","worker":"WRK-0001","equipment":"EQ-0006","x":32,"z":34,"w":4,"d":4}]
	value.workRows=[{"id":"JOB-9001","label":"Receiving apron foundation","group":false,"status":"doing","progress":.4,"depth":0,"worker":"WRK-0001","equipment":"EQ-0006","reason":"Warning: waiting for physical delivery"}]
	value.state.orders.append({"id":"PO-9001","item":"slab","qty":24,"arrived":4,"mode":"road","status":"unloading","eta":36000,"total":1092,"note":"Warning: carrier waiting for a clear unloading berth"})
	value.state.railLocations=[{"id":"LOC-9001","name":"North receiving siding","kind":"unloading","trackId":"BOOTSTRAP-SIDING","offset":30,"length":40}]
	value.inventory=[{"item":"slab","delivered":72,"incoming":20,"stored":48,"reserved":4,"cargo":0,"outbound":0,"installed":24,"inConstruction":0,"collected":0},{"item":"diesel","delivered":2,"incoming":0,"stored":2,"reserved":0,"cargo":0,"outbound":0,"installed":0,"inConstruction":0,"collected":0}]
	var source: Dictionary={"id":"BLD-9001","kind":"power","name":"West incoming station","x":20,"z":20,"w":1,"d":1,"connected":true,"capacityKw":16,"demandKw":2.1,"availableKw":13.9,"energized":true}
	var lamp: Dictionary={"id":"BLD-9002","kind":"lamp","name":"North yard lighting","x":30,"z":24,"w":1,"d":1,"ratedKw":.1,"loadKw":.1,"powered":true,"sourceId":"BLD-9001","rootSourceId":"BLD-9001","runIds":["ELEC-9001"]}
	value.state.buildings.append_array([source,lamp])
	var run: Dictionary={"id":"ELEC-9001","sourceId":source.id,"targetId":lamp.id,"jobId":"JOB-9001","status":"working","phase":"dig","reason":"Warning: waiting for excavator approach","cells":[],"cableInHand":0}
	value.electrical={"sources":[source],"junctions":[lamp],"consumers":[lamp],"runs":[run]}
	value.state.electrical={"runs":[run],"meterLedger":[{"id":"CABLE-9001","runId":run.id,"time":36000,"from":"STK-9001","to":"WRK-0001","meters":1,"reason":"Withdraw cable"}]}
	value.process={"tanks":[{"id":"BLD-9003","product":"bulkWater","liters":20000,"capacity":30000,"status":"Ready"}],"pumps":[{"id":"BLD-9004","carId":"CAR-9001","tankId":"BLD-9003","hose":"connected","enabled":false,"flow":0,"transferred":250,"status":"Warning: no commissioned supply"}],"lines":[{"id":"BLD-9005","kind":"processPipe","product":"bulkWater","liters":7.854,"capacity":7.854,"status":"Filled"}],"valves":[{"id":"BLD-9006","open":false,"status":"Closed"}],"gauges":[{"id":"BLD-9007","product":"bulkWater","level":20000,"capacity":30000,"reading":0,"status":"Connected"}],"operations":[{"id":"PROCESS-9001","kind":"connect","buildingId":"BLD-9004","carId":"CAR-9001","workerId":"WRK-0001","phase":"at-car","clock":2,"status":"Connect hose"}]}
	return value

func _tab_layout(tab: String,size: Vector2i)->void:
	var viewport: Rect2=Rect2(Vector2.ZERO,Vector2(size))
	var last: Rect2=Rect2()
	for name: String in REQUIRED_TABS:
		var button: Button=ui.tab_buttons.get(name)
		_check(button!=null,"Tab exists: "+name)
		if not button:continue
		var rect: Rect2=button.get_global_rect()
		_check(viewport.encloses(rect),"%s at %s: %s tab remains inside the window"%[tab,size,name])
		_check(not rect.intersects(last),"%s at %s: navigation buttons do not overlap"%[tab,size])
		last=rect
	_check(viewport.encloses(ui.inspector.get_global_rect()),"%s at %s: open inspector fits inside the viewport"%[tab,size])
	if tab!="Yard":
		_check(not ui.register_panel.get_global_rect().intersects(ui.inspector.get_global_rect()),"%s at %s: register and inspector do not overlap"%[tab,size])
		_check(viewport.encloses(ui.register_panel.get_global_rect()),"%s at %s: register fits inside the viewport"%[tab,size])
	for table: Control in ui.tables:
		var tree: Tree=table.tree
		_check(tree.size.y>=_font_height(tree)*3+12,"%s at %s: table has room for headings and two readable rows"%[tab,size])
		for i: int in tree.columns:
			_check(not tree.get_column_title(i).is_empty(),tab+": every column retains its heading")
		var row: TreeItem=tree.get_root().get_first_child() if tree.get_root() else null
		if row:
			var area: Rect2=tree.get_item_area_rect(row,0)
			_check(area.size.y>=_font_height(tree)+2,tab+": real table rows do not clip their font")
	if not ui.tables.is_empty():
		var final: Control=ui.tables.back()
		var ancestor: Node=final.get_parent()
		var scroll: ScrollContainer=null
		while ancestor and ancestor!=ui.register_panel:
			if ancestor is ScrollContainer:scroll=ancestor;break
			ancestor=ancestor.get_parent()
		if scroll:
			scroll.scroll_vertical=int(scroll.get_v_scroll_bar().max_value)
			await _settle()
			_check(_clip_rect(final.tree).has_area(),tab+": the final table can be reached by scrolling")
			scroll.scroll_vertical=0
			await _settle()
		else:_check(_clip_rect(final.tree).has_area(),tab+": the final table is visible or reachable in a register scroll")

func _horizontal_inventory()->void:
	var tree: Tree=ui.tables[0].tree
	var bar: HScrollBar=null
	# Tree's hidden popup editor has its own scrollbar; inspect the one that
	# belongs to the actual records viewport, not a nested editing control.
	for child: Node in tree.get_children(true):
		if child is HScrollBar:bar=child
	_check(bar!=null,"Narrow inventory exposes a real horizontal scrollbar")
	if not bar:return
	_check(bar.is_visible_in_tree() and _clip_rect(bar).has_area() and bar.size.y>=8,"Narrow inventory scrollbar is visible and tall enough to grab")
	_check(bar.max_value>bar.page,"Narrow inventory scrollbar has a real overflow range")
	var row: TreeItem=tree.get_root().get_first_child()
	_check(row!=null,"Horizontal scrolling uses an actual inventory record")
	if not row:return
	var last: int=tree.columns-1
	var before: Rect2=tree.get_item_area_rect(row,last)
	_check(before.end.x>tree.size.x,"The final inventory column initially extends beyond the viewport")
	bar.value=bar.max_value
	await _settle()
	var cell: Rect2=tree.get_item_area_rect(row,last)
	var right: float=tree.size.x-tree.get_theme_stylebox("panel").get_content_margin(SIDE_RIGHT)
	for child: Node in tree.get_children(true):
		if child is VScrollBar and child.is_visible_in_tree():right-=child.size.x
	_check(bar.value>0 and cell.position.x<before.position.x,"Scrolling all the way right moves the actual final inventory cell into view")
	_check(cell.position.x>=0 and cell.end.x<=right+1,"The complete final inventory column fits after scrolling right")
	_check(_clip_rect(tree).encloses(Rect2(tree.global_position+cell.position,cell.size)),"The actual final inventory row is visible after scrolling")
	var heading: String=tree.get_column_title(last)
	var style: StyleBox=tree.get_theme_stylebox("title_button_normal")
	var available_width: float=cell.size.x-style.get_content_margin(SIDE_LEFT)-style.get_content_margin(SIDE_RIGHT)
	var available_height: float=cell.position.y-tree.get_theme_stylebox("panel").get_content_margin(SIDE_TOP)
	# Tree titles may wrap on word boundaries. Measure the wrapped text against
	# the actual title area above the first record instead of requiring one line.
	var title_size: Vector2=tree.get_theme_font("title_button_font").get_multiline_string_size(heading,HORIZONTAL_ALIGNMENT_LEFT,available_width,tree.get_theme_font_size("title_button_font_size"),-1,TextServer.BREAK_MANDATORY|TextServer.BREAK_WORD_BOUND)
	horizontal_inventory={"viewport":str(root.size),"treeSize":str(tree.size),"scrollbarSize":str(bar.size),"visible":bar.is_visible_in_tree(),"range":bar.max_value,"page":bar.page,"value":bar.value,"cellBefore":str(before),"cellAfter":str(cell),"header":heading,"headerTextSize":str(title_size),"headerAvailableSize":str(Vector2(available_width,available_height)),"columnWidth":cell.size.x}
	_check(title_size.x<=available_width+1 and title_size.y+style.get_content_margin(SIDE_TOP)+style.get_content_margin(SIDE_BOTTOM)<=available_height+1,"The final inventory header is readable in full, including wrapped lines")
	_check(not row.get_text(last).is_empty(),"The final inventory cell retains real material mass")
	await _capture("1280x800_materials_final_column")
	bar.value=0
	await _settle()
	_check(is_zero_approx(bar.value),"Inventory horizontal scroll resets for the remaining audit")

func _help(size: Vector2i)->void:
	ui.show_tab("Help");await _settle()
	_check(not ui.inspector.visible,"Help at %s hides the inspector to make room for reading"%size)
	_check(Rect2(Vector2.ZERO,Vector2(size)).encloses(ui.register_panel.get_global_rect()),"Help at %s fits inside the desktop"%size)
	var scrolls: Array=_nodes(ui.register_panel,"ScrollContainer")
	_check(scrolls.size()==1,"Help uses one continuous scroll surface")
	var labels: Array=_nodes(ui.register_body,"Label")
	_check(labels.size()>=10,"Help retains its substantive operations guidance")
	if labels.is_empty() or scrolls.is_empty():return
	var scroll: ScrollContainer=scrolls[0]
	var final: Label=labels.back()
	_check(final.text.strip_edges().length()>20,"Help ends with a real readable paragraph")
	_check(scroll.get_v_scroll_bar().max_value>scroll.get_v_scroll_bar().page,"Long Help guidance has a real scroll range")
	scroll.scroll_vertical=0;await _settle()
	_audit(ui.register_panel,"Help %s"%size)
	await _capture("%dx%d_help"%[size.x,size.y])
	scroll.scroll_vertical=int(scroll.get_v_scroll_bar().max_value);await _settle()
	_check(_clip_rect(final).size.y+1>=final.size.y and _clip_rect(final).has_area(),"Help at %s exposes the complete final paragraph"%size)
	await _capture("%dx%d_help_end"%[size.x,size.y])
	scroll.scroll_vertical=0

func _sql_and_inspector(snapshot: Dictionary)->void:
	ui.show_tab("SQL");await _settle()
	ui.receive_reply({"action":"sql","ok":true,"result":[{"columns":["id","fuel"],"values":[["EQ-0006",42.5]]}]})
	await _settle()
	_check(ui.sql_table.rows.size()==1,"SQL populated reply displays its real record")
	ui.query_text.select_all();ui.query_text.grab_focus()
	_audit(ui.register_panel,"SQL selected query")
	await _capture("sql_selected_text")
	ui.receive_reply({"action":"sql","ok":true,"result":[]})
	await _settle()
	_check(ui.sql_table.rows.is_empty() and ui.sql_table.tree.get_root().get_child_count()==0,"SQL empty reply clears previously visible results")
	ui.show_tab("Equipment");ui.show_entity("EQ-0006");await _settle()
	var bar: VScrollBar=ui.inspector_scroll.get_v_scroll_bar()
	_check(bar.max_value>bar.page,"Equipment inspector offers real scrollable content")
	ui.inspector_scroll.scroll_vertical=mini(100,int(bar.max_value-bar.page))
	await _settle()
	var before: int=ui.inspector_scroll.scroll_vertical
	_check(before>0,"Inspector scroll regression starts below the heading")
	ui.update_snapshot(snapshot);ui._render_inspector();await _settle()
	_check(abs(ui.inspector_scroll.scroll_vertical-before)<=2,"Refreshing the same entity preserves inspector scroll")
	ui.show_entity("WRK-0001");await _settle()
	_check(ui.inspector_scroll.scroll_vertical==0,"Selecting a new entity resets inspector scroll to its heading")
	await _capture("inspector_new_entity")

func _pointer_viewport(button: Button)->Viewport:
	var viewport: Viewport=button.get_viewport()
	# Embedded-window hover belongs to the embedder. Sending a mouse event
	# directly to its child Viewport bypasses that real window routing.
	return root if viewport is Window and viewport!=root and viewport.is_embedded() else viewport

func _pointer_position(button: Button,blank: bool=false)->Vector2:
	var point: Vector2=Vector2(1,1) if blank else button.get_global_rect().get_center()
	var viewport: Viewport=button.get_viewport()
	if _pointer_viewport(button)!=viewport:point+=Vector2(viewport.position)
	return point

func _mouse(button: Button,pressed: bool)->void:
	var event:=InputEventMouseButton.new()
	event.position=_pointer_position(button);event.global_position=event.position
	event.button_index=MOUSE_BUTTON_LEFT;event.pressed=pressed
	_pointer_viewport(button).push_input(event,true)

func _control_states(button: Button,label: String)->void:
	_check(button!=null,label+": representative production button exists")
	if not button:return
	_button_colors(button,label)
	_check(button.size.y>=_font_height(button)+6,label+": real action has usable text padding")
	var viewport: Viewport=_pointer_viewport(button)
	if DisplayServer.get_name()=="headless":viewport.notify_mouse_entered()
	var motion:=InputEventMouseMotion.new()
	motion.position=_pointer_position(button,true);viewport.push_input(motion,true);await _settle()
	states.append("normal");await _capture(label+"_normal")
	motion=InputEventMouseMotion.new();motion.position=_pointer_position(button);motion.global_position=motion.position
	viewport.push_input(motion,true);await _settle()
	_check(button.is_hovered(),label+": actual pointer enters the button")
	states.append("hover");await _capture(label+"_hover")
	_mouse(button,true);await _settle()
	_check(button.get_draw_mode() in [BaseButton.DRAW_PRESSED,BaseButton.DRAW_HOVER_PRESSED],label+": held pointer press uses a pressed state")
	states.append("pressed");await _capture(label+"_pressed")
	# Release outside the button so the audit never submits a purchase or game command.
	motion=InputEventMouseMotion.new();motion.position=_pointer_position(button,true);viewport.push_input(motion,true)
	var release:=InputEventMouseButton.new();release.position=_pointer_position(button,true);release.button_index=MOUSE_BUTTON_LEFT;release.pressed=false;viewport.push_input(release,true)
	button.grab_focus();await _settle()
	_check(button.has_focus(),label+": production button owns keyboard focus")
	_focus(button,label);states.append("keyboard-focus");await _capture(label+"_focus")
	button.disabled=true;await _settle()
	_check(button.get_draw_mode()==BaseButton.DRAW_DISABLED,label+": disabled button uses disabled rendering")
	states.append("disabled");await _capture(label+"_disabled")
	button.disabled=false

func _dialog(window: Window,label: String)->void:
	_check(window!=null,label+": production dialog exists")
	if not window:return
	await _settle()
	_check(window.visible,label+": dialog is visible")
	_check(window.size.x<=root.size.x and window.size.y<=root.size.y,label+": dialog fits the desktop")
	_audit(window,label)
	await _capture(label)

func _dialogs()->void:
	ui.startup.popup_centered();ui.continue_button.disabled=true
	await _dialog(ui.startup,"startup_disabled_continue")
	ui.startup.hide();await _settle()
	ui.show_purchase();ui.purchase_window.size=Vector2i(960,760)
	await _dialog(ui.purchase_window,"purchase_empty")
	_check(ui.purchase_batch.disabled,"Empty purchase batch remains visibly disabled")
	var edit: LineEdit=ui.purchase_quantity.builder.get_line_edit()
	edit.text="6";edit.text_changed.emit("6");edit.grab_focus();edit.select_all()
	await _settle()
	var key:=InputEventKey.new();key.keycode=KEY_TAB;key.physical_keycode=KEY_TAB;key.pressed=true
	ui.purchase_window.push_input(key);await _settle()
	_check(ui.purchase_window.gui_get_focus_owner()==ui.purchase_quantity.operator.get_line_edit(),"Keyboard Tab follows displayed worker quantities")
	_check(not ui.purchase_batch.disabled,"Selected purchase batch visibly enables ordering")
	await _dialog(ui.purchase_window,"purchase_selected_batch")
	await _control_states(_button(ui.purchase_window,"Clear quantities"),"purchase_button")
	ui.purchase_window.hide();await _settle()
	ui.electrical_ui.plan_dialog(ui)
	await _dialog(ui.electrical_ui.plan_window,"electrical_plan_disabled")
	_check(ui.electrical_ui.draw_button.disabled,"Unspecified circuit has a visibly disabled drawing action")
	ui.electrical_ui.plan_window.queue_free();await _settle()
	ui.electrical_ui.rename_dialog(ui,{"id":"BLD-9001","kind":"power","name":"West incoming station"})
	var rename: Window=_window("Name electrical asset · BLD-9001")
	await _dialog(rename,"electrical_rename_selection")
	if rename:
		var field: LineEdit=_nodes(rename,"LineEdit")[0]
		field.text="";field.text_changed.emit("")
		_check(_button(rename,"Save name").disabled,"Blank asset name visibly disables save")
		field.placeholder_text="Enter a recognizable asset name"
		await _dialog(rename,"electrical_rename_placeholder")
		field.text="Read-only incoming station";field.editable=false
		await _dialog(rename,"electrical_rename_read_only")
		rename.queue_free();await _settle()
	ui.collection_ui.open(ui)
	await _dialog(ui.collection_ui.window,"collection_unquoted")
	_check(ui.collection_ui.confirm_button.disabled,"Unquoted collection visibly disables ordering")
	ui.collection_ui.window.queue_free();await _settle()
	ui._rail_location_form({"id":"BOOTSTRAP-SIDING","name":"North receiving siding","kind":"unloading","offset":30,"length":40})
	var location: Window=_window("Named railway location")
	await _dialog(location,"rail_location_form")
	if location:location.queue_free();await _settle()
	ui._open_menu();await _settle()
	var restore: int=ui.menu.get_item_index(7)
	ui.menu.set_item_disabled(restore,true);ui.menu.set_focused_item(0)
	_popup(ui.menu,"Application menu")
	_check(ui.menu.get_focused_item()==0 and ui.menu.is_item_disabled(restore),"Popup has real keyboard selection and disabled backup action")
	await _capture("menu_selected_disabled")
	ui.menu.hide();ui._start("empty")
	await _dialog(ui.confirmation,"new_yard_confirmation")
	# The reported unreadable OK action is the actual ConfirmationDialog
	# button, including the engine's real hover, held press, focus, and disable.
	await _control_states(ui.confirmation.get_ok_button(),"confirmation_ok")
	ui.confirmation.hide();ui.startup.hide()
	await _settle()
	# Construct only the settings form. setup() would load audio/configuration;
	# leaving its directory empty makes these controls incapable of disk writes.
	var audio:=Audio.new();root.add_child(audio)
	audio.show_settings(ui.screen.theme)
	await _dialog(audio._dialog,"sound_settings")
	_check(audio.get_status().voices==0 and audio.get_status().sounds==0,"Sound readability audit never allocates players or loads audio assets")
	_check(_nodes(audio._dialog,"HSlider").size()==4 and _nodes(audio._dialog,"CheckBox").size()==2,"Real sound settings exposes all volume and mute controls")
	await _control_states(audio._dialog.get_ok_button(),"sound_ok")
	audio.queue_free();await _settle()

func _run()->void:
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--capture-dir="):capture_dir=argument.trim_prefix("--capture-dir=")
		elif argument.begins_with("--fixture-path="):fixture_path=argument.trim_prefix("--fixture-path=")
	if not capture_dir.is_empty():
		_check(DisplayServer.get_name()!="headless","Screenshot capture requires a real rendering display")
		if DisplayServer.get_name()=="headless":capture_dir=""
		else:_check(DirAccess.make_dir_recursive_absolute(capture_dir)==OK,"Screenshot output directory is writable")
	# Audit physical desktop pixels, independently of the project's game-canvas
	# stretch; changing only Window.size otherwise leaves a 1680 px UI canvas.
	root.content_scale_mode=Window.CONTENT_SCALE_MODE_DISABLED
	root.content_scale_size=Vector2i.ZERO
	root.size=VIEWPORTS[0];root.gui_embed_subwindows=true
	var snapshot: Dictionary=_snapshot()
	if snapshot.is_empty():
		print("UI_READABILITY_SMOKE ",JSON.stringify({"passed":false,"checks":checks,"failures":failures,"fixturePath":fixture_path,"serviceStarted":false,"userSaveOpened":false}))
		quit(1);return
	ui=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.update_snapshot(snapshot);ui.receive_reply({"action":"continue","ok":true})
	for size: Vector2i in VIEWPORTS:
		root.size=size;await _settle()
		for tab: String in REQUIRED_TABS:
			ui.show_tab(tab);ui.show_entity("EQ-0006");await _settle()
			if tab=="SQL":ui.receive_reply({"action":"sql","ok":true,"result":[{"columns":["id","fuel"],"values":[["EQ-0006",42.5]]}]});await _settle()
			await _tab_layout(tab,size)
			if tab=="Materials" and size==Vector2i(1280,800):await _horizontal_inventory()
			_audit(ui.screen,"%s %s"%[tab,size])
			await _capture("%dx%d_%s"%[size.x,size.y,tab.to_lower()])
		await _help(size)
	await _sql_and_inspector(snapshot)
	root.size=VIEWPORTS[0];await _settle()
	await _dialogs()
	ui.show_tab("Activity");await _settle()
	await _control_states(_button(ui.register_panel,"Column filters"),"column_filter_switch")
	var warning_tree: Tree=ui.tables[0].tree
	var warning: TreeItem=warning_tree.get_root().get_first_child()
	_check(warning!=null,"Warning selection audit uses a real Activity record")
	if warning:warning.select(0);warning_tree.grab_focus()
	await _settle();_tree_colors(warning_tree,"Selected warning row")
	await _capture("activity_selected_warning")
	ui.show_error("Warning: receiving is blocked. The forklift cannot reach PO-9001 while EQ-0006 occupies the stockyard approach. Inspect the linked equipment and choose a clear receiving route before continuing.")
	await _settle()
	_check(ui.error_panel.visible and Rect2(Vector2.ZERO,Vector2(root.size)).encloses(ui.error_panel.get_global_rect()),"Warning banner remains visible inside the desktop below navigation")
	_audit(ui.error_panel,"Warning banner")
	await _capture("warning_banner")
	_check(REQUIRED_TABS.size()==13 and visited.size()>=26,"All thirteen production tabs are audited at both desktop sizes")
	for state: String in ["normal","hover","pressed","keyboard-focus","disabled"]:_check(state in states,"Actual input coverage includes "+state)
	measurements.sort_custom(func(a: Dictionary,b: Dictionary)->bool:return float(a.ratio)<float(b.ratio))
	var report: Dictionary={"passed":failures.is_empty(),"checks":checks,"failures":failures,"views":visited,"states":states,"captures":captures,"lowestContrast":measurements.slice(0,20),"contrastMeasurements":measurements.size(),"horizontalInventory":horizontal_inventory,"iconReadbacks":icon_images.size(),"iconInkEvaluations":icon_ink_counts.size(),"fixturePath":fixture_path,"serviceStarted":false,"userSaveOpened":false,"gpuRendering":DisplayServer.get_name()!="headless"}
	if not capture_dir.is_empty():
		var output: FileAccess=FileAccess.open(capture_dir.path_join("readability-report.json"),FileAccess.WRITE)
		if output:output.store_string(JSON.stringify(report,"\t")+"\n")
	print("UI_READABILITY_SMOKE ",JSON.stringify(report))
	ui.queue_free();await process_frame
	quit(0 if failures.is_empty() else 1)
