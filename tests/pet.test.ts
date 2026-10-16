import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceActivity, currentActivity, examQuestions, resumeActivity, startActivity, stopActivity, submitExam } from '../src/core/pet/activities'
import { goodOf } from '../src/core/pet/catalog'
import { interact } from '../src/core/pet/interaction'
import { countGood, purchase, spend, treatPet, usePetItem } from '../src/core/pet/items'
import type { PetResult } from '../src/core/pet/result'
import type { SaveData } from '../src/shared/save'
import { applyPatch, startSave } from '../src/shared/save-logic'

function pet(): SaveData {
  const save = startSave(null)
  save.havePet = true
  save.petInfo.hunger = 100
  save.petInfo.clean = 100
  save.petInfo.mood = 100
  save.petComputedlInfo.level = 20
  return save
}

function commit<T>(save: SaveData, result: PetResult<T>): T {
  if (result.status === 'failed') assert.fail(`${result.error.code}: ${result.error.message}`)
  applyPatch(save, result.patch)
  return result.data
}

function fails<T>(result: PetResult<T>, code: string): void {
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.error.code, code)
}

test('feeding and cleaning return complete effects without changing the input or using animation callbacks', () => {
  const save = pet()
  const food = goodOf('food', '10013006')
  const before = structuredClone(save)
  const result = usePetItem(save, food.type, food.id)
  assert.deepEqual(save, before)
  commit(save, result)
  assert.equal(countGood(save, food.type, food.id), 1)
  assert.equal(save.petInfo.hunger, Math.min(100 + food.hunger!, save.petComputedlInfo.hungerMax))
  assert.equal(save.petInfo.mood, 120 + (food.mood ?? 0))
  const clean = goodOf('clean', '10021008')
  commit(save, usePetItem(save, clean.type, clean.id))
  assert.equal(countGood(save, clean.type, clean.id), 1)
  assert.equal(save.petInfo.clean, Math.min(100 + clean.clean!, save.petComputedlInfo.cleanMax))
})

test('rapidly repeated use consumes only available inventory and failures never modify state', () => {
  const save = pet()
  commit(save, usePetItem(save, 'toy', 't0002'))
  const after = structuredClone(save)
  fails(usePetItem(save, 'toy', 't0002'), 'INSUFFICIENT_ITEMS')
  fails(usePetItem(save, 'food', 'unknown'), 'INVALID_ITEM')
  fails(usePetItem(save, 'food', '10013006', 2), 'INVALID_QUANTITY')
  assert.deepEqual(save, after)
})

test('paused and dead pets enforce the same item restrictions as the UI', () => {
  const save = pet()
  save.settings.paused = true
  fails(usePetItem(save, 'food', '10013006'), 'PAUSED')
  commit(save, usePetItem(save, 'background', 'b0000001'))
  assert.deepEqual(save.selfGoodUseOption.background, { id: 'b0000001', left: 60 })
  save.petInfo.health = 0
  fails(usePetItem(save, 'food', '10013006'), 'PET_DEAD')
  commit(save, usePetItem(save, 'medicine', '60001'))
  assert.equal(save.petInfo.health, 5)
  assert.equal(countGood(save, 'medicine', '60001'), 1)
})

test('medicine applies correct and incorrect treatment immediately, and stale prescriptions cannot charge twice', () => {
  const save = pet()
  save.petInfo.health = 4
  save.activeOption.ill = '1-'
  save.selfGoodDatas.medicine = ['_10002*1']
  commit(save, usePetItem(save, 'medicine', '10002'))
  assert.equal(save.petInfo.health, 3)
  const before = save.petInfo.yb
  commit(save, treatPet(save, '30004'))
  assert.equal(save.petInfo.health, 5)
  assert.equal(save.activeOption.ill, null)
  assert.ok(save.petInfo.yb < before)
  const after = structuredClone(save)
  fails(treatPet(save, '30004'), 'REQUIREMENTS_NOT_MET')
  assert.deepEqual(save, after)
})

test('quantities cannot remove more than owned or use fractional/negative amounts', () => {
  const save = pet()
  save.selfGoodDatas.nums = ['_yb*2']
  for (const n of [0, -1, 0.5, NaN, Infinity]) fails(usePetItem(save, 'nums', 'yb', n), 'INVALID_QUANTITY')
  fails(usePetItem(save, 'nums', 'yb', 3), 'INSUFFICIENT_ITEMS')
  commit(save, usePetItem(save, 'nums', 'yb', 2))
  assert.equal(save.petInfo.yb, 5002)
  assert.equal(countGood(save, 'nums', 'yb'), 0)
})

test('cart checkout validates every line before changing money or inventory', () => {
  const save = pet()
  const before = structuredClone(save)
  const food = { type: 'food' as const, id: '102010001', quantity: 1 }
  fails(purchase(save, [food, { type: 'food', id: 'unknown', quantity: 1 }]), 'INVALID_ITEM')
  fails(purchase(save, [food, { ...food, quantity: -1 }]), 'INVALID_QUANTITY')
  assert.deepEqual(save, before)
  const receipt = commit(save, purchase(save, [food, food]))
  assert.equal(countGood(save, 'food', food.id), countGood(before, 'food', food.id) + 2)
  assert.equal(save.petInfo.yb, before.petInfo.yb - receipt.total)
  const poor = pet()
  poor.petInfo.yb = 0
  fails(purchase(poor, [food]), 'INSUFFICIENT_FUNDS')
  assert.equal(poor.petInfo.yb, 0)
  fails(spend(poor, -100), 'INVALID_QUANTITY')
})

test('shop membership and level rules are checked on submit', () => {
  const save = pet()
  save.petComputedlInfo.level = 1
  fails(purchase(save, [{ type: 'background', id: 'b0000001', quantity: 1 }]), 'LEVEL_REQUIRED')
  const normal = commit(save, purchase(save, [{ type: 'food', id: '102010001', quantity: 1 }])).total
  save.petInfo.pinkDiamond = true
  const discounted = commit(save, purchase(save, [{ type: 'food', id: '102010001', quantity: 1 }])).total
  assert.equal(discounted, Math.round(normal * 0.8))
})

test('study starts immediately, conflicts with work, and stopping discards rewards and elapsed time', () => {
  const save = pet()
  commit(save, startActivity(save, 'study', 'xx-chinese'))
  assert.equal(currentActivity(save)?.good.id, 'xx-chinese')
  fails(startActivity(save, 'work', 'bz'), 'ACTIVITY_CONFLICT')
  commit(save, advanceActivity(save, 5))
  assert.equal(currentActivity(save)?.elapsed, 5)
  commit(save, stopActivity(save))
  assert.equal(currentActivity(save), null)
  assert.equal(save.saveJsonData.activity, '0')
  assert.equal(save.studyInfo.chinese, 0)
  assert.equal(save.petInfo.yb, 5000)
})

test('a work reward is committed once, even if completion ticks repeat or the app restarts', () => {
  const save = pet()
  const work = goodOf('work', 'bz')
  commit(save, startActivity(save, 'work', work.id))
  const progress = commit(save, advanceActivity(save, work.useTime!))
  assert.equal(progress.completed?.kind, 'work')
  assert.equal(save.petInfo.yb, 5000 + work.yb!)
  commit(save, advanceActivity(save, 100))
  commit(save, resumeActivity(save, Date.now() / 1000 + 99999))
  assert.equal(save.petInfo.yb, 5000 + work.yb!)
})

test('paused or dead pets do not finish activities using offline time', () => {
  for (const condition of ['paused', 'dead'] as const) {
    const save = pet()
    save.nowTimeLine = 1000
    commit(save, startActivity(save, 'study', 'xx-chinese'))
    if (condition === 'paused') save.settings.paused = true
    else save.petInfo.health = 0
    commit(save, resumeActivity(save, 100000))
    assert.equal(save.studyInfo.chinese, 0)
    assert.equal(currentActivity(save)?.elapsed, 0)
  }
})

test('study resumes actual game progress and requires an exam at the school boundary', () => {
  const save = pet()
  save.studyInfo.chinese = 8
  save.nowTimeLine = 1000
  commit(save, startActivity(save, 'study', 'xx-chinese'))
  const progress = commit(save, resumeActivity(save, 1000 + 45 * 60))
  assert.equal(progress.exam, true)
  assert.equal(save.studyInfo.chinese, 9)
  fails(startActivity(save, 'study', 'xx-chinese'), 'EXAM_REQUIRED')
  fails(startActivity(save, 'study', 'dx-chinese'), 'INVALID_ACTIVITY')
})

test('promotion requires three correct answers and cannot be submitted twice', () => {
  const save = pet()
  const questions = examQuestions('xx-chinese').slice(0, 3)
  const answers = questions.map(question => ({ title: question.title, answer: question.answer }))
  fails(submitExam(save, 'xx-chinese', answers), 'REQUIREMENTS_NOT_MET')
  save.studyInfo.chinese = 9
  const wrong = answers.map((answer, i) => i ? answer : { ...answer, answer: 'incorrect' })
  assert.equal(commit(save, submitExam(save, 'xx-chinese', wrong)).passed, false)
  assert.equal(save.studyInfo.chinese, 9)
  assert.equal(commit(save, submitExam(save, 'xx-chinese', answers)).passed, true)
  assert.equal(save.studyInfo.chinese, 10)
  fails(submitExam(save, 'xx-chinese', answers), 'REQUIREMENTS_NOT_MET')
})

test('basic interaction changes mood and achievements without invoking a daily task', () => {
  const save = pet()
  save.petInfo.mood = 995
  const result = commit(save, interact(save, 10, true))
  assert.equal(result.moodDelta, 5)
  assert.equal(result.first, true)
  assert.equal(save.gameSaveDatas.ddw, 1)
  assert.equal(save.petInfo.mood, 1000)
  assert.equal(save.saveJsonData.task, undefined)
})
