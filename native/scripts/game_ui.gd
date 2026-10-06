extends CanvasLayer

signal command(action: String,args: Dictionary)
signal tool_selected(kind: String)
signal entity_selected(id: String)
signal focus_entity(id: String)
signal preset_requested(name: String)
signal grid_requested(value: bool)
signal lighting_requested(value: bool)
signal file_requested(action: String)

const Table = preload("res://scripts/ui_table.gd")
const TABS: Array[String] = ["Yard","Railway","Materials","Workers","Equipment","Deliveries","Work","Activity","Costs","SQL","Inbox"]
const ACTIVITIES: Array[String] = ["receiving","paving","construction","rail","recovery"]
const CATALOG: Dictionary = {
	"builder":{"name":"Construction worker","price":90,"wage":28},"operator":{"name":"Equipment operator","price":120,"wage":36},"engineer":{"name":"Site engineer","price":150,"wage":42},
	"excavator":{"name":"EX-6 tracked excavator","price":64000,"mass":8500,"capacity":6000},"forklift":{"name":"FL-25 rough-terrain forklift","price":28500,"mass":4500,"capacity":2500},
	"slab":{"name":"Concrete slab · 1 × 1 m","price":38,"mass":280},"rail":{"name":"Straight rail panel · 5 m","price":780,"mass":1450},"railCurve":{"name":"Curved rail panel · 15°","price":1120,"mass":1520},
	"railPoints":{"name":"Turnout points module","price":3100,"mass":1750},"railFrog":{"name":"Turnout frog module","price":2450,"mass":1520},"railClosure":{"name":"Turnout closure module","price":2100,"mass":1520},"railExit":{"name":"Turnout exit module","price":1950,"mass":1520},
	"office":{"name":"Office container","price":7200,"mass":4800},"sanitary":{"name":"Sanitary container","price":4600,"mass":2000},"shed":{"name":"Equipment shed kit","price":5200,"mass":2200},"store":{"name":"Stores building kit","price":6400,"mass":2600},
	"lamp":{"name":"Light pole kit","price":340,"mass":160},"diesel":{"name":"Diesel drum · 200 L","price":320,"mass":185},"fence":{"name":"Fence panel","price":115,"mass":60},"power":{"name":"Electrical connection","price":1800},"water":{"name":"Water/sewer connection","price":2300}
}

var catalog: Dictionary = CATALOG.duplicate(true)
var state: Dictionary = {}
var metadata: Dictionary = {}
var started: bool = false
var selected_id: String = ""
var controlled_worker: String = ""
var active_tab: String = "Yard"
var active_tool: String = "select"
var screen: Control
var content: Control
var register_panel: PanelContainer
var register_body: VBoxContainer
var tables: Array[Control] = []
var audit_label: Label
var search_field: LineEdit
var record_status: OptionButton
var severity_filter: OptionButton
var inspector: PanelContainer
var inspector_scroll: ScrollContainer
var grid_button: CheckButton
var lighting_button: CheckButton
var inspector_body: VBoxContainer
var time_label: Label
var summary_label: Label
var status_label: Label
var error_label: Label
var pause_button: Button
var tab_buttons: Dictionary = {}
var startup: Window
var continue_button: Button
var purchase_window: Window
var purchase_quantity: Dictionary = {}
var purchase_mass_labels: Dictionary = {}
var purchase_mode: OptionButton
var purchase_total: Label
var purchase_batch: Button
var purchase_preview_pending: bool = false
var query_text: TextEdit
var sql_status: Label
var sql_table: Control
var toast: PanelContainer
var toast_body: VBoxContainer
var latest_notice: String = ""
var toast_age: float = 0.0
var update_clock: float = 0.0
var refresh_pending: bool = false
var inspector_pending: bool = false
var menu: PopupMenu
var confirmation: ConfirmationDialog
var pending_confirmation: Callable
var tool_label: Label
var release_control_button: Button
var group_expansion: Dictionary = {}

func setup() -> void:
	layer=10
	screen=Control.new()
	screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.mouse_filter=Control.MOUSE_FILTER_IGNORE
	add_child(screen)
	screen.theme=_theme()
	var layout: VBoxContainer = VBoxContainer.new()
	layout.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layout.mouse_filter=Control.MOUSE_FILTER_IGNORE
	layout.add_theme_constant_override("separation",0)
	screen.add_child(layout)
	var bar: PanelContainer = PanelContainer.new()
	layout.add_child(bar)
	var top: HBoxContainer = HBoxContainer.new()
	top.add_theme_constant_override("separation",2)
	bar.add_child(top)
	var brand: Button = _button(top,"P 01  PLANT 01",_open_menu)
	brand.custom_minimum_size=Vector2(132,34)
	for tab: String in TABS:
		var button: Button = _button(top,tab,func() -> void: _switch_tab(tab))
		button.toggle_mode=true
		tab_buttons[tab]=button
	time_label=_label(top,"Connecting…")
	time_label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	time_label.horizontal_alignment=HORIZONTAL_ALIGNMENT_RIGHT
	pause_button=_button(top,"Ⅱ",func() -> void: _send("pause",{"paused":not bool(state.get("paused",true))}))
	pause_button.tooltip_text="Pause / resume (Space)"
	for speed: int in [1,3,10]:
		_button(top,"%d×"%speed,func() -> void: _send("speed",{"value":speed}))
	_button(top,"☰",_open_menu)
	content=Control.new()
	content.size_flags_vertical=Control.SIZE_EXPAND_FILL
	content.mouse_filter=Control.MOUSE_FILTER_IGNORE
	layout.add_child(content)
	_build_yard_controls()
	register_panel=PanelContainer.new()
	register_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	register_panel.offset_right=-354
	content.add_child(register_panel)
	register_body=VBoxContainer.new()
	register_body.add_theme_constant_override("separation",4)
	register_panel.add_child(register_body)
	inspector=PanelContainer.new()
	inspector.set_anchors_and_offsets_preset(Control.PRESET_RIGHT_WIDE)
	inspector.offset_left=-348
	inspector.offset_top=8
	inspector.offset_right=-8
	inspector.offset_bottom=-8
	content.add_child(inspector)
	var scroll: ScrollContainer = ScrollContainer.new()
	inspector_scroll=scroll
	scroll.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED
	inspector.add_child(scroll)
	inspector_body=VBoxContainer.new()
	inspector_body.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	inspector_body.add_theme_constant_override("separation",3)
	scroll.add_child(inspector_body)
	var bottom: PanelContainer = PanelContainer.new()
	layout.add_child(bottom)
	var footer: HBoxContainer = HBoxContainer.new()
	bottom.add_child(footer)
	status_label=_label(footer,"Drag empty ground: pan · right drag: orbit · scroll: zoom · WASD: view-relative")
	status_label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	summary_label=_label(footer,"")
	error_label=Label.new()
	error_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	error_label.offset_top=38
	error_label.add_theme_color_override("font_color",Color("a44830"))
	error_label.horizontal_alignment=HORIZONTAL_ALIGNMENT_CENTER
	error_label.visible=false
	screen.add_child(error_label)
	_build_menu()
	_build_toast()
	_build_startup()
	_switch_tab("Yard")
	set_process(true)

func _theme() -> Theme:
	var theme: Theme = Theme.new()
	theme.default_font_size=13
	var base: StyleBoxFlat = StyleBoxFlat.new()
	base.bg_color=Color("f2f2e7")
	base.border_color=Color("bcc8b5")
	base.set_border_width_all(1)
	base.set_content_margin_all(6)
	var button: StyleBoxFlat = base.duplicate() as StyleBoxFlat
	button.set_content_margin_all(4)
	button.bg_color=Color("eef0e5")
	var hover: StyleBoxFlat = button.duplicate() as StyleBoxFlat
	hover.bg_color=Color("dde7d7")
	var pressed: StyleBoxFlat = button.duplicate() as StyleBoxFlat
	pressed.bg_color=Color("c9dcc1")
	for type: String in ["PanelContainer","PopupMenu","Window","AcceptDialog"]: theme.set_stylebox("panel",type,base)
	for type: String in ["Button","OptionButton","CheckBox","MenuButton"]:
		theme.set_stylebox("normal",type,button)
		theme.set_stylebox("hover",type,hover)
		theme.set_stylebox("pressed",type,pressed)
		theme.set_stylebox("focus",type,hover)
		theme.set_color("font_color",type,Color("304b40"))
		theme.set_color("font_hover_color",type,Color("203e30"))
		theme.set_color("font_pressed_color",type,Color("203e30"))
	for type: String in ["Label","LineEdit","TextEdit","Tree","RichTextLabel"]:
		theme.set_color("font_color",type,Color("334f43"))
		theme.set_color("default_color",type,Color("334f43"))
	for type: String in ["LineEdit","TextEdit"]:
		theme.set_stylebox("normal",type,button)
		theme.set_stylebox("focus",type,hover)
		theme.set_color("caret_color",type,Color("315c4f"))
	theme.set_color("font_color","PopupMenu",Color("304b40"))
	theme.set_color("font_hover_color","PopupMenu",Color("203e30"))
	theme.set_color("font_disabled_color","PopupMenu",Color("8b9787"))
	theme.set_stylebox("hover","PopupMenu",hover)
	for input_type: String in ["LineEdit","TextEdit"]:
		theme.set_color("selection_color",input_type,Color("b8ceb1"))
		theme.set_color("selected_font_color",input_type,Color("203e30"))
	theme.set_stylebox("panel","Tree",base)
	theme.set_stylebox("selected","Tree",pressed)
	theme.set_stylebox("selected_focus","Tree",pressed)
	theme.set_stylebox("title_button_normal","Tree",button)
	theme.set_stylebox("title_button_hover","Tree",hover)
	theme.set_color("title_button_color","Tree",Color("334f43"))
	theme.set_color("font_selected_color","Tree",Color("203e30"))
	theme.set_constant("v_separation","Tree",3)
	return theme

func _window_background(window: Window) -> void:
	# Window contents otherwise expose the project clear color. A real paper
	# panel also works in OS windows, embedded subwindows, and headless layout.
	window.theme=screen.theme
	var paper: PanelContainer = PanelContainer.new()
	paper.name="PaperBackground"
	paper.mouse_filter=Control.MOUSE_FILTER_IGNORE
	paper.z_index=-100
	paper.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color=Color("f2f2e7")
	style.border_color=Color("b6c4ae")
	style.set_border_width_all(1)
	style.set_content_margin_all(0)
	paper.add_theme_stylebox_override("panel",style)
	window.add_child(paper)
	window.move_child(paper,0)

func _button(parent: Node,text: String,callback: Callable) -> Button:
	var button: Button = Button.new()
	button.text=text
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _label(parent: Node,text: String) -> Label:
	var label: Label = Label.new()
	label.text=text
	parent.add_child(label)
	return label

func _note(parent: Node,text: String) -> Label:
	var label: Label = _label(parent,text)
	label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	label.add_theme_font_size_override("font_size",12)
	return label

func _send(action: String,args: Dictionary = {}) -> void:
	command.emit(action,args)

func _records(key: String) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for value: Variant in state.get(key,[]):
		if value is Dictionary: result.append(value)
	return result

func _name(key: String) -> String:
	return str(catalog.get(key,{}).get("name",key))

func _money(value: Variant) -> String:
	return "$%s"%_comma(int(round(float(value))))

func _comma(value: int) -> String:
	var text: String = str(absi(value))
	var output: String = ""
	for i: int in range(text.length()):
		if i>0 and (text.length()-i)%3==0: output+=","
		output+=text[i]
	return ("-" if value<0 else "")+output

func _mass(value: float) -> String:
	return "%.2f t"%(value/1000.0) if value>=1000 else "%d kg"%roundi(value)

func _clock(value: Variant) -> String:
	var seconds: int = int(float(value))
	return "D%d %02d:%02d:%02d"%[1+int(seconds/86400),int(seconds/3600)%24,int(seconds/60)%60,seconds%60]

func _row(id: String,cells: Array,sort_values: Array = [],refs: Dictionary = {}) -> Dictionary:
	return {"id":id,"cells":cells,"sort":sort_values if not sort_values.is_empty() else cells,"refs":refs}

func _field(value: Dictionary,key: String,fallback: String = "—") -> String:
	var text: String = str(value.get(key,""))
	return text if not text.is_empty() else fallback

func _position(value: Dictionary) -> String:
	return "E%.1f, S%.1f"%[float(value.get("x",0)),float(value.get("z",0))]

func _build_yard_controls() -> void:
	var camera_bar: HBoxContainer = HBoxContainer.new()
	camera_bar.position=Vector2(10,10)
	content.add_child(camera_bar)
	for preset: String in ["Yard","Rail end","Overview"]:
		_button(camera_bar,preset,func() -> void: preset_requested.emit(preset.to_lower().replace(" ","-")))
	var grid: CheckButton = CheckButton.new()
	grid_button = grid
	grid.text="Grid"
	grid.button_pressed=true
	grid.toggled.connect(func(value: bool) -> void: grid_requested.emit(value))
	camera_bar.add_child(grid)
	var light: CheckButton = CheckButton.new()
	lighting_button = light
	light.text="Dusk"
	light.toggled.connect(func(value: bool) -> void: lighting_requested.emit(value))
	camera_bar.add_child(light)
	_button(camera_bar,"+ Purchase / hire",_open_purchase)
	var tool_panel: PanelContainer = PanelContainer.new()
	tool_panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	tool_panel.offset_top=-68
	tool_panel.offset_left=8
	tool_panel.offset_right=-360
	tool_panel.offset_bottom=-8
	content.add_child(tool_panel)
	var tools: VBoxContainer = VBoxContainer.new()
	tool_panel.add_child(tools)
	var row: HBoxContainer = HBoxContainer.new()
	tools.add_child(row)
	var choices: Dictionary = {"select":"Select","slab":"Pave","office":"Office","sanitary":"WC","shed":"Shed","store":"Stores","lamp":"Light","fence":"Fence","power":"Power","water":"Water","zone":"Stockyard"}
	for key: String in choices:
		_button(row,str(choices[key]),func() -> void: _select_tool(key))
	var rail_row: HBoxContainer = HBoxContainer.new()
	tools.add_child(rail_row)
	for key: String in {"railStraight":"Straight rail","railCurve":"90° curve","railTurnout":"Turnout"}:
		_button(rail_row,{"railStraight":"Straight rail","railCurve":"90° curve","railTurnout":"Turnout"}[key],func() -> void: _select_tool(key))
	_button(rail_row,"Rotate R",func() -> void: _send("rotate",{}))
	_button(rail_row,"Left / right",func() -> void: _send("rail_hand",{}))
	_button(rail_row,"Buy missing",func() -> void: _send("buy_missing",{}))
	release_control_button=_button(rail_row,"Return to automatic",func() -> void: _return_to_automatic(controlled_worker))
	release_control_button.visible=false
	tool_label=_label(rail_row,"Select · 1 m grid")
	tool_label.tooltip_text="Construction ghosts: cyan queued, amber underway. Placement preview: green valid, red invalid."
	tool_label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	tool_label.horizontal_alignment=HORIZONTAL_ALIGNMENT_RIGHT

func _select_tool(kind: String) -> void:
	active_tool=kind
	_switch_tab("Yard")
	_update_control_banner()
	if not selected_id.is_empty(): entity_selected.emit(selected_id)
	tool_selected.emit(kind)

func _build_menu() -> void:
	menu=PopupMenu.new()
	menu.theme=screen.theme
	menu.add_item("Purchase / hire",0)
	menu.add_separator()
	menu.add_item("Save now",1)
	menu.add_item("Import saved yard…",2)
	menu.add_item("Export save…",3)
	menu.add_item("Export diagnostics…",4)
	menu.add_item("Export costs CSV…",5)
	menu.add_separator()
	menu.add_item("New yard…",6)
	menu.add_item("Restore previous backup",7)
	menu.add_item("Controls / guide",8)
	menu.add_item("Open save folder",9)
	menu.add_separator()
	menu.add_check_item("Full-resolution 3D (slower on Retina)",10)
	menu.id_pressed.connect(_menu_action)
	screen.add_child(menu)
	confirmation=ConfirmationDialog.new()
	confirmation.title="Confirm yard replacement"
	confirmation.dialog_text="The current yard will be backed up before a new yard replaces it. Continue?"
	confirmation.confirmed.connect(func() -> void:
		if pending_confirmation.is_valid(): pending_confirmation.call())
	screen.add_child(confirmation)
	_window_background(confirmation)

func _open_menu() -> void:
	menu.position=Vector2i(10,38)
	menu.popup()

func _menu_action(id: int) -> void:
	match id:
		0: _open_purchase()
		1: file_requested.emit("save")
		2: file_requested.emit("import")
		3: file_requested.emit("export")
		4: file_requested.emit("diagnostics")
		5: file_requested.emit("costs")
		6: _show_startup()
		7: _send("restore_backup",{})
		9: file_requested.emit("folder")
		10:
			var index: int = menu.get_item_index(10)
			var enabled: bool = not menu.is_item_checked(index)
			menu.set_item_checked(index,enabled)
			command.emit("native_resolution",{"value":enabled})
		8:
			var help: AcceptDialog = AcceptDialog.new()
			help.title="Plant 01 controls"
			help.dialog_text="Drag empty ground to pan; right drag to orbit; scroll to zoom. WASD moves relative to the view. Space pauses. R rotates a plan.\n\nPurchase workers, machines, and materials. Deliveries need owned equipment and an operator. Designate physical stockyards, pave foundations, and plan construction. IDs in every register open the inspector. Assign machines to whole work orders or rail crews.\n\n1× uses real time. The simulation continues while this window is unfocused. Save files and rolling diagnostic history remain on this device."
			help.dialog_text += "\n\nSave folder: " + str(metadata.get("storage",{}).get("dataDir","Not connected yet"))
			screen.add_child(help)
			_window_background(help)
			help.popup_centered(Vector2i(700,350))

func _build_startup() -> void:
	startup=Window.new()
	startup.title="Plant 01 · Choose a yard"
	startup.size=Vector2i(590,340)
	startup.unresizable=true
	startup.exclusive=true
	startup.theme=screen.theme
	screen.add_child(startup)
	_window_background(startup)
	var margin: MarginContainer = MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left","top","right","bottom"]: margin.add_theme_constant_override("margin_"+side,18)
	startup.add_child(margin)
	var body: VBoxContainer = VBoxContainer.new()
	body.add_theme_constant_override("separation",10)
	margin.add_child(body)
	var title: Label = _label(body,"PLANT 01  /  NATIVE STARTER YARD")
	title.add_theme_font_size_override("font_size",21)
	_note(body,"Continue your saved yard, import an exported save, or explicitly choose a new yard. Nothing is silently replaced.")
	continue_button=_button(body,"Continue current save",func() -> void: _start("continue"))
	continue_button.disabled=true
	_button(body,"Starter yard · initial orders, build it yourself",func() -> void: _start("starter"))
	_button(body,"Empty yard · infrastructure only",func() -> void: _start("empty"))
	_button(body,"Example yard · inspect a working site",func() -> void: _start("example"))
	_button(body,"Import existing save…",func() -> void: file_requested.emit("import"))
	startup.close_requested.connect(func() -> void:
		if started: startup.hide())
	_show_startup()

func _show_startup() -> void:
	startup.popup_centered()

func _start(mode: String) -> void:
	var launch: Callable = func() -> void:
		started=true
		startup.hide()
		selected_id=""
		_switch_tab("Yard")
		_send("continue",{}) if mode=="continue" else _send("new_game",{"mode":mode})
	if mode!="continue" and (started or bool(metadata.get("storage",{}).get("hasSave",false))):
		pending_confirmation=launch
		confirmation.popup_centered()
	else: launch.call()

func update_snapshot(message: Dictionary) -> void:
	if message.has("state"): state=message.state
	elif message.has("workers"): state=message
	metadata=message
	for category: String in ["materials","equipment","roles","services"]:
		for key: String in message.get("catalog",{}).get(category,{}): catalog[key]=message.catalog[category][key]
	continue_button.disabled=not bool(message.get("storage",{}).get("hasSave",false))
	time_label.text=_clock(state.get("time",0))
	pause_button.text="▶" if bool(state.get("paused",true)) else "Ⅱ"
	var active: int = 0
	var queued: int = 0
	for job: Dictionary in _records("jobs"):
		if job.get("status")=="doing": active+=1
		if job.get("status")=="todo": queued+=1
	var total: float = 0
	for cost: Dictionary in _records("costs"): total+=float(cost.get("amount",0))
	total=float(message.get("summaries",{}).get("totalCosts",total))
	summary_label.text="%d workers · %d working · %d queued · %s"%[_records("workers").size(),active,queued,_money(total)]
	var unseen: int = 0
	for notice: Dictionary in _records("notices"):
		if not bool(notice.get("seen",false)): unseen+=1
	(tab_buttons["Inbox"] as Button).text="Inbox %d"%unseen
	refresh_pending=true
	inspector_pending=true
	_check_notices()
	_update_control_banner()

func _process(delta: float) -> void:
	update_clock+=delta
	if toast.visible:
		toast_age+=delta
		if toast_age>12: toast.hide()
	if update_clock<0.7: return
	update_clock=0
	if refresh_pending and active_tab!="Yard" and not _editing(register_panel):
		_refresh_register()
		refresh_pending=false
	if inspector_pending and not _editing(inspector):
		_render_inspector()
		inspector_pending=false

func _editing(node: Control) -> bool:
	if _open_popup(node): return true
	var focus: Control = node.get_viewport().gui_get_focus_owner()
	return focus!=null and node.is_ancestor_of(focus) and (focus is LineEdit or focus is TextEdit or focus is SpinBox or focus is OptionButton)

func _open_popup(node: Node) -> bool:
	if (node is MenuButton or node is OptionButton) and node.get_popup().visible: return true
	for child: Node in node.get_children():
		if _open_popup(child): return true
	return false

func show_entity(id: String) -> void:
	selected_id=id
	_render_inspector()

func show_error(text: String) -> void:
	error_label.text=text
	error_label.visible=not text.is_empty()
	status_label.text=text

func receive_reply(message: Dictionary) -> void:
	if bool(message.get("ok",true)):
		error_label.visible=false
		if str(message.get("action",""))=="purchase_batch" and is_instance_valid(purchase_window):
			for quantity: SpinBox in purchase_quantity.values(): quantity.set_value_no_signal(0)
			for mass_label: Label in purchase_mass_labels.values(): mass_label.text="—"
			purchase_total.text="Order placed. Add new quantities for another batch."
			purchase_batch.disabled=true
		if str(message.get("action","")) in ["new_game","continue","import","load"]:
			started=true
			startup.hide()
		if message.has("message"): status_label.text=str(message.message)
		elif message.has("action"): status_label.text="%s updated"%str(message.action).replace("_"," ")
	else: show_error(str(message.get("error","Action could not be completed.")))
	if message.get("action")=="purchase_preview" and is_instance_valid(purchase_total):
		var preview: Dictionary = message.get("result",{})
		var price: float = 0.0
		for line: Dictionary in _purchase_lines(): price+=float(catalog.get(line.item,{}).get("price",0))*float(line.qty)
		for load: Dictionary in preview.get("loads",[]): price+=240.0 if load.get("mode")=="rail" else 90.0
		purchase_total.text="%s cargo · %s including freight · %s carrier loads"%[_mass(float(preview.get("mass",0))),_money(price),preview.get("loads",[]).size()]
	if (message.has("rows") or message.get("action")=="sql") and active_tab=="SQL":
		_display_sql(message)
	refresh_pending=true
	inspector_pending=true

func _switch_tab(tab: String) -> void:
	active_tab=tab
	for key: String in tab_buttons: (tab_buttons[key] as Button).button_pressed=key==tab
	register_panel.visible=tab!="Yard"
	if tab!="Yard": _build_register()
	_render_inspector()

func _clear(parent: Node) -> void:
	for child: Node in parent.get_children():
		parent.remove_child(child)
		child.queue_free()

func _table(parent: Node,title: String,headers: Array[String],widths: Array[int] = []) -> Control:
	if not title.is_empty(): _label(parent,title)
	var table: Control = Table.new()
	table.theme=screen.theme
	table.size_flags_vertical=Control.SIZE_EXPAND_FILL
	table.setup(headers,widths)
	table.entity_clicked.connect(_user_entity)
	table.row_clicked.connect(_user_entity)
	parent.add_child(table)
	tables.append(table)
	return table

func _build_register() -> void:
	audit_label=null
	record_status=null
	severity_filter=null
	_clear(register_body)
	tables.clear()
	var heading: HBoxContainer = HBoxContainer.new()
	register_body.add_child(heading)
	var title: Label = _label(heading,active_tab.to_upper()+" / SITE REGISTER")
	title.add_theme_font_size_override("font_size",18)
	title.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	_button(heading,"Purchase / hire",_open_purchase)
	if active_tab=="Work": _button(heading,"Buy missing materials",func() -> void: _send("buy_missing",{}))
	if active_tab=="Activity": _button(heading,"Export diagnostics",func() -> void: file_requested.emit("diagnostics"))
	if active_tab=="Costs": _button(heading,"Export CSV",func() -> void: file_requested.emit("costs"))
	if active_tab=="Inbox": _button(heading,"Mark all seen",func() -> void: _send("mark_all_seen",{}))
	if active_tab=="SQL": _build_sql(); return
	if active_tab in ["Activity","Costs"]: audit_label=_note(register_body,"")
	var filters: HBoxContainer = HBoxContainer.new()
	register_body.add_child(filters)
	_label(filters,"Filter")
	search_field=LineEdit.new()
	search_field.placeholder_text="Search every column…"
	search_field.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	search_field.text_changed.connect(func(value: String) -> void:
		for table: Control in tables: table.set_search(value)
		if active_tab=="Work": _refresh_register())
	filters.add_child(search_field)
	var column_filters: CheckButton = CheckButton.new()
	column_filters.text="Column filters"
	column_filters.toggled.connect(func(value: bool) -> void:
		for table: Control in tables: table.show_filters(value))
	filters.add_child(column_filters)
	if active_tab in ["Work","Deliveries","Inbox"]:
		record_status=_option(filters,["Active","All","To do","Doing","Done","Canceled"] if active_tab=="Work" else ["Active","All","Done"])
		record_status.item_selected.connect(func(_index: int) -> void: _refresh_register())
	if active_tab=="Activity":
		severity_filter=_option(filters,["All events","Warnings only","Info only"])
		severity_filter.item_selected.connect(func(_index: int) -> void: _refresh_register())
	match active_tab:
		"Railway":
			_note(register_body,"Named locations mark track intervals. Supplier trains still use the receiving siding; shunting is a later feature.")
			_button(filters,"+ Named location",_new_rail_location)
			_table(register_body,"Named locations",["ID","Name","Purpose","Track","Offset m","Length m","Status"])
			_table(register_body,"Installed track",["ID","Piece","Position","Length m","Route","Group"])
		"Materials":
			_table(register_body,"Inventory",["Material","Delivered","Incoming","Stored","Reserved","In transit","Installed","Construction","Mass stored"])
			_table(register_body,"Physical stacks",["ID","Material","Qty","Reserved","Footprint","Position","Source","Diesel L"])
		"Workers": _table(register_body,"",["ID","Name","Role","Duty","Shift","Status","Job / delivery","Vehicle","Support","Hours"])
		"Equipment":
			_table(register_body,"Mobile equipment",["ID","Type","Control","Auto work","Operator","Job / delivery","Fuel L","Used L","Parking","Status"])
			_table(register_body,"Buildings",["ID","Name","Kind","Position","Footprint","Utilities"])
		"Deliveries": _table(register_body,"",["ID","Items","Qty","Arrived","Mass","Mode","ETA","Status","Receiving note","Cost"])
		"Work":
			_button(filters,"Expand all",func() -> void:
				for group: Dictionary in _records("jobGroups"): group_expansion[str(group.id)]=true
				_refresh_register())
			_button(filters,"Collapse all",func() -> void: group_expansion.clear(); _refresh_register())
			_table(register_body,"Whole orders and individual tasks · select a parent to assign its complete crew",["ID","Work / task","State","Progress","Worker","Operator","Equipment","Preferred","Blocking / next step"])
		"Activity":
			_table(register_body,"Events",["Time","Severity","Type","Entity","Event"],[115,65,80,90,300])
			_table(register_body,"Material movements",["Time","Material","Qty","From","To","Reason"])
		"Costs": _table(register_body,"No spending limit · purchases invoiced on arrival; labor accrues every 15 game minutes",["Time","Category","Entity","Description","Amount"],[120,110,90,300,80])
		"Inbox": _table(register_body,"Operational notices remain in To do / Doing / Done independently of popup dismissal",["ID","Time","State","Title","Detail","Entity","Seen"],[80,110,70,160,290,90,40])
	_refresh_register()

func _status_matches(value: String) -> bool:
	if not is_instance_valid(record_status): return true
	var choice: String = record_status.get_item_text(record_status.selected)
	match choice:
		"All": return true
		"Active": return value not in ["done","canceled"]
		"To do": return value=="todo"
		"Doing": return value=="doing"
		"Done": return value=="done"
		"Canceled": return value=="canceled"
	return true

func _set_table(index: int,rows: Array[Dictionary]) -> void:
	if tables.size()>index: tables[index].set_rows(rows)

func _refresh_register() -> void:
	if is_instance_valid(audit_label):
		var counts: Dictionary = metadata.get("summaries",{})
		audit_label.text="Latest %d of %d costs · %d of %d events · %d of %d movements. Full histories remain in SQL, save files, and exports."%[_records("costs").size(),int(counts.get("costCount",_records("costs").size())),_records("events").size(),int(counts.get("eventCount",_records("events").size())),_records("movements").size(),int(counts.get("movementCount",_records("movements").size()))]
	var rows: Array[Dictionary] = []
	match active_tab:
		"Railway":
			for e: Dictionary in _records("railLocations"):
				rows.append(_row(str(e.id),[e.id,e.get("name",""),e.get("kind",""),e.get("trackId",""),e.get("offset",0),e.get("length",0),"Designated"]))
			_set_table(0,rows); rows=[]
			for e: Dictionary in _records("rails"):
				rows.append(_row(str(e.id),[e.id,e.get("item","rail"),_position(e),e.get("length",5),e.get("selectedRoute","straight"),e.get("track",{}).get("groupId","")]))
			_set_table(1,rows)
		"Materials":
			for value: Dictionary in metadata.get("inventory",[]):
				var key: String = str(value.get("item",""))
				rows.append(_row(key,[_name(key),value.get("delivered",0),value.get("incoming",0),value.get("stored",0),value.get("reserved",0),value.get("cargo",0),value.get("installed",0),value.get("inConstruction",0),_mass(float(value.get("stored",0))*float(catalog.get(key,{}).get("mass",0)))]))
			_set_table(0,rows); rows=[]
			for e: Dictionary in _records("stacks"):
				rows.append(_row(str(e.id),[e.id,_name(str(e.get("item",""))),e.get("qty",0),e.get("reserved",0),"%s × %s m"%[e.get("w",1),e.get("d",1)],_position(e),e.get("source",""),"%.1f"%float(e.get("liters",0)) if e.get("item")=="diesel" else "—"]))
			_set_table(1,rows)
		"Workers":
			for e: Dictionary in _records("workers"):
				var shift: Dictionary = e.get("schedule",{})
				rows.append(_row(str(e.id),[e.id,e.get("name",""),e.get("role",""),e.get("duty",""),"%.2f–%.2f"%[shift.get("start",7),shift.get("end",17)] if not shift.is_empty() else "Always on duty",e.get("status",""),e.get("job",e.get("deliveryOrder","")),e.get("vehicle",e.get("commuteOrder","")),e.get("assistingEquipment",""),"%.1f"%float(e.get("hours",0))]))
			_set_table(0,rows)
		"Equipment":
			for e: Dictionary in _records("equipment"):
				rows.append(_row(str(e.id),[e.id,_name(str(e.get("kind",""))),_equipment_control(e),", ".join(e.get("allowedWork",[e.get("workRole","all")])),e.get("operator",""),e.get("job",e.get("deliveryOrder","")),"%.1f / %s"%[float(e.get("fuel",0)),e.get("tank",0)],"%.1f"%float(e.get("used",0)),_position(e.parking) if e.has("parking") else "Not assigned",e.get("blockedBy",e.get("parkingState","Ready"))]))
			_set_table(0,rows); rows=[]
			for e: Dictionary in _records("buildings"):
				rows.append(_row(str(e.id),[e.id,e.get("name",""),_name(str(e.get("kind",""))),_position(e),"%s × %s m"%[e.get("w",1),e.get("d",1)],"Connected" if e.get("connected",false) else "Needs connection"]))
			_set_table(1,rows)
		"Deliveries":
			for e: Dictionary in _records("orders").duplicate():
				if not _status_matches(str(e.get("status",""))): continue
				var manifest: Array = e.get("manifest",[{"item":e.get("item",""),"qty":e.get("qty",0)}])
				var names: PackedStringArray = []
				var mass: float = 0
				for line: Dictionary in manifest:
					names.append("%s × %s"%[line.get("qty",0),_name(str(line.get("item","")))])
					mass+=float(line.get("qty",0))*float(catalog.get(line.get("item",""),{}).get("mass",0))
				rows.push_front(_row(str(e.id),[e.id,"; ".join(names),e.get("qty",0),e.get("arrived",0),_mass(mass),e.get("mode",""),_clock(e.get("eta",0)),e.get("status",""),e.get("note",""),_money(e.get("total",0))]))
			_set_table(0,rows)
		"Work":
			var parents: Dictionary = {}
			for work: Dictionary in metadata.get("workRows",[]): parents[str(work.id)]=str(work.get("parentId",""))
			for work: Dictionary in metadata.get("workRows",[]):
				if not _status_matches(str(work.get("status",""))): continue
				var parent: String = str(work.get("parentId",""))
				var hidden: bool = false
				if is_instance_valid(search_field) and search_field.text.is_empty():
					for _depth: int in range(20):
						if parent.is_empty(): break
						if not group_expansion.get(parent,false): hidden=true; break
						parent=str(parents.get(parent,""))
				if hidden: continue
				var marker: String = "▾ " if group_expansion.get(str(work.id),false) else "▸ "
				var label_text: String = "  ".repeat(int(work.get("depth",0)))+(marker if work.get("group",false) else "· ")+str(work.get("label",work.get("kind","Work")))
				rows.append(_row(str(work.id),[work.id,label_text,work.get("status",""),"%d%%"%roundi(float(work.get("progress",0))*100),work.get("worker",""),work.get("operator",""),work.get("equipment",""),work.get("preferredEquipment",""),work.get("reason","")]))
			_set_table(0,rows)
		"Activity":
			for e: Dictionary in _records("events"):
				var severity: String = str(e.get("severity","info"))
				if is_instance_valid(severity_filter) and ((severity_filter.selected==1 and severity!="warning") or (severity_filter.selected==2 and severity!="info")): continue
				rows.push_front(_row(str(e.get("id","")),[_clock(e.get("time",0)),severity,e.get("type",""),e.get("entity",""),e.get("text","")]))
			_set_table(0,rows); rows=[]
			for e: Dictionary in _records("movements"):
				rows.push_front(_row(str(e.get("id","")),[_clock(e.get("time",0)),_name(str(e.get("item",""))),e.get("qty",0),e.get("from",""),e.get("to",""),e.get("reason","")]))
			_set_table(1,rows)
		"Costs":
			for e: Dictionary in _records("costs"):
				rows.push_front(_row(str(e.get("id","")),[_clock(e.get("time",0)),e.get("category",""),e.get("entity",""),e.get("description",""),_money(e.get("amount",0))],[_clock(e.get("time",0)),e.get("category",""),e.get("entity",""),e.get("description",""),e.get("amount",0)]))
			_set_table(0,rows)
		"Inbox":
			for e: Dictionary in _records("notices"):
				if not _status_matches(str(e.get("state","todo"))): continue
				rows.append(_row(str(e.id),[e.id,_clock(e.get("time",0)),e.get("state","todo"),e.get("title",""),e.get("detail",""),e.get("entity",""),"Yes" if e.get("seen",false) else "New"]))
			_set_table(0,rows)

func _job_row(task: Dictionary,prefix: String) -> Dictionary:
	return _row(str(task.id),[task.id,prefix+_name(str(task.get("kind",""))),task.get("status",""),"%d%%"%roundi(float(task.get("progress",0))*100),task.get("worker",""),task.get("operator",""),task.get("equipment",""),task.get("preferredEquipment",""),task.get("reason",task.get("phase",""))])

func _work_tasks(group_id: String) -> Array[Dictionary]:
	var group_ids: Dictionary = {group_id:true}
	for _pass: int in range(16):
		var changed: bool = false
		for group: Dictionary in _records("jobGroups"):
			if group_ids.has(str(group.get("parentId",""))) and not group_ids.has(str(group.id)):
				group_ids[str(group.id)]=true
				changed=true
		if not changed: break
	var result: Array[Dictionary] = []
	for task: Dictionary in _records("jobs"):
		if group_ids.has(str(task.get("parentId",""))): result.append(task)
	return result

func _entity(id: String) -> Dictionary:
	for key: String in ["workers","equipment","stacks","buildings","rails","zones","jobs","jobGroups","orders","railLocations","notices","events","costs","movements"]:
		for entity: Dictionary in _records(key):
			if str(entity.get("id",""))==id: return {"type":key,"entity":entity}
	if id=="BUFFER-001": return {"type":"buffer","entity":state.get("buffer",{})}
	return {}

func _detail(label_text: String,value: Variant) -> void:
	var row: HBoxContainer = HBoxContainer.new()
	inspector_body.add_child(row)
	var key: Label = _label(row,label_text)
	key.custom_minimum_size.x=116
	key.add_theme_font_size_override("font_size",12)
	var rich: RichTextLabel = RichTextLabel.new()
	rich.bbcode_enabled=true
	rich.fit_content=true
	rich.scroll_active=false
	rich.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	rich.mouse_filter=Control.MOUSE_FILTER_STOP
	var text: String = str(value)
	var pattern: RegEx = RegEx.new()
	pattern.compile("[A-Z]{1,8}-[0-9]{3,}")
	var matches: Array[RegExMatch] = pattern.search_all(text)
	for i: int in range(matches.size()-1,-1,-1):
		var hit: RegExMatch = matches[i]
		text=text.substr(0,hit.get_start())+"[url="+hit.get_string()+"]"+hit.get_string()+"[/url]"+text.substr(hit.get_end())
	rich.text=text if not text.is_empty() else "—"
	rich.meta_clicked.connect(func(meta: Variant) -> void: _user_entity(str(meta)))
	row.add_child(rich)

func _option(parent: Node,choices: Array,selected: int = 0) -> OptionButton:
	var option: OptionButton = OptionButton.new()
	option.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	for value: String in choices: option.add_item(value)
	option.selected=maxi(0,selected)
	option.get_popup().theme=screen.theme
	parent.add_child(option)
	return option

func _entity_option(parent: Node,key: String,empty_text: String,current: String = "",operators_only: bool = false) -> OptionButton:
	var option: OptionButton = OptionButton.new()
	option.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	option.add_item(empty_text)
	option.set_item_metadata(0,"")
	for entry: Dictionary in _records(key):
		if operators_only and entry.get("role")!="operator": continue
		var text: String = "%s · %s"%[entry.get("id",""),entry.get("name",_name(str(entry.get("kind",entry.get("role","")))))]
		option.add_item(text)
		option.set_item_metadata(option.item_count-1,str(entry.get("id","")))
		if str(entry.get("id",""))==current: option.selected=option.item_count-1
	option.get_popup().theme=screen.theme
	parent.add_child(option)
	return option

func _selection(option: OptionButton) -> String:
	return str(option.get_item_metadata(option.selected))

func _number(parent: Node,label_text: String,value: float,min_value: float,max_value: float,step: float = 1) -> SpinBox:
	var row: HBoxContainer = HBoxContainer.new()
	parent.add_child(row)
	var label: Label = _label(row,label_text)
	label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	var input: SpinBox = SpinBox.new()
	input.min_value=min_value
	input.max_value=max_value
	input.step=step
	input.update_on_text_changed=true
	input.value=value
	input.custom_minimum_size.x=104
	row.add_child(input)
	return input

func _render_inspector() -> void:
	var previous_scroll: int = inspector_scroll.scroll_vertical
	_clear(inspector_body)
	var found: Dictionary = _entity(selected_id)
	inspector.visible=not found.is_empty()
	register_panel.offset_right=-354 if inspector.visible else 0
	if found.is_empty(): return
	var kind: String = str(found.type)
	var entity: Dictionary = found.entity
	var heading: HBoxContainer = HBoxContainer.new()
	inspector_body.add_child(heading)
	var name: Label = _label(heading,selected_id)
	name.add_theme_font_size_override("font_size",16)
	name.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	_button(heading,"Locate",func() -> void: _switch_tab("Yard"); focus_entity.emit(selected_id))
	_button(heading,"×",func() -> void: selected_id=""; entity_selected.emit(""); _render_inspector())
	_note(inspector_body,str(entity.get("name",entity.get("label",_name(str(entity.get("kind",entity.get("item",kind))))))))
	if entity.has("x"): _detail("Position",_position(entity))
	match kind:
		"workers": _worker_inspector(entity)
		"equipment": _equipment_inspector(entity)
		"jobs","jobGroups": _work_inspector(entity,kind=="jobGroups")
		"orders": _order_inspector(entity)
		"stacks":
			_detail("Material",_name(str(entity.get("item",""))))
			_detail("Quantity",entity.get("qty",0))
			_detail("Reserved",entity.get("reserved",0))
			_detail("Footprint","%s × %s m"%[entity.get("w",1),entity.get("d",1)])
			_detail("Mass",_mass(float(entity.get("qty",0))*float(catalog.get(entity.get("item",""),{}).get("mass",0))))
			_detail("Source",entity.get("source",""))
			if entity.get("item")=="diesel": _detail("Contents","%.1f / 200 L"%float(entity.get("liters",0)))
			if str(entity.get("item","")).begins_with("rail"):
				_button(inspector_body,"Relocate one exposed rail panel",func() -> void: _select_tool("relocate"))
				_note(inspector_body,"Click clear space in a stockyard. An owned machine and crew physically move an unreserved panel.")
		"buildings":
			_detail("Footprint","%s × %s m"%[entity.get("w",1),entity.get("d",1)])
			_detail("Utilities","Connected" if entity.get("connected",false) else "Connection required")
			_detail("Source",entity.get("source",""))
			_button(inspector_body,"Recover / remove building",func() -> void: _send("remove_building",{"id":selected_id}))
		"zones":
			_detail("Footprint","%s × %s m"%[entity.get("w",1),entity.get("d",1)])
			_button(inspector_body,"Remove empty stockyard",func() -> void: _send("remove_zone",{"id":selected_id}))
		"rails":
			_detail("Length","%.2f m"%float(entity.get("length",5)))
			_detail("Material",entity.get("item","rail"))
			_detail("Work group",entity.get("track",{}).get("groupId",""))
			if entity.has("selectedRoute"):
				_detail("Selected route",entity.selectedRoute)
				_button(inspector_body,"Request straight route",func() -> void: _send("turnout",{"id":selected_id,"route":"straight"}))
				_button(inspector_body,"Request branch route",func() -> void: _send("turnout",{"id":selected_id,"route":"branch"}))
			_button(inspector_body,"Designate named rail location",func() -> void: _rail_location_form(entity))
		"railLocations":
			_detail("Track",entity.get("trackId",""))
			_detail("Purpose",entity.get("kind",""))
			_detail("Length","%s m"%entity.get("length",0))
			_button(inspector_body,"Edit named location",func() -> void: _rail_location_form(entity))
		"notices":
			_detail("Time",_clock(entity.get("time",0)))
			_detail("Entity",entity.get("entity",""))
			_note(inspector_body,str(entity.get("detail","")))
			var stage: OptionButton = _option(inspector_body,["To do","Doing","Done"],["todo","doing","done"].find(entity.get("state","todo")))
			_button(inspector_body,"Update notice",func() -> void: _send("notice",{"id":selected_id,"state":["todo","doing","done"][stage.selected],"seen":true}))
		"buffer": _note(inspector_body,"The crew moves the buffer at the beginning and end of a connected rail work order.")
		_:
			for key: String in entity:
				if key!="id": _detail(key,entity[key])

	inspector_scroll.set_deferred("scroll_vertical",previous_scroll)

func _worker_inspector(worker: Dictionary) -> void:
	var id: String = str(worker.id)
	for pair: Array in [["Role","role"],["Duty","duty"],["Current action","status"],["Shift action","shiftPhase"],["Vehicle","vehicle"],["Work","job"],["Delivery","deliveryOrder"],["Support machine","assistingEquipment"]]: _detail(pair[0],worker.get(pair[1],"—"))
	_detail("Hours","%.1f h"%float(worker.get("hours",0)))
	_detail("Hourly wage",_money(worker.get("wage",0)))
	var schedule: Dictionary = worker.get("schedule",{})
	var start: SpinBox = _number(inspector_body,"Shift start hour",float(schedule.get("start",7)),0,23.99,0.25)
	var end: SpinBox = _number(inspector_body,"Shift end hour",float(schedule.get("end",17)),0,23.99,0.25)
	_button(inspector_body,"Apply shift schedule",func() -> void: _send("worker_schedule",{"id":id,"startHour":start.value,"endHour":end.value}))
	_button(inspector_body,"Always on duty",func() -> void: _send("worker_schedule",{"id":id,"startHour":null}))
	_button(inspector_body,"Take direct control / walk",func() -> void: controlled_worker=id; _send("control",{"id":id}); _select_tool("drive"))
	_button(inspector_body,"Return to automatic duty",func() -> void: _return_to_automatic(id))
	_button(inspector_body,"Rest / hold automatic work",func() -> void: _send("worker_duty",{"id":id,"duty":"auto" if worker.get("duty")=="rest" else "rest"}))
	if worker.has("vehicle"): _button(inspector_body,"Leave vehicle",func() -> void: _send("exit_vehicle",{"id":id}))
	if worker.has("assistingEquipment"): _button(inspector_body,"Release support assignment",func() -> void: _send("assistant",{"id":worker.assistingEquipment}))
	var machine: OptionButton = _entity_option(inspector_body,"equipment","Choose equipment to board…")
	_button(inspector_body,"Board selected equipment",func() -> void:
		if not _selection(machine).is_empty(): _send("enter_vehicle",{"workerId":id,"equipmentId":_selection(machine)}))

func _seated_operator(equipment: Dictionary) -> Dictionary:
	var worker_id: String = str(equipment.get("operator",""))
	for worker: Dictionary in _records("workers"):
		if str(worker.id)==worker_id and str(worker.get("vehicle",""))==str(equipment.id): return worker
	return {}

func _equipment_control(equipment: Dictionary) -> String:
	var operator: Dictionary = _seated_operator(equipment)
	if operator.is_empty(): return "No operator"
	match str(operator.get("duty","auto")):
		"manual": return "Manual driving"
		"rest": return "Resting"
	return "Automatic"

func _return_to_automatic(worker_id: String) -> void:
	if worker_id.is_empty(): return
	_send("release",{"id":worker_id})
	controlled_worker=""
	if active_tool=="drive":
		active_tool="select"
		tool_selected.emit("select")
	_update_control_banner()

func _update_control_banner() -> void:
	if not is_instance_valid(tool_label): return
	var driving: bool = active_tool=="drive" and not controlled_worker.is_empty()
	release_control_button.visible=driving
	if driving:
		var worker: Dictionary = _entity(controlled_worker).get("entity",{})
		var vehicle_id: String = str(worker.get("vehicle",""))
		tool_label.text="Manual driving · %s"%(vehicle_id if not vehicle_id.is_empty() else controlled_worker)
		tool_label.tooltip_text="Automatic work stays suspended until you return this worker to automatic duty. Click the yard to drive or walk."
	else:
		tool_label.text="Select · 1 m grid" if active_tool=="select" else "%s · click / drag the yard"%active_tool
		tool_label.tooltip_text="Construction ghosts: cyan queued, amber underway. Placement preview: green valid, red invalid."

func _equipment_inspector(equipment: Dictionary) -> void:
	var id: String = str(equipment.id)
	var control: String = _equipment_control(equipment)
	var operator_worker: Dictionary = _seated_operator(equipment)
	var indicator: Label = _label(inspector_body,"Control: "+control)
	indicator.add_theme_font_size_override("font_size",14)
	if control=="Manual driving": indicator.add_theme_color_override("font_color",Color("8b571f"))
	if control in ["Manual driving","Resting"]:
		var release_button: Button = _button(inspector_body,"Return to automatic work",func() -> void: _return_to_automatic(str(operator_worker.id)))
		release_button.custom_minimum_size.y=30
		_note(inspector_body,"Automatic jobs are suspended while the operator is under manual control." if control=="Manual driving" else "The seated operator is resting; automatic jobs are suspended.")
	_detail("Fuel","%.1f / %s L"%[float(equipment.get("fuel",0)),equipment.get("tank",0)])
	_detail("Diesel used","%.2f L"%float(equipment.get("used",0)))
	_detail("Lift limit",_mass(float(catalog.get(equipment.get("kind",""),{}).get("capacity",0))))
	for pair: Array in [["Operator","operator"],["Work","job"],["Delivery","deliveryOrder"],["Refueling","refueling"],["Blocker","blockedBy"]]: _detail(pair[0],equipment.get(pair[1],"—"))
	var intent: Dictionary = {}
	for value: Dictionary in metadata.get("render",{}).get("equipmentIntents",[]):
		if str(value.get("id",""))==id: intent=value
	_detail("Current step",intent.get("phase",equipment.get("parkingState","Available")))
	_detail("Condition",intent.get("detail",""))
	if intent.has("target"): _detail("Destination",str(intent.get("targetLabel",""))+" · "+_position(intent.target))
	if intent.has("references"): _detail("References"," · ".join(intent.references))
	_detail("Cargo","%s × %s"%[equipment.cargo.get("qty",0),_name(str(equipment.cargo.get("item","")))] if equipment.has("cargo") else "Empty")
	_label(inspector_body,"Automatic work")
	var roles: MenuButton = MenuButton.new()
	roles.text="▾ Select allowed job kinds"
	var popup: PopupMenu = roles.get_popup()
	popup.theme=screen.theme
	popup.hide_on_checkable_item_selection=false
	var activities: Array = equipment.get("allowedWork",ACTIVITIES if equipment.get("workRole","all")=="all" else ([] if equipment.get("workRole")=="hold" else [equipment.get("workRole")]))
	for i: int in range(ACTIVITIES.size()):
		popup.add_check_item(ACTIVITIES[i].capitalize(),i)
		popup.set_item_checked(i,ACTIVITIES[i] in activities)
	popup.add_separator()
	popup.add_item("All work",10)
	popup.add_item("Hold all automatic work",11)
	popup.id_pressed.connect(func(index: int) -> void:
		if index<5: popup.set_item_checked(index,not popup.is_item_checked(index))
		elif index==10:
			for i: int in range(5): popup.set_item_checked(i,true)
		elif index==11:
			for i: int in range(5): popup.set_item_checked(i,false)
		var checked: Array[String] = []
		for i: int in range(5):
			if popup.is_item_checked(i): checked.append(ACTIVITIES[i])
		_send("equipment_activities",{"id":id,"activities":checked}))
	inspector_body.add_child(roles)
	_label(inspector_body,"Dedicated support worker")
	var current_support: String = ""
	for worker: Dictionary in _records("workers"):
		if worker.get("assistingEquipment")==id: current_support=str(worker.id)
	var support: OptionButton = _entity_option(inspector_body,"workers","No dedicated support worker",current_support)
	_button(inspector_body,"Apply support worker",func() -> void:
		var args: Dictionary = {"id":id}
		if not _selection(support).is_empty(): args.workerId=_selection(support)
		_send("assistant",args))
	_button(inspector_body,"Request refueling",func() -> void: _send("refuel",{"id":id}))
	var operator: OptionButton = _entity_option(inspector_body,"workers","Choose operator to board…",str(equipment.get("operator","")),true)
	_button(inspector_body,"Board operator",func() -> void:
		if not _selection(operator).is_empty(): _send("enter_vehicle",{"workerId":_selection(operator),"equipmentId":id}))
	var drive_button: Button = _button(inspector_body,"Drive manually",func() -> void:
		controlled_worker=str(operator_worker.id)
		_send("control",{"id":controlled_worker})
		_select_tool("drive"))
	drive_button.disabled=operator_worker.is_empty()
	drive_button.tooltip_text="Board an operator first." if operator_worker.is_empty() else "Automatic jobs pause until you return this operator to automatic duty."
	if equipment.has("deliveryOrder"):
		var unloading_paused: bool = false
		for order: Dictionary in _records("orders"):
			if str(order.id)==str(equipment.deliveryOrder): unloading_paused=bool(order.get("unloadPaused",false))
		var pause_delivery_button: Button = _button(inspector_body,"Pause unloading for manual recovery",func() -> void:
			_send("delivery_pause",{"id":id})
			controlled_worker=str(operator_worker.get("id",""))
			_select_tool("drive"))
		pause_delivery_button.disabled=unloading_paused or operator_worker.is_empty()
		var resume_delivery_button: Button = _button(inspector_body,"Resume automatic unloading",func() -> void: _return_to_automatic(str(operator_worker.get("id",""))))
		resume_delivery_button.disabled=not unloading_paused or operator_worker.is_empty()
	_label(inspector_body,"Parking bay")
	var parking: Dictionary = equipment.get("parking",{})
	var x: SpinBox = _number(inspector_body,"East (m)",float(parking.get("x",equipment.get("x",0))),-10000,10000,0.5)
	var z: SpinBox = _number(inspector_body,"South (m)",float(parking.get("z",equipment.get("z",0))),-10000,10000,0.5)
	var direction: OptionButton = _option(inspector_body,["North","East","South","West"],int(parking.get("rotation",0)))
	_button(inspector_body,"Apply parking bay",func() -> void: _send("parking",{"id":id,"x":x.value,"z":z.value,"rotation":direction.selected}))
	_button(inspector_body,"Pick parking bay in yard",func() -> void: _select_tool("parking"))
	_button(inspector_body,"Clear parking bay",func() -> void: _send("clear_parking",{"id":id}))
	_note(inspector_body,"Role changes preserve safe completion. Manual work assignments take precedence. Parking is used at idle time and at shift end.")

func _work_inspector(work: Dictionary,group: bool) -> void:
	var id: String = str(work.id)
	if group:
		_detail("Tasks",_work_tasks(id).size())
		_detail("Parent",work.get("parentId","Top-level work order"))
		_detail("Automatic machine",work.get("automaticEquipment","Not selected yet"))
		_button(inspector_body,"Expand / collapse this work",func() -> void: group_expansion[id]=not group_expansion.get(id,false); _refresh_register())
	else:
		for pair: Array in [["State","status"],["Current step","phase"],["Condition","reason"],["Worker","worker"],["Operator","operator"],["Equipment","equipment"],["Reserved stock","stack"],["Parent work","parentId"]]: _detail(pair[0],work.get(pair[1],"—"))
		if work.get("railWork",{}).has("siteClearance"):
			_detail("Handling blockers"," · ".join(work.railWork.siteClearance.get("blockers",[])))
			_detail("Staging position",_position(work.railWork.stage))
		_detail("Progress","%d%%"%roundi(float(work.get("progress",0))*100))
		if work.has("item"): _detail("Material","%s × %s"%[work.get("qty",0),_name(str(work.item))])
		if work.has("shedAssembly"):
			var assembly: Dictionary = work.shedAssembly
			_detail("Assembly",assembly.get("phase",""))
			_detail("Installed parts","%s anchors · %s posts · %s beams · %s roof sheets"%[assembly.get("anchors",0),assembly.get("posts",0),assembly.get("beams",0),assembly.get("roofSheets",0)])
	_label(inspector_body,"Manually assign equipment")
	var preferred: OptionButton = _entity_option(inspector_body,"equipment","Automatic assignment",str(work.get("preferredEquipment","")))
	_button(inspector_body,"Apply equipment to this whole work",func() -> void:
		var args: Dictionary = {"id":id}
		if not _selection(preferred).is_empty(): args.equipmentId=_selection(preferred)
		_send("job_equipment",args))
	var rail_work: bool = work.has("track") or work.get("kind")=="rail"
	if group:
		for task: Dictionary in _work_tasks(id):
			if task.has("track") or task.get("kind")=="rail": rail_work=true
	if rail_work:
		_label(inspector_body,"Two-machine rail work group")
		var crew: Dictionary = work.get("railCrew",{})
		_label(inspector_body,"Staging / transport equipment")
		var staging: OptionButton = _entity_option(inspector_body,"equipment","Single-machine operation",str(crew.get("stagingEquipment","")))
		_label(inspector_body,"Installing equipment")
		var installing: OptionButton = _entity_option(inspector_body,"equipment","Choose installation equipment",str(crew.get("installingEquipment","")))
		_button(inspector_body,"Apply rail work group",func() -> void:
			var args: Dictionary = {"id":id}
			if not _selection(staging).is_empty(): args.stagingEquipmentId=_selection(staging)
			if not _selection(installing).is_empty(): args.installingEquipmentId=_selection(installing)
			_send("rail_crew",args))
		_note(inspector_body,"Apply to the top rail work order to cover every connected panel. Staging carries as many required panels as the lift limit permits.")
	_button(inspector_body,"Prioritize remaining work",func() -> void: _send("priority",{"id":id}))
	if not group and work.get("status") in ["todo","doing"]:
		_button(inspector_body,"Cancel this task",func() -> void: _send("cancel_job",{"id":id}))
		var worker: OptionButton = _entity_option(inspector_body,"workers","Choose preferred worker…",str(work.get("preferredWorker","")))
		_button(inspector_body,"Assign preferred worker",func() -> void:
			if not _selection(worker).is_empty(): _send("assign_worker",{"id":id,"workerId":_selection(worker)}))
	if work.has("track") and (group or work.get("status")=="canceled"):
		_button(inspector_body,"Resume canceled rail work",func() -> void: _send("resume_track",{"id":id}))
	if group:
		_label(inspector_body,"Individual tasks")
		var tasks: Array[Dictionary] = _work_tasks(id)
		for task: Dictionary in tasks.slice(0,60):
			_button(inspector_body,"%s · %s · %s"%[task.id,_name(str(task.get("kind",""))),task.get("status","")],func() -> void: _user_entity(str(task.id)))

func _order_inspector(order: Dictionary) -> void:
	var id: String = str(order.id)
	for pair: Array in [["State","status"],["Transport","mode"],["Receiving note","note"],["Equipment","equipmentId"],["Operator","operatorId"],["Automatic machine","automaticEquipment"]]: _detail(pair[0],order.get(pair[1],"—"))
	var driving: Dictionary = order.get("drive",{})
	_detail("Driving blocker",driving.get("blockedBy","—"))
	_detail("Clearance requested from",driving.get("clearanceRequestedFor","—"))
	_detail("ETA",_clock(order.get("eta",0)))
	_detail("Total",_money(order.get("total",0)))
	for line: Dictionary in order.get("manifest",[{"item":order.get("item",""),"qty":order.get("qty",0),"arrived":order.get("arrived",0)}]):
		_detail(_name(str(line.get("item",""))),"%s ordered · %s received"%[line.get("qty",0),line.get("arrived",0)])
	if order.has("unload"):
		_detail("Lift phase",order.unload.get("phase",""))
		_detail("Handling machine",order.unload.get("equipmentId",""))
		_detail("Ground helper",order.unload.get("riggerId",""))
	var worker: OptionButton = _entity_option(inspector_body,"workers","Choose receiving operator…",controlled_worker,true)
	_button(inspector_body,"Assign operator to unloading",func() -> void:
		if not _selection(worker).is_empty(): _send("unload",{"orderId":id,"workerId":_selection(worker)}))

func _new_rail_location() -> void:
	var track: Dictionary = {}
	for rail: Dictionary in _records("rails"):
		if str(rail.get("id",""))==selected_id: track=rail
	if track.is_empty():
		show_error("Select an installed track first, then designate its named location.")
		return
	_rail_location_form(track)

func _rail_location_form(entity: Dictionary) -> void:
	var window: Window = Window.new()
	window.title="Named railway location"
	window.size=Vector2i(460,430)
	window.exclusive=true
	window.theme=screen.theme
	screen.add_child(window)
	_window_background(window)
	var margin: MarginContainer = MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left","right","top","bottom"]: margin.add_theme_constant_override("margin_"+side,12)
	window.add_child(margin)
	var body: VBoxContainer = VBoxContainer.new()
	margin.add_child(body)
	_label(body,"Name")
	var name: LineEdit = LineEdit.new()
	name.text=str(entity.get("name","Rail location"))
	body.add_child(name)
	var purpose: OptionButton = _option(body,["loading","unloading","transfer","parking"],["loading","unloading","transfer","parking"].find(entity.get("kind","unloading")))
	var route: OptionButton = _option(body,["straight","branch"],1 if entity.get("route")=="branch" else 0)
	var track_id: String = str(entity.get("trackId",entity.get("id","")))
	_label(body,"Track "+track_id)
	var offset: SpinBox = _number(body,"Offset (m)",float(entity.get("offset",0)),0,10000,0.1)
	var length: SpinBox = _number(body,"Centered usable length (m)",float(entity.get("length",5)),1,200,0.5)
	_note(body,"A map designation for future operations; it does not redirect deliveries or certify train clearance.")
	_button(body,"Save designation",func() -> void:
		var location: Dictionary = {"name":name.text,"kind":purpose.get_item_text(purpose.selected),"trackId":track_id,"route":route.get_item_text(route.selected),"offset":offset.value,"length":length.value}
		if entity.has("trackId"): location.id=entity.id
		_send("save_rail_location",{"location":location})
		window.queue_free())
	if entity.has("trackId"): _button(body,"Remove designation",func() -> void: _send("remove_rail_location",{"id":entity.id}); window.queue_free())
	window.close_requested.connect(window.queue_free)
	window.popup_centered()

func _build_sql() -> void:
	_note(register_body,"Read-only SQLite snapshot · SELECT, WITH, EXPLAIN. Tables: inventory, workers, equipment, jobs, job_groups, work_orders, orders, stacks, buildings, rails, rail_locations, zones, movements, costs, events.")
	var examples: HBoxContainer = HBoxContainer.new()
	register_body.add_child(examples)
	for value: Dictionary in [{"name":"Active jobs","sql":"SELECT id, kind, status, phase, reason FROM jobs WHERE status IN ('todo','doing') LIMIT 100"},{"name":"Fuel usage","sql":"SELECT id, kind, fuel, used FROM equipment"},{"name":"Costs","sql":"SELECT category, SUM(amount) AS total FROM costs GROUP BY category ORDER BY total DESC"},{"name":"Stock","sql":"SELECT * FROM inventory"}]:
		_button(examples,str(value.name),func() -> void: query_text.text=str(value.sql))
	query_text=TextEdit.new()
	query_text.custom_minimum_size.y=120
	query_text.text="SELECT id, kind, status, phase, reason FROM jobs WHERE status IN ('todo','doing') LIMIT 100"
	register_body.add_child(query_text)
	var run: HBoxContainer = HBoxContainer.new()
	register_body.add_child(run)
	_button(run,"Run query",func() -> void: _send("sql",{"sql":query_text.text}))
	sql_status=_label(run,"Ready · snapshot created when you run")
	sql_table=_table(register_body,"Results",["Result"])

func _display_sql(message: Dictionary) -> void:
	var raw_result: Variant = message.get("result",message)
	var result: Dictionary = {}
	if raw_result is Array and not raw_result.is_empty(): result=raw_result[0]
	elif raw_result is Dictionary: result=raw_result
	var columns: Array[String] = []
	for column: Variant in result.get("columns",[]): columns.append(str(column))
	if columns.is_empty():
		sql_status.text="No rows returned"
		return
	var rows: Array[Dictionary] = []
	var index: int = 0
	for values: Variant in result.get("rows",result.get("values",[])):
		var cells: Array = values if values is Array else []
		if values is Dictionary:
			for column: String in columns: cells.append(values.get(column,""))
		rows.append(_row(str(index),cells))
		index+=1
	register_body.remove_child(sql_table)
	sql_table.queue_free()
	tables.clear()
	sql_table=_table(register_body,"Results",columns)
	sql_table.set_rows(rows)
	sql_status.text="%d rows · live simulation unchanged"%rows.size()

func _build_toast() -> void:
	toast=PanelContainer.new()
	toast.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	toast.offset_left=-690
	toast.offset_right=-365
	toast.offset_top=-210
	toast.offset_bottom=-82
	toast.visible=false
	content.add_child(toast)
	toast_body=VBoxContainer.new()
	toast.add_child(toast_body)

func _check_notices() -> void:
	var notices: Array[Dictionary] = _records("notices")
	if notices.is_empty(): return
	var newest: Dictionary = notices[0]
	if str(newest.id)==latest_notice: return
	latest_notice=str(newest.id)
	if not started or newest.get("seen",false): return
	_clear(toast_body)
	var top: HBoxContainer = HBoxContainer.new()
	toast_body.add_child(top)
	var title: Label = _label(top,str(newest.get("title","Operational notice")))
	title.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	_button(top,"×",func() -> void: toast.hide())
	_note(toast_body,str(newest.get("detail","")))
	var actions: HBoxContainer = HBoxContainer.new()
	toast_body.add_child(actions)
	_button(actions,"Inspect",func() -> void: _user_entity(str(newest.get("entity",""))); _send("notice",{"id":newest.id,"seen":true}); toast.hide())
	_button(actions,"Inbox",func() -> void: _switch_tab("Inbox"); toast.hide())
	toast.visible=true
	toast_age=0

func _open_purchase() -> void:
	if is_instance_valid(purchase_window):
		purchase_window.popup_centered()
		return
	purchase_window=Window.new()
	purchase_window.title="Purchase materials / equipment · Hire workers"
	purchase_window.size=Vector2i(860,670)
	purchase_window.exclusive=true
	purchase_window.theme=screen.theme
	screen.add_child(purchase_window)
	_window_background(purchase_window)
	var margin: MarginContainer = MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left","right","top","bottom"]: margin.add_theme_constant_override("margin_"+side,12)
	purchase_window.add_child(margin)
	var body: VBoxContainer = VBoxContainer.new()
	body.add_theme_constant_override("separation",4)
	margin.add_child(body)
	_note(body,"Combine workers on one bus and supplies on one truck/train. Physical weight and deck space determine the carrier count. No budget limit; all costs are recorded.")
	var header: HBoxContainer = HBoxContainer.new()
	body.add_child(header)
	_label(header,"Preferred material transport")
	purchase_mode=_option(header,["Road · 12 t truck","Rail · 48 t train"])
	purchase_mode.item_selected.connect(func(_index: int) -> void: _purchase_changed())
	var scroll: ScrollContainer = ScrollContainer.new()
	scroll.size_flags_vertical=Control.SIZE_EXPAND_FILL
	body.add_child(scroll)
	var catalog_grid: GridContainer = GridContainer.new()
	catalog_grid.columns=5
	catalog_grid.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	scroll.add_child(catalog_grid)
	for title: String in ["Item / role","Unit price","Unit mass","Quantity","Ordered mass"]: _label(catalog_grid,title)
	for key: String in catalog:
		var entry: Dictionary = catalog[key]
		_label(catalog_grid,str(entry.name)).size_flags_horizontal=Control.SIZE_EXPAND_FILL
		_label(catalog_grid,_money(entry.get("price",0))+("/hire" if key in ["builder","operator","engineer"] else ""))
		_label(catalog_grid,_mass(float(entry.get("mass",0))) if entry.has("mass") else ("%s/hour"%_money(entry.get("wage",0)) if entry.has("wage") else "Service"))
		var quantity: SpinBox = SpinBox.new()
		quantity.min_value=0
		quantity.max_value=9999
		quantity.step=1
		quantity.update_on_text_changed=true
		quantity.custom_minimum_size.x=76
		catalog_grid.add_child(quantity)
		purchase_quantity[key]=quantity
		var mass: Label = _label(catalog_grid,"—")
		mass.custom_minimum_size.x=90
		purchase_mass_labels[key]=mass
		quantity.value_changed.connect(func(value: float) -> void:
			mass.text=_mass(value*float(entry.get("mass",0))) if entry.has("mass") else ("%d passengers"%int(value) if entry.has("wage") else "%d services"%int(value))
			_purchase_changed.call_deferred())
		quantity.get_line_edit().text_changed.connect(func(typed: String) -> void:
			var amount: int = clampi(typed.to_int(),0,9999) if typed.is_valid_int() else 0
			mass.text=_mass(amount*float(entry.get("mass",0))) if entry.has("mass") else ("%d passengers"%amount if entry.has("wage") else "%d services"%amount)
			_purchase_changed())
	purchase_total=_note(body,"Add catalog quantities to create one batch.")
	_note(body,"12 seats per bus. Equipment uses dedicated lowloaders. Deck space can require extra loads before the weight limit.")
	var footer: HBoxContainer = HBoxContainer.new()
	body.add_child(footer)
	_button(footer,"Clear quantities",func() -> void:
		for input: SpinBox in purchase_quantity.values(): input.value=0)
	purchase_batch=_button(footer,"Place batch order",_place_purchase)
	_button(footer,"Close",purchase_window.hide)
	purchase_window.close_requested.connect(purchase_window.hide)
	purchase_window.popup_centered()
	_purchase_changed()

func _purchase_lines() -> Array[Dictionary]:
	var lines: Array[Dictionary] = []
	for key: String in purchase_quantity:
		var spin: SpinBox = purchase_quantity[key] as SpinBox
		var typed: String = spin.get_line_edit().text.strip_edges()
		var quantity: int = clampi(typed.to_int(),0,9999) if typed.is_valid_int() else 0
		if quantity>0: lines.append({"item":key,"qty":quantity})
	return lines

func _purchase_changed() -> void:
	var lines: Array[Dictionary] = _purchase_lines()
	var mass: float = 0
	var total: float = 0
	var people: int = 0
	for line: Dictionary in lines:
		var entry: Dictionary = catalog[line.item]
		mass+=float(entry.get("mass",0))*int(line.qty)
		total+=float(entry.get("price",0))*int(line.qty)
		if entry.has("wage"): people+=int(line.qty)
	purchase_total.text="%d lines · %s cargo · %d workers · %s before carrier charges"%[lines.size(),_mass(mass),people,_money(total)]
	purchase_batch.disabled=lines.is_empty()
	if not lines.is_empty() and not purchase_preview_pending:
		purchase_preview_pending=true
		_request_purchase_preview.call_deferred()

func _request_purchase_preview() -> void:
	purchase_preview_pending=false
	if not is_instance_valid(purchase_window) or not purchase_window.visible: return
	var lines: Array[Dictionary] = _purchase_lines()
	if not lines.is_empty(): _send("purchase_preview",{"lines":lines,"mode":"road" if purchase_mode.selected==0 else "rail"})

func _place_purchase() -> void:
	for key: String in purchase_quantity:
		var quantity: SpinBox = purchase_quantity[key] as SpinBox
		var typed: String = quantity.get_line_edit().text.strip_edges()
		if not typed.is_empty() and not typed.is_valid_int():
			purchase_total.text="Enter a whole-number quantity for "+_name(key)+". "
			return
		quantity.apply()
	var lines: Array[Dictionary] = _purchase_lines()
	if lines.is_empty(): return
	_send("purchase_batch",{"lines":lines,"mode":"road" if purchase_mode.selected==0 else "rail"})
	purchase_window.hide()

func show_purchase() -> void:
	_open_purchase()

func show_tab(value: String) -> void:
	var aliases: Dictionary = {"site":"Yard","railways":"Railway","materials":"Materials","workers":"Workers","equipment":"Equipment","deliveries":"Deliveries","jobs":"Work","activity":"Activity","costs":"Costs","reports":"SQL","notices":"Inbox"}
	var target: String = str(aliases.get(value.to_lower(),value.capitalize()))
	if value.to_upper()=="SQL": target="SQL"
	if target in TABS: _switch_tab(target)

func _user_entity(id: String) -> void:
	show_entity(id)
	entity_selected.emit(id)
