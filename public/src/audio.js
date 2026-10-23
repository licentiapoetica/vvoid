// Synthesized ambience: a drone per sector, bell shimmer, wind from speed. No samples.

export const MODES = {
  minor: [0, 3, 7, 10, 12, 15],
  dorian: [0, 2, 3, 7, 9, 12],
  lydian: [0, 4, 6, 7, 11, 12],
  phrygian: [0, 1, 5, 7, 8, 12],
  whole: [0, 2, 4, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9, 12],
};
export const semis = (n) => 2 ** (n / 12);
// s: as the sound starts (the start screen left), what the picture hears eased in from nothing over this
// long, as the master is (see start): measured against averages only just begun, a drone coming up
// reads as a burst, and the whole sky flashed with it
const WARM_IN = 5;

export class VoidAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 1; // the player's volume, 0..1 (the slider)
    this.mix = { void: 1, music: 1, sounds: 1, voice: 1, media: 1 }; // each kind of sound under it (see setMix)
    this.sound = { root: 55, mode: "lydian", shimmer: 0.5, darkness: 0.45, pulse: 0, tempo: 60 };
    this.levels = { bass: 0, mid: 0, high: 0, beat: 0 };
    this.averages = { bass: 0, mid: 0, high: 0 };
    this.hits = []; // heartbeat hits scheduled but not yet heard
    this.mic = null;
    this.listening = []; // music a plugin plays, while it is heard: the beat is listened for in it (see features)
  }

  // how loud each kind of sound is, under the volume (the Tab panel's mix: see the buses in start)
  setMix(name, level) {
    if (!(name in this.mix)) return;
    this.mix[name] = level = Math.max(0, Math.min(1.5, level));
    const bus = this.buses?.[name];
    if (bus) for (const gain of [bus.dry, bus.wet]) gain.gain.setTargetAtTime(this.busLevel(name), this.ctx.currentTime, 0.05);
  }
  // A plugin asking the void's own sound (the drone, the wind, the shimmer, the heartbeat) to keep down
  // while it has something of its own to be heard (who: whose ask; level 0..1, or null to take it back).
  // The quietest ask stands, under the mix.
  keepDown(who, level = null) {
    this.hushes ??= new Map();
    if (level == null) this.hushes.delete(who);
    else this.hushes.set(who, Math.max(0, Math.min(1, level)));
    const bus = this.buses?.void;
    if (bus) for (const gain of [bus.dry, bus.wet]) gain.gain.setTargetAtTime(this.busLevel("void"), this.ctx.currentTime, 0.4);
  }
  busLevel(name) { return this.mix[name] * (name === "void" && this.hushes?.size ? Math.min(...this.hushes.values()) : 1); }
  // where a plugin's sound of a kind goes (dry: as heard; wet: into the echo), within the mix
  out(name = "media") {
    return this.buses?.[name]?.dry ?? this.master;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    const now = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(this.level, now + 4);
    const limiter = ctx.createDynamicsCompressor();
    this.master.connect(limiter).connect(ctx.destination);

    // a wide hall over everything (the drone, whatever plays, every sound): silent until the entity opens
    // it up now and then (see Entity.meddle)
    this.space = ctx.createGain();
    this.space.gain.value = 0;
    const hall = ctx.createConvolver();
    hall.buffer = this.hall(ctx, 4.5);
    this.master.connect(this.space).connect(hall).connect(limiter);
    this.warpCents = 0;
    this.played = new Set(); // media elements playing in the world (as weak references), bent with the rest

    // what the picture listens to: the game's own sound, or the microphone when that is switched on
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.analyser.maxDecibels = -12;
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(this.analyser);

    // cheap reverb: two cross-fed delays through a low-pass
    this.reverb = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2200;
    const a = ctx.createDelay(1), b = ctx.createDelay(1), fa = ctx.createGain(), fb = ctx.createGain();
    a.delayTime.value = 0.37;
    b.delayTime.value = 0.53;
    fa.gain.value = fb.gain.value = 0.62;
    this.reverb.connect(a);
    this.reverb.connect(b);
    a.connect(fa).connect(damp).connect(b);
    b.connect(fb).connect(a);
    a.connect(wet);
    b.connect(wet);
    wet.connect(this.master);

    // each kind of sound on its own level on the way out (the Tab panel's mix, under the volume), to the
    // master and to the echo alike: the void's own (drone, wind, heartbeat, shimmer), music, sounds, the
    // entity's voice, and media (what plugins play: posts, radio)
    this.buses = Object.fromEntries(Object.keys(this.mix).map((name) => {
      const dry = ctx.createGain(), wet = ctx.createGain();
      dry.gain.value = wet.gain.value = this.busLevel(name);
      dry.connect(this.master);
      wet.connect(this.reverb);
      return [name, { dry, wet }];
    }));

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.8;
    this.droneLevel = ctx.createGain(); // lets the drone step back when other music plays
    this.placeLevel = ctx.createGain(); // and how loud the place you are in has it (its sound.level)
    this.filter.connect(this.placeLevel).connect(this.droneLevel);
    this.droneLevel.connect(this.buses.void.dry);
    this.droneLevel.connect(this.buses.void.wet);

    const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoDepth.gain.value = 120;
    lfo.connect(lfoDepth).connect(this.filter.frequency);
    lfo.start();

    // drone voices: sub, root, fifth, colour tone
    this.voices = [["sine", 0.5], ["sawtooth", 0.07], ["sine", 0.18], ["triangle", 0.1]].map(([type, level], i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type;
      osc.detune.value = (i - 1.5) * 4;
      gain.gain.value = level;
      osc.connect(gain).connect(this.filter);
      osc.start();
      return osc;
    });

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise = noise;
    wind.loop = true;
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = "bandpass";
    this.windBand.Q.value = 0.9;
    // and its hiss taken off the top: a soft rush of air, not static
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 2200;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windBand).connect(soft).connect(this.windGain).connect(this.buses.void.dry);
    wind.start();

    // the entity's voice: two close tones beating against each other, placed left or right of you
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = 0;
    this.voicePan = ctx.createStereoPanner();
    [[196, 1], [197.7, 1], [393.1, 0.3]].forEach(([frequency, level]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.value = level;
      osc.connect(gain).connect(this.voiceGain);
      osc.start();
    });
    this.voiceGain.connect(this.voicePan);
    this.voicePan.connect(this.buses.voice.dry);
    this.voicePan.connect(this.buses.voice.wet);

    this.setSector(this.sound, 0.01);
    this.boot();
    this.scheduleShimmer();
    this.schedulePulse();
  }

  ratios() {
    const colour = MODES[this.sound.mode][1];
    return [0.5, 1, 1.5, 2 * semis(colour)];
  }

  setSector(sound, glide = 3) {
    this.sound = sound;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.ratios().forEach((ratio, i) => this.voices[i].frequency.setTargetAtTime(sound.root * ratio, now, glide));
    this.filter.frequency.setTargetAtTime(220 + (1 - sound.darkness) * 1500, now, glide);
    this.placeLevel.gain.setTargetAtTime(sound.level ?? 1, now, glide);
  }

  setSpeed(speed) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // quiet, and rising slowly with speed; its pitch climbs too, but only so far (a surge is a
    // deeper rush, not a higher hiss)
    this.windGain.gain.setTargetAtTime(Math.min(speed / 450, 1) ** 1.6 * 0.1, now, 0.4);
    this.windBand.frequency.setTargetAtTime(Math.min(220 + speed * 1.4, 1400), now, 0.4);
  }

  ping(frequency, level, decay, when = this.ctx.currentTime) {
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    osc.connect(gain);
    gain.connect(this.buses.void.wet);
    gain.connect(this.buses.void.dry);
    osc.start(when);
    osc.stop(when + decay + 0.1);
  }

  // rising swell when the void first materializes
  boot() {
    const now = this.ctx.currentTime;
    const scale = MODES[this.sound.mode];
    this.ping(this.sound.root, 0.5, 6, now);
    scale.slice(0, 5).forEach((s, i) => this.ping(this.sound.root * 4 * semis(s), 0.05, 5, now + 0.6 + i * 0.35));
  }

  // a chime when a sector finishes materializing around you
  arrive() {
    if (!this.ctx) return;
    const scale = MODES[this.sound.mode];
    [0, 2, 4].forEach((d, i) => this.ping(this.sound.root * 4 * semis(scale[d]), 0.04, 4, this.ctx.currentTime + i * 0.18));
  }

  // The sector's heartbeat: two soft low hits per beat. Its loudness is the sector's `pulse`.
  schedulePulse() {
    const beat = 60 / this.sound.tempo;
    if (this.ctx.state === "running" && this.sound.pulse > 0.04) {
      const now = this.ctx.currentTime;
      for (const [offset, level] of [[0, 1], [0.3 * beat, 0.6]]) {
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), at = now + 0.05 + offset;
        osc.frequency.setValueAtTime(78, at);
        osc.frequency.exponentialRampToValueAtTime(36, at + 0.22);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(this.sound.pulse * level * 0.9, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
        osc.connect(gain).connect(this.buses.void.dry);
        osc.start(at);
        osc.stop(at + 0.45);
        this.hits.push({ at, strength: level * Math.min(1, 0.35 + this.sound.pulse) });
      }
    }
    setTimeout(() => this.schedulePulse(), beat * 1000);
  }

  // Bass, mid and high energy (each 0..1, self-levelling) and a beat envelope that jumps on a
  // bass onset and decays. Each one drives a different part of the picture.
  features(dt) {
    const out = this.levels;
    if (!this.ctx || this.ctx.state !== "running") return out;
    this.analyser.getByteFrequencyData(this.spectrum);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.round(lo / hz)), b = Math.min(this.spectrum.length, Math.round(hi / hz));
      let sum = 0;
      for (let i = a; i < b; i++) sum += this.spectrum[i];
      return sum / ((b - a) * 255);
    };
    const raw = { bass: band(30, 160), mid: band(160, 2200), high: band(2200, 12000) };
    // (the first time it is heard: the averages begin from it; and while it comes up, they keep up with it)
    if (this.warm === undefined) { this.warm = 0; Object.assign(this.averages, raw); }
    this.warm = Math.min(1, this.warm + dt / WARM_IN);
    const warm = this.warm * this.warm * (3 - 2 * this.warm);
    for (const name of ["bass", "mid", "high"]) {
      // measured against its own recent average: a steady drone sits low, anything that moves stands out
      const average = (this.averages[name] += (raw[name] - this.averages[name]) * Math.min(1, dt * (this.warm < 1 ? 3 : 0.6)));
      const level = Math.min(1, Math.max(0, 0.18 + ((raw[name] - average) / Math.max(average, 0.05)) * 2.5)) * warm;
      out[name] += (level - out[name]) * Math.min(1, dt * (level > out[name] ? 30 : 5));
    }
    // the game knows exactly when its own heartbeat lands; the room has to be listened for
    const now = this.ctx.currentTime;
    while (this.hits.length && this.hits[0].at <= now) out.beat = Math.max(out.beat, this.hits.shift().strength * warm);
    if (warm >= 1 && (this.mic || this.mediaOn || this.listening.some((heard) => heard())) && raw.bass > this.averages.bass + 0.035 && out.beat < 0.4) out.beat = 1;
    out.beat *= Math.exp(-dt * 5);
    return out;
  }

  // Let the picture listen to the room instead (music playing on speakers, a voice).
  async toggleMic() {
    if (!this.ctx) return false;
    if (this.mic) {
      this.mic.source.disconnect();
      this.mic.stream.getTracks().forEach((track) => track.stop());
      this.mic = null;
      this.master.connect(this.analyser);
      return false;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const source = this.ctx.createMediaStreamSource(stream);
    this.master.disconnect(this.analyser);
    source.connect(this.analyser); // analysed only, never played back
    this.mic = { stream, source };
    return true;
  }

  // the hall's echo: noise in both ears, dying away over seconds and darkening as it does
  // where what was playing goes as you pass through a portal: a long hall, ringing on after it has stopped
  // (a plugin's to ring out: see ringOut); made the first time it is wanted
  portalTail() {
    if (!this.ctx) return null;
    if (!this.tailIn) {
      this.tailIn = this.ctx.createGain();
      const hall = this.ctx.createConvolver(), level = this.ctx.createGain();
      hall.buffer = this.hall(this.ctx, 4.5);
      level.gain.value = 1.6;
      this.tailIn.connect(hall).connect(level).connect(this.master);
    }
    return this.tailIn;
  }

  hall(ctx, seconds) {
    const length = Math.floor(ctx.sampleRate * seconds), buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length, k = 0.08 + 0.9 * t; // the further in, the softer
        low += (Math.random() * 2 - 1 - low) * (1 - k);
        data[i] = low * (1 - t) ** 2.6 * (i < ctx.sampleRate * 0.02 ? i / (ctx.sampleRate * 0.02) : 1);
      }
    }
    return buffer;
  }

  // how much of the hall is heard (0 to about 0.4)
  setSpace(amount) {
    if (!this.ctx || Math.abs(amount - (this.spaceLevel ?? 0)) < 0.002) return;
    this.spaceLevel = amount;
    this.space.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.2);
  }

  // everything bent by this many cents: the drone's voices, and the media playing (played that much
  // faster or slower, their pitch let go with it)
  setWarp(cents) {
    if (!this.ctx || Math.abs(cents - this.warpCents) < 0.5) return;
    this.warpCents = cents;
    const now = this.ctx.currentTime, rate = 2 ** (cents / 1200);
    this.voices.forEach((osc, i) => osc.detune.setTargetAtTime((i - 1.5) * 4 + cents, now, 0.1));
    for (const ref of this.played) {
      const el = ref.deref();
      if (!el) { this.played.delete(ref); continue; }
      el.preservesPitch = false;
      el.playbackRate = rate;
    }
  }

  // A media element playing in the world (a plugin's: see main.js): its sound goes through the master
  // (volume, mute, the analyser, the entity's bending), at a level set by whoever plays it. Returns
  // that level's gain, or null before start.
  mediaOut(el) {
    if (!this.ctx) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const source = this.ctx.createMediaElementSource(el);
    source.connect(gain).connect(this.buses.media.dry);
    this.played.add(new WeakRef(el));
    if (this.warpCents) { el.preservesPitch = false; el.playbackRate = 2 ** (this.warpCents / 1200); }
    return { gain, source };
  }

  // while something a plugin plays is plainly heard, the drone steps back for it. who: whose it is, so
  // one plugin's silence does not take back another's (those that do not say share one)
  setMedia(on, who = "") {
    if (!this.ctx) return;
    this.mediaBy ??= new Set();
    if (on) this.mediaBy.add(who);
    else this.mediaBy.delete(who);
    on = this.mediaBy.size > 0;
    if (this.mediaOn === on) return;
    this.mediaOn = on;
    this.droneLevel.gain.setTargetAtTime(on ? 0.3 : 1, this.ctx.currentTime, 1.5);
  }

  // whether what plugins play now is music (a song, a station), not voices or posts: Irrlicht gives off
  // notes then (see back.js). Whose is music (setMedia's who): each plugin says (music, in its plugin.json:
  // see manifest.js), and main.js sets them here as the plugins are known
  get music() { return [...(this.mediaBy ?? [])].some((who) => this.musical?.has(who)); }

  // step back while something else has the stage (a Flash piece with its own sound)
  duck(on) {
    if (!this.ctx) return;
    this.ducked = on;
    this.master.gain.setTargetAtTime(on ? 0 : this.level, this.ctx.currentTime, 0.3);
  }

  entityVoice(level, pan) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voiceGain.gain.setTargetAtTime(level * 0.11, now, 0.5);
    this.voicePan.pan.setTargetAtTime(pan, now, 0.15);
  }

  // something leaving quickly: a falling breath of noise over a low thump
  sting() {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noise;
    band.type = "bandpass";
    band.Q.value = 2;
    band.frequency.setValueAtTime(2400, now);
    band.frequency.exponentialRampToValueAtTime(140, now + 0.9);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    source.connect(band).connect(gain);
    gain.connect(this.buses.sounds.dry);
    gain.connect(this.buses.sounds.wet);
    source.start(now);
    source.stop(now + 1.2);
    this.ping(48, 0.5, 1.6, now);
  }

  // flying into something: a knock, deeper and louder the harder
  bump(strength) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(150 - strength * 70, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25 + strength * 0.45, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain).connect(this.buses.sounds.dry);
    gain.connect(this.buses.sounds.wet);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  // refused (a wrong password at a locked portal): a knock, and under it two low tones a tritone apart,
  // sagging, the drone held down while they sound
  refuse() {
    if (!this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx, now = ctx.currentTime, low = ctx.createBiquadFilter(), gain = ctx.createGain();
    this.bump(0.8);
    low.type = "lowpass";
    low.frequency.setValueAtTime(900, now);
    low.frequency.exponentialRampToValueAtTime(160, now + 1.6);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.32, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
    low.connect(gain);
    gain.connect(this.buses.void.dry);
    gain.connect(this.buses.void.wet);
    for (const [from, type] of [[73, "sawtooth"], [73 * Math.SQRT2, "triangle"]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(from, now);
      osc.frequency.exponentialRampToValueAtTime(from * 0.71, now + 1.8);
      osc.connect(low);
      osc.start(now);
      osc.stop(now + 2);
    }
    this.master.gain.setTargetAtTime(this.level * 0.45, now, 0.05);
    if (!this.ducked) this.master.gain.setTargetAtTime(this.level, now + 0.9, 0.6);
  }

  // declined (no password given at a locked portal, Esc): a long breath out, darkening, over one low
  // tone that sags a fifth, the drone dipping a little while it sounds (milder than refuse: no knock)
  sigh() {
    if (!this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx, now = ctx.currentTime;
    const source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), breath = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(1100, now);
    band.frequency.exponentialRampToValueAtTime(180, now + 2);
    breath.gain.setValueAtTime(0.0001, now);
    breath.gain.exponentialRampToValueAtTime(0.18, now + 0.35);
    breath.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    source.connect(band).connect(breath);
    breath.connect(this.buses.void.dry);
    breath.connect(this.buses.void.wet);
    source.start(now);
    source.stop(now + 2.3);
    const osc = ctx.createOscillator(), tone = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(110 / 1.5, now + 2);
    tone.gain.setValueAtTime(0.0001, now);
    tone.gain.exponentialRampToValueAtTime(0.14, now + 0.4);
    tone.gain.exponentialRampToValueAtTime(0.0001, now + 2.3);
    osc.connect(tone);
    tone.connect(this.buses.void.dry);
    tone.connect(this.buses.void.wet);
    osc.start(now);
    osc.stop(now + 2.4);
    this.master.gain.setTargetAtTime(this.level * 0.75, now, 0.2);
    if (!this.ducked) this.master.gain.setTargetAtTime(this.level, now + 1.4, 0.8);
  }

  // everything stops; then one note
  hush(seconds) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0.004, now, 0.25);
    this.master.gain.setTargetAtTime(this.level, now + seconds, 1.2);
    this.ping(this.sound.root * 8, 0.12, 7, now + seconds);
  }

  scheduleShimmer() {
    setTimeout(() => {
      if (this.ctx.state === "running" && Math.random() < this.sound.shimmer) {
        const scale = MODES[this.sound.mode];
        const note = scale[Math.floor(Math.random() * scale.length)];
        this.ping(this.sound.root * (Math.random() < 0.5 ? 8 : 16) * semis(note), 0.025, 5);
      }
      this.scheduleShimmer();
    }, 1200 + Math.random() * 3500);
  }

  // how loud everything is: the player's volume, unless muted
  get level() {
    return this.muted ? 0 : 0.55 * this.volume ** 2; // squared, so the slider feels even from quiet to loud
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.ctx && !this.ducked) this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.05);
    return this.volume;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.2);
    return this.muted;
  }
}
