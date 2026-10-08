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
const ProcessUI = preload("res://scripts/process_ui.gd")
const CollectionUI = preload("res://scripts/collection_ui.gd")
const ElectricalUI = preload("res://scripts/electrical_ui.gd")
const StorageMoveUI = preload("res://scripts/storage_move_ui.gd")
var collection_ui: RefCounted = CollectionUI.new()
var electrical_ui: RefCounted = ElectricalUI.new()
var storage_move_ui: RefCounted = StorageMoveUI.new()
const TABS: Array[String] = ["Yard","Railway","Process","Electrical","Materials","Workers","Equipment","Deliveries","Work","Activity","Costs","SQL","Inbox"]
const ACTIVITIES: Array[String] = ["receiving","paving","construction","rail","recovery"]
const CATALOG: Dictionary = {
	"builder":{"name":"Construction worker","price":90,"wage":28},"operator":{"name":"Equipment operator","price":120,"wage":36},"engineer":{"name":"Site engineer","price":150,"wage":42},
	"excavator":{"name":"EX-6 tracked excavator","price":64000,"mass":8500,"capacity":6000},"forklift":{"name":"FL-25 rough-terrain forklift","price":28500,"mass":4500,"capacity":2500},
	"slab":{"name":"Concrete slab · 1 × 1 m","price":38,"mass":280},"rail":{"name":"Straight rail panel · 5 m","price":780,"mass":1450},"railCurve":{"name":"Curved rail panel · 15°","price":1120,"mass":1520},
	"bufferStop":{"name":"Railway buffer stop","price":1250,"mass":850},
	"railPoints":{"name":"Turnout points module","price":3100,"mass":1750},"railFrog":{"name":"Turnout frog module","price":2450,"mass":1520},"railClosure":{"name":"Turnout closure module","price":2100,"mass":1520},"railExit":{"name":"Turnout exit module","price":1950,"mass":1520},
	"office":{"name":"Office container","price":7200,"mass":4800},"sanitary":{"name":"Sanitary container","price":4600,"mass":2000},"shed":{"name":"Equipment shed kit","price":5200,"mass":2200},"store":{"name":"Stores building kit","price":6400,"mass":2600},
	"lamp":{"name":"Light pole kit","price":340,"mass":160},"diesel":{"name":"Diesel drum · 200 L","price":320,"mass":185},"fence":{"name":"Fence panel","price":115,"mass":60},"power":{"name":"Utility station · 16 kW","price":1800},"water":{"name":"Water/sewer connection","price":2300},"electricalJunction":{"name":"Electrical junction cabinet kit","price":950,"mass":120,"w":1,"d":1,"max":1},"cableReel":{"name":"Low-voltage cable reel · 50 m","price":600,"mass":185,"w":1,"d":1,"max":1}
}

var catalog: Dictionary = CATALOG.duplicate(true)
var state: Dictionary = {}
var metadata: Dictionary = {}
var started: bool = false
var selected_id: String = ""
var freight_car_selection: Dictionary = {}
var freight_shunt_choices: Dictionary = {}
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
var creative_button: CheckButton
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
var latest_notice_key: String = ""
var toast_age: float = 0.0
var update_clock: float = 0.0
var refresh_pending: bool = false
var inspector_pending: bool = false
var menu: PopupMenu
var confirmation: ConfirmationDialog
var pending_confirmation: Callable
var tool_label: Label
var electrical_tool_hint: String=""
var electrical_pick_hint: String=""
var electrical_pick_cancel: Button
var release_control_button: Button
var group_expansion: Dictionary = {}
var rail_tool_buttons: Dictionary = {}
var buffer_endpoint_window: Window
var buffer_summary_label: Label
var rail_edit_window: Window
var rail_edit_body: VBoxContainer
var rail_edit_footer: HBoxContainer
var rail_edit_request: Dictionary = {}
var purchase_reception: OptionButton
var purchase_stockyard: OptionButton
var purchase_rail_controls: VBoxContainer

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
	status_label.clip_text=true
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
	button.button_down.connect(func() -> void: button.set_meta("interaction_pressed",true))
	button.button_up.connect(func() -> void: button.set_meta("interaction_pressed",false))
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
	if key=="bulkWater":return "Process water (L)"
	if key=="bulkDiesel":return "Bulk diesel (L)"
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
	light.text="Dusk preview"
	light.tooltip_text="Unchecked: sunlight and full-moon nights follow the simulated clock. Checked: hold a dusk preview without changing game time."
	light.toggled.connect(func(value: bool) -> void: lighting_requested.emit(value))
	camera_bar.add_child(light)
	creative_button=CheckButton.new()
	creative_button.text="Creative"
	creative_button.tooltip_text="Place completed paving, buildings, rails and buffer stops immediately. Includes building foundations; no materials, workers or construction charges. Existing work is unchanged. Turn off to resume normal planning. Saved with this yard."
	creative_button.toggled.connect(func(value: bool) -> void: _send("creative",{"enabled":value}))
	camera_bar.add_child(creative_button)
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
	var choices: Dictionary = {"select":"Select","slab":"Pave","office":"Office","sanitary":"WC","shed":"Shed","engineShed":"Engine shed","store":"Stores","lamp":"Light","electricalJunction":"Junction","fence":"Fence","power":"Power…","water":"Water","zone":"Stockyard"}
	for key: String in choices:
		_button(row,str(choices[key]),func() -> void:
			if key=="power":ElectricalUI.station_dialog(self)
			else:_select_tool(key))
	var rail_row: HBoxContainer = HBoxContainer.new()
	tools.add_child(rail_row)
	var rail_choices: Dictionary = {"railStraight":"Straight rail","railCurve":"90° curve","railTurnout":"Diverging switch","railConverging":"Converging switch"}
	for key: String in rail_choices:
		var rail_button: Button = _button(rail_row,str(rail_choices[key]),func() -> void: _select_tool(key))
		rail_button.toggle_mode=true
		rail_tool_buttons[key]=rail_button
	(rail_tool_buttons["railTurnout"] as Button).tooltip_text="One incoming track splits into two. Click the incoming endpoint and point away from it."
	(rail_tool_buttons["railConverging"] as Button).tooltip_text="Two incoming tracks join one. Click the straight incoming endpoint and point toward the junction; incoming tracks must be 5 meters apart."
	_button(rail_row,"Cable…",func()->void:electrical_ui.resume_plan_dialog(self))
	electrical_pick_cancel=_button(rail_row,"Back to cable plan",func()->void:_send("electrical_pick_cancel",{}))
	electrical_pick_cancel.visible=false
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
	for key: String in rail_tool_buttons:
		(rail_tool_buttons[key] as Button).set_pressed_no_signal(key==kind)
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
	menu.add_item("Railway management help",11)
	menu.add_item("Sound settings…",12)
	menu.add_item("Underground electrical help",13)
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
		11: _switch_tab("Help")
		12: command.emit("audio_settings",{})
		13: ElectricalUI.help_dialog(self)
		10:
			var index: int = menu.get_item_index(10)
			var enabled: bool = not menu.is_item_checked(index)
			menu.set_item_checked(index,enabled)
			command.emit("native_resolution",{"value":enabled})
		8:
			var help: AcceptDialog = AcceptDialog.new()
			help.title="Plant 01 controls"
			help.dialog_text="Drag empty ground to pan; right drag to orbit; scroll to zoom. WASD moves relative to the view. Space pauses. R rotates a plan.\n\nPurchase workers, machines, and materials. Deliveries need owned equipment and an operator. Designate physical stockyards, pave foundations, and plan construction. IDs in every register open the inspector. Assign machines to whole work orders or rail crews.\n\n1× uses real time. The simulation continues while this window is unfocused. Save files and rolling diagnostic history remain on this device."
			help.dialog_text += "\n\nAutomatic work chooses reachable nearby qualified workers. Explicit crews and active work keep precedence. Idle automatic blockers can move clear with their real operators. After 20 simulated seconds, a persistent warning links the work and blocker. Use Warnings only in Activity or Inbox, then Inspect / Locate. Return to automatic duty (worker) or Return to automatic work (equipment) releases manual control. Fixed stock or a boxed-in load may need relocation."
			help.dialog_text += "\n\nElectrical: order a utility station, cable reels, an excavator, and crew. Plan a specific station-to-light or station-to-pump circuit from the Electrical register. Outside terminal cells are highlighted in Yard; click or drag between them and use R to swap the elbow. Electrical help explains trench/spoil access, crew, testing, and the 16 kW capacity limit."
			help.dialog_text += "\n\nSave folder: " + str(metadata.get("storage",{}).get("dataDir","Not connected yet"))
			screen.add_child(help)
			_window_background(help)
			help.popup_centered(Vector2i(760,500))

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
	creative_button.set_pressed_no_signal(bool(state.get("creative",false)))
	pause_button.text="▶" if bool(state.get("paused",true)) else "Ⅱ"
	var active: int = 0
	var queued: int = 0
	for job: Dictionary in _records("jobs"):
		if job.get("status")=="doing": active+=1
		if job.get("status")=="todo": queued+=1
	var total: float = 0
	for cost: Dictionary in _records("costs"): total+=float(cost.get("amount",0))
	total=float(message.get("summaries",{}).get("totalCosts",total))
	summary_label.text=("CREATIVE · " if bool(state.get("creative",false)) else "")+"%d workers · %d working · %d queued · %s"%[_records("workers").size(),active,queued,_money(total)]
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
	if _interacting(node): return true
	var focus: Control = node.get_viewport().gui_get_focus_owner()
	return focus!=null and node.is_ancestor_of(focus) and (focus is LineEdit or focus is TextEdit or focus is SpinBox or focus is OptionButton)

func _interacting(node: Node) -> bool:
	# A live refresh must not remove a button between press and release,
	# including keyboard activation. Rebuild after the interaction finishes.
	if node is BaseButton and bool(node.get_meta("interaction_pressed",false)): return true
	if (node is MenuButton or node is OptionButton) and node.get_popup().visible: return true
	for child: Node in node.get_children():
		if _interacting(child): return true
	return false

func show_entity(id: String) -> void:
	selected_id=id
	_render_inspector()

func show_error(text: String) -> void:
	error_label.text=text
	error_label.visible=not text.is_empty()
	status_label.text=text

func receive_reply(message: Dictionary) -> void:
	collection_ui.receive(self,message)
	storage_move_ui.receive(self,message)
	if bool(message.get("ok",true)):
		error_label.visible=false
		if str(message.get("action",""))=="purchase_batch" and is_instance_valid(purchase_window):
			for quantity: SpinBox in purchase_quantity.values(): quantity.set_value_no_signal(0)
			for mass_label: Label in purchase_mass_labels.values(): mass_label.text="—"
			purchase_total.text="Order placed. Add new quantities for another batch."
			purchase_batch.disabled=true
		if str(message.get("action","")) in ["new_game","continue","import","load"]:
			freight_car_selection.clear();freight_shunt_choices.clear()
			started=true
			startup.hide()
		if message.has("message"): status_label.text=str(message.message)
		elif message.has("action"): status_label.text="%s updated"%str(message.action).replace("_"," ")
	else: show_error(str(message.get("error","Action could not be completed.")))
	if message.get("action")=="rail_edit_preview" and is_instance_valid(rail_edit_window):
		if bool(message.get("ok",false)):_show_rail_edit_preview(message.get("result",{}))
		else:
			_clear(rail_edit_body)
			_note(rail_edit_body,str(message.get("error","Preview unavailable. Close and try again.")))
	if message.get("action")=="purchase_preview" and is_instance_valid(purchase_total):
		var preview: Dictionary = message.get("result",{})
		var price: float = 0.0
		for line: Dictionary in _purchase_lines(): price+=float(catalog.get(line.item,{}).get("price",0))*float(line.qty)
		if preview.has("transportCost"):price+=float(preview.transportCost)
		else:
			for load: Dictionary in preview.get("loads",[]): price+=240.0 if load.get("mode")=="rail" else 90.0
		purchase_total.text="%s cargo · %s including freight · %s carrier loads"%[_mass(float(preview.get("mass",0))),_money(price),preview.get("loads",[]).size()]
		if int(preview.get("railCars",0))>0:purchase_total.text+=" · %d rail cars · %.1f m train"%[int(preview.railCars),float(preview.get("trainLength",0))]
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
	if active_tab=="Help": _build_rail_help(); return
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
	if active_tab in ["Work","Deliveries","Inbox","Electrical"]:
		record_status=_option(filters,["Active","All","To do","Doing","Done","Canceled"] if active_tab=="Work" else ["Active","All","Done"])
		record_status.item_selected.connect(func(_index: int) -> void: _refresh_register())
	if active_tab in ["Activity","Inbox"]:
		severity_filter=_option(filters,["All events" if active_tab=="Activity" else "All notices","Warnings only","Info only"])
		severity_filter.item_selected.connect(func(_index: int) -> void: _refresh_register())
	match active_tab:
		"Process": ProcessUI.build_register(self)
		"Electrical": electrical_ui.build_register(self)
		"Railway":
			_note(register_body,"Receive a train, release its supplier engine through the siding exit, and use an owned shunter to move selected cars to named tracks. Rail management help walks through unloading and empty returns.")
			var rail_actions: HBoxContainer = HBoxContainer.new()
			register_body.add_child(rail_actions)
			_button(rail_actions,"Rail management help",func() -> void: _switch_tab("Help"))
			_button(rail_actions,"+ Receiving point",func() -> void: _rail_location_form({"id":"BOOTSTRAP-SIDING","name":"Receiving siding","kind":"unloading","offset":30,"length":40}))
			_button(rail_actions,"+ Named location",_new_rail_location)
			var rail_operations: HBoxContainer = HBoxContainer.new()
			register_body.add_child(rail_operations)
			_button(rail_operations,"+ Yard access switch",_yard_access_form)
			_button(rail_operations,"Mainline connection",_mainline_exit_form)
			_button(rail_operations,"+ Shunter",_shunter_order_form)
			_button(rail_operations,"+ Tanker train",_tanker_order_form)
			_button(rail_operations,"Collect empty cars",func() -> void: _return_train_form())
			_button(rail_operations,"Buffer stops / editing",func() -> void: _buffer_endpoint_form())
			buffer_summary_label=_note(register_body,_buffer_summary()+" Select installed track to review panel or assembly recovery. Plans remain in Work until built.")
			_table(register_body,"Named locations",["ID","Name","Purpose","Track","Offset m","Length m","Status"])
			_table(register_body,"Installed track",["ID","Piece","Position","Length m","Route","Group"])
			_table(register_body,"Open track endpoints · select one to install a buffer stop",["ID","Track","Route","Position","Buffer / reservation"])
			_table(register_body,"Installed buffer stops · select to review recovery",["ID","Position","Secured","Carried","Source"])
			_table(register_body,"Rail freight cars · select a car to inspect its linked delivery and manifest",["Car","Train / order","Reception","Ordered mass","Remaining mass","Storage","Status"])
			# Keep the rail operations registers compact.
			_table(register_body,"Owned shunters · select to assign a driver",["ID","Name","Driver","Position","Fuel L","State","Waiting / assignment"])
			_table(register_body,"Buffer stop stock and incoming orders · select an ID to inspect",["ID","State","Quantity","Destination / position","Source"])
			_table(register_body,"Buffer-stop work · select for assignment and waiting reasons",["ID","Operation","Status","Destination","Worker","Equipment","Waiting / step"])
			_table(register_body,"Active rail route reservations · select the owning train or locomotive",["Owner","Operation","Track sections","Progress m","Cars","Waiting for"])
			for table: Control in tables:table.tree.custom_minimum_size.y=34
		"Materials":
			_button(register_body,"Collect unwanted material…",func() -> void:collection_ui.open(self))
			_table(register_body,"Inventory",["Material","Delivered","Incoming","Stored","Reserved","In transit","On collection truck","Installed","Construction","Collected","Mass stored"])
			_table(register_body,"Physical stacks",["ID","Material","Qty","Reserved","Footprint","Position","Source","Consumable contents"])
		"Workers": _table(register_body,"",["ID","Name","Role","Duty","Shift","Status","Job / delivery","Vehicle","Support","Hours"])
		"Equipment":
			_table(register_body,"Mobile equipment",["ID","Type","Control","Auto work","Operator","Job / delivery","Fuel L","Used L","Parking","Status"])
			_table(register_body,"Buildings",["ID","Name","Kind","Position","Footprint","Utilities"])
			_table(register_body,"Retired equipment archive",["ID","Type","Collection","Remaining diesel L","Lifetime diesel used L"])
		"Deliveries":
			_table(register_body,"",["ID","Items","Qty","Arrived","Mass","Mode","ETA","Status","Receiving note","Cost"])
			_table(register_body,"Empty return trains",["ID","Supplier engine","Deliveries","Cars","Phase","Waiting / status"])
			collection_ui.build_register(self)
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
		"Process": ProcessUI.refresh_register(self)
		"Electrical": electrical_ui.refresh_register(self)
		"Railway":
			for e: Dictionary in _records("railLocations"):
				rows.append(_row(str(e.id),[e.id,e.get("name",""),e.get("kind",""),e.get("trackId",""),e.get("offset",0),e.get("length",0),"Designated"]))
			_set_table(0,rows); rows=[]
			for e: Dictionary in _records("rails"):
				rows.append(_row(str(e.id),[e.id,e.get("item","rail"),_position(e),e.get("length",5),e.get("selectedRoute","straight"),e.get("track",{}).get("groupId","")]))
			_set_table(1,rows); rows=[]
			for e: Dictionary in metadata.get("render",{}).get("railOpenEndpoints",[]):
				rows.append(_row(str(e.get("id","")),[e.get("id",""),e.get("panelId",e.get("trackId","")),e.get("route","straight"),_position(e),e.get("occupiedBy","")],[],{"0":str(e.get("id",""))}))
			_set_table(2,rows); rows=[]
			for e: Dictionary in _buffer_records():
				rows.append(_row(str(e.id),[e.id,_position(e),"Yes" if e.get("secured",false) else "No","Yes" if e.get("carried",false) else "No",e.get("source","")]))
			_set_table(3,rows); rows=[]
			for car: Dictionary in _freight_cars():
				rows.append(_row(str(car.id),[car.id,car.orderId,_reception_name(car.get("receptionLocationId","")),_mass(float(car.get("mass",0))),_mass(_car_remaining_mass(car)),car.get("storageZoneId","Not selected"),car.get("status","")],[],{"0":str(car.id),"1":str(car.orderId),"2":str(car.get("receptionLocationId","")),"5":str(car.get("storageZoneId",""))}))
			_set_table(4,rows); rows=[]
			for shunter: Dictionary in _records("shunters"):
				rows.append(_row(str(shunter.id),[shunter.id,shunter.get("name","Diesel shunter"),shunter.get("driverId","Unassigned"),_position(shunter),"%.1f / %s"%[float(shunter.get("fuel",0)),shunter.get("tank",0)],shunter.get("status",""),shunter.get("blockedBy",shunter.get("orderId",""))]))
			_set_table(5,rows); rows=[]
			if is_instance_valid(buffer_summary_label):buffer_summary_label.text=_buffer_summary()+" Select installed track to review panel or assembly recovery. Plans remain in Work until built."
			for stock: Dictionary in _records("stacks"):
				if stock.get("item")=="bufferStop" and int(stock.get("qty",0))>0:rows.append(_row(str(stock.id),[stock.id,"Stored · %s reserved"%stock.get("reserved",0),stock.get("qty",0),_position(stock),stock.get("source","")]))
			for order: Dictionary in _records("orders"):
				var quantity: int = 0
				for manifest: Dictionary in order.get("manifest",[{"item":order.get("item",""),"qty":order.get("qty",0),"arrived":order.get("arrived",0)}]):
					if manifest.get("item")=="bufferStop":quantity+=int(manifest.get("qty",0))-int(manifest.get("arrived",0))
				if quantity>0:rows.append(_row(str(order.id),[order.id,order.get("status","Ordered"),quantity,order.get("railFreight",{}).get("storageZoneId","Receiving · storage assigned on unloading"),order.get("mode","")]))
			_set_table(6,rows);rows=[]
			for work: Dictionary in _records("jobs"):
				if work.get("item")=="bufferStop" or work.get("kind")=="bufferStop":
					rows.append(_row(str(work.id),[work.id,"Recover" if work.get("kind")=="remove" else "Install",work.get("status",""),work.get("target",_position(work.get("bufferTarget",work))),work.get("worker",""),work.get("equipment",""),work.get("reason",work.get("phase",""))]))
			_set_table(7,rows);rows=[]
			for reservation: Dictionary in metadata.get("railReservations",[]):
				rows.append(_row(str(reservation.owner),[reservation.owner,reservation.get("phase",""),", ".join(reservation.get("tracks",[])),"%.1f / %.1f"%[float(reservation.get("distance",0)),float(reservation.get("end",0))],", ".join(reservation.get("carIds",[])),reservation.get("blockedBy","")]))
			_set_table(8,rows)
		"Materials":
			for value: Dictionary in metadata.get("inventory",[]):
				var key: String = str(value.get("item",""))
				rows.append(_row(key,[_name(key),value.get("delivered",0),value.get("incoming",0),value.get("stored",0),value.get("reserved",0),value.get("cargo",0),value.get("outbound",0),value.get("installed",0),value.get("inConstruction",0),value.get("collected",0),_mass(_stored_mass(key))]))
			_set_table(0,rows); rows=[]
			for e: Dictionary in _records("stacks"):
				var contents: String="—"
				if e.get("item")=="diesel":contents="%.1f L"%float(e.get("liters",0))
				elif e.get("item")=="cableReel":contents="%.1f m · %.1f reserved"%[float(e.get("cableMeters",50)),float(e.get("cableReservedMeters",0))]
				rows.append(_row(str(e.id),[e.id,_name(str(e.get("item",""))),e.get("qty",0),e.get("reserved",0),"%s × %s m"%[e.get("w",1),e.get("d",1)],_position(e),e.get("source",""),contents]))
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
			rows=[]
			for e: Dictionary in _records("retiredEquipment"):
				rows.append(_row(str(e.id),[e.id,_name(str(e.get("kind",""))),e.get("collectionId",""),"%.1f"%float(e.get("fuel",0)),"%.1f"%float(e.get("used",0))]))
			_set_table(2,rows)
		"Deliveries":
			for e: Dictionary in _records("orders").duplicate():
				if e.has("collectionId"):continue
				if not _status_matches(str(e.get("status",""))): continue
				var manifest: Array = e.get("manifest",[{"item":e.get("item",""),"qty":e.get("qty",0)}])
				var names: PackedStringArray = []
				var mass: float = 0
				for line: Dictionary in manifest:
					names.append("%s × %s"%[line.get("qty",0),_name(str(line.get("item","")))])
					mass+=float(line.get("qty",0))*float(catalog.get(line.get("item",""),{}).get("mass",0))
				rows.push_front(_row(str(e.id),[e.id,"; ".join(names),e.get("qty",0),e.get("arrived",0),_mass(mass),e.get("mode",""),_clock(e.get("eta",0)),e.get("status",""),e.get("note",""),_money(e.get("total",0))]))
			_set_table(0,rows);rows=[]
			for train: Dictionary in _records("railReturns"):
				if not _status_matches(str(train.get("phase",""))):continue
				rows.append(_row(str(train.id),[train.id,train.get("locomotiveId",""),", ".join(train.get("orderIds",[])),", ".join(train.get("carIds",[])),train.get("phase",""),train.get("status",train.get("blockedBy",""))]))
			_set_table(1,rows)
			collection_ui.refresh_register(self,2)
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
				var severity: String = _notice_severity(e)
				if is_instance_valid(severity_filter) and ((severity_filter.selected==1 and severity!="warning") or (severity_filter.selected==2 and severity!="info")):continue
				if not _status_matches(str(e.get("state","todo"))): continue
				rows.append(_row(str(e.id),[e.id,_clock(e.get("time",0)),e.get("state","todo"),e.get("title",""),e.get("detail",""),e.get("entity",""),"Yes" if e.get("seen",false) else "New"]))
			_set_table(0,rows)

func _job_row(task: Dictionary,prefix: String) -> Dictionary:
	return _row(str(task.id),[task.id,prefix+_name(str(task.get("kind",""))),task.get("status",""),"%d%%"%roundi(float(task.get("progress",0))*100),task.get("worker",""),task.get("operator",""),task.get("equipment",""),task.get("preferredEquipment",""),task.get("reason",task.get("phase",""))])

func _stored_mass(item: String) -> float:
	var total: float=0.0
	for stack: Dictionary in _records("stacks"):
		if str(stack.get("item",""))!=item:continue
		total+=20.0*float(stack.get("qty",0))+.825*float(stack.get("liters",0)) if item=="diesel" else float(stack.get("qty",0))*float(catalog.get(item,{}).get("mass",0))
	return total

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
	# Missing optional reference IDs are empty too; they are not a selection.
	if id.is_empty(): return {}
	for key: String in ["workers","equipment","shunters","stacks","buildings","rails","zones","jobs","jobGroups","orders","railLocations","railReturns","railServiceCrew","railPossessions","notices","events","costs","movements","collections","retiredEquipment"]:
		for entity: Dictionary in _records(key):
			if str(entity.get("id",""))==id: return {"type":key,"entity":entity}
	for holder: Dictionary in _records("shunters")+_records("railReturns")+_records("railServiceCrew"):
		for field: String in ["coupling","handover","task"]:
			if str(holder.get(field,{}).get("id",""))==id:return {"type":"railGroundTask","entity":holder[field]}
	for holder: Dictionary in _records("orders"):
		if str(holder.get("railFreight",{}).get("coupling",{}).get("id",""))==id:return {"type":"railGroundTask","entity":holder.railFreight.coupling}
	for car: Dictionary in _freight_cars():
		if str(car.id)==id:return {"type":"freightCars","entity":car}
	for train: Dictionary in _records("railReturns"):
		if str(train.get("locomotiveId",""))==id:
			return {"type":"returnLocomotive","entity":{"id":id,"name":"Empty collection locomotive","returnId":train.id,"status":train.get("status",""),"x":train.get("x",0),"z":train.get("z",0)}}
	for order: Dictionary in _records("orders"):
		if str(order.get("railFreight",{}).get("locomotiveId",""))==id:
			return {"type":"supplierLocomotive","entity":{"id":id,"name":"Supplier locomotive","orderId":str(order.id),"status":order.get("status",""),"x":order.get("vehicle",{}).get("x",0),"z":order.get("vehicle",{}).get("z",0)}}
	for buffer: Dictionary in _buffer_records():
		if str(buffer.id)==id:return {"type":"buffer","entity":buffer}
	for endpoint: Dictionary in metadata.get("render",{}).get("railOpenEndpoints",[]):
		if str(endpoint.get("id",""))==id:return {"type":"railEndpoint","entity":endpoint}
	for operation: Dictionary in ProcessUI.records(self,"operations"):
		if str(operation.get("id",""))==id:return {"type":"processOperation","entity":operation}
	for run: Dictionary in ElectricalUI.records(self,"runs"):
		if str(run.get("id",""))==id:return {"type":"electricalRun","entity":run}
	for movement: Dictionary in ElectricalUI.records(self,"meterLedger"):
		if str(movement.get("id",""))==id:return {"type":"electricalCableMovement","entity":movement}
	var historical: Dictionary={}
	var collections: Array[String]=[]
	var collected: int=0
	var loaded: int=0
	for collection: Dictionary in _records("collections"):
		for line: Dictionary in collection.get("lines",[]):
			if str(line.get("stackId",""))==id:
				if historical.is_empty():historical=line.get("sourceSnapshot",{}).duplicate(true)
				historical.merge({"id":id,"item":line.get("item","")},true)
				collections.append(str(collection.id));collected+=int(line.get("collected",0));loaded+=int(line.get("loaded",0))
	if not collections.is_empty():
		historical.merge({"collectionIds":collections,"collected":collected,"loaded":loaded},true)
		return {"type":"collectedStock","entity":historical}
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
	pattern.compile("[A-Z]{1,16}-[0-9]{3,}(?:/BAY)?")
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

func _entity_option(parent: Node,key: String,empty_text: String,current: String = "",operators_only: bool = false,rail_only: bool = false) -> OptionButton:
	var option: OptionButton = OptionButton.new()
	option.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	option.add_item(empty_text)
	option.set_item_metadata(0,"")
	for entry: Dictionary in _records(key):
		if operators_only and entry.get("role")!="operator": continue
		if rail_only and entry.get("role")!="railDriver" and not bool(entry.get("railQualified",false)):continue
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
	if active_tab=="Help":
		inspector.hide(); register_panel.offset_right=0
		return
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
	if kind not in ["retiredEquipment","collectedStock"]:
		_button(heading,"Locate",func() -> void: _switch_tab("Yard"); focus_entity.emit(selected_id))
	_button(heading,"×",func() -> void: selected_id=""; entity_selected.emit(""); _render_inspector())
	var display_name: String = str(entity.get("name",entity.get("label",_name(str(entity.get("kind",entity.get("item",kind)))))))
	if kind=="buildings" and str(entity.get("kind","")) in ProcessUI.KINDS:display_name=display_name.trim_suffix(" kit")
	_note(inspector_body,display_name)
	if entity.has("x"): _detail("Last site position" if kind in ["retiredEquipment","collectedStock"] else "Position",_position(entity))
	_clearance_controls(str(entity.get("id","")))
	match kind:
		"electricalRun": ElectricalUI.run_inspector(self,entity)
		"electricalCableMovement":
			for pair: Array in [["Time","time"],["Circuit","runId"],["From","from"],["To","to"],["Meters","meters"],["Reason","reason"]]:_detail(pair[0],_clock(entity.get("time",0)) if pair[1]=="time" else entity.get(pair[1],"—"))
			_reference_controls(inspector_body,[entity.get("runId",""),str(entity.get("from","")).get_slice("/",0),str(entity.get("to","")).get_slice("/",0)])
		"workers": _worker_inspector(entity)
		"equipment": _equipment_inspector(entity)
		"collections":collection_ui.inspector(self,entity)
		"retiredEquipment":
			_detail("State","Collected off site")
			_detail("Collection",entity.get("collectionId",""))
			_detail("Remaining sealed tank fuel","%.1f L"%float(entity.get("fuel",0)))
			_detail("Lifetime diesel used","%.1f L"%float(entity.get("used",0)))
			_note(inspector_body,"This equipment's original ID and service history remain available after collection. It cannot be assigned to work.")
		"collectedStock":
			_detail("State","No longer in site storage")
			_detail("Material",_name(str(entity.get("item",""))))
			_detail("Collections"," · ".join(entity.get("collectionIds",[])))
			_detail("Secured on carrier",entity.get("loaded",0))
			_detail("Collected off site",entity.get("collected",0))
			_note(inspector_body,"This is the original stock record retained for collection history. The collection ledger shows what is still on its carrier and what has left the site.")
		"jobs","jobGroups": _work_inspector(entity,kind=="jobGroups")
		"orders": _order_inspector(entity)
		"freightCars": _freight_car_inspector(entity)
		"shunters": _shunter_inspector(entity)
		"processOperation":
			for pair: Array in [["Kind","kind"],["Asset","assetId"],["Car","carId"],["Worker","workerId"],["Phase","phase"],["Status","status"]]:_detail(pair[0],entity.get(pair[1],""))
		"railGroundTask":
			_coupling_details(entity)
			_detail("Operation owner",entity.get("ownerId",""))
		"railPossessions":
			_detail("Work boundary", "E%s–E%s, S%s"%[entity.get("from",0),entity.get("to",0),entity.get("z",0)])
			_detail("State","Released" if entity.get("released",false) else "Closed for physical work")
			_detail("Original steel",", ".join(entity.get("assetIds",[])))
			if not entity.get("released",false):_button(inspector_body,"Reopen completed rail section",func() -> void:_send("rail_possession_release",{"id":str(entity.id)}))
		"railServiceCrew":
			_detail("Employer","Supplier railway service")
			_detail("Locomotive",entity.get("locomotiveId",""))
			_detail("Operation",entity.get("ownerId",""))
			_detail("State",entity.get("status",""))
			_coupling_details(entity.get("task",{}))
		"railReturns":
			_detail("Phase",entity.get("phase",""))
			_detail("Supplier engine",entity.get("locomotiveId",""))
			_coupling_details(entity.get("coupling",{}))
			_detail("Pickup waiting","%.1f min · %s"%[float(entity.get("waitingSeconds",0))/60,_money(entity.get("waitingCost",0))])
			_detail("Deliveries",", ".join(entity.get("orderIds",[])))
			_detail("Cars",", ".join(entity.get("carIds",[])))
			_detail("State",entity.get("status",entity.get("blockedBy","")))
			_note(inspector_body,"The supplier engine approaches, couples to these empty cars, and departs onto the main line. Keep the receiving siding and its exit clear.")
		"returnLocomotive":
			_detail("Return train",entity.get("returnId",""))
			_detail("State",entity.get("status",""))
			_button(inspector_body,"Open empty return train",func() -> void: _user_entity(str(entity.get("returnId",""))))
		"supplierLocomotive":
			_detail("Train / order",entity.get("orderId",""))
			_detail("State",entity.get("status",""))
			_detail("Ownership","Supplier")
			_note(inspector_body,"Release the supplier engine from its delivery controls after reception. It needs a clear siding exit to leave while the cars stay behind. Request an engine again when the empty cars are assembled for collection.")
			_button(inspector_body,"Open train delivery controls",func() -> void: _user_entity(str(entity.get("orderId",""))))
		"stacks":
			_detail("Material",_name(str(entity.get("item",""))))
			var stock_item: String = str(entity.get("item",""))
			var stock_quantity: int = int(entity.get("qty",0))
			if stock_item.begins_with("rail"):
				_detail("Quantity","%d / %d per stack"%[stock_quantity,int(catalog.get(stock_item,{}).get("max",8))])
				_detail("Stack height","%.2f m"%(0.325+maxi(0,stock_quantity-1)*0.36 if stock_quantity>0 else 0.0))
			else:
				_detail("Quantity",stock_quantity)
			_detail("Reserved",entity.get("reserved",0))
			_detail("Footprint","%s × %s m"%[entity.get("w",1),entity.get("d",1)])
			_detail("Mass",_mass(20.0*stock_quantity+.825*float(entity.get("liters",0)) if stock_item=="diesel" else 35.0*stock_quantity+3.0*float(entity.get("cableMeters",50)) if stock_item=="cableReel" else stock_quantity*float(catalog.get(stock_item,{}).get("mass",0))))
			_detail("Source",entity.get("source",""))
			if entity.get("item")=="diesel": _detail("Contents","%.1f / 200 L"%float(entity.get("liters",0)))
			if entity.get("item")=="cableReel":
				_detail("Cable remaining","%.1f / 50 m"%float(entity.get("cableMeters",50)))
				_detail("Reserved cable","%.1f m"%float(entity.get("cableReservedMeters",0)))
				_detail("Reserved recovery capacity","%.1f m"%float(entity.get("cableReservedSpaceMeters",0)))
				_note(inspector_body,"Cable is consumed by the meter; the physical wooden reel stays on site when empty. Electrical's cable meter ledger links every withdrawal and buried segment.")
			_button(inspector_body,"Move to storage…",func()->void:storage_move_ui.open(self,str(entity.id)))
			_button(inspector_body,"Collect unwanted units…",func()->void:collection_ui.open(self,str(entity.id)))
			if str(entity.get("item","")).begins_with("rail"):
				_button(inspector_body,"Relocate one exposed rail panel",func() -> void: _select_tool("relocate"))
				_note(inspector_body,"Click clear space in a stockyard. An owned machine and crew physically move an unreserved panel.")
		"buildings":
			electrical_ui.asset_inspector(self,entity)
			if str(entity.get("kind","")) in ProcessUI.KINDS:
				ProcessUI.inspector(self,entity)
				_button(inspector_body,"Recover / remove building",func() -> void: _send("remove_building",{"id":selected_id}))
				return
			_detail("Footprint","%s × %s m"%[entity.get("w",1),entity.get("d",1)])
			if str(entity.get("kind","")) not in ["lamp","power","electricalJunction"]:_detail("Utilities","Connected" if entity.get("connected",false) else "Connection required")
			_detail("Source",entity.get("source",""))
			if entity.get("kind")=="engineShed":
				_detail("Rail parking bay",entity.get("parkingLocationId",""))
				_detail("Structural components",entity.get("componentIds",[]).size())
				var shed_engine: OptionButton = _entity_option(inspector_body,"shunters","Choose owned locomotive…")
				_button(inspector_body,"Assign shed and park locomotive",func() -> void:_send("engine_shed_park",{"buildingId":str(entity.id),"shunterId":_selection(shed_engine)}))
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
			if str(entity.get("track",{}).get("flow",""))=="converging":_detail("Turnout flow","Converging · two incoming tracks join one")
			_button(inspector_body,"Install buffer at open endpoint",func() -> void: _buffer_endpoint_form(selected_id))
			_button(inspector_body,"Designate named rail location",func() -> void: _rail_location_form(entity))
			_rail_recovery_controls(entity)
		"railLocations":
			_detail("Track",entity.get("trackId",""))
			_detail("Purpose",entity.get("kind",""))
			_detail("Length","%s m"%entity.get("length",0))
			_note(inspector_body,"Supplier receiving point and shunting destination" if entity.get("trackId")=="BOOTSTRAP-SIDING" else "Shunting destination · connected track and sufficient clear length are required.")
			_button(inspector_body,"Edit named location",func() -> void: _rail_location_form(entity))
		"notices":
			_detail("Severity",_notice_severity(entity))
			_detail("Time",_clock(entity.get("time",0)))
			_detail("Entity",entity.get("entity",""))
			_note(inspector_body,str(entity.get("detail","")))
			_notice_reference_controls(entity)
			var stage: OptionButton = _option(inspector_body,["To do","Doing","Done"],["todo","doing","done"].find(entity.get("state","todo")))
			_button(inspector_body,"Update notice",func() -> void: _send("notice",{"id":selected_id,"state":["todo","doing","done"][stage.selected],"seen":true}))
		"buffer":
			_detail("Secured","Yes" if entity.get("secured",false) else "No")
			_detail("Carried","Yes" if entity.get("carried",false) else "No")
			_detail("Source",entity.get("source",""))
			_note(inspector_body,"A crew unfastens the stop, then owned equipment carries it to physical storage. Rail work also relocates its affected endpoint stop.")
			var remove: Button = _button(inspector_body,"Review buffer recovery…",func() -> void: _rail_edit_review({"operation":"recover_buffer","id":selected_id}))
			remove.disabled=bool(entity.get("carried",false))
		"railEndpoint":
			_detail("Track",entity.get("panelId",entity.get("trackId","")))
			_detail("Route",entity.get("route","straight"))
			_detail("Buffer / work",entity.get("occupiedBy",""))
			var install: Button = _button(inspector_body,"Review buffer installation…",func() -> void: _rail_edit_review({"operation":"install_buffer","x":float(entity.x),"z":float(entity.z)}))
			install.disabled=not str(entity.get("occupiedBy","")).is_empty()
			_note(inspector_body,_buffer_summary())
			_button(inspector_body,"Purchase buffer stops…",func() -> void: _purchase_buffer_form())
			_note(inspector_body,"The review checks the real open endpoint. Normal work needs a delivered stop, lifting machine, operator and ground worker. Creative installs immediately.")
		_:
			for key: String in entity:
				if key!="id": _detail(key,entity[key])

	inspector_scroll.set_deferred("scroll_vertical",previous_scroll)

func _rail_recovery_controls(rail: Dictionary) -> void:
	var rail_id: String = str(rail.get("id",""))
	if rail_id.begins_with("BOOTSTRAP-"):
		_note(inspector_body,"The original main line and receiving siding are protected infrastructure and cannot be recovered.")
		return
	var track: Dictionary = rail.get("track",{})
	var group_id: String = str(track.get("groupId",""))
	var members: int = 0
	var assembly_pending: bool = false
	if not group_id.is_empty():
		for installed: Dictionary in _records("rails"):
			if str(installed.get("track",{}).get("groupId",""))==group_id:
				members+=1
				if not _pending_rail_recovery(str(installed.id)).is_empty():assembly_pending=true
	_detail("Selection","One installed panel · %s"%_name(str(rail.get("item","rail"))))
	if members>1:_detail("Assembly","%d installed panels · %s"%[members,group_id])
	var pending: Dictionary = _pending_rail_recovery(rail_id)
	if not pending.is_empty():
		_detail("Recovery work",pending.id)
		_detail("Recovery state",pending.get("reason","") if not str(pending.get("reason","")).is_empty() else pending.get("phase",pending.get("status","")))
		var recovery_id: String = str(pending.id)
		_button(inspector_body,"Open recovery work",func() -> void: _user_entity(recovery_id))
	var recover: Button = _button(inspector_body,"Review this panel recovery…",func() -> void: _rail_edit_review({"operation":"recover_rail","id":rail_id,"scope":"panel"}))
	recover.disabled=not pending.is_empty()
	if members>1:
		var assembly: String = "turnout" if str(track.get("layout",""))=="turnout" else "curve" if str(track.get("layout",""))=="curve" else "assembly"
		var recover_assembly: Button = _button(inspector_body,"Review whole %s (%d panels)…"%[assembly,members],func() -> void: _rail_edit_review({"operation":"recover_rail","id":rail_id,"scope":"assembly"}))
		recover_assembly.disabled=assembly_pending
	_note(inspector_body,"Recovery is a work order: a worker unfastens each panel, then equipment lifts and carries it to physical stockyard storage. Attached buffer stops are recovered first. Track must be clear of trains and active construction. In Creative, recovery is immediate.")

func _pending_rail_recovery(rail_id: String) -> Dictionary:
	for work: Dictionary in _records("jobs"):
		if str(work.get("status","")) in ["todo","doing"] and str(work.get("railRecovery",{}).get("railId",""))==rail_id:return work
	return {}

func _worker_inspector(worker: Dictionary) -> void:
	var id: String = str(worker.id)
	for pair: Array in [["Role","role"],["Duty","duty"],["Current action","status"],["Shift action","shiftPhase"],["Vehicle","vehicle"],["Work","job"],["Delivery","deliveryOrder"],["Support machine","assistingEquipment"],["Clearance equipment","actionClearanceEquipment"]]: _detail(pair[0],worker.get(pair[1],"—"))
	_detail("Hours","%.1f h"%float(worker.get("hours",0)))
	_detail("Hourly wage",_money(worker.get("wage",0)))
	_detail("Railway qualification","Qualified" if worker.get("role")=="railDriver" or worker.get("railQualified",false) else "Not recorded")
	_detail("Rail assignment",worker.get("railAssignment",""))
	_detail("Process operation",worker.get("processAssignment",""))
	if worker.get("role")=="operator" and not worker.get("railQualified",false):
		_button(inspector_body,"Verify railway license · $180",func() -> void:_send("rail_qualification",{"workerId":id}))
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
	elif not electrical_pick_hint.is_empty():
		tool_label.text="Pick electrical object · Esc returns"
		tool_label.tooltip_text=electrical_pick_hint
		status_label.text=electrical_pick_hint;status_label.tooltip_text=electrical_pick_hint
	elif active_tool=="cable":
		tool_label.text="Cable · R swaps elbow · Esc cancels"
		tool_label.tooltip_text=electrical_tool_hint
		status_label.text=electrical_tool_hint
		status_label.tooltip_text=electrical_tool_hint
	else:
		var tool_name: String = (rail_tool_buttons[active_tool] as Button).text if rail_tool_buttons.has(active_tool) else active_tool
		tool_label.text="Select · 1 m grid" if active_tool=="select" else "%s · click / drag the yard"%tool_name
		tool_label.tooltip_text="Construction ghosts: cyan queued, amber underway. Placement preview: green valid, red invalid."
		if not electrical_tool_hint.is_empty() and status_label.text==electrical_tool_hint:
			status_label.text="Ready · click an asset to inspect it or drag empty ground to move the view."
			status_label.tooltip_text=""

func set_electrical_pick_hint(text: String) -> void:
	var old: String=electrical_pick_hint
	electrical_pick_hint=text
	if is_instance_valid(electrical_pick_cancel):electrical_pick_cancel.visible=not text.is_empty()
	if text.is_empty() and is_instance_valid(status_label) and status_label.text==old:status_label.text="Ready · select an asset or drag to pan."
	_update_control_banner()

func set_electrical_hint(text: String) -> void:
	electrical_tool_hint=text
	if active_tool=="cable":_update_control_banner()

func _clearance_records(id: String) -> Array[Dictionary]:
	var related: Dictionary={id:true}
	var found: Dictionary=_entity(id)
	var entity: Dictionary=found.get("entity",{})
	for field: String in ["job","deliveryOrder","parkingEquipment","railAssignment","processAssignment","actionClearanceEquipment","actionYieldFor"]:
		var linked: String=str(entity.get(field,""))
		if not linked.is_empty():related[linked]=true
	if str(found.get("type",""))=="jobGroups":
		for task: Dictionary in _work_tasks(id):related[str(task.id)]=true
	var result: Array[Dictionary]=[]
	for wait: Dictionary in state.get("actionClearances",[]):
		var linked_blocker: bool=false
		for blocker: String in wait.get("blockerIds",[]):
			if related.has(blocker):linked_blocker=true
		if related.has(str(wait.get("ownerId",""))) or related.has(str(wait.get("requesterEquipmentId",""))) or linked_blocker:
			result.append(wait)
			if result.size()>=32:break
	return result

func _clearance_control_reason(id: String) -> String:
	var found: Dictionary=_entity(id)
	var entity: Dictionary=found.get("entity",{})
	if str(found.get("type",""))=="workers" and str(entity.get("duty","auto"))!="auto":
		return "%s is under %s control; automatic clearance will not move this worker. Move them clear or return them to automatic duty."%[id,entity.get("duty","manual")]
	if str(found.get("type",""))=="equipment":
		var operator_worker: Dictionary=_seated_operator(entity)
		if not operator_worker.is_empty() and str(operator_worker.get("duty","auto"))!="auto":
			return "%s has a %s operator; automatic clearance will not drive it. Move it safely or return the operator to automatic work."%[id,operator_worker.get("duty","manual")]
	return ""

func _reference_controls(parent: Node,ids: Array) -> void:
	var displayed: int=0
	var seen: Dictionary={}
	for value: Variant in ids:
		var id: String=str(value)
		if id.is_empty() or seen.has(id) or _entity(id).is_empty():continue
		seen[id]=true
		var row: HBoxContainer=HBoxContainer.new();parent.add_child(row)
		_button(row,"Inspect "+id,func() -> void:_user_entity(id))
		_button(row,"Locate "+id,func() -> void:_switch_tab("Yard");focus_entity.emit(id))
		var reason: String=_clearance_control_reason(id)
		if not reason.is_empty():_note(parent,reason)
		displayed+=1
		if displayed>=6:break

func _clearance_controls(id: String) -> void:
	var waits: Array[Dictionary]=_clearance_records(id)
	if waits.is_empty():return
	_label(inspector_body,"Active clearance · %d action(s)"%waits.size())
	var references: Array=[]
	for index: int in mini(waits.size(),3):
		var wait: Dictionary=waits[index]
		_detail("Blocked action",wait.get("action",""))
		if not str(wait.get("reason","")).is_empty():_detail("Clearance condition",wait.reason)
		if wait.has("point"):_detail("Working area",_position(wait.point))
		_detail("Action owner",wait.get("ownerId",""))
		_detail("Requester",wait.get("requesterEquipmentId",""))
		_detail("Waiting for"," · ".join(wait.get("blockerIds",[])))
		_detail("Blocked for","%.1f seconds"%maxf(0,float(state.get("elapsed",0))-float(wait.get("since",0))))
		references.append(wait.get("ownerId",""));references.append(wait.get("requesterEquipmentId",""));references.append_array(wait.get("blockerIds",[]))
	_reference_controls(inspector_body,references)

func _notice_severity(value: Dictionary) -> String:
	if value.get("severity","") in ["warning","info"]:return str(value.severity)
	for wait: Dictionary in state.get("actionClearances",[]):
		if str(wait.get("noticeId",""))==str(value.get("id","")):return "warning"
	# Earlier local saves did not store severity on notices.
	var title: String=str(value.get("title","")).to_lower()
	return "warning" if title.contains("blocked") or title.contains("deadlock") else "info"

func _notice_references(value: Dictionary) -> Array:
	var ids: Array=[value.get("entity","")]
	for wait: Dictionary in state.get("actionClearances",[]):
		if str(wait.get("noticeId",""))==str(value.get("id","")):
			ids.append(wait.get("ownerId",""));ids.append(wait.get("requesterEquipmentId",""));ids.append_array(wait.get("blockerIds",[]))
	# Resolved records leave the warning history and its original linked IDs intact.
	var pattern: RegEx=RegEx.new();pattern.compile("[A-Z]{1,16}-[0-9]{3,}(?:/BAY)?")
	for hit: RegExMatch in pattern.search_all(str(value.get("detail",""))):
		ids.append(hit.get_string())
		if ids.size()>=16:break
	return ids

func _notice_reference_controls(value: Dictionary) -> void:
	_reference_controls(inspector_body,_notice_references(value))

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
	for pair: Array in [["Operator","operator"],["Work","job"],["Delivery","deliveryOrder"],["Refueling","refueling"],["Clearance operator","actionYieldOperator"],["Blocker","blockedBy"]]: _detail(pair[0],equipment.get(pair[1],"—"))
	var intent: Dictionary = {}
	for value: Dictionary in metadata.get("render",{}).get("equipmentIntents",[]):
		if str(value.get("id",""))==id: intent=value
	_detail("Current step",intent.get("phase",equipment.get("parkingState","Available")))
	_detail("Condition",intent.get("detail",""))
	if intent.has("target"): _detail("Destination",str(intent.get("targetLabel",""))+" · "+_position(intent.target))
	if intent.has("references"): _detail("References"," · ".join(intent.references))
	_detail("Cargo","%s × %s"%[equipment.cargo.get("qty",0),_name(str(equipment.cargo.get("item","")))] if equipment.has("cargo") else "Empty")
	for fuel_job: Dictionary in _records("jobs"):
		if str(fuel_job.get("id",""))==str(equipment.get("refueling","")):
			_fuel_details(fuel_job)
	_label(inspector_body,"Automatic work")
	var roles: MenuButton = MenuButton.new()
	roles.text="▾ Select allowed job kinds"
	var popup: PopupMenu = roles.get_popup()
	popup.theme=screen.theme
	popup.hide_on_checkable_item_selection=false
	var activities: Array = equipment.get("allowedWork",ACTIVITIES if equipment.get("workRole","all")=="all" else ([] if equipment.get("workRole")=="hold" else [equipment.get("workRole")]))
	for i: int in range(ACTIVITIES.size()):
		popup.add_check_item("Recovery / relocation" if ACTIVITIES[i]=="recovery" else ACTIVITIES[i].capitalize(),i)
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
	_button(inspector_body,"Retire / collect equipment…",func()->void:collection_ui.open(self,"",id))
	_note(inspector_body,"A free, fueled machine travels to its diesel drum with an operator. Loaded or dry equipment receives an emergency can delivery. A pending request waits for manual control to be released or the current job to become safe.")
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

func _fuel_details(work: Dictionary) -> void:
	var service: Dictionary=work.get("fuelWork",{})
	if service.is_empty(): return
	_label(inspector_body,"Fuel service")
	_detail("Service mode","Emergency can delivery" if service.get("mode")=="emergency" else "Drive to diesel drum")
	_detail("Diesel drum",service.get("barrelId",work.get("stack","—")))
	if service.has("station"):_detail("Service position",_position(service.station))
	if service.has("emergencyReason"):_detail("Emergency reason",service.emergencyReason)
	_detail("Can contents","%.1f / 20 L"%float(work.get("fuelLiters",0)))
	_detail("Delivered to tank","%.1f L"%float(service.get("delivered",0)))
	_reference_controls(inspector_body,[service.get("barrelId",""),work.get("worker",""),work.get("operator","")])

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
		if work.get("stockMove",{}).get("toStorage",false):
			var move: Dictionary=work.stockMove
			_detail("Move source",move.get("sourceId","—"))
			_detail("Destination stockyard",move.get("zoneId","Automatic choice"))
			_detail("Storage placement","%s · %s × %s m"%[_position(move.get("destination",{})),move.get("destination",{}).get("w",1),move.get("destination",{}).get("d",1)])
			if move.has("mergeId"):_detail("Stack to join",move.mergeId)
			if move.has("afterJobId"):_detail("After previous lift",move.afterJobId)
			var load: Dictionary=move.get("load",{})
			if load.get("item")=="cableReel":_detail("Cable in carried reel","%.1f m"%float(load.get("cableMeters",50)))
			if load.get("item")=="diesel":_detail("Diesel in carried drum","%.1f L"%float(load.get("liters",0)))
		if str(work.get("kind",""))=="refuel":_fuel_details(work)
		if work.has("electricalRunId"):
			_detail("Electrical circuit",work.electricalRunId)
			_reference_controls(inspector_body,[work.electricalRunId])
		if work.has("shedAssembly"):
			var assembly: Dictionary = work.shedAssembly
			_detail("Assembly",assembly.get("phase",""))
			_detail("Installed parts","%s anchors · %s posts · %s beams · %s roof sheets"%[assembly.get("anchors",0),assembly.get("posts",0),assembly.get("beams",0),assembly.get("roofSheets",0)])
		if work.has("railRecovery"):
			var recovery: Dictionary = work.railRecovery
			_detail("Recovering rail",recovery.get("railId",""))
			_detail("Recovered material",_name(str(recovery.get("recoveredItem","rail"))))
			_detail("Attached buffers"," · ".join(recovery.get("buffers",[])))
			_note(inspector_body,"The crew unfastens this installed panel and equipment carries it to stockyard storage. Its rail remains in place until it is lifted.")
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
	if order.has("collectionId"):
		_detail("Outbound collection",order.collectionId)
		_button(inspector_body,"Open collection controls",func()->void:_user_entity(str(order.collectionId)))
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
	if order.has("railFreight"):_rail_freight_controls(order)
	var worker: OptionButton = _entity_option(inspector_body,"workers","Choose receiving operator…",controlled_worker,true)
	_button(inspector_body,"Assign operator to unloading",func() -> void:
		if not _selection(worker).is_empty(): _send("unload",{"orderId":id,"workerId":_selection(worker)}))


func _freight_cars() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for order: Dictionary in _records("orders"):
		var freight: Dictionary = order.get("railFreight",{})
		for value: Dictionary in freight.get("cars",[]):
			if value.get("returned",false):continue
			var car: Dictionary = value.duplicate(true)
			car["orderId"]=str(order.id)
			for pose: Dictionary in metadata.get("render",{}).get("railCars",[]):
				if str(pose.get("id",""))==str(car.id):
					for axis: String in ["x","z","y","yaw"]:
						if pose.has(axis):car[axis]=pose[axis]
			car["status"]=str(order.get("status",""))
			car["receptionLocationId"]=str(car.get("locationId",freight.get("receptionLocationId","")))
			car["storageZoneId"]=str(freight.get("storageZoneId",""))
			result.append(car)
	return result

func _car_remaining_mass(car: Dictionary) -> float:
	var total: float = 0
	for line: Dictionary in car.get("manifest",[]):
		total+=maxf(0,float(line.get("qty",0))-float(line.get("arrived",0)))*(0.84 if line.get("item")=="bulkDiesel" else 1.0 if line.get("item")=="bulkWater" else float(catalog.get(line.get("item",""),{}).get("mass",0)))
	return total

func _reception_name(id: Variant) -> String:
	for location: Dictionary in _records("railLocations"):
		if str(location.id)==str(id):return str(location.get("name",location.id))
	return "Automatic · receiving siding" if str(id).is_empty() else str(id)

func _reception_option(parent: Node,current: String = "") -> OptionButton:
	var option: OptionButton = _option(parent,[])
	option.add_item("Automatic · fit train on receiving siding")
	option.set_item_metadata(0,"")
	for location: Dictionary in _records("railLocations"):
		if location.get("kind","") not in ["unloading","transfer"]:continue
		option.add_item("%s · %s · %s m"%[location.get("name",location.id),location.id,location.get("length",0)])
		option.set_item_metadata(option.item_count-1,str(location.id))
		if str(location.id)==current:option.selected=option.item_count-1
	# A renamed/deleted/unavailable existing designation must stay visible;
	# opening an inspector must not silently reinterpret it as automatic.
	if not current.is_empty() and _selection(option)!=current:
		option.add_item(current+" · unavailable receiving point")
		option.set_item_metadata(option.item_count-1,current)
		option.selected=option.item_count-1
	return option

func _refresh_purchase_destinations() -> void:
	if not is_instance_valid(purchase_reception):return
	var reception: String = _selection(purchase_reception)
	var yard: String = _selection(purchase_stockyard)
	var parent: Node = purchase_rail_controls
	var reception_index: int = purchase_reception.get_index()
	var yard_index: int = purchase_stockyard.get_index()
	parent.remove_child(purchase_reception); purchase_reception.queue_free()
	parent.remove_child(purchase_stockyard); purchase_stockyard.queue_free()
	purchase_reception=_reception_option(parent,reception)
	parent.move_child(purchase_reception,reception_index)
	purchase_stockyard=_entity_option(parent,"zones","Select later · train waits until unloading is requested",yard)
	parent.move_child(purchase_stockyard,yard_index)
	purchase_reception.item_selected.connect(func(_index: int) -> void: _purchase_changed())
	purchase_stockyard.item_selected.connect(func(_index: int) -> void: _purchase_changed())
	_purchase_changed()

func _purchase_args(lines: Array[Dictionary]) -> Dictionary:
	var args: Dictionary = {"lines":lines,"mode":"road" if purchase_mode.selected==0 else "rail"}
	if purchase_mode.selected==1:
		var reception: String = _selection(purchase_reception)
		var yard: String = _selection(purchase_stockyard)
		if not reception.is_empty():args["railLocationId"]=reception
		if not yard.is_empty():args["storageZoneId"]=yard
	return args

func _rail_freight_controls(order: Dictionary) -> void:
	var freight: Dictionary = order.get("railFreight",{})
	var id: String = str(order.id)
	_label(inspector_body,"RAIL FREIGHT / "+str(freight.get("cars",[]).size())+" CARS")
	_detail("Supplier engine",freight.get("locomotiveId",""))
	_detail("Engine state",freight.get("locomotivePhase","attached"))
	if freight.has("returnId"):_detail("Return train",freight.returnId)
	_detail("Cars detached","Yes" if freight.get("detached",false) else "No")
	if freight.has("movement"):_detail("Rail movement",freight.movement.get("phase",freight.movement.get("status","Moving")))
	_detail("Receiving point",_reception_name(freight.get("receptionLocationId","")))
	_detail("Stockyard",freight.get("storageZoneId","Not selected"))
	_detail("Unloading", "Requested" if freight.get("unloadRequested",true) else "Awaiting your instruction")
	_coupling_details(freight.get("coupling",{}))
	var terminal: bool = str(order.get("status","")) in ["done","canceled","departing"]
	var locked: bool = str(order.get("status",""))!="ordered"
	var reception: OptionButton = _reception_option(inspector_body,str(freight.get("receptionLocationId","")))
	reception.disabled=terminal or locked
	reception.tooltip_text="Reception locks when the supplier train starts its approach. Move received cars to other named tracks with a shunter."
	var storage: OptionButton = _entity_option(inspector_body,"zones","Choose unloading stockyard…",str(freight.get("storageZoneId","")))
	storage.disabled=terminal
	var apply: Button = _button(inspector_body,"Apply rail freight destinations",func() -> void:
		var args: Dictionary = {"orderId":id,"railLocationId":_selection(reception),"storageZoneId":_selection(storage)}
		_send("configure_rail_freight",args))
	apply.disabled=terminal or order.has("unload")
	apply.tooltip_text="Wait for the current physical lift to finish before changing destinations."
	var checks: Array[CheckBox] = _freight_car_checkboxes(inspector_body,order)
	var start: Button = _button(inspector_body,"Start unloading",func() -> void:
		var args: Dictionary = {"orderId":id}
		var selected: Array[String] = _selected_freight_cars(order)
		if selected.size()!=freight.get("cars",[]).size():args["carIds"]=selected
		_send("begin_rail_unloading",args))
	start.disabled=str(order.get("status",""))!="unloading" or bool(freight.get("unloadRequested",true)) or str(freight.get("storageZoneId","")).is_empty()
	for car: Dictionary in freight.get("cars",[]):
		if car.get("kind")=="tanker":start.disabled=true;start.tooltip_text="Tanker liquid requires transfer equipment; it cannot be lifted into a stockyard."
	var pause_unloading: Button = _button(inspector_body,"Pause unloading after current lift",func() -> void: _send("pause_rail_unloading",{"orderId":id}))
	pause_unloading.disabled=terminal or not bool(freight.get("unloadRequested",false)) and not order.has("unload")
	pause_unloading.tooltip_text="The current lift finishes safely, then no new cargo is picked up. Pause before moving cars with your shunter."
	start.tooltip_text="Tanker liquid requires transfer equipment; it cannot be lifted into a stockyard." if order.get("item","") in ["bulkWater","bulkDiesel"] else "Wait until the train is stopped and select and apply a physical stockyard first. Owned equipment and an operator handle unloading."
	_note(inspector_body,"Apply the stockyard, select the cars, and start unloading. Finish an active lift before shunting. Supplier trains can use connected named receiving intervals that fit the complete train. The shunter transfers cars between named tracks.")
	var release: Button = _button(inspector_body,"Release supplier locomotive",func() -> void: _send("rail_detach",{"orderId":id}))
	release.disabled=terminal or str(order.get("status",""))!="unloading" or bool(freight.get("detached",false)) or order.has("unload") or freight.has("movement")
	release.tooltip_text="The stopped train needs a clear completed siding exit. The engine uncouples and leaves; the loaded cars remain on site."
	var remembered: Dictionary = freight_shunt_choices.get(id,{})
	var shunter: OptionButton = _entity_option(inspector_body,"shunters","Choose shunting locomotive…",str(remembered.get("shunterId","")))
	var target: OptionButton = _shunting_location_option(inspector_body,str(remembered.get("railLocationId","")))
	var shunt: Button = _button(inspector_body,"Shunt selected cars",func() -> void: _send("rail_shunt",{"orderId":id,"carIds":_selected_freight_cars(order),"shunterId":_selection(shunter),"railLocationId":_selection(target)}))
	var update_actions: Callable = func() -> void:
		var no_cars: bool = _selected_freight_cars(order).is_empty()
		var tanker_selected: bool = false
		for car: Dictionary in freight.get("cars",[]):
			if car.get("kind")=="tanker" and str(car.id) in _selected_freight_cars(order):tanker_selected=true
		start.disabled=str(order.get("status",""))!="unloading" or bool(freight.get("unloadRequested",true)) or str(freight.get("storageZoneId","")).is_empty() or no_cars or freight.has("movement") or tanker_selected
		shunt.disabled=terminal or not bool(freight.get("detached",false)) or str(freight.get("locomotivePhase","attached"))!="gone" or order.has("unload") or bool(freight.get("unloadRequested",false)) or freight.has("movement") or no_cars or _selection(shunter).is_empty() or _selection(target).is_empty()
	shunter.item_selected.connect(func(_index: int) -> void:
		freight_shunt_choices[id]={"shunterId":_selection(shunter),"railLocationId":_selection(target)}
		update_actions.call())
	target.item_selected.connect(func(_index: int) -> void:
		freight_shunt_choices[id]={"shunterId":_selection(shunter),"railLocationId":_selection(target)}
		update_actions.call())
	for checkbox: CheckBox in checks:checkbox.toggled.connect(func(_pressed: bool) -> void: update_actions.call())
	update_actions.call()
	shunt.tooltip_text="Release the supplier engine, assign an on-duty shunter driver, and choose connected clear track long enough for the selected cars. Turnouts are set for the movement."
	var collect: Button = _button(inspector_body,"Request collection of empty cars",func() -> void: _return_train_form(id))
	collect.disabled=terminal or not bool(freight.get("detached",false)) or _car_order_remaining_mass(order)>0
	collect.tooltip_text="Assemble the empty cars at a connected named return point, then request a supplier engine to collect them."
	for car: Dictionary in freight.get("cars",[]):
		_button(inspector_body,"Inspect "+str(car.id),func() -> void: _user_entity(str(car.id)))

func _freight_car_inspector(car: Dictionary) -> void:
	_detail("Train / order",car.get("orderId",""))
	_detail("State",car.get("status",""))
	_detail("Receiving point",_reception_name(car.get("receptionLocationId","")))
	_detail("Stockyard",car.get("storageZoneId","Not selected"))
	_detail("Car length","%.1f m"%float(car.get("length",0)))
	_detail("Car type",car.get("kind","flatcar"))
	_detail("Coupled to",", ".join(car.get("coupledTo",[])))
	_detail("Handbrake","Set" if car.get("handbrake",false) else "Released")
	_detail("Brake hose","Connected" if car.get("brakeHoseConnected",false) else "Disconnected")
	if car.has("tank"):
		_detail("Contained liquid",_name(str(car.tank.get("product",""))))
		_detail("Tank contents","%s / %s L"%[car.tank.get("liters",0),car.tank.get("capacity",0)])
		for pump: Dictionary in ProcessUI.records(self,"pumps"):
			if str(pump.get("carId",""))==str(car.id):_detail("Transfer pump",pump.id)
		_button(inspector_body,"Open Process register",func() -> void:_switch_tab("Process"))
		_note(inspector_body,"Tanker liquid stays inside the car during reception and shunting. Select a transfer pump in the Process tab to connect and unload this tanker. A forklift cannot unload liquid.")
	_detail("Ordered mass",_mass(float(car.get("mass",0))))
	_detail("Remaining mass",_mass(_car_remaining_mass(car)))
	for line: Dictionary in car.get("manifest",[]):
		_detail(_name(str(line.get("item",""))),"%s ordered · %s unloaded"%[line.get("qty",0),line.get("arrived",0)])
	_button(inspector_body,"Open train delivery controls",func() -> void: _user_entity(str(car.get("orderId",""))))
	_note(inspector_body,"Cars retain their IDs and cargo records after uncoupling. Open the delivery controls to select cars for shunting or unloading, choose a named destination and stockyard, or request collection once the cars are empty.")

func _selected_freight_cars(order: Dictionary) -> Array[String]:
	var result: Array[String] = []
	var available: Array = order.get("railFreight",{}).get("cars",[])
	var wanted: Array = freight_car_selection.get(str(order.id),[])
	for car: Dictionary in available:
		if car.get("returned",false):continue
		if not freight_car_selection.has(str(order.id)) or str(car.id) in wanted:result.append(str(car.id))
	return result

func _freight_car_checkboxes(parent: Node,order: Dictionary) -> Array[CheckBox]:
	var result: Array[CheckBox] = []
	_label(parent,"CARS TO SHUNT / UNLOAD")
	var current: Array[String] = _selected_freight_cars(order)
	for car: Dictionary in order.get("railFreight",{}).get("cars",[]):
		var checkbox: CheckBox = CheckBox.new()
		checkbox.text="%s · %s · %s"%[car.id,_mass(_car_remaining_mass(car)),_reception_name(car.get("locationId",order.railFreight.get("receptionLocationId","")))]
		checkbox.button_pressed=str(car.id) in current
		checkbox.disabled=bool(car.get("returned",false))
		checkbox.tooltip_text="Select a connected block of cars from one exposed end for shunting. Select any available cars for unloading."
		parent.add_child(checkbox)
		checkbox.toggled.connect(func(pressed: bool) -> void:
			var selected: Array[String] = _selected_freight_cars(order)
			if pressed and str(car.id) not in selected:selected.append(str(car.id))
			elif not pressed:selected.erase(str(car.id))
			freight_car_selection[str(order.id)]=selected)
		result.append(checkbox)
	return result

func _shunting_location_option(parent: Node,current: String = "") -> OptionButton:
	var option: OptionButton = _entity_option(parent,"railLocations","Choose named rail destination…",current)
	for index: int in range(1,option.item_count):
		for location: Dictionary in _records("railLocations"):
			if str(location.id)==str(option.get_item_metadata(index)):
				option.set_item_text(index,"%s · %s · %s m"%[location.get("name",location.id),location.id,location.get("length",0)])
	return option

func _car_order_remaining_mass(order: Dictionary) -> float:
	var total: float = 0
	for car: Dictionary in order.get("railFreight",{}).get("cars",[]):total+=_car_remaining_mass(car)
	return total

func _rail_dialog(title: String,size: Vector2i) -> Dictionary:
	var window: Window = Window.new()
	window.title=title;window.size=size;window.exclusive=true;window.theme=screen.theme
	screen.add_child(window)
	_window_background(window)
	var margin: MarginContainer = MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left","right","top","bottom"]:margin.add_theme_constant_override("margin_"+side,12)
	window.add_child(margin)
	var layout: VBoxContainer = VBoxContainer.new()
	margin.add_child(layout)
	var scroll: ScrollContainer = ScrollContainer.new()
	scroll.size_flags_vertical=Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED
	layout.add_child(scroll)
	var body: VBoxContainer = VBoxContainer.new()
	body.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	scroll.add_child(body)
	var footer: HBoxContainer = HBoxContainer.new()
	layout.add_child(footer)
	window.close_requested.connect(window.queue_free)
	return {"window":window,"body":body,"footer":footer}

func _yard_access_form() -> void:
	var dialog: Dictionary = _rail_dialog("Factory yard access switch",Vector2i(660,410))
	var body: VBoxContainer = dialog.body
	_note(body,"A yard access switch replaces a 20 m section of the inherited siding. Prepare its local possession, manually recover the four original panels into storage, then build the turnout. Rail arrivals whose routes cross the work section wait until it is reopened.")
	var east: SpinBox = _number(body,"Switch start · east coordinate (m)",80,50,100,5)
	_note(body,"The switch starts at S5 and the branch ends 20 m farther east at S10. With E80, extend factory track from E100, S10. This does not automatically remove any existing rail; manual recovery comes first.")
	_button(body,"1 · Prepare siding work possession",func() -> void:_send("rail_access_prepare",{"x":east.value});dialog.window.queue_free())
	_button(body,"2 · Open Railway / recover original panels",func() -> void:_switch_tab("Railway");dialog.window.queue_free())
	_button(body,"3 · Plan yard access switch",func() -> void:_send("rail_access_plan",{"x":east.value});dialog.window.queue_free())
	for possession: Dictionary in _records("railPossessions"):
		if possession.get("released",false) or possession.get("kind")!="sidingAccess":continue
		_button(body,"Reopen completed siding · "+str(possession.id),func() -> void:_send("rail_possession_release",{"id":str(possession.id)});dialog.window.queue_free())
	dialog.window.popup_centered()

func _shunter_order_form() -> void:
	var dialog: Dictionary = _rail_dialog("Order owned diesel shunter",Vector2i(540,330))
	var body: VBoxContainer = dialog.body
	_note(body,"Buy a 32-ton diesel shunting locomotive for $68,000 plus $240 rail delivery. It is delivered by rail onto the original siding. Keep its reception track clear. Hire a Qualified railway driver in Purchase / hire, or record a licensed equipment operator’s railway qualification from their inspector. The assigned driver must be on duty.")
	_label(body,"Driver (optional on ordering)")
	var driver: OptionButton = _entity_option(body,"workers","Assign driver later…","",false,true)
	_label(body,"Delivery point")
	var reception: OptionButton = _reception_option(body)
	_button(body,"Order shunter",func() -> void:
		var args: Dictionary = {}
		if not _selection(driver).is_empty():args["driverId"]=_selection(driver)
		if not _selection(reception).is_empty():args["railLocationId"]=_selection(reception)
		_send("shunter_order",args)
		dialog.window.queue_free())
	dialog.window.popup_centered()

func _shunter_inspector(shunter: Dictionary) -> void:
	var id: String = str(shunter.id)
	_detail("Ownership","Owned diesel shunting locomotive")
	_detail("State",shunter.get("status",""))
	_detail("Phase",shunter.get("phase","parked"))
	_detail("Control","MANUAL · release to accept delegated jobs" if shunter.get("manualControl",false) else "Automatic / delegated")
	_detail("Mass / purchase","32,000 kg · $68,000 + $240 rail delivery")
	_detail("Home shed",shunter.get("shedId","Not assigned"))
	_coupling_details(shunter.get("coupling",{}))
	_coupling_details(shunter.get("handover",{}))
	_detail("Named location",_reception_name(shunter.get("locationId","")))
	if shunter.get("movement",{}).has("blockedBy"):_detail("Route blocked by",shunter.movement.blockedBy)
	_detail("Driver",shunter.get("driverId","Unassigned"))
	_detail("Fuel","%.1f / %s L"%[float(shunter.get("fuel",0)),shunter.get("tank",0)])
	_detail("Fuel consumed","%.1f L"%float(shunter.get("used",0)))
	if shunter.has("refueling"):
		_detail("Fuel barrel",shunter.refueling.get("barrelId",""))
		_detail("Fuel handler",shunter.refueling.get("workerId",""))
		_detail("Refueling step",shunter.refueling.get("phase",""))
		_detail("Diesel in can","%.1f L"%float(shunter.refueling.get("carried",0)))
	_detail("Assigned delivery",shunter.get("orderId",""))
	if shunter.has("blockedBy"):_detail("Waiting for",shunter.blockedBy)
	var driver: OptionButton = _entity_option(inspector_body,"workers","No assigned driver",str(shunter.get("driverId","")),false,true)
	_button(inspector_body,"Apply shunter driver",func() -> void: _send("shunter_driver",{"shunterId":id,"workerId":_selection(driver)}))
	var location: OptionButton = _shunting_location_option(inspector_body)
	var park: Button = _button(inspector_body,"Drive shunter to named location",func() -> void: _send("shunter_park",{"shunterId":id,"railLocationId":_selection(location)}))
	park.disabled=_selection(location).is_empty() or str(shunter.get("phase","parked"))!="parked"
	location.item_selected.connect(func(_index: int) -> void:park.disabled=_selection(location).is_empty() or str(shunter.get("phase","parked"))!="parked")
	var refuel: Button = _button(inspector_body,"Refuel stopped shunter",func() -> void: _send("shunter_refuel",{"shunterId":id}))
	refuel.disabled=str(shunter.get("phase","parked"))!="parked"
	var driving: HBoxContainer = HBoxContainer.new()
	inspector_body.add_child(driving)
	var forward: Button = _button(driving,"Forward 5 m",func() -> void:_send("shunter_drive",{"shunterId":id,"distance":5}))
	var reverse: Button = _button(driving,"Reverse 5 m",func() -> void:_send("shunter_drive",{"shunterId":id,"distance":-5}))
	forward.disabled=str(shunter.get("phase","parked"))!="parked" or shunter.has("refueling")
	reverse.disabled=forward.disabled
	var release_control: Button = _button(inspector_body,"Release manual control",func() -> void:_send("shunter_release",{"shunterId":id}))
	release_control.disabled=not bool(shunter.get("manualControl",false)) or str(shunter.get("phase","parked"))!="parked"
	if shunter.has("parkingLocationId"):
		_button(inspector_body,"Return to assigned engine shed",func() -> void:_send("shunter_park",{"shunterId":id,"railLocationId":shunter.parkingLocationId}))
	_note(inspector_body,"Manual forward / reverse moves follow the actual rails with the driver aboard and obey buffers, people, vehicles and reservations. Release manual control before a delegated job. For cars, select this shunter in the delivery inspector. Refueling uses a driver carrying a 20 L can from a barrel within 8 m; finish refueling before dispatch.")

func _return_train_form(preselected: String = "") -> void:
	var dialog: Dictionary = _rail_dialog("Collect empty return train",Vector2i(600,460))
	var body: VBoxContainer = dialog.body
	_note(body,"First use your shunter to bring the empty cars together at a connected named return point near the main line. Select the empty deliveries to return in one train. A supplier locomotive will come to couple and collect them. Loaded cars cannot be returned.")
	var choices: Array[CheckBox] = []
	for order: Dictionary in _records("orders"):
		if not order.has("railFreight") or str(order.get("status",""))!="unloading" or not bool(order.railFreight.get("detached",false)) or _car_order_remaining_mass(order)>0:continue
		var available: int = 0
		for car: Dictionary in order.railFreight.get("cars",[]):
			if not car.get("returned",false):available+=1
		if available==0:continue
		var check: CheckBox = CheckBox.new()
		check.text="%s · %s empty cars"%[order.id,available]
		check.set_meta("orderId",str(order.id))
		check.button_pressed=str(order.id)==preselected
		body.add_child(check);choices.append(check)
	if choices.is_empty():_note(body,"No stopped empty detached deliveries are available for collection yet.")
	_label(body,"Connected collection point")
	var reception: OptionButton = _reception_option(body)
	var request: Button = _button(body,"Request mainline locomotive",func() -> void:
		var ids: Array[String] = []
		for choice: CheckBox in choices:
			if choice.button_pressed:ids.append(str(choice.get_meta("orderId")))
		var args: Dictionary = {"orderIds":ids}
		if not _selection(reception).is_empty():args["railLocationId"]=_selection(reception)
		_send("rail_return",args)
		dialog.window.queue_free())
	var update: Callable = func() -> void:
		request.disabled=true
		for choice: CheckBox in choices:
			if choice.button_pressed:request.disabled=false
	for choice: CheckBox in choices:choice.toggled.connect(func(_pressed: bool) -> void:update.call())
	update.call()
	dialog.window.popup_centered()

func _build_rail_help() -> void:
	_label(register_body,"RAILWAY MANAGEMENT")
	_button(register_body,"Back to Railway",func() -> void: _switch_tab("Railway"))
	var scroll: ScrollContainer = ScrollContainer.new()
	scroll.size_flags_vertical=Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED
	register_body.add_child(scroll)
	var body: VBoxContainer = VBoxContainer.new()
	body.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation",16)
	scroll.add_child(body)
	for paragraph: String in _rail_help_paragraphs():
		var label: Label = _note(body,paragraph)
		label.add_theme_font_size_override("font_size",14)
		label.custom_minimum_size.x=500
	_label(body,"Railway work is physical: qualified drivers, ground crew, fuel, car brakes, actual routes and shared-section reservations. Independent routes can operate concurrently.")

func _rail_help_paragraphs() -> Array[String]:
	return [
		"Commission the reception loop. In Railway, open Mainline connection and prepare the protected work possession. Public rail arrivals pause. The four inherited 5 m panels are now real, individually selectable rails. Manually recover them into a stockyard, plan and build the siding exit, then explicitly reopen the completed section. Creative makes recovery and construction instant but still preserves the original material and requires reopening.",
		"Build factory access. Open + Yard access switch, choose its start and prepare its local possession. Recover its four original panels manually before planning the switch. At the default E80, S5 position, its factory branch ends at E100, S10. Extend connected tracks from there and reopen the siding after the switch is complete. The ordinary rail tools never automatically remove straight panels: recover a panel first when replacing it with a switch.",
		"Name receiving and working tracks. Select installed rail and designate a named unloading, transfer, loading or parking interval. Its centered usable length must fit on continuous track without guessing a route through a fork. Any connected unloading or transfer point can receive a supplier train if the complete locomotive and cars fit. Build and name parallel receiving tracks to serve several trains.",
		"Order a multi-car train. In Purchase / hire choose Rail and enter the batch. The preview shows payload, car count and train length. Choose the named receiving point before the approach starts. Automatic reception uses the original siding. A train waits with an explicit reason if its chosen track is occupied, too short, disconnected or under possession. Your choice is preserved while waiting.",
		"Use independent routes together. Trains and shunters reserve their actual swept track corridor, including the locomotive and cars, before moving. Separate routes can operate together. Shared approaches, crossing paths and switch fouling areas wait for the current movement to clear. A switch cannot change beneath rolling stock. A queue or route blocker appears in its linked order or locomotive inspector.",
		"Release the supplier locomotive. Once stopped, open the delivery and click Release supplier locomotive. The railway service crew physically alights, walks to the coupler, secures the car brakes, disconnects the hose and coupling, and returns clear. Only then does the locomotive drive out along a connected exit. The freight cars and their cargo stay on site; supplier idle charges stop after the engine leaves.",
		"Hire a railway driver. In Purchase / hire order Qualified railway driver; several workers share one crew bus. Their Worker # ID, wage, attendance and shift remain in Workers. You may verify an existing licensed equipment operator’s railway qualification in their inspector for $180. An ordinary equipment-operator role alone does not authorize locomotive driving. Assign an available qualified worker in the shunter inspector.",
		"Buy and operate a shunter. + Shunter orders a 32-ton owned diesel locomotive for $68,000 plus $240 rail delivery. The supplier driver brings it over installed track and hands it over. Your assigned driver walks to the cab and boards before movement. They finish an active safe movement at shift end, then leave the cab and follow the usual commute. A resting, off-shift or busy driver blocks new dispatch with a useful reason.",
		"Move cars. Release the supplier engine and wait until it has gone. In the delivery inspector select an exposed connected block of cars, a shunter and a named destination, then Shunt selected cars. The qualified driver approaches, carries out the physical ground coupling and brake work, boards, moves the consist, secures the cars and uncouples. Cars retain IDs, contained cargo, mass, brakes and locations throughout interrupted or saved operations. Build a runaround where the locomotive needs to reach the other end.",
		"Drive the locomotive directly. Forward 5 m and Reverse 5 m in its inspector move an uncoupled shunter in its cab-facing direction along installed rails. The same driver, fuel, buffer, collision and reservation rules apply. MANUAL stays visible after stopping. Click Release manual control before sending a delegated parking or shunting job.",
		"Refuel without teleporting fuel. Park within 8 m of a diesel barrel and select Refuel stopped shunter. Its qualified driver alights, walks to the barrel, fills a 20 L can, carries it to the filler and pours it before fetching another can. Barrel, carried fuel and locomotive fuel remain separately accounted. Clear the walking route if a blocked-refueling warning appears. Finish refueling before dispatch.",
		"Build an engine shed. Purchase its delivered kit and use Engine shed in Yard over at least 14 m of straight internal track, aligned with the doors. Normal work prepares foundations beside the track, installs anchors, columns, frames, walls, roof sections and roller doors with equipment and crew. Creative completes it instantly. Select the finished shed, choose the locomotive and Assign shed and park locomotive; its saved bay becomes the home location. Return to assigned engine shed uses a real clear rail movement.",
		"Receive and shunt tankers. + Tanker train orders process water or bulk diesel, 1–30,000 L per car, in a multi-car train. The form shows payload, tare, train length and cost. Select a connected receiving interval, release the supplier locomotive and shunt the cars to a named transfer point as usual. The rounded tank, valves and car ID are physical assets. Contents remain in each tanker. Build a tank, transfer pump, and connected pipe route from the Process tab; select the pump to connect a stopped tanker and transfer liquid. A forklift cannot unload a tanker and a loaded tanker cannot be returned as empty.",
		"Unload flatcars. Choose and apply an Unloading stockyard in the delivery inspector, select cars and Start unloading. Owned equipment, an operator and helper physically handle the cargo. Pause unloading after current lift before moving cars. A full or inaccessible stockyard produces a linked waiting reason. Track occupancy remains real while cars are unloaded.",
		"Send empty cars away. Use the shunter to assemble empty supplier cars at a connected named return point near the main line, park clear, then Collect empty cars in Railway. The supplier pickup engine approaches, its service crew connects the cars, tests hoses and releases brakes, then hauls the empty train onto the main line. Pickup service and waiting time appear in Costs and the return-train inspector. Loaded or reserved cars cannot be collected. Orders, car IDs and manifests remain available as history.",
		"Review linked records. Cars show their delivery, current location, cargo or liquid contents, couplings, hoses and handbrakes. Engines show driver, mode, fuel, home shed, current ground crew and route blocker. Coupling steps identify their assigned worker and cars. Click these IDs to inspect them; Activity filters warnings from ordinary information. Saves preserve operations, reservations, queues and completed physical steps.",
		"Edit installed rails from Railway. Select a completed panel in Installed track, then Review this panel recovery or Review whole curve/turnout. The review lists recovered materials and identities, attached stops, automatic stockyard destinations and constraints. Normal recovery creates work: a worker unfastens and rigs the panel; equipment lifts and carries it to physical stockyard storage. Open the linked work to assign equipment or inspect its waiting reason. Creative recovery completes immediately but still needs space. Plans that have not been built are canceled from Work rather than recovered.",
		"Replace straight track with a switch. Recover the conflicting panels first, wait for physical work to finish in normal mode, then place the switch at the newly exposed endpoint. Keep infrastructure clear of trains, reserved movements, named locations and conflicting work. Inherited public mainline and siding steel requires the explicit protected possession described above. If you cancel that replacement, straight panels may restore the possessed gap before reopening.",
		"Manage buffer stops in Railway with Buffer stops / editing. Purchase delivered stops and choose a completed open endpoint to review installation. Normal installation needs stock, equipment, an operator and a ground worker. Select an installed stop to Review buffer recovery; recovered stops retain their IDs in a 2 × 2 m storage footprint. Creative installation and recovery are instant. Rail extensions relocate the affected stop once for the connected work; connecting track recovers redundant stops. A stop mounts on existing track and does not add five meters of steel. Stops still block rail movements until physically removed.",
		"Test layouts with Creative. Toggle Creative in the Yard toolbar to place paving, buildings and rail immediately. Straight rail, 90° curve, Diverging switch and Converging switch have separate tools. Recover installed panels through their inspector to make room for replacement switches. Work possessions must still be explicitly reopened after the track is complete.",
		"Rail layouts can form loops. Matching open endpoints must meet facing in opposite directions. Crossing rails alone do not create a junction; use turnouts for branches and joins. A loop can provide an engine runaround. Supplier reception and collection can use connected named tracks; each real route and interval must fit the complete consist and remain clear."
	]

func _buffer_records() -> Array:
	if state.has("buffers"):return state.buffers
	if metadata.get("render",{}).has("buffers"):return metadata.render.buffers
	var legacy: Dictionary = state.get("buffer",{})
	if legacy.is_empty():return []
	var record: Dictionary = legacy.duplicate()
	record["id"]=str(record.get("id","BUFFER-001"))
	return [record]

func _dismiss_rail_window(window: Window) -> void:
	if is_instance_valid(window):
		window.hide()
		window.queue_free()

func _buffer_summary() -> String:
	var available: int = 0
	var incoming: int = 0
	for stock: Dictionary in _records("stacks"):
		if stock.get("item")=="bufferStop":available+=int(stock.get("qty",0))-int(stock.get("reserved",0))
	for order: Dictionary in _records("orders"):
		for line: Dictionary in order.get("manifest",[{"item":order.get("item",""),"qty":order.get("qty",0),"arrived":order.get("arrived",0)}]):
			if line.get("item")=="bufferStop":incoming+=int(line.get("qty",0))-int(line.get("arrived",0))
	var installed: int = 0
	var loose: int = 0
	for stop: Dictionary in _buffer_records():
		if bool(stop.get("carried",false)):continue
		if bool(stop.get("secured",true)):installed+=1
		else:loose+=1
	return "Buffer stops: %d installed · %d available in stock · %d incoming."%[installed,available,incoming]+(" %d loose awaiting recovery."%loose if loose>0 else "")

func _buffer_endpoint_form(track_id: String = "") -> void:
	var endpoints: Array = []
	for endpoint: Dictionary in metadata.get("render",{}).get("railOpenEndpoints",[]):
		if not track_id.is_empty() and track_id not in [str(endpoint.get("trackId","")),str(endpoint.get("panelId",""))]:continue
		endpoints.append(endpoint)
	if is_instance_valid(buffer_endpoint_window):_dismiss_rail_window(buffer_endpoint_window)
	var dialog: Dictionary = _rail_dialog("Rail editing · buffer stops",Vector2i(660,400))
	buffer_endpoint_window=dialog.window
	var body: VBoxContainer = dialog.body
	_note(body,_buffer_summary())
	_note(body,"%s. Stops mount on a completed open track end; they do not add a rail panel. Select installed track or a stop in Railway to review recovery. Extend rails using the rail tools; the crew relocates the affected stop during the connected work."%("CREATIVE: placement and recovery are immediate; recovery still needs finite stockyard space" if bool(state.get("creative",false)) else "PHYSICAL: a delivered stop, lifting machine, operator and ground worker are required"))
	if endpoints.is_empty():
		_note(body,"No open endpoint is available for this selection. Complete or extend track first. You can still order stops or recover installed infrastructure.")
	else:
		var choices: Array = []
		for endpoint: Dictionary in endpoints:choices.append("%s · %s · %s%s"%[endpoint.get("panelId",endpoint.get("trackId","")),endpoint.get("route","straight"),_position(endpoint)," · "+str(endpoint.occupiedBy) if not str(endpoint.get("occupiedBy","")).is_empty() else " · Open"])
		var option: OptionButton = _option(body,choices)
		_button(body,"Review endpoint installation…",func() -> void:
			var endpoint: Dictionary = endpoints[option.selected]
			_dismiss_rail_window(buffer_endpoint_window)
			_rail_edit_review({"operation":"install_buffer","x":float(endpoint.x),"z":float(endpoint.z)}))
	_button(body,"Purchase buffer stops…",func() -> void: _dismiss_rail_window(buffer_endpoint_window); _purchase_buffer_form())
	_button(body,"View installed stops, stock and work",func() -> void: _dismiss_rail_window(buffer_endpoint_window); _switch_tab("Railway"))
	_button(body,"Rail editing help",func() -> void: _dismiss_rail_window(buffer_endpoint_window); _switch_tab("Help"))
	buffer_endpoint_window.popup_centered()

func _purchase_buffer_form() -> void:
	var dialog: Dictionary = _rail_dialog("Purchase buffer stops",Vector2i(560,300))
	var body: VBoxContainer = dialog.body
	_note(body,_buffer_summary())
	_note(body,"Delivered clamp-on stop · 850 kg · 2 × 2 m storage footprint. Buying supplies the asset; install it at an open endpoint from Railway after delivery.")
	var quantity: SpinBox = _number(body,"Buffer stop quantity",1,1,9999)
	var mode: OptionButton = _option(body,["Road truck","Rail freight"])
	var total: Label = _note(body,"")
	var update: Callable = func() -> void:
		total.text="%d stops · %s · %s before freight"%[int(quantity.value),_mass(quantity.value*float(catalog.bufferStop.get("mass",850))),_money(quantity.value*float(catalog.bufferStop.get("price",1250)))]
	quantity.value_changed.connect(func(_value: float) -> void:update.call())
	update.call()
	_button(body,"Order buffer stops",func() -> void:
		quantity.apply()
		_send("purchase_batch",{"lines":[{"item":"bufferStop","qty":int(quantity.value)}],"mode":"rail" if mode.selected==1 else "road"})
		_dismiss_rail_window(dialog.window))
	_button(body,"Cancel",func() -> void:_dismiss_rail_window(dialog.window))
	dialog.window.popup_centered()

func _rail_edit_review(request: Dictionary) -> void:
	if is_instance_valid(rail_edit_window):_dismiss_rail_window(rail_edit_window)
	rail_edit_request=request.duplicate(true)
	var dialog: Dictionary = _rail_dialog("Review rail infrastructure edit",Vector2i(680,530))
	rail_edit_window=dialog.window;rail_edit_body=dialog.body;rail_edit_footer=dialog.footer
	_note(rail_edit_body,"Checking installed assets, operational constraints and physical storage…")
	_button(rail_edit_footer,"Cancel",func() -> void:_dismiss_rail_window(rail_edit_window))
	rail_edit_window.popup_centered()
	_send("rail_edit_preview",request)

func _show_rail_edit_preview(preview: Dictionary) -> void:
	# Replies for an older selection must not enable a different edit.
	for key: String in ["operation","id","scope"]:
		if rail_edit_request.has(key) and str(preview.get(key,""))!=str(rail_edit_request[key]):return
	if rail_edit_request.get("operation")=="install_buffer":
		if preview.get("endpoint",{})!={"x":rail_edit_request.x,"z":rail_edit_request.z}:return
	_clear(rail_edit_body)
	_clear(rail_edit_footer)
	var creative: bool = preview.get("mode")=="creative"
	var installing: bool = preview.get("operation")=="install_buffer"
	_label(rail_edit_body,"CREATIVE · IMMEDIATE EDIT" if creative else "PHYSICAL · WORK ORDER")
	_note(rail_edit_body,"%s · %s"%["Install buffer stop" if installing else "Recover buffer stop" if preview.get("operation")=="recover_buffer" else "Recover "+str(preview.get("scope","panel")),_position(preview.endpoint) if installing else preview.get("id","")])
	for material: Dictionary in preview.get("materials",[]):
		_note(rail_edit_body,"%s × %s · %s"%[material.get("qty",0),_name(str(material.get("item",""))),_mass(float(material.get("qty",0))*float(material.get("unitMass",0)))])
		var identities: HFlowContainer = HFlowContainer.new()
		rail_edit_body.add_child(identities)
		for asset: String in material.get("assetIds",[]):
			_button(identities,"Inspect "+asset,func() -> void:_user_entity(asset))
	_label(rail_edit_body,"SOURCE" if installing else "STORAGE DESTINATION · AUTOMATIC")
	if installing:_note(rail_edit_body,"%s available · %s incoming. Creative reuses available stock or supplies a stop instantly; physical work uses delivered stock."%[preview.get("availableStops",0),preview.get("incomingStops",0)])
	for source: Dictionary in preview.get("sources",[]):
		_button(rail_edit_body,"Inspect available stock "+str(source.get("stockId","")),func() -> void:_user_entity(str(source.get("stockId",""))))
	for destination: Dictionary in preview.get("destinations",[]):
		_note(rail_edit_body,"%s → %s · %s · %s × %s m"%[destination.get("assetId",""),destination.get("zoneId","Stockyard"),_position(destination),destination.get("w",0),destination.get("d",0)])
		var zone_id: String = str(destination.get("zoneId",""))
		if not zone_id.is_empty():_button(rail_edit_body,"Inspect stockyard "+zone_id,func() -> void:_user_entity(zone_id))
	if not installing and preview.get("destinations",[]).is_empty():_note(rail_edit_body,"Resolve the blocking constraint to check storage." if not str(preview.get("constraint","")).is_empty() else "No finite storage destination is currently available.")
	var constraint: String = str(preview.get("constraint",""))
	var storage_error: String = str(preview.get("storageError",""))
	if not constraint.is_empty():_note(rail_edit_body,"BLOCKED: "+constraint)
	if not storage_error.is_empty():_note(rail_edit_body,"STORAGE: "+storage_error)
	for warning: String in preview.get("warnings",[]):_note(rail_edit_body,warning)
	for job_id: String in preview.get("pendingJobs",[]):_button(rail_edit_body,"Open existing work "+job_id,func() -> void:_user_entity(job_id))
	_note(rail_edit_body,"Workers unfasten and rig recovered material, then equipment carries it into storage. Attached stops are recovered first. Existing material identities are retained. A train, reserved movement, active construction, or named location may prevent recovery. Constraints are checked again when submitted." if not creative else "This edit takes effect immediately. Recovered identities and material stay in physical stockyard storage. Operational safety and finite capacity still apply.")
	var submit: Button = _button(rail_edit_footer,"Install instantly" if creative and installing else "Recover instantly" if creative else "Plan physical installation" if installing else "Plan physical recovery",func() -> void:
		var request: Dictionary = rail_edit_request.duplicate(true)
		if request.operation=="recover_rail":_send("remove_rail",{"id":request.id,"scope":request.get("scope","panel")})
		elif request.operation=="recover_buffer":_send("remove_buffer",{"id":request.id})
		else:_send("plan_buffer",{"x":request.x,"z":request.z})
		_dismiss_rail_window(rail_edit_window)
		_switch_tab("Railway"))
	submit.disabled=not constraint.is_empty() or creative and not storage_error.is_empty()
	if installing and not creative:_button(rail_edit_footer,"Purchase buffer stops…",func() -> void:_dismiss_rail_window(rail_edit_window);_purchase_buffer_form())
	_button(rail_edit_footer,"Refresh preview",func() -> void:_rail_edit_review(rail_edit_request))
	_button(rail_edit_footer,"Cancel",func() -> void:_dismiss_rail_window(rail_edit_window))

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
	var track_id: String = str(entity.get("trackId",entity.get("id","")))
	var purposes: Array = ["unloading","transfer"] if track_id=="BOOTSTRAP-SIDING" else ["loading","unloading","transfer","parking"]
	var purpose: OptionButton = _option(body,purposes,purposes.find(entity.get("kind","unloading")))
	var route: OptionButton = _option(body,["straight"] if track_id=="BOOTSTRAP-SIDING" else ["straight","branch"],1 if entity.get("route")=="branch" else 0)
	_label(body,"Track "+track_id)
	var offset: SpinBox = _number(body,"Offset (m)",float(entity.get("offset",0)),0,100 if track_id=="BOOTSTRAP-SIDING" else 10000,0.1)
	var length: SpinBox = _number(body,"Centered usable length (m)",float(entity.get("length",5)),1,100 if track_id=="BOOTSTRAP-SIDING" else 200,0.5)
	_note(body,"Any connected unloading or transfer interval may receive a supplier train if the whole train fits and a clear route exists. Name separate parallel tracks for simultaneous reception. Shared sections and switches remain reserved until clear.")
	_button(body,"Save designation",func() -> void:
		var location: Dictionary = {"name":name.text,"kind":purpose.get_item_text(purpose.selected),"trackId":track_id,"route":route.get_item_text(route.selected),"offset":offset.value,"length":length.value}
		if entity.has("trackId"): location.id=entity.id
		_send("save_rail_location",{"location":location})
		window.queue_free())
	if entity.has("trackId"): _button(body,"Remove designation",func() -> void: _send("remove_rail_location",{"id":entity.id}); window.queue_free())
	window.close_requested.connect(window.queue_free)
	window.popup_centered()

func _build_sql() -> void:
	_note(register_body,"Read-only SQLite snapshot · SELECT, WITH, EXPLAIN. Tables: inventory, workers, equipment, jobs, job_groups, work_orders, orders, freight_cars, freight_car_lines, stacks, buildings, rails, rail_locations, zones, movements, costs, events.")
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
	if not latest_notice.is_empty():
		for previous: Dictionary in notices:
			if str(previous.get("id",""))==latest_notice and (previous.get("seen",false) or previous.get("state","todo")=="done"):
				toast.hide()
				break
	var newest: Dictionary = {}
	for candidate: Dictionary in notices:
		if candidate.get("seen",false) or candidate.get("state","todo")=="done":continue
		if newest.is_empty():newest=candidate
		if _notice_severity(candidate)=="warning":newest=candidate;break
	if newest.is_empty():
		toast.hide();latest_notice="";latest_notice_key=""
		return
	var notice_key: String=JSON.stringify([newest.get("id",""),newest.get("detail",""),newest.get("state","")])
	if notice_key==latest_notice_key or not started:return
	latest_notice=str(newest.id);latest_notice_key=notice_key
	_clear(toast_body)
	var top: HBoxContainer = HBoxContainer.new()
	toast_body.add_child(top)
	var title: Label = _label(top,str(newest.get("title","Operational notice")))
	title.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	if _notice_severity(newest)=="warning":title.add_theme_color_override("font_color",Color("986324"))
	_button(top,"×",func() -> void: toast.hide())
	_note(toast_body,str(newest.get("detail","")))
	var actions: HBoxContainer = HBoxContainer.new()
	toast_body.add_child(actions)
	_button(actions,"Inspect",func() -> void: _user_entity(str(newest.get("entity",""))); _send("notice",{"id":newest.id,"seen":true}); toast.hide())
	_button(actions,"Locate",func() -> void:_switch_tab("Yard");focus_entity.emit(str(newest.get("entity","")));_send("notice",{"id":newest.id,"seen":true});toast.hide())
	_button(actions,"Inbox",func() -> void: _switch_tab("Inbox"); toast.hide())
	toast.visible=true
	toast_age=0

func _open_purchase() -> void:
	if is_instance_valid(purchase_window):
		_refresh_purchase_destinations()
		purchase_window.popup_centered()
		return
	purchase_window=Window.new()
	purchase_window.title="Purchase materials / equipment · Hire workers"
	purchase_window.size=Vector2i(860,760)
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
	purchase_mode=_option(header,["Road · 12 t truck","Rail · 48 t per car"])
	purchase_mode.item_selected.connect(func(_index: int) -> void:
		purchase_rail_controls.visible=purchase_mode.selected==1
		_purchase_changed())
	purchase_rail_controls=VBoxContainer.new()
	purchase_rail_controls.visible=false
	body.add_child(purchase_rail_controls)
	_label(purchase_rail_controls,"Train reception")
	purchase_reception=_reception_option(purchase_rail_controls)
	purchase_reception.item_selected.connect(func(_index: int) -> void: _purchase_changed())
	_label(purchase_rail_controls,"Unloading stockyard")
	purchase_stockyard=_entity_option(purchase_rail_controls,"zones","Select later · train waits until unloading is requested")
	purchase_stockyard.item_selected.connect(func(_index: int) -> void: _purchase_changed())
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
	_note(body,"12 seats per bus. Equipment uses dedicated lowloaders. Rail materials share one locomotive with as many cars as fit the receiving berth. Deck space can require another car before the weight limit. New trains wait for Start unloading.")
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
	if not lines.is_empty(): _send("purchase_preview",_purchase_args(lines))

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
	_send("purchase_batch",_purchase_args(lines))
	purchase_window.hide()

func show_purchase() -> void:
	_open_purchase()

func show_tab(value: String) -> void:
	var aliases: Dictionary = {"site":"Yard","railways":"Railway","materials":"Materials","workers":"Workers","equipment":"Equipment","deliveries":"Deliveries","jobs":"Work","activity":"Activity","costs":"Costs","reports":"SQL","notices":"Inbox","help":"Help"}
	var target: String = str(aliases.get(value.to_lower(),value.capitalize()))
	if value.to_upper()=="SQL": target="SQL"
	if target in TABS or target=="Help": _switch_tab(target)

func _user_entity(id: String) -> void:
	show_entity(id)
	entity_selected.emit(id)

func _coupling_details(task: Dictionary) -> void:
	if task.is_empty():return
	_detail("Ground operation",task.get("id",""))
	_detail("Assigned crew",task.get("workerId",""))
	_detail("Ground step",task.get("status",task.get("phase","")))
	_detail("Locomotive",task.get("locomotiveId",""))
	_detail("Consist",", ".join(task.get("carIds",[])))

func _mainline_exit_form() -> void:
	var dialog: Dictionary = _rail_dialog("Commission the mainline connection",Vector2i(660,500))
	var body: VBoxContainer = dialog.body
	_note(body,"Take a protected work possession first. Public rail arrivals pause while this mainline section is under construction. Four original 5 m panels become individual recoverable rails; manually recover them into a stockyard, then build the connection. No steel disappears.")
	_button(body,"1 · Prepare mainline work possession",func() -> void:_send("rail_exit_prepare");dialog.window.queue_free())
	_button(body,"2 · Open Railway to recover original panels",func() -> void:_switch_tab("Railway");dialog.window.queue_free())
	_button(body,"3 · Plan / build the siding exit",func() -> void:_send("rail_exit_plan");dialog.window.queue_free())
	for possession: Dictionary in _records("railPossessions"):
		if possession.get("released",false):continue
		_note(body,"%s · %s · E%s–E%s, S%s · original panels: %s"%[possession.id,possession.kind,possession.get("from",0),possession.get("to",0),possession.get("z",0),", ".join(possession.get("assetIds",[]))])
		_button(body,"Reopen completed track · "+str(possession.id),func() -> void:_send("rail_possession_release",{"id":str(possession.id)});dialog.window.queue_free())
	_note(body,"Reopening checks completed physical continuity and clearance. The yard access switch has its own local possession and the same manual recovery workflow. Creative recovery and construction are instant, but the possession must still be explicitly reopened.")
	dialog.window.popup_centered()

func _tanker_order_form() -> void:
	var dialog: Dictionary = _rail_dialog("Order loaded tanker cars",Vector2i(610,490))
	var body: VBoxContainer = dialog.body
	_note(body,"Leased tankers arrive in one supplier train, each with its own ID, brakes, contents and mass. Liquid stays inside while cars are shunted. Use a constructed transfer pump and pipe route from the Process tab to unload liquid.")
	var product: OptionButton = _option(body,["Process water","Bulk diesel"])
	var liters: SpinBox = _number(body,"Liters per car · capacity 30,000 L",20000,1,30000,1)
	var cars: SpinBox = _number(body,"Tankers in this train",1,1,10,1)
	var reception: OptionButton = _reception_option(body)
	var summary: Label = _note(body,"")
	var refresh: Callable = func() -> void:
		var density: float = 1.0 if product.selected==0 else 0.84
		var price: float = 0.015 if product.selected==0 else 1.35
		var amount: float = liters.value*cars.value
		summary.text="%s L · %s payload + %s tare · %.1f m train · %s including car service and rail delivery"%[_comma(int(amount)),_mass(amount*density),_mass(cars.value*20000),26.1+(cars.value-1)*17.6,_money(amount*price+cars.value*160+240)]
	product.item_selected.connect(func(_i: int) -> void:refresh.call())
	liters.value_changed.connect(func(_v: float) -> void:refresh.call())
	cars.value_changed.connect(func(_v: float) -> void:refresh.call())
	refresh.call()
	_button(dialog.footer,"Order tanker train",func() -> void:
		var args: Dictionary = {"product":"bulkWater" if product.selected==0 else "bulkDiesel","litersPerCar":int(liters.value),"carCount":int(cars.value)}
		if not _selection(reception).is_empty():args["railLocationId"]=_selection(reception)
		_send("tanker_order",args)
		dialog.window.queue_free())
	dialog.window.popup_centered()
