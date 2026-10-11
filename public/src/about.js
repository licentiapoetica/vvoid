// What each portal is: a few words an admin has written for it (vvoid's panel, its plugins page; kept by the
// server, see portalAbouts in server.js, and told with the rest of the portals' state, /api/portals). Inside,
// in the dimension the portal opens on: beside its way back to the hub (as its plugin says where that is, its
// exit), level with its middle, to the right of it as you first see it from where you came out. A pane of
// dark glass with the portal's name and the words, turned to whoever looks (round the up axis only, so it
// stands upright), coming into being as you come near (see reach.js); none while the plugin has no way out
// to show (busy: a song played). A portal with none written has no pane; words changed are written again,
// seen within a moment of asking. Its words kept under the glow's threshold (see BLOOM in main.js): read, not lit.
import * as THREE from "three";
import { materialize } from "./reach.js";

const ASK = 20;        // s between asks
const RING = 120;      // as the plugins' own rings (see forming.js)
const GAP = 70;        // between its ring and its pane
const WIDE = 560;      // the pane's width, in the void's units (its height as many lines as its words take)
const NEAR = 2600;     // seen from so far off (further, zoomed in: see reach.js)
const PX = 1024;       // the canvas's width
const PAD = 60, LINE = 54, TITLE = 78;
const FONT = '300 38px "Helvetica Neue", Helvetica, Arial, sans-serif';
const TITLE_FONT = '400 28px "Helvetica Neue", Helvetica, Arial, sans-serif';
const MAX_LINES = 18;
// (its colours: pale, but dim enough that the glow passes them by, luminance under its 0.55)
const WORDS = "#a9b5d1", NAME = "#7f9ae0", EDGE = "rgba(150, 175, 230, 0.3)";
const UP = new THREE.Vector3(0, 1, 0);

// its words broken into lines that fit (a blank line kept as a gap; one too long cut, with an ellipsis)
function lines(ctx, text, width) {
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  while (out.length && !out.at(-1)) out.pop();
  if (out.length > MAX_LINES) { out.length = MAX_LINES; out[MAX_LINES - 1] += " …"; }
  return out;
}

function pane(title, text) {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  ctx.font = FONT;
  const words = lines(ctx, text, PX - PAD * 2);
  canvas.width = PX;
  canvas.height = PAD * 2 + TITLE + words.length * LINE;
  // (dark glass, a fine pale edge, the portal's name spaced out over its words)
  ctx.fillStyle = "rgba(2, 3, 14, 0.82)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  ctx.font = TITLE_FONT;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "8px";
  ctx.fillStyle = NAME;
  ctx.textBaseline = "top";
  ctx.fillText(title.toUpperCase(), PAD, PAD, PX - PAD * 2);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.font = FONT;
  ctx.fillStyle = WORDS;
  words.forEach((line, i) => ctx.fillText(line, PAD, PAD + TITLE + i * LINE, PX - PAD * 2));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDE, (WIDE * canvas.height) / canvas.width), material);
  mesh.renderOrder = 2;
  return mesh;
}

export class Abouts {
  // nameOf(plugin): how its portal is called (main.js's names for them); ownerOf(realm): whose dimension it
  // is; exits(): the ways out of the one you are in, as its plugin says (main.js' hook("exit"))
  constructor({ scene, world, camera, nameOf = (name) => name, ownerOf, exits }) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.nameOf = nameOf;
    this.ownerOf = ownerOf;
    this.exits = exits;
    this.texts = {};   // plugin -> its words, as last told
    this.pane = null;  // { mesh, owner, text }: the one for the dimension you are in
    this.side = null;  // { realm, right }: which way it stands from the way out, fixed for the visit
    this.at = new THREE.Vector3();
    this.asking = 0;
  }

  async ask() {
    const data = await fetch("/api/portals", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null);
    if (data && data.about && typeof data.about === "object") this.texts = data.about;
  }

  drop() {
    if (!this.pane) return;
    const { mesh } = this.pane;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.map.dispose();
    mesh.material.dispose();
    this.pane = null;
  }

  // each frame
  update(dt) {
    if ((this.asking -= dt) <= 0) { this.asking = ASK; this.ask(); }
    const realm = this.world.realm, owner = realm === "void" ? null : this.ownerOf(realm) ?? null;
    if (this.side && this.side.realm !== realm) this.side = null; // (another visit: placed again)
    const text = owner && typeof this.texts[owner] === "string" ? this.texts[owner].trim() : "";
    if (this.pane && (this.pane.owner !== owner || this.pane.text !== text)) this.drop();
    const ways = text ? [].concat(this.exits() ?? []).filter((e) => e?.at) : [];
    const exit = ways.find((e) => /hub/i.test(e.label ?? "")) ?? ways[0];
    if (!exit) { if (this.pane) this.pane.mesh.visible = false; return; }
    const at = exit.at.isVector3 ? this.at.copy(exit.at) : this.at.fromArray(exit.at);
    // (to the right of the way out, as it is first seen from where you are: fixed once you are clear of it)
    if (!this.side) {
      const toward = at.clone().sub(this.camera.position).setY(0);
      if (toward.lengthSq() < 40 * 40) { if (this.pane) this.pane.mesh.visible = false; return; }
      this.side = { realm, right: new THREE.Vector3().crossVectors(toward.normalize(), UP).normalize() };
    }
    if (!this.pane) {
      this.pane = { mesh: pane(this.nameOf(owner), text), owner, text };
      this.pane.mesh.visible = false;
      this.scene.add(this.pane.mesh);
    }
    const mesh = this.pane.mesh;
    mesh.position.copy(at).addScaledVector(this.side.right, RING + GAP + WIDE / 2);
    // (turned to whoever looks, upright)
    const look = this.camera.position.clone().sub(mesh.position).setY(0);
    if (look.lengthSq() > 1e-6) mesh.rotation.set(0, Math.atan2(look.x, look.z), 0);
    materialize(mesh, this.camera.position.distanceTo(mesh.position), dt, NEAR);
  }
}
