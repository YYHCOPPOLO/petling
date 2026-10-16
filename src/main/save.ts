import { app } from 'electron'
import { join } from 'node:path'
import type { SavePatch, Sex } from '../shared/save'
import { SaveRepository } from './save-repository'

let repository: SaveRepository | undefined
const store = (): SaveRepository => repository ??= new SaveRepository(join(app.getPath('userData'), 'save.json'),
  process.env.AGENT_PET_TEST_DATA ? [] : [
    join(app.getPath('appData'), 'qqpet', 'save.json'),
    join(app.getPath('appData'), 'QQPet', 'save.json'),
    join(app.getPath('appData'), 'Arctic Penguin', 'config.json'),
  ])

export const loadSave = () => store().load()
export const getSave = () => store().get()
export const patchSave = (patch: SavePatch): void => store().patch(patch)
export const exportSave = (file: string): void => store().export(file)
export const importSave = (file: string): void => store().import(file)
export const resetSave = (sex?: Sex): void => store().reset(sex)
