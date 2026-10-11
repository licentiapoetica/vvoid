// The void's look, as numbers an admin may turn (the Tab panel's look page: see lookPanel in main.js),
// kept by the server for everyone (GET /api/look; PUT, an admin's: see server.js). Each is read where it
// is used: by the shaders (all of them in one uniform, uLook, each by its LOOK_ name: see LOOK_GLSL),
// and by the light worms, the sky and saber, every frame, so a change is seen at once.
// (Nothing here may import three: the server reads this file too.)

// saber's cinematic shots (see SHOTS in plugins/saber/public/client.js, by the same names), each with a chance of
// its own on the look page: 0 never, 1 as often as any, 2 twice as often. Numbered, for "only one shot"
export const CINE_SHOTS = ["low dolly", "orbit", "crane", "facing them", "over the shoulder", "from the floor", "vertigo", "spiral up", "dutch close", "side profile", "sweep", "rising behind", "top down", "far tele", "the void", "first person"];
export const shotKey = (name) => `shot_${name.replace(/[^a-z0-9]+/g, "_")}`;

export const LOOK = [
  // the pieces that stand in the void (see BOX_FRAG)
  { key: "solidLight", glsl: "SOLID_LIGHT", group: "blocks", label: "brightness", min: 0.2, max: 3, step: 0.01, value: 1.3 },
  { key: "solidReach", glsl: "SOLID_REACH", group: "blocks", label: "light reach", min: 60, max: 1500, step: 10, value: 340 },
  { key: "solidGrain", glsl: "SOLID_GRAIN", group: "blocks", label: "grain", min: 0, max: 0.6, step: 0.01, value: 0.06 },
  { key: "solidEdge", glsl: "SOLID_EDGE", group: "blocks", label: "edge line", min: 0, max: 0.8, step: 0.01, value: 0.12 },
  { key: "solidColour", glsl: "SOLID_COLOUR", type: "colour", group: "blocks", label: "colour", value: "#c4cbe0" },
  { key: "solidColourMix", glsl: "SOLID_COLOUR_MIX", group: "blocks", label: "colour override", min: 0, max: 1, step: 0.01, value: 0 },
  // the glow far off (see HAZE)
  { key: "hazeGlow", glsl: "HAZE_GLOW", group: "haze", label: "glow", min: 0, max: 3, step: 0.01, value: 1 },
  { key: "hazeDark", glsl: "HAZE_DARK", group: "haze", label: "dark away from it", min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: "hazeColour", glsl: "HAZE_COLOUR", type: "colour", group: "haze", label: "colour", value: "#5f8cff" },
  { key: "hazeColourMix", glsl: "HAZE_COLOUR_MIX", group: "haze", label: "colour override", min: 0, max: 1, step: 0.01, value: 0 },
  // the nebula (see skyFrag)
  { key: "nebulaStrength", glsl: "NEBULA_STRENGTH", group: "nebula", label: "strength", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "nebulaAccent", glsl: "NEBULA_ACCENT", group: "nebula", label: "bright cores", min: 0, max: 5, step: 0.01, value: 1 },
  { key: "nebulaBase", glsl: "NEBULA_BASE", group: "nebula", label: "sky behind it", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "nebulaDepth", glsl: "NEBULA_DEPTH", group: "nebula", label: "depth", min: 0.2, max: 4, step: 0.01, value: 1 },
  { key: "nebulaSpeed", glsl: "NEBULA_SPEED", group: "nebula", label: "how fast it moves", min: 0, max: 10, step: 0.05, value: 1 },
  { key: "nebulaDrift", glsl: "NEBULA_DRIFT", group: "nebula", label: "drift as you fly", min: 0, max: 6, step: 0.01, value: 1 },
  { key: "nebulaColour", glsl: "NEBULA_COLOUR", type: "colour", group: "nebula", label: "colour", value: "#5f8cff" },
  { key: "nebulaColourMix", glsl: "NEBULA_COLOUR_MIX", group: "nebula", label: "colour override", min: 0, max: 1, step: 0.01, value: 0 },
  { key: "nebulaAccentColour", glsl: "NEBULA_ACCENT_COLOUR", type: "colour", group: "nebula", label: "cores' colour", value: "#b9d4ff" },
  { key: "nebulaAccentColourMix", glsl: "NEBULA_ACCENT_COLOUR_MIX", group: "nebula", label: "cores' colour override", min: 0, max: 1, step: 0.01, value: 0 },
  // flying into a new sector (see World.enter, World.update and Sky.update)
  { key: "sectorSky", group: "new sectors", label: "own nebula each (0 off, 1 on)", min: 0, max: 1, step: 1, value: 1 },
  { key: "skyFade", group: "new sectors", label: "nebula fade (seconds)", min: 0.5, max: 40, step: 0.5, value: 9 },
  { key: "sectorColours", group: "new sectors", label: "own colours in the air", min: 0, max: 1, step: 0.01, value: 0 },
  { key: "airEase", group: "new sectors", label: "colours ease over (speed)", min: 0.02, max: 4, step: 0.01, value: 0.4 },
  // the blocks far off in the sky (see SCAFFOLD)
  { key: "blocksDensity", glsl: "BLOCKS_DENSITY", group: "sky blocks", label: "density", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "blocksSize", glsl: "BLOCKS_SIZE", group: "sky blocks", label: "size", min: 0.1, max: 0.9, step: 0.01, value: 0.42 },
  { key: "blocksFrom", glsl: "BLOCKS_FROM", group: "sky blocks", label: "nearest", min: 1, max: 30, step: 0.1, value: 5 },
  { key: "blocksTo", glsl: "BLOCKS_TO", group: "sky blocks", label: "furthest", min: 10, max: 140, step: 1, value: 70 },
  { key: "blocksFalloff", glsl: "BLOCKS_FALLOFF", group: "sky blocks", label: "light reach", min: 4, max: 100, step: 0.5, value: 22 },
  { key: "blocksBright", glsl: "BLOCKS_BRIGHT", group: "sky blocks", label: "brightness", min: 0, max: 3, step: 0.01, value: 1.1 },
  { key: "blocksOpacity", glsl: "BLOCKS_OPACITY", group: "sky blocks", label: "opacity", min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: "blocksShowGlow", glsl: "BLOCKS_SHOW_GLOW", group: "sky blocks", label: "light show glow", min: 0, max: 5, step: 0.01, value: 1.5 },
  { key: "blocksShowOpacity", glsl: "BLOCKS_SHOW_OPACITY", group: "sky blocks", label: "light show opacity", min: 0, max: 8, step: 0.01, value: 2.5 },
  { key: "blocksDrift", glsl: "BLOCKS_DRIFT", group: "sky blocks", label: "drift as you fly", min: 0, max: 6, step: 0.01, value: 1 },
  { key: "blocksColour", glsl: "BLOCKS_COLOUR", type: "colour", group: "sky blocks", label: "colour", value: "#c4cbe0" },
  { key: "blocksColourMix", glsl: "BLOCKS_COLOUR_MIX", group: "sky blocks", label: "colour override", min: 0, max: 1, step: 0.01, value: 0 },
  { key: "skyScale", group: "sky blocks", label: "sky sharpness", min: 0.25, max: 1, step: 0.05, value: 0.5 },
  // the light worms (see worms.js)
  { key: "wormCount", group: "light worms", label: "how many", min: 0, max: 64, step: 1, value: 0 }, // (none unless an admin asks for them: the owner finds them too much)
  { key: "wormSpeed", group: "light worms", label: "speed", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "wormTrail", group: "light worms", label: "trail (seconds)", min: 0.2, max: 6, step: 0.05, value: 2 },
  { key: "wormWidth", group: "light worms", label: "width", min: 0.1, max: 5, step: 0.01, value: 1 },
  { key: "wormBright", group: "light worms", label: "brightness", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "wormBlink", group: "light worms", label: "firefly blink", min: 0, max: 2, step: 0.01, value: 1 },
  { key: "wormCurl", group: "light worms", label: "how much they wind", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "wormNear", group: "light worms", label: "nearest", min: 50, max: 3000, step: 10, value: 400 },
  { key: "wormFar", group: "light worms", label: "furthest", min: 300, max: 8000, step: 10, value: 2200 },
  { key: "wormColour", type: "colour", group: "light worms", label: "colour", value: "#ffffff" },
  { key: "wormColourMix", group: "light worms", label: "colour override", min: 0, max: 1, step: 0.01, value: 0 },
  // saber's light show, in the void round its stage (see fly in plugins/saber)
  { key: "saberGain", group: "saber", label: "light show reach", min: 0, max: 4, step: 0.01, value: 1 },
  { key: "saberFlash", group: "saber", label: "flash", min: 0, max: 3, step: 0.01, value: 0.6 },
  { key: "saberRest", group: "saber", label: "glow at rest", min: 0, max: 1.5, step: 0.01, value: 0.25 },
  // saber's cinematic camera, to the beat: how it takes a double, both hands' notes at once (see filmBeat in plugins/saber)
  { key: "doubleSlam", group: "saber doubles", label: "slam in", min: 0, max: 0.6, step: 0.005, value: 0.16 },
  { key: "doubleFade", group: "saber doubles", label: "slam fades (speed)", min: 0.5, max: 20, step: 0.1, value: 4.5 },
  { key: "doubleWindup", group: "saber doubles", label: "draw back before", min: 0, max: 0.3, step: 0.005, value: 0.045 },
  { key: "doubleLead", group: "saber doubles", label: "seen coming (seconds)", min: 0.1, max: 1.5, step: 0.05, value: 0.5 },
  { key: "doubleLunge", group: "saber doubles", label: "lunge at them (metres)", min: 0, max: 2, step: 0.01, value: 0.3 },
  { key: "doubleTip", group: "saber doubles", label: "horizon kick", min: 0, max: 0.4, step: 0.005, value: 0.07 },
  { key: "doubleEyes", group: "saber doubles", label: "through their eyes", min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: "doubleCalm", group: "saber doubles", label: "in calm parts", min: 0, max: 1, step: 0.01, value: 0.5 },
  // saber's cinematic camera, to the beat (see filmBeat in plugins/saber): how long a shot holds, how often it is
  // through their eyes, and how it swoops from one to the next
  { key: "camHuman", type: "switch", group: "saber camera", label: "a human holds the camera", min: 0, max: 1, step: 1, value: 0 },
  { key: "camHumanHow", group: "saber camera", label: "how human: their hands, their following", min: 0.1, max: 2, step: 0.05, value: 1 },
  { key: "camHoldBusy", group: "saber camera", label: "bars a shot holds: many notes", min: 1, max: 16, step: 1, value: 2 },
  { key: "camHoldNormal", group: "saber camera", label: "bars a shot holds: most of a song", min: 1, max: 16, step: 1, value: 4 },
  { key: "camHoldQuiet", group: "saber camera", label: "bars a shot holds: quiet", min: 1, max: 32, step: 1, value: 8 },
  { key: "camFit", group: "saber camera", label: "shots chosen for what comes (0 any, 1 only fitting)", min: 0, max: 1, step: 0.01, value: 1 },
  { key: "camRepeat", group: "saber camera", label: "not again within (shots)", min: 0, max: 8, step: 1, value: 4 },
  { key: "camEyesBusy", group: "saber camera", label: "first person chance: many notes", min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: "camEyesArcs", group: "saber camera", label: "first person chance: arcs", min: 0, max: 1, step: 0.01, value: 0.35 },
  { key: "camEyesWalls", group: "saber camera", label: "first person chance: walls", min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: "camEyesNormal", group: "saber camera", label: "first person chance: most of a song", min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: "camEyesQuiet", group: "saber camera", label: "first person chance: quiet", min: 0, max: 1, step: 0.01, value: 0.1 },
  { key: "camSwoop", group: "saber camera", label: "swoop length (seconds)", min: 0.3, max: 4, step: 0.05, value: 1.1 },
  { key: "camSwoopCalm", group: "saber camera", label: "swoop length, calm (seconds)", min: 0.3, max: 6, step: 0.05, value: 2.4 },
  { key: "camBank", group: "saber camera", label: "swoop banks into the turn", min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: "camPull", group: "saber camera", label: "swoop pulls wide", min: 0, max: 0.6, step: 0.01, value: 0.25 },
  { key: "camLift", group: "saber camera", label: "swoop arcs over", min: 0, max: 0.6, step: 0.01, value: 0.18 },
  { key: "camLand", group: "saber camera", label: "swoop lands with a punch", min: 0, max: 0.5, step: 0.01, value: 0.14 },
  { key: "camEarly", group: "saber camera", label: "big light show moments swoop early (chance)", min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: "camSolo", group: "saber shots", label: "only one shot, to judge it (its number; 0 all)", min: 0, max: CINE_SHOTS.length, step: 1, value: 0 },
  ...CINE_SHOTS.map((name, i) => ({ key: shotKey(name), group: "saber shots", label: `${i + 1} · ${name}`, min: 0, max: 5, step: 0.05, value: 1 })),
  // saber's avatar, twerking with the song (see shake in plugins/saber/public/avatar.js): how deep, how big each
  // pop, how loose its springs (the jiggle), how hard the notes, the doubles and the light show kick it, how it moves about
  { key: "twerkSquat", group: "saber twerk", label: "squat (metres down)", min: 0, max: 0.2, step: 0.005, value: 0.1 },
  { key: "twerkBack", group: "saber twerk", label: "hips back (metres)", min: 0, max: 0.2, step: 0.005, value: 0.11 },
  { key: "twerkBounce", group: "saber twerk", label: "bounce each pop (metres)", min: 0, max: 0.15, step: 0.005, value: 0.06 },
  { key: "twerkThrow", group: "saber twerk", label: "hips thrown back each pop (metres)", min: 0, max: 0.15, step: 0.005, value: 0.05 },
  { key: "twerkSnap", group: "saber twerk", label: "how sharp each pop (lower: snappier)", min: 0.05, max: 0.5, step: 0.01, value: 0.13 },
  { key: "twerkWide", group: "saber twerk", label: "feet apart (x)", min: 1, max: 2.5, step: 0.05, value: 1.8 },
  { key: "twerkTip", group: "saber twerk", label: "pelvis tipped, always (degrees)", min: 0, max: 30, step: 0.5, value: 14 },
  { key: "twerkPop", group: "saber twerk", label: "pop (degrees)", min: 0, max: 50, step: 0.5, value: 30 },
  { key: "twerkCalm", group: "saber twerk", label: "how big, calm", min: 0, max: 2, step: 0.01, value: 0.7 },
  { key: "twerkLively", group: "saber twerk", label: "how big, lively", min: 0, max: 2, step: 0.01, value: 1.05 },
  { key: "twerkHard", group: "saber twerk", label: "hard twerk in a drop: bigger by (x)", min: 0, max: 2, step: 0.05, value: 0.5 },
  { key: "twerkHardAt", group: "saber twerk", label: "a drop: the song this much busier than usual (x)", min: 1.1, max: 4, step: 0.05, value: 1.6 },
  { key: "twerkFastest", group: "saber twerk", label: "pops a second, at most", min: 0.5, max: 5, step: 0.05, value: 2.4 },
  { key: "twerkFastestHard", group: "saber twerk", label: "pops a second at most, hard twerk", min: 0.5, max: 6, step: 0.05, value: 3.4 },
  { key: "twerkHalf", group: "saber twerk", label: "once every two beats below (bpm)", min: 30, max: 120, step: 1, value: 60 },
  { key: "twerkMost", group: "saber twerk", label: "pelvis tipped at most (degrees)", min: 10, max: 90, step: 1, value: 55 },
  { key: "twerkSpring", group: "saber twerk", label: "jiggle speed (Hz)", min: 1, max: 12, step: 0.1, value: 4.6 },
  { key: "twerkJiggle", group: "saber twerk", label: "jiggle damping (lower: jigglier)", min: 0.03, max: 1, step: 0.01, value: 0.15 },
  { key: "twerkFlick", group: "saber twerk", label: "flick to the side each pop (degrees)", min: 0, max: 20, step: 0.5, value: 7 },
  { key: "twerkNudge", group: "saber twerk", label: "lean towards the notes' side (degrees)", min: 0, max: 15, step: 0.5, value: 4 },
  { key: "twerkSlam", group: "saber twerk", label: "slam on both hands at once, in a drop", min: 0, max: 20, step: 0.1, value: 9 },
  { key: "twerkBig", group: "saber twerk", label: "pop on the light show's big moments", min: 0, max: 20, step: 0.1, value: 6 },
  { key: "twerkSway", group: "saber twerk", label: "sway over a bar (degrees)", min: 0, max: 20, step: 0.5, value: 8 },
  { key: "twerkShimmy", group: "saber twerk", label: "shimmy in a stream (degrees)", min: 0, max: 12, step: 0.25, value: 5 },
  { key: "twerkWander", group: "saber twerk", label: "moves about (x)", min: 0, max: 3, step: 0.05, value: 1.2 },
  { key: "twerkTurn", group: "saber twerk", label: "turns about, up to (degrees)", min: 0, max: 45, step: 1, value: 25 },
  // saber's avatar, vibing to the song (see vibe in plugins/saber/public/avatar.js): its knees giving into each beat, its
  // weight from foot to foot, the hips and the chest against each other; how smooth its springs, how the song moves it
  { key: "vibeBounce", group: "saber vibe", label: "knees give each beat (metres)", min: 0, max: 0.12, step: 0.005, value: 0.035 },
  { key: "vibeSink", group: "saber vibe", label: "knees bent, always (metres)", min: 0, max: 0.12, step: 0.005, value: 0.025 },
  { key: "vibeShift", group: "saber vibe", label: "weight foot to foot (metres)", min: 0, max: 0.15, step: 0.005, value: 0.045 },
  { key: "vibeHeel", group: "saber vibe", label: "free heel up (metres)", min: 0, max: 0.12, step: 0.005, value: 0.045 },
  { key: "vibeWide", group: "saber vibe", label: "feet apart (x)", min: 0.8, max: 2, step: 0.05, value: 1.15 },
  { key: "vibeHike", group: "saber vibe", label: "hips hiked over the weight (degrees)", min: 0, max: 20, step: 0.5, value: 6 },
  { key: "vibeTwist", group: "saber vibe", label: "hips turned (degrees)", min: 0, max: 25, step: 0.5, value: 7 },
  { key: "vibeCounter", group: "saber vibe", label: "chest against the hips (x)", min: 0, max: 2.5, step: 0.05, value: 1.3 },
  { key: "vibeNod", group: "saber vibe", label: "chest nods into each beat (degrees)", min: 0, max: 15, step: 0.5, value: 4 },
  { key: "vibeShoulders", group: "saber vibe", label: "shoulders drop each beat (degrees)", min: 0, max: 15, step: 0.5, value: 4 },
  { key: "vibeNudge", group: "saber vibe", label: "lean towards the notes' side (degrees)", min: 0, max: 15, step: 0.5, value: 3 },
  { key: "vibeAccent", group: "saber vibe", label: "notes nudge the bounce (x)", min: 0, max: 3, step: 0.05, value: 1 },
  { key: "vibeBig", group: "saber vibe", label: "dip on the light show's big moments (x)", min: 0, max: 3, step: 0.05, value: 1 },
  { key: "vibeCalm", group: "saber vibe", label: "how big, calm", min: 0, max: 2, step: 0.01, value: 0.65 },
  { key: "vibeLively", group: "saber vibe", label: "how big, lively", min: 0, max: 2, step: 0.01, value: 1.05 },
  { key: "vibeHard", group: "saber vibe", label: "in a drop: bigger by (x)", min: 0, max: 2, step: 0.05, value: 0.45 },
  { key: "vibeHardAt", group: "saber vibe", label: "a drop: the song this much busier than usual (x)", min: 1.1, max: 4, step: 0.05, value: 1.6 },
  { key: "vibeFastest", group: "saber vibe", label: "bounces a second, at most", min: 0.5, max: 4, step: 0.05, value: 2.2 },
  { key: "vibeFastestHard", group: "saber vibe", label: "bounces a second at most, in a drop", min: 0.5, max: 5, step: 0.05, value: 2.8 },
  { key: "vibeSpring", group: "saber vibe", label: "spring speed (Hz)", min: 1, max: 10, step: 0.1, value: 4 },
  { key: "vibeSoft", group: "saber vibe", label: "spring damping (higher: smoother)", min: 0.2, max: 1, step: 0.01, value: 0.6 },
  { key: "vibeWander", group: "saber vibe", label: "moves about (x)", min: 0, max: 3, step: 0.05, value: 0.7 },
  { key: "vibeTurn", group: "saber vibe", label: "turns about, up to (degrees)", min: 0, max: 45, step: 1, value: 15 },
  // saber's avatar, line dancing to the song (see line in plugins/saber/public/avatar.js): its 32 counts, a count a
  // beat (half time when the song is fast); how big its steps and kicks, how much it bounces and swings its hips
  { key: "lineStep", group: "saber line dance", label: "step size (x)", min: 0, max: 2, step: 0.05, value: 1 },
  { key: "lineKick", group: "saber line dance", label: "kicks (x)", min: 0, max: 2, step: 0.05, value: 1 },
  { key: "lineBounce", group: "saber line dance", label: "bounce (x)", min: 0, max: 3, step: 0.05, value: 1 },
  { key: "lineHips", group: "saber line dance", label: "hips (x)", min: 0, max: 3, step: 0.05, value: 1 },
  { key: "lineHalf", group: "saber line dance", label: "half time above (bpm)", min: 60, max: 300, step: 1, value: 150 },
  { key: "lineHop", group: "saber line dance", label: "hop on the light show's big moments (x)", min: 0, max: 3, step: 0.05, value: 1 },
];

// (a switch is 0 or 1, off or on: a button on the look pages; a colour is "#rrggbb", and three numbers in the shaders' uniform, in the light's own linear values; every
// colour has a "colour override" beside it: how far it takes the place of vvoid's own, 0 none of the way)
const BY_KEY = new Map(LOOK.map((d) => [d.key, d]));
const clamp = (d, v) => Math.min(d.max, Math.max(d.min, v));
const HEX = /^#[0-9a-f]{6}$/i;
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
let slots = 0;
// (a place in the shaders' uniform only for what the shaders read: the rest are read where they are used)
for (const d of LOOK) if (d.glsl) { d.slot = slots; slots += d.type === "colour" ? 3 : 1; }

export const defaults = () => Object.fromEntries(LOOK.map((d) => [d.key, d.value]));
// the look as turned (the admin's, kept by the server: what the look page shows), and what is seen now:
// that, or a look laid over it a while (a saber platform made from a save: see overLook)
export const lookBase = defaults();
export const look = defaults();
let over = null;

// the shaders' share: one uniform for all of them, and each by name
export const uLook = { value: new Float32Array(slots) };
const named = (d) => (d.type === "colour" ? `vec3(uLook[${d.slot}], uLook[${d.slot + 1}], uLook[${d.slot + 2}])` : `uLook[${d.slot}]`);
export const LOOK_GLSL = `uniform float uLook[${slots}];\n${LOOK.filter((d) => d.glsl).map((d) => `#define LOOK_${d.glsl} ${named(d)}`).join("\n")}\n`;

// only the ones it knows, each held in its range (what came from elsewhere: the server, a file)
export function clean(values) {
  const out = {};
  for (const [key, v] of Object.entries(values ?? {})) {
    const d = BY_KEY.get(key), n = Number(v);
    if (d?.type === "colour") { if (typeof v === "string" && HEX.test(v)) out[key] = v.toLowerCase(); }
    else if (d && Number.isFinite(n)) out[key] = clamp(d, n);
  }
  return out;
}

function apply() {
  Object.assign(look, lookBase, over ?? {});
  for (const d of LOOK) {
    if (d.slot === undefined) continue;
    if (d.type !== "colour") { uLook.value[d.slot] = look[d.key]; continue; }
    const n = parseInt(look[d.key].slice(1), 16);
    uLook.value[d.slot] = linear(((n >> 16) & 255) / 255);
    uLook.value[d.slot + 1] = linear(((n >> 8) & 255) / 255);
    uLook.value[d.slot + 2] = linear((n & 255) / 255);
  }
}
export function setLook(values) {
  Object.assign(lookBase, clean(values));
  apply();
}
// a look laid over the turned one while it lasts (null: none); whatever it leaves out is the turned one's
export function overLook(values) {
  over = values ? clean(values) : null;
  apply();
}
export const lookOver = () => over;
// a save's name, as the server keeps it
export const saveName = (name) => (typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 40) : "");
// what the server keeps, from what it was given (the Tab panel's look page, vvoid's panel, a file): the
// look, the saves by name, and which saves are saber's platforms; whatever it leaves out stays as it was
// { now: the look, saves: { name: a look }, saber: the names of the saves that are saber's platforms }
export const MAX_SAVES = 60;
export function cleanLooks(given, was = { now: {}, saves: {}, saber: [] }) {
  const out = { ...was };
  if (given.now && typeof given.now === "object") out.now = clean(given.now);
  if (given.saves && typeof given.saves === "object") {
    out.saves = {};
    for (const [name, values] of Object.entries(given.saves).slice(0, MAX_SAVES)) {
      const n = saveName(name);
      if (n && values && typeof values === "object") out.saves[n] = clean(values);
    }
  }
  if (Array.isArray(given.saber)) out.saber = [...new Set(given.saber.map(saveName))].filter((n) => n && out.saves[n]);
  else out.saber = out.saber.filter((n) => out.saves[n]);
  return out;
}
apply();
