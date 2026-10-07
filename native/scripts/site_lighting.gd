extends RefCounted
## Presentation only: an equinox-style day and an always-full opposing moon.
## Derive every value from simulation seconds, never from a separate wall clock.
static func profile(seconds: float) -> Dictionary:
	var hour: float=fposmod(seconds,86400.0)/3600.0
	var angle: float=(hour-6.0)*TAU/24.0
	var direction:=Vector3(cos(angle),0.8*sin(angle),0.6*sin(angle)).normalized()
	var altitude: float=direction.y
	var day: float=smoothstep(-0.12,0.28,altitude)
	var twilight: float=(1.0-smoothstep(0.05,0.32,absf(altitude)))*smoothstep(-0.20,0.02,altitude)
	var sunshine: float=smoothstep(-0.015,0.27,altitude)
	var moonshine: float=smoothstep(-0.02,0.20,-altitude)*(1.0-day)
	var warm: float=1.0-smoothstep(0.03,0.35,altitude)
	return {
		"hour":hour,"sunDirection":direction,"moonDirection":-direction,
		"daylight":day,"twilight":twilight,"night":1.0-day,
		"sunEnergy":1.65*sunshine,"moonEnergy":0.38*moonshine,
		"sunColor":Color("fff1d9").lerp(Color("ffb86d"),warm),
		"ambient":lerpf(0.14,0.32,day),"exposure":lerpf(1.20,0.90,day),
		"lamps":1.0-smoothstep(0.03,0.23,altitude),
		"sunRotation":Vector3(-asin(clampf(altitude,-1,1)),atan2(direction.x,direction.z),0),
		"moonRotation":Vector3(-asin(clampf(-altitude,-1,1)),atan2(-direction.x,-direction.z),0)
	}
