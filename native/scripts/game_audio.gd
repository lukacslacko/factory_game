extends Node3D
## Original procedural audio, driven by the same saved physical actors/work.
## All metadata, streams and players are bounded. Never advances simulation.
signal settings_changed(values:Dictionary)
signal settings_error(description:String)
const VOICES:int=12
const LOOP_VOICES:int=8
const RANGE:float=75.0
const BANK:Dictionary={"engine-excavator":true,"engine-forklift":true,"engine-truck":true,"engine-bus":true,"engine-shunter":true,"engine-pump":true,"can-fill":true,"can-pour":true,"footstep-a":false,"footstep-b":false,"ratchet":false,"hammer":false,"slab-setdown":false,"honk":false,"complete":false,"delivery":false,"warning":false}
const DEFAULTS:Dictionary={"master":.60,"vehicles":.70,"work":.70,"notifications":.65,"muted":false,"mute_background":true}
var _settings:Dictionary=DEFAULTS.duplicate()
var _directory:String=""
var _bank:Dictionary={}
var _missing:Array[String]=[]
var _players:Array[AudioStreamPlayer3D]=[]
var _voices:Array[Dictionary]=[]
var _listener:AudioListener3D
var _listener_position:=Vector3.ZERO
var _backgrounded:bool=false
var _paused:bool=true
var _primed:bool=false
var _clock:float=0.0
var _elapsed:float=0.0
var _last_next:int=0
var _state:Dictionary={}
var _render:Dictionary={}
var _desired:Array[Dictionary]=[]
var _shots:Array[Dictionary]=[]
var _seen_events:Dictionary={}
var _seen_notices:Dictionary={}
var _seen_movements:Dictionary={}
var _clearance_signatures:Dictionary={}
var _honk_times:Dictionary={}
var _cue_times:Dictionary={}
var _motion:Dictionary={}
var _steps:Dictionary={}
var _work_times:Dictionary={}
var _phase_signatures:Dictionary={}
var _played:Array[Dictionary]=[]
var _dropped:int=0
var _dialog:AcceptDialog

func setup(data_directory:String)->void:
	_directory=data_directory
	var config:=ConfigFile.new()
	if not _directory.is_empty() and config.load(_directory.path_join("audio.cfg"))==OK:
		for key:String in DEFAULTS:
			_settings[key]=_valid_setting(key,config.get_value("audio",key,DEFAULTS[key]))
	if _players.is_empty():
		_listener=AudioListener3D.new();add_child(_listener);_listener.make_current()
		for index:int in range(VOICES):
			var player:=AudioStreamPlayer3D.new();player.name="AudioVoice%d"%index
			player.max_polyphony=1;player.unit_size=4.0;player.max_distance=RANGE;player.max_db=0.0
			player.panning_strength=.75;player.doppler_tracking=AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
			add_child(player);_players.append(player);_voices.append({})
	_load_bank()

func _exit_tree()->void:
	# Detach streams explicitly before the players leave the tree. The audio
	# mixer releases stopped playback references on its next mixing cycle.
	_stop_all()
	for player:AudioStreamPlayer3D in _players:
		player.stream=null
	_bank.clear()

func _load_bank()->void:
	_bank.clear();_missing.clear()
	for sound:String in BANK:
		var path:String="res://assets/audio/"+sound+".wav"
		var bytes:PackedByteArray=FileAccess.get_file_as_bytes(path) if FileAccess.file_exists(path) else PackedByteArray()
		if bytes.size()<46 or bytes.slice(0,4).get_string_from_ascii()!="RIFF" or bytes.slice(8,12).get_string_from_ascii()!="WAVE" or bytes.decode_u16(20)!=1 or bytes.decode_u16(22)!=1 or bytes.decode_u16(34)!=16 or bytes.slice(36,40).get_string_from_ascii()!="data":
			_missing.append(sound);continue
		var stream:=AudioStreamWAV.new();stream.format=AudioStreamWAV.FORMAT_16_BITS
		stream.mix_rate=int(bytes.decode_u32(24));stream.stereo=false;stream.data=bytes.slice(44)
		if bool(BANK[sound]):
			stream.loop_mode=AudioStreamWAV.LOOP_FORWARD;stream.loop_begin=0;stream.loop_end=stream.data.size()/2
		_bank[sound]=stream

func _valid_setting(key:String,value:Variant)->Variant:
	if key in ["muted","mute_background"]:return value if value is bool else DEFAULTS[key]
	if not value is float and not value is int:return DEFAULTS[key]
	var number:float=float(value)
	return clampf(number,0.0,1.0) if is_finite(number) else DEFAULTS[key]

func get_settings()->Dictionary:return _settings.duplicate()
func set_setting(key:String,value:Variant)->void:
	if not DEFAULTS.has(key):return
	_settings[key]=_valid_setting(key,value)
	var config:=ConfigFile.new()
	for field:String in _settings:config.set_value("audio",field,_settings[field])
	if not _directory.is_empty():
		var error:Error=DirAccess.make_dir_recursive_absolute(_directory)
		if error==OK:error=config.save(_directory.path_join("audio.cfg"))
		if error!=OK:settings_error.emit("Could not save audio settings: "+error_string(error))
	if not _enabled():_stop_all()
	settings_changed.emit(get_settings())
func reset_history()->void:
	# Call before import/new/continue, even when the replacement yard has a
	# larger elapsed/ID counter. Never treat its old events as fresh actions.
	_primed=false;_stop_all();_honk_times.clear();_cue_times.clear()
func set_backgrounded(value:bool)->void:
	_backgrounded=value
	if not _enabled():_stop_all()
func _enabled()->bool:
	return not bool(_settings.muted) and float(_settings.master)>0 and not (_backgrounded and bool(_settings.mute_background))
func _remember(values:Dictionary,key:String,value:Variant=true,limit:int=256)->void:
	if key.is_empty():return
	values[key]=value
	while values.size()>limit:values.erase(values.keys()[0])
func _position(value:Dictionary)->Vector3:
	return Vector3(float(value.get("x",0)),float(value.get("y",0))+1.0,float(value.get("z",0)))
func _entity_position(id:String)->Vector3:
	for category:String in ["equipment","workers","shunters","orders","buildings","stacks"]:
		for value:Dictionary in _state.get(category,[]):
			if str(value.get("id",""))==id:
				if category=="orders":return _position(value.get("vehicle",{}))
				var result:Vector3=_position(value)
				if category in ["buildings","stacks"]:result+=Vector3(float(value.get("w",0))*.5,0,float(value.get("d",0))*.5)
				return result
	return Vector3.INF
func _gain(category:String,level:float)->float:
	return level*float(_settings.master)*float(_settings.get(category,.7))*(.40 if _backgrounded else 1.0)
func _queue(sound:String,key:String,at:Vector3,category:String,level:float=.30,priority:float=1.0)->void:
	if not _enabled() or not _bank.has(sound) or (_paused and category!="notifications"):return
	if float(_settings.get(category,0))<=0:return
	if category!="notifications" and at.distance_to(_listener_position)>RANGE:return
	if _shots.size()>=VOICES:_dropped+=1;return
	_shots.append({"sound":sound,"key":key,"at":at,"category":category,"level":level,"priority":priority})
func _cue(sound:String,key:String,at:Vector3,category:String="notifications",level:float=.30,cooldown:float=.65)->void:
	var cooldown_key:String="cue/"+sound
	if _clock-float(_cue_times.get(cooldown_key,-100.0))<cooldown:return
	_remember(_cue_times,cooldown_key,_clock,64);_queue(sound,key,at,category,level,2.0)
func _honk(source:String,target:String,at:Vector3)->void:
	if _clock-float(_honk_times.get(source,-100.0))<14.0:return
	_remember(_honk_times,source,_clock,128)
	_cue("honk",source+"/"+target,at,"vehicles",.32,2.0)

func sync_snapshot(message:Dictionary)->void:
	_state=message.get("state",{});_render=message.get("render",{})
	var elapsed:float=float(_state.get("elapsed",0));var next:int=int(_state.get("next",0))
	var baseline:bool=not _primed or elapsed<_elapsed-.001 or next<_last_next
	if baseline:
		_stop_all();_seen_events.clear();_seen_notices.clear();_seen_movements.clear();_clearance_signatures.clear();_motion.clear();_steps.clear();_phase_signatures.clear();_work_times.clear()
	_paused=bool(_state.get("paused",true))
	if _paused:_stop_work()
	_read_events(baseline);_read_clearance(baseline)
	_desired.clear()
	if not _paused:
		var actors:Array=_render.get("actors",[]).duplicate()
		actors.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return _position(a).distance_squared_to(_listener_position)<_position(b).distance_squared_to(_listener_position))
		for actor:Dictionary in actors.slice(0,128):
			if not bool(actor.get("visible",true)):continue
			var kind:String=str(actor.get("kind",""));var id:String=str(actor.get("id",""));var at:Vector3=_position(actor)
			if kind in ["excavator","forklift"]:
				var speed:float=absf(float(actor.get("velocity",0)))
				if not str(actor.get("refueling","")).is_empty() and not bool(actor.get("walking",false)) and speed<.01:continue
				var active:bool=bool(actor.get("walking",false)) or not str(actor.get("operator","")).is_empty()
				if active:
					_offer(id,"engine-"+kind,at,"vehicles",.20 if speed>.1 or not str(actor.get("workPhase","")).is_empty() else .105,.86+minf(speed/3.2,1)*.34,1.0)
			elif kind=="worker":_read_worker(actor,baseline)
		for carrier:Dictionary in _render.get("carriers",[]).slice(0,128):
			var kind:String=str(carrier.get("kind","truck"));var id:String=str(carrier.get("id",""))
			var at:Vector3=_position(carrier)
			if kind=="rail":
				var locomotive:Variant=carrier.get("locomotive",{})
				if locomotive is Dictionary and not locomotive.is_empty():
					at=_position(locomotive);_offer(id,"engine-shunter",at,"vehicles",.20,.90,1.15)
			else:
				var speed:float=_travel_speed(id,at,elapsed)
				_offer(id,"engine-bus" if kind=="bus" else "engine-truck",at,"vehicles",.18 if speed>.1 else .085,.83+minf(speed/8,1)*.36,1.0)
		for shunter:Dictionary in _render.get("railShunters",[]).slice(0,64):
			if shunter.has("refueling"):continue
			if str(shunter.get("phase","")) in ["ordered","handover"]:continue
			if not str(shunter.get("driverId","")).is_empty() or str(shunter.get("phase","parked"))!="parked":
				var speed:float=absf(float(shunter.get("move",{}).get("velocity",0)))
				_offer(str(shunter.get("id","")),"engine-shunter",_position(shunter),"vehicles",.21 if speed>.1 else .10,.85+minf(speed/4,1)*.35,1.15)
		for pump:Dictionary in _render.get("processRows",[]).slice(0,256):
			if bool(pump.get("running",false)) and absf(float(pump.get("flow",0)))>.001:
				_offer(str(pump.get("id","")),"engine-pump",_position(pump) if pump.has("x") and pump.has("z") else _entity_position(str(pump.get("id",""))),"work",.12,1.0,.8)
	_elapsed=elapsed;_last_next=next;_primed=true

func _travel_speed(id:String,at:Vector3,elapsed:float)->float:
	var old:Dictionary=_motion.get(id,{})
	_remember(_motion,id,{"position":at,"elapsed":elapsed},256)
	if old.is_empty() or elapsed-float(old.elapsed)<.001:return 0.0
	return at.distance_to(old.position)/(elapsed-float(old.elapsed))
func _offer(id:String,sound:String,at:Vector3,category:String,level:float,pitch:float,priority:float)->void:
	if at.distance_to(_listener_position)>RANGE or not _bank.has(sound):return
	var candidate:Dictionary={"key":id+"/"+sound,"sound":sound,"at":at,"category":category,"level":level,"pitch":pitch,"score":priority/(1.0+at.distance_to(_listener_position)*.08)}
	_desired.append(candidate)
	if _desired.size()>64:
		_desired.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.score)>float(b.score))
		_desired.resize(64)
func _read_worker(actor:Dictionary,baseline:bool)->void:
	var id:String=str(actor.get("id",""));var at:Vector3=_position(actor)
	var travel:float=float(actor.get("travel",0));var old:Dictionary=_steps.get(id,{"travel":travel,"clock":_clock})
	if bool(actor.get("walking",false)) and not baseline and absf(travel-float(old.travel))>=.55 and _clock-float(old.clock)>=.24:
		_queue("footstep-a" if int(travel/.55)%2==0 else "footstep-b",id+"/step",at-Vector3.UP*.9,"work",.24,.7)
		old={"travel":travel,"clock":_clock}
	elif not bool(actor.get("walking",false)) or baseline:old={"travel":travel,"clock":_clock}
	_remember(_steps,id,old,256)
	var fuel:Variant=actor.get("fuelCan",{})
	if fuel is Dictionary and str(fuel.get("phase","")) in ["fill","pour"]:
		_offer(id,"can-fill" if str(fuel.phase)=="fill" else "can-pour",at,"work",.23,1.0,1.3)
	var phase:String=str(actor.get("workPhase",""))
	var key:String=id+"/work"
	if not bool(actor.get("walking",false)) and (phase.contains("fasten") or phase.contains("join") or phase.contains("rig")) and not baseline and _clock-float(_work_times.get(key,-100.0))>.7:
		_remember(_work_times,key,_clock,256)
		_queue("ratchet",key,at,"work",.20,.8)
	elif not bool(actor.get("walking",false)) and (phase.contains("settle") or phase.contains("level")) and not baseline and _clock-float(_work_times.get(key,-100.0))>.85:
		_remember(_work_times,key,_clock,256);_queue("hammer",key,at,"work",.16,.8)

func _read_events(baseline:bool)->void:
	var events:Array=_state.get("events",[])
	for event:Dictionary in events.slice(maxi(0,events.size()-64)):
		var id:String=str(event.get("id",""));var fresh:bool=not _seen_events.has(id)
		_remember(_seen_events,id)
		if not fresh or baseline:continue
		var text:String=str(event.get("text","")).to_lower();var type:String=str(event.get("type",""))
		if type=="Work" and text.contains("complete"):
			var entity:String=str(event.get("entity",""));var job:Dictionary={}
			for candidate:Dictionary in _state.get("jobs",[]):
				if str(candidate.get("id",""))==entity:job=candidate;break
			if str(job.get("kind","")) in ["slab","rail","refuel","throwSwitch"]:continue
			_cue("complete",id,_listener_position,"notifications",.22,.8)
	var notices:Array=_state.get("notices",[])
	for notice:Dictionary in notices.slice(0,64):
		var id:String=str(notice.get("id",""));var fresh:bool=not _seen_notices.has(id)
		_remember(_seen_notices,id)
		if not fresh or baseline:continue
		var title:String=str(notice.get("title","")).to_lower()
		if title.contains("blocked") or title.contains("canceled") or str(notice.get("severity",""))=="warning":_cue("warning",id,_listener_position,"notifications",.22,2.0)
		elif title.contains("delivery") or title.contains("train approaching") or title.contains("collection truck approaching"):_cue("delivery",id,_listener_position,"notifications",.22,1.4)
	var movements:Array=_state.get("movements",[])
	for movement:Dictionary in movements.slice(maxi(0,movements.size()-32)):
		var id:String=str(movement.get("id",""));var fresh:bool=not _seen_movements.has(id)
		_remember(_seen_movements,id)
		if not fresh or baseline:continue
		var reason:String=str(movement.get("reason","")).to_lower()
		if reason.contains("set on") or reason.contains("lowered") or reason.contains("deposited"):
			var position:Vector3=_entity_position(str(movement.get("to","")))
			if not position.is_finite():position=_entity_position(str(movement.get("from","")))
			if position.is_finite():_cue("slab-setdown",id,position,"work",.25,.25)

func _read_clearance(baseline:bool)->void:
	var current:Dictionary={}
	for request:Dictionary in _state.get("actionClearances",[]).slice(0,128):
		var source:String=str(request.get("requesterEquipmentId",request.get("ownerId","")))
		var targets:Array=request.get("blockerIds",[]).duplicate();targets.sort()
		var key:String=str(request.get("ownerId",""))+"/"+source
		var signature:String=JSON.stringify(targets)
		current[key]=signature
		if not baseline and signature!=str(_clearance_signatures.get(key,"")) and not targets.is_empty():
			var point:Vector3=_entity_position(source)
			if not point.is_finite():point=_position(request.get("point",{}))
			_honk(source,str(targets[0]),point)
	for order:Dictionary in _state.get("orders",[]).slice(0,128):
		var target:String=str(order.get("drive",{}).get("clearanceRequestedFor",""))
		if target.is_empty():continue
		var source:String=str(order.get("id",""));var key:String=source+"/road"
		current[key]=target
		if not baseline and str(_clearance_signatures.get(key,""))!=target:_honk(source,target,_position(order.get("vehicle",{})))
	_clearance_signatures=current

func advance(dt:float,listener_position:Vector3,listener_basis:Basis=Basis.IDENTITY)->void:
	_clock+=maxf(0.0,dt);_listener_position=listener_position
	if _listener:_listener.global_position=listener_position;_listener.global_basis=listener_basis
	if not _enabled():_stop_all();return
	if _paused:_stop_work()
	_desired.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.score)>float(b.score))
	var selected:Dictionary={}
	for candidate:Dictionary in _desired:
		if float(_settings.get(candidate.category,0))<=0:continue
		selected[candidate.key]=candidate
		if selected.size()>=LOOP_VOICES:break
	for index:int in range(LOOP_VOICES):
		var voice:Dictionary=_voices[index]
		if voice.is_empty():continue
		var player:AudioStreamPlayer3D=_players[index]
		if _paused or not selected.has(voice.key):
			player.volume_db=lerpf(player.volume_db,-65.0,1.0-exp(-dt*12.0))
			if player.volume_db<-55.0:player.stop();_voices[index]={}
			continue
		var candidate:Dictionary=selected[voice.key]
		_update_voice(index,candidate,dt);selected.erase(voice.key)
	for key:String in selected:
		if _paused:break
		for index:int in range(LOOP_VOICES):
			if not _voices[index].is_empty():continue
			var candidate:Dictionary=selected[key]
			var player:AudioStreamPlayer3D=_players[index];player.stream=_bank[candidate.sound]
			player.global_position=candidate.at;player.pitch_scale=float(candidate.pitch);player.volume_db=-60.0;player.play()
			_voices[index]=candidate.duplicate();_record(candidate.sound,candidate.key,true)
			_update_voice(index,candidate,dt);break
	for index:int in range(LOOP_VOICES,VOICES):
		if _voices[index].is_empty():continue
		var voice:Dictionary=_voices[index]
		if _clock>=float(voice.until) or float(_settings.get(voice.category,0))<=0:_players[index].stop();_voices[index]={}
		else:_players[index].volume_db=linear_to_db(maxf(.0001,_gain(voice.category,float(voice.level))))
	_shots.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.priority)>float(b.priority))
	for shot:Dictionary in _shots:
		var started:bool=false
		for index:int in range(LOOP_VOICES,VOICES):
			if not _voices[index].is_empty():continue
			var player:AudioStreamPlayer3D=_players[index];player.stream=_bank[shot.sound]
			player.global_position=_listener_position if str(shot.category)=="notifications" else shot.at
			player.pitch_scale=1.0;player.volume_db=linear_to_db(maxf(.0001,_gain(shot.category,float(shot.level))))
			player.play();_voices[index]={"key":shot.key,"category":shot.category,"level":shot.level,"until":_clock+player.stream.get_length()}
			_record(shot.sound,shot.key,false);started=true;break
		if not started:_dropped+=1
	_shots.clear()
func _update_voice(index:int,candidate:Dictionary,dt:float)->void:
	var player:AudioStreamPlayer3D=_players[index]
	var target_db:float=linear_to_db(maxf(.0001,_gain(candidate.category,float(candidate.level))))
	player.volume_db=lerpf(player.volume_db,target_db,1.0-exp(-maxf(0.0,dt)*9.0))
	player.pitch_scale=lerpf(player.pitch_scale,float(candidate.pitch),1.0-exp(-maxf(0.0,dt)*5.0))
	player.global_position=player.global_position.lerp(candidate.at,1.0-exp(-maxf(0.0,dt)*12.0))
func _record(sound:String,key:String,loop:bool)->void:
	_played.append({"sound":sound,"key":key,"loop":loop,"at":_clock})
	while _played.size()>128:_played.pop_front()
func _stop_work()->void:
	for index:int in range(_players.size()):
		if _voices[index].is_empty() or str(_voices[index].get("category",""))=="notifications":continue
		_players[index].stop();_voices[index]={}
	_desired.clear()
	_shots=_shots.filter(func(shot:Dictionary)->bool:return str(shot.category)=="notifications")
func _stop_all()->void:
	for index:int in range(_players.size()):_players[index].stop();_voices[index]={}
	_shots.clear()
func get_status()->Dictionary:
	var loops:Array[String]=[];var oneshots:int=0
	for index:int in range(_voices.size()):
		if _voices[index].is_empty():continue
		if index<LOOP_VOICES:loops.append(str(_voices[index].key))
		else:oneshots+=1
	return {"voices":_players.size(),"loops":loops,"oneshots":oneshots,"queued":_shots.size(),"sounds":_bank.size(),"missing":_missing.duplicate(),"played":_played.duplicate(true),"paused":_paused,"backgrounded":_backgrounded,"dropped":_dropped,"metadata":{"events":_seen_events.size(),"notices":_seen_notices.size(),"movements":_seen_movements.size(),"clearances":_clearance_signatures.size(),"motion":_motion.size(),"steps":_steps.size(),"work":_work_times.size(),"honks":_honk_times.size()}}

func show_settings(shared_theme:Theme=null)->void:
	if _dialog:
		if shared_theme:_dialog.theme=shared_theme
		_dialog.popup_centered();return
	_dialog=AcceptDialog.new();_dialog.title="Sound";_dialog.min_size=Vector2i(490,370)
	_dialog.theme=shared_theme if shared_theme else preload("res://scripts/ui_theme.gd").create()
	add_child(_dialog)
	var body:=VBoxContainer.new();body.add_theme_constant_override("separation",10);_dialog.add_child(body)
	for key:String in ["master","vehicles","work","notifications"]:
		var row:=HBoxContainer.new();body.add_child(row)
		var label:=Label.new();label.text=key.capitalize();label.custom_minimum_size.x=120;row.add_child(label)
		var slider:=HSlider.new();slider.min_value=0;slider.max_value=1;slider.step=.01;slider.value=float(_settings[key]);slider.custom_minimum_size.x=220;row.add_child(slider)
		var number:=Label.new();number.text="%d%%"%roundi(slider.value*100);number.custom_minimum_size.x=48;row.add_child(number)
		slider.value_changed.connect(func(value:float)->void:number.text="%d%%"%roundi(value*100);set_setting(key,value))
	for key:String in ["muted","mute_background"]:
		var button:=CheckBox.new();button.text="Mute all sound" if key=="muted" else "Mute sound while the window is in the background"
		button.button_pressed=bool(_settings[key]);body.add_child(button)
		button.toggled.connect(func(value:bool)->void:set_setting(key,value))
	var note:=Label.new();note.text="The factory continues running when its window is in the background.\nSound settings are stored locally beside this installation's saves.\nEngines, footsteps and work stop sounding while the game is paused."
	note.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;note.custom_minimum_size.x=425;body.add_child(note)
	_dialog.close_requested.connect(func()->void:_dialog.hide())
	_dialog.popup_centered()
