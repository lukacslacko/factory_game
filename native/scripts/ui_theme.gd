extends RefCounted
## A complete light-paper theme. No control state relies on the engine's dark theme.
const INK = Color("334f43")
const SECONDARY = Color("52634f")
const WARNING = Color("704515")
const PAPER = Color("f4f3e9")
const FIELD = Color("fffef7")
const BAND = Color("dde4d3")
const RULE = Color("a6b39b")

static func box(background: Color, border: Color = RULE, padding: float = 6.0) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color=background
	style.border_color=border
	style.set_border_width_all(1)
	style.set_content_margin_all(padding)
	return style

static func icon(body: String, width: int=16, height: int=16) -> Texture2D:
	var picture := Image.new()
	picture.load_svg_from_string('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>'%[width,height,width,height,body])
	return ImageTexture.create_from_image(picture)

static func create() -> Theme:
	var theme := Theme.new()
	theme.default_font_size=14
	var panel := box(PAPER)
	var field := box(FIELD)
	var normal := box(Color("eef0e5"))
	normal.content_margin_left=8;normal.content_margin_right=8
	normal.content_margin_top=5;normal.content_margin_bottom=5
	var hover := box(Color("dfe8d7"),Color("6e8664"))
	var pressed := box(Color("c8d8bc"),Color("526f48"))
	var disabled := box(Color("e8e9df"),Color("bcc4b5"))
	for style: StyleBoxFlat in [hover,pressed,disabled]:
		style.content_margin_left=8;style.content_margin_right=8
		style.content_margin_top=5;style.content_margin_bottom=5
	# Focus is a border overlay, so it cannot obscure a pressed/disabled fill.
	var focus := box(Color(0,0,0,0),Color("315c42"),0)
	focus.set_border_width_all(2)
	for kind: String in ["PanelContainer","AcceptDialog"]:theme.set_stylebox("panel",kind,panel)
	for kind: String in ["Button","OptionButton","CheckBox","CheckButton","MenuButton"]:
		for state: String in ["normal","hover","pressed","hover_pressed","disabled"]:
			theme.set_stylebox(state,kind,{"normal":normal,"hover":hover,"pressed":pressed,"hover_pressed":pressed,"disabled":disabled}[state])
			theme.set_stylebox(state+"_mirrored",kind,theme.get_stylebox(state,kind))
		theme.set_stylebox("focus",kind,focus)
		for key: String in ["font_color","font_hover_color","font_pressed_color","font_hover_pressed_color","font_focus_color"]:
			theme.set_color(key,kind,Color("304b40"))
		theme.set_color("font_disabled_color",kind,Color("596153"))
		theme.set_color("font_outline_color",kind,Color.TRANSPARENT)
		theme.set_constant("outline_size",kind,0)
		theme.set_constant("h_separation",kind,6)
		theme.set_font_size("font_size",kind,13)
		for key: String in ["icon_normal_color","icon_hover_color","icon_pressed_color","icon_hover_pressed_color","icon_focus_color","icon_disabled_color"]:
			theme.set_color(key,kind,Color.WHITE)
	for kind: String in ["Label","LineEdit","TextEdit","Tree","RichTextLabel"]:
		theme.set_color("font_color",kind,INK)
		theme.set_color("default_color",kind,INK)
		theme.set_color("font_outline_color",kind,Color.TRANSPARENT)
		theme.set_constant("outline_size",kind,0)
	for kind: String in ["LineEdit","TextEdit"]:
		theme.set_stylebox("normal",kind,field)
		theme.set_stylebox("focus",kind,focus)
		theme.set_stylebox("read_only",kind,disabled)
		theme.set_color("font_placeholder_color",kind,SECONDARY)
		theme.set_color("font_uneditable_color",kind,SECONDARY)
		theme.set_color("font_readonly_color",kind,SECONDARY)
		theme.set_color("font_selected_color",kind,Color("203e30"))
		theme.set_color("selection_color",kind,Color("c3d8b7"))
		theme.set_color("caret_color",kind,Color("274d35"))
		theme.set_color("clear_button_color",kind,SECONDARY)
		theme.set_color("clear_button_color_pressed",kind,INK)
		theme.set_constant("caret_width",kind,2)
	theme.set_color("background_color","TextEdit",FIELD)
	theme.set_color("current_line_color","TextEdit",Color("e9eddf"))
	theme.set_constant("line_spacing","TextEdit",3)
	var popup := box(FIELD,RULE,8)
	popup.shadow_color=Color(0.1,0.16,0.1,0.16);popup.shadow_size=6
	theme.set_stylebox("panel","PopupMenu",popup)
	theme.set_stylebox("hover","PopupMenu",hover)
	for key: String in ["font_color","font_hover_color"]:theme.set_color(key,"PopupMenu",Color("304b40"))
	for key: String in ["font_disabled_color","font_accelerator_color","font_separator_color"]:theme.set_color(key,"PopupMenu",SECONDARY)
	theme.set_constant("v_separation","PopupMenu",7)
	var separator := StyleBoxLine.new()
	separator.color=RULE;separator.thickness=1
	separator.content_margin_top=4;separator.content_margin_bottom=4
	for kind: String in ["PopupMenu","HSeparator","VSeparator"]:theme.set_stylebox("separator",kind,separator)
	theme.set_constant("separation","HSeparator",9)
	for kind: String in ["VBoxContainer","HBoxContainer"]:theme.set_constant("separation",kind,6)
	theme.set_constant("h_separation","GridContainer",8)
	theme.set_constant("v_separation","GridContainer",5)
	theme.set_constant("buttons_separation","AcceptDialog",8)
	theme.set_stylebox("panel","Tree",box(FIELD,RULE,3))
	for state: String in ["selected","selected_focus","hovered_selected","hovered_selected_focus","button_pressed","title_button_pressed"]:theme.set_stylebox(state,"Tree",pressed)
	for state: String in ["hovered","hovered_dimmed","button_hover","title_button_hover"]:theme.set_stylebox(state,"Tree",hover)
	for state: String in ["focus","cursor","cursor_unfocused"]:theme.set_stylebox(state,"Tree",focus)
	theme.set_stylebox("title_button_normal","Tree",box(BAND,RULE,6))
	for key: String in ["title_button_color","font_selected_color","font_hovered_color","font_hovered_selected_color","font_hovered_dimmed_color"]:theme.set_color(key,"Tree",INK)
	theme.set_color("font_disabled_color","Tree",SECONDARY)
	theme.set_font_size("font_size","Tree",13)
	theme.set_font_size("title_button_font_size","Tree",13)
	theme.set_constant("v_separation","Tree",5)
	theme.set_constant("h_separation","Tree",6)
	theme.set_constant("draw_guides","Tree",1)
	theme.set_color("guide_color","Tree",Color("d6ddcc"))
	# Compact, high-contrast line icons replace pale default-theme controls.
	var check := icon('<rect x="1" y="1" width="14" height="14" rx="2" fill="#fffef7" stroke="#52634f" stroke-width="1.5"/><path d="M4 8l3 3 5-6" fill="none" stroke="#304b40" stroke-width="2"/>')
	var empty := icon('<rect x="1" y="1" width="14" height="14" rx="2" fill="#fffef7" stroke="#52634f" stroke-width="1.5"/>')
	var radio := icon('<circle cx="8" cy="8" r="6.5" fill="#fffef7" stroke="#52634f" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="#304b40"/>')
	var radio_empty := icon('<circle cx="8" cy="8" r="6.5" fill="#fffef7" stroke="#52634f" stroke-width="1.5"/>')
	var down := icon('<path d="M3 5l5 5 5-5" fill="none" stroke="#304b40" stroke-width="2"/>')
	var right := icon('<path d="M5 3l5 5-5 5" fill="none" stroke="#304b40" stroke-width="2"/>')
	for kind: String in ["CheckBox","PopupMenu","Tree"]:
		for key: String in ["checked","checked_disabled"]:theme.set_icon(key,kind,check)
		for key: String in ["unchecked","unchecked_disabled"]:theme.set_icon(key,kind,empty)
		for key: String in ["radio_checked","radio_checked_disabled"]:theme.set_icon(key,kind,radio)
		for key: String in ["radio_unchecked","radio_unchecked_disabled"]:theme.set_icon(key,kind,radio_empty)
	theme.set_icon("arrow","OptionButton",down)
	theme.set_constant("modulate_arrow","OptionButton",0)
	theme.set_icon("submenu","PopupMenu",right)
	theme.set_icon("arrow","Tree",down)
	theme.set_icon("arrow_collapsed","Tree",right)
	# SpinBox uses separate eight-pixel arrows, with their own state modulation.
	# Its legacy `updown` icon stays empty so modern split-button drawing is used.
	for direction: String in ["up","down"]:
		for suffix: String in ["","_hover","_pressed","_disabled"]:
			var arrow_color := "#52634f" if suffix=="_disabled" else "#304b40"
			var arrow_path := "M4 6l4-4 4 4" if direction=="up" else "M4 2l4 4 4-4"
			theme.set_icon(direction+suffix,"SpinBox",icon('<path d="%s" fill="none" stroke="%s" stroke-width="2" stroke-linejoin="round"/>'%[arrow_path,arrow_color],16,8))
			theme.set_color(direction+suffix+"_icon_modulate","SpinBox",Color.WHITE)
	for checked: bool in [false,true]:
		var toggle := icon('<rect x="1" y="2" width="28" height="14" rx="7" fill="%s" stroke="#52634f"/><circle cx="%d" cy="9" r="5" fill="#fffef7" stroke="#52634f"/>'%["#526f48" if checked else "#b1bba8",22 if checked else 8],30,18)
		for suffix: String in ["","_disabled","_mirrored","_disabled_mirrored"]:theme.set_icon(("checked" if checked else "unchecked")+suffix,"CheckButton",toggle)
	for kind: String in ["CheckBox","CheckButton"]:
		for key: String in ["checkbox_checked_color","checkbox_unchecked_color","button_checked_color","button_unchecked_color"]:theme.set_color(key,kind,Color.WHITE)
	for kind: String in ["HScrollBar","VScrollBar"]:
		var track := box(Color("e1e5d8"),Color("c1cbb7"),0)
		# Scrollbar thickness comes from the track's cross-axis minimum size.
		# Zero vertical margins make a horizontal scrollbar visible but unclickable.
		if kind=="HScrollBar":
			track.content_margin_top=6;track.content_margin_bottom=6
		else:
			track.content_margin_left=6;track.content_margin_right=6
		theme.set_stylebox("scroll",kind,track)
		theme.set_stylebox("scroll_focus",kind,focus)
		for state: String in ["grabber","grabber_highlight","grabber_pressed"]:
			var thumb := box(Color("647d5c") if state!="grabber" else Color("8b9e7e"),Color("647d5c"),4)
			theme.set_stylebox(state,kind,thumb)
	# Outer register scrolling must not introduce hidden one-pixel panel insets.
	theme.set_stylebox("panel","ScrollContainer",StyleBoxEmpty.new())
	var slider_line := box(Color("d9e0cf"),RULE,2)
	theme.set_stylebox("slider","HSlider",slider_line)
	for key: String in ["grabber_area","grabber_area_highlight"]:theme.set_stylebox(key,"HSlider",box(Color("647d5c"),Color("647d5c"),2))
	var slider_thumb := icon('<circle cx="8" cy="8" r="6.5" fill="#f4f3e9" stroke="#31583f" stroke-width="2.5"/>')
	for key: String in ["grabber","grabber_highlight","grabber_disabled"]:theme.set_icon(key,"HSlider",slider_thumb)
	theme.set_type_variation("RegisterHeading","PanelContainer")
	theme.set_stylebox("panel","RegisterHeading",box(BAND,RULE,5))
	theme.set_type_variation("UiSection","PanelContainer")
	theme.set_stylebox("panel","UiSection",box(FIELD,RULE,0))
	theme.set_type_variation("HeaderButton","Button")
	theme.set_stylebox("normal","HeaderButton",box(Color.TRANSPARENT,Color.TRANSPARENT,3))
	theme.set_stylebox("hover","HeaderButton",box(Color("cedcc2"),Color.TRANSPARENT,3))
	theme.set_type_variation("SectionHeading","Label")
	theme.set_font_size("font_size","SectionHeading",13)
	theme.set_type_variation("NavigationTab","Button")
	theme.set_stylebox("pressed","NavigationTab",pressed)
	theme.set_type_variation("PrimaryButton","Button")
	for state: String in ["normal","hover","pressed","hover_pressed"]:
		theme.set_stylebox(state,"PrimaryButton",box(Color("31583f") if state=="normal" else Color("24482f"),Color("25462e"),7))
	for key: String in ["font_color","font_hover_color","font_pressed_color","font_hover_pressed_color","font_focus_color"]:theme.set_color(key,"PrimaryButton",Color("fffef7"))
	theme.set_stylebox("disabled","PrimaryButton",disabled)
	theme.set_color("font_disabled_color","PrimaryButton",SECONDARY)
	var primary_focus := box(Color.TRANSPARENT,Color("8a783d"),0)
	primary_focus.set_border_width_all(2)
	theme.set_stylebox("focus","PrimaryButton",primary_focus)
	var window_border: StyleBoxFlat=ThemeDB.get_default_theme().get_stylebox("embedded_border","Window").duplicate()
	window_border.bg_color=Color("344f40");window_border.border_color=Color("344f40")
	theme.set_stylebox("embedded_border","Window",window_border)
	theme.set_stylebox("embedded_unfocused_border","Window",window_border)
	theme.set_color("title_color","Window",Color("fffef7"))
	theme.set_font_size("title_font_size","Window",14)
	theme.set_stylebox("panel","TooltipPanel",box(FIELD,RULE,8))
	theme.set_color("font_color","TooltipLabel",INK)
	theme.set_color("font_shadow_color","TooltipLabel",Color.TRANSPARENT)
	return theme
