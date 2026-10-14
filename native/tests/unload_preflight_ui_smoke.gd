extends SceneTree
## Read-only delivery plan inspection without a service, save, or player yard.
const UI=preload("res://scripts/game_ui.gd")
var failures:Array[String]=[]
var checks:int=0
var actions:Array[Dictionary]=[]

func _initialize()->void:_run.call_deferred()
func _check(ok:bool,label:String)->void:
	checks+=1
	if not ok:failures.append(label)
func _button(node:Node,title:String)->Button:
	if node is Button and node.text==title:return node
	for child:Node in node.get_children():
		var found:Button=_button(child,title)
		if found:return found
	return null
func _text(node:Node)->String:
	var result:String=str(node.text) if node is Label or node is RichTextLabel else ""
	for child:Node in node.get_children():result+="\n"+_text(child)
	return result

func _run()->void:
	root.size=Vector2i(1440,810);root.gui_embed_subwindows=true
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	fixture.state.orders=[{"id":"PO-1001","item":"slab","qty":2,"arrived":0,"mode":"road","status":"unloading","eta":0,"total":166,"note":"At receiving","manifest":[{"item":"slab","qty":2,"arrived":0}]},{"id":"PO-1002","item":"rail","qty":1,"arrived":0,"mode":"rail","status":"unloading","eta":0,"total":1020,"note":"At siding","manifest":[{"item":"rail","qty":1,"arrived":0}],"railFreight":{"unloadRequested":false,"storageZoneId":"ZONE-1001","detached":true,"locomotivePhase":"gone","cars":[{"id":"CAR-1001","kind":"flatcar","manifest":[{"item":"rail","qty":1,"arrived":0}],"mass":1450,"length":11,"handbrake":true}]}}]
	fixture.state.zones=[{"id":"ZONE-1001","name":"Receiving yard","x":24,"z":26,"w":20,"d":15}]
	var ui:=UI.new();root.add_child(ui);ui.setup();ui.set_process(false)
	ui.command.connect(func(action:String,args:Dictionary)->void:actions.append({"action":action,"args":args.duplicate(true)}))
	ui.update_snapshot(fixture);ui.receive_reply({"action":"continue","ok":true});await process_frame
	ui.show_entity("PO-1001")
	var road:Button=_button(ui.inspector_body,"Check unloading plan")
	_check(road!=null,"Arrived road freight has an explicit physical plan check")
	if road:road.pressed.emit()
	_check(actions.size()==1 and actions[0].action=="unload_preflight" and actions[0].args.orderId=="PO-1001" and ui.unload_preflight_pending,"Road check sends one read-only request")
	ui.receive_reply({"action":"unload_preflight","ok":true,"result":{"orderId":"PO-1001","feasible":false,"reason":"Loaded final turn blocked by STK-1001","blockerId":"STK-1001"}})
	ui.show_entity("PO-1001")
	_check(_text(ui.inspector_body).contains("Not reachable at last check") and _text(ui.inspector_body).contains("Loaded final turn blocked by STK-1001"),"Physical failure and linked blocker appear in inspector")
	ui.show_entity("PO-1002")
	var rail:Button=_button(ui.inspector_body,"Check unloading plan")
	_check(rail!=null and not rail.disabled,"Selected rail cars can be checked before Start unloading")
	if rail:rail.pressed.emit()
	_check(actions.size()==2 and actions[1].action=="unload_preflight" and actions[1].args.orderId=="PO-1002" and actions[1].args.carIds==["CAR-1001"] and actions[1].args.storageZoneId=="ZONE-1001","Rail check includes selected car and stockyard")
	ui.receive_reply({"action":"unload_preflight","ok":true,"result":{"orderId":"PO-1002","feasible":true,"reason":"Next lift can be handled","item":"rail","quantity":1,"equipmentId":"EQ-1001","operatorId":"WRK-1001","destination":{"x":26,"z":28,"w":5,"d":3}}})
	ui.show_entity("PO-1002")
	_check(_text(ui.inspector_body).contains("Reachable at last check") and _text(ui.inspector_body).contains("EQ-1001"),"Verified next lift and chosen crew appear without dispatch")
	ui.receive_reply({"action":"unload_preflight","ok":true,"result":{"orderId":"PO-1002","feasible":false,"readiness":"unverified","reason":"Waiting for an available operator"}})
	ui.show_entity("PO-1002")
	_check(_text(ui.inspector_body).contains("Route not verified yet") and not _text(ui.inspector_body).contains("Not reachable at last check"),"Missing crew is labeled unverified rather than physically impossible")
	_check(actions.size()==2,"Preview replies do not start unloading or mutate the yard")
	ui.queue_free();await process_frame
	print("UNLOAD_PREFLIGHT_UI_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
