extends SceneTree

func _initialize() -> void:
	var destination := ProjectSettings.globalize_path("res://licenses")
	DirAccess.make_dir_recursive_absolute(destination)
	var license_file := FileAccess.open(destination.path_join("GODOT-LICENSE.txt"), FileAccess.WRITE)
	license_file.store_string(Engine.get_license_text() + "\n")
	var third_party := FileAccess.open(destination.path_join("GODOT-THIRD-PARTY.json"), FileAccess.WRITE)
	third_party.store_string(JSON.stringify(Engine.get_license_info(), "  ") + "\n")
	quit()
