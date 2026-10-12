const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SAMPLE_RATE, decodeSample } = require('../miniprogram/utils/wav')
const { words, createVoiceRenderer } = require('../miniprogram/utils/voice')

const samples = {}
for (const word of words) {
  const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets/voice', `${word}.wav`))
  samples[word] = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
}

test(`voice: bundled count words fit within a beat at 240 BPM with headroom`, () => {
  for (const word of words) {
    const sample = samples[word]
    assert.ok(sample.length > SAMPLE_RATE * 0.15)
    assert.ok(sample.length <= SAMPLE_RATE * 0.24)
    const peak = Math.max(...sample.map(Math.abs))
    assert.ok(peak > 0.8 && peak < 0.91)
  }
})

test(`voice: numbered beats follow the meter without drift or chunk gaps`, () => {
  for (const bpm of [40, 73, 137, 240]) {
    for (const beats of [2, 3, 4]) {
      const render = createVoiceRenderer(bpm, beats, false, samples)
      const seconds = 5
      const actual = Buffer.concat(Array.from({ length: seconds }, (_, second) => Buffer.from(render(second))))
      const expected = Buffer.alloc(actual.length)
      for (let beat = 0; beat < Math.ceil(seconds * bpm / 60); beat++) {
        const start = Math.round(beat * SAMPLE_RATE * 60 / bpm)
        const sample = samples[words[beat % beats]]
        for (let i = 0; i < sample.length && start + i < seconds * SAMPLE_RATE; i++) {
          expected.writeInt16LE(Math.round(sample[i] * 32767), (start + i) * 2)
        }
      }
      assert.deepEqual(actual, expected, `${bpm} BPM, ${beats}/4`)
    }
  }
})

test(`voice: accent changes only the gain of non-first beats`, () => {
  const plain = Buffer.from(createVoiceRenderer(120, 4, false, samples)(0))
  const accented = Buffer.from(createVoiceRenderer(120, 4, true, samples)(0))
  assert.deepEqual(accented.subarray(0, SAMPLE_RATE), plain.subarray(0, SAMPLE_RATE))
  const secondBeat = SAMPLE_RATE / 2
  for (let i = 0; i < samples.two.length; i++) {
    assert.equal(accented.readInt16LE((secondBeat + i) * 2), Math.round(samples.two[i] * 0.8 * 32767))
  }
})

test('female samples use the least shortened version that fits the selected BPM', () => {
  const { voiceDirectory } = require('../miniprogram/utils/voice')
  assert.equal(voiceDirectory('voice', 240), 'voice')
  for (const [bpm, speed] of [[40, 60], [60, 60], [61, 90], [90, 90], [91, 120], [120, 120], [121, 180], [180, 180], [181, 240], [240, 240]]) {
    assert.equal(voiceDirectory('voice-female', bpm), `voice/female/${speed}`)
    for (const word of words) {
      const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets', voiceDirectory('voice-female', bpm), `${word}.wav`))
      const sample = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
      assert.ok(sample.length > SAMPLE_RATE * 0.15)
      assert.ok(sample.length <= SAMPLE_RATE * 60 / bpm)
      assert.ok(Math.max(...sample.map(Math.abs)) < 0.91)
      assert.equal(sample[0], 0)
      assert.equal(sample[sample.length - 1], 0)
    }
  }
})

test('female voice keeps each numbered word across second and bar boundaries at every speed', () => {
  const { voiceDirectory } = require('../miniprogram/utils/voice')
  for (const bpm of [40, 60, 73, 120, 137, 180, 201, 240]) {
    const female = {}
    for (const word of words) {
      const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets', voiceDirectory('voice-female', bpm), `${word}.wav`))
      female[word] = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
    }
    for (const beats of [2, 3, 4]) {
      const render = createVoiceRenderer(bpm, beats, true, female)
      const actual = Buffer.concat(Array.from({ length: 5 }, (_, second) => Buffer.from(render(second))))
      const expected = Buffer.alloc(actual.length)
      for (let beat = 0; beat < Math.ceil(5 * bpm / 60); beat++) {
        const start = Math.round(beat * SAMPLE_RATE * 60 / bpm)
        const sample = female[words[beat % beats]]
        const gain = beat % beats ? 0.8 : 1
        for (let i = 0; i < sample.length && start + i < 5 * SAMPLE_RATE; i++) {
          expected.writeInt16LE(Math.round(sample[i] * gain * 32767), (start + i) * 2)
        }
      }
      assert.deepEqual(actual, expected, `${bpm} BPM, ${beats}/4`)
    }
  }
})
