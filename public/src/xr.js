// The void in a headset (WebXR). The camera becomes your head: where you look is where the crosshair is
// (a ring before your eyes), and what you look at a trigger clicks; you fly where you look. You are
// given a size in the void (a metre is so many of its units: see SIZES), so a portal's dark is about as
// tall as you are, and walking about your room moves you through it too. The picture is drawn straight,
// without vvoid's passes (the glow and the glass are the screen's); the sky is drawn into a small cube
// round you (see main.js).
//
// What the hands hold is read here for everyone, each frame, from the frame itself: the head, each
// hand's grip (where it holds) and ray (where it points), in the play space's metres (its floor at y 0),
// their buttons and sticks. A plugin with a headset world of its own (the saber plugin) uses these, and
// draws its own scene with its own camera in its draw hook.
// Bare hands (hand tracking) stand in for controllers: a hand's grip is its fist, worked out from its joints so
// that what it holds comes out of it on the thumb's side, tipped forward with the knuckles, as a sword is held;
// a pinch is the trigger (button 0); a palm held open to your face a moment is the upper button (5)
import * as THREE from "three";

// a metre in the void's units: small, a person, a giant
export const SIZES = { small: 20, person: 50, giant: 150 };
// the headsets that are a browser of their own: there, the start screen's click puts it on at once
export const standalone = () => /OculusBrowser|Quest|Pico|Wolvic|VIVE Focus|Vive Focus/i.test(navigator.userAgent);
const Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _s = new THREE.Vector3();
const _l = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4();
const BARE = Object.fromEntries(["wrist", "index", "pinky", "mid", "tip", "thumb", "along", "across", "palm", "blade", "up", "z", "x", "centre", "toHead"].map((k) => [k, new THREE.Vector3()])); // (see bareHand: one hand at a time)
const PALM_HOLD = 0.8; // (seconds a palm is held to your face for the upper button)

const hand = (side) => ({
  side, source: null,
  grip: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), ok: false },
  ray: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), ok: false },
  buttons: [], was: [], values: [], axes: [0, 0],
});

export class VoidXR {
  constructor({ renderer, scene, stored, store }) {
    this.renderer = renderer;
    this.scene = scene;
    this.store = store;
    this.settings = { size: "person", turn: "snap", comfort: true, sharpness: 0.85, ...stored("xr", {}) };
    this.session = null;
    this.wanted = this.asked = null; // (the frame rate a plugin asks for, and the one asked of the headset: see rate)
    this.pretending = false; // (tests: on, without a headset, its poses set by hand)
    this.rig = new THREE.Group(); // (the play space in the void: see place)
    scene.add(this.rig);
    this.camera = new THREE.PerspectiveCamera(80, 1, 1, 1000); // (handed to the renderer: it draws through the eyes instead)
    this.preview = new THREE.PerspectiveCamera(80, 1, 1, 1000); // (without a headset: one eye, on the screen)
    this.depth = [0, 0];
    this.head = { position: new THREE.Vector3(0, 1.6, 0), quaternion: new THREE.Quaternion() };
    this.lastHead = null;   // (where the head was last frame: its steps are yours)
    this.hands = { left: hand("left"), right: hand("right") };
    this.body = new THREE.Quaternion(); // how the body is turned in the void (about its up only)
    this.onChange = null;
  }
  get on() { return !!this.session || this.pretending; }
  get scale() { return SIZES[this.settings.size] ?? SIZES.person; }
  save() { this.store("xr", this.settings); }

  async supported() {
    if (!window.isSecureContext || !navigator.xr) return false;
    try { return await navigator.xr.isSessionSupported("immersive-vr"); } catch { return false; }
  }
  // put on (called in the click that asked for it: a browser lets it be asked for only then)
  async enter() {
    if (this.session) return true;
    if (!window.isSecureContext) throw new Error("the headset needs vvoid on https (or localhost)");
    if (!navigator.xr) throw new Error("this browser has no WebXR");
    const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
    const xr = this.renderer.xr;
    xr.enabled = true;
    xr.cameraAutoUpdate = false; // (the eyes are put in the world here: see render)
    xr.setReferenceSpaceType("local-floor");
    xr.setFramebufferScaleFactor(this.settings.sharpness);
    session.addEventListener("end", () => {
      this.session = null;
      viewScale = viewScaled = 1;
      xr.enabled = false;
      xr.cameraAutoUpdate = true;
      this.depth = [0, 0];
      this.lastHead = null;
      for (const h of Object.values(this.hands)) { h.source = null; h.grip.ok = h.ray.ok = false; h.buttons = []; h.was = []; }
      this.onChange?.(false);
    });
    try {
      await xr.setSession(session);
    } catch (err) {
      session.end().catch(() => {});
      throw err;
    }
    // (no foveation unless asked for (saber's MAP FOVEATION, while a Vivify map plays): on a Quest 2 it showed up the
    // checker AreaLit drew in the headset, the middle of each eye's picture darker, its edge a rectangle that went
    // wherever you looked)
    xr.setFoveation(0);
    this.session = session;
    this.asked = null;
    this.rate(this.wanted);
    scaleViews();
    this.onChange?.(true);
    return true;
  }
  exit() { this.session?.end().catch(() => {}); }
  // How many frames a second: as fast as the headset offers, up to 90 (a Quest 2 begins at 72), or, while a
  // plugin asks for more (saber's songs: see its pace.js), up to that; null gives it back. The rates offered
  // are the headset's (a Quest 2's 120 only once it is turned on in its own settings).
  rate(most = null) {
    this.wanted = most;
    const s = this.session, rates = s?.supportedFrameRates;
    if (!rates?.length || !s.updateTargetFrameRate) return;
    const fit = [...rates].filter((r) => r <= (most ?? 90) + 0.5), hz = fit.length ? Math.max(...fit) : Math.min(...rates);
    if (hz === this.asked) return;
    this.asked = hz;
    try { s.updateTargetFrameRate(hz).catch(() => {}); } catch { /* not offered */ }
  }
  get rates() { return [...(this.session?.supportedFrameRates ?? [])]; }
  get frameRate() { return this.session?.frameRate ?? this.asked ?? null; }
  // How much of each eye's picture is drawn (1: all of it; less: smaller, and stretched to fill it), changed
  // from one frame to the next as the headset itself allows (its picture's own size cannot change while it
  // is on); false where it does not (see scaleViews)
  get scalable() { return VIEW_SCALE; }
  get viewScale() { return viewScale; }
  set viewScale(k) { viewScale = Math.max(0.2, Math.min(1, k)); }
  pretend(on) { this.pretending = on; this.lastHead = null; this.onChange?.(on); }

  // each frame, before anything uses them: the head and the hands as they are now
  update() {
    // (what was down at the last frame, against what is down now: a press is a button down now and not then)
    for (const h of Object.values(this.hands)) { h.was = h.seen ?? []; h.seen = h.buttons; }
    if (!this.session) return;
    const xr = this.renderer.xr, frame = xr.getFrame?.(), space = xr.getReferenceSpace?.();
    if (!frame || !space) return;
    const pose = frame.getViewerPose(space);
    if (pose) {
      const p = pose.transform.position, q = pose.transform.orientation;
      this.head.position.set(p.x, p.y, p.z);
      this.head.quaternion.set(q.x, q.y, q.z, q.w);
    }
    const seen = new Set();
    for (const source of this.session.inputSources) {
      const side = source.handedness === "left" ? "left" : source.handedness === "right" ? "right" : null;
      if (!side || seen.has(side)) continue;
      seen.add(side);
      const h = this.hands[side];
      h.source = source;
      const put = (space, into) => {
        const p = space ? frame.getPose(space, xr.getReferenceSpace()) : null;
        into.ok = !!p;
        if (p) { into.position.copy(p.transform.position); into.quaternion.copy(p.transform.orientation); }
      };
      put(source.gripSpace, h.grip);
      put(source.targetRaySpace, h.ray);
      h.bare = !!source.hand;
      if (source.hand) { this.bareHand(h, source, frame, xr.getReferenceSpace()); continue; }
      const pad = source.gamepad;
      h.buttons = pad ? pad.buttons.map((b) => b.pressed) : [];
      h.values = pad ? pad.buttons.map((b) => b.value) : [];
      h.axes = pad ? [pad.axes[2] ?? 0, pad.axes[3] ?? 0] : [0, 0];
      h.seen = h.buttons;
    }
    for (const side of ["left", "right"]) if (!seen.has(side)) { const h = this.hands[side]; h.source = null; h.grip.ok = h.ray.ok = false; h.buttons = []; h.axes = [0, 0]; }
  }
  // A bare hand (hand tracking): its grip, its pinch, its palm, from its joints (see the top)
  bareHand(h, source, frame, space) {
    // (each joint, and what is worked out from them, in vectors kept for it, not new ones each frame: see BARE)
    const at = (name, out) => { const j = source.hand.get(name), p = j && frame.getJointPose?.(j, space); return p ? out.copy(p.transform.position) : null; };
    const wrist = at("wrist", BARE.wrist), index = at("index-finger-metacarpal", BARE.index), pinky = at("pinky-finger-metacarpal", BARE.pinky), mid = at("middle-finger-phalanx-proximal", BARE.mid);
    const now = performance.now() / 1000;
    if (wrist && index && pinky && mid) {
      const along = BARE.along.subVectors(mid, wrist).normalize();      // (along the fingers)
      const across = BARE.across.subVectors(index, pinky).normalize();  // (across the hand, to the thumb's side)
      // (out of the palm: for a right hand, along x across; for a left, across x along)
      const palm = (h.side === "left" ? BARE.palm.crossVectors(along, across) : BARE.palm.crossVectors(across, along)).normalize();
      // (what it holds: out of the fist on the thumb's side, tipped forward with the knuckles; its own -z)
      const blade = BARE.blade.copy(across).addScaledVector(along, 0.8).normalize(); // (about 40° forward of straight out of the fist: a sword as held; the saber plugin's tilt turns it further)
      const up = BARE.up.copy(palm).negate().addScaledVector(blade, palm.dot(blade)).normalize(); // (the back of the hand, square to it)
      const z = BARE.z.copy(blade).negate(), x = BARE.x.crossVectors(up, z).normalize();
      h.grip.quaternion.setFromRotationMatrix(_m.makeBasis(x, up, z));
      // (the fist's middle: by the knuckles, a little in towards the palm, where the fingers curl round)
      h.grip.position.copy(mid).add(index).multiplyScalar(0.5).addScaledVector(palm, 0.035);
      h.grip.ok = true;
      // (a palm held open to your face, a moment: the upper button)
      const centre = BARE.centre.copy(wrist).lerp(mid, 0.5), toHead = BARE.toHead.subVectors(this.head.position, centre);
      const facing = toHead.length() < 0.6 && palm.dot(toHead.normalize()) > 0.8;
      h.palmSince = facing ? h.palmSince ?? now : null;
    } else h.palmSince = null;
    // (a pinch: thumb's tip to index's tip, near; let go a little further apart, so it does not flicker)
    const tip = at("index-finger-tip", BARE.tip), thumb = at("thumb-tip", BARE.thumb);
    if (tip && thumb) { const d = tip.distanceTo(thumb); h.pinch = h.pinch ? d < 0.03 : d < 0.018; }
    const upper = h.palmSince != null && now - h.palmSince > PALM_HOLD && !h.palmUsed;
    if (upper) h.palmUsed = true;
    if (h.palmSince == null) h.palmUsed = false;
    h.buttons = [!!h.pinch, false, false, false, false, upper];
    h.values = h.buttons.map((b) => (b ? 1 : 0));
    h.axes = [0, 0];
    h.seen = h.buttons;
  }
  // a hand: bare (tracked), not a controller (no sticks, no rumble)
  bare(side) { return !!this.hands[side]?.bare; }
  hand(side) { const h = this.hands[side]; return h?.source || this.pretending ? h : null; }
  // the buttons, as the headsets' controllers have them: 0 trigger, 1 grip, 3 stick pressed, 4 A or X, 5 B or Y
  pressed(side, i) { const h = this.hands[side]; return !!h.buttons[i] && !h.was[i]; }
  held(side, i) { return !!this.hands[side].buttons[i]; }
  stick(side, dead = 0.15) {
    const [x, y] = this.hands[side].axes, r = Math.hypot(x, y);
    if (r < dead) return [0, 0];
    const k = (r - dead) / (1 - dead) / r;
    return [x * k, y * k];
  }
  pulse(side, strength, ms) {
    const pad = this.hands[side]?.source?.gamepad;
    try {
      if (pad?.hapticActuators?.[0]?.pulse) pad.hapticActuators[0].pulse(strength, ms);
      else pad?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
    } catch { /* none */ }
  }
  // The screen's picture while you are in the headset (to watch, or stream): the left eye's, as the headset was given
  // it, copied onto the page (nothing drawn again), cut to the window's shape round where the eye looks straight
  // ahead (an eye's picture is off its middle). Not in a headset's own browser (Android): no screen to see it there.
  // Only where the headset's picture is one layer (WebXR's layers, the projection layer, not read from here).
  mirror() {
    // (nothing to mirror onto first, before the page's size is asked for: asking makes the browser lay the page out,
    // every frame, a tenth of a millisecond of a Quest 2's at least)
    const layer = this.session?.renderState.baseLayer;
    if (MIRRORLESS || !layer) return;
    const eye = this.renderer.xr.getCamera().cameras[0], canvas = this.renderer.domElement, aspect = canvas.clientWidth / canvas.clientHeight;
    if (!eye?.viewport || !(aspect > 0)) return;
    const gl = this.renderer.getContext(), vp = eye.viewport, P = eye.projectionMatrix.elements;
    // (straight ahead, in the eye's picture: where its projection puts the point on its axis)
    const ax = vp.x + ((1 - P[8]) / 2) * vp.z, ay = vp.y + ((1 - P[9]) / 2) * vp.w;
    let hx = Math.min(ax - vp.x, vp.x + vp.z - ax), hy = Math.min(ay - vp.y, vp.y + vp.w - ay);
    if (hx / hy > aspect) hx = hy * aspect;
    else hy = hx / aspect;
    // (three.js's bindings put back as they were, so its own record of them stays true; a blit is cut by the scissor)
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layer.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(ax - hx, ay - hy, ax + hx, ay + hy, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
  }
  // how far the head is turned about its up, in the play space
  headYaw() { return _e.setFromQuaternion(this.head.quaternion, "YXZ").y; }

  // ---- the play space in the void ----
  // the head's step since the last frame, in the void's units, turned as the body is (your walking)
  stepped(out) {
    out.set(0, 0, 0);
    if (this.lastHead) out.subVectors(this.head.position, this.lastHead).multiplyScalar(this.scale).applyQuaternion(this.body);
    (this.lastHead ??= new THREE.Vector3()).copy(this.head.position);
    return out;
  }
  // the camera (your head in the void) turned as the body and the head are, and the play space put round
  // it so the head is where the camera is: (body yaw) the body's turn
  place(camera, bodyYaw) {
    this.body.setFromAxisAngle(Y, bodyYaw);
    camera.quaternion.copy(this.body).multiply(this.head.quaternion);
    const s = this.scale;
    this.rig.scale.setScalar(s);
    this.rig.quaternion.copy(this.body);
    this.rig.position.copy(camera.position).sub(_v.copy(this.head.position).multiplyScalar(s).applyQuaternion(this.body));
    this.rig.updateMatrixWorld(true);
  }
  // a point of the play space (metres) in the void
  toVoid(p, out) { return out.copy(p).applyMatrix4(this.rig.matrixWorld); }
  turnToVoid(q, out) { return out.copy(this.body).multiply(q); }

  // The picture: a scene seen through the eyes, put in it at `at`, turned by `turn`, a metre of the play
  // space being `scale` of its units, seeing from `near` to `far` (in its units). Each eye is put where it
  // is, its distance from the play space's middle made so many times larger, and turned as it is turned:
  // the view itself is never scaled (three.js's own way scales it, and then whatever a shader measures in
  // the view, a point's size, a fade, comes out so many times off), so the scene is seen in its own units.
  // draw: how it is drawn, given the scene and the camera its eyes are put in (a plugin drawing each eye itself,
  // through passes of its own: see the saber plugin's Vivify); else as it is, straight into the headset
  render(scene, { at, turn, scale, near, far, draw = null }) {
    const drawn = draw ?? ((s, c) => this.renderer.render(s, c));
    if (!this.session) {
      const c = this.preview;
      c.position.copy(this.head.position).multiplyScalar(scale).applyQuaternion(turn).add(at);
      c.quaternion.copy(turn).multiply(this.head.quaternion);
      Object.assign(c, { near, far, fov: 80, aspect: window.innerWidth / window.innerHeight });
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
      drawn(scene, c);
      return;
    }
    if (this.depth[0] !== near || this.depth[1] !== far) {
      this.depth = [near, far];
      this.session.updateRenderState({ depthNear: near, depthFar: far }); // (for the next frame's projections)
    }
    const array = this.renderer.xr.getCamera(), eyes = array.cameras;
    for (const eye of eyes) {
      eye.matrix.decompose(_v, _q, _s); // (where the headset says it is, in the play space)
      _v.multiplyScalar(scale).applyQuaternion(turn).add(at);
      _q.premultiply(turn);
      eye.matrixWorld.compose(_v, _q, ONE);
      eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
    }
    if (eyes.length === 2) union(array, eyes[0], eyes[1]);
    else if (eyes.length === 1) { array.matrixWorld.copy(eyes[0].matrixWorld); array.matrixWorldInverse.copy(eyes[0].matrixWorldInverse); array.projectionMatrix.copy(eyes[0].projectionMatrix); }
    drawn(scene, draw ? array : this.camera);
  }
  // vvoid's: the void, from the head in it (see place)
  draw(scene, far) {
    this.render(scene, { at: this.rig.position, turn: this.body, scale: this.scale, near: 0.05 * this.scale, far });
  }
}

// Each eye's picture drawn smaller (see viewScale): asked of each of its views as three.js takes them from
// the frame, before it asks where in the picture each is drawn (the headset gives a smaller part then). Put
// in once, the first time the headset is put on.
const VIEW_SCALE = typeof XRView !== "undefined" && "requestViewportScale" in XRView.prototype;
const MIRRORLESS = /Android/i.test(navigator.userAgent) || standalone(); // (see mirror: a Quest's browser does not say Android)
let viewScale = 1, viewScaled = 1;
function scaleViews() {
  if (!VIEW_SCALE || scaleViews.done) return;
  scaleViews.done = true;
  const pose = XRFrame.prototype.getViewerPose;
  XRFrame.prototype.getViewerPose = function (space) {
    const p = pose.call(this, space);
    if (p && (viewScale !== 1 || viewScaled !== 1)) { for (const v of p.views) v.requestViewportScale(viewScale); viewScaled = viewScale; }
    return p;
  };
}

// One camera that sees what both eyes see (for what is left undrawn as out of sight), as three.js makes it
function union(camera, left, right) {
  _l.setFromMatrixPosition(left.matrixWorld);
  _r.setFromMatrixPosition(right.matrixWorld);
  const ipd = _l.distanceTo(_r);
  const pL = left.projectionMatrix.elements, pR = right.projectionMatrix.elements;
  const near = pL[14] / (pL[10] - 1), far = pL[14] / (pL[10] + 1);
  const topFov = (pL[9] + 1) / pL[5], bottomFov = (pL[9] - 1) / pL[5];
  const leftFov = (pL[8] - 1) / pL[0], rightFov = (pR[8] + 1) / pR[0];
  const zOffset = ipd / (-leftFov + rightFov), xOffset = zOffset * -leftFov;
  left.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  camera.translateX(xOffset);
  camera.translateZ(zOffset);
  camera.matrixWorld.compose(camera.position, camera.quaternion, camera.scale);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  if (pL[10] === -1) { camera.projectionMatrix.copy(left.projectionMatrix); camera.projectionMatrixInverse.copy(left.projectionMatrixInverse); return; }
  const near2 = near + zOffset, far2 = far + zOffset;
  camera.projectionMatrix.makePerspective(near * leftFov - xOffset, near * rightFov + (ipd - xOffset), (topFov * far) / far2 * near2, (bottomFov * far) / far2 * near2, near2, far2);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
