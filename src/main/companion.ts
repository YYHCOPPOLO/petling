import { app, net } from 'electron'
import { join } from 'node:path'
import { aiChat } from '../shared/ai'
import { webUrl } from '../shared/validation'
import { getSave } from './save'
import { CompanionHost } from './companion-host'
import { companionStore } from './companion-store'

let host: CompanionHost | undefined
export const companionHost = (): CompanionHost => host ??= new CompanionHost(
  companionStore(join(app.getPath('userData'), 'companion.sqlite'), { address: getSave().petInfo.host }),
  () => { const { petInfo, settings } = getSave(); return { name: petInfo.name, url: settings.aiUrl, key: settings.aiKey, model: settings.aiModel } },
  (config, messages, signal) => { webUrl(config.url); return aiChat(net.fetch, config, messages, signal, 2048) },
)
export const closeCompanion = async (): Promise<void> => { await host?.close() }
