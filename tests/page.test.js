const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function loadPage(rejectSource = false) {
  const files = new Map([['/user/metronome-probe/old.wav', Buffer.from('stale')]])
  const events = {}
  let definition
  let source
  const audio = {
    stop() { if (events.Stop) events.Stop() },
    set src(value) {
      source = value
      if (rejectSource) events.Error({ errCode: 10003, errMsg: 'local file rejected' })
      else events.Play()
    }
  }
  for (const event of ['Play', 'Pause', 'Stop', 'Ended', 'Error', 'Waiting']) {
    audio[`on${event}`] = callback => { events[event] = callback }
  }
  const nativeFs = {
    mkdir: options => options.success({}),
    readdir: options => options.success({ files: [...files.keys()].map(file => path.basename(file)) }),
    unlink: options => { files.delete(options.filePath); options.success({}) },
    writeFile: options => { files.set(options.filePath, Buffer.from(options.data)); options.success({}) },
    appendFile: options => {
      files.set(options.filePath, Buffer.concat([files.get(options.filePath), Buffer.from(options.data)]))
      options.success({})
    },
    stat: options => options.success({ stats: { size: files.get(options.path).length } })
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.js'), 'utf8'), {
    wx: { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => nativeFs, getBackgroundAudioManager: () => audio },
    Page: page => { definition = page },
    require: () => require('../miniprogram/utils/wav')
  })
  const page = { ...definition, data: { ...definition.data }, setData(update) { Object.assign(this.data, update) } }
  return { page, files, events, getSource: () => source }
}

async function initialize(page) {
  page.onLoad()
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.ready, true)
}

test('page submits its generated local WAV and retains it while hidden, then cleans it', async () => {
  const { page, files, getSource } = loadPage()
  await initialize(page)
  assert.equal(files.size, 0)
  await page.generateAndPlay()
  const source = getSource()
  assert.ok(source.startsWith('/user/metronome-probe/beat-'))
  assert.equal(files.get(source).length, 44 + 60 * 22050 * 2)
  assert.equal(page.data.active, true)
  page.onHide()
  assert.equal(files.size, 1)
  assert.equal(page.data.active, true)
  await page.stopAndClean()
  assert.equal(files.size, 0)
  assert.equal(page.data.filePath, '')
})

test('native local-file rejection stays visible and can be cleaned', async () => {
  const { page, files } = loadPage(true)
  await initialize(page)
  await page.generateAndPlay()
  assert.equal(page.data.active, false)
  assert.ok(page.data.logs.some(entry => entry.text.includes('10003')))
  await page.stopAndClean()
  assert.equal(files.size, 0)
})

test('end in background defers file cleanup until returning to the foreground', async () => {
  const { page, files, events } = loadPage()
  await initialize(page)
  await page.generateAndPlay()
  page.onHide()
  events.Ended()
  assert.equal(files.size, 1)
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 0)
})
