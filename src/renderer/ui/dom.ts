export const pageX = (event: PointerEvent): number => event.clientX
export const pageY = (event: PointerEvent): number => event.clientY

/** `<div class=cls>` with children; strings become text nodes. */
export function div(cls: string, ...children: (Node | string)[]): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  d.append(...children)
  return d
}

export function img(cls: string, src: string): HTMLImageElement {
  const i = document.createElement('img')
  i.className = cls
  i.src = src
  return i
}

/** A clickable `<div>`. */
export function button(cls: string, onClick: () => void, ...children: (Node | string)[]): HTMLDivElement {
  const d = div(cls, ...children)
  d.addEventListener('click', onClick)
  return d
}

/** Activate the pet window when editing; the containing panel releases focus when it closes. */
export function typeable(input: HTMLInputElement): HTMLInputElement {
  const activate = (): void => window.qqpet.setFocusable(true)
  // Pointer activation also restores native focus if another panel disabled it.
  input.addEventListener('pointerdown', activate)
  input.addEventListener('focus', activate)
  // Leaving the input (including to pick an IME candidate) must not blur it or
  // disable the whole window. Switching inputs must not do that either.
  return input
}
