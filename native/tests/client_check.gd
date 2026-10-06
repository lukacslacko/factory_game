extends SceneTree
const Client=preload("res://scripts/runtime_client.gd")
var client: Node
var snapshots: int = 0
var replies: Dictionary = {}
var last_state: Dictionary = {}

func _initialize() -> void:
	client=Client.new()
	root.add_child(client)
	client.snapshot_received.connect(func(message: Dictionary): snapshots+=1; last_state=message.state)
	client.reply_received.connect(func(message: Dictionary): replies[int(message.id)]=message)
	client.connection_changed.connect(func(connected: bool,text: String): print("CLIENT_CHECK_CONNECTION ",connected," ",text))
	client.start()
	_run.call_deferred()

func _wait_reply(id: int) -> Dictionary:
	var deadline: int=Time.get_ticks_msec()+10000
	while not replies.has(id) and Time.get_ticks_msec()<deadline:
		await process_frame
	return replies.get(id,{"ok":false,"error":"timeout"})

func _run() -> void:
	var deadline: int=Time.get_ticks_msec()+15000
	while snapshots==0 and Time.get_ticks_msec()<deadline:
		await process_frame
	if snapshots==0:
		push_error("No authenticated simulation snapshot")
		client.close(); quit(1); return
	var result: Dictionary=await _wait_reply(client.send("new_game",{"mode":"example"}))
	if not result.get("ok",false):
		push_error("Example failed: "+str(result)); client.close(); quit(1); return
	await create_timer(0.7).timeout
	if last_state.get("equipment",[]).size()!=2:
		push_error("Snapshot missing the example machines"); client.close(); quit(1); return
	result=await _wait_reply(client.send("save"))
	if not result.get("ok",false):
		push_error("Save failed"); client.close(); quit(1); return
	print("CLIENT_CHECK_COMPLETE snapshots=",snapshots," equipment=",last_state.equipment.size())
	await _wait_reply(client.send("shutdown"))
	quit()
