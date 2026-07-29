// Shared math for positioning a small overlay (a light, a wheel disc, a chip)
// on top of a placed object's sprite. Every object image uses origin (0.5, 1)
// — center x, bottom y — so an overlay's native-pixel box within that same
// source art can be mapped to world space with one formula.
export interface NativeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function overlayPlacement(
  cabinetX: number,
  cabinetY: number,
  scale: number,
  nativeW: number,
  nativeH: number,
  box: NativeBox,
): { x: number; y: number; w: number; h: number } {
  const topLeftX = cabinetX - (nativeW * scale) / 2;
  const topLeftY = cabinetY - nativeH * scale;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return {
    x: topLeftX + cx * scale,
    y: topLeftY + cy * scale,
    w: (box.x1 - box.x0) * scale,
    h: (box.y1 - box.y0) * scale,
  };
}
