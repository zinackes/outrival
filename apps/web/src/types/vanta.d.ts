// Vanta ships no types. Only the fog effect is used (landing hero); the factory
// takes a mount element + the three.js module and returns a handle whose
// destroy() must run on unmount (it owns a WebGL context).
declare module "vanta/dist/vanta.fog.min" {
  export interface VantaEffect {
    destroy(): void;
    setOptions?(options: Record<string, unknown>): void;
  }

  export interface VantaFogOptions {
    el: HTMLElement;
    THREE: unknown;
    mouseControls?: boolean;
    touchControls?: boolean;
    gyroControls?: boolean;
    minHeight?: number;
    minWidth?: number;
    /** Colors are 24-bit ints (0xRRGGBB), not CSS strings. */
    highlightColor?: number;
    midtoneColor?: number;
    lowlightColor?: number;
    baseColor?: number;
    blurFactor?: number;
    speed?: number;
    zoom?: number;
    scale?: number;
    scaleMobile?: number;
  }

  export default function FOG(options: VantaFogOptions): VantaEffect;
}
