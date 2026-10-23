// What a plugin says of itself: plugins/<name>/plugin.json, every field of it optional. vvoid names no
// plugin of its own; whatever one is to it (what its portal is called, where it stands, what it plays,
// its knobs on the look page) is said here, by the plugin. Read by the server as it loads the plugins
// (and told to the page with them, /api/plugins) and by vvoid's panel.
//
// {
//   "title": "the radio",    what its portal is called (under the crosshair, as you fly in); else its
//                             README's first heading (# ...), else its folder's name
//   "portal": true,           a portal round the clock (only with a page, public/client.js); false: none
//   "order": 4,               where it stands on the circle: lower first (straight ahead as you arrive the
//                             lowest), those without one after, by name; an admin may place it anywhere
//                             all the same (VVOID_<NAME>_PORTAL)
//   "hole": 104,              how wide its ring's dark sphere is (what the crosshair finds)
//   "formsItself": false,     its portal comes into being its own way (not drawn forming, seen from afar)
//   "named": true,            false: not named under the crosshair (a door that says nothing)
//   "music": false,           what it plays (audio.setMedia) is music: Irrlicht gives off notes to it
//   "panel": { "id": "<name>Panel", "everywhere": false }
//                             its window in the Tab panel: shown in the hub and its own dimensions, or
//                             everywhere (behind a password, only ever in its own dimensions)
//   "looks": [ { "key", "group", "label", "min", "max", "step", "value", "type"? } ]
//                             knobs of its own on the look page (as LOOK in public/src/look.js, but never
//                             the shaders'): read as look[key], kept with vvoid's own
//   "pick": { "label": "...", "about": "..." }
//                             a button by each saved look, choosing it for this plugin (kept in the
//                             server's looks as picked[<name>]: the names of the saves chosen)
// }
import fs from "node:fs/promises";
import path from "node:path";

const TITLE_MAX = 60; // characters, at most
const text = (v, max = TITLE_MAX) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// a look knob as a plugin gives it, if it is one (else null)
function knob(d) {
  if (!d || typeof d !== "object" || !/^\w{1,64}$/.test(d.key ?? "")) return null;
  const base = { key: d.key, group: text(d.group) ?? "plugins", label: text(d.label, 120) ?? d.key };
  if (d.type === "colour") return /^#[0-9a-f]{6}$/i.test(d.value ?? "") ? { ...base, type: "colour", value: d.value.toLowerCase() } : null;
  const min = number(d.min), max = number(d.max), value = number(d.value);
  if (min === undefined || max === undefined || value === undefined || max < min) return null;
  return { ...base, ...(d.type === "switch" && { type: "switch" }), min, max, step: number(d.step) ?? 0.01, value: Math.min(max, Math.max(min, value)) };
}

// what the plugin in dir says of itself, every field filled in
export async function manifestOf(dir, name) {
  let own = {};
  try { own = JSON.parse(await fs.readFile(path.join(dir, "plugin.json"), "utf8")) ?? {}; } catch {} // (none, or not readable: nothing said)
  if (typeof own !== "object" || Array.isArray(own)) own = {};
  const heading = (await fs.readFile(path.join(dir, "README.md"), "utf8").catch(() => "")).match(/^#[ \t]+(.+?)[ \t#]*$/m)?.[1]?.replace(/[`*]/g, "");
  const panel = own.panel && typeof own.panel === "object" ? own.panel : {};
  const pick = own.pick && typeof own.pick === "object" && text(own.pick.label) ? { label: text(own.pick.label), about: text(own.pick.about, 300) ?? "" } : null;
  return {
    name,
    title: text(own.title) ?? text(heading) ?? name,
    portal: own.portal !== false,
    order: number(own.order) ?? null,
    hole: number(own.hole) ?? null,
    formsItself: own.formsItself === true,
    named: own.named !== false,
    music: own.music === true,
    panel: { id: /^[\w-]+$/.test(panel.id ?? "") ? panel.id : `${name}Panel`, everywhere: panel.everywhere === true },
    looks: (Array.isArray(own.looks) ? own.looks : []).map(knob).filter(Boolean),
    pick,
  };
}

// every plugin in the folder (a folder of its own, its name a word), but those left off, with what each says
export async function manifestsIn(plugins, off = new Set()) {
  const entries = (await fs.readdir(plugins, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && /^[\w-]+$/.test(e.name) && !off.has(e.name));
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map((e) => manifestOf(path.join(plugins, e.name), e.name)));
}
