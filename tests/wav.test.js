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
