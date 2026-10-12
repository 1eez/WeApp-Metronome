"""Prepare the six bundled 99Sounds hits as mono 22,050 Hz / 16-bit PCM."""
import io
import math
from pathlib import Path
import struct
import sys
import wave
import zipfile

names = ['kick-acoustic01', 'snare-acoustic01', 'hihat-acoustic01',
         'kick-808', 'snare-808', 'hihat-808']
archive = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / '[99Sounds] 99 Drum Samples.zip'
destination = Path(__file__).resolve().parents[1] / 'miniprogram/assets/drums'
destination.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as source:
    for name in names:
        with wave.open(io.BytesIO(source.read(f'[99Sounds] 99 Drum Samples/Samples/{name}.wav'))) as audio:
            assert (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) == (1, 44100, 3)
            raw = audio.readframes(audio.getnframes())
        values = [int.from_bytes(raw[i:i + 3], 'little', signed=True) / 8388608 for i in range(0, len(raw), 3)]
        # Symmetric low-pass FIR before downsampling, preserving hit timing.
        radius = 16
        taps = []
        for i in range(-radius, radius + 1):
            taps.append((0.45 if i == 0 else math.sin(math.pi * 0.45 * i) / (math.pi * i)) * (0.54 + 0.46 * math.cos(math.pi * i / radius)))
        total = sum(taps)
        filtered = [sum(values[j] * taps[k + radius] / total for k in range(-radius, radius + 1) if 0 <= (j := i + k) < len(values)) for i in range(0, len(values), 2)]
        pcm = b''.join(struct.pack('<h', max(-32768, min(32767, round(value * 32767)))) for value in filtered)
        with wave.open(str(destination / f'{name}.wav'), 'wb') as output:
            output.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
            output.writeframes(pcm)
        print(f'{name}: {len(filtered)} samples, {len(pcm) + 44} bytes')
