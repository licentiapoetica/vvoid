// Locks: a password in front of a plugin, for any of them, and off unless it is set. VVOID_PASSWORD (in
// vvoid's .env) locks every plugin; VVOID_<NAME>_PASSWORD (the plugin's folder name in capitals, - as _)
// is that plugin's own instead, over it (set empty, the plugin is open whatever VVOID_PASSWORD says).
// How long a given password is remembered: VVOID_REMEMBER for all, VVOID_<NAME>_REMEMBER for one, over it
// (30d, 12h, 10m, 90s; a bare number is days). Unset or 0: never, it is asked every time a portal is gone
// through (the session lasts only while you are in its dimensions: the page lets it go as you leave, and
// it is kept nowhere but in memory). Remembered, one right password opens every plugin it is the
// password of (and that remembers), at once, and the session is kept on disk. A locked plugin: everything its
// server answers under /plugins/<name>/ and /api/<name>/ (and its websockets there) then asks for a
// session, and its portal asks for the password (see public/src/locks.js). A page that gives it is given a
// session: a cookie for vvoid's address, for as long as it is remembered from when it was last used, kept on disk by its hash only
// (in .cache/<name>/sessions.json, or VVOID_<NAME>_CACHE), so vvoid restarting does not lock everyone out.
// Open whatever the session: the files in its public/ folder (the page's own code: nothing kept from
// anyone belongs there), the way in itself (/plugins/<name>/lock), and the routes the plugin names as
// open (`unlocked`, in what its server.js returns).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PASSING = 12 * 3_600_000; // ms a session not remembered lasts at most, unused (it is let go on leaving)
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
// "30d", "12h", "10m", "90s" or a bare number of days, in ms (0: not remembered)
const duration = (text) => {
  const m = String(text ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/);
  return m ? Number(m[1]) * UNITS[m[2] || "d"] : 0;
};
const hash = (text) => createHash("sha256").update(text).digest();

// wrong passwords, at any lock: five from the same address, and it waits five minutes before it may try
// again (the count starts over then, or after five minutes without one); and the whole server takes at
// most twenty wrong ones a minute
const TRIES = 5, COOLDOWN = 5 * 60_000;
const tries = new Map(); // address -> { fails, until, last }
let wrongs = [];
const minutes = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const all = []; // every lock (opened together when they share a password)

// the lock of the plugin `name` (made for every plugin; it locks only with a password set)
export function makeLock(name, { here, send, readBody, whoIs, admin }) {
  const env = name.toUpperCase().replace(/-/g, "_");
  const own = process.env[`VVOID_${env}_PASSWORD`], password = own ?? process.env.VVOID_PASSWORD ?? "";
  const remember = duration(process.env[`VVOID_${env}_REMEMBER`] ?? process.env.VVOID_REMEMBER); // ms (0: asked every time)
  const SESSION_FOR = remember || PASSING;
  const cache = path.resolve(here, process.env[`VVOID_${env}_CACHE`] || path.join(".cache", name));
  const file = path.join(cache, "sessions.json");
  // (for the whole site: a plugin may answer elsewhere than under /plugins/<name>/, under /api/<name>,
  // or a site it passes through, and asks its lock there)
  const cookie = `vvoid_${name}`, scope = "Path=/; HttpOnly; SameSite=Strict";
  const log = (line) => console.log(`[vvoid] ${name}: ${line}`);

  const sessions = new Map(); // sha256 of the cookie (hex) -> last used (ms)
  let saved = 0;
  if (password && remember) {
    fs.readFile(file, "utf8").then((text) => {
      for (const [k, at] of Object.entries(JSON.parse(text))) if (Date.now() - at < SESSION_FOR) sessions.set(k, at);
    }).catch(() => {});
  }
  const save = async () => {
    saved = Date.now();
    if (!remember) return; // (not remembered: kept in memory only)
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(file, JSON.stringify(Object.fromEntries(sessions)));
  };
  // (every cookie of its name: one left from before, under a narrower path, comes first and must not hide it)
  const cookiesOf = (req) => (req.headers.cookie ?? "").split(/;\s*/).filter((c) => c.startsWith(`${cookie}=`)).map((c) => c.slice(cookie.length + 1));
  const cookieOf = (req) => cookiesOf(req).find((token) => sessions.has(hash(token).toString("hex"))) ?? cookiesOf(req)[0] ?? null;

  // whether this request may pass: no password set, or a session
  function open(req) {
    if (!password || admin?.is(req)) return true; // (an admin goes through every lock: see admin.js)
    const token = cookieOf(req);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    const key = hash(token).toString("hex"), at = sessions.get(key);
    if (!at || Date.now() - at > SESSION_FOR) return sessions.delete(key), false;
    sessions.set(key, Date.now());
    if (Date.now() - saved > 3_600_000) save().catch(() => {});
    return true;
  }

  const right = (given) => typeof given === "string" && given.length > 0 && given.length < 1024 && timingSafeEqual(hash(given), hash(password));
  async function login(req, res) {
    const who = whoIs(req), now = Date.now();
    for (const [a, old] of tries) if (now >= old.until && now - old.last >= COOLDOWN) tries.delete(a); // (over, and a while ago: forgotten)
    const t = tries.get(who) ?? { fails: 0, until: 0, last: 0 };
    wrongs = wrongs.filter((at) => now - at < 60_000);
    if (now < t.until) return send(res, 429, { error: `too many wrong passwords: wait ${minutes(t.until - now)}`, wait: Math.ceil((t.until - now) / 1000) });
    if (wrongs.length >= 20) return send(res, 429, { error: "too many wrong passwords here: wait a minute", wait: 60 });
    if (now - t.last >= COOLDOWN || (t.until && now >= t.until)) Object.assign(t, { fails: 0, until: 0 }); // (a cooldown over, or none in a while: counted from nothing)
    const body = await readBody(req, 2048).catch(() => null);
    if (right(body?.password)) {
      tries.delete(who);
      // this one, and every other with the same password: a session (and its cookie) each
      const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      const opened = all.filter((other) => other.name === name || (remember && other.remember && other.password === password));
      res.writeHead(200, { "content-type": "application/json", "set-cookie": opened.map((other) => other.grant(now, secure)) });
      res.end(JSON.stringify({ ok: true, opened: opened.map((other) => other.name) }));
      log(`opened from ${who}${opened.length > 1 ? `, with ${opened.length - 1} more of the same password` : ""}`);
      return;
    }
    t.fails++;
    t.last = now;
    if (t.fails >= TRIES) t.until = now + COOLDOWN;
    tries.set(who, t);
    wrongs.push(now);
    log(`a wrong password from ${who} (${t.fails} in a row${t.until > now ? `: resting ${COOLDOWN / 60_000} minutes` : ""})`);
    const left = TRIES - t.fails;
    send(res, 403, { error: left > 0 ? `wrong password · ${left} ${left === 1 ? "try" : "tries"} left` : `wrong password · wait ${minutes(COOLDOWN)}` });
  }
  function logout(req, res) {
    const token = cookieOf(req);
    if (token) sessions.delete(hash(token).toString("hex"));
    save().catch(() => {});
    res.writeHead(200, { "content-type": "application/json", "set-cookie": `${cookie}=; ${scope}; Max-Age=0` });
    res.end(JSON.stringify({ ok: true }));
  }

  // a new session: its cookie
  function grant(now, secure) {
    const token = randomBytes(32).toString("hex");
    sessions.set(hash(token).toString("hex"), now);
    save().catch(() => {});
    // (not remembered: no Max-Age, gone with the browser, and let go by the page sooner, as you leave)
    return `${cookie}=${token}; ${scope}${remember ? `; Max-Age=${Math.round(SESSION_FOR / 1000)}` : ""}${secure}`;
  }
  if (password) all.push({ name, password, remember, grant });

  const lock = {
    name,
    set: !!password, // (a password is set: the plugin is locked)
    open,
    unlocked: [],    // its routes (under /plugins/<name>/) open without a session, as its server.js names them
    sessions: () => sessions.size, // (how many pages are in, for its status)
    // a request under /plugins/<name>/ (route: the rest of its path), before the plugin is asked: true
    // when it was answered here (the way in, or refused); isFile(route) says whether it is one of its public files
    async guard(req, res, route, isFile) {
      if (route === "lock") {
        if (req.method === "GET") return send(res, 200, { locked: lock.set, open: open(req), remember: remember / 1000 }), true;
        // (asked from another page, a form posted from elsewhere, it is never ours: vvoid's page always says so)
        if (req.headers["x-vvoid-lock"] !== "1") return send(res, 403, { error: "not from vvoid's page" }), true;
        if (req.method === "POST" && lock.set) return await login(req, res), true;
        if (req.method === "DELETE") return logout(req, res), true;
        return send(res, 405, { error: "no" }), true;
      }
      if (!lock.set || lock.unlocked.includes(route) || open(req) || (await isFile(route))) return false;
      send(res, 401, { error: "locked" });
      return true;
    },
  };
  if (password) log(`locked: ${own ? "its own password" : "vvoid's password"} is asked at its portal${remember ? `, remembered ${remember / 3_600_000 >= 24 ? `${+(remember / 86_400_000).toFixed(2)} days` : `${+(remember / 60_000).toFixed(1)} minutes`}` : ", every time"}`);
  return lock;
}
