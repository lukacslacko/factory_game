extends SceneTree
const Electrical=preload("res://scripts/electrical_models.gd")
const Models=preload("res://scripts/game_models.gd")
var failures:Array[String]=[]
var checks:int=0
func _initialize()->void:_run.call_deferred()
func _check(value:bool,label:String)->void:
	checks+=1
	if not value:failures.append(label)
func _mesh_bounds(node:Node3D,relative:Transform3D=Transform3D.IDENTITY)->AABB:
	var bounds:=AABB();var found:bool=false
	for child:Node in node.get_children():
		if not child is Node3D:continue
		var transform:Transform3D=relative*(child as Node3D).transform
		if child is MeshInstance3D and child.mesh:
			var part:AABB=transform*child.mesh.get_aabb()
			bounds=part if not found else bounds.merge(part);found=true
		if child.get_child_count()>0:
			var part:AABB=_mesh_bounds(child,transform)
			if part.size.length()>0:bounds=part if not found else bounds.merge(part);found=true
	return bounds
func _run()->void:
	var scene:=Node3D.new();root.add_child(scene)
	var cabinet:Node3D=Models.building(scene,{"id":"BLD-JUNCTION","kind":"electricalJunction","connected":false,"powered":false})
	_check(cabinet.name=="LowPowerJunctionCabinet","Building dispatch creates the dedicated junction cabinet")
	_check(is_zero_approx(float(cabinet.get_meta("own_demand_kw"))) and not bool(cabinet.get_meta("power_source")),"Passive junction has zero demand and no invented incoming supply")
	_check(not cabinet.has_meta("capacity_kw"),"Junction does not add another 16 kW source")
	_check(not cabinet.get_node("SupplyIndicator").visible,"Unwired cabinet indicator starts off")
	Electrical.update_junction(cabinet,{"connected":true,"powered":false})
	_check(bool(cabinet.get_meta("connected")) and not cabinet.get_node("SupplyIndicator").visible,"Wired cabinet stays dark when the upstream supply is off")
	Electrical.update_junction(cabinet,{"connected":true,"powered":true})
	_check(bool(cabinet.get_meta("powered")) and cabinet.get_node("SupplyIndicator").visible,"Cabinet indicator follows the real rooted electrical supply")
	var bounds:AABB=_mesh_bounds(cabinet)
	_check(bounds.position.x>=-.5 and bounds.end.x<=.5 and bounds.position.z>=-.5 and bounds.end.z<=.5,"Cabinet hardware fits its one-meter foundation")
	_check(bounds.end.y<1.3 and bounds.position.y>-.06,"Cabinet remains compact with a small below-grade conduit entry")
	var kit:Node3D=Models.stock(scene,"electricalJunction",1)
	var kit_bounds:AABB=_mesh_bounds(kit)
	_check(kit.get_child_count()>0 and kit_bounds.size.x<=1.04 and kit_bounds.size.z<=1.04,"Delivered junction kit uses its actual one-meter stock footprint")
	scene.queue_free();await process_frame
	print("ELECTRICAL_JUNCTION_SMOKE ",JSON.stringify({"passed":failures.is_empty(),"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
