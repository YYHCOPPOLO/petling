import { describe, type Good, type GoodType } from '../../core/pet/catalog'
import { toolbarScaleFor } from '../../shared/layout'
import { listGoods, onGoodsChange, pageOf, type Page } from '../pet/goods'
import { doctor, useItem } from '../pet/items'
import { describeStudy, describeWork, study, studyGoods, work, workGoods } from '../pet/jobs'
import { info, onInfoChange, petSize, save } from '../pet/store'
import './css/control.css'
import { button, div, img } from './dom'
import { openChat } from './chat'
import { openPetInfo } from './petinfo'
import { progress } from './progress'
import { openSetup } from './setup'
import { openShop } from './shop'
import { setBubbleLift } from './talk'

const ICONS = 'pet/control/icons/'
const BAR_HEIGHT = 180
/** The goods panel, the bar's widest part. */
const BAR_WIDTH = 314
const EDGE = 10
/** Where the penguin's head and feet sit in the pet box; the swf leaves the rest transparent. */
const HEAD = 0.4
const FEET = 0.95
const HIDE_MS = 1500
const PAGE = 4

type Stat = 'hunger' | 'clean' | 'health' | 'mood'

/** A list of goods to pick from, 4 per page. */
interface Panel {
  icon: string
  list: (page: number) => Page
  lines: (g: Good) => string[]
  /** Returns true when the panel should close. */
  use: (g: Good) => boolean | Promise<boolean>
  /** Everyday panels: the inventory type shown, with the bar of the stat it restores and a shop link. */
  type?: GoodType
  stat?: Stat
}

interface Entry {
  name: string
  icon: string
  run: () => void
}

const activeIcon = (n: number): string => `${ICONS}active/${n}.svg`

const inventory = (type: GoodType, icon: number, stat: Stat) => (): void =>
  openPanel({
    icon: activeIcon(icon),
    list: (page) => listGoods(type, page, PAGE),
    lines: (g) => [...describe(g), `数量：${g.num}`],
    use: (g) => {
      useItem(g)
      return false
    },
    type,
    stat,
  })

const PANELS = {
  food: inventory('food', 18, 'hunger'),
  clean: inventory('clean', 20, 'clean'),
  medicine: inventory('medicine', 22, 'health'),
  toy: inventory('toy', 28, 'mood'),
}

export function openWork(): void {
  openPanel({ icon: activeIcon(26), list: page => pageOf(workGoods(), page, PAGE), lines: describeWork, use: work })
}

export function openStudy(): void {
  openPanel({ icon: activeIcon(24), list: page => pageOf(studyGoods(), page, PAGE), lines: describeStudy, use: study })
}

/** A menu group opens its children on hover, or runs `run` on click. */
const MENU: { name: string; icon: string; children?: Entry[]; run?: () => void }[] = [
  {
    name: '日常',
    icon: 'richang.png',
    children: [
      { name: '食物', icon: 'weishi.png', run: PANELS.food },
      { name: '清洁', icon: 'qingjie.png', run: PANELS.clean },
      { name: '吃药', icon: 'zhibing.png', run: PANELS.medicine },
      { name: '玩具', icon: 'wanshua.png', run: PANELS.toy },
    ],
  },
  {
    name: '交互',
    icon: 'chongwu.png',
    children: [
      {
        name: '打工',
        icon: 'dagong.png',
        run: openWork,
      },
      {
        name: '学习',
        icon: 'xuexi.png',
        run: openStudy,
      },
      { name: '看病', icon: 'zhibing.png', run: doctor },
    ],
  },
  {
    name: '工具',
    icon: 'renwu.png',
    children: [
      { name: '商城背包', icon: 'weishi.png', run: openShop },
      { name: '聊天', icon: 'haoyou.png', run: openChat },
      { name: '设置', icon: 'guanli.png', run: openSetup },
    ],
  },
  { name: '档案', icon: 'dangan.png', run: openPetInfo },
]

const control = div('control')
control.dataset.hit = ''
document.body.appendChild(div('ui-control', control))

let shown = false
let hideTimer = 0
let introTimer = 0
let open: (Panel & { page: number }) | null = null

/**
 * Centered under the pet's feet; when there is no room below, mirrored above its head. Kept on screen.
 */
function place(): void {
  const size = petSize()
  const scale = toolbarScaleFor((innerWidth - 2 * EDGE) / BAR_WIDTH)
  const height = BAR_HEIGHT * scale
  const half = (BAR_WIDTH * scale) / 2 + EDGE
  const feet = info.lastY + size * FEET
  const onTop = feet > innerHeight - EDGE - height
  control.classList.toggle('up', onTop)
  control.style.left = `${Math.min(Math.max(info.lastX + size / 2, half), innerWidth - half)}px`
  control.style.top = `${onTop ? info.lastY + size * HEAD : feet}px`
  control.style.transform = `scale(${scale})`
  setBubbleLift(shown && onTop ? Math.max(height - size * HEAD, 0) : 0)
}

/** Run a toolbar action. */
function pick(run: () => void): void {
  run()
}

const icons: HTMLElement[] = []
const menus = div(
  'menus fcc',
  ...MENU.map((g) => {
    const icon = div('menuItemIconBox', img('menuItemIcon', ICONS + g.icon))
    icons.push(icon)
    const item = div(
      'menuItem fcc focusPress',
      div('menuTip', g.name),
      icon,
      ...(g.children
        ? [div('childrenMenu', ...g.children.map((c) => button('childrenMenuItem fc', () => pick(c.run), img('childrenMenuItemIcon', ICONS + c.icon), ` ${c.name}`)))]
        : []),
    )
    if (g.run) item.addEventListener('click', g.run)
    item.addEventListener('mouseenter', () => {
      clearTimeout(introTimer)
      highlight(-1)
      clearTimeout(hideTimer)
    })
    item.addEventListener('mouseleave', scheduleHide)
    return item
  }),
)
control.appendChild(menus)

const highlight = (n: number): void => icons.forEach((icon, i) => icon.classList.toggle('hoverMenuItemIcon', i === n))

/** Lights the menu icons up one after another when the bar appears. */
function intro(n = 0): void {
  highlight(n)
  if (n < icons.length) introTimer = window.setTimeout(() => intro(n + 1), 150)
}

/** Pressing the pet shows the bar. */
export function showControl(): void {
  if (save.isBury) return
  clearTimeout(hideTimer)
  if (shown) return
  shown = true
  control.classList.add('showControl')
  place()
  intro()
}

/** Shows the bar with an everyday goods panel open. */
export function openGoods(type: keyof typeof PANELS): void {
  showControl()
  PANELS[type]()
}

/** The bar hides 1.5 seconds after the pointer leaves it, unless an inventory panel is open. */
export function scheduleHide(): void {
  clearTimeout(hideTimer)
  if (open) return
  hideTimer = window.setTimeout(hide, HIDE_MS)
}

function hide(): void {
  shown = false
  control.classList.remove('showControl')
  place()
}

let list: HTMLElement | null = null

function openPanel(p: Panel, page = 1): void {
  showControl()
  open = { ...p, page }
  menus.style.display = 'none'
  const { list: goods, totalPage } = p.list(page)
  const turn = (d: number) => (): void => {
    if (page + d >= 1 && page + d <= totalPage) openPanel(p, page + d)
  }
  const items = goods.map((g: Good) =>
    div(
      'goodItem',
      div(
        'goodItemIconBox fcc',
        div('goodInfo', div('goodName', g.name), ...p.lines(g).map((l) => div('goodDatas', l))),
        Object.assign(img('goodItemIcon', g.url), {
          onclick: async () => {
            if (await p.use(g)) closePanel()
          },
        }),
      ),
    ),
  )
  const next = div(
    'goodList focusPress',
    img('goodTypeIcon', p.icon),
    ...(p.stat ? [button('toShoppingMall', openShop, '去购物')] : []),
    button('goodClose', closePanel),
    div(
      'goodListMain fcc',
      button('toLeft', turn(-1)),
      div(
        'goods f1 fC h100',
        div('fc f1', ...(items.length ? items : [div('goodsNone tc w100', ' 空空如也~~ ')])),
        ...(p.stat ? [div('progress', progress(info[p.stat], save.petComputedlInfo[`${p.stat}Max`]))] : []),
      ),
      button('toRight', turn(1)),
    ),
  )
  if (list) list.replaceWith(next)
  else control.appendChild(next)
  list = next
}

function closePanel(): void {
  open = null
  list?.remove()
  list = null
  menus.style.display = ''
  scheduleHide()
}

onInfoChange((key) => {
  if (key === 'lastX' || key === 'lastY' || key === 'growth') place()
  if (open && key === open.stat) openPanel(open, open.page)
})
onGoodsChange((type) => {
  if (open?.type === type) openPanel(open, Math.min(open.page, Math.max(open.list(1).totalPage, 1)))
})
