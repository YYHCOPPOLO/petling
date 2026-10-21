import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright'

if (!['win32', 'darwin'].includes(process.platform)) throw new Error('桌面回归测试需要 Windows 或 macOS')
const root = resolve('.')
const output = resolve(process.env.AGENT_PET_TEST_OUTPUT || '.verification/desktop')
const data = resolve(output, `data-${Date.now()}`)
mkdirSync(data, { recursive: true })
const run = promisify(execFile)
const tracked = new Map()
const checks = []
const errors = []
const resourceErrors = []
const logs = []
let app
let page
let rootPid

async function processes() {
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    return JSON.parse(stdout)
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,comm='])
  return stdout.trim().split('\n').map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return { ProcessId: Number(match[1]), ParentProcessId: Number(match[2]), Name: match[3] }
  })
}

async function track() {
  if (!rootPid) return
  const list = await processes()
  const ids = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const entry of list) if (ids.has(entry.ParentProcessId) && !ids.has(entry.ProcessId)) { ids.add(entry.ProcessId); changed = true }
  }
  for (const entry of list) if (ids.has(entry.ProcessId)) tracked.set(entry.ProcessId, entry)
}

async function cleanup() {
  await track()
  if (app) { try { await app.close() } catch { /* The quit-flow test already closed it. */ } }
  // Snapshot descendants before shutdown, so even an orphaned native helper is owned.
  const live = await processes()
  const remaining = live.filter(entry => {
    const owned = tracked.get(entry.ProcessId)
    return owned && (!owned.CreationDate || owned.CreationDate === entry.CreationDate)
  })
  for (const entry of remaining.reverse()) {
    try { process.kill(entry.ProcessId) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const after = await processes()
  const leftovers = after.filter(entry => {
    const owned = tracked.get(entry.ProcessId)
    return owned && (!owned.CreationDate || owned.CreationDate === entry.CreationDate)
  })
  writeFileSync(resolve(output, 'process-cleanup.json'), JSON.stringify({ created: [...tracked.values()], remaining: leftovers }, null, 2))
  assert.deepEqual(leftovers, [], '测试创建的 Electron / 原生辅助进程必须全部退出')
}

async function check(name, action) {
  await action()
  await track()
  checks.push(name)
  console.log(`通过：${name}`)
}

async function capture(name) {
  await delay(400)
  await page.screenshot({ path: resolve(output, `${name}.png`), omitBackground: true })
}

// Test the actual DOM event handlers, with deterministic menu timing on a click-through overlay.
async function menu(label) {
  await page.evaluate(label => {
    document.querySelector('#pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
    const item = [...document.querySelectorAll('.menu,.menuC')].find(item => item.textContent.trim() === label)
    if (!item) throw new Error(`菜单中没有 ${label}`)
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, label)
}

async function action(label) {
  await page.evaluate(label => {
    const item = [...document.querySelectorAll('.childrenMenuItem')].find(item => item.textContent.trim() === label)
    if (!item) throw new Error(`动作栏中没有 ${label}`)
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, label)
}

async function loaded(selector) {
  await page.waitForFunction(selector => {
    const element = document.querySelector(`${selector} ruffle-player`)
    return element && element.ruffle().metadata !== null
  }, selector, { timeout: 35000 })
}

let chatRequest
let chatReply = '你好，我是桌面小企鹅。'
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'desktop-test-model' }] })); return }
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    chatRequest = JSON.parse(body)
    response.end(JSON.stringify({ choices: [{ message: { content: chatReply } }] }))
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

async function launchApplication() {
  const environment = { ...process.env, AGENT_PET_TEST_DATA: data }
  delete environment.ELECTRON_RUN_AS_NODE
  const packaged = process.env.AGENT_PET_TEST_EXECUTABLE
  app = await electron.launch({ args: packaged ? [] : ['.'], executablePath: packaged || undefined, cwd: root, env: environment, timeout: 35000 })
  rootPid = app.process().pid
  app.process().stdout?.on('data', value => logs.push(value.toString()))
  app.process().stderr?.on('data', value => logs.push(value.toString()))
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') logs.push(message.text()) })
  page.on('response', response => {
    if (response.status() < 400) return
    logs.push(`${response.status()} ${response.url()}`)
    if (response.url().startsWith('app://bundle/pet/')) resourceErrors.push(response.url())
  })
  page.on('requestfailed', request => logs.push(`请求失败：${request.url()} ${request.failure()?.errorText}`))
  await track()
}

try {
  await launchApplication()
  await page.waitForFunction(() => Boolean(window.ChooseAPI), undefined, { timeout: 35000 })

  await check('透明桌宠、沙箱和隔离测试存档', async () => {
    const native = await app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const preferences = win.webContents.getLastWebPreferences()
      return { path: app.getPath('userData'), top: win.isAlwaysOnTop(), preferences }
    })
    assert.equal(resolve(native.path), data)
    assert.equal(native.top, true)
    assert.equal(native.preferences.sandbox, true)
    assert.equal(native.preferences.contextIsolation, true)
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
    await loaded('.adopt')
    await capture('01-adoption')
  })

  await check('选蛋领养和 SWF 宠物动画', async () => {
    await page.evaluate(() => window.ChooseAPI.ChooseSex(0))
    await page.locator('#pet').waitFor({ state: 'visible' })
    await loaded('#pet')
    await page.evaluate(() => window.__qqpetFlush())
    const saved = JSON.parse(readFileSync(resolve(data, 'save.json'), 'utf8'))
    assert.equal(saved.havePet, true)
    assert.equal(saved.petInfo.sex, 'GG')
    await capture('02-pet')
  })

  await check('商城购买、购物车和背包使用', async () => {
    await menu('打开商城')
    await page.locator('.ui-shop').waitFor({ state: 'visible' })
    const before = await page.evaluate(() => window.qqpet.load())
    await page.locator('.rG_cart:not(.disablePay)').first().click()
    await page.locator('.shoppingCart').click()
    assert.equal(await page.locator('.cg_total').textContent(), '1')
    await capture('03-shop-cart')
    await page.locator('.qrzf').click()
    await page.evaluate(() => window.__qqpetFlush())
    const after = await page.evaluate(() => window.qqpet.load())
    assert.ok(after.petInfo.yb < before.petInfo.yb)
    assert.notDeepEqual(after.selfGoodDatas, before.selfGoodDatas)
    await page.locator('.ui-shop .selfGoodUse').first().click()
    // Business effects are committed immediately, before the SWF animation starts.
    await page.evaluate(() => window.__qqpetFlush())
    const used = await page.evaluate(() => window.qqpet.load())
    assert.notDeepEqual(used.selfGoodDatas, after.selfGoodDatas)
    await page.locator('.ui-shop .close').click()
  })

  await check('主进程命令去重和养成写入隔离', async () => {
    const result = await page.evaluate(async () => {
      const snapshot = await window.qqpet.snapshot()
      const request = { epoch: snapshot.epoch, requestId: `${Date.now()}:${crypto.randomUUID()}`, name: 'pet.interact', input: { face: true } }
      const first = await window.qqpet.command(request)
      const second = await window.qqpet.command(request)
      let rejected = false
      try { await window.qqpet.save({ petInfo: { yb: 999999 } }) } catch { rejected = true }
      const after = await window.qqpet.load()
      return { first: first.result.status, replayed: second.replayed, rejected, interactions: after.gameSaveDatas.ddw - snapshot.save.gameSaveDatas.ddw, balance: after.petInfo.yb === snapshot.save.petInfo.yb }
    })
    assert.deepEqual(result, { first: 'succeeded', replayed: true, rejected: true, interactions: 1, balance: true })
  })

  await check('基础功能入口、资料与已归档扩展隔离', async () => {
    await menu('宠物资料')
    await page.locator('.ui-petinfo').waitFor({ state: 'visible' })
    await capture('04-profile')
    await page.locator('.box .close').last().click()
    const labels = await page.locator('.childrenMenuItem').allTextContents()
    for (const label of ['食物', '清洁', '吃药', '玩具', '打工', '学习', '看病', '商城背包', '聊天', '设置']) assert.ok(labels.some(value => value.trim() === label), label)
    for (const label of ['旅游', '任务', '签到', '邮箱', '池塘', '农场', '游戏', '密室', '社区']) assert.ok(!labels.some(value => value.trim() === label), label)
    const removedBridges = await page.evaluate(() => ['openGame', 'onGamePlayed', 'onClipboard', 'onFront', 'weather', 'calendar'].filter(name => name in window.qqpet))
    assert.deepEqual(removedBridges, [])
    const saved = await page.evaluate(() => window.qqpet.load())
    for (const key of ['email', 'task', 'signin', 'fishs', 'farm']) assert.equal(saved.saveJsonData[key], undefined)
  })

  await check('学习立即启动、活动冲突与停止', async () => {
    await action('学习')
    await page.locator('.goodItemIcon').first().click({ force: true })
    await page.evaluate(() => window.__qqpetFlush())
    assert.equal((await page.evaluate(() => window.qqpet.load())).activeOption.study, 'xx-chinese')
    await action('打工')
    await page.locator('.goodItemIcon').first().click({ force: true })
    await page.evaluate(() => window.__qqpetFlush())
    const conflicting = await page.evaluate(() => window.qqpet.load())
    assert.equal(conflicting.activeOption.study, 'xx-chinese')
    assert.equal(conflicting.activeOption.work, null)
    await page.locator('.goodClose').click({ force: true })
    await menu('宠物状态')
    await capture('05-study-status')
    await page.locator('.stopDoActive').click({ force: true })
    await page.evaluate(() => window.__qqpetFlush())
    const stopped = await page.evaluate(() => window.qqpet.load())
    assert.equal(stopped.activeOption.study, null)
    assert.equal(stopped.saveJsonData.activity, '0')
    await page.locator('.ui-state .close').click({ force: true })
  })

  await check('离线基础聊天不会执行模型动作词或作弊口令', async () => {
    await menu('和我聊天')
    await page.locator('.chatInput').fill('元宝+100000')
    const before = await page.evaluate(() => window.qqpet.load())
    await page.locator('.chatSend').click()
    await page.locator('.chatLine.assistant').waitFor({ state: 'visible' })
    await page.evaluate(() => window.__qqpetFlush())
    const after = await page.evaluate(() => window.qqpet.load())
    assert.equal(after.petInfo.yb, before.petInfo.yb)
    assert.equal(after.activeOption.work, null)
    await capture('06-chat')
    await page.locator('.box .close').last().click()
  })

  await check('AI 聊天回复中的动作词不会修改背包', async () => {
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1'
    await menu('系统设置')
    await page.locator('.lm_once').filter({ hasText: /^AI$/ }).click()
    for (const [index, value] of [[0, endpoint], [1, 'desktop-test-key'], [2, 'desktop-test-model']]) {
      await page.locator('.textInput').nth(index).fill(value)
      await page.locator('.textInput').nth(index).dispatchEvent('change')
    }
    await page.locator('.childrens').filter({ hasText: '测试并启用' }).locator('.butsButs_submit').click()
    await page.waitForFunction(() => document.querySelector('.ui-setup').textContent.includes('测试通过'))
    await page.locator('.ui-setup .close').click()
    await menu('和我聊天')
    await page.evaluate(() => window.__qqpetFlush())
    const before = await page.evaluate(() => window.qqpet.load())
    chatReply = 'FEED 已经吃完啦'
    await page.locator('.chatInput').fill('想和你聊聊天')
    await page.locator('.chatSend').click()
    await page.waitForFunction(() => [...document.querySelectorAll('.chatLine.assistant')].at(-1)?.textContent === 'FEED 已经吃完啦')
    await page.evaluate(() => window.__qqpetFlush())
    const after = await page.evaluate(() => window.qqpet.load())
    assert.deepEqual(after.selfGoodDatas, before.selfGoodDatas)
    assert.deepEqual(after.activeOption, before.activeOption)
    chatReply = '你好，我是桌面小企鹅。'
    await page.locator('.box .close').last().click()
    await menu('系统设置')
    await page.locator('.lm_once').filter({ hasText: /^AI$/ }).click()
    await page.locator('.childrens').filter({ hasText: '关闭 AI' }).locator('.butsButs_submit').click()
    await page.locator('.ui-setup .close').click()
  })

  await check('AI 兼容接口和原生存档导出', async () => {
    const endpoint = `http://127.0.0.1:${server.address().port}/v1`
    const result = await page.evaluate(async endpoint => {
      const config = { url: endpoint, key: 'desktop-test-key', model: 'desktop-test-model' }
      return { models: await window.qqpet.aiModels(config), reply: await window.qqpet.aiChat(config, [{ role: 'user', content: '你好' }]) }
    }, endpoint)
    assert.deepEqual(result.models, ['desktop-test-model'])
    assert.equal(result.reply, '你好，我是桌面小企鹅。')
    assert.equal(chatRequest.model, 'desktop-test-model')
    const exported = resolve(output, 'exported-save.json')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exported)
    await page.evaluate(() => window.__qqpetFlush())
    assert.equal(await page.evaluate(() => window.qqpet.exportSave()), true)
    const savedExport = JSON.parse(readFileSync(exported, 'utf8'))
    assert.equal(savedExport.havePet, true)
    assert.equal(savedExport.settings.aiKey, '')
    assert.equal((await page.evaluate(() => window.qqpet.load())).settings.aiKey, 'desktop-test-key')
    await menu('系统设置')
    await page.locator('.ui-setup').waitFor({ state: 'visible' })
    await page.locator('.lm_once').filter({ hasText: /^关于$/ }).click()
    assert.ok((await page.locator('.ui-setup').textContent()).includes('AgentPet'))
    const tabs = await page.locator('.lm_once').allTextContents()
    assert.deepEqual(tabs.map(label => label.trim()), ['全局设置', '存档', 'AI', '关于'])
    await capture('07-settings')
  })

  await check('退出前写入尚未提交的昵称修改', async () => {
    await page.locator('.ui-setup .close').click()
    await menu('宠物资料')
    await page.locator('.petName input').fill('基础版回归企鹅')
    const closing = app.waitForEvent('close')
    await page.evaluate(() => {
      document.querySelector('.petName .but').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.qqpet.quit()
    })
    await closing
    const after = JSON.parse(readFileSync(resolve(data, 'save.json'), 'utf8'))
    assert.equal(after.petInfo.name, '基础版回归企鹅')
  })

  await check('重启恢复课程只结算一次，旧扩展数据保持休眠', async () => {
    const fixture = JSON.parse(readFileSync(resolve(data, 'save.json'), 'utf8'))
    fixture.petInfo.growth = 200
    fixture.activeOption.study = 'xx-chinese'
    fixture.activeOption.trip = '上海'
    fixture.saveJsonData.activity = '10'
    fixture.saveJsonData.farm = '{"wealth":"42"}'
    fixture.nowTimeLine = Math.floor(Date.now() / 1000) - 45 * 60
    const intel = fixture.petInfo.intel
    writeFileSync(resolve(data, 'save.json'), JSON.stringify(fixture))
    await launchApplication()
    await loaded('#pet')
    await page.evaluate(() => window.__qqpetFlush())
    const resumed = await page.evaluate(() => window.qqpet.load())
    assert.equal(resumed.studyInfo.chinese, 1)
    assert.equal(resumed.activeOption.study, null)
    assert.equal(resumed.activeOption.trip, null)
    assert.equal(resumed.saveJsonData.farm, '{"wealth":"42"}')
    assert.equal(JSON.parse(resumed.saveJsonData.legacyTrip).destination, '上海')
    assert.ok(resumed.petInfo.intel > intel)
    await page.reload()
    await loaded('#pet')
    await page.evaluate(() => window.__qqpetFlush())
    const reloaded = await page.evaluate(() => window.qqpet.load())
    assert.equal(reloaded.studyInfo.chinese, 1)
    assert.equal(reloaded.petInfo.intel, resumed.petInfo.intel)
  })

  await check('动画加载失败仍提交喂食结果', async () => {
    await page.evaluate(() => {
      window.__testRestorePlayers = []
      window.__testSwfErrors = []
      window.__testSwfErrorListener = event => window.__testSwfErrors.push(event.detail.url)
      addEventListener('qqpet-swf-error', window.__testSwfErrorListener)
      for (const player of document.querySelectorAll('#pet ruffle-player')) {
        const ruffle = player.ruffle
        const patched = new WeakSet()
        player.ruffle = function () {
          const api = ruffle.call(player)
          if (!patched.has(api)) {
            patched.add(api)
            const load = api.load
            api.load = function (options) {
              if (/\/Eat\d*\.swf$/.test(options.url)) return Promise.reject(new Error('Expected animation failure for desktop regression'))
              return load.call(api, options)
            }
            window.__testRestorePlayers.push(() => { api.load = load })
          }
          return api
        }
        window.__testRestorePlayers.push(() => { player.ruffle = ruffle })
      }
    })
    await action('食物')
    const before = await page.evaluate(() => window.qqpet.load())
    await page.locator('.goodItemIcon').first().click({ force: true })
    await page.evaluate(() => window.__qqpetFlush())
    const after = await page.evaluate(() => window.qqpet.load())
    assert.notDeepEqual(after.selfGoodDatas.food, before.selfGoodDatas.food)
    await page.waitForFunction(() => window.__testSwfErrors.some(url => /\/Eat\d*\.swf$/.test(url)), undefined, { timeout: 15000 })
    await page.evaluate(() => {
      for (const restore of window.__testRestorePlayers) restore()
      removeEventListener('qqpet-swf-error', window.__testSwfErrorListener)
      delete window.__testRestorePlayers
      delete window.__testSwfErrors
      delete window.__testSwfErrorListener
    })
    await page.locator('.goodClose').click({ force: true })
  })

  let pausedBalance
  await check('打工、暂停成长和隐藏设置立即保存', async () => {
    await menu('打工')
    await page.locator('.goodItemIcon').first().click({ force: true })
    await menu('停止成长')
    await menu('隐藏宠物')
    await page.evaluate(() => window.__qqpetFlush())
    const saved = await page.evaluate(() => window.qqpet.load())
    assert.equal(saved.activeOption.work, 'bz')
    assert.equal(saved.settings.paused, true)
    assert.equal(saved.settings.hidden, true)
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('petHidden')), true)
    pausedBalance = saved.petInfo.yb
    await app.close()
  })

  await check('暂停的打工跨重启不结算奖励，恢复后可停止', async () => {
    const fixture = JSON.parse(readFileSync(resolve(data, 'save.json'), 'utf8'))
    fixture.nowTimeLine -= 2 * 60 * 60
    writeFileSync(resolve(data, 'save.json'), JSON.stringify(fixture))
    await launchApplication()
    await loaded('#pet')
    await page.evaluate(() => window.__qqpetFlush())
    const saved = await page.evaluate(() => window.qqpet.load())
    assert.equal(saved.petInfo.yb, pausedBalance)
    assert.equal(saved.activeOption.work, 'bz')
    assert.equal(saved.settings.hidden, true)
    await menu('显示宠物')
    await menu('开始成长')
    await menu('宠物状态')
    await page.locator('.stopDoActive').click({ force: true })
    await page.evaluate(() => window.__qqpetFlush())
    const stopped = await page.evaluate(() => window.qqpet.load())
    assert.equal(stopped.activeOption.work, null)
    assert.equal(stopped.petInfo.yb, pausedBalance)
    assert.equal(stopped.settings.paused, false)
    assert.equal(stopped.settings.hidden, false)
    await capture('08-resumed-status')
  })

  assert.deepEqual(errors, [], '渲染进程不能发生未处理异常')
  assert.deepEqual(resourceErrors, [], '本地美术和 Flash 子资源必须加载成功')
} catch (error) {
  if (page && !page.isClosed()) await capture('failure').catch(() => {})
  throw error
} finally {
  await new Promise(resolve => server.close(resolve))
  await cleanup()
  writeFileSync(resolve(output, 'electron.log'), logs.join('\n'))
  const report = JSON.stringify({ checks, rendererErrors: errors, resourceErrors, data, packaged: Boolean(process.env.AGENT_PET_TEST_EXECUTABLE) }, null, 2)
  writeFileSync(resolve(output, 'report.json'), report)
  writeFileSync(resolve(output, process.env.AGENT_PET_TEST_EXECUTABLE ? 'report-packaged.json' : 'report-source.json'), report)
}
