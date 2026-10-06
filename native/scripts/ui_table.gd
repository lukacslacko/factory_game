extends VBoxContainer

signal entity_clicked(id: String)
signal row_clicked(id: String)

var tree: Tree
var count_label: Label
var filter_row: HBoxContainer
var headers: Array[String] = []
var rows: Array[Dictionary] = []
var filters: Array[LineEdit] = []
var search: String = ""
var sort_column: int = -1
var descending: bool = false
var selected_id: String = ""
var page: int = 0
var page_size: int = 160
var refreshing: bool = false
var previous: Button
var next: Button
var references_menu: PopupMenu
var row_id_pattern: RegEx = RegEx.new()

func setup(column_names: Array[String], widths: Array[int] = []) -> void:
	headers = column_names
	row_id_pattern.compile("(?:WRK|EQ|STK|JOB|GRP|WORK|PO|ORD|BLD|ZONE|ZON|RAIL|LOC|EV|EVT|COST|CST|MV|MOV|N|NTC|NTE|AST|ASSET|BUFFER|CAR|RLOC|LOCO|SHUNTER|RETURN)-[0-9]+")
	add_theme_constant_override("separation",2)
	filter_row=HBoxContainer.new()
	filter_row.add_theme_constant_override("separation",2)
	add_child(filter_row)
	for i: int in range(headers.size()):
		var field: LineEdit = LineEdit.new()
		field.placeholder_text=headers[i]
		field.tooltip_text="Filter "+headers[i]
		field.custom_minimum_size.x=widths[i] if widths.size()>i else 82
		field.size_flags_horizontal=Control.SIZE_EXPAND_FILL
		field.text_changed.connect(func(_text: String) -> void: page=0; refresh())
		filter_row.add_child(field)
		filters.append(field)
	filter_row.visible=false
	tree=Tree.new()
	tree.columns=headers.size()
	tree.column_titles_visible=true
	tree.hide_root=true
	tree.select_mode=Tree.SELECT_SINGLE
	tree.size_flags_vertical=Control.SIZE_EXPAND_FILL
	tree.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	tree.custom_minimum_size.y=92
	for i: int in range(headers.size()):
		tree.set_column_title(i,headers[i])
		tree.set_column_custom_minimum_width(i,widths[i] if widths.size()>i else 88)
		tree.set_column_expand(i,true)
	tree.column_title_clicked.connect(_sort)
	tree.cell_selected.connect(_selected)
	tree.item_activated.connect(_activated)
	add_child(tree)
	references_menu=PopupMenu.new()
	references_menu.theme=theme
	references_menu.id_pressed.connect(func(index: int) -> void: entity_clicked.emit(str(references_menu.get_item_metadata(index))))
	add_child(references_menu)
	var footer: HBoxContainer = HBoxContainer.new()
	add_child(footer)
	count_label=Label.new()
	count_label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	footer.add_child(count_label)
	previous=Button.new()
	previous.text="‹ Previous"
	previous.pressed.connect(func() -> void: page=maxi(0,page-1); refresh())
	footer.add_child(previous)
	next=Button.new()
	next.text="Next ›"
	next.pressed.connect(func() -> void: page+=1; refresh())
	footer.add_child(next)

func set_rows(values: Array[Dictionary]) -> void:
	rows=values
	refresh()

func set_search(value: String) -> void:
	search=value.to_lower()
	page=0
	refresh()

func show_filters(value: bool) -> void:
	filter_row.visible=value

func _sort(column: int, _button: int) -> void:
	if sort_column==column:
		descending=not descending
	else:
		sort_column=column
		descending=false
	page=0
	refresh()

func refresh() -> void:
	if not is_instance_valid(tree): return
	refreshing=true
	var scroll_y: float = 0.0
	var scroll_x: float = 0.0
	for child: Node in tree.get_children(true):
		if child is VScrollBar: scroll_y=child.value
		if child is HScrollBar: scroll_x=child.value
	var visible_rows: Array[Dictionary] = []
	for row: Dictionary in rows:
		var cells: Array = row.get("cells",[])
		if not search.is_empty() and not JSON.stringify(cells).to_lower().contains(search): continue
		var matches: bool = true
		for i: int in range(filters.size()):
			if not filters[i].text.is_empty() and (i>=cells.size() or not str(cells[i]).to_lower().contains(filters[i].text.to_lower())):
				matches=false
				break
		if matches: visible_rows.append(row)
	if sort_column>=0:
		visible_rows.sort_custom(func(a: Dictionary,b: Dictionary) -> bool:
			var aa: Array = a.get("sort",a.get("cells",[]))
			var bb: Array = b.get("sort",b.get("cells",[]))
			var av: Variant = aa[sort_column] if aa.size()>sort_column else ""
			var bv: Variant = bb[sort_column] if bb.size()>sort_column else ""
			if (av is float or av is int) and (bv is float or bv is int): return float(av)>float(bv) if descending else float(av)<float(bv)
			return str(av).naturalnocasecmp_to(str(bv))>0 if descending else str(av).naturalnocasecmp_to(str(bv))<0)
	var maximum_page: int = maxi(0,int(ceil(float(visible_rows.size())/page_size))-1)
	page=mini(page,maximum_page)
	tree.clear()
	var root: TreeItem = tree.create_item()
	for index: int in range(page*page_size,mini((page+1)*page_size,visible_rows.size())):
		var row: Dictionary = visible_rows[index]
		var item: TreeItem = tree.create_item(root)
		var cells: Array = row.get("cells",[])
		for col: int in range(headers.size()):
			var value: String = str(cells[col]) if cells.size()>col else ""
			item.set_text(col,value)
			item.set_tooltip_text(col,value)
			var ref: String = str(row.get("refs",{}).get(str(col),""))
			if ref.is_empty():
				var hit: RegExMatch = row_id_pattern.search(value)
				if hit: ref=hit.get_string()
			var ids: Array[String] = []
			for hit: RegExMatch in row_id_pattern.search_all(value):
				if hit.get_string() not in ids: ids.append(hit.get_string())
			item.set_metadata(col,{"id":str(row.get("id","")),"ref":ref,"references":ids})
			if not ref.is_empty(): item.set_custom_color(col,Color("315c4f"))
			if value.to_lower().contains("warning") or value.to_lower().contains("blocked"):
				item.set_custom_color(col,Color("986324"))
		if str(row.get("id",""))==selected_id: item.select(0)
	for i: int in range(headers.size()):
		tree.set_column_title(i,headers[i]+(" ▼" if descending else " ▲") if i==sort_column else headers[i])
	count_label.text="%d matching / %d records · page %d/%d · click a header to sort; click an ID to inspect"%[visible_rows.size(),rows.size(),page+1,maximum_page+1]
	previous.disabled=page<=0
	next.disabled=page>=maximum_page
	for child: Node in tree.get_children(true):
		if child is VScrollBar: child.set_deferred("value",scroll_y)
		if child is HScrollBar: child.set_deferred("value",scroll_x)
	refreshing=false

func _selected() -> void:
	if refreshing: return
	var item: TreeItem = tree.get_selected()
	if not item: return
	var data: Dictionary = item.get_metadata(tree.get_selected_column()) as Dictionary
	selected_id=str(data.get("id",""))
	var ref: String = str(data.get("ref",""))
	if data.get("references",[]).size()>1:
		references_menu.clear()
		for id: String in data.references:
			references_menu.add_item("Inspect "+id)
			references_menu.set_item_metadata(references_menu.item_count-1,id)
		references_menu.position=Vector2i(get_viewport().get_mouse_position())
		references_menu.popup()
	elif not ref.is_empty(): entity_clicked.emit(ref)
	elif not selected_id.is_empty(): row_clicked.emit(selected_id)

func _activated() -> void:
	_selected()
