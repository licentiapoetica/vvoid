// A touch screen's own buttons, for what keys do: a stick to walk (or fly) with, jump, duck, use, let
// go, the laser, and back to the checkpoint; and whatever a plugin adds (see add: mania's four lanes, a
// row of them moved as one). Each is where the player put it (the menu's "buttons", beside close: then
// drag each, tap one to show or hide it, and size them as you like, a row's gap and height too, or fit
// them to what a plugin draws, mania's lanes over its receptors; one layer at a time, vvoid's own flying
// and a plugin's, so neither hides the other under it), kept by the edge it is nearest, so a phone turned
// keeps them by your thumbs; which are hidden, and how large, remembered too. What a press of vvoid's own
// does is main.js's: this only says which was pressed (press), where the stick is (stick), and how a
// thumb on a button turned the view (look: a thumb holding jump still aims, as bhop asks).

// vvoid's own: [id, its name flying, its name on foot (if another), where it begins: [side, from it, from the bottom], shown at first]
const OWN = [
  ["walk", "fly", "walk", ["left", 110, 120], true],
  ["jump", "rise", "jump", ["right", 64, 84], true],
  ["duck", "sink", "duck", ["right", 146, 52], true],
  ["use", "use", null, ["right", 64, 166], true],
  ["letGo", "let go", null, ["right", 146, 134], true],
  ["laser", "laser", null, ["right", 228, 52], true],
  ["reset", "level", "reset", ["right", 228, 134], false],
].map(([id, label, afoot, [h, x, y], shown]) => ({ id, group: "vvoid", label, afoot: afoot ?? label, at: { h, x, v: "bottom", y }, shown, across: id === "walk" ? 120 : 58 }));
const SIZES = { small: 0.8, medium: 1, large: 1.25 }; // (kept before any size could be had: its scale)
const DEAD = 14; // the stick moved less than this from where the thumb came down: straight ahead
const NUDGE = 8;  // arranging, a thumb moved less than this is a tap (shown or hidden), not a drag

export class TouchButtons {
  constructor({ stored, store, press, stick, look, arranged }) {
    Object.assign(this, { store, arranged });
    this.saved = stored("touchButtons", {}) ?? {};
    this.at = {};
    // (kept before plugins could add theirs: which of vvoid's own were shown, not which are hidden)
    this.hidden = new Set(Array.isArray(this.saved.hidden) ? this.saved.hidden
      : Array.isArray(this.saved.shown) ? OWN.filter((b) => !this.saved.shown.includes(b.id)).map((b) => b.id)
      : OWN.filter((b) => !b.shown).map((b) => b.id));
    // each layer's size: its scale; a row's gap (pixels) and height (times its width), too
    this.shapes = this.saved.shapes && typeof this.saved.shapes === "object" ? this.saved.shapes : {};
    this.oldScale = SIZES[this.saved.size] ?? 1;
    this.arranging = false;
    this.onFoot = false;
    this.seated = false;
    this.held = new Map(); // pointer id -> what it holds: { b, x, y } (a button), or the stick's { b, ox, oy }
    this.list = [];        // every button: vvoid's own, then the plugins'
    // a group of buttons: here() (arranged here, a dimension's own), on() (pressed now), press(id, down, t), look
    this.groups = { vvoid: { title: "flying", here: () => true, on: () => !this.seated, press: (id, down) => press(id, down), look: true } };
    this.layer = "vvoid"; // arranging: the group shown to be arranged
    this.stick = stick;
    this.look = look;

    this.el = Object.assign(document.createElement("div"), { id: "touchButtons" });
    // arranging: a bar at the top, saying what to do, with the layer's size, as they began, and done
    this.bar = Object.assign(document.createElement("div"), { id: "touchArrange" });
    this.sizes = Object.assign(document.createElement("span"), { className: "sizes" });
    this.layers = Object.assign(document.createElement("span"), { className: "sizes" });
    const button = (label, click) => Object.assign(document.createElement("button"), { type: "button", textContent: label, onclick: click });
    this.hint = Object.assign(document.createElement("span"), { textContent: "drag to move · tap to show or hide" });
    this.bar.append(this.layers, this.hint, this.sizes,
      button("as they began", () => this.reset()), Object.assign(button("done", () => this.arrange(false)), { className: "done" }));
    document.body.append(this.el, this.bar);
    for (const b of OWN) this.make(b);
    // (no page zoom, no text picked, no menu held up under a thumb: every touch on them is theirs)
    this.el.addEventListener("touchstart", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("resize", () => this.layout());
    this.layout();
  }

  // A plugin's own buttons, in a group of their own (added once), a layer of their own when arranged
  // (named title): [id, label, where it begins: [side, from it, from the bottom (or the top: [side, x, y,
  // "top"])], across (pixels, at first)], side being left, right or center (from the middle, to the right).
  // Or, with row: [side, x, from the bottom], they are a row, side by side (gap pixels between them), moved
  // as one and never hidden one by one: each needs no place of its own. here(): it is arranged now (in its
  // own dimension); on(): it is shown and pressed now; has(id): that one of them is there now (each, unless
  // it says); press(id, down, t): t the moment it was, on the page's clock (performance.now). A thumb on one
  // does not turn the view, unless look is true. fit(): where what it stands for is drawn on the screen now,
  // { x, y, across, gap } in pixels (a row's middle, each one's width, between them), for "fit" when
  // arranging; null when it cannot say. alone(): while it says so, vvoid's own are not shown (a song
  // watched: nothing to fly)
  add(group, list, { title = group, here = () => true, on = () => true, has = () => true, press, look = false, row = null, gap = 8, fit = null, alone = null } = {}) {
    if (this.groups[group]) return;
    this.groups[group] = { title, here, on, has, press, look, fit, alone, row: row && { at: { h: row[0], x: row[1], v: "bottom", y: row[2] }, gap, list: [] } };
    if (row) this.at[group] = valid(this.saved.at?.[group]) ?? { ...this.groups[group].row.at };
    for (const [id, label, at, across = 58] of list) {
      const [h, x, y, v = "bottom"] = at ?? row, b = { id: `${group}:${id}`, own: id, group, label, afoot: label, at: { h, x, v, y }, shown: true, across };
      this.make(b);
      this.groups[group].row?.list.push(b);
    }
    this.layout();
  }

  make(b) {
    const el = Object.assign(document.createElement("div"), { className: b.id === "walk" ? "stick" : "button", hidden: true });
    el.dataset.id = b.id;
    el.append(Object.assign(document.createElement("span"), { textContent: b.label }));
    if (b.id === "walk") el.prepend((this.knob = Object.assign(document.createElement("i"), { className: "knob" })));
    b.el = el;
    this.at[b.id] = valid(this.saved.at?.[b.id]) ?? { ...b.at };
    this.listen(b);
    this.list.push(b);
    this.el.append(el);
  }

  save() {
    this.store("touchButtons", { at: this.at, hidden: [...this.hidden], shapes: this.shapes });
  }
  // a layer's size as set: its scale, and a row's gap and height
  shape(group) {
    const kept = this.shapes[group] ?? {}, num = (v, lo, hi, or) => (Number.isFinite(v) ? clamp(v, lo, hi) : or);
    return { scale: num(kept.scale, 0.3, 3, this.oldScale), gap: num(kept.gap, 0, 120, this.groups[group].row?.gap ?? 8), tall: num(kept.tall, 0.5, 5, 1) };
  }

  // each where it was put, inside the screen, at its size (a row: its middle where it was put, the whole
  // of it kept inside, and each side by side along it)
  layout() {
    const point = (at) => [at.h === "left" ? at.x : at.h === "center" ? innerWidth / 2 + at.x : innerWidth - at.x, at.v === "top" ? at.y : innerHeight - at.y];
    for (const b of this.list) {
      const row = this.groups[b.group].row, { scale, gap, tall } = this.shape(b.group), across = b.across * scale, r = across / 2;
      const high = across * (row ? tall : 1);
      let [x, y] = point(this.at[row ? b.group : b.id]), half = r;
      if (row) {
        const step = across + gap, i = row.list.indexOf(b), n = row.list.length;
        half = ((n - 1) / 2) * step + r;
        x = (half * 2 + 8 > innerWidth ? innerWidth / 2 : clamp(x, half + 4, innerWidth - half - 4)) + (i - (n - 1) / 2) * step; // (wider than the screen: in its middle)
      }
      Object.assign(b.el.style, {
        width: `${across}px`, height: `${high}px`, borderRadius: high > across * 1.15 ? `${Math.min(18, across / 3)}px` : "", // (tall: a column, not a pill)
        left: `${row ? x : clamp(x, r + 4, innerWidth - r - 4)}px`, top: `${clamp(y, high / 2 + 4, innerHeight - high / 2 - 4)}px`,
      });
    }
    this.update();
  }
  // a row's middle, on the screen now (see layout)
  rowMiddle(group) {
    const { list } = this.groups[group].row, first = list[0].el.getBoundingClientRect(), last = list.at(-1).el.getBoundingClientRect();
    return [(first.left + last.right) / 2, (first.top + first.bottom) / 2];
  }

  // Each frame (and as they change): which are shown. Its group on now (vvoid's own out of a seat, and while
  // no plugin's wants the screen alone; mania's while a song plays), it there now, and not hidden; arranging,
  // every one of the groups here, the hidden ones faintly.
  // On foot (bhop, the edge) the stick walks and the buttons jump and duck; flying, it flies, they rise and sink.
  update({ afoot = this.onFoot, seated = this.seated } = {}) {
    this.seated = seated;
    if (afoot !== this.onFoot) {
      this.onFoot = afoot;
      for (const b of this.list) b.el.querySelector("span").textContent = afoot ? b.afoot : b.label;
    }
    const alone = Object.values(this.groups).some((g) => g.alone?.());
    for (const b of this.list) {
      const group = this.groups[b.group], faint = !group.row && this.hidden.has(b.id); // (a row is never hidden one by one)
      const out = this.arranging ? b.group !== this.layer : faint || !group.on() || (b.group === "vvoid" && alone) || (b.own !== undefined && !group.has(b.own));
      if (b.el.hidden !== out) b.el.hidden = out;
      b.el.classList.toggle("faint", faint);
    }
    // (one gone from under a thumb, its group off now: let go, never left held)
    for (const [pointer, hold] of this.held) if (hold.b.el.hidden) this.letGo(pointer, hold);
  }

  // the layer's size, as sliders: how large, and a row's gap and height; and fit, if its plugin can say where
  drawSizes() {
    const group = this.groups[this.layer], shape = this.shape(this.layer);
    const slider = (label, key, min, max, step, show) => {
      const input = Object.assign(document.createElement("input"), { type: "range", min, max, step, value: shape[key] });
      const out = Object.assign(document.createElement("output"), { textContent: show(shape[key]) });
      input.addEventListener("input", () => {
        this.shapes[this.layer] = { ...this.shape(this.layer), [key]: Number(input.value) };
        out.textContent = show(Number(input.value));
        this.layout();
        this.save();
      });
      const el = Object.assign(document.createElement("label"), { className: "slide" });
      el.append(Object.assign(document.createElement("span"), { textContent: label }), input, out);
      return el;
    };
    const fit = group.fit && Object.assign(document.createElement("button"), { type: "button", textContent: "fit to the field", onclick: () => this.fit() });
    this.sizes.replaceChildren(
      slider("size", "scale", 0.3, 3, 0.01, (v) => `${Math.round(v * 100)}%`),
      ...(group.row ? [slider("gap", "gap", 0, 120, 1, (v) => `${v}px`), slider("height", "tall", 0.5, 5, 0.05, (v) => `${Math.round(v * 100)}%`)] : []),
      ...(fit ? [fit] : []));
  }

  // a row over what it stands for (mania's lanes over its receptors): as wide, as far apart, its middle there
  fit() {
    const group = this.groups[this.layer], to = group.fit?.(), first = group.row?.list[0];
    if (!to || !first) return;
    this.shapes[this.layer] = { ...this.shape(this.layer), scale: to.across / first.across, gap: Math.max(0, to.gap) };
    const v = to.y < innerHeight / 2 ? "top" : "bottom";
    this.at[this.layer] = { h: "center", x: Math.round(to.x - innerWidth / 2), v, y: Math.round(v === "top" ? to.y : innerHeight - to.y) };
    this.layout();
    this.save();
    this.drawSizes();
  }

  // the layer arranged now, as it began: where, which shown, its size
  reset() {
    const group = this.groups[this.layer];
    for (const b of this.list) {
      if (b.group !== this.layer) continue;
      this.at[b.id] = { ...b.at };
      if (b.shown) this.hidden.delete(b.id); else this.hidden.add(b.id);
    }
    if (group.row) this.at[this.layer] = { ...group.row.at };
    this.shapes[this.layer] = { scale: 1, gap: group.row?.gap ?? 8, tall: 1 };
    this.layout();
    this.save();
    this.drawSizes();
  }

  // the layers to arrange here: vvoid's own, and each plugin's group here (in its dimension), one shown at
  // a time; at first the plugin's, that being why you are arranging there
  drawLayers() {
    const here = Object.entries(this.groups).filter(([, g]) => g.here());
    this.layers.replaceChildren(...(here.length < 2 ? [] : here.map(([name, g]) => Object.assign(document.createElement("button"), {
      type: "button", textContent: g.title, className: name === this.layer ? "on" : "",
      onclick: () => { this.layer = name; this.drawLayers(); this.drawSizes(); },
    }))));
    this.hint.textContent = this.groups[this.layer].row ? "drag to move them, side by side" : "drag to move · tap to show or hide";
    this.update();
  }

  // (layer: the group to arrange first, a plugin's asked from its own window; else the last here)
  arrange(on, layer) {
    if (on === this.arranging) return;
    this.release();
    this.arranging = on;
    if (on) {
      this.layer = this.groups[layer] ? layer : Object.entries(this.groups).findLast(([, g]) => g.here())[0];
      this.drawLayers();
      this.drawSizes();
    }
    document.body.classList.toggle("arranging", on);
    this.update();
    this.arranged?.(on);
  }

  // every button let go (the window left, the map opened over them): nothing stays held down
  release() {
    for (const [pointer, hold] of this.held) this.letGo(pointer, hold);
  }

  letGo(pointer, hold, t = performance.now()) {
    this.held.delete(pointer);
    if (this.arranging) return;
    const b = hold.b;
    b.el.classList.remove("down");
    if (b.id === "walk") {
      this.knob.style.transform = "";
      this.stick(0, 0);
    } else this.groups[b.group].press(b.own ?? b.id, false, t);
  }

  listen(b) {
    const el = b.el;
    el.addEventListener("pointerdown", (e) => {
      if ([...this.held.values()].some((hold) => hold.b === b)) return; // (one thumb to a button)
      e.preventDefault();
      try { el.setPointerCapture?.(e.pointerId); } catch {} // (the pointer locked meanwhile: none to capture, the press still a press)
      if (this.arranging) {
        // (a row's: held by its middle, wherever along it the thumb is)
        const box = el.getBoundingClientRect(), [mx, my] = this.groups[b.group].row ? this.rowMiddle(b.group) : [box.left + box.width / 2, box.top + box.height / 2];
        return void this.held.set(e.pointerId, { b, sx: e.clientX, sy: e.clientY, moved: false, dx: e.clientX - mx, dy: e.clientY - my });
      }
      el.classList.add("down");
      if (b.id === "walk") {
        this.held.set(e.pointerId, { b, ox: e.clientX, oy: e.clientY });
        return this.stick(0, 1); // (pressed: ahead, until the thumb leans another way)
      }
      this.held.set(e.pointerId, { b, x: e.clientX, y: e.clientY });
      this.groups[b.group].press(b.own ?? b.id, true, e.timeStamp);
    });
    el.addEventListener("pointermove", (e) => {
      const hold = this.held.get(e.pointerId);
      if (!hold) return;
      if (this.arranging) {
        if (!hold.moved && Math.hypot(e.clientX - hold.sx, e.clientY - hold.sy) < NUDGE) return;
        hold.moved = true;
        // put by the edge it is nearest, or the middle (and kept there as the screen turns)
        const x = e.clientX - hold.dx, y = e.clientY - hold.dy, v = y < innerHeight / 2 ? "top" : "bottom";
        const h = x < innerWidth / 3 ? "left" : x > (innerWidth * 2) / 3 ? "right" : "center";
        this.at[this.groups[b.group].row ? b.group : b.id] = { h, x: Math.round(h === "left" ? x : h === "center" ? x - innerWidth / 2 : innerWidth - x), v, y: Math.round(v === "top" ? y : innerHeight - y) };
        return this.layout();
      }
      if (b.id === "walk") {
        const reach = el.offsetWidth / 2, dx = e.clientX - hold.ox, dy = e.clientY - hold.oy, far = Math.hypot(dx, dy), k = far > reach ? reach / far : 1;
        this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        return far < DEAD ? this.stick(0, 1) : this.stick((dx * k) / reach, (-dy * k) / reach);
      }
      // a thumb on a button turns the view as it moves, as a finger on the picture does
      if (this.groups[b.group].look) this.look(e.clientX - hold.x, e.clientY - hold.y);
      hold.x = e.clientX;
      hold.y = e.clientY;
    });
    const up = (e) => {
      const hold = this.held.get(e.pointerId);
      if (!hold) return;
      this.letGo(e.pointerId, hold, e.timeStamp);
      if (!this.arranging) return;
      // arranging, a tap: shown, or hidden (hidden ones show faintly while arranging, to be had back)
      if (!hold.moved && e.type === "pointerup" && !this.groups[b.group].row && !this.hidden.delete(b.id)) this.hidden.add(b.id);
      this.layout();
      this.save();
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const valid = (at) => (at && ["left", "center", "right"].includes(at.h) && ["top", "bottom"].includes(at.v) && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : null);
