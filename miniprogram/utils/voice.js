const { SAMPLE_RATE } = require('./wav')

const words = ['one', 'two', 'three', 'four']

function voiceDirectory(tone, bpm) {
  if (tone !== 'voice-female') return 'voice'
  const speed = [60, 90, 120, 180, 240].find(value => value >= bpm)
  return `voice/female/${speed}`
}

function createVoiceRenderer(bpm, beats, accent, samples) {
  const samplesPerBeat = SAMPLE_RATE * 60 / bpm
  return second => {
    const buffer = new ArrayBuffer(SAMPLE_RATE * 2)
    const view = new DataView(buffer)
    for (let i = 0; i < SAMPLE_RATE; i++) {
      const position = second * SAMPLE_RATE + i
      const beat = Math.floor((position + 0.5) / samplesPerBeat)
      const offset = position - Math.round(beat * samplesPerBeat)
      const sample = samples[words[beat % beats]]
      const gain = accent && beat % beats !== 0 ? 0.8 : 1
      const value = offset >= 0 && offset < sample.length ? sample[offset] * gain : 0
      view.setInt16(i * 2, Math.round(value * 32767), true)
    }
    return buffer
  }
}

module.exports = { words, voiceDirectory, createVoiceRenderer }
