import { levelOf } from '../../core/pet/level'
import { command } from './commands'
import { PetSwf } from '../swf/pet-swf'
import { floatMood } from '../ui/float'
import { retell, say } from '../ui/talk'
import { DEAD, illOf } from '../../core/pet/illness'
import { TALK, type Line } from './data/talk'
import { IDLE, rephrase } from './ai'
import { dateTalk, festival, greeting } from './calendar'
import { doctor, presentItem } from './items'
import { Machine, type Pose } from './machine'
import { rand } from './rand'
import {
  activity,
  applyEdge,
  busy,
  edgeSide,
  info,
  mood,
  onInfoChange,
  onPetEvent,
  petSize,
  refreshTray,
  save,
  setInfo,
  setTray,
  stage,
} from './store'
import { dayStart } from './vip'

let idleTimer = 0

const petSwf = new PetSwf(document.getElementById('pet')!)

/** Applies the 宠物音效 setting to the players already on screen; every load re-applies it too. */
export const applyPetSound = (): void => petSwf.applySound()

export const machine = new Machine(petSwf, (over, next) => {
  clearTimeout(idleTimer)
  if (next.a === 'normal' || next.a === 'hideleft' || next.a === 'hideright') {
    idleTimer = window.setTimeout(idle, Math.trunc(Math.random() * 40000 + 20000))
  }
  over.e?.()
  next.s?.()
})

/** Answering the pet's small talk cheers it up. */
async function cheer(): Promise<void> {
  const result = await command('pet.interact', { face: false })
  if (result.status === 'succeeded') void floatMood(result.data.moodDelta)
}

/** Official lead cooldown (`operatereffecttime="3600"`). Session-only; a restart may show it once. */
const LEAD_CD = 3600
let lastLead = 0
/** Sickness is serious: the pet brings it up far more often than hunger, with the doctor one tap away. */
const SICK_CD = 600
let lastSick = 0
let walkTick = 0

const peeking = (): boolean => machine.pose.a === 'hideleft' || machine.pose.a === 'hideright'

/** Hungry / dirty / poor, same order as the official lead package. */
function leadOf(): 'hungry' | 'dirty' | 'poor' | null {
  if (info.hunger < 300) return 'hungry'
  if (info.clean < 300) return 'dirty'
  if (info.yb < 200) return 'poor'
  return null
}

/** Adult official pack only shipped poor; hungry/dirty fall back to a speak clip. */
function leadClip(kind: 'hungry' | 'dirty' | 'poor'): string {
  if (kind !== 'poor' && stage() === 'Adult') return 'speak'
  return kind
}

/** A peeking pet only shows the bubble: the sick clip draws the full body and would walk it off the edge. */
function complain(): void {
  lastSick = Date.now() / 1000
  speak({ s: illOf(activity('ill')! + info.health).tolk, b: '带你看病', now: true }, peeking() ? 'speak' : 'sick', { ok: doctor })
}

/** Checked every minute, so a peeking pet (no idle timer) still brings it up. */
function nag(): void {
  if (!info.health || info.health === 5 || busy() || Date.now() / 1000 - lastSick < SICK_CD) return
  if (machine.pose.a === 'normal' || peeking()) complain()
}

/** Plays the official need animation (and the unused `state.eat` / `state.clean` lines). */
function maybeLead(): boolean {
  if (machine.pose.a !== 'normal' || busy() || info.health < 5 || save.settings.paused) return false
  if (Date.now() / 1000 - lastLead < LEAD_CD) return false
  const kind = leadOf()
  if (!kind) return false
  lastLead = Date.now() / 1000
  const talk = kind === 'hungry' ? 'eat' : kind === 'dirty' ? 'clean' : 'poor'
  speak({ c: 'state', s: talk, now: true }, leadClip(kind))
  return true
}

function stopWalk(): void {
  clearInterval(walkTick)
  walkTick = 0
  if (machine.pose.a !== 'walk') return
  // walkstop is a 1-frame clip; the machine treats those as a hold, so it stuck on the same pose.
  machine.play({ a: applyEdge() ?? 'normal' })
}

/** Move only after the walk pose is on screen. play() is async; starting the timer earlier suicides. */
function startWalkMove(speed: number, until: number): void {
  clearInterval(walkTick)
  walkTick = window.setInterval(() => {
    if (machine.pose.a !== 'walk') {
      clearInterval(walkTick)
      walkTick = 0
      return
    }
    const next = info.lastX + speed
    const max = innerWidth - petSize()
    if (Date.now() > until || next <= 0 || next >= max) {
      setInfo('lastX', Math.min(Math.max(next, 0), max))
      stopWalk()
      return
    }
    setInfo('lastX', next)
  }, 1000 / 12)
}

/** In-place walk cycle; we move the box at the official 8 px / 12 fps, scaled to pet size. */
function walk(): boolean {
  if (!save.settings.roam || busy() || info.health < 5) return false
  if (machine.pose.a !== 'normal' || edgeSide()) return false
  const s = petSize()
  const roomL = info.lastX
  const roomR = innerWidth - info.lastX - s
  if (roomL < 48 && roomR < 48) return false
  const dir: 'left' | 'right' = roomL < 80 ? 'right' : roomR < 80 ? 'left' : Math.random() < 0.5 ? 'left' : 'right'
  const speed = 8 * (s / 144) * (dir === 'left' ? -1 : 1)
  machine.play({
    a: 'walk',
    opt: { url: `pet/Action/${info.sex}/${stage()}/walk/walk_${dir}.swf`, opt: {} },
    s: () => startWalkMove(speed, Date.now() + rand(2000, 5000)),
  })
  return true
}

/** After 20-60 s of standing: walk / play / talk, same timer. Walk only if roam is on. */
function idle(): void {
  if (peeking()) return
  if (maybeLead()) return
  if (save.settings.roam) {
    const n = Math.trunc(Math.random() * 3)
    if (n === 0 && walk()) return
    if (n !== 2) return machine.add({ a: 'play' })
  } else if (Math.random() < 0.8) {
    return machine.add({ a: 'play' })
  }
  const date = Math.random() < 0.3 ? dateTalk() : null
  speak(date ? { s: date, ai: IDLE } : { c: 'smallTalk', ai: IDLE }, 'speak', { ok: cheer })
}

function line(c: string, s?: string): Line | null {
  let lines = TALK[c] ?? []
  if (s && !Array.isArray(lines)) lines = lines[s] ?? []
  return Array.isArray(lines) && lines.length ? lines[rand(0, lines.length - 1)] : null
}

interface Say {
  /** Dialog category in TALK, with `s` as sub key; otherwise `s` is the literal text. */
  c?: string
  s?: string
  /** Button label. */
  b?: string
  /** Preempt the current animation instead of queueing. */
  now?: boolean
  /**
   * While AI is on: a prompt to rewrite the line (shown first, then replaced),
   * `IDLE` waits for the model (the stock line is only a hint), `false` keeps the text.
   */
  ai?: string | false
}

/** Shows a bubble, optionally together with an action that it waits for. Do-not-disturb drops only the bubble. */
export function speak(t: Say, action?: string, hooks: { start?: () => void; end?: () => void; ok?: () => void } = {}): void {
  let text = t.s ?? ''
  let button = t.b ?? '好的'
  if (t.c) {
    const l = line(t.c, t.s)
    text = l?.tolk ?? `${t.c}-${t.s}聊天数据丢失，请联系管理员处理`
    button = l?.submitText ?? '好的'
  }
  text = text.replace(/\[host]/g, info.host)
  const onOk = hooks.ok ? [hooks.ok] : []
  const show = (): void => {
    if (!save.settings.quiet) {
      if (t.ai === IDLE) void rephrase(text, t.ai).then((s) => void say(s ?? text, [button], onOk))
      else {
        const said = say(text, [button], onOk)
        if (t.ai !== false) void Promise.all([rephrase(text, t.ai), said]).then(([s]) => s && void retell(text, s))
      }
    }
    hooks.start?.()
  }
  if (!action || (!info.health && action !== 'bury')) return show()
  // Peek is a sliver SWF; speak/play would draw the full body and walk it off the edge.
  if ((action === 'speak' || action === 'play') && (machine.pose.a === 'hideleft' || machine.pose.a === 'hideright')) return show()
  const pose: Pose = { a: action, s: show, e: hooks.end }
  if (t.now) machine.play(pose)
  else machine.add(pose)
}

let reviving = false
export function revive(done?: () => void): void {
  if (reviving) return
  reviving = true
  machine.play({
    a: 'revival',
    e: () => {
      speak({ s: '[host]，再次见到你很高兴~~ ', b: '我也很高兴~' })
      done?.()
      reviving = false
      burying = false
    },
  })
}

let burying = false
export async function bury(done?: () => void): Promise<void> {
  if (burying) return
  burying = true
  const result = await command('pet.bury', {})
  if (result.status === 'failed') { burying = false; return speak({ s: result.error.message, now: true, ai: false }) }
  setTray('bury')
  speak({ c: 'state', s: 'bury' }, 'bury', { start: done })
}

let lastMood = mood()
onInfoChange((key, prev) => {
  if (key === 'growth') {
    const before = levelOf(prev as number).level
    const now = save.petComputedlInfo.level
    if (now === before) return
    const first = (now === 5 && before === 4) || (now === 10 && before === 9)
    speak({ c: first ? `first${now === 5 ? 1 : 2}` : 'levUp', now: true }, first ? 'first' : 'levUp')
  } else if (key === 'health') {
    healthChanged(prev as number)
  } else if (key === 'mood' && mood() !== lastMood) {
    lastMood = mood()
    if (stage() === 'Adult') speak({ c: 'mood', s: lastMood, now: true }, 'speak')
  } else if (key === 'hunger' || key === 'clean' || key === 'yb') {
    maybeLead()
  }
})

function healthChanged(prev: number): void {
  const h = info.health
  if (h === 5) {
    if (prev === 0) revive()
    return setTray('normal')
  }
  if (h === 0) {
    speak({ s: DEAD.tolk, now: true }, 'dying', { start: () => machine.add({ a: 'die' }) })
    return setTray('dead')
  }
  complain()
  setTray('ill')
}

onPetEvent(event => {
  refreshTray()
  if (event.type === 'new-day') daily()
  else if (event.type === 'mood-exhausted') speak({ c: 'state', s: event.kind === 'work' ? 'stopWorkFoMood0' : 'stopStudyFoMood0', now: true }, 'speak')
  else if (event.type === 'timed-expired') speak({ c: 'state', s: event.kind + 'Over', now: true }, 'speak')
  else if (event.type === 'self-care') presentItem({ status: 'succeeded', data: event.receipt }, '[host]，我可以自己' + event.action + '哦！~~使用了：' + event.receipt.good.name)
})

/** Local greetings stay available without a network connection. */
let dailyDay = 0
function daily(): void {
  if (dailyDay === dayStart()) return
  dailyDay = dayStart()
  const line = festival()
  if (line) speak({ s: line }, 'speak')
}

let started = false
function startGrowth(): void {
  if (started) return
  started = true
  void window.qqpet.start().catch((error: unknown) => speak({ s: String(error), ai: false, now: true }))
  setInterval(nag, 60_000)
}

export function startPet(): void {
  refreshTray()
  if (save.isBury) {
    bury()
    setTray('dead')
  } else if (info.health === 0) {
    speak({ s: DEAD.tolk, b: '别走~' })
    machine.play({ a: 'dying', s: () => machine.add({ a: 'die' }) })
    setTray('dead')
  } else {
    if (info.health < 5) setTray('ill')
    const a = info.growth === 0 ? 'first' : 'enter'
    // Half the launches greet by the time of day instead of the original enter lines.
    const g = a === 'enter' && Math.random() < 0.5 ? greeting() : null
    machine.play({ a, s: () => speak(g ? { s: g.tolk, b: g.submitText } : { c: a }) })
    void daily()
  }
  startGrowth()
  machine.start()
}
