// The headset's frames in the void, kept up with (saber's pace.js, for the void's own picture): a frame that
// comes late is a frame missed, felt as a judder. While they come late, each eye's picture is drawn smaller
// (see xr.js's viewScale), a step at a time; at its smallest the void is seen less far (its far plane nearer,
// and the sectors past it left undrawn: see world.js's boundBySector); and still late, the headset is asked for
// a step fewer frames (90 to 72 on a Quest 2), until it is taken off. Grown back slowly once they come on time
// again (the reach first, then the picture), more slowly each time it had to give way. With the menu up the
// picture is drawn whole (the headset draws all of a frame at one size, the menu's words too) and nothing is
// judged; and while a plugin draws the picture itself (saber's own pace keeps it), none of this is the void's.
const LATE = 1.4;        // a frame this many times as long as it should be is late (a missed one: twice)
const OFTEN = 0.08;      // a second with more of its frames late than this is a bad one
const BAD = 2;           // bad seconds in a row before it gives way (a hitch alone, a sector being built, is not)
const SLOWER = 4;        // bad seconds in a row with nothing left to give before the frame rate drops
const SETTLE = 2;        // seconds not judged after anything changes, or coming in
const SMALLEST = 0.7, DOWN = 0.1, UP = 0.05;
const NEAREST = 0.35;    // the reach at its shortest (of the camera's far)

export class HeadsetPace {
  constructor(xr) {
    this.xr = xr;
    this.mine = false;   // (whether the void's picture is the one being paced: see update)
    this.reset();
  }
  reset() {
    this.cap = null;     // the most frames a second asked for (null: as the void asks, see xr.js's rate)
    this.scale = 1;      // how much of each eye's picture is drawn
    this.reach = 1;      // how far the void is seen (of the camera's far)
    this.whole = false;  // (the menu up: drawn whole)
    this.hz = 0;
    this.settle = SETTLE;
    this.frames = this.late = this.time = 0;
    this.bad = this.good = 0;
    this.grew = false;   // (the last change grew it: too far, it goes back only that far)
    this.wait = 6;       // good seconds before it grows again (longer after each time it had to give way)
  }
  // each frame the void draws the headset's picture (dt: since the last one, in seconds; whole: its menu up)
  update(dt, whole = false) {
    const xr = this.xr;
    if (!xr.session) { if (this.mine) { this.mine = false; this.reset(); } return; }
    if (!this.mine) { this.mine = true; this.settle = SETTLE; this.frames = this.late = this.time = 0; this.whole = null; }
    if (this.cap != null) xr.rate(this.cap);
    if (whole !== this.whole) { this.whole = whole; xr.viewScale = whole ? 1 : this.scale; this.settle = SETTLE; this.frames = this.late = this.time = this.bad = this.good = 0; }
    const hz = xr.frameRate ?? 90;
    if (hz !== this.hz) { this.hz = hz; this.settle = SETTLE; this.frames = this.late = this.time = 0; }
    if (whole || (this.settle -= dt) > 0) return;
    this.frames++;
    if (dt > LATE / hz) this.late++;
    if ((this.time += dt) < 1) return;
    const late = this.late / this.frames;
    this.frames = this.late = this.time = 0;
    if (late > OFTEN) {
      this.good = 0;
      if (++this.bad < BAD) return;
      if (xr.scalable && this.scale > SMALLEST + 0.001) {
        // (grown too far: back to where it kept up; else a step smaller)
        this.size(Math.max(SMALLEST, this.scale - (this.grew ? UP : DOWN)));
      } else if (this.reach > NEAREST + 0.001) {
        this.reach = Math.max(NEAREST, this.reach * (this.grew ? 1 / 1.1 : 0.8));
        this.changed();
      } else if (this.bad >= SLOWER) {
        // (a step fewer frames, and all of it back again: there is time for it now, or it gives way again)
        const slower = xr.rates.filter((r) => r < hz - 0.5);
        if (!slower.length) return;
        this.cap = Math.max(...slower);
        xr.rate(this.cap);
        this.reach = 1;
        this.size(1);
        this.wait = 6;
        return;
      } else return;
      this.bad = 0;
      this.wait = Math.min(30, this.wait * 1.5);
    } else {
      this.bad = 0;
      if (late >= OFTEN / 4 || ++this.good < this.wait) return;
      this.good = 0;
      if (this.reach < 1) { this.reach = Math.min(1, this.reach * 1.1); this.changed(true); }
      else if (this.scale < 1) this.size(Math.min(1, this.scale + UP), true);
    }
  }
  size(k, grew = false) {
    this.scale = k;
    if (!this.whole) this.xr.viewScale = k;
    this.changed(grew);
  }
  changed(grew = false) {
    this.grew = grew === true;
    this.settle = SETTLE;
  }
  // the picture given over to a plugin drawing it itself (saber: its own pace), or the headset taken off: whole
  // again, and the frames as the void asks for them, until the void draws it again (its own kept till then)
  release() {
    if (!this.mine) return;
    this.mine = false;
    if (this.xr.session) { this.xr.viewScale = 1; if (this.cap != null) this.xr.rate(null); }
  }
}
