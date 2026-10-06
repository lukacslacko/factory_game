extends SceneTree
## Static GPU fixture: render consecutive frames with normal native TAA and
## Retina-style FSR2. An optional baseline script enables an A/B check.
const W = preload("res://scripts/game_world.gd")
const M = preload("res://scripts/game_models.gd")
const G = preload("res://scripts/geometry.gd")

func _initialize() -> void:
 _run.call_deferred()

func _run() -> void:
 if RenderingServer.get_rendering_device()==null:
  push_error("Ghost raster check requires a GPU renderer")
  quit(1)
  return
 var viewport:=root
 var scene:=Node3D.new()
 viewport.add_child(scene)
 var environment:=WorldEnvironment.new()
 environment.environment=Environment.new()
 environment.environment.background_mode=Environment.BG_COLOR
 environment.environment.background_color=Color("bfcbd2")
 environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
 environment.environment.ambient_light_color=Color.WHITE
 environment.environment.ambient_light_energy=.8
 scene.add_child(environment)
 var sun:=DirectionalLight3D.new()
 sun.rotation_degrees=Vector3(-50,-30,0)
 sun.light_energy=2.0
 scene.add_child(sun)
 var camera:=Camera3D.new()
 camera.position=Vector3(39,28,60)
 scene.add_child(camera)
 camera.look_at(Vector3(30,0,38))
 camera.current=true
 var variants:Dictionary={"after":W}
 if "--baseline" in OS.get_cmdline_user_args():
  variants={"before":load("res://captures/ghost_before.gd"),"after":W}
 for variant in variants:
  var world:Node3D=variants[variant].new()
  scene.add_child(world)
  world.setup()
  world.set_grid(false)
  # Ground plans straddle a real worker and an opaque cargo-sized obstacle.
  var ghost:=Node3D.new()
  world.add_child(ghost)
  var geometry:Dictionary={"rect":{"x":25,"z":36,"w":10,"d":2},"paths":[{"points":[{"x":25,"z":37,"yaw":0},{"x":35,"z":37,"yaw":0}]}]}
  world._rail_ghost(ghost,geometry,Color("42d5ff"))
  world._construction_ghost(ghost,{"x":25,"z":35,"w":10,"d":7},Color("42d5ff"))
  var worker:=M.actor(world,"worker",{"id":"WRK-TEST","name":"Worker #1"})
  worker.position=Vector3(27,0,36.2475)
  var red:=StandardMaterial3D.new()
  red.albedo_color=Color("dc3428")
  red.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
  var blocker:=G.box(world,Vector3(31,1.0,37),Vector3(2.4,2.0,2.4),red)
  for mode in ["taa","fsr2"]:
   viewport.use_taa=false
   viewport.scaling_3d_mode=Viewport.SCALING_3D_MODE_FSR2 if mode=="fsr2" else Viewport.SCALING_3D_MODE_BILINEAR
   viewport.scaling_3d_scale=.60 if mode=="fsr2" else 1.0
   viewport.msaa_3d=Viewport.MSAA_DISABLED if mode=="fsr2" else Viewport.MSAA_4X
   viewport.use_taa=mode=="taa"
   for frame in range(60):
    await process_frame
    RenderingServer.force_draw(false)
   for frame in range(12):
    await process_frame
    RenderingServer.force_draw(false)
    viewport.get_texture().get_image().save_png("res://captures/ghost-raster-"+variant+"-"+mode+"-"+str(frame)+".png")
   # Hide ghosts for an exact image mask of the opaque occluder.
   ghost.hide()
   for frame in range(30):
    await process_frame
    RenderingServer.force_draw(false)
   viewport.get_texture().get_image().save_png("res://captures/ghost-occluder-"+variant+"-"+mode+".png")
   ghost.show()
  scene.remove_child(world)
  world.free()
 print("GHOST_RASTER_COMPLETE ",JSON.stringify({"variants":variants.keys(),"modes":["taa","fsr2"],"framesPerMode":12,"resolution":str(viewport.size),"serviceStarted":false}))
 quit(0)
