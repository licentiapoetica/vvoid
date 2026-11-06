// Coming in by a shared link (see comeShared in main.js): you are not simply there. The screen is dark, and
// in the middle of it a portal forms as those round the clock do (see forming.js): motes of the void's
// violet drawn in out of nothing, round and round, onto a small circle glowing faintly, soft lights going
// round it, the dark of its hole gathering in it, for as long as the place is on its way (its dimension's
// plugin still coming). Put there, it opens out from the middle and on past the edges of the screen, the
// place seen through it, its motes carried out with it as they fade. Drawn over the picture (not in a
// headset: there, the dark that lifts, as ever).
const MOTES = 150;
const SHOW = 0.8;   // s, coming out of nothing
const LEAST = 1.4;  // s it forms at the least before it opens (seen, not a flicker)
const GATHER = 7;   // s over which its glow and the cloud of its hole thicken (most of the way)
const OPEN = 1.9;   // s, opening out past the edges
const LEAVE = 0.6;  // s, let go without opening (a password asked first: see main.js)
const TINTS = 8;    // motes from the void's violet to pale, hot on the circle
const SLOW_DRAW = 3;     // ms a frame its drawing may take, before it is drawn at fewer pixels
const LEAST_SCALE = 0.5; // and at the fewest, of its full size each way

const ease = (t) => t * t * (3 - 2 * t);
const smooth = (a, b, v) => ease(Math.min(1, Math.max(0, (v - a) / (b - a))));
const fract = (v) => v - Math.floor(v);
const mix = (a, b, t) => a + (b - a) * t;

export class Arrival {
  constructor(el) {
    this.el = el;
    this.canvas = el.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.textEl = el.querySelector("p");
    this.state = null; // "forming", "opening" or "leaving" (null: none)
    this.scale = 1; // of its full size each way (lowered where it is slow to draw: see update)
    this.motes = Array.from({ length: MOTES }, (_, i) => ({ angle: (i / MOTES) * Math.PI * 2 + Math.random() * 0.3, seed: Math.random() }));
    // a soft mote in each tint, drawn once
    this.sprites = Array.from({ length: TINTS }, (_, i) => {
      const k = (i / (TINTS - 1)) * 0.6, c = [mix(115, 178, k), mix(56, 217, k), 255].map(Math.round).join(",");
      const sprite = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }), g = sprite.getContext("2d");
      const glow = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (let s = 0; s <= 8; s++) glow.addColorStop(s / 8, `rgba(${c},${(Math.max(0, 1 - s / 8) ** 2.2).toFixed(3)})`);
      g.fillStyle = glow;
      g.fillRect(0, 0, 64, 64);
      return sprite;
    });
  }
  get on() { return !!this.state; }

  // the dark, and a portal forming in it; text: what it says under it
  form(text) {
    if (this.state === "forming") return;
    Object.assign(this, { state: "forming", t: 0, end: 0, opening: false });
    this.textEl.textContent = text;
    this.el.classList.remove("opening");
    this.el.classList.add("on");
  }
  // put there: it opens out (once it has formed a while), and then() as it does. True when it will.
  open(then) {
    if (this.state !== "forming") return false;
    this.then = then;
    return (this.opening = true);
  }
  // not put there (yet): let go, the dark lifting, without opening
  leave() {
    if (this.state !== "forming") return;
    Object.assign(this, { state: "leaving", end: 0 });
    this.el.classList.add("opening");
  }

  update(dt) {
    if (!this.state) return;
    this.t += dt;
    if (this.state === "forming" && this.opening && this.t >= LEAST) {
      Object.assign(this, { state: "opening", end: 0 });
      this.el.classList.add("opening");
      this.then?.();
    }
    if (this.state !== "forming") this.end = Math.min(1, this.end + dt / (this.state === "opening" ? OPEN : LEAVE));
    if (this.end >= 1) {
      this.state = null;
      this.el.classList.remove("on", "opening");
      return;
    }
    // Drawn at fewer pixels where drawing it is slow: Firefox paints a canvas with the processor, here a whole screen
    // of it each frame, five to six milliseconds of every frame at full size; Chromium hands it to the card, and
    // takes no time over it here, so it stays sharp there. Its glows and motes are soft, and lose little; once
    // lowered, it stays so (each change of size is a hitch of its own)
    const began = performance.now();
    this.draw();
    this.took = (this.took ?? 0) * 0.8 + (performance.now() - began) * 0.2;
    if (this.took > SLOW_DRAW && this.scale > LEAST_SCALE && (this.lowered = (this.lowered ?? 0) + 1) >= 8) {
      this.scale = Math.max(LEAST_SCALE, this.scale * 0.75);
      this.took = this.lowered = 0;
    }
  }

  draw() {
    const { canvas, ctx, t, end } = this, w = innerWidth, h = innerHeight, ratio = Math.min(devicePixelRatio, 1.5) * this.scale;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) Object.assign(canvas, { width: Math.round(w * ratio), height: Math.round(h * ratio) });
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.085, far = Math.hypot(w, h) / 2 + R * 2;
    const show = ease(Math.min(1, t / SHOW)), grow = 1 - Math.exp((-3 * t) / GATHER);
    const opening = this.state === "opening" ? end : 0, leaving = this.state === "leaving" ? ease(end) : 0;
    // the circle widening past the edges, and its hole opening out from the middle to meet it, ahead of it
    const r = mix(R, far, ease(opening) ** 1.4), hole = r * ease(Math.min(1, opening * 2.4));
    const fade = (1 - smooth(0.45, 1, opening)) * (1 - leaving);

    // (each pixel filled as few times as it can be: a canvas is painted by the processor in Firefox, a whole screen
    // of it at a time, where Chromium's card does it; the picture is the same)
    ctx.globalAlpha = 1;
    // the dark (the last frame's replaced, not cleared first and then covered), and the cloud of its hole
    // gathering in the circle (nothing past its edge: only the square round it filled)
    ctx.globalCompositeOperation = "copy";
    ctx.fillStyle = `rgba(0,0,0,${1 - leaving})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    const reach = r * 1.15, cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    cloud.addColorStop(0, `rgba(34,18,80,${(0.45 * grow * show * fade).toFixed(3)})`);
    cloud.addColorStop(1, "rgba(34,18,80,0)");
    ctx.fillStyle = cloud;
    ctx.fillRect(cx - reach, cy - reach, 2 * reach, 2 * reach);
    // the place, seen through it
    if (hole > 0.5) {
      ctx.globalCompositeOperation = "destination-out";
      const cut = ctx.createRadialGradient(cx, cy, 0, cx, cy, hole);
      cut.addColorStop(0, "rgba(0,0,0,1)");
      cut.addColorStop(0.8, "rgba(0,0,0,1)");
      cut.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cut;
      ctx.beginPath();
      ctx.arc(cx, cy, hole, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    // the circle: glowing faintly, two soft lights going round it, one each way; it swells as it opens
    const swell = smooth(0, 0.6, opening) * 0.9, ring = ctx.createConicGradient(0, cx, cy);
    for (let s = 0; s <= 48; s++) {
      const a = s / 48, one = (0.5 + 0.5 * Math.cos((a - t * 0.12) * Math.PI * 2)) ** 6, two = (0.5 + 0.5 * Math.cos((a + t * 0.07 + 0.3) * Math.PI * 4)) ** 10;
      const lit = ((0.12 + 0.5 * one + 0.3 * two) * (0.45 + 0.55 * grow) + swell) * show * fade;
      ring.addColorStop(a, `rgba(140,82,255,${Math.min(1, lit).toFixed(3)})`);
    }
    ctx.strokeStyle = ring;
    for (const [width, alpha] of [[R * 0.22 * (1 + swell), 0.3], [2 + 2 * swell, 1]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the motes: each falling in from far out onto the circle, round and round, then again; opening, each
    // settles on it and goes out with it; let go, they drift off outwards
    const settle = smooth(0, 0.55, opening);
    for (const { angle, seed } of this.motes) {
      const c = fract(t * (0.16 + seed * 0.14) + seed * 7.31), inward = mix(ease(c), 1, settle);
      const out = mix(R * (2.8 + seed * 1.5), r, inward) + leaving * R * (2 + seed * 3);
      const a = angle + (1 - inward) * (2.2 + seed * 1.4) + t * 0.05;
      const alpha = mix(Math.sin(Math.PI * c) * 0.8 + inward * 0.3, 0.9, settle) * show * fade;
      if (alpha < 0.01) continue;
      const size = R * (0.16 + seed * 0.12) * (1 - inward * 0.35) * Math.sqrt(r / R);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(this.sprites[Math.round(inward * (TINTS - 1))], cx + Math.cos(a) * out - size, cy + Math.sin(a) * out - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  }
}
