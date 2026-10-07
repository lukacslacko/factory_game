extends SceneTree
## Bounded GPU capture of the real review controls; no service, terrain or private save.
const UI=preload("res://scripts/game_ui.gd")
func _initialize()->void:_run.call_deferred()
func _run()->void:
	root.size=Vector2i(1440,866)
	var fixture:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://tests/renderer-fixtures.json")).empty.duplicate(true)
	var ui:=UI.new();root.add_child(ui);ui.setup()
	ui.update_snapshot(fixture);ui.receive_reply({"action":"new_game","ok":true})
	ui.show_tab("Railway")
	ui._rail_edit_review({"operation":"recover_rail","id":"RAIL-9001","scope":"assembly"})
	ui.receive_reply({"action":"rail_edit_preview","ok":true,"result":{
		"operation":"recover_rail","id":"RAIL-9001","scope":"assembly","mode":"physical","constraint":"","storageError":"",
		"materials":[{"item":"railCurve","qty":6,"unitMass":1520,"assetIds":["RAIL-9001","RAIL-9002","RAIL-9003","RAIL-9004","RAIL-9005","RAIL-9006"]},{"item":"bufferStop","qty":1,"unitMass":850,"assetIds":["BUFFER-9001"]}],
		"destinations":[{"assetId":"BUFFER-9001","item":"bufferStop","zoneId":"ZONE-0101","x":45,"z":25,"w":2,"d":2},{"assetId":"RAIL-9001","item":"railCurve","zoneId":"ZONE-0101","x":48,"z":25,"w":6,"d":3}],
		"warnings":["An owned lifting machine rated for at least 1,520 kg is required.","Hire an equipment operator to drive the lifting machine.","Equipment and crew need a clear approach. Storage is chosen again at the physical lift; preview destinations are not reserved."],"pendingJobs":[]}})
	await process_frame
	await process_frame
	RenderingServer.force_draw()
	var image:Image=ui.rail_edit_window.get_texture().get_image()
	var directory:String=ProjectSettings.globalize_path("res://captures")
	DirAccess.make_dir_recursive_absolute(directory)
	var output:String=directory+"/rail-edit-review.png"
	var result:int=image.save_png(output)
	print("RAIL_EDIT_VISUAL_SMOKE ",JSON.stringify({"passed":result==OK,"output":output,"size":[image.get_width(),image.get_height()],"serviceStarted":false,"privateSaveRead":false}))
	ui.queue_free();await process_frame
	quit(0 if result==OK else 1)
