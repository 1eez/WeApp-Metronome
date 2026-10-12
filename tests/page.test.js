const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function loadPage(rejectSource = false, saved = {}) {
  const files = new Map([['/user/metronome-probe/old.wav', Buffer.from('stale')]])
  const directories = new Set(['/user', '/user/metronome-probe'])
  const events = {}
  let systemTheme = 'light'
  let themeCallback
  let navigation
  let background
  let definition
  let source
  let clipboard
  let nextFd = 0
  const descriptors = new Map()
  let stored = saved
  let confirm = false
  let stopCount = 0
  let now = 0
  let nextTimer = 0
  const timers = new Map()
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const audio = {
    paused: true,
    currentTime: 0,
    stop() { stopCount++; this.paused = true; if (events.Stop) events.Stop() },
    pause() { this.paused = true; events.Pause() },
    play() { this.paused = false; events.Play() },
    set src(value) {
      source = value
      this.currentTime = 0
      if (rejectSource) events.Error({ errCode: 10003, errMsg: 'local file rejected' })
      else { this.paused = false; events.Play() }
    }
  }
  for (const event of ['Play', 'Pause', 'Stop', 'Ended', 'Error', 'Waiting', 'TimeUpdate', 'Seeking', 'Seeked']) {
    audio[`on${event}`] = callback => { events[event] = callback }
  }
  const nativeFs = {
    readFile: options => {
      try {
        const data = fs.readFileSync(path.join(__dirname, '../miniprogram', options.filePath))
        options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      } catch (error) { options.fail(error) }
    },
    access: options => options.fail({ errMsg: 'not found' }),
    mkdir: options => { directories.add(options.dirPath); options.success({}) },
    readdir: options => options.success({ files: [...new Set([...files.keys(), ...directories].filter(file => file.startsWith(options.dirPath + '/')).map(file => file.slice(options.dirPath.length + 1).split('/')[0]))] }),
    rmdir: options => {
      if ([...files.keys(), ...directories].some(file => file.startsWith(options.dirPath + '/'))) options.fail({ errMsg: 'directory not empty' })
      else { directories.delete(options.dirPath); options.success({}) }
    },
    unlink: options => { files.delete(options.filePath); options.success({}) },
    open: options => {
      const fd = String(++nextFd)
      descriptors.set(fd, options.filePath)
      files.set(options.filePath, Buffer.alloc(0))
      options.success({ fd })
    },
    write: options => {
      const filePath = descriptors.get(options.fd)
      assert.ok(filePath, 'write requires an open descriptor')
      const previous = files.get(filePath)
      const file = Buffer.alloc(Math.max(previous.length, options.position + options.length))
      previous.copy(file)
      Buffer.from(options.data).copy(file, options.position, options.offset, options.offset + options.length)
      files.set(filePath, file)
      options.success({ bytesWritten: options.length })
    },
    close: options => { descriptors.delete(options.fd); options.success({}) },
    stat: options => options.success({ stats: { size: files.get(options.path)?.length || 0, isDirectory: () => !files.has(options.path) } })
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.js'), 'utf8'), {
    Date: TestDate, setInterval: callback => { timers.set(++nextTimer, callback); return nextTimer },
    clearInterval: id => timers.delete(id),
    wx: { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => nativeFs, getBackgroundAudioManager: () => audio,
      getAppBaseInfo: () => ({ theme: systemTheme }), onThemeChange: callback => { themeCallback = callback },
      setNavigationBarColor: options => { navigation = options }, setBackgroundColor: options => { background = options },
      getStorageSync: () => stored, setStorageSync: (key, value) => { stored = value },
      setClipboardData: options => { clipboard = options.data },
      showModal: options => {
        assert.ok(options.confirmText.length <= 4)
        assert.ok(options.cancelText.length <= 4)
        options.success({ confirm })
      }, showToast: () => {} },
    Page: page => { definition = page },
    require: name => require(path.join(__dirname, '../miniprogram/pages/index', name))
  })
  function createPage() {
    return { ...definition, data: { ...definition.data }, setData(update) { Object.assign(this.data, update) } }
  }
  const page = createPage()
  return { page, files, directories, events, audio, createPage, nativeFs, descriptors, getClipboard: () => clipboard, getSource: () => source,
    setSystemTheme: theme => { systemTheme = theme; if (themeCallback) themeCallback({ theme }) },
    getNavigation: () => navigation, getBackground: () => background,
    timers, tick: milliseconds => { now += milliseconds; for (const callback of timers.values()) callback() },
    getSaved: () => stored, setConfirm: value => { confirm = value }, getStopCount: () => stopCount }
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
  await page.changeSetting('seconds', 60)
  await page.generateAndPlay()
  const source = getSource()
  assert.ok(source.startsWith('/user/metronome-probe/beat-'))
  assert.equal(files.get(source).length, 44 + 60 * 22050 * 2)
  assert.equal(page.data.state, 'playing')
  page.onHide()
  assert.equal(files.size, 1)
  assert.equal(page.data.state, 'playing')
  await page.stopAndClean()
  assert.equal(files.size, 0)
  assert.equal(page.data.filePath, '')
})

test('native local-file rejection stays visible and can be cleaned', async () => {
  const { page, files } = loadPage(true)
  await initialize(page)
  await page.changeSetting('seconds', 60)
  await page.generateAndPlay()
  assert.equal(page.data.state, 'error')
  assert.ok(page.data.logs.some(entry => entry.text.includes('10003')))
  await page.stopAndClean()
  assert.equal(files.size, 0)
})

test('end in background immediately attempts file cleanup', async () => {
  const { page, files, events } = loadPage()
  await initialize(page)
  await page.changeSetting('seconds', 60)
  await page.generateAndPlay()
  page.onHide()
  events.Ended()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 0)
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 0)
})


test('pause and continue retain the same file without regenerating', async () => {
  const { page, files, getSource } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.primaryAction()
  const source = getSource()
  const file = files.get(source)
  await page.primaryAction()
  assert.equal(page.data.state, 'paused')
  await page.primaryAction()
  assert.equal(page.data.state, 'playing')
  assert.equal(files.get(source), file)
})

test('editing during playback requires confirmation and cleans before changing', async () => {
  const { page, files, setConfirm, getSaved } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.generateAndPlay()
  await page.changeSetting('bpm', 137)
  assert.equal(page.data.bpm, 120)
  assert.equal(page.data.state, 'playing')
  assert.equal(files.size, 1)
  setConfirm(true)
  await page.changeSetting('bpm', 137)
  assert.equal(page.data.bpm, 137)
  assert.equal(page.data.state, 'idle')
  assert.equal(files.size, 0)
  assert.equal(getSaved().bpm, 137)
  await page.generateAndPlay()
  assert.ok(page.data.logs.some(entry => entry.text.includes('137 BPM')))
})

test('recreated page and foreground return preserve playing and paused sessions', async () => {
  const { page, createPage, files, audio, getStopCount } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.generateAndPlay()
  const stops = getStopCount()
  page.onUnload()
  const next = createPage()
  await initialize(next)
  assert.equal(next.data.state, 'playing')
  assert.equal(files.size, 1)
  assert.equal(getStopCount(), stops)
  next.onHide()
  audio.pause()
  next.onShow()
  assert.equal(next.data.state, 'paused')
})

test('invalid saved settings fall back to defaults and invalid BPM is rejected', async () => {
  const { page, getSaved } = loadPage(false, { bpm: 999, beats: 6, seconds: -1, tone: 'unknown', accent: 'yes' })
  await initialize(page)
  assert.equal(page.data.bpm, 120)
  assert.equal(page.data.beats, 4)
  assert.equal(page.data.seconds, 600)
  assert.equal(page.data.tone, 'electronic')
  assert.equal(page.data.accent, true)
  page.inputBpm({ detail: { value: '39' } })
  await page.confirmBpm()
  assert.equal(page.data.bpm, 120)
  page.inputBpm({ detail: { value: '240' } })
  await page.confirmBpm()
  assert.equal(page.data.bpm, 240)
  assert.equal(getSaved().bpm, 240)
})

test('leaving during generation aborts safely and permits a foreground retry', async () => {
  const { page, nativeFs, files } = loadPage(false, { seconds: 60 })
  await initialize(page)
  const write = nativeFs.write
  let leave = true
  nativeFs.write = options => {
    if (leave) { page.onHide(); leave = false }
    write(options)
  }
  await page.generateAndPlay()
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.busy, false)
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 0)
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
})

test('generation failure cleans partial files and supports retry', async () => {
  const { page, nativeFs, files } = loadPage(false, { seconds: 60 })
  await initialize(page)
  const write = nativeFs.write
  nativeFs.write = options => options.fail({ errMsg: 'the maximum size of the file storage limit is exceeded' })
  await page.generateAndPlay()
  assert.equal(page.data.state, 'error')
  assert.equal(files.size, 0)
  nativeFs.write = write
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
})


test('existing audio directory does not fail initialization', async () => {
  const { page, nativeFs } = loadPage()
  nativeFs.access = options => options.success({})
  nativeFs.mkdir = options => options.fail({ errMsg: 'file already exists' })
  await initialize(page)
  assert.equal(page.data.state, 'idle')
})


test('BPM header save shares validation and +/- changes by five within bounds', async () => {
  const { page, getSaved } = loadPage()
  await initialize(page)
  await page.stepBpm({ currentTarget: { dataset: { step: 1 } } })
  assert.equal(page.data.bpm, 125)
  await page.stepBpm({ currentTarget: { dataset: { step: -1 } } })
  assert.equal(page.data.bpm, 120)
  await page.openPanel({ currentTarget: { dataset: { panel: 'bpm' } } })
  page.inputBpm({ detail: { value: '241' } })
  await page.panelAction()
  assert.equal(page.data.panel, 'bpm')
  page.inputBpm({ detail: { value: '238' } })
  await page.panelAction()
  assert.equal(page.data.panel, '')
  assert.equal(getSaved().bpm, 238)
  await page.stepBpm({ currentTarget: { dataset: { step: 1 } } })
  assert.equal(page.data.bpm, 240)
  await page.changeSetting('bpm', 42)
  await page.stepBpm({ currentTarget: { dataset: { step: -1 } } })
  assert.equal(page.data.bpm, 40)
})

test('beat marker follows progress, interpolates, and stops on pause/hide/seek/end', async () => {
  const { page, audio, events, tick, timers } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.generateAndPlay()
  assert.equal(page.data.currentBeat, 0)
  tick(500)
  assert.equal(page.data.currentBeat, 1)
  audio.currentTime = 1.5
  events.TimeUpdate()
  assert.equal(page.data.currentBeat, 3)
  tick(500)
  assert.equal(page.data.currentBeat, 0)
  audio.pause()
  assert.equal(page.data.currentBeat, -1)
  assert.equal(timers.size, 0)
  audio.currentTime = 2.5
  audio.play()
  assert.equal(page.data.currentBeat, 1)
  events.Seeking()
  assert.equal(page.data.currentBeat, -1)
  audio.currentTime = 4.5
  events.Seeked()
  assert.equal(page.data.currentBeat, 1)
  page.onHide()
  assert.equal(timers.size, 0)
  audio.currentTime = 8
  page.onShow()
  assert.equal(page.data.currentBeat, 0)
  events.Waiting()
  assert.equal(page.data.currentBeat, -1)
  audio.currentTime = 8.5
  events.TimeUpdate()
  assert.equal(page.data.currentBeat, 1)
  events.Ended()
  assert.equal(page.data.currentBeat, -1)
  assert.equal(timers.size, 0)
  await new Promise(resolve => setImmediate(resolve))
})

test('drum mode preserves the selected meter, loads bundled samples and remembers selections', async () => {
  const { page, setConfirm, files, getSource, getSaved } = loadPage(false, { seconds: 60, beats: 3 })
  await initialize(page)
  await page.changeSetting('mode', 'drums')
  assert.equal(page.data.mode, 'drums')
  assert.equal(page.data.beats, 3)
  await page.changeSetting('kit', '808')
  await page.changeSetting('pattern', 'rock')
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
  assert.equal(getSaved().kit, '808')
  assert.equal(getSaved().pattern, 'rock')
  const { createDrumRenderer, decodeSample, kits } = require('../miniprogram/utils/drums')
  const samples = {}
  for (const [instrument, name] of Object.entries(kits[1].files)) {
    const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets/drums', name + '.wav'))
    samples[instrument] = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  }
  assert.deepEqual(files.get(getSource()).subarray(44, 44 + 44100), Buffer.from(createDrumRenderer(120, 'rock', samples, 3)(0)))
})

test('missing drum sample returns an actionable error and permits retry', async () => {
  const { page, nativeFs, files } = loadPage(false, { seconds: 60, mode: 'drums' })
  await initialize(page)
  const read = nativeFs.readFile
  nativeFs.readFile = options => options.fail({ errMsg: 'missing asset' })
  await page.generateAndPlay()
  assert.equal(page.data.state, 'error')
  assert.equal(files.size, 0)
  nativeFs.readFile = read
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
})


test('cleanup attempts every generated file, preserves unrelated files and retries failures on entry', async () => {
  const { page, nativeFs, files } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.generateAndPlay()
  files.set('/user/metronome-probe/partial.wav', Buffer.from('partial'))
  files.set('/user/unrelated.txt', Buffer.from('keep'))
  const unlink = nativeFs.unlink
  let failedPath
  nativeFs.unlink = options => {
    if (!failedPath) failedPath = options.filePath
    if (options.filePath === failedPath) options.fail({ errMsg: 'temporarily unavailable' })
    else unlink(options)
  }
  await page.stopAndClean()
  assert.equal(page.data.state, 'error')
  assert.equal(files.size, 2)
  assert.ok(files.has(failedPath))
  assert.ok(files.has('/user/unrelated.txt'))
  assert.match(page.data.cleanupStatus, /清理失败/)
  nativeFs.unlink = unlink
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 1)
  assert.equal(page.data.filePath, '')
  assert.equal(page.data.cleanupStatus, '生成文件已清理')
})

test('inactive entry, hide and unload clean residual files while paused audio is preserved', async () => {
  const { page, createPage, files } = loadPage(false, { seconds: 60 })
  await initialize(page)
  for (const action of ['onShow', 'onHide', 'onUnload']) {
    files.set('/user/metronome-probe/stale.wav', Buffer.from('stale'))
    page[action]()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(files.size, 0)
  }
  const next = createPage()
  await initialize(next)
  await next.generateAndPlay()
  await next.primaryAction()
  next.onHide()
  next.onUnload()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 1)
  assert.equal(next.data.state, 'paused')
})

test('a quick hide and return still cancels generation and cleans its partial file', async () => {
  const { page, nativeFs, files, getSource } = loadPage(false, { seconds: 60 })
  await initialize(page)
  const write = nativeFs.write
  nativeFs.write = options => {
    page.onHide()
    page.onShow()
    write(options)
  }
  await page.generateAndPlay()
  assert.equal(page.data.state, 'error')
  assert.equal(files.size, 0)
  assert.equal(getSource(), undefined)
})

test('background cleanup failure is retained and retried after foreground return', async () => {
  const { page, nativeFs, events, files } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.generateAndPlay()
  const unlink = nativeFs.unlink
  nativeFs.unlink = options => options.fail({ errMsg: 'background operation unavailable' })
  page.onHide()
  events.Ended()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 1)
  nativeFs.unlink = unlink
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(files.size, 0)
})

test('theme follows system by default, fixed modes persist and never interrupt playback', async () => {
  const { page, setSystemTheme, getSaved, getNavigation, getBackground, files, getStopCount } = loadPage(false, { seconds: 60 })
  setSystemTheme('dark')
  await initialize(page)
  assert.equal(page.data.themePreference, 'system')
  assert.equal(page.data.theme, 'dark')
  assert.equal(getNavigation().frontColor, '#ffffff')
  assert.equal(getBackground().backgroundColor, '#171e1b')
  await page.generateAndPlay()
  const stops = getStopCount()
  page.selectTheme({ currentTarget: { dataset: { value: 'light' } } })
  assert.equal(page.data.theme, 'light')
  assert.equal(getNavigation().frontColor, '#000000')
  setSystemTheme('dark')
  assert.equal(page.data.theme, 'light')
  page.selectTheme({ currentTarget: { dataset: { value: 'dark' } } })
  setSystemTheme('light')
  assert.equal(page.data.theme, 'dark')
  assert.equal(getSaved().themePreference, 'dark')
  page.selectTheme({ currentTarget: { dataset: { value: 'system' } } })
  assert.equal(page.data.theme, 'light')
  setSystemTheme('dark')
  assert.equal(page.data.theme, 'dark')
  assert.equal(page.data.state, 'playing')
  assert.equal(files.size, 1)
  assert.equal(getStopCount(), stops)
})

test('saved fixed theme restores and invalid preference falls back to system', async () => {
  const fixed = loadPage(false, { themePreference: 'dark' })
  await initialize(fixed.page)
  assert.equal(fixed.page.data.theme, 'dark')
  fixed.page.onHide()
  fixed.page.onShow()
  assert.equal(fixed.page.data.theme, 'dark')
  const invalid = loadPage(false, { themePreference: 'unknown' })
  await initialize(invalid.page)
  assert.equal(invalid.page.data.themePreference, 'system')
  assert.equal(invalid.page.data.theme, 'light')
})


test('diagnostics copy includes storage, settings, file and errors', async () => {
  const { page, nativeFs, getClipboard } = loadPage(false, { seconds: 60 })
  await initialize(page)
  nativeFs.write = options => options.fail({ errMsg: 'the maximum size of the file storage limit is exceeded' })
  await page.generateAndPlay()
  await page.openPanel({ currentTarget: { dataset: { panel: 'diagnostics' } } })
  page.copyDiagnostics()
  assert.match(getClipboard(), /120 BPM · 4\/4 · 60 秒/)
  assert.match(getClipboard(), /生成文件：0 个 \/ 0 字节/)
  assert.match(getClipboard(), /maximum size/)
  assert.match(getClipboard(), /预计 2646044 字节/)
})

test('ten-minute sessions stay bounded across repeats and close before playback and cleanup', async () => {
  const { page, nativeFs, descriptors, files } = loadPage(false, { seconds: 600 })
  await initialize(page)
  const write = nativeFs.write
  const unlink = nativeFs.unlink
  let peak = 0
  nativeFs.write = options => {
    write(options)
    const bytes = [...files.values()].reduce((total, file) => total + file.length, 0)
    peak = Math.max(peak, bytes)
    assert.ok(bytes <= 44 + 600 * 44100)
  }
  nativeFs.unlink = options => {
    assert.equal(descriptors.size, 0)
    unlink(options)
  }
  for (let i = 0; i < 4; i++) {
    await page.generateAndPlay()
    assert.equal(page.data.state, 'playing')
    assert.equal(descriptors.size, 0)
    assert.equal(files.size, 1)
    assert.match(page.data.storageStatus, /生成文件：1 个 \/ 26460044 字节/)
    await page.stopAndClean()
    assert.equal(files.size, 0)
    assert.match(page.data.storageStatus, /生成文件：0 个 \/ 0 字节/)
  }
  assert.equal(peak, 26460044)
})

test('short writes complete at correct positions and close failure is retried before removal', async () => {
  const { page, nativeFs, descriptors, files, getSource } = loadPage(false, { seconds: 60 })
  await initialize(page)
  const write = nativeFs.write
  nativeFs.write = options => write({ ...options, length: Math.max(1, Math.floor(options.length / 2)) })
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
  const { createHeader, createSecond } = require('../miniprogram/utils/wav')
  assert.deepEqual(files.get(getSource()), Buffer.concat([Buffer.from(createHeader(60)), ...Array.from({ length: 60 }, (_, second) => Buffer.from(createSecond(second)))]))
  await page.stopAndClean()
  const close = nativeFs.close
  nativeFs.close = options => options.fail({ errMsg: 'close temporarily unavailable' })
  await page.generateAndPlay()
  assert.equal(page.data.state, 'error')
  assert.equal(descriptors.size, 1)
  assert.equal(files.size, 1)
  nativeFs.close = close
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(descriptors.size, 0)
  assert.equal(files.size, 0)
})

test('cleanup verifies removal and storage includes unrelated files without deleting them', async () => {
  const { page, nativeFs, files } = loadPage(false, { seconds: 60 })
  await initialize(page)
  files.set('/user/other/cache.bin', Buffer.alloc(100))
  files.set('/user/metronome-probe/stale.wav', Buffer.alloc(50))
  const unlink = nativeFs.unlink
  nativeFs.unlink = options => options.success({})
  await page.stopAndClean()
  assert.equal(page.data.state, 'error')
  assert.match(page.data.logs[0].text, /仍有 1 个生成文件/)
  assert.match(page.data.storageStatus, /用户目录总占用：150 字节/)
  nativeFs.unlink = unlink
  await page.stopAndClean()
  assert.equal(files.size, 1)
  assert.match(page.data.storageStatus, /用户目录总占用：100 字节/)
})

test('saved drum meters restore without being forced to four beats', async () => {
  for (const beats of [2, 3, 4]) {
    const { page, getSaved } = loadPage(false, { mode: 'drums', beats })
    await initialize(page)
    assert.equal(page.data.beats, beats)
    assert.equal(page.data.beatDots.length, beats)
    await page.changeSetting('mode', 'metronome')
    await page.changeSetting('mode', 'drums')
    assert.equal(getSaved().beats, beats)
  }
})

test('diagnostics repeatedly expands and collapses inside settings without stopping audio', async () => {
  const { page, getStopCount } = loadPage(false, { seconds: 60 })
  await initialize(page)
  await page.generateAndPlay()
  const stops = getStopCount()
  await page.openPanel({ currentTarget: { dataset: { panel: 'settings' } } })
  for (let i = 0; i < 3; i++) {
    await page.openPanel({ currentTarget: { dataset: { panel: 'diagnostics' } } })
    assert.equal(page.data.panel, 'diagnostics')
    await page.openPanel({ currentTarget: { dataset: { panel: 'diagnostics' } } })
    assert.equal(page.data.panel, 'settings')
  }
  assert.equal(page.data.state, 'playing')
  assert.equal(getStopCount(), stops)
})

test('manual cleanup removes all runtime files, logs and decoded samples but preserves user input and settings', async () => {
  const { page, files, directories, nativeFs, getSaved, getClipboard, createPage } = loadPage(false, { seconds: 60, mode: 'drums' })
  await initialize(page)
  await page.changeSetting('bpm', 137)
  await page.changeSetting('themePreference', 'dark')
  const settings = { ...getSaved() }
  let reads = 0
  const readFile = nativeFs.readFile
  nativeFs.readFile = options => { reads++; readFile(options) }
  await page.generateAndPlay()
  assert.equal(reads, 3)
  assert.ok(page.data.logs.length > 0)
  directories.add('/user/metronome-probe/cache')
  directories.add('/user/metronome-probe/cache/empty')
  files.set('/user/metronome-probe/cache/old.log', Buffer.from('old log'))
  files.set('/user/metronome-probe/partial.tmp', Buffer.from('partial'))
  page.inputBpm({ detail: { value: '145' } })
  await page.stopAndClean()
  assert.equal(files.size, 0)
  assert.equal(directories.size, 2)
  assert.equal(page.data.logs.length, 0)
  assert.equal(page.data.filePath, '')
  assert.equal(page.data.progress, 0)
  assert.equal(page.data.currentBeat, -1)
  assert.equal(page.data.bpmInput, '145')
  assert.equal(page.data.bpm, 137)
  assert.deepEqual({ ...getSaved() }, settings)
  page.copyDiagnostics()
  assert.doesNotMatch(getClipboard(), /准备写入|WAV：|beat-.*\.wav/)
  const next = createPage()
  await initialize(next)
  assert.equal(next.data.logs.length, 0)
  assert.equal(next.data.bpmInput, '145')
  await next.generateAndPlay()
  assert.equal(reads, 6, 'decoded samples must be loaded again after cleanup')
  assert.equal(next.data.state, 'playing')
})

test('footer year follows local system time when returning to the page', async () => {
  const { page, tick } = loadPage()
  tick(new Date(2026, 11, 31, 23, 59, 59).getTime())
  await initialize(page)
  assert.equal(page.data.year, 2026)
  tick(1000)
  page.onShow()
  assert.equal(page.data.year, 2027)
  await new Promise(resolve => setImmediate(resolve))
})

for (const tone of ['voice', 'voice-female']) {
  test(`${tone}: selection restores and renders across pause and resume`, async () => {
    const { page, audio, files, getSource, getSaved } = loadPage(false, { seconds: 60, beats: 3, tone })
    await initialize(page)
    assert.equal(page.data.tone, tone)
    await page.changeSetting('accent', false)
    assert.equal(getSaved().tone, tone)
    await page.generateAndPlay()
    assert.equal(page.data.state, 'playing')
    assert.equal(audio.singer, tone === 'voice-female' ? '美式英语女声' : '人声报拍')
    const { createVoiceRenderer, words, voiceDirectory } = require('../miniprogram/utils/voice')
    const { decodeSample } = require('../miniprogram/utils/wav')
    const samples = {}
    for (const word of words) {
      const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets', voiceDirectory(tone, 120), word + '.wav'))
      samples[word] = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
    }
    const render = createVoiceRenderer(120, 3, false, samples)
    assert.deepEqual(files.get(getSource()).subarray(44, 44 + 88200), Buffer.concat([Buffer.from(render(0)), Buffer.from(render(1))]))
    const source = getSource()
    await page.primaryAction()
    assert.equal(page.data.state, 'paused')
    await page.primaryAction()
    assert.equal(page.data.state, 'playing')
    assert.equal(getSource(), source)
  })

  test(`${tone}: missing sample cleans up and allows retry`, async () => {
    const { page, nativeFs, files } = loadPage(false, { seconds: 60, tone })
    await initialize(page)
    const read = nativeFs.readFile
    nativeFs.readFile = options => options.fail({ errMsg: 'missing voice sample' })
    await page.generateAndPlay()
    assert.equal(page.data.state, 'error')
    assert.equal(files.size, 0)
    nativeFs.readFile = read
    await page.generateAndPlay()
    assert.equal(page.data.state, 'playing')
  })
}
test('retired Japanese voice selection restores as the replacement voice', async () => {
  const { page, getSaved } = loadPage(false, { seconds: 60, tone: 'voice-japanese' })
  await initialize(page)
  assert.equal(page.data.tone, 'voice')
  await page.changeSetting('accent', false)
  assert.equal(getSaved().tone, 'voice')
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
})

test('switching between backing-track voice and female voice loads distinct samples', async () => {
  const { page, files, getSource, getSaved, setConfirm } = loadPage(false, { seconds: 60, tone: 'voice' })
  await initialize(page)
  await page.generateAndPlay()
  const original = Buffer.from(files.get(getSource()).subarray(44, 44144))
  setConfirm(true)
  await page.changeSetting('tone', 'voice-female')
  await page.generateAndPlay()
  assert.equal(page.data.state, 'playing')
  assert.equal(getSaved().tone, 'voice-female')
  assert.notDeepEqual(files.get(getSource()).subarray(44, 44144), original)
  await page.changeSetting('tone', 'voice')
  await page.generateAndPlay()
  assert.deepEqual(files.get(getSource()).subarray(44, 44144), original)
})
