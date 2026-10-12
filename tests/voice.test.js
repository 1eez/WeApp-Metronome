const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SAMPLE_RATE, decodeSample } = require('../miniprogram/utils/wav')
const { words, createVoiceRenderer } = require('../miniprogram/utils/voice')

for (const directory of ['voice', 'voice/japanese']) {
  const samples = {}
  for (const word of words) {
    const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets', directory, `${word}.wav`))
    samples[word] = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  }

  test(`${directory}: bundled count words fit within a beat at 240 BPM with headroom`, () => {
    for (const word of words) {
      const sample = samples[word]
      assert.ok(sample.length > SAMPLE_RATE * 0.15)
      assert.ok(sample.length <= SAMPLE_RATE * 0.24)
      const peak = Math.max(...sample.map(Math.abs))
      assert.ok(peak > 0.8 && peak < 0.91)
    }
  })

  test(`${directory}: numbered beats follow the meter without drift or chunk gaps`, () => {
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

  test(`${directory}: accent changes only the gain of non-first beats`, () => {
    const plain = Buffer.from(createVoiceRenderer(120, 4, false, samples)(0))
    const accented = Buffer.from(createVoiceRenderer(120, 4, true, samples)(0))
    assert.deepEqual(accented.subarray(0, SAMPLE_RATE), plain.subarray(0, SAMPLE_RATE))
    const secondBeat = SAMPLE_RATE / 2
    for (let i = 0; i < samples.two.length; i++) {
      assert.equal(accented.readInt16LE((secondBeat + i) * 2), Math.round(samples.two[i] * 0.8 * 32767))
    }
  })
}
