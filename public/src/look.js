// The void's look, as numbers an admin may turn (the Tab panel's look page: see lookPanel in main.js),
// kept by the server for everyone (GET /api/look; PUT, an admin's: see server.js). Each is read where it
// is used: by the shaders (all of them in one uniform, uLook, each by its LOOK_ name: see LOOK_GLSL),
// and by the light worms, the sky and the plugins, every frame, so a change is seen at once. A plugin may
// bring knobs of its own (looks, in its plugin.json: see manifest.js), added with addLooks before the look
// is read, on the server, in the page and in the panel alike.
// (Nothing here may import three: the server reads this file too.)

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
// that, or a look laid over it a while (a plugin's, from a save it was picked: see overLook)
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

// a plugin's knobs (see looks in manifest.js), after vvoid's own: never the shaders' (they are made before
// any plugin is known), never one by a key already taken
export function addLooks(defs) {
  for (const d of defs ?? []) {
    if (!d?.key || BY_KEY.has(d.key)) continue;
    const own = { ...d };
    delete own.glsl;
    LOOK.push(own);
    BY_KEY.set(own.key, own);
    lookBase[own.key] ??= own.value;
    look[own.key] ??= own.value;
  }
  apply();
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
// look, the saves by name, and which saves each plugin has picked (see pick in manifest.js); whatever it
// leaves out stays as it was
// { now: the look, saves: { name: a look }, picked: { plugin: the names of the saves it has picked } }
export const MAX_SAVES = 60;
export const noLooks = () => ({ now: {}, saves: {}, picked: {} });
export function cleanLooks(given, was = noLooks()) {
  const out = { ...was };
  if (given.now && typeof given.now === "object") out.now = clean(given.now);
  if (given.saves && typeof given.saves === "object") {
    out.saves = {};
    for (const [name, values] of Object.entries(given.saves).slice(0, MAX_SAVES)) {
      const n = saveName(name);
      if (n && values && typeof values === "object") out.saves[n] = clean(values);
    }
  }
  const picked = given.picked && typeof given.picked === "object" ? { ...out.picked, ...given.picked } : out.picked ?? {};
  out.picked = {};
  for (const [plugin, names] of Object.entries(picked)) {
    const kept = Array.isArray(names) ? [...new Set(names.map(saveName))].filter((n) => n && out.saves[n]) : [];
    if (/^[\w-]+$/.test(plugin) && kept.length) out.picked[plugin] = kept;
  }
  return out;
}
apply();
