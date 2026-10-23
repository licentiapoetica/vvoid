export const CELL = 5200;  // width of one sector, in world units
// Structures and blueprints are designed in a box of half-extent REACH (so Claude's coordinates
// run about -250..250) and then drawn UNIT times larger. Sectors are far wider than what stands
// in them: there is a lot of dark between one place and the next.
export const REACH = 260;
export const UNIT = 2;
export const SIGHT = CELL / 600; // how much further everything is than when sectors were 600 wide
// The hub's portals stand on one circle round its clock, level with it, each facing the middle, all far
// out, alone in the dark between the places round the hub (they begin about 4680 out along each axis and
// end about 5720, the next ones about 9880 to 10920): as they are laid (18 of them, once), none nearer any place
// than about 1020. hubPortal(angle): where one stands at that angle round the circle (0 straight ahead as
// you arrive, a quarter turn to the right, and so on), and which way is in (towards the clock); further
// out or nearer than the circle (ring), and above or below it (height), for one an admin has placed
export const PORTAL_RING = 8800;
export const hubPortal = (angle, ring = PORTAL_RING, height = 0) => ({
  at: [Math.sin(angle) * ring, height, -Math.cos(angle) * ring],
  in: [-Math.sin(angle), 0, Math.cos(angle)],
});
// how far off a portal is seen (further while zoomed in, and coming into being as it comes into that
// reach: see reach.js); one that forms itself (see formsItself), as far as anything is
export const PORTAL_SEEN = 7000;
export const PORTAL_HOLE = 104; // how wide a ring's dark sphere is, unless its plugin says (hole)
// Who stands where on that circle: the plugins this vvoid has that have a portal (each says so, and
// what else it is, in its plugin.json: see manifest.js), in their order round it (portalOrder), each the
// same way from the next, so the circle is always evenly kept, however many there are. hubSlot(name):
// where that one stands. Unless an admin has placed it (VVOID_<NAME>_PORTAL, see server.js: { angle in
// degrees, ring, height }): there, the others standing where they would have stood all the same.
// (the panel lays them the same way: this file is its too)
export const portalOrder = (plugins) => plugins.filter((p) => p.portal !== false).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name)).map((p) => p.name);
let portals = [], placed = {}, said = new Map();
// plugins: what each says of itself (see manifest.js), only those with a page; places: an admin's
export function setPortals(plugins, places = {}) {
  said = new Map(plugins.map((p) => [p.name, p]));
  portals = portalOrder(plugins);
  placed = places ?? {};
}
export const portalNames = () => portals;
// what a portal's plugin says of it ({} if nothing): title, hole, formsItself, named, ...
export const portalOf = (name) => said.get(name) ?? {};
// what one is called (under the crosshair, and as you fly in)
export const portalTitle = (name) => said.get(name)?.title ?? name;
export const hubSlot = (name) => {
  const own = placed[name];
  if (own && Number.isFinite(own.angle)) return hubPortal((own.angle / 180) * Math.PI, own.ring ?? PORTAL_RING, own.height ?? 0);
  return hubPortal((Math.max(0, portals.indexOf(name)) / portals.length) * Math.PI * 2);
};
// where everyone starts, unless they have chosen a place on the map (and where its origin button takes
// you back to): in the hub, above the clock and off to one side, looking down at it a little
export const SPAWN = [-380, 207, -313];
