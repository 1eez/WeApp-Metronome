const { createHeader, createSecond } = require('../../utils/wav')
const { kits, patterns, decodeSample, createDrumRenderer } = require('../../utils/drums')
const fs = wx.getFileSystemManager()
const directory = `${wx.env.USER_DATA_PATH}/metronome-probe`
const storageKey = 'metronome-settings'
const defaults = { bpm: 120, beats: 4, accent: true, tone: 'electronic', seconds: 600, mode: 'metronome', kit: 'acoustic', pattern: 'basic' }
// Keep the session alive when the page is recreated; audio callbacks are registered once.
const session = { page: null, audio: null, data: null, visible: false, needsCleanup: false, beatTimer: null, clock: null, samples: {} }

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
async function cleanFiles() {
  const { files } = await fileOperation('readdir', { dirPath: directory })
  for (const name of files) await fileOperation('unlink', { filePath: `${directory}/${name}` })
  session.needsCleanup = false
  update({ filePath: '' })
}
async function cleanup() {
  if (session.data.busy) return
  update({ busy: true })
  try {
    await cleanFiles()
  } catch (error) {
    log(`清理失败：${JSON.stringify(error)}`)
    update({ status: '文件清理失败，请在设置中重试', state: 'error' })
  } finally {
    update({ busy: false })
  }
}

Page({
  data: {
    ...defaults, kits, patterns, kitLabel: kits[0].label, patternLabel: patterns[0].label,
    currentBeat: -1, beatDots: [0, 1, 2, 3], ready: false, busy: false,
    state: 'idle', filePath: '', status: '正在准备…', progress: 0,
    panel: '', bpmInput: '120', logs: []
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
        pattern: patterns.some(item => item.id === saved.pattern) ? saved.pattern : defaults.pattern
      }
      if (settings.mode === 'drums') settings.beats = 4
      update({ ...settings, kitLabel: kits.find(item => item.id === settings.kit).label, patternLabel: patterns.find(item => item.id === settings.pattern).label, beatDots: Array.from({ length: settings.beats }, (_, i) => i) })
    } catch (error) { log(`读取设置失败：${JSON.stringify(error)}`) }
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
      if (session.visible) cleanup()
    })
    audio.onEnded(() => {
      stopBeatDisplay()
      update({ state: 'ended', status: '本次练习已结束' })
      session.needsCleanup = true
      if (session.visible) cleanup()
    })
    audio.onError(error => {
      stopBeatDisplay()
      update({ state: 'error', status: '播放失败，请重试或查看诊断信息' })
      log(`onError ${JSON.stringify(error)}`)
      session.needsCleanup = true
      if (session.visible) cleanup()
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
      log(JSON.stringify(error))
      update({ state: 'error', status: '文件准备失败，点击重试' })
    } finally { update({ busy: false }) }
  },
  onShow() {
    session.visible = true
    if (session.needsCleanup && !session.data.busy) cleanup()
    else if (['playing', 'paused', 'waiting'].includes(session.data.state)) {
      update({ state: session.audio.paused ? 'paused' : 'playing', status: session.audio.paused ? '已暂停 · 点击继续练习' : '正在播放 · 可以锁屏练习' })
    }
    if (session.data.state === 'playing') startBeatDisplay()
  },
  onHide() { session.visible = false; stopBeatDisplay() },
  onUnload() { session.visible = false; stopBeatDisplay(); session.page = null },
  async allowEdit(forceMeter = false) {
    if (session.data.busy) return false
    const active = ['playing', 'paused', 'waiting'].includes(session.data.state)
    if (!active && !forceMeter) return true
    const result = await new Promise(resolve => wx.showModal({
      title: active ? '结束当前练习？' : '切换到 4/4 拍？',
      content: (forceMeter ? '鼓伴奏使用 4/4 拍。' : '') + (active ? '修改设置需要停止当前音频，重新开始后将按完整时长播放。' : '切换模式时将同时调整拍号。'),
      confirmText: active ? '结束修改' : '切换', cancelText: active ? '继续播放' : '取消', success: resolve, fail: () => resolve({ confirm: false })
    }))
    if (!result.confirm || session.data.busy) return false
    if (active) await this.stopAndClean()
    return session.data.state !== 'error'
  },
  async openPanel(event) {
    const panel = event.currentTarget.dataset.panel
    if (!['settings', 'diagnostics'].includes(panel) && !await this.allowEdit()) return
    update({ panel, bpmInput: String(session.data.bpm) })
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
    const forceMeter = key === 'mode' && value === 'drums' && session.data.beats !== 4
    if (!await this.allowEdit(forceMeter)) { update({ bpm: session.data.bpm }); return }
    if (forceMeter) update({ beats: 4 })
    update({ [key]: value, panel: '', beatDots: Array.from({ length: key === 'beats' ? value : session.data.beats }, (_, i) => i) })
    update({ kitLabel: kits.find(item => item.id === session.data.kit).label, patternLabel: patterns.find(item => item.id === session.data.pattern).label })
    const settings = {}
    for (const name of Object.keys(defaults)) settings[name] = session.data[name]
    try { wx.setStorageSync(storageKey, settings) } catch (error) { log(`保存设置失败：${JSON.stringify(error)}`) }
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
        renderSecond = createDrumRenderer(bpm, pattern, session.samples[kit])
      }
      await fileOperation('writeFile', { filePath, data: createHeader(seconds) })
      update({ filePath })
      for (let second = 0; second < seconds; second++) {
        if (!session.visible) throw new Error('生成期间离开了页面，请回到前台重新开始')
        await fileOperation('appendFile', { filePath, data: renderSecond(second) })
        if ((second + 1) % 10 === 0 || second === seconds - 1) update({ progress: Math.round((second + 1) / seconds * 100) })
      }
      const info = await fileOperation('stat', { path: filePath })
      log(`WAV：${info.stats.size} 字节，${bpm} BPM，${beats}/4，${seconds} 秒`)
      session.audio.title = `${mode === 'drums' ? session.data.patternLabel : '节拍器'} · ${bpm} BPM · ${beats}/4`
      session.audio.singer = mode === 'drums' ? session.data.kitLabel : tone === 'soft' ? '柔和提示音' : '电子提示音'
      session.audio.epname = '吉他练习'
      session.audio.startTime = 0
      session.audio.playbackRate = 1
      update({ state: 'waiting', status: '正在开始播放…' })
      if (!session.visible) throw new Error('生成期间离开了页面，请回到前台重新开始')
      session.audio.src = filePath
    } catch (error) {
      session.audio.stop()
      log(JSON.stringify({ message: error.message, ...error }))
      update({ state: 'error', status: session.visible ? '生成失败，请重试或查看诊断信息' : '生成已中止，请保持前台重新开始' })
      session.needsCleanup = true
    } finally {
      update({ busy: false })
      if (session.needsCleanup && session.visible) await cleanup()
    }
  },
  async stopAndClean() {
    if (session.data.busy || !session.data.ready) return
    update({ busy: true })
    try {
      session.audio.stop()
      await cleanFiles()
      update({ state: 'idle', status: '已结束 · 可以调整设置或再次开始' })
    } catch (error) {
      log(`清理失败：${JSON.stringify(error)}`)
      update({ state: 'error', status: '文件清理失败，请重试' })
    } finally { update({ busy: false }) }
  }
})
