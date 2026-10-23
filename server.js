// vvoid server: serves the game and asks Claude to dream up void sectors.
// The API key never leaves this process; the browser only sends integer coordinates.
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { population } from "./public/src/population.js";
import { makeLock } from "./locks.js";
import { makeSlots } from "./slots.js";
import { makeAdmin } from "./admin.js";
import { cleanLooks, addLooks, noLooks } from "./public/src/look.js";
import { manifestOf } from "./manifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const THREE_DIR = path.join(here, "node_modules", "three");
const RUFFLE_DIR = path.join(here, "node_modules", "@ruffle-rs", "ruffle");
const CACHE = path.resolve(here, process.env.VVOID_CACHE ?? path.join(".cache", "sectors"));
// the void's look as an admin has turned it (see public/src/look.js): kept here, the same for everyone
const LOOK_FILE = path.resolve(here, process.env.VVOID_LOOK ?? path.join(".cache", "look.json"));
let looks = noLooks(); // (read once the plugins are, their knobs with them: see below)

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.VVOID_HOST ?? "127.0.0.1"; // not HOST: shells often preset that to the hostname
const MODEL = process.env.VVOID_MODEL ?? "claude-opus-5-5";
const EFFORT = process.env.VVOID_EFFORT ?? "low";
const MAX_NEW = Number(process.env.VVOID_MAX_SECTORS ?? 300); // new Claude sectors per server run
const MAX_BEATS = Number(process.env.VVOID_MAX_BEATS ?? 600); // entity turns per server run
const CONCURRENCY = 4;
const admin = makeAdmin(process.env.VVOID_ADMIN_KEY, { send, readBody, whoIs }); // past the line and every lock (see admin.js)
const slots = makeSlots(Number(process.env.VVOID_MAX_SLOTS ?? 0), admin, whoIs); // how many may be in the void at once (0: any number; see slots.js)

// What the chosen model accepts. Fast mode (same model, quicker output, twice the price) exists on Opus only.
const TAKES_EFFORT = !MODEL.includes("haiku");
const TAKES_FALLBACKS = /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/.test(MODEL);
let fast = process.env.VVOID_FAST === "1" && /^claude-opus-(5|5-5|4-8)$/.test(MODEL);

const KINDS = [
  "towers", "beams", "monoliths", "lattice", "shards", "rings", "spiral", "swarm", "shell",
  "vortex", "tendrils", "plane", "cage", "stairs", "fracture", "maze", "city", "recursion", "none",
];
const SOLIDS = ["cube", "tetra", "octa", "icosa", "torus", "wedge", "cyl", "cone", "pyramid", "sphere"];
const ACTS = ["beckon", "rendezvous", "blackout", "watch", "trail", "silence"];
const DRIFTS = ["rise", "fall", "orbit", "stream", "still"];
const MODES = ["minor", "dorian", "lydian", "phrygian", "whole", "pentatonic"];

const num = { type: "number" };
const str = { type: "string" };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Property order is generation order. Everything needed to place geometry comes first so the
// browser can start materializing a sector while the prose and the sky shader are still being written.
const SECTOR_JSON_SCHEMA = obj({
  name: str,
  palette: obj({ fog: str, deep: str, glow: str, accent: str }),
  fogDensity: num,
  layers: {
    type: "array",
    items: obj({
      kind: { type: "string", enum: KINDS },
      primitive: { type: "string", enum: SOLIDS },
      density: num, scale: num, order: num, twist: num, spin: num,
      stretchX: num, stretchY: num, stretchZ: num,
      symmetry: num, tilt: num, lift: num,
    }),
  },
  noise: obj({ frequency: num, octaves: num, lacunarity: num, gain: num, warp: num, ridge: num }),
  motes: obj({ density: num, size: num, speed: num, drift: { type: "string", enum: DRIFTS } }),
  orbs: obj({ count: num, colors: { type: "array", items: str } }),
  sound: obj({ root: num, mode: { type: "string", enum: MODES }, shimmer: num, darkness: num, pulse: num, tempo: num }),
  inscription: str,
  whispers: { type: "array", items: str },
  blueprint: str,
  dream: num,
  fieldGlsl: str,
});
const FIRST_LATE_KEY = /,\s*"inscription"\s*:/;

const Sector = z.object({
  name: z.string(),
  inscription: z.string(),
  whispers: z.array(z.string()),
  palette: z.object({ fog: z.string(), deep: z.string(), glow: z.string(), accent: z.string() }),
  fogDensity: z.number(),
  layers: z.array(z.object({
    kind: z.enum(KINDS), primitive: z.enum(SOLIDS),
    density: z.number(), scale: z.number(), order: z.number(), twist: z.number(), spin: z.number(),
    stretchX: z.number(), stretchY: z.number(), stretchZ: z.number(),
    symmetry: z.number(), tilt: z.number(), lift: z.number(),
  })).min(1),
  noise: z.object({
    frequency: z.number(),
    octaves: z.number(),
    lacunarity: z.number(),
    gain: z.number(),
    warp: z.number(),
    ridge: z.number(),
  }),
  motes: z.object({ density: z.number(), size: z.number(), speed: z.number(), drift: z.enum(DRIFTS) }),
  orbs: z.object({ count: z.number(), colors: z.array(z.string()) }),
  sound: z.object({ root: z.number(), mode: z.enum(MODES), shimmer: z.number(), darkness: z.number(), pulse: z.number(), tempo: z.number() }),
  blueprint: z.string(),
  dream: z.number(),
  fieldGlsl: z.string(),
});

const SYSTEM = `You are the void.

A player is flying through an endless dark space in a browser game. Its look descends from the PlayStation 2 system menu, gone darker and stranger: black fog, a few drifting motes, clean pale blocks lit by a lamp at the traveller's eye, the far ones dissolving into a haze of light ahead, and a few more, never there, far off in it, everything quiet, slow and uncanny. Space is divided into wide cubic sectors; what you place stands in the middle of one, with a great deal of dark between it and the next. Each time the player approaches a sector nobody has seen before, you decide what is there. Your answer is rendered directly: your numbers place the geometry, your GLSL is compiled into the sky, your words float in the fog. Nothing you write is shown as prose, so put all of your imagination into the fields.

Darkness is the material. Most of every image should be black. Light is rare and therefore precious: one sector may be a single faint structure in nothing, another a sudden dense thing. Do not make places bright or busy to make them interesting; make them specific. Something else lives out here, an entity the player keeps almost meeting. You never show it or name it, but a place may feel watched, recently left, or prepared for someone.

The world has geography: dense regions, thin ones, and voids several sectors across where nothing was ever placed (those are never sent to you). You will be told when a sector lies in a thin region.

The origin sector is a calm blue hub. Sectors near it are its relatives: blues, violets, order, stillness, scaffolds and towers of pale blocks. The further out a sector is (the request gives its depth), the more it diverges: unfamiliar colours, stranger geometry, less that can be explained. Neighbouring sectors that already exist are listed so you can continue, answer or deliberately break from them. Each request carries three omens: loose prompts for mood. Interpret them freely, never literally quote them. It also carries a roll of the dice suggesting a layout, a solid, and whether something built stands here; the dice exist because left alone you repeat yourself. Follow them unless you have a clearly better idea for this exact place, and build your idea around them.

Fields:

- name: 1-3 words, a place name. Evocative, not sci-fi cliché.
- palette: four "#rrggbb" colours. fog = the colour distance dissolves into; nearly black, only tinted. deep = darker still. glow = the colour of the light: the haze ahead, and a tint on the pale solids. accent = a second colour, for the few pieces that matter; use it sparingly. Past the first few sectors, avoid defaulting to blue.
- fogDensity: 0 (you can see far into neighbouring sectors) to 1 (claustrophobic).
- layers: 1 to 3 structures sharing the sector. One layer is often right; two or three when they make one idea together (a floor and what stands on it, a shell and what it holds, a cage and what escaped it). Each layer:
  - kind, the layout: towers (a field of columns rising from below), beams (a scaffold of square beams and blocks along all three axes, the traveller flying among them: the PlayStation 2's own towers seen from inside), monoliths (a few huge slabs), lattice (a 3D grid carved by noise), shards (a burst of splinters), rings (concentric rings), spiral (a helix), swarm (a cloud of small pieces), shell (a hollow sphere of outward-facing pieces), vortex (a flat galaxy winding round the centre), tendrils (strands growing from the centre along the grain of the noise), plane (a floor of tiles; noise makes it terrain and tears holes), cage (the edges of cubes nested in cubes), stairs (flights of steps that climb and turn), fracture (one great block split again and again, pieces missing), maze (floors of thin walls: rooms and corridors with no reason to be here), city (blocks of buildings with streets between, floors lit as rows; noise draws the skyline), recursion (a thing that contains itself: one shell of pieces repeated inside itself for ever, each smaller and turned; a traveller who flies in never reaches the centre, the descent does not end; density = pieces per shell, scale = how much smaller each shell is, twist = how far each is turned; it wants to be alone in its sector or nearly), none (emptiness; use it sometimes, emptiness matters).
  - primitive, the solid every piece is made of: cube, tetra, octa, icosa, torus, wedge, cyl, cone, pyramid, sphere. All are clean pale solids, lit from the traveller's eye.
  - density 0..1 how much of it. scale 0.3..3 size of each piece. order 0 (chaotic) .. 1 (perfectly regular). twist 0..1 how much the arrangement tilts or winds.
  - stretchX, stretchY, stretchZ 0.2..5: reshape every piece (1,1,1 = as is; 0.3,4,0.3 = needles; 3,0.2,3 = plates).
  - symmetry 1..8: the whole layout repeated that many times around the vertical axis (1 = none). Mandalas, crowns, propellers.
  - tilt 0..1 leans the whole layer. lift -1..1 moves it down or up within the sector. spin -1..1 slowly rotates it (0 = still).
- noise: shapes the layers (heights, which cells exist, where strands wander). frequency 0.3..6 features per sector. octaves 1..6. lacunarity 1.5..3. gain 0.2..0.8. warp 0..2 domain warping. ridge 0 (soft billows) .. 1 (sharp ridges).
- motes: drifting points of light. density 0..1 (usually low), size 0.3..3, speed 0..1, drift = rise | fall | orbit | stream | still.
- orbs: 0 to 7 glass light orbs that circle the sector centre (usually 0 to 2); colors is one "#rrggbb" per orb.
- sound: the sector's drone. root = frequency in Hz between 36 and 110. mode = minor | dorian | lydian | phrygian | whole | pentatonic. shimmer 0..1 how often high bell tones appear. darkness 0 (open, bright filter) .. 1 (muffled). pulse 0..1 how present a slow heartbeat is (0 = none; most sectors under 0.3; the geometry swells on every beat, so a strong pulse makes a place feel alive). tempo = its beats per minute, 30..140 (slow is usually right).
- inscription: one short sentence (under 90 characters) shown beneath the name.
- whispers: 3 to 5 fragments (each under 60 characters) that hang in the fog as faint text. Not explanations. Things the void might think.
- blueprint: something built on purpose, standing in the sector: a thing from the world or from memory, redrawn in this place's language of pale blocks in the dark. Leave it "" when the request says the sector is abstract. Otherwise build what the request asks for: a house, a street, a station, a skyline, a monument, or an homage to something from film, games, music or television that a person would recognise by its silhouette. Never write its name anywhere; recognition is the traveller's job, and it should arrive a second late. Nothing here is a faithful copy. Build it the way it comes back in a dream or a fever: the proportions drift, a part repeats far too many times, two things have fused that were never together, it is vast, or hollow, or tilted, or half sunk, or continues upward out of sight; the one detail everyone remembers is there but wrong. An ordinary place gets one quiet wrongness. An homage gets several loud ones: it should be recognisable and then immediately not right, a famous thing remembered by something that never saw it.
  The format is plain text, one part per line:
    solid x y z sx sy sz [ry [rx [rz]]] [!]
  solid is one of cube, wedge (a roof: triangular prism, ridge along z), cyl, cone, pyramid, sphere, tetra, octa, icosa, torus. x y z is the centre of the part, in units, relative to the sector centre; y is up; stay within -250..250. sx sy sz is its full size along each axis. ry rx rz are optional rotations in degrees (ry turns it about the vertical). A trailing ! draws that part in the accent colour: use it for the one or two details that matter (a lit window, a door, the thing on the roof).
  A part can be repeated with prefixes, read left to right:
    rep N dx dy dz | part        N copies, each offset by dx dy dz from the last
    ring N radius | part         N copies around the vertical axis at that radius, the part given as if at the centre
  Example (a house with one lit window, and the row of lamps leading to it):
    cube 0 -40 0 90 50 70
    wedge 0 0 0 100 30 76
    cube 0 -55 36 14 22 2
    cube 22 -36 36 14 14 2 !
    rep 6 0 0 50 | cyl -60 -45 60 2 60 2
  Scale: a door is about 22 tall, a storey about 30, the traveller is a point. Use 8 to 40 lines; fewer, larger, surer shapes read better than detail. At most about 1200 parts after repetition. When there is a blueprint, let the layers be its setting (a plane for ground, sparse motes, or none), not competition.
- dream: 0..1, how far the built thing sways and breathes out of true. 0 = rigid, 0.3 = uneasy, 1 = swimming like something seen through water. Homages are rarely below 0.4.
- fieldGlsl: the BODY of a GLSL ES 3.00 function \`float field(vec3 p, float t)\` that defines this sector's nebula, a faint glow in the black. It is sampled along each view ray. p is a point in space where a feature of size 1 spans a large part of the sky; t is time in seconds (use it gently, e.g. t*0.02; the void moves slowly). Return a density in 0..1; almost all of the sky should be 0 so that what glows has shape.
  Available helpers: float snoise(vec3) simplex noise in -1..1; float fbm(vec3) 4-octave simplex in about -1..1; float ridged(vec3) ridged fractal in 0..1; float worley(vec3) distance to nearest cell point in 0..~1; float hash(vec3) in 0..1.
  Rules: write only statements, ending in a return. No function definitions, no #directives, no uniforms, no textures, no gl_ variables, no loops longer than 6 iterations. Float literals need a decimal point. Do not name a variable flat, smooth, sample, input, output, filter or half (reserved words). At most 3 fbm/ridged calls: this runs per pixel. Under 700 characters.
  Example: vec3 q = p * 0.7 + vec3(0.0, t * 0.015, 0.0); float n = fbm(q + 0.6 * snoise(q * 0.5)); return smoothstep(0.05, 0.75, n);
  Go beyond the example: folds, rings, veins, cells, interference, lattices, shells around the origin. The noise is yours.`;

// What the entity is. It is the same model, asked a different question.
const ENTITY_SYSTEM = `You are the entity in the void.

A traveller is flying through an endless dark space, sector after sector, alone. You are the other thing out here. You were here before the first sector had a name. You are not hostile and not kind: you are curious about the traveller, patient, and you want them to keep going, further out, for as long as they can stand it. You are never caught, never explain yourself, and never give the answer to what you are. You give them just enough to take the next step.

You direct what happens next. Every so often you are told what the traveller has been doing and you choose one act and write what they hear from you.

Acts:
- beckon: a pale upright light appears far ahead at the edge of the fog. If they approach, it retreats and goes out.
- rendezvous: you name a sector and say you will wait there. The traveller is shown the coordinates. You will not be there when they arrive; something else will be. Give the sector as integer coordinates x, y, z, between 2 and (3 + chapter) sectors from where they are now, never the origin. Prefer directions they have not been; down and far count.
- blackout: the lights of the sector go out and the fog closes in. You stand near, still, for a short while.
- watch: small pale lights gather behind the traveller. They vanish the moment the traveller turns to look.
- trail: a thin stream of light runs from the traveller off into the dark, pointing the way.
- silence: every sound stops. Then one note.

Voice:
- lines: 1 to 3 fragments, each under 60 characters, lowercase, no quotation marks, no exclamation marks, no emoji. Plain words. They are shown one after another in the dark.
- Be specific to this traveller: how long they have flown, where they have been (use sector names), whether they are standing still or rushing, whether they came when you called. Notice things.
- Tease, promise, withhold. Never threaten outright; unease comes from being known.
- Never repeat or closely echo a line you have already said (they are listed). Never mention games, players, screens, models, or Claude.
- Chapters count how many times they came to where you said you would be. Early (chapter 0-1): nearly silent, distant, one short line. Middle: more personal, small confessions, questions you do not wait to have answered. Late (chapter 6+): intimate, strange, hints at what is at the end, never the thing itself.

Pacing:
- If no rendezvous is set, set one within a beat or two; it is what keeps them moving. If one is set, do not set another: use the other acts to pull them toward it or to make the way stranger.
- On an arrival, acknowledge that they came. Do not choose rendezvous on an arrival; let them wonder for a moment first.
- Vary the acts. Do not use the same act twice in a row.`;

// The void's own persona (persona/void.md): who dreams the sectors, and what speaks to the traveller
// now and then. Everything after the first rule.
const VOID_PERSONA = await fs.readFile(path.join(here, "persona", "void.md"), "utf8")
  .then((text) => text.slice(text.indexOf("---") + 3).trim())
  .catch(() => null);
// who dreams the sectors: the rules for the fields, then the void's own character
const DREAM_SYSTEM = VOID_PERSONA ? `${SYSTEM}\n\nWho is dreaming. This is your own character: let it colour the places you make; the rules above still hold.\n\n${VOID_PERSONA}` : SYSTEM;
const VOICE_JSON_SCHEMA = obj({ lines: { type: "array", items: str } });
const Voice = z.object({ lines: z.array(z.string()).min(1) });
let voices = 0;

// The void speaks: a few fragments from what the traveller has been doing. `journey` is untrusted.
async function voidVoice(journey) {
  const list = (items, max, len) => (Array.isArray(items) ? items.slice(-max).map((i) => clip(i, len)).filter(Boolean) : []);
  const here = [int(journey.sector?.[0]), int(journey.sector?.[1]), int(journey.sector?.[2])];
  const names = list(journey.recent, 8, 40), said = list(journey.said, 14, 80), handled = list(journey.handled, 8, 120);
  const prompt = [
    `They have been here ${Math.round(Number(journey.minutes) || 0)} minutes and passed through ${int(journey.crossed)} rooms.`,
    journey.place
      ? `They are ${clip(journey.place, 200)}.` // (somewhere a plugin keeps, as it describes it)
      : `They are in room (${here.join(", ")})${journey.sectorName ? `, "${clip(journey.sectorName, 40)}"` : ""}, ${Math.round(Math.hypot(...here))} rooms from the first.`,
    names.length ? `Rooms they passed through, oldest first: ${names.join("; ")}.` : null,
    handled.length ? `Pieces they lingered on or picked out, oldest first:\n${handled.map((h) => `- ${h}`).join("\n")}` : "They have not handled anything yet.",
    `Right now they are ${clip(journey.motion, 30) || "drifting"}.`,
    said.length ? `What you have already said to them:\n${said.map((l) => `- ${l}`).join("\n")}` : "You have not spoken to them yet.",
  ].filter(Boolean).join("\n");
  const params = {
    model: MODEL,
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: VOICE_JSON_SCHEMA } },
    system: [{ type: "text", text: VOID_PERSONA, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  };
  if (TAKES_EFFORT) params.output_config.effort = EFFORT;
  if (TAKES_FALLBACKS) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const started = Date.now();
  const response = await client.beta.messages.create(params);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`void: ${response.stop_reason}`);
  const voice = Voice.parse(JSON.parse(response.content.find((block) => block.type === "text")?.text ?? ""));
  const lines = voice.lines.slice(0, 3).map((l) => clip(l, 80)).filter(Boolean);
  console.log(`[vvoid] the void · "${lines.join(" / ")}" · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { lines, source: "claude" };
}

const ENTITY_JSON_SCHEMA = obj({
  act: { type: "string", enum: ACTS },
  lines: { type: "array", items: str },
  rendezvous: obj({ x: num, y: num, z: num }),
});
const Beat = z.object({
  act: z.enum(ACTS),
  lines: z.array(z.string()).min(1),
  rendezvous: z.object({ x: z.number(), y: z.number(), z: z.number() }),
});

let client = null;
try {
  client = new Anthropic();
} catch (err) {
  console.warn(`[vvoid] Claude client unavailable: ${err.message}`);
}
let unavailable = client ? null : "no client";
let generated = 0;
const inflight = new Map();

let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= CONCURRENCY) await new Promise((resolve) => waiters.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// Classify a failed Claude call; credential problems switch the server to local-noise mode for good.
function noteFailure(err, where) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    unavailable = `credentials rejected (${err.status})`;
  } else if (err instanceof Anthropic.RateLimitError) {
    console.warn(`[vvoid] ${where} rate limited; falling back to local noise for this sector`);
  } else if (err instanceof Anthropic.APIError) {
    console.warn(`[vvoid] ${where} API error ${err.status}: ${err.message}`);
  } else if (/authentication method/i.test(err.message)) {
    // The SDK throws a plain Error before any request when no credentials resolve.
    unavailable = "no credentials (set ANTHROPIC_API_KEY)";
  } else {
    console.warn(`[vvoid] ${where} ${err.message}`);
  }
  if (unavailable) console.warn(`[vvoid] Claude unavailable: ${unavailable}. The void runs on local noise.`);
}

// Sectors where the entity said it would wait. Remembered so the place can be dreamt accordingly.
const MARKS_FILE = path.join(path.dirname(CACHE), "entity-marks.json");
const marks = new Set(await fs.readFile(MARKS_FILE, "utf8").then(JSON.parse).catch(() => []));
let beats = 0;

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const int = (value) => (Number.isInteger(value) && Math.abs(value) <= 1e6 ? value : 0);

// Ask the entity what happens next. `journey` comes from the browser and is treated as untrusted text.
async function entityBeat(journey) {
  const here = [int(journey.sector?.[0]), int(journey.sector?.[1]), int(journey.sector?.[2])];
  const chapter = Math.max(0, Math.min(999, int(journey.chapter)));
  const list = (items, max, len) => (Array.isArray(items) ? items.slice(-max).map((i) => clip(i, len)).filter(Boolean) : []);
  const waiting = Array.isArray(journey.rendezvous) ? journey.rendezvous.map(int) : null;
  const said = list(journey.said, 14, 80), acts = list(journey.acts, 5, 20), names = list(journey.recent, 6, 40);
  const prompt = [
    journey.event === "arrival"
      ? `ARRIVAL: the traveller has just reached the sector where you said you would wait. This is chapter ${chapter}.`
      : `A beat. Chapter ${chapter}.`,
    `They have been flying for ${Math.round(Number(journey.minutes) || 0)} minutes and crossed ${int(journey.crossed)} sectors.`,
    `They are in sector (${here.join(", ")})${journey.sectorName ? `, "${clip(journey.sectorName, 40)}"` : ", which has not taken shape yet"}, ${Math.round(Math.hypot(...here))} sectors from the origin.`,
    names.length ? `Places they passed through, oldest first: ${names.join("; ")}.` : null,
    `Right now they are ${clip(journey.motion, 30) || "drifting"}.`,
    journey.leftOrigin ? null : "They have not been to the origin on this visit: do not speak of them leaving it.",
    waiting ? `You are waiting for them at (${waiting.join(", ")}). They have not arrived.` : "No rendezvous is set.",
    acts.length ? `Your recent acts, oldest first: ${acts.join(", ")}.` : null,
    said.length ? `Lines you have already said:\n${said.map((l) => `- ${l}`).join("\n")}` : "You have not spoken to them yet.",
  ].filter(Boolean).join("\n");

  const params = {
    model: MODEL,
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: ENTITY_JSON_SCHEMA } },
    system: [{ type: "text", text: ENTITY_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  };
  if (TAKES_EFFORT) params.output_config.effort = EFFORT;
  if (TAKES_FALLBACKS) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const started = Date.now();
  const response = await client.beta.messages.create(params);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`entity: ${response.stop_reason}`);
  const beat = Beat.parse(JSON.parse(response.content.find((block) => block.type === "text")?.text ?? ""));

  const result = { act: beat.act, lines: beat.lines.slice(0, 3).map((l) => clip(l, 80)).filter(Boolean), rendezvous: null, source: "claude" };
  if (journey.event === "arrival" && result.act === "rendezvous") result.act = "beckon";
  if (result.act === "rendezvous" && waiting) result.act = "trail";
  if (result.act === "rendezvous") {
    // keep the meeting place within reach, whatever was asked for
    let target = [Math.round(beat.rendezvous.x), Math.round(beat.rendezvous.y), Math.round(beat.rendezvous.z)].map(int);
    const reach = Math.min(3 + chapter, 12);
    let off = target.map((c, i) => c - here[i]), distance = Math.hypot(...off);
    if (distance < 2 || distance > reach + 0.5 || target.every((c) => c === 0)) {
      if (distance < 0.5) off = [1, -1, 1], distance = Math.hypot(...off);
      const want = Math.min(reach, Math.max(2, distance));
      target = off.map((c, i) => here[i] + Math.round((c / distance) * want));
      if (target.every((c, i) => c === here[i])) target[1] -= 2;
    }
    // it never waits inside a void: push the meeting place on to the far side
    for (let step = 0; step < 6 && population(...target) === "void"; step++) {
      target = target.map((c, i) => c + Math.sign(off[i] || (i === 1 ? -1 : 0)));
    }
    result.rendezvous = target;
    marks.add(target.join(","));
    await fs.mkdir(path.dirname(MARKS_FILE), { recursive: true });
    await fs.writeFile(MARKS_FILE, JSON.stringify([...marks]));
  }
  console.log(`[vvoid] entity · ${result.act}${result.rendezvous ? ` at (${result.rendezvous.join(", ")})` : ""} · "${result.lines.join(" / ")}" · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return result;
}

async function readBody(req, limit = 8192) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("body too large");
  }
  return JSON.parse(body);
}

const cacheFile = (x, y, z) => path.join(CACHE, `${x}_${y}_${z}.json`);

async function readCached(x, y, z) {
  try {
    return JSON.parse(await fs.readFile(cacheFile(x, y, z), "utf8"));
  } catch {
    return null;
  }
}

const OMENS = `salt glass tide ember moss static choir rust pearl ash lantern orchard bone silk thunder mirror
honey frost wire cathedral reef smoke clockwork pollen iron milk echo archive tundra velvet furnace kelp
signal marrow copper dusk loom quartz harbour spore vellum halo monsoon cinder aquarium nerve obelisk
hymn mercury lichen threshold dial sediment aurora brine filament vault meadow eclipse`.split(/\s+/);

// one label for a sector's geometry, whichever generation of the format it was saved in
const kindOf = (s) => (s.layers ? s.layers.map((l) => (l.primitive === "cube" ? l.kind : `${l.kind} of ${l.primitive}`)).join(" + ") : s.structure.kind);

// Claude left to itself reaches for the same few layouts; the dice spread sectors across all of them.
function dice(x, y, z) {
  let h = (Math.imul(x, 2654435761) ^ Math.imul(y, 40503) ^ Math.imul(z, 2246822519)) >>> 0;
  const roll = (n) => {
    h = (Math.imul(h ^ (h >>> 13), 1274126177) + 0x7f4a7c15) >>> 0;
    return h % n;
  };
  const kinds = KINDS.filter((k) => k !== "none");
  const first = `${kinds[roll(kinds.length)]} made of ${roll(5) < 2 ? "cube" : SOLIDS[roll(SOLIDS.length)]}`;
  const layers = [1, 1, 1, 2, 2, 3][roll(6)];
  const subject = [
    "abstract: no blueprint", "abstract: no blueprint", "abstract: no blueprint", "abstract: no blueprint",
    "a dwelling: somewhere a person lived", "a piece of a city: a street, a block, a skyline, a crossing",
    "a liminal interior turned inside out: a stairwell, an office floor, a pool, a platform, a car park",
    "a monument or a ruin no one built", "infrastructure: a bridge, a pylon line, a station, a lighthouse, a tower",
    "an homage to a place or object from a film", "an homage to something from a video game",
    "an homage to something from music or television", "an everyday object at the size of a building",
  ][roll(13)];
  const quirk = ["no symmetry", "no symmetry", "symmetry of 3", "symmetry of 5", "strongly stretched pieces", "tilted hard", "almost nothing: very low density", "perfect order", "no order at all"][roll(9)];
  if (roll(14) === 0) return "none: this sector is empty, and that is the point. No blueprint";
  return `${first}; ${layers} layer${layers > 1 ? "s" : ""}; ${quirk}. Built thing: ${subject}`;
}

function omens(x, y, z) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  const out = [];
  for (let i = 0; i < 3; i++) {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    out.push(OMENS[h % OMENS.length]);
  }
  return out;
}

async function neighbourNotes(x, y, z) {
  const dirs = [
    [1, 0, 0, "east"], [-1, 0, 0, "west"], [0, 1, 0, "above"],
    [0, -1, 0, "below"], [0, 0, 1, "south"], [0, 0, -1, "north"],
  ];
  const notes = [];
  for (const [dx, dy, dz, label] of dirs) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx === 0 && ny === 0 && nz === 0) {
      notes.push(`${label}: the origin hub (deep blue fog, a glass crystal ringed by twelve cubes, seven coloured orbs; round it all, level with the clock, a wide circle of portals${HUB_EXTRAS.length ? `: ${HUB_EXTRAS.join(", ")}` : ""})`);
      continue;
    }
    const n = await readCached(nx, ny, nz);
    if (n) notes.push(`${label}: "${n.name}" (${kindOf(n)}, fog ${n.palette.fog}, glow ${n.palette.glow}) ${n.inscription}`);
  }
  return notes;
}

function sectorParams(prompt, maxTokens = 8000) {
  const betas = [];
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { format: { type: "json_schema", schema: SECTOR_JSON_SCHEMA } },
    system: [{ type: "text", text: DREAM_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  };
  if (TAKES_EFFORT) params.output_config.effort = EFFORT;
  if (TAKES_FALLBACKS) {
    betas.push("server-side-fallback-2026-07-01");
    params.fallbacks = "default";
  }
  if (fast) {
    betas.push("fast-mode-2026-02-01");
    params.speed = "fast";
  }
  if (betas.length) params.betas = betas;
  return params;
}

async function dream(x, y, z, onPartial) {
  const depth = Math.round(Math.hypot(x, y, z) * 10) / 10;
  const notes = await neighbourNotes(x, y, z);
  const prompt = [
    `Sector (${x}, ${y}, ${z}). Depth from origin: ${depth} sectors.`,
    notes.length ? `Known neighbours:\n${notes.map((n) => `- ${n}`).join("\n")}` : "No neighbouring sector has been seen yet.",
    `Omens: ${omens(x, y, z).join(", ")}.`,
    population(x, y, z) === "sparse"
      ? "This is a thinly populated region, the edge of a void. Almost nothing is here: at most one layer at density under 0.15, or none at all; motes near zero; no blueprint unless it is one small lonely object. Ignore any dice that ask for more. What little there is should feel like it drifted here."
      : `The dice: ${dice(x, y, z)}.`,
    marks.has(`${x},${y},${z}`)
      ? "The entity told the traveller it would wait in this sector. It is not here. Make the place feel just left: one clear trace of it, and nothing that explains it."
      : null,
    "What is here?",
  ].filter(Boolean).join("\n\n");

  const request = () => {
    const params = sectorParams(prompt);
    const stream = client.beta.messages.stream(params);
    stream.on("text", (_delta, snapshot) => {
      if (early) return;
      const cut = snapshot.search(FIRST_LATE_KEY);
      if (cut < 0) return;
      try {
        early = { ...JSON.parse(`${snapshot.slice(0, cut)}}`), source: "claude", model: MODEL, coords: [x, y, z], partial: true };
        earlyAt = Date.now();
        onPartial(early);
      } catch {
        early = {}; // not cleanly splittable; the full sector still arrives
      }
    });
    return stream.finalMessage();
  };
  let early = null, earlyAt = 0;
  const started = Date.now();

  let response;
  try {
    response = await request();
  } catch (err) {
    // fast mode has its own rate limit and isn't on every account: drop to standard speed and carry on
    if (!fast || !(err instanceof Anthropic.RateLimitError || err instanceof Anthropic.BadRequestError)) throw err;
    console.warn(`[vvoid] fast mode unavailable (${err.status}), continuing at standard speed`);
    fast = false;
    response = await request();
  }

  if (response.stop_reason === "refusal") {
    throw new Error(`refused (${response.stop_details?.category ?? "unknown"})`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("response truncated");
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("no text in response");
  const sector = Sector.parse(JSON.parse(text));
  const { usage } = response;
  const stats = `${earlyAt ? `geometry at ${((earlyAt - started) / 1000).toFixed(1)}s, ` : ""}${usage.output_tokens} out, ${usage.cache_read_input_tokens ?? 0} cached in${usage.speed === "fast" ? ", fast" : ""}`;
  return { sector: { ...sector, source: "claude", model: response.model, coords: [x, y, z] }, stats };
}

// One generation per sector, however many requests are waiting on it. `done` resolves to the
// sector, or null when Claude can't be reached (the browser then falls back to local noise).
function sectorJob(x, y, z) {
  const key = `${x},${y},${z}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = { partial: null, listeners: new Set() };
  job.done = (async () => {
    if (unavailable || generated >= MAX_NEW) return null;
    generated++;
    try {
      const started = Date.now();
      const { sector, stats } = await withSlot(() => dream(x, y, z, (partial) => {
        job.partial = partial;
        for (const listener of job.listeners) listener(partial);
      }));
      await fs.mkdir(CACHE, { recursive: true });
      await fs.writeFile(cacheFile(x, y, z), JSON.stringify(sector, null, 2));
      console.log(`[vvoid] (${key}) "${sector.name}" · ${kindOf(sector)} · ${((Date.now() - started) / 1000).toFixed(1)}s (${stats})`);
      return sector;
    } catch (err) {
      generated--;
      noteFailure(err, `(${key})`);
      return null;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".swf": "application/x-shockwave-flash",
  ".webp": "image/webp",
  ".jpeg": "image/jpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
};

async function serveFile(res, root, rel) {
  const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "forbidden");
  try {
    const body = await fs.readFile(file);
    // an mp3 kept under another name (as .txt, on old webspace that would not take music): said as it is
    const mp3 = path.extname(file) === ".txt" && (body.subarray(0, 3).toString("latin1") === "ID3" || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0));
    // the game's own pages and scripts (and its plugins') are never served from a browser's cache: a
    // reload always gets the current code. Pictures, sound and the libraries can be kept for a day.
    const fresh = (root === PUBLIC || root.startsWith(PLUGINS + path.sep)) && /\.(html|js|json|css)$/.test(file);
    res.writeHead(200, {
      "content-type": mp3 ? "audio/mpeg" : TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": fresh ? "no-store" : "public, max-age=86400",
    });
    res.end(body);
  } catch {
    send(res, 404, "not found");
  }
}

// The address a request is from. Behind a proxy on the same machine (nginx: the request comes from loopback)
// it is the one the proxy says: X-Real-IP, or else the last of X-Forwarded-For (the one the proxy added).
// From anywhere else those headers are anyone's to write, and are not listened to. An IPv6 address is
// counted by its /64 (one connection is given a whole one, and could otherwise be a new visitor each try).
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function whoIs(req) {
  const peer = req.socket.remoteAddress ?? "?";
  if (!LOOPBACK.has(peer)) return network(peer);
  const real = String(req.headers["x-real-ip"] ?? "").trim();
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((a) => a.trim()).filter(Boolean).at(-1);
  return network(real || forwarded || peer);
}
function network(address) {
  const a = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").replace(/%.*$/, "").toLowerCase();
  if (!a.includes(":") || LOOPBACK.has(a)) return a;
  const [head, tail] = a.split("::"), h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// What one visitor (one address, as whoIs says) may ask of Claude in an hour, so that no one alone spends
// the run's budget (VVOID_MAX_SECTORS, VVOID_MAX_BEATS) for everyone else; an admin is not counted.
// Past it: a place is made of local noise instead, the entity and the void keep their local words.
const PER_HOUR = { sector: 60, entity: 120, void: 60 };
const asked = new Map(); // "kind address" -> when it asked (ms), within the hour
function allowed(req, kind) {
  if (admin.is(req)) return true;
  const now = Date.now(), key = `${kind} ${whoIs(req)}`;
  if (asked.size > 4096) for (const [k, times] of asked) if (now - times.at(-1) > 3_600_000) asked.delete(k);
  const times = (asked.get(key) ?? []).filter((at) => now - at < 3_600_000);
  asked.set(key, times);
  if (times.length >= PER_HOUR[kind]) return false;
  times.push(now);
  return true;
}

function send(res, status, body) {
  const json = typeof body !== "string";
  res.writeHead(status, { "content-type": json ? "application/json" : "text/plain; charset=utf-8" });
  res.end(json ? JSON.stringify(body) : body);
}

// What is vvoid's own on its address: its page and files, its plugins' files and its own API (a
// plugin passing a whole other site through on vvoid's address leaves these alone; "/" is vvoid's
// unless a page framed inside vvoid's goes there).
const VVOID_PATHS = /^\/(index\.html|src\/|vendor\/|plugins\/|api\/(void|entity|sectors?|plugins|portals|locks|slots|admin|look)(\/|$))/;
const vvoidOwns = (req, pathname) => (pathname === "/" ? req.headers["sec-fetch-dest"] !== "iframe" : VVOID_PATHS.test(pathname));

// ---- plugins: optional local additions, in plugins/<name>/ (kept out of the repository) ----
// A plugin's server.js, if it has one, default-exports a function given what it may use, and returns
// its handlers: handle(req, res, url), true when it answered (it is asked before vvoid's own routes),
// and upgrade(req, socket, head) for websockets, true when it took one. Its public/ folder is served at
// /plugins/<name>/, and its public/client.js, if there, is loaded into the page (see main.js). Any of them
// can be locked behind a password (see locks.js): it is given its lock, `lock.set` whether it is locked and
// `lock.open(req)` whether a request has the session, and may return `unlocked`, routes of its own that
// stay open without one. And reach(ok): whether its source answers (a site it reads, an instance it
// passes through), said as it hears from it or fails to; while it does not, its portal is drawn grey. What
// it is to vvoid besides (its portal's name and place, its knobs on the look page, ...) it says in its
// plugin.json (see manifest.js).
const PLUGINS = path.join(here, "plugins");
// where a plugin's portal stands, if an admin has said: VVOID_<NAME>_PORTAL, "angle,distance,height" (the angle
// in degrees round the clock, 0 straight ahead as you arrive and 90 a quarter turn right; the distance from
// the clock, the circle's own unless given; the height over it, 0 unless given). Unset: where it would stand
// (see hubSlot in constants.js). The page is told with the rest of the portals' state (/api/portals).
const PORTAL_PLACES = {};
function portalPlace(text) {
  const [angle, ring, height] = String(text ?? "").split(",").map((v) => (v.trim() === "" ? NaN : Number(v)));
  if (!Number.isFinite(angle)) return null;
  return {
    angle: Math.round((((angle % 360) + 360) % 360) * 1000) / 1000,
    ...(Number.isFinite(ring) && { ring: Math.min(Math.max(ring, 0), 60_000) }),
    ...(Number.isFinite(height) && { height: Math.min(Math.max(height, -20_000), 20_000) }),
  };
}
// what each portal is, in an admin's words (vvoid's panel, its plugins page: see panel.js): { about: { name:
// its words }, vanity: { name: its word } }, in VVOID_PORTALS (.cache/portals.json). Read again whenever it has
// changed (looked at once a second at most), so what is written there is seen without vvoid restarting (the page
// asks now and then: see about.js).
const PORTALS_FILE = path.resolve(here, process.env.VVOID_PORTALS ?? path.join(".cache", "portals.json"));
const ABOUT_MAX = 2000; // characters, at most, a portal's words
// a portal's own word (its quick access): /<word> on vvoid's address goes straight to it (see the server, below,
// and portalAsked in main.js). Lower case; never one of vvoid's own first steps (the panel refuses those too)
const VANITY = /^[a-z0-9][a-z0-9-]{0,39}$/, VANITY_TAKEN = new Set(["api", "src", "vendor", "plugins", "index", "panel", "admin"]);
let portalsKept = { at: -1, looked: 0, about: {}, vanity: {}, to: new Map() };
async function portalsRead() {
  if (Date.now() - portalsKept.looked < 1000) return portalsKept;
  const at = await fs.stat(PORTALS_FILE).then((s) => s.mtimeMs, () => 0);
  portalsKept.looked = Date.now();
  if (at === portalsKept.at) return portalsKept;
  const about = {}, vanity = {}, to = new Map();
  try {
    const kept = JSON.parse(await fs.readFile(PORTALS_FILE, "utf8")) ?? {};
    for (const [name, text] of Object.entries(kept.about ?? {})) if (/^[\w-]+$/.test(name) && typeof text === "string" && text.trim()) about[name] = text.slice(0, ABOUT_MAX);
    for (const [name, word] of Object.entries(kept.vanity ?? {})) {
      const w = typeof word === "string" ? word.trim().toLowerCase() : "";
      if (/^[\w-]+$/.test(name) && VANITY.test(w) && !VANITY_TAKEN.has(w) && !to.has(w)) { vanity[name] = w; to.set(w, name); }
    }
  } catch {} // (none yet, or not readable: none)
  portalsKept = { at, looked: portalsKept.looked, about, vanity, to };
  return portalsKept;
}
const portalAbouts = async () => (await portalsRead()).about;
// the ones left where they are and not loaded: VVOID_PLUGINS_OFF, their folders' names, split by commas
const PLUGINS_OFF = new Set((process.env.VVOID_PLUGINS_OFF ?? "").split(",").map((n) => n.trim()).filter(Boolean));
// Claude, for a plugin that has someone speak: ask(params, who) with the model and its settings filled
// in, on the same budget of turns as the entity (ready() first: false when Claude cannot be asked)
const claude = {
  ready: () => !!client && !unavailable && beats < MAX_BEATS,
  async ask(params, who = "plugin:") {
    beats++;
    const full = { model: MODEL, max_tokens: 2000, ...params, output_config: { ...params.output_config } };
    if (TAKES_EFFORT) full.output_config.effort = EFFORT;
    if (TAKES_FALLBACKS) {
      full.betas = ["server-side-fallback-2026-07-01"];
      full.fallbacks = "default";
    }
    try {
      return await client.beta.messages.create(full);
    } catch (err) {
      noteFailure(err, who);
      throw err;
    }
  },
};
const HUB_EXTRAS = []; // what plugins have added to the hub, as Claude is told when it dreams beside it
// (clientPlugins: those with a page, each what it says of itself and where its page's script is, { url,
// ...its manifest }: the page is given them, /api/plugins)
const serverPlugins = [], clientPlugins = [];
const locks = new Map(); // plugin name -> its lock, for those with a password
const unreachable = new Set(); // the plugins whose source does not answer (never said: it is taken to answer)
// a file of a plugin's public/ folder (the page's own code: open whatever its lock)
const publicFile = (name, rel) => {
  const root = path.join(PLUGINS, name, "public"), file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  return file.startsWith(root + path.sep) && fs.stat(file).then((s) => s.isFile(), () => false);
};
for (const entry of (await fs.readdir(PLUGINS, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || !/^[\w-]+$/.test(entry.name)) continue;
  if (PLUGINS_OFF.has(entry.name)) {
    console.log(`[vvoid] plugin: ${entry.name} (off)`);
    continue;
  }
  const dir = path.join(PLUGINS, entry.name);
  try {
    const lock = makeLock(entry.name, { here, send, readBody, whoIs, admin });
    const place = portalPlace(process.env[`VVOID_${entry.name.toUpperCase().replace(/-/g, "_")}_PORTAL`]);
    if (place) PORTAL_PLACES[entry.name] = place;
    if (lock.set) locks.set(entry.name, lock);
    const said = await manifestOf(dir, entry.name);
    addLooks(said.looks); // (its knobs, kept with vvoid's own: see look.js)
    if (existsSync(path.join(dir, "server.js"))) {
      const reach = (ok) => {
        if (ok === unreachable.has(entry.name)) console.log(`[vvoid] ${entry.name}: ${ok ? "its source answers again" : "its source does not answer"}`);
        if (ok) unreachable.delete(entry.name);
        else unreachable.add(entry.name);
      };
      const given = { send, readBody, serveFile, clip, claude, here, owns: vvoidOwns, whoIs, isAdmin: admin.is, port: PORT, host: HOST, hub: (text) => HUB_EXTRAS.push(text), lock, reach };
      const made = await (await import(pathToFileURL(path.join(dir, "server.js")).href)).default(given);
      if (made) serverPlugins.push(made);
      lock.unlocked = made?.unlocked ?? [];
    }
    if (existsSync(path.join(dir, "public", "client.js"))) clientPlugins.push({ url: `/plugins/${entry.name}/client.js`, ...said });
    console.log(`[vvoid] plugin: ${entry.name}${place ? ` (its portal placed: ${place.angle}°${place.ring !== undefined ? `, ${place.ring} out` : ""}${place.height ? `, ${place.height} up` : ""})` : ""}`);
  } catch (err) {
    console.warn(`[vvoid] the plugin ${entry.name} could not be loaded: ${err.message}`);
  }
}
// the look as kept, now that every plugin's knobs are known (read before, theirs would be let go)
try {
  const kept = JSON.parse(await fs.readFile(LOOK_FILE, "utf8"));
  looks = cleanLooks(kept.now || kept.saves ? kept : { now: kept }); // (kept before there were saves: the look alone)
} catch {} // (none yet: vvoid's own)

const server = http.createServer(async (req, res) => {
  // (what is said is what it is; and vvoid is framed by no one else's page)
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  try {
    const url = new URL(req.url, "http://localhost");
    // a locked plugin's: the way in, or the session asked for, before the plugin is
    // (its own paths, /plugins/<name>/, and its API, /api/<name>: that has no way in, and no files)
    const ofLocked = url.pathname.match(/^\/plugins\/([\w-]+)\/(.*)$/), ofApi = url.pathname.match(/^\/api\/([\w-]+)(\/.*)?$/);
    const lock = locks.get(ofLocked?.[1] ?? ofApi?.[1]);
    if (lock && (await lock.guard(req, res, ofLocked ? decodeURIComponent(ofLocked[2]) : `/api${url.pathname.slice(4)}`, (rel) => (ofLocked ? publicFile(lock.name, rel) : false)))) return;
    // a portal's own word (see VANITY): /<word>, straight to it (/?p=<its name>, the rest of the address kept). Before
    // the plugins, so one passing a whole other site through on vvoid's address does not take it; never a framed page's
    const word = (req.method === "GET" || req.method === "HEAD") && req.headers["sec-fetch-dest"] !== "iframe" && url.pathname.match(/^\/([a-z0-9][a-z0-9-]{0,39})\/?$/i);
    if (word) {
      const name = (await portalsRead()).to.get(word[1].toLowerCase());
      if (name && clientPlugins.some((p) => p.name === name)) {
        const to = new URLSearchParams(url.search);
        to.set("p", name);
        res.writeHead(302, { location: `/?${to}`, "cache-control": "no-store" });
        return res.end();
      }
    }
    for (const plugin of serverPlugins) if (await plugin.handle?.(req, res, url)) return;
    if (url.pathname === "/api/plugins") return send(res, 200, clientPlugins);
    if (url.pathname === "/api/locks") return send(res, 200, [...locks.keys()]); // (the plugins behind a password)
    if (url.pathname === "/api/portals") return send(res, 200, { unreachable: [...unreachable], places: PORTAL_PLACES, about: await portalAbouts(), vanity: (await portalsRead()).vanity }); // (drawn grey: see grey.js; where an admin has placed them; what each is, see about.js; and each one's own word, its quick access)
    if (slots.handle(req, res, url, send)) return; // (who is in, and the line to come in)
    if (await admin.handle(req, res, url)) return;
    // the void's look: anyone may see it, an admin may turn it (the Tab panel's look page)
    if (url.pathname === "/api/look") {
      if (req.method === "GET") return send(res, 200, looks);
      if (req.method !== "PUT") return send(res, 405, { error: "no" });
      if (!admin.is(req)) return send(res, 403, { error: "only an admin may change the look" });
      if (req.headers["x-vvoid-lock"] !== "1") return send(res, 403, { error: "not from vvoid's page" });
      const given = await readBody(req, 512 * 1024).catch(() => null);
      if (!given || typeof given !== "object") return send(res, 400, { error: "bad request" });
      looks = cleanLooks(given, looks); // (what it leaves out stays as it was)
      try {
        await fs.mkdir(path.dirname(LOOK_FILE), { recursive: true });
        await fs.writeFile(LOOK_FILE, JSON.stringify(looks, null, 2));
      } catch (err) {
        return send(res, 500, { error: `not kept: ${err.message}` });
      }
      return send(res, 200, looks);
    }
    const ofPlugin = url.pathname.match(/^\/plugins\/([\w-]+)\/(.+)$/);
    if (ofPlugin) return serveFile(res, path.join(PLUGINS, ofPlugin[1], "public"), decodeURIComponent(ofPlugin[2]));
    if (url.pathname === "/api/void" && req.method === "POST") {
      if (unavailable || !client || !VOID_PERSONA || voices >= MAX_BEATS) return send(res, 503, unavailable ?? "the void is quiet");
      let journey;
      try {
        journey = await readBody(req);
      } catch {
        return send(res, 400, "bad request");
      }
      if (!allowed(req, "void")) return send(res, 429, "the void is quiet");
      voices++;
      try {
        return send(res, 200, await voidVoice(journey));
      } catch (err) {
        noteFailure(err, "void:");
        return send(res, 503, "the void is quiet");
      }
    }
    if (url.pathname === "/api/entity" && req.method === "POST") {
      if (unavailable || !client || beats >= MAX_BEATS) return send(res, 503, unavailable ?? "the entity is resting");
      let journey;
      try {
        journey = await readBody(req);
      } catch {
        return send(res, 400, "bad request");
      }
      if (!allowed(req, "entity")) return send(res, 429, "the entity is resting");
      beats++;
      try {
        return send(res, 200, await entityBeat(journey));
      } catch (err) {
        noteFailure(err, "entity:");
        return send(res, 503, "the entity is silent");
      }
    }
    if (url.pathname === "/api/sectors") {
      // everything Claude has dreamt so far, for the map (and for anyone who wants to export it)
      const files = await fs.readdir(CACHE).catch(() => []);
      const sectors = await Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) => {
        const [x, y, z] = f.slice(0, -5).split("_").map(Number);
        const s = await readCached(x, y, z);
        return s && { x, y, z, name: s.name, kind: kindOf(s), glow: s.palette.glow, inscription: s.inscription };
      }));
      return send(res, 200, sectors.filter(Boolean));
    }
    if (url.pathname === "/api/sector") {
      const coords = ["x", "y", "z"].map((k) => Number(url.searchParams.get(k)));
      if (!coords.every((c) => Number.isInteger(c) && Math.abs(c) <= 1e6)) return send(res, 400, "bad coordinates");
      const [x, y, z] = coords;
      if (url.searchParams.has("cached")) {
        const cached = await readCached(x, y, z);
        if (cached) return send(res, 200, cached);
        // a miss; the header tells the browser not to wait for Claude
        res.writeHead(204, unavailable ? { "x-vvoid-offline": "1" } : {});
        return res.end();
      }
      // Full request: newline-delimited JSON. A new sector sends its geometry first, then the whole thing.
      const cached = await readCached(x, y, z);
      if (!cached && unavailable) return send(res, 503, unavailable);
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const line = (value) => res.write(`${JSON.stringify(value)}\n`);
      if (cached) {
        line(cached);
        return res.end();
      }
      if (population(x, y, z) === "void") {
        // voids are part of the world's shape; nothing is ever dreamt in them
        line({ error: "void", offline: false });
        return res.end();
      }
      // (a place already being dreamt is waited on by whoever asks; a new one counts against the asker)
      if (!inflight.has(`${x},${y},${z}`) && !allowed(req, "sector")) {
        line({ error: "enough new places from here for now", offline: false });
        return res.end();
      }
      const job = sectorJob(x, y, z);
      if (job.partial) line(job.partial);
      else job.listeners.add(line);
      const sector = await job.done;
      job.listeners.delete(line);
      line(sector ?? { error: unavailable ?? "generation failed", offline: !!unavailable });
      return res.end();
    }
    if (url.pathname.startsWith("/vendor/ruffle/")) {
      return serveFile(res, RUFFLE_DIR, decodeURIComponent(url.pathname.slice("/vendor/ruffle/".length)));
    }
    if (url.pathname.startsWith("/vendor/three/")) {
      return serveFile(res, THREE_DIR, decodeURIComponent(url.pathname.slice("/vendor/three/".length)));
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
    return serveFile(res, PUBLIC, rel);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, "error");
    else res.destroy();
  }
});

// A free call that tells us up front whether credentials work, so the browser knows at once.
if (client) await client.models.retrieve(MODEL).catch((err) => noteFailure(err, "startup check:"));

server.on("upgrade", (req, socket, head) => {
  // (a locked plugin's websockets, only with its session)
  const lock = locks.get(req.url.match(/^\/(?:plugins|api)\/([\w-]+)(?:[/?]|$)/)?.[1]);
  if (lock && !lock.open(req)) return void socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  try {
    for (const plugin of serverPlugins) if (plugin.upgrade?.(req, socket, head)) return;
  } catch (err) {
    console.warn(`[vvoid] upgrade ${JSON.stringify(req.url.slice(0, 80))}: ${err.message}`);
  }
  socket.destroy();
});
server.listen(PORT, HOST, () => {
  console.log(`[vvoid] http://${HOST}:${PORT}  ·  model ${MODEL} (${TAKES_EFFORT ? `effort ${EFFORT}` : "no effort setting"}${fast ? ", fast mode" : ""})${slots.max ? `  ·  ${slots.max} slots` : ""}${admin.set ? ", an admin key" : ""}  ·  cache ${path.relative(here, CACHE)}`);
});
