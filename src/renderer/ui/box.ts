import { info, save } from '../pet/store'

const SKINS = {
  normal: { head: ['normal/beijing1.bmp', 'normal/beijing2.bmp', 'normal/beijing3.bmp'], foot: ['normal/beijing6.bmp', 'normal/beijing7.bmp', 'normal/beijing8.bmp'] },
  vip: { head: ['vip/Q_01.png', 'vip/Q_02.png', 'vip/Q_03.png'], foot: ['vip/Q_07.png', 'vip/Q_08.png', 'vip/Q_09.png'] },
}

function row(cls: string, imgs: string[], extra?: HTMLElement): HTMLElement {
  // The hd frame slices are SVG redraws under the same names.
  const hd = save.settings.hd
  const r = document.createElement('div')
  r.className = cls
  imgs.forEach((src, i) => {
    const img = document.createElement('img')
    img.className = `${cls}${i + 1}`
    img.src = `pet/windowTip/${hd ? src.replace(/\.\w+$/, '.svg') : src}`
    r.appendChild(img)
  })
  if (extra) r.appendChild(extra)
  return r
}

/** Space kept between a frame shrunk to fit and the screen edges. */
const MARGIN = 16

/** Centered desktop panels scale to fit and release every observer/listener when closed. */
function show(frame: HTMLElement, keep?: HTMLElement): () => void {
  frame.dataset.hit = ''
  document.body.appendChild(frame)
  let dx = 0
  let dy = 0
  let scale = 1
  let cancelDrag = (): void => {}
  const place = (): void => {
    frame.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`
  }
  const refit = new ResizeObserver(() => {
    if (!frame.isConnected) { refit.disconnect(); cancelDrag(); return }
    scale = Math.max(0, Math.min(1, (innerWidth - MARGIN) / frame.offsetWidth, (innerHeight - MARGIN) / frame.offsetHeight))
    place()
  })
  refit.observe(frame)
  refit.observe(document.documentElement)
  frame.addEventListener('pointerdown', event => {
    if (event.button !== 0 || keep?.contains(event.target as Node) || (event.target as Element).closest('input,textarea,select,[contenteditable]')) return
    cancelDrag()
    const sx = event.clientX - dx
    const sy = event.clientY - dy
    const move = (next: PointerEvent): void => {
      if (next.pointerId !== event.pointerId) return
      dx = next.clientX - sx
      dy = next.clientY - sy
      place()
    }
    cancelDrag = (): void => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', cancelDrag)
      document.removeEventListener('pointercancel', cancelDrag)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', cancelDrag, { once: true })
    document.addEventListener('pointercancel', cancelDrag, { once: true })
  })
  return () => { cancelDrag(); refit.disconnect(); frame.remove() }
}

/**
 * The original's framed window ("box" component): centered, draggable by its
 * frame, with a close button. Returns a function that removes it.
 */
export function openBox(content: HTMLElement, opts: { vip?: boolean; onClose?: () => void } = {}): () => void {
  const vip = opts.vip ?? info.pinkDiamond
  const skin = SKINS[vip ? 'vip' : 'normal']
  const frame = document.createElement('div')
  frame.className = vip ? 'box vip' : 'box'

  const closeBtn = document.createElement('div')
  closeBtn.className = 'close'
  const body = document.createElement('div')
  body.className = 'content'
  for (const cls of ['content1', 'content2', 'content3']) {
    const d = document.createElement('div')
    d.className = cls
    if (cls === 'content2') d.appendChild(content)
    body.appendChild(d)
  }
  frame.append(row('head', skin.head, closeBtn), body, row('foot', skin.foot))

  const hide = show(frame, content)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    hide()
    opts.onClose?.()
  }
  closeBtn.addEventListener('click', close)
  return close
}

/**
 * The original's single-image window ("boxOneImg"): `content` on an optional
 * background image, centered and draggable. Returns a function that removes it.
 */
export function openFrame(content: HTMLElement, background?: string): () => void {
  const frame = document.createElement('div')
  frame.className = 'boxFrame focusPress'
  const bg = document.createElement('div')
  bg.className = 'backgroundImage'
  if (background) bg.style.backgroundImage = `url('${background}')`
  bg.appendChild(content)
  frame.appendChild(bg)
  return show(frame)
}
