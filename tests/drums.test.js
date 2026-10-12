const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SAMPLE_RATE } = require('../miniprogram/utils/wav')
const { kits, patterns, decodeSample, createDrumRenderer } = require('../miniprogram/utils/drums')

function loadKit(kit) {
  const samples = {}
  for (const [instrument, name] of Object.entries(kit.files)) {
    const file = fs.readFileSync(path.join(__dirname, '../miniprogram/assets/drums', `${name}.wav`))
    samples[instrument] = decodeSample(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  }
  return samples
}

test('all bundled kits and presets render safely at slow, fractional and fast beat lengths', () => {
  for (const kit of kits) {
    const samples = loadKit(kit)
    for (const sample of Object.values(samples)) {
      assert.ok(sample.length > 100)
      assert.ok(sample.every(value => Math.abs(value) <= 1))
    }
    for (const pattern of patterns) {
      for (const bpm of [40, 137, 240]) {
        const render = createDrumRenderer(bpm, pattern.id, samples)
        const chunks = Array.from({ length: 8 }, (_, second) => Buffer.from(render(second)))
        const audio = Buffer.concat(chunks)
        let peak = 0
        for (let i = 0; i < audio.length; i += 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(i)))
        assert.ok(peak > 1000)
        assert.ok(peak < 32767, `${kit.id}/${pattern.id}/${bpm} clipped`)
        // Rendering out of order must retain tails without hidden mutable state.
        assert.deepEqual(Buffer.from(render(4)), chunks[4])
      }
    }
  }
})

test('drum hits use absolute rounded positions and tails survive second/bar boundaries', () => {
  const bpm = 137
  // Deliberately long impulses expose overlap and tail loss at chunk and bar edges.
  const samples = {
    kick: Float32Array.from({ length: SAMPLE_RATE * 2 }, (_, i) => i === 0 ? 1 : 0.1),
    snare: new Float32Array(1), hat: new Float32Array(1)
  }
  const render = createDrumRenderer(bpm, 'basic', samples)
  const audio = Buffer.concat(Array.from({ length: 8 }, (_, second) => Buffer.from(render(second))))
  const baseline = audio.readInt16LE(2)
  const starts = []
  for (let position = 0; position < audio.length / 2; position++) {
    if (audio.readInt16LE(position * 2) > baseline * 5) starts.push(position)
  }
  const expected = Array.from({ length: Math.ceil(8 * bpm / 120) }, (_, hit) => Math.round(hit * 2 * SAMPLE_RATE * 60 / bpm)).filter(position => position < audio.length / 2)
  assert.deepEqual(starts, expected)
  for (const second of [1, 2, 3, 4, 5, 6, 7]) {
    assert.ok(audio.readInt16LE(second * SAMPLE_RATE * 2) > 0, `tail lost at ${second}s`)
  }
})
