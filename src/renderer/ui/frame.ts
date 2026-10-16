import './css/frame.css'
import { div, img } from './dom'

/**
 * The original's 9-slice image frame ("imgBjBox") behind `content`; `src(n)`
 * is slice n of 1..9 in reading order, `sides` are the edge column widths.
 */
export function frame(content: HTMLElement, src: (n: number) => string, sides: [number, number]): HTMLElement {
  const slice = (cls: string, n: number): HTMLElement => div(`${cls} f1 slice`, img('', src(n)))
  const row = (cls: string, n: number): HTMLElement => div(`${cls} fcc`, img(`${cls}1`, src(n)), slice(`${cls}2`, n + 1), img(`${cls}3`, src(n + 2)))
  const left = img('content1', src(4))
  const right = img('content3', src(6))
  left.style.width = `${sides[0]}px`
  right.style.width = `${sides[1]}px`
  const middle = div('content fcc f1', left, slice('content2', 5), right)
  return div('imgBjBoxFrame', div('styleBox fC', row('head', 1), middle, row('foot', 7)), div('slotMain', content))
}
