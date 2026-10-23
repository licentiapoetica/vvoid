// J: a string of something not of this world, shot at the post you are looking at (any post, in any
// plugin's dimension). It flies as a thin wobbling thread, lands silently, and clings to the screen
// as a strand flung out from where it struck: liquid silver, mirror-bright, beading here and there along
// its length as a thread of it does. Then it flows down the screen, each part of it at its own pace, a
// faint trail left behind, drips running on ahead with beads at their ends, never past the bottom edge
// (there it pools). After a while it dries away. Missing every post, it arcs off and is gone.
//
// It clings to the screen, not to the place: a post drifting, or opened wide, takes its goo along.
//
// One shot, one strand, never quite the same. It comes from a store that runs low: ten or so shots empty
// it, the last ones less and less, and then nothing comes until it has gathered again, slowly, after a rest.
import * as THREE from "three";

const SPEED = 2200;        // the shot's flight, units a second
const REACH = 9000;        // as far as it can be shot at a post
const STAYS = 32, DRIES = 7; // seconds it clings, then dries away
const MOST = 40;           // strands at once (the oldest goes first)
const LENGTH = 0.13;       // a strand's length, against its post's width
const THICK = 0.007;       // and its thickness
const OFF = 0.8;           // how far in front of the screen it lies (it is on it, not in it)
const COST = 0.1;          // of a full store, what a fair shot (amount 1) takes
const REFILL = 40, REST = 2.5; // seconds to gather a full store again, once it has rested this long

const JELLY = /* glsl */ `
// the goo itself, in the strand's own units (where it struck at 0): a thin thread flung out along uAngle,
// thicker where it struck, bending a little, beads along it, flowing down, drips running on from it
uniform float uAge, uW, uL, uBend, uAngle, uSeed, uShow;
uniform float uFlow, uSlow;            // how far it flows down at most, and how slowly
uniform vec4 uRect;                    // the screen's edges about where it struck: left, right, bottom, top
uniform vec4 uBeads[4];                // the beads: where along it (0 to 1), how big (of its thickness), -, -
uniform vec4 uDrips[2];                // the drips: where along it they hang from, how far at most, how slow, -
uniform int uBeadN, uDripN;            // how many of each
varying vec2 vP;
float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0., 1.); return length(pa - ba * h) - r; }
// a point on the strand, f of the way along it, as far as it has been flung out yet: where it was laid
vec2 laid(float f, float ext) {
  float wobble = exp(-uAge * 2.5) * .05 * sin(uAge * 19. + f * 7.) * sin(3.14159 * f);
  float y = (uBend * sin(3.14159 * f) + .03 * sin(f * 9. + uSeed * 6.) + wobble) * uL;
  vec2 q = vec2(mix(-.1, 1., f) * uL, y) * ext;
  float c = cos(uAngle), s = sin(uAngle);
  return vec2(c * q.x - s * q.y, s * q.x + c * q.y);
}
// and where it is now, flowed down: each part at its own pace, gathering, running, slowing; at the
// screen's bottom edge it stops
vec2 along(float f, float ext) {
  vec2 q = laid(f, ext);
  float fall = uFlow * (1. - exp(-max(uAge - .6, 0.) / uSlow)) * (.55 + .45 * sin(f * 4.7 + uSeed * 11.));
  q.y = max(q.y - fall, min(q.y, uRect.z + uW * 1.5));
  return q;
}
float goo(vec2 p) {
  float ext = 1. - exp(-uAge * 16.); // (it strikes, and is flung out in a blink)
  const float STRUCK = .0909;        // (where along it it struck: its 0)
  float d = length(p - along(STRUCK, ext)) - uW * (1. + .5 * ext); // where it struck: a little more of it there
  d = smin(d, seg(p, laid(STRUCK, ext), along(STRUCK, ext), uW * .18), uW * .3); // (and the trail it leaves, flowing)
  vec2 a = along(0., ext);
  for (int i = 1; i <= 6; i++) {
    float f = float(i) / 6.;
    vec2 b = along(f, ext);
    d = smin(d, seg(p, a, b, uW * mix(.9, .4, f)), uW * .5); // (thinning towards its end)
    a = b;
  }
  for (int i = 0; i < 4; i++) {
    if (i >= uBeadN) break;
    float f = uBeads[i].x;
    d = smin(d, length(p - along(f, ext)) - uW * uBeads[i].y * ext, uW * .6);
    d = smin(d, seg(p, laid(f, ext), along(f, ext), uW * .15), uW * .3);
  }
  // drips: they gather, run, and slow, beads at their ends; none further than the screen goes
  for (int i = 0; i < 2; i++) {
    if (i >= uDripN) break;
    vec4 q = uDrips[i];
    vec2 from = along(q.x, ext);
    float run = min(q.y * (1. - exp(-max(uAge - .5, 0.) / q.z)), max(from.y - uRect.z - uW * 2., 0.));
    vec2 to = from + vec2(.15 * uW * sin(run / uW * .4 + q.z), -run);
    d = smin(d, seg(p, from, to, uW * .35), uW * .5);
    d = smin(d, length(p - to) - uW * (.4 + .5 * smoothstep(0., uW * 6., run)), uW * .4);
  }
  return d;
}
void main() {
  if (vP.x < uRect.x || vP.x > uRect.y || vP.y < uRect.z || vP.y > uRect.w) discard; // (only on the screen)
  float d = goo(vP);
  float h = clamp(-d / (uW * .7), 0., 1.);    // how thick: rounded, thin at its edge
  if (h <= 0.) discard;
  float dome = sqrt(h);
  // its surface: a rounded thread, upright along its middle, turning away towards its edges
  float e = uW * .12;
  vec2 grad = vec2(goo(vP + vec2(e, 0.)) - goo(vP - vec2(e, 0.)), goo(vP + vec2(0., e)) - goo(vP - vec2(0., e))) / (2. * e);
  vec3 n = normalize(vec3(grad * sqrt(max(1. - h * h, 0.)), h + .05));
  vec3 v = vec3(0., 0., 1.), r = reflect(-v, n);
  // silver: what it mirrors, roughly a bright sky above and the dark below, a glint off the side
  vec3 env = mix(vec3(.16, .17, .19), vec3(.94, .95, .98), smoothstep(-.3, .4, r.y)) + vec3(.35) * smoothstep(.55, .95, r.x);
  float spec = pow(max(dot(r, normalize(vec3(-.45, .65, .6))), 0.), 60.) + .4 * pow(max(dot(r, normalize(vec3(.5, -.2, .8))), 0.), 20.);
  float fresnel = pow(max(1. - n.z, 0.), 2.);
  vec3 c = env * vec3(.84, .86, .9) * (.8 + .2 * dome) + vec3(.9, .93, 1.) * fresnel * .25 + vec3(1.) * spec;
  float alpha = (.8 + .15 * fresnel) * smoothstep(0., .08, h) + spec; // (a metal: the screen does not show through)
  gl_FragColor = vec4(c, clamp(alpha, 0., .95) * uShow);
}`;
const JELLY_VERT = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

// the shot in flight: a thread of the same silver, drawn out along its way
const GOB_VERT = /* glsl */ `varying vec3 vN, vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const GOB_FRAG = /* glsl */ `uniform float uShow; varying vec3 vN, vV;
void main(){
  vec3 n = normalize(vN), v = normalize(vV), r = reflect(-v, n);
  vec3 env = mix(vec3(.16, .17, .19), vec3(.94, .95, .98), smoothstep(-.3, .4, r.y));
  float spec = pow(max(dot(r, normalize(vec3(-.4, .7, .6))), 0.), 40.);
  gl_FragColor = vec4(env * vec3(.84, .86, .9) + spec, .95 * uShow);
}`;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const ray = new THREE.Raycaster(), CENTRE = new THREE.Vector2();
const tmp = new THREE.Vector3(), ahead = new THREE.Vector3(), turn = new THREE.Quaternion(), normal = new THREE.Vector3(), xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3(), basis = new THREE.Matrix4(), normals = new THREE.Matrix3();
const UP = new THREE.Vector3(0, 1, 0), GRAVITY = new THREE.Vector3(0, -900, 0);

export class Goo {
  // muzzle(camera): where shots leave from (see laser.js); storeEl: the bar showing what is left (index.html)
  constructor({ scene, world, muzzle, storeEl }) {
    Object.assign(this, { scene, world, muzzle, storeEl });
    this.gobs = [];   // in flight
    this.splats = []; // clinging
    this.gobGeometry = new THREE.IcosahedronGeometry(3, 2);
    this.store = 1;   // 0 to 1: what there is to shoot
    this.rested = 0;  // seconds since the last shot
    this.fullFor = Infinity; // seconds it has been full (the bar shown a moment more, then gone)
    // the bar's notches: one for each fair shot in a full store
    for (let x = COST; x < 0.999; x += COST) {
      const notch = Object.assign(document.createElement("div"), { className: "notch" });
      notch.style.left = `${x * 100}%`;
      storeEl?.append(notch);
    }
  }

  // the bar: shown while the store is used and gathers again, a moment after it is full, glowing then
  showStore(dt) {
    const el = this.storeEl;
    if (!el) return;
    this.fullFor = this.store >= 1 ? this.fullFor + dt : 0;
    const width = `${(this.store * 100).toFixed(1)}%`, fill = el.firstElementChild;
    if (fill.style.width !== width) fill.style.width = width;
    el.classList.toggle("show", this.fullFor < 1.6);
    el.classList.toggle("full", this.store >= 1 && this.fullFor < 1.6);
    el.classList.toggle("low", this.store < COST); // (less than a fair shot left)
  }

  // Shot from you at what the crosshair is on: a post's screen, if any is. How much comes: never quite
  // the same, and less as the store runs low. Its amount (1 a fair one), or 0: nothing left.
  shoot(camera) {
    if (this.store < 0.02) return 0;
    let amount = rand(0.75, 1.2);
    amount = Math.min(amount * (0.7 + 0.3 * this.store), this.store / COST); // (running low: less, the last of it all there is)
    this.store = Math.max(0, this.store - amount * COST);
    this.rested = 0;
    const panels = [];
    this.scene.traverseVisible((o) => { if (o.isMesh && o.userData.panel) panels.push(o); });
    ray.setFromCamera(CENTRE, camera);
    ray.far = REACH;
    const hit = ray.intersectObjects(panels, false)[0] ?? null;
    let target = null;
    if (hit) {
      // where on the post, in its own (unscaled) terms, so the goo stays put as the post drifts or is opened wide
      // (and which side of the screen it is shot at: its goo lies on that one)
      normals.getNormalMatrix(hit.object.matrixWorld);
      const side = normal.copy(hit.face.normal).applyMatrix3(normals).dot(tmp.copy(camera.position).sub(hit.point)) > 0 ? 1 : -1;
      target = { mesh: hit.object, at: hit.object.worldToLocal(hit.point.clone()), normal: hit.face.normal.clone(), side };
    }
    const gob = { amount, age: 0, spin: rand(0, 6), camera };
    if (target) Object.assign(gob, { target, flight: Math.max(0.08, hit.distance / SPEED) });
    this.gobs.push(gob);
    return amount;
  }

  // a shot leaving you: from where shots leave, now
  launch(gob) {
    const camera = gob.camera;
    gob.mesh = new THREE.Mesh(this.gobGeometry, new THREE.ShaderMaterial({
      uniforms: { uShow: { value: 1 } }, vertexShader: GOB_VERT, fragmentShader: GOB_FRAG, transparent: true, depthWrite: false,
    }));
    gob.size = 0.8 + 0.3 * gob.amount;
    gob.from = this.muzzle(camera).clone();
    gob.mesh.position.copy(gob.from);
    this.scene.add(gob.mesh);
    if (!gob.target) gob.velocity = camera.getWorldDirection(tmp).multiplyScalar(SPEED * 0.8).clone();
  }

  update(dt, camera) {
    // the store gathers again, after a rest
    this.rested += dt;
    if (this.rested > REST) this.store = Math.min(1, this.store + dt / REFILL);
    this.showStore(dt);
    for (const gob of [...this.gobs]) {
      if (!gob.mesh) this.launch(gob);
      gob.age += dt;
      const m = gob.mesh, k = gob.size;
      // a thread drawn out along its way, wobbling as it goes (drawn out more the first moment, as it leaves)
      const wobble = 1 + 0.2 * Math.sin(gob.age * 31 + gob.spin);
      m.scale.set(k * wobble, k / wobble, k * (10 + 6 * Math.exp(-gob.age * 12)));
      ahead.copy(m.position);
      if (gob.target) {
        // (to where that place on the post is now, in a slight arc)
        const t = Math.min(1, gob.age / gob.flight), to = this.onPost(gob.target, tmp);
        if (!to) { this.drop(gob); continue; } // (its post gone on the way)
        const arc = Math.sin(Math.PI * t) * gob.from.distanceTo(to) * 0.06;
        m.position.copy(gob.from).lerp(to, t).y += arc;
        if (t >= 1) { this.splat(gob.target, gob.amount, camera); this.drop(gob); continue; }
      } else {
        gob.velocity.addScaledVector(GRAVITY, dt);
        m.position.addScaledVector(gob.velocity, dt);
        m.material.uniforms.uShow.value = 1 - THREE.MathUtils.smoothstep(gob.age, 0.8, 1.4);
        if (gob.age > 1.4) { this.drop(gob); continue; }
      }
      // (lying along the way it goes)
      if (m.position.distanceToSquared(ahead) > 1e-6) m.lookAt(ahead.sub(m.position).multiplyScalar(-1).add(m.position));
    }
    for (const s of [...this.splats]) {
      s.age += dt;
      const gone = !s.target.mesh.parent || !s.mesh.parent;
      if (gone || s.age > STAYS + DRIES) { this.unstick(s); continue; }
      this.place(s);
      const u = s.mesh.material.uniforms;
      u.uAge.value = s.age;
      // drying, and as its post fades, so does it
      u.uShow.value = (1 - THREE.MathUtils.smoothstep(s.age, STAYS, STAYS + DRIES)) * (s.target.mesh.material.uniforms?.uShow?.value ?? 1);
    }
  }

  // where a point on a post is now, in the world (null if the post is gone)
  onPost(target, out) {
    if (!target.mesh.parent) return null;
    return target.mesh.localToWorld(out.copy(target.at));
  }

  // the shot arrived: a strand on the screen there, on the side it was shot at, flung out from where it
  // struck, much as it came (more: longer, thicker, more beads and drips), to flow down from there
  splat(target, amount = 1, camera) {
    const post = target.mesh, group = post.parent;
    const L = post.scale.x * LENGTH * rand(0.7, 1.25) * (0.6 + 0.4 * amount), w = post.scale.x * THICK * (0.7 + 0.3 * amount);
    // the way it is flung: the way the shot came, across the screen, if it came slanting; else any way
    // (seen from the back of the screen, the post's x runs the other way)
    const side = target.side, along = camera.getWorldDirection(tmp).applyQuaternion(post.getWorldQuaternion(turn).invert());
    const angle = Math.hypot(along.x, along.y) > 0.2 ? Math.atan2(along.y, along.x * side) + rand(-0.4, 0.4) : rand(-Math.PI, Math.PI);
    // the screen's edges, about where it struck (the post's own -0.5 to 0.5)
    const x = target.at.x * side, rect = new THREE.Vector4((-0.5 - x) * post.scale.x, (0.5 - x) * post.scale.x, (-0.5 - target.at.y) * post.scale.y, (0.5 - target.at.y) * post.scale.y);
    const beadN = THREE.MathUtils.clamp(Math.round(amount * 2.2 + rand(-1, 1)), 0, 4), dripN = Math.random() < 0.4 * amount ? 2 : 1;
    const beads = Array.from({ length: 4 }, () => new THREE.Vector4(rand(0.2, 0.95), rand(1.1, 1.8), 0, 0));
    const drips = Array.from({ length: 2 }, () => new THREE.Vector4(rand(0, 0.8), L * rand(0.5, 1.4), rand(3, 8), 0));
    const flow = L * rand(0.8, 1.8); // (how far it flows down at most)
    const half = L * 1.25 + w * 4, top = Math.min(half, rect.w), bottom = Math.max(-(half + flow + L * 1.4 + w * 3), rect.z);
    const geometry = new THREE.PlaneGeometry(half * 2, top - bottom, 1, 1).translate(0, (top + bottom) / 2, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uAge: { value: 0 }, uW: { value: w }, uL: { value: L }, uBend: { value: rand(-0.15, 0.15) },
        uAngle: { value: angle }, uSeed: { value: Math.random() }, uShow: { value: 1 }, uRect: { value: rect },
        uFlow: { value: flow }, uSlow: { value: rand(5, 10) },
        uBeads: { value: beads }, uDrips: { value: drips }, uBeadN: { value: beadN }, uDripN: { value: dripN },
      },
      vertexShader: JELLY_VERT, fragmentShader: JELLY, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = (post.renderOrder ?? 0) + 1;
    const s = { mesh, target, age: 0, scale0: post.scale.x };
    group.add(mesh);
    this.place(s);
    this.splats.push(s);
    while (this.splats.length > MOST) this.unstick(this.splats[0]);
  }

  // the splat laid on its screen as the post is now: where it landed, lying along the screen there, its
  // drips running down the screen (the post's own down, however it is tilted), as large as the post is
  place(s) {
    const post = s.target.mesh, m = s.mesh;
    m.position.copy(s.target.at).applyMatrix4(post.matrix);
    normals.getNormalMatrix(post.matrix);
    normal.copy(s.target.normal).applyMatrix3(normals).normalize().multiplyScalar(s.target.side);
    xAxis.crossVectors(UP, normal).normalize();
    yAxis.crossVectors(normal, xAxis);
    m.quaternion.setFromRotationMatrix(basis.makeBasis(xAxis, yAxis, normal));
    m.position.addScaledVector(normal, OFF);
    m.scale.setScalar(post.scale.x / s.scale0);
  }

  drop(gob) {
    gob.mesh?.removeFromParent();
    gob.mesh?.material.dispose();
    this.gobs.splice(this.gobs.indexOf(gob), 1);
  }

  unstick(s) {
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
    this.splats.splice(this.splats.indexOf(s), 1);
  }
}
