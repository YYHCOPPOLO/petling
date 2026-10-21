import { FACE } from '../pet/data/face'
import { machine } from '../pet/pet'
import { rand } from '../pet/rand'
import { info, mood, save, stage, update } from '../pet/store'
import { command } from '../pet/commands'
import { floatMood } from './float'
import { windowView } from './window-view'

const HOVER_MS = 300

const layer = document.createElement('div')
layer.className = 'face'
const petEl = document.getElementById('pet')!
petEl.appendChild(layer)

async function poke(key: string, s = 1, e = s): Promise<void> {
  layer.replaceChildren()
  const result = await command('pet.interact', { face: true })
  if (result.status === 'failed') return windowView({ msg: result.error.message })
  if (result.data.first) windowView({ title: '逗逗我~~', msg: '恭喜成功开启逗宠成就~~', goods: [{ url: 'pet/achievement/ddw.svg', name: '逗宠成就' }] })
  void floatMood(result.data.moodDelta)
  const dir = stage() === 'Adult' ? `Adult/${mood()}` : stage()
  machine.play({ a: 'faceActive', opt: { url: `pet/Action/${info.sex}/${dir}/interact/${key}${rand(s, e)}.swf`, opt: {} } })
}

/** 0 off, 1 invisible spots, 2 marked spots. */
export function setFaceClick(v: 0 | 1 | 2): void {
  update('settings', { faceClick: v })
  document.body.classList.toggle('faceHint', v === 2)
}
document.body.classList.toggle('faceHint', save.settings.faceClick === 2)

function show(): void {
  if (!save.settings.faceClick) return
  const st = stage()
  const points = st === 'Adult' ? FACE[info.sex].Adult[mood()] : FACE[info.sex][st]
  layer.replaceChildren(
    ...Object.entries(points).map(([key, p]) => {
      const d = document.createElement('div')
      d.className = 'point'
      d.style.left = p.left
      d.style.top = p.top
      d.addEventListener('click', () => poke(key, p.s, p.e ?? p.s))
      return d
    }),
  )
}

// Spots appear after hovering an idle pet without a button held.
let timer = 0
petEl.addEventListener('pointerenter', () => {
  timer = window.setTimeout(() => machine.pose.a === 'normal' && show(), HOVER_MS)
})
for (const ev of ['pointerleave', 'pointerdown'] as const) {
  petEl.addEventListener(ev, (e) => {
    if (layer.contains(e.target as Node)) return
    clearTimeout(timer)
    layer.replaceChildren()
  })
}
