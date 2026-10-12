const { createHeader, createSecond } = require('../../utils/wav')
const fs = wx.getFileSystemManager()
const directory = `${wx.env.USER_DATA_PATH}/metronome-probe`

function fileOperation(method, options) {
  return new Promise((resolve, reject) => fs[method]({ ...options, success: resolve, fail: reject }))
}

Page({
  data: {
    durations: [{ label: '1 分钟（快速验证）', seconds: 60 }, { label: '10 分钟（锁屏验证）', seconds: 600 }],
    durationIndex: 0,
    ready: false,
    busy: false,
    active: false,
    filePath: '',
    status: '正在准备文件目录…',
    logs: []
  },

  onLoad() {
    this.audio = wx.getBackgroundAudioManager()
    this.audio.onPlay(() => {
      this.setData({ active: true, status: '收到 onPlay：请确认有声，再锁屏验证' })
      this.log('onPlay')
    })
    this.audio.onPause(() => {
      this.setData({ status: '播放已暂停；可用系统播放器恢复，或停止并清理' })
      this.log('onPause')
    })
    this.audio.onStop(() => {
      this.setData({ active: false, status: '播放已停止' })
      this.log('onStop')
    })
    this.audio.onEnded(() => {
      this.setData({ active: false, status: '音频自然结束；回到前台后清理文件' })
      this.log('onEnded')
      this.needsCleanup = true
      if (this.visible) this.stopAndClean()
    })
    this.audio.onError(error => {
      this.setData({ active: false, status: '后台播放失败，请保留下面的错误信息' })
      this.log(`onError ${JSON.stringify(error)}`)
      this.needsCleanup = true
    })
    this.audio.onWaiting(() => this.log('onWaiting：播放器等待数据'))
    this.prepare()
  },

  onShow() {
    this.visible = true
    if (this.needsCleanup && !this.data.busy) this.stopAndClean()
  },

  onHide() {
    this.visible = false
    // 保留当前文件，不停止后台音频；不依赖后台 JS 清理。
  },

  log(message) {
    const now = Date.now()
    const entry = { id: `${now}-${Math.random()}`, text: `${new Date(now).toLocaleTimeString()} ${message}` }
    this.setData({ logs: [entry, ...this.data.logs].slice(0, 20) })
  },

  async prepare() {
    try {
      // 专用目录只存本验证生成的文件；先释放播放器再清理上次残留。
      this.audio.stop()
      await fileOperation('mkdir', { dirPath: directory, recursive: true })
      await this.cleanFiles()
      this.setData({ ready: true, status: '就绪：请选择时长并生成' })
    } catch (error) {
      this.setData({ status: '文件目录准备失败' })
      this.log(JSON.stringify(error))
    }
  },

  async cleanFiles() {
    const { files } = await fileOperation('readdir', { dirPath: directory })
    for (const name of files) {
      await fileOperation('unlink', { filePath: `${directory}/${name}` })
    }
    this.needsCleanup = false
    this.setData({ filePath: '' })
  },

  changeDuration(event) {
    this.setData({ durationIndex: Number(event.detail.value) })
  },

  async generateAndPlay() {
    if (this.data.busy || this.data.active || !this.data.ready) return
    this.setData({ busy: true })
    const seconds = this.data.durations[this.data.durationIndex].seconds
    const filePath = `${directory}/beat-${Date.now()}.wav`
    try {
      this.audio.stop()
      await this.cleanFiles()
      await fileOperation('writeFile', { filePath, data: createHeader(seconds) })
      this.setData({ filePath })
      for (let second = 0; second < seconds; second++) {
        await fileOperation('appendFile', { filePath, data: createSecond(second) })
        if (second % 10 === 0) this.setData({ status: `生成中：${second + 1}/${seconds} 秒，请保持前台` })
      }
      const info = await fileOperation('stat', { path: filePath })
      this.log(`WAV 已写入：${info.stats.size} 字节，${seconds} 秒`)
      this.audio.title = '节拍验证 · 120 BPM · 4/4'
      this.audio.singer = '本地前端生成'
      this.audio.epname = 'Metronome Probe'
      this.audio.startTime = 0
      this.audio.playbackRate = 1
      this.setData({ active: true, status: '已提交本地路径，等待播放器事件…' })
      this.log(`设置 BackgroundAudioManager.src = ${filePath}`)
      this.audio.src = filePath
    } catch (error) {
      this.setData({ active: false, status: '生成或提交失败' })
      this.log(JSON.stringify(error))
      this.audio.stop()
      try {
        await this.cleanFiles()
      } catch (cleanupError) {
        this.log(`清理失败：${JSON.stringify(cleanupError)}`)
      }
    } finally {
      this.setData({ busy: false })
    }
  },

  async stopAndClean() {
    if (this.data.busy || !this.data.ready) return
    this.setData({ busy: true })
    try {
      this.audio.stop()
      await this.cleanFiles()
      this.setData({ active: false, status: '已停止并清理本验证生成的文件' })
      this.log('文件清理完成')
    } catch (error) {
      this.log(`清理失败：${JSON.stringify(error)}`)
    } finally {
      this.setData({ busy: false })
    }
  }
})
