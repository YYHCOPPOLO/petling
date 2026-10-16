/** Original pet dimensions scaled to the active desktop display, in DIP. */
export function petSizeFor(level: number, viewport: { width: number; height: number }): number {
  return (144 + 2 * Math.min(level, 10)) * viewport.width / 1920
}

/** Keep the toolbar readable, shrinking only when the display is too narrow. */
export function toolbarScaleFor(fit: number): number {
  return Math.max(0, Math.min(1, fit))
}
