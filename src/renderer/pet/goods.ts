import { lookupGood, type Good, type GoodType } from '../../core/pet/catalog'
import { onSaveChange, save } from './store'

type Listener = (type: GoodType) => void
const listeners: Listener[] = []
export const onGoodsChange = (listener: Listener): void => { listeners.push(listener) }
onSaveChange(patch => {
  const types = new Set([...Object.keys(patch.selfGoodDatas ?? {}), ...Object.keys(patch.selfGoodUseOption ?? {})] as GoodType[])
  for (const type of types) for (const listener of listeners) listener(type)
})

export interface Page { list: Good[]; totalPage: number }
export const pageOf = (all: Good[], page: number, size: number): Page => ({ list: all.slice((page - 1) * size, page * size), totalPage: Math.ceil(all.length / size) })

/** Unknown legacy goods remain in the save and are omitted from this version's panels. */
export function listGoods(type: GoodType, page: number, size: number): Page {
  const goods = save.selfGoodDatas[type].flatMap(entry => {
    if (typeof entry !== 'string') return []
    const [id, count] = entry.slice(1).split('*')
    const good = lookupGood(type, id, Number(count))
    return good && Number.isSafeInteger(good.num) && good.num > 0 ? [good] : []
  })
  return pageOf(goods, page, size)
}
