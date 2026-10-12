// A cube's picture drawn a face at a time. three.js's CubeCamera draws all six faces at once, which means six whole
// pictures in one frame; in a headset that frame comes late, and every one of them is felt as a judder. Drawn a face
// a frame, the same work is spread evenly. face: 0 to 5, in CubeCamera's order (+x −x +y −y +z −z). Its mipmaps (if
// the target has them) are made with the last face (5), once all six are there, as CubeCamera makes them; so the
// faces are to be drawn in order, and the cube read only once face 5 is done (or read while it fills, if a face a
// few frames older than the next is no matter: the void's sky)
export function drawCubeFace(cubeCamera, renderer, scene, face) {
  if (cubeCamera.parent === null) cubeCamera.updateMatrixWorld();
  if (cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
    cubeCamera.coordinateSystem = renderer.coordinateSystem;
    cubeCamera.updateCoordinateSystem();
  }
  const { renderTarget, activeMipmapLevel } = cubeCamera, texture = renderTarget.texture;
  const was = renderer.getRenderTarget(), wasFace = renderer.getActiveCubeFace(), wasLevel = renderer.getActiveMipmapLevel();
  const xr = renderer.xr.enabled, mipmaps = texture.generateMipmaps;
  renderer.xr.enabled = false;
  texture.generateMipmaps = mipmaps && face === 5;
  try {
    renderer.setRenderTarget(renderTarget, face, activeMipmapLevel);
    if (renderer.state.buffers.depth.getReversed() && renderer.autoClear === false) renderer.clearDepth();
    renderer.render(scene, cubeCamera.children[face]);
  } finally {
    texture.generateMipmaps = mipmaps;
    renderer.setRenderTarget(was, wasFace, wasLevel);
    renderer.xr.enabled = xr;
  }
  if (face === 5) texture.needsPMREMUpdate = true;
}
