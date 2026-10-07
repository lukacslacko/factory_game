extends SceneTree
## Isolated audio playback graph and synthetic render inputs, using the real WAV bank.
## This runs with --audio-driver Dummy; it never opens or replaces player saves.
const Audio=preload("res://scripts/game_audio.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _count(audio:Node,sound:String,loop:bool=false)->int:
	var count:int=0
	for played:Dictionary in audio.get_status().played:
		if str(played.sound)==sound and bool(played.loop)==loop:count+=1
	return count
func _fixture()->Dictionary:
	return {"state":{"paused":false,"elapsed":100.,"next":100,"equipment":[{"id":"EQ1","x":3,"z":4},{"id":"EQ2","x":5,"z":6}],"workers":[{"id":"WK1","x":2,"z":3}],"orders":[],"shunters":[],"buildings":[{"id":"PUMP","x":6,"z":7,"w":2,"d":2}],"stacks":[],"actionClearances":[],"events":[{"id":"EV-OLD","type":"Work","entity":"BLD1","text":"Office complete"}],"notices":[{"id":"N-OLD","title":"Delivery received"}],"movements":[{"id":"MV-OLD","to":"STK1","reason":"Slab set on runners"}]},"render":{"actors":[{"id":"EQ1","kind":"excavator","x":3.,"z":4.,"operator":"WK2","velocity":1.,"walking":true},{"id":"EQ2","kind":"forklift","x":5.,"z":6.,"operator":"WK3","velocity":1.,"walking":true},{"id":"WK1","kind":"worker","x":2.,"z":3.,"walking":true,"travel":0.}],"carriers":[{"id":"TRUCK","kind":"truck","x":10.,"z":0.},{"id":"BUS","kind":"bus","x":12.,"z":0.}],"railShunters":[{"id":"SH1","phase":"moving","driverId":"WK4","x":13.,"z":0.,"move":{"velocity":1.}}],"processRows":[{"id":"PUMP","kind":"transferPump","running":true,"flow":3.}]}}
func _run()->void:
	var directory:String="/tmp/plant01-audio-smoke-%d"%OS.get_process_id()
	var audio:=Audio.new();root.add_child(audio);audio.setup(directory)
	var settings_errors:Array[String]=[];audio.settings_error.connect(func(text:String)->void:settings_errors.append(text))
	_check(audio.get_status().voices==12,"Exactly12 spatial audio players are allocated")
	_check(audio.get_status().sounds==17 and audio.get_status().missing.is_empty(),"All17 original PCM16 sounds load without imported resource caches")
	var manifest:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://assets/audio/provenance.json"))
	_check(str(manifest.license)=="MIT" and str(manifest.origin).contains("no external"),"Audio bank records original MIT provenance")
	for sound:String in manifest.sounds:
		var bytes:PackedByteArray=FileAccess.get_file_as_bytes("res://assets/audio/"+str(manifest.sounds[sound].file))
		var hash:=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes)
		_check(hash.finish().hex_encode()==str(manifest.sounds[sound].sha256),sound+" matches its deterministic provenance hash")
		_check(bytes.decode_u32(24)==22050 and bytes.decode_u16(22)==1 and bytes.decode_u16(34)==16,sound+" is bounded mono PCM16 at22050Hz")
	var fixture:Dictionary=_fixture();audio.sync_snapshot(fixture);audio.advance(.3,Vector3.ZERO)
	_check(audio.get_status().loops.size()==6,"Actual active machines, road vehicles, shunter and flowing pump have distinct loops")
	_check(audio.get_status().oneshots==0,"First snapshot does not replay historic work, delivery or setdown events")
	for sound:String in ["engine-excavator","engine-forklift","engine-truck","engine-bus","engine-shunter","engine-pump"]:
		_check(_count(audio,sound,true)==1,sound+" starts from its actual physical actor")
	audio.sync_snapshot(fixture);audio.advance(.3,Vector3.ZERO)
	_check(_count(audio,"engine-excavator",true)==1,"Repeated identical snapshots keep the engine loop instead of restarting")
	fixture.render.actors[2].travel=1.1;fixture.state.elapsed=100.1;audio.sync_snapshot(fixture);audio.advance(.1,Vector3.ZERO)
	_check(_count(audio,"footstep-a")+_count(audio,"footstep-b")==1,"A walking worker's actual traveled distance produces a boot step")
	fixture.render.actors[0].refueling="JOB-FUEL"
	audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check("EQ1/engine-excavator" in audio.get_status().loops,"Refueling travel still runs the actual moving diesel engine")
	fixture.render.actors[0].walking=false;fixture.render.actors[0].velocity=0.
	audio.sync_snapshot(fixture);audio.advance(.6,Vector3.ZERO);audio.advance(.1,Vector3.ZERO)
	_check("EQ1/engine-excavator" not in audio.get_status().loops,"Stationary filling or pouring has its machine engine stopped")
	fixture.render.actors[0].erase("refueling");fixture.render.actors[0].walking=true;fixture.render.actors[0].velocity=1.
	audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	fixture.render.actors[2].walking=false;fixture.render.actors[2].fuelCan={"phase":"fill","liters":0.}
	audio.sync_snapshot(fixture);audio.advance(.3,Vector3.ZERO)
	_check(_count(audio,"can-fill",true)==1,"Filling an initially empty service can sounds only in the real fill phase")
	fixture.render.actors[2].fuelCan={"phase":"pour","liters":11.}
	audio.sync_snapshot(fixture);audio.advance(.5,Vector3.ZERO);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"can-pour",true)==1,"The separate pouring phase uses its physical can sound")
	fixture.render.actors[0].blockedBy="WK1";audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"honk")==0,"A blockedBy field alone cannot invent a horn request")
	fixture.state.actionClearances=[{"ownerId":"JOB1","requesterEquipmentId":"EQ1","blockerIds":["WK1"],"point":{"x":3.,"z":4.}}]
	audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"honk")==1,"A new targeted clearance request makes one local horn sound")
	for i:int in range(8):audio.sync_snapshot(fixture);audio.advance(.1,Vector3.ZERO)
	_check(_count(audio,"honk")==1,"An unchanged clearance cannot honk every snapshot")
	fixture.state.actionClearances[0].blockerIds=["WK2"];audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"honk")==1,"The same vehicle's horn respects its14-second real-time cooldown")
	audio.advance(15.,Vector3.ZERO);fixture.state.actionClearances[0].blockerIds=["WK3"]
	audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"honk")==2,"A later distinct targeted request can honk after the cooldown")
	fixture.state.notices.push_front({"id":"N-WARN","title":"Action blocked","severity":"warning"});audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"warning")==1,"A new durable warning has a soft notification rather than a repeated horn")
	audio.set_setting("vehicles",0.)
	audio.advance(.6,Vector3.ZERO);audio.advance(.1,Vector3.ZERO)
	var vehicle_loop:bool=false
	for key:String in audio.get_status().loops:
		if key.contains("engine-") and not key.contains("engine-pump"):vehicle_loop=true
	_check(not vehicle_loop,"Category mute frees engine loop slots for work sounds")
	audio.set_setting("vehicles",.7)
	fixture.state.paused=true;audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(audio.get_status().loops.is_empty(),"Pause stops engines, pump and physical work immediately")
	fixture.state.paused=false;audio.sync_snapshot(fixture);audio.advance(.3,Vector3.ZERO)
	audio.set_backgrounded(true);audio.advance(.2,Vector3.ZERO)
	_check(audio.get_status().loops.is_empty() and audio.get_status().oneshots==0,"Default background policy silences every voice while simulation can continue")
	fixture.state.notices.push_front({"id":"N-BACKGROUND","title":"Delivery approaching"});audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	audio.set_backgrounded(false);audio.advance(.3,Vector3.ZERO)
	_check(_count(audio,"delivery")==0,"Returning to the window does not replay muted background notifications")
	audio.set_setting("muted",true);audio.set_setting("master",.37);audio.advance(.1,Vector3.ZERO)
	_check(audio.get_status().loops.is_empty() and audio.get_status().oneshots==0,"Master mute stops all pooled players")
	var restored:=Audio.new();root.add_child(restored);restored.setup(directory)
	_check(bool(restored.get_settings().muted) and absf(float(restored.get_settings().master)-.37)<.001,"Audio settings persist only in the supplied isolated data directory")
	restored.queue_free();await process_frame
	audio.set_setting("muted",false);audio.set_setting("master",2.0)
	_check(float(audio.get_settings().master)==1.0,"Volume settings clamp to their supported range")
	audio.set_setting("master",.6)
	for index:int in range(400):
		fixture.render.actors[0].id="EQ-STRESS-%d"%index;fixture.state.next=100+index;fixture.state.elapsed=101.+index*.1
		fixture.render.carriers[0].id="TRUCK-STRESS-%d"%index
		fixture.state.events.append({"id":"EV-STRESS-%d"%index,"type":"Planning","text":"Plan"})
		fixture.state.notices.push_front({"id":"N-STRESS-%d"%index,"title":"Plan"})
		fixture.state.movements.append({"id":"MV-STRESS-%d"%index,"reason":"Collected"})
		audio.sync_snapshot(fixture);audio.advance(.03,Vector3.ZERO)
	var status:Dictionary=audio.get_status()
	_check(status.voices==12 and status.loops.size()<=8 and status.oneshots<=4,"Long changing-actor runs retain the fixed8-loop/4-one-shot pool")
	for key:String in status.metadata:_check(int(status.metadata[key])<=256,"Diagnostic metadata "+key+" stays bounded")
	fixture.state.elapsed=0;fixture.state.next=1;fixture.state.events=[{"id":"EV-IMPORT","type":"Work","text":"Office complete"}]
	fixture.state.notices=[{"id":"N-IMPORT","title":"Delivery received"}]
	var completed_before:int=_count(audio,"complete");audio.sync_snapshot(fixture);audio.advance(.3,Vector3.ZERO)
	_check(_count(audio,"complete")==completed_before,"Importing another save establishes a new silent history baseline")
	fixture.state.elapsed=99999.;fixture.state.next=999999
	fixture.state.events=[{"id":"EV-LARGER-IMPORT","type":"Work","text":"Shed complete"}]
	fixture.state.notices=[{"id":"N-LARGER-IMPORT","title":"Delivery received"}]
	var delivery_before:int=_count(audio,"delivery");completed_before=_count(audio,"complete")
	audio.reset_history();audio.sync_snapshot(fixture);audio.advance(.3,Vector3.ZERO)
	_check(_count(audio,"complete")==completed_before and _count(audio,"delivery")==delivery_before,"Explicit import reset suppresses historical sounds even for larger elapsed and ID counters")
	audio.advance(2.,Vector3.ZERO)
	fixture.state.notices.push_front({"id":"N-COLLECTION","title":"Collection truck approaching"})
	audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"delivery")==delivery_before+1,"An actual outbound carrier arrival uses the delivery notification cue")
	audio.sync_snapshot(fixture);audio.advance(.2,Vector3.ZERO)
	_check(_count(audio,"delivery")==delivery_before+1,"Repeating the same collection arrival does not replay its sound")
	root.gui_embed_subwindows=true;audio.show_settings();await process_frame
	var slider_count:int=audio.find_children("*","HSlider",true,false).size()
	var checkbox_count:int=audio.find_children("*","CheckBox",true,false).size()
	_check(slider_count==4 and checkbox_count==2,"Sound dialog exposes master, three categories, mute and background policy")
	_check(settings_errors.is_empty(),"Persisted controls report no storage failure")
	audio.queue_free();await process_frame
	# Dummy playback is mixed on its own clock. Uncapped headless frames can
	# finish before it releases stopped playback references; drain that cycle.
	await create_timer(.15).timeout
	print("AUDIO_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures,"voices":12,"originalSounds":17,"fixtureOnly":true,"dataDirectory":directory}))
	quit(0 if failures.is_empty() else 1)
