extends SceneTree
## Production electrical records and route input, with no service or private save.
const UI=preload("res://scripts/game_ui.gd")
const Electrical=preload("res://scripts/electrical_ui.gd")
class MainHarness:
	extends "res://scripts/main.gd"
	func _ready()->void:
		set_process(false);set_process_input(false);set_process_unhandled_input(false)
class WorldStub:
	extends Node3D
	func preview(_value:Dictionary,_valid:bool)->void:pass
	func set_selected(_id:String)->void:pass
class ClientSpy:
	extends Node
	var messages:Array[Dictionary]=[]
	func send(action:String,args:Dictionary={})->int:
		messages.append({"action":action,"args":args.duplicate(true)})
		return messages.size()
var failures:Array[String]=[]
var checks:int=0
var actions:Array[Dictionary]=[]
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _text(node:Node)->String:
	var result:String=str(node.text) if node is Label or node is RichTextLabel else ""
	for child:Node in node.get_children():result+="\n"+_text(child)
	return result
func _button(node:Node,text:String)->Button:
	if node is Button and node.text==text:return node
	for child:Node in node.get_children():
		var found:Button=_button(child,text)
		if found:return found
	return null
func _press(node:Node,text:String)->void:
	var button:Button=_button(node,text);_check(button!=null,"Control exists: "+text)
	if button:button.pressed.emit()
func _choose(option:OptionButton,id:String)->void:
	for i:int in option.item_count:
		if option.get_item_metadata(i)==id:option.select(i);option.item_selected.emit(i);return
func _building(id:String,kind:String,x:int,z:int)->Dictionary:
	return {"id":id,"kind":kind,"x":x,"z":z,"w":1,"d":1,"rotation":0,"connected":true}
func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var source:Dictionary=_building("BLD-1001","power",20,20)
	source.merge({"capacityKw":16,"demandKw":.1,"availableKw":15.9,"energized":true})
	var lamp:Dictionary=_building("BLD-1002","lamp",30,24)
	lamp.merge({"ratedKw":.1,"loadKw":.1,"connected":true,"powered":true,"sourceId":"BLD-1001","rootSourceId":"BLD-1001","runIds":["ELEC-1001"],"availableKw":15.9})
	var pump:Dictionary=_building("BLD-1003","transferPump",38,28)
	pump.merge({"ratedKw":2,"loadKw":0,"connected":false,"powered":false,"runIds":[],"reason":"No commissioned underground circuit"})
	fixture.state.buildings=[source,lamp,pump]
	fixture.state.stacks=[{"id":"STK-1001","item":"cableReel","qty":1,"reserved":0,"x":42,"z":30,"w":1,"d":1,"cableMeters":37,"cableReservedMeters":8}]
	var run:Dictionary={"id":"ELEC-1001","sourceId":"BLD-1001","targetId":"BLD-1002","jobId":"JOB-1001","status":"working","phase":"dig","reason":"Waiting for excavator approach","workerId":"WRK-1001","operatorId":"WRK-1002","equipmentId":"EQ-1001","reelId":"STK-1001","cells":[{"x":21,"z":20,"excavation":1,"backfilled":0,"spoilM3":.36,"cableInstalled":true}],"cableInHand":1}
	fixture.electrical={"sources":[source],"junctions":[lamp],"consumers":[lamp,pump],"runs":[run]}
	fixture.state.electrical={"runs":[run],"meterLedger":[{"id":"CABLE-1001","runId":"ELEC-1001","time":8,"from":"STK-1001","to":"WRK-1001","meters":1,"reason":"Withdraw cable"}]}
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});ui.show_tab("Electrical")
	ui.toast.show();ui.latest_notice="NTE-OLD";fixture.state.notices=[];ui.update_snapshot(fixture)
	_check(not ui.toast.visible,"Replacing the yard with no active notices hides a stale previous-yard toast")
	await process_frame
	_check(ui.tables.size()==5,"Electrical has dense stations, junctions, consumers, runs and real cable ledger")
	_check(ui.tables[0].rows.size()==1 and ui.tables[1].rows.size()==1 and ui.tables[2].rows.size()==2,"Station and inherited junction supply are separate")
	_check(float(ui.tables[2].rows[1].cells[2])==2 and float(ui.tables[2].rows[1].cells[3])==0,"Idle pump still displays its 2 kW rated requirement")
	_check(ui.tables[4].rows.size()==1,"Bounded cable meter ledger is read from saved electrical state")
	var row:TreeItem=ui.tables[3].tree.get_root().get_first_child();row.select(0);ui.tables[3]._selected()
	_check(ui.selected_id=="ELEC-1001","Route IDs are clickable despite their new prefix")
	_check(_text(ui.inspector_body).contains("0.360 m³") and _text(ui.inspector_body).contains("EQ-1001"),"Run inspector shows actual spoil and assigned machine")
	_press(ui.inspector_body,"Cancel remaining circuit work")
	_check(actions.back()=={"action":"electrical_cancel","args":{"id":"ELEC-1001"}},"Cancel targets actual route")
	run.status="canceled";ui.show_entity(run.id);_press(ui.inspector_body,"Resume canceled circuit")
	_check(actions.back().action=="electrical_resume","Canceled route resumes explicitly")
	run.status="commissioned";ui.show_entity(run.id);_press(ui.inspector_body,"Recover installed circuit")
	_check(actions.back().action=="electrical_recover","Commissioned route offers physical recovery")
	run.recovering=true;run.status="working";ui.show_entity(run.id)
	_check(_button(ui.inspector_body,"Cancel recovery safely")!=null,"Active physical recovery can be canceled safely")
	run.status="canceled";ui.show_entity(run.id)
	_check(_button(ui.inspector_body,"Recover installed circuit")!=null and _button(ui.inspector_body,"Resume canceled circuit")==null,"Stopped partial recovery offers recovery again rather than reinstalling cable")
	run.cells[0].cableInstalled=false;ui.show_entity(run.id)
	_check(_button(ui.inspector_body,"Recover installed circuit")==null and _button(ui.inspector_body,"Resume canceled circuit")==null,"Fully recovered circuit cannot recover or resume again")
	run.erase("recovering");run.cells[0].cableInstalled=true;run.status="commissioned";run.opening=true;run.jobId="opening"
	ui.show_entity(run.id);_check(_text(ui.inspector_body).contains("Opening assets"),"Explicit opening circuits do not pretend to have a construction job")
	run.erase("opening");run.jobId="JOB-1001"
	ui.show_tab("Electrical");_check(ui.tables[3].rows.is_empty(),"Active default excludes commissioned circuits")
	ui.record_status.select(2);ui._refresh_register();_check(ui.tables[3].rows.size()==1,"Done filter includes commissioned circuits")
	ui.electrical_ui.plan_dialog(ui)
	_check(ui.electrical_ui.plan_window.visible and ui.electrical_ui.draw_button.disabled,"Plan dialog opens visibly with no implicit source or consumer")
	_check(ui.electrical_ui.source_choice.item_count==3,"Source picker includes commissioned light-base junctions")
	_choose(ui.electrical_ui.source_choice,"BLD-1002");_choose(ui.electrical_ui.target_choice,"BLD-1003")
	_check(not ui.electrical_ui.draw_button.disabled,"Explicit source and consumer enables route drawing")
	ui.electrical_ui.draw_button.pressed.emit()
	_check(actions.back()=={"action":"electrical_draw","args":{"sourceId":"BLD-1002","targetId":"BLD-1003"}},"Draw command retains chosen branch junction and consumer")
	await process_frame
	Electrical.station_dialog(ui)
	_check(_button(ui,"Inspect existing station")!=null and _button(ui,"Order station service")==null,"Existing incoming station is inspected rather than ordered twice")
	_press(ui,"Inspect existing station");await process_frame
	fixture.state.buildings.remove_at(0);fixture.electrical.sources=[];ui.update_snapshot(fixture)
	Electrical.station_dialog(ui)
	_press(ui,"Order station service")
	_check(actions.back()=={"action":"purchase","args":{"item":"power","qty":1,"mode":"road"}},"Utility station uses the real purchase service command")
	await process_frame
	_check(ui.catalog.cableReel.mass==185 and ui.catalog.cableReel.price==600,"Native catalog exposes delivered 185 kg 50 m reel")
	ui.show_entity("STK-1001")
	_check(_text(ui.inspector_body).contains("37.0") and _text(ui.inspector_body).contains("8.0"),"Partial reel and reservations stay inspectable")
	ui.show_entity("BLD-1002");_check(_button(ui.inspector_body,"Extend cable from this light base…")!=null,"Wired lamp inspector exposes explicit extension")
	var guide:String=" ".join(Electrical.help_paragraphs())
	_check(guide.contains("site engineer") and guide.contains("junction") and guide.contains("spoil") and guide.contains("does not share trenches"),"Guide explains real crew, inherited capacity and trench constraints")
	var game:=MainHarness.new();root.add_child(game);game.ui=ui;game.state=fixture.state
	game.world=WorldStub.new();game.add_child(game.world);game.client=ClientSpy.new();game.add_child(game.client)
	game.add_child(game.camera);game.add_child(game.sun);game.add_child(game.moon)
	ui.tool_selected.connect(game._select_tool)
	game._command("electrical_draw",{"sourceId":"BLD-1002","targetId":"BLD-1003"})
	_check(game.tool=="cable" and ui.active_tab=="Yard","Draw switches into actual Yard cable tool")
	_check(not game.cable_preview_material.no_depth_test and game.cable_preview_mesh.cast_shadow==GeometryInstance3D.SHADOW_CASTING_SETTING_OFF,"Preview is depth-tested and casts no false shadow")
	_check(game.cable_preview_node.get_child_count()==11,"Both endpoint footprints have outside terminal markers and labels")
	game._cable_click(true,Vector3(0,0,0),Vector2.ZERO)
	_check(game.cable_anchor.is_empty(),"Route cannot begin at unrelated ground")
	var start:=Vector3(31.5,0,24.5);var finish:=Vector3(37.5,0,28.5)
	game._cable_click(true,start,Vector2(20,20));game._cable_click(false,start,Vector2(20,20))
	_check(not game.cable_anchor.is_empty() and game.cable_plan_request==0,"First click selects source without prematurely planning")
	game._update_cable_preview(finish);var first:Array[Dictionary]=game.cable_cells.duplicate(true)
	game._rotate_placement();_check(game.cable_cells!=first,"R changes the Manhattan elbow without diagonal cells")
	var contiguous:bool=true
	for i:int in range(1,game.cable_cells.size()):
		var a:Dictionary=game.cable_cells[i-1];var b:Dictionary=game.cable_cells[i]
		if absi(int(a.x)-int(b.x))+absi(int(a.z)-int(b.z))!=1:contiguous=false
	_check(contiguous,"Every submitted cable cell is edge-contiguous")
	game._request_cable_preview();var request:int=game.cable_preview_request
	game._reply({"id":request,"action":"electrical_preview","ok":true,"result":{"valid":false,"error":"Another circuit reserves this cell; shared ducts are not supported"}})
	_check(ui.electrical_tool_hint.contains("shared ducts"),"Authoritative invalid reason appears directly in the tool hint")
	var before:int=game.client.messages.size();game._finish_cable(finish)
	_check(game.client.messages.size()==before,"Checked invalid route cannot submit work")
	game._reply({"id":request,"action":"electrical_preview","ok":true,"result":{"valid":true}})
	game._finish_cable(finish)
	_check(game.client.messages.back().action=="electrical_plan" and game.client.messages.back().args.sourceId=="BLD-1002" and game.client.messages.back().args.targetId=="BLD-1003","Plan names physical branch source and consumer")
	_check(game.client.messages.back().args.cells==game.cable_cells,"Plan submits real explicit meter cells")
	var escape:=InputEventKey.new();escape.pressed=true;escape.keycode=KEY_ESCAPE
	game._unhandled_input(escape)
	_check(ui.active_tool=="select" and game.tool=="select","Escape keeps Yard tool controls and actual tool synchronized")
	_check(ui.status_label.clip_text,"Detailed route guidance cannot force the whole game wider than its viewport")
	_check(game.cable_preview_node==null and game.cable_cells.is_empty(),"Leaving cable tool removes temporary geometry and reserved UI state")
	_check(not ui.status_label.text.contains("Click a blue"),"Leaving cable tool clears obsolete instructions")
	game.queue_free();ui.queue_free();await process_frame;await process_frame
	print("ELECTRICAL_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
