import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

/** Local contact shading for the yard's solid objects. Landscape is beauty-only
 * layer 1: grass does not need another geometry or shadow render for this pass. */
export class ContactShadingPass extends SSAOPass {
  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    const layers = this.camera.layers.mask;
    const shadows = renderer.shadowMap.autoUpdate;
    this.camera.layers.disable(1);
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      this.camera.layers.mask = layers;
      renderer.shadowMap.autoUpdate = shadows;
    }
  }
}
