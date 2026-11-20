import { Application, TextureStyle } from 'pixi.js';

export const VIEW_W = 427;
export const VIEW_H = 240;

/**
 * Pixi renders at the native 427×240. The canvas is then scaled by an integer
 * factor in *device* pixels with nearest-neighbour sampling, and letterboxed.
 */
export async function createPixiApp(parent: HTMLElement, background: number): Promise<Application> {
  TextureStyle.defaultOptions.scaleMode = 'nearest';
  const app = new Application();
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    background,
    antialias: false,
    resolution: 1,
    autoDensity: false,
    roundPixels: true,
    preference: 'webgl',
  });
  const canvas = app.canvas;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';
  parent.appendChild(canvas);

  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / VIEW_W, (window.innerHeight * dpr) / VIEW_H)));
    canvas.style.width = `${(VIEW_W * scale) / dpr}px`;
    canvas.style.height = `${(VIEW_H * scale) / dpr}px`;
    canvas.dataset.scale = String(scale);
  };
  fit();
  window.addEventListener('resize', fit);
  return app;
}
