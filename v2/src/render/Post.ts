// Post stack (pmndrs postprocessing + N8AO): render → SSAO → bloom, vignette,
// ACES → SMAA. The scene renders to a half-float target, so bloom keys on
// luminance above 1: only emissive neon, bulbs and screens cross it, which is
// the "selective" part without per-object selection lists.

import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'high' | 'medium' | 'low';

export class Post {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private ao: N8AOPostPass;
  private bloom: BloomEffect;
  private grade: EffectPass;
  private aa: EffectPass;
  private camera: THREE.Camera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    Object.assign(this.ao.configuration, {
      aoRadius: 1.6,
      distanceFalloff: 0.8,
      intensity: 2.2,
      aoSamples: 8,
      denoiseSamples: 4,
      denoiseRadius: 6,
      // One denoise pass at half resolution: the default two passes at full
      // resolution cost more than the whole scene render on an A18 Pro.
      denoiseIterations: 1,
      color: new THREE.Color(0x0a0408),
      gammaCorrection: false,
      halfRes: true,
      depthAwareUpsampling: true,
    });
    this.bloom = new BloomEffect({
      luminanceThreshold: 1.05,
      luminanceSmoothing: 0.35,
      intensity: 1.15,
      mipmapBlur: true,
      radius: 0.72,
    });
    // Bloom is soft by nature; half resolution looks the same and halves its cost.
    this.bloom.resolution.scale = 0.5;
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.5 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.grade = new EffectPass(camera, this.bloom, vignette, tone);
    this.aa = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.aa);
  }

  setQuality(q: Quality): void {
    // SSAO only on High; Medium/Low rely on the AO baked into the assets.
    this.ao.enabled = q === 'high';
    this.bloom.mipmapBlurPass.levels = q === 'low' ? 4 : 8;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h, false);
  }

  render(camera: THREE.Camera, dt: number): void {
    if (camera !== this.camera) {
      this.camera = camera;
      this.renderPass.mainCamera = camera;
      this.grade.mainCamera = camera;
      this.aa.mainCamera = camera;
      (this.ao as unknown as { camera: THREE.Camera }).camera = camera;
    }
    this.composer.render(dt);
  }
}
