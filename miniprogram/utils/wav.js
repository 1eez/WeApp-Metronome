const SAMPLE_RATE = 22050
const BPM = 120
const BYTES_PER_SAMPLE = 2

function createHeader(seconds) {
  const dataBytes = seconds * SAMPLE_RATE * BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(44)
  const view = new DataView(buffer)
  function text(offset, value) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  return buffer
}

// 每次只生成一秒；拍点由绝对采样位置决定，不依赖生成耗时。
function createSecond(second) {
  const buffer = new ArrayBuffer(SAMPLE_RATE * BYTES_PER_SAMPLE)
  const view = new DataView(buffer)
  const samplesPerBeat = SAMPLE_RATE * 60 / BPM
  for (let i = 0; i < SAMPLE_RATE; i++) {
    const position = second * SAMPLE_RATE + i
    const beat = Math.floor(position / samplesPerBeat)
    const time = (position - Math.round(beat * samplesPerBeat)) / SAMPLE_RATE
    let value = 0
    if (time >= 0 && time < 0.04) {
      const frequency = beat % 4 === 0 ? 1500 : 1000
      value = 0.65 * Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 130)
    }
    view.setInt16(i * BYTES_PER_SAMPLE, Math.round(value * 32767), true)
  }
  return buffer
}

module.exports = { SAMPLE_RATE, BPM, createHeader, createSecond }
