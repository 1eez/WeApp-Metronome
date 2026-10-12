"""Prepare tim.kahn's countdown.wav (Freesound 82986, CC BY 4.0)."""
import argparse
import array
from pathlib import Path
import subprocess
import sys
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
args = parser.parse_args()
destination = Path(__file__).resolve().parents[1] / 'miniprogram/assets/voice/female'
# Reorder the countdown as one, two, three, four, matching the approved preview.
segments = [('one', 10.30, 10.88), ('two', 9.15, 9.70),
            ('three', 7.95, 8.95), ('four', 6.78, 7.60)]
for bpm in [60, 90, 120, 180, 240]:
    directory = destination / str(bpm)
    directory.mkdir(parents=True, exist_ok=True)
    duration = 60 / bpm * 0.96
    for name, start, end in segments:
        tempo = max(1, (end - start) / duration)
        pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(args.source),
            '-af', f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,atempo={tempo}',
            '-ac', '1', '-ar', '22050', '-f', 's16le', '-'])
        samples = array.array('h', pcm)
        if sys.byteorder != 'little':
            samples.byteswap()
        samples = samples[:int(duration * 22050)]
        # Fade both edges after stretching; keep the pitch and avoid abrupt cuts.
        fade = 110
        for i in range(fade):
            samples[i] = round(samples[i] * i / fade)
            samples[-1-i] = round(samples[-1-i] * i / fade)
        gain = 0.9 * 32767 / max(abs(value) for value in samples)
        samples = array.array('h', (round(value * gain) for value in samples))
        if sys.byteorder != 'little':
            samples.byteswap()
        with wave.open(str(directory / f'{name}.wav'), 'wb') as output:
            output.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
            output.writeframes(samples.tobytes())
