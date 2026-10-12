const test = require('node:test')
const assert = require('node:assert/strict')
const { SAMPLE_RATE, createHeader, createSecond } = require('../miniprogram/utils/wav')

test('WAV header describes the complete mono 16-bit PCM payload', () => {
  for (const seconds of [60, 600]) {
    const header = Buffer.from(createHeader(seconds))
    assert.equal(header.toString('ascii', 0, 4), 'RIFF')
    assert.equal(header.toString('ascii', 8, 12), 'WAVE')
    assert.equal(header.readUInt32LE(4), 36 + seconds * SAMPLE_RATE * 2)
    assert.equal(header.readUInt16LE(20), 1)
    assert.equal(header.readUInt16LE(22), 1)
    assert.equal(header.readUInt32LE(24), SAMPLE_RATE)
    assert.equal(header.readUInt32LE(28), SAMPLE_RATE * 2)
    assert.equal(header.readUInt16LE(32), 2)
    assert.equal(header.readUInt16LE(34), 16)
    assert.equal(header.readUInt32LE(40), seconds * SAMPLE_RATE * 2)
  }
})

test('all 120 beats in one minute start 11025 samples apart across chunk boundaries', () => {
  const audio = Buffer.concat(Array.from({ length: 60 }, (_, second) => Buffer.from(createSecond(second))))
  const starts = []
  let silent = true
  for (let position = 0; position < audio.length / 2; position++) {
    const value = audio.readInt16LE(position * 2)
    if (silent && value !== 0) starts.push(position)
    // A click ends after 40 ms; internal sine zero crossings are not new clicks.
    if (value !== 0) silent = false
    if (position % 11025 > SAMPLE_RATE * 0.04) silent = true
    assert.ok(Math.abs(value) <= 32767)
  }
  assert.equal(starts.length, 120)
  starts.forEach((position, beat) => assert.equal(position, beat * 11025 + 1))
  assert.deepEqual(Buffer.from(createSecond(0)), Buffer.from(createSecond(598)))
  assert.deepEqual(Buffer.from(createSecond(1)), Buffer.from(createSecond(599)))
  assert.notDeepEqual(Buffer.from(createSecond(0)), Buffer.from(createSecond(1)))
})

test('arbitrary BPM uses rounded absolute positions without drift across seconds', () => {
  for (const bpm of [40, 73, 137, 240]) {
    const seconds = 60
    const audio = Buffer.concat(Array.from({ length: seconds }, (_, second) => Buffer.from(createSecond(second, { bpm }))))
    const starts = []
    let lastNonzero = -SAMPLE_RATE
    for (let position = 0; position < audio.length / 2; position++) {
      if (audio.readInt16LE(position * 2) !== 0) {
        if (position - lastNonzero > SAMPLE_RATE * 0.05) starts.push(position)
        lastNonzero = position
      }
    }
    assert.equal(starts.length, bpm)
    starts.forEach((position, beat) => assert.equal(position, Math.round(beat * SAMPLE_RATE * 60 / bpm) + 1))
  }
})

test('meter and accent determine strong beats and tone changes waveform', () => {
  const bpm = 120
  for (const beats of [2, 3, 4]) {
    const audio = Buffer.concat(Array.from({ length: 6 }, (_, second) => Buffer.from(createSecond(second, { bpm, beats }))))
    const normal = Buffer.from(createSecond(0, { accent: false })).subarray(2, 200)
    const strong = Buffer.from(createSecond(0)).subarray(2, 200)
    for (let beat = 0; beat < 12; beat++) {
      const start = (beat * 11025 + 1) * 2
      assert.deepEqual(audio.subarray(start, start + 198), beat % beats === 0 ? strong : normal)
    }
  }
  assert.notDeepEqual(Buffer.from(createSecond(0, { tone: 'soft' })), Buffer.from(createSecond(0)))
  const unaccented = Buffer.from(createSecond(0, { accent: false }))
  assert.deepEqual(unaccented.subarray(2, 200), unaccented.subarray(22052, 22250))
})
