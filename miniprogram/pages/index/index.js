const { SAMPLE_RATE, createHeader, createSecond } = require('../../utils/wav')
const { kits, patterns, decodeSample, createDrumRenderer } = require('../../utils/drums')
const fs = wx.getFileSystemManager()
const directory = `${wx.env.USER_DATA_PATH}/metronome-probe`
const storageKey = 'metronome-settings'
const defaults = { bpm: 120, beats: 4, accent: true, tone: 'electronic', seconds: 600, mode: 'metronome', kit: 'acoustic', pattern: 'basic', themePreference: 'system' }
// Keep the session alive when the page is recreated; audio callbacks are registered once.
const session = { page: null, audio: null, data: null, visible: false, needsCleanup: false, beatTimer: null, clock: null, samples: {}, generationCancelled: false, writerFd: null }

function update(values) {
  Object.assign(session.data, values)
  if (session.page) session.page.setData(values)
}
function stopBeatDisplay() {
  clearInterval(session.beatTimer)
  session.beatTimer = null
  session.clock = null
  update({ currentBeat: -1 })
}
function anchorBeatDisplay() {
  const time = session.audio.currentTime
  if (Number.isFinite(time)) session.clock = { time, wall: Date.now() }
}
function refreshBeatDisplay() {
  if (!session.visible || session.data.state !== 'playing' || !session.clock) return
  // Interpolate between native progress events; never use this clock for sound.
  const time = session.clock.time + Math.min(1, (Date.now() - session.clock.wall) / 1000)
  const currentBeat = time >= session.data.seconds ? -1 : Math.floor(time * session.data.bpm / 60) % session.data.beats
  if (currentBeat !== session.data.currentBeat) update({ currentBeat })
}
function startBeatDisplay() {
  stopBeatDisplay()
  if (!session.visible || session.data.state !== 'playing') return
  anchorBeatDisplay()
  refreshBeatDisplay()
  session.beatTimer = setInterval(refreshBeatDisplay, 40)
}

function fileOperation(method, options) {
  return new Promise((resolve, reject) => fs[method]({ ...options, success: resolve, fail: reject }))
}
function log(message) {
  const now = Date.now()
  update({ logs: [{ id: `${now}-${Math.random()}`, text: `${new Date(now).toLocaleTimeString()} ${message}` }, ...session.data.logs].slice(0, 20) })
}
function saveSettings() {
  const settings = {}
  for (const name of Object.keys(defaults)) settings[name] = session.data[name]
  try { wx.setStorageSync(storageKey, settings) } catch (error) { log(`保存设置失败：${JSON.stringify({ message: error.message, ...error })}`) }
}
function applyTheme(systemTheme = wx.getAppBaseInfo().theme) {
  const theme = session.data.themePreference === 'system' ? (systemTheme === 'dark' ? 'dark' : 'light') : session.data.themePreference
  update({ theme })
  const backgroundColor = theme === 'dark' ? '#171e1b' : '#f8f9f5'
  wx.setNavigationBarColor({ frontColor: theme === 'dark' ? '#ffffff' : '#000000', backgroundColor })
  wx.setBackgroundColor({ backgroundColor, backgroundColorTop: backgroundColor, backgroundColorBottom: backgroundColor })
}
function hasActiveAudio() { return ['playing', 'paused', 'waiting'].includes(session.data.state) }
async function closeWriter() {
  if (session.writerFd === null) return
  await fileOperation('close', { fd: session.writerFd })
  session.writerFd = null
}
async function writeChunk(data, position) {
  let offset = 0
  while (offset < data.byteLength) {
    const { bytesWritten } = await fileOperation('write', { fd: session.writerFd, data, offset, length: data.byteLength - offset, position: position + offset })
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > data.byteLength - offset) throw new Error('音频文件写入不完整')
    offset += bytesWritten
  }
}
async function refreshStorage() {
  let totalBytes = 0
  let generatedBytes = 0
  let generatedCount = 0
  async function scan(dirPath) {
    const { files } = await fileOperation('readdir', { dirPath })
    for (const name of files) {
      const path = `${dirPath}/${name}`
      const { stats } = await fileOperation('stat', { path })
      if (stats.isDirectory()) await scan(path)
      else {
        totalBytes += stats.size
        if (path.startsWith(`${directory}/`)) { generatedBytes += stats.size; generatedCount++ }
      }
    }
  }
  try {
    await scan(wx.env.USER_DATA_PATH)
    update({ storageStatus: `生成文件：${generatedCount} 个 / ${generatedBytes} 字节；用户目录总占用：${totalBytes} 字节` })
  } catch (error) {
    update({ storageStatus: `占用检查失败：${JSON.stringify({ message: error.message, ...error })}` })
  }
}
async function cleanFiles() {
  session.needsCleanup = true
  update({ cleanupStatus: '正在清理生成文件…' })
  await closeWriter()
  let failure
  async function emptyDirectory(dirPath) {
    const { files } = await fileOperation('readdir', { dirPath })
    for (const name of files) {
      const path = `${dirPath}/${name}`
      try {
        const { stats } = await fileOperation('stat', { path })
        if (stats.isDirectory()) {
          await emptyDirectory(path)
          await fileOperation('rmdir', { dirPath: path })
        } else await fileOperation('unlink', { filePath: path })
      } catch (error) { failure = error }
    }
  }
  await emptyDirectory(directory)
  await refreshStorage()
  if (failure) throw failure
  const remaining = await fileOperation('readdir', { dirPath: directory })
  if (remaining.files.length) throw new Error(`仍有 ${remaining.files.length} 个生成文件未清理`)
  session.needsCleanup = false
  update({ filePath: '', cleanupStatus: '生成文件已清理' })
}
async function cleanup() {
  session.needsCleanup = true
  if (session.data.busy || hasActiveAudio()) return
  update({ busy: true })
  try {
    await cleanFiles()
  } catch (error) {
    log(`清理失败：${JSON.stringify({ message: error.message, ...error })}`)
    update({ cleanupStatus: '清理失败，重新进入时自动重试，也可手动清理', status: '文件清理失败，请在设置中重试', state: 'error' })
  } finally {
    update({ busy: false })
  }
}
function leavePage() {
  session.visible = false
  if (session.data.state === 'generating') session.generationCancelled = true
  stopBeatDisplay()
  if (!hasActiveAudio()) cleanup()
}

Page({
  data: {
    ...defaults, kits, patterns, kitLabel: kits[0].label, patternLabel: patterns[0].label,
    currentBeat: -1, beatDots: [0, 1, 2, 3], ready: false, busy: false,
    state: 'idle', filePath: '', status: '正在准备…', progress: 0,
    panel: '', bpmInput: '120', logs: [], year: new Date().getFullYear(), theme: 'light', cleanupStatus: '等待清理检查', storageStatus: '等待占用检查'
  },
  onLoad() {
    session.page = this
    if (session.data) {
      this.setData({ ...session.data, panel: '' })
      return
    }
    session.data = { ...this.data }
    try {
      const saved = wx.getStorageSync(storageKey) || {}
      const settings = {
        bpm: Number.isInteger(saved.bpm) && saved.bpm >= 40 && saved.bpm <= 240 ? saved.bpm : defaults.bpm,
        beats: [2, 3, 4].includes(saved.beats) ? saved.beats : defaults.beats,
        accent: typeof saved.accent === 'boolean' ? saved.accent : defaults.accent,
        tone: ['electronic', 'soft'].includes(saved.tone) ? saved.tone : defaults.tone,
        seconds: [60, 300, 600].includes(saved.seconds) ? saved.seconds : defaults.seconds,
        mode: saved.mode === 'drums' ? 'drums' : 'metronome',
        kit: kits.some(item => item.id === saved.kit) ? saved.kit : defaults.kit,
        pattern: patterns.some(item => item.id === saved.pattern) ? saved.pattern : defaults.pattern,
        themePreference: ['light', 'dark', 'system'].includes(saved.themePreference) ? saved.themePreference : defaults.themePreference
      }
      update({ ...settings, kitLabel: kits.find(item => item.id === settings.kit).label, patternLabel: patterns.find(item => item.id === settings.pattern).label, beatDots: Array.from({ length: settings.beats }, (_, i) => i) })
    } catch (error) { log(`读取设置失败：${JSON.stringify({ message: error.message, ...error })}`) }
    wx.onThemeChange(({ theme }) => applyTheme(theme))
    const audio = session.audio = wx.getBackgroundAudioManager()
    audio.onPlay(() => {
      update({ state: 'playing', status: '正在播放 · 可以锁屏练习' })
      startBeatDisplay()
    })
    audio.onPause(() => {
      stopBeatDisplay()
      update({ state: 'paused', status: '已暂停 · 点击继续练习' })
    })
    audio.onStop(() => {
      stopBeatDisplay()
      if (session.data.state === 'generating') return
      update({ state: 'idle', status: '已停止' })
      session.needsCleanup = true
      cleanup()
    })
    audio.onEnded(() => {
      stopBeatDisplay()
      update({ state: 'ended', status: '本次练习已结束' })
      session.needsCleanup = true
      cleanup()
    })
    audio.onError(error => {
      stopBeatDisplay()
      update({ state: 'error', status: '播放失败，请重试或查看诊断信息' })
      log(`onError ${JSON.stringify({ message: error.message, ...error })}`)
      session.needsCleanup = true
      cleanup()
    })
    audio.onWaiting(() => {
      stopBeatDisplay()
      update({ state: 'waiting', status: '音频加载中…' })
    })
    audio.onTimeUpdate(() => {
      if (session.data.state === 'waiting' && !audio.paused) {
        update({ state: 'playing', status: '正在播放 · 可以锁屏练习' })
        startBeatDisplay()
      }
      anchorBeatDisplay()
      refreshBeatDisplay()
    })
    audio.onSeeking(stopBeatDisplay)
    audio.onSeeked(() => { if (session.data.state === 'playing') startBeatDisplay() })
    this.prepare()
  },
  async prepare() {
    update({ busy: true })
    try {
      session.audio.stop()
      try {
        await fileOperation('access', { path: directory })
      } catch (error) {
        await fileOperation('mkdir', { dirPath: directory, recursive: true })
      }
      await cleanFiles()
      update({ ready: true, state: 'idle', status: '就绪 · 选好节奏，开始练习' })
    } catch (error) {
      log(JSON.stringify({ message: error.message, ...error }))
      update({ state: 'error', status: '文件准备失败，点击重试', cleanupStatus: '准备失败，残留文件将在重试时再次清理' })
    } finally { update({ busy: false }) }
  },
  onShow() {
    session.visible = true
    update({ year: new Date().getFullYear() })
    applyTheme()
    if (!session.data.busy && !hasActiveAudio()) cleanup()
    else if (['playing', 'paused', 'waiting'].includes(session.data.state)) {
      update({ state: session.audio.paused ? 'paused' : 'playing', status: session.audio.paused ? '已暂停 · 点击继续练习' : '正在播放 · 可以锁屏练习' })
    }
    if (session.data.state === 'playing') startBeatDisplay()
  },
  onHide() { leavePage() },
  onUnload() { leavePage(); session.page = null },
  async allowEdit() {
    if (session.data.busy) return false
    const active = ['playing', 'paused', 'waiting'].includes(session.data.state)
    if (!active) return true
    const result = await new Promise(resolve => wx.showModal({
      title: '结束当前练习？',
      content: '修改设置需要停止当前音频，重新开始后将按完整时长播放。',
      confirmText: '结束修改', cancelText: '继续播放', success: resolve, fail: () => resolve({ confirm: false })
    }))
    if (!result.confirm || session.data.busy) return false
    await this.stopAndClean()
    return session.data.state !== 'error'
  },
  async openPanel(event) {
    const requestedPanel = event.currentTarget.dataset.panel
    const panel = requestedPanel === 'diagnostics' && session.data.panel === 'diagnostics' ? 'settings' : requestedPanel
    if (!['settings', 'diagnostics'].includes(panel) && !await this.allowEdit()) return
    update({ panel, bpmInput: String(session.data.bpm) })
    if (panel === 'diagnostics') await refreshStorage()
  },
  async panelAction() {
    if (session.data.panel === 'bpm') await this.confirmBpm()
    else this.closePanel()
  },
  closePanel() { update({ panel: '' }) },
  preventClose() {},
  inputBpm(event) { update({ bpmInput: event.detail.value }) },
  async confirmBpm() {
    const bpm = Number(session.data.bpmInput)
    if (!Number.isInteger(bpm) || bpm < 40 || bpm > 240) {
      wx.showToast({ title: '请输入 40–240 的整数', icon: 'none' })
      return
    }
    await this.changeSetting('bpm', bpm)
  },
  async stepBpm(event) {
    await this.changeSetting('bpm', Math.max(40, Math.min(240, session.data.bpm + Number(event.currentTarget.dataset.step) * 5)))
  },
  async slideBpm(event) { await this.changeSetting('bpm', Number(event.detail.value)) },
  async selectOption(event) {
    const { key, value } = event.currentTarget.dataset
    await this.changeSetting(key, ['beats', 'seconds'].includes(key) ? Number(value) : value)
  },
  async toggleAccent() { await this.changeSetting('accent', !session.data.accent) },
  async changeSetting(key, value) {
    if (session.data[key] === value) { update({ panel: '' }); return }
    if (!await this.allowEdit()) { update({ bpm: session.data.bpm }); return }
    update({ [key]: value, panel: '', beatDots: Array.from({ length: key === 'beats' ? value : session.data.beats }, (_, i) => i) })
    update({ kitLabel: kits.find(item => item.id === session.data.kit).label, patternLabel: patterns.find(item => item.id === session.data.pattern).label })
    saveSettings()
  },
  selectTheme(event) {
    const value = event.currentTarget.dataset.value
    if (!['light', 'dark', 'system'].includes(value)) return
    update({ themePreference: value })
    applyTheme()
    saveSettings()
  },
  async primaryAction() {
    if (session.data.busy) return
    if (!session.data.ready) { await this.prepare(); return }
    if (session.data.state === 'playing') session.audio.pause()
    else if (session.data.state === 'paused') {
      update({ state: 'waiting', status: '正在恢复播放…' })
      session.audio.play()
    } else if (session.data.state !== 'waiting') await this.generateAndPlay()
  },
  async generateAndPlay() {
    if (session.data.busy || !session.data.ready) return
    session.generationCancelled = false
    update({ busy: true, state: 'generating', progress: 0, status: '正在准备音频，请保持前台' })
    const { bpm, beats, accent, tone, seconds, mode, kit, pattern } = session.data
    const filePath = `${directory}/beat-${Date.now()}.wav`
    try {
      session.audio.stop()
      await cleanFiles()
      let renderSecond = second => createSecond(second, { bpm, beats, accent, tone })
      if (mode === 'drums') {
        if (!session.samples[kit]) {
          const selected = kits.find(item => item.id === kit)
          const entries = await Promise.all(Object.entries(selected.files).map(async ([instrument, name]) => {
            const { data } = await fileOperation('readFile', { filePath: `assets/drums/${name}.wav` })
            return [instrument, decodeSample(data)]
          }))
          session.samples[kit] = {}
          for (const [instrument, sample] of entries) session.samples[kit][instrument] = sample
        }
        renderSecond = createDrumRenderer(bpm, pattern, session.samples[kit], beats)
      }
      log(`准备写入：${seconds} 秒，预计 ${44 + seconds * SAMPLE_RATE * 2} 字节；${session.data.storageStatus}`)
      // DevTools appendFile can hit its storage quota after only ~2 MiB; write by position instead.
      const { fd } = await fileOperation('open', { filePath, flag: 'w' })
      session.writerFd = fd
      await writeChunk(createHeader(seconds), 0)
      update({ filePath, cleanupStatus: '本次音频保留中，结束练习后清理' })
      for (let second = 0; second < seconds; second++) {
        if (session.generationCancelled || !session.visible) throw new Error('生成期间离开了页面，请回到前台重新开始')
        await writeChunk(renderSecond(second), 44 + second * SAMPLE_RATE * 2)
        if ((second + 1) % 10 === 0 || second === seconds - 1) update({ progress: Math.round((second + 1) / seconds * 100) })
      }
      await closeWriter()
      const info = await fileOperation('stat', { path: filePath })
      if (info.stats.size !== 44 + seconds * SAMPLE_RATE * 2) throw new Error('音频文件大小与预计不符')
      await refreshStorage()
      log(`WAV：${info.stats.size} 字节，${bpm} BPM，${beats}/4，${seconds} 秒`)
      session.audio.title = `${mode === 'drums' ? session.data.patternLabel : '节拍器'} · ${bpm} BPM · ${beats}/4`
      session.audio.singer = mode === 'drums' ? session.data.kitLabel : tone === 'soft' ? '柔和提示音' : '电子提示音'
      session.audio.epname = '吉他练习'
      session.audio.startTime = 0
      session.audio.playbackRate = 1
      update({ state: 'waiting', status: '正在开始播放…' })
      if (session.generationCancelled || !session.visible) throw new Error('生成期间离开了页面，请回到前台重新开始')
      session.audio.src = filePath
    } catch (error) {
      session.audio.stop()
      log(JSON.stringify({ message: error.message, ...error, progress: session.data.progress, filePath, storage: session.data.storageStatus }))
      update({ state: 'error', status: session.visible ? '生成失败，请重试或查看诊断信息' : '生成已中止，请保持前台重新开始' })
      session.needsCleanup = true
    } finally {
      update({ busy: false })
      if (session.needsCleanup) await cleanup()
    }
  },
  copyDiagnostics() {
    const data = session.data
    wx.setClipboardData({
      data: [`${data.mode} · ${data.bpm} BPM · ${data.beats}/4 · ${data.seconds} 秒`, data.status, data.cleanupStatus, data.storageStatus, data.filePath, ...data.logs.map(item => item.text)].filter(Boolean).join('\n'),
      fail: error => { log(`复制失败：${JSON.stringify({ message: error.message, ...error })}`); wx.showToast({ title: '复制失败，请重试', icon: 'none' }) }
    })
  },
  async stopAndClean() {
    if (session.data.busy || !session.data.ready) return
    update({ busy: true, logs: [], progress: 0 })
    session.samples = {}
    session.generationCancelled = false
    try {
      session.audio.stop()
      await cleanFiles()
      update({ state: 'idle', status: '已结束 · 可以调整设置或再次开始', cleanupStatus: '音频、日志和运行缓存已全部清理' })
    } catch (error) {
      log(`清理失败：${JSON.stringify({ message: error.message, ...error })}`)
      update({ state: 'error', status: '文件清理失败，请重试', cleanupStatus: '清理失败，重新进入时自动重试，也可手动清理' })
    } finally { update({ busy: false }) }
  }
})
