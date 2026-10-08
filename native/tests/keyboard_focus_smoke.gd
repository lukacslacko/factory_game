extends SceneTree
## Exercise production camera polling against actual UI focus and a separate popup viewport.
## Headless display servers have no physical keyboard layout, so inject only the held-key state.
class MainHarness:
	extends "res://scripts/main.gd"
	var held_key: Key = KEY_NONE
	func _camera_key_pressed(key: Key) -> bool: return key == held_key
	func _ready() -> void:
		set_process(false)
		set_process_input(false)
		set_process_unhandled_input(false)
class FakeWorld:
	extends Node3D
	func advance(_dt: float) -> void: pass
	func set_grid(_enabled: bool) -> void: pass
	func set_lamp_amount(_amount: float) -> void: pass
	func preview(_rect: Dictionary, _valid: bool) -> void: pass
class FakeClient:
	extends Node
	var sent: Array = []
	func send(action: String, args: Dictionary) -> int:
		sent.append({"action":action,"args":args})
		return sent.size()
var game: MainHarness
var checks: int = 0
var failures: Array[String] = []
func _initialize() -> void: _run.call_deferred()
func _check(value: bool, message: String) -> void:
	checks += 1
	if not value: failures.append(message)
func _key(key: Key, pressed: bool) -> InputEventKey:
	var event := InputEventKey.new()
	event.keycode = key
	event.physical_keycode = key
	event.pressed = pressed
	return event
func _hold(key: Key) -> void:
	game.backgrounded = false
	game.held_key = key
	game._process(1.0/60.0)
	game.held_key = KEY_NONE
func _stationary(message: String) -> void:
	var target: Vector3 = game.target
	var yaw: float = game.yaw
	var stationary := true
	for key: Key in [KEY_W,KEY_A,KEY_S,KEY_D,KEY_Q,KEY_E]:
		_hold(key)
		if not game.target.is_equal_approx(target) or not is_equal_approx(game.yaw,yaw): stationary = false
	_check(stationary,message)
func _find_line(node: Node) -> LineEdit:
	if node is LineEdit: return node
	for child in node.get_children():
		var found := _find_line(child)
		if found: return found
	return null
func _run() -> void:
	root.gui_embed_subwindows = true
	root.size = Vector2i(1440,810)
	game = MainHarness.new(); root.add_child(game)
	game.world = FakeWorld.new(); game.add_child(game.world)
	game.client = FakeClient.new(); game.add_child(game.client)
	game.ui = game.GameUI.new(); game.add_child(game.ui); game.ui.setup()
	game.ui.set_process(false)
	game.ui.receive_reply({"action":"new_game","ok":true})
	game.add_child(game.camera); game.camera.current=true
	game.add_child(game.sun)
	game.add_child(game.moon)
	game._update_camera(0,true)
	game.backgrounded = false
	await process_frame
	var initial: Vector3 = game.target
	_hold(KEY_W)
	_check(not game.target.is_equal_approx(initial),"W pans the yard when no editor or dialog owns keyboard input")

	var line := LineEdit.new(); game.ui.screen.add_child(line); line.grab_focus()
	await process_frame
	_check(root.gui_get_focus_owner()==line,"Ordinary LineEdit owns root viewport focus")
	_stationary("WASD and Q/E do not move the view in a root LineEdit")
	line.release_focus(); line.queue_free(); await process_frame
	var text := TextEdit.new(); game.ui.screen.add_child(text); text.grab_focus()
	await process_frame
	_check(root.gui_get_focus_owner()==text,"Ordinary TextEdit owns root viewport focus")
	_stationary("WASD and Q/E do not move the view in a TextEdit such as SQL")
	text.release_focus(); text.queue_free(); await process_frame

	game.ui._rail_location_form({"id":"BOOTSTRAP-SIDING","name":"Rail location"})
	var form: Window
	for window in game.ui.find_children("*","Window",true,false):
		if window.title=="Named railway location": form=window
	_check(form!=null and form.visible,"Actual railway naming dialog is open")
	if form:
		var name := _find_line(form); name.grab_focus(); await process_frame
		_check(form.gui_get_focus_owner()==name,"Name editor owns the dialog's separate viewport focus")
		_check(root.gui_get_focus_owner()!=name,"Regression exercises focus invisible to the root viewport")
		_stationary("Typing WASD and Q/E in a rail-location popup leaves the view stationary")
		var old_grid: bool = game.grid
		var old_rotation: int = game.placement_rotation
		var before: int = game.client.sent.size()
		for key: Key in [KEY_G,KEY_R,KEY_SPACE,KEY_1,KEY_2,KEY_3]:
			game._unhandled_input(_key(key,true))
		_check(game.grid==old_grid and game.placement_rotation==old_rotation and game.client.sent.size()==before,"Dialog typing cannot trigger game shortcuts or simulation commands")
		name.release_focus()
		_stationary("An open modal dialog continues to block camera keys when its editor loses focus")
		form.queue_free(); await process_frame
	initial = game.target
	_hold(KEY_D)
	_check(not game.target.is_equal_approx(initial),"Camera keyboard controls resume after closing the dialog")
	game._unhandled_input(_key(KEY_SPACE,true))
	_check(game.client.sent.back().action=="pause","Game shortcuts resume after closing the dialog")
	game.queue_free();await process_frame
	print("KEYBOARD_FOCUS_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"serviceStarted":false,"gpuRendering":false}))
	quit(0 if failures.is_empty() else 1)
