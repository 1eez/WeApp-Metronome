"""Prepare English or Japanese CC0 count samples listed in assets/voice/README.md."""
import argparse
import array
from pathlib import Path
import subprocess
import sys
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('--japanese', action='store_true')
args = parser.parse_args()
source = args.source
destination = Path(__file__).resolve().parents[1] / 'miniprogram/assets/voice'
# Use the final count; exclude the introductory "A One, A Two, A".
segments = [('one', 1.365, 1.775), ('two', 1.780, 2.080),
            ('three', 2.110, 2.390), ('four', 2.455, 2.790)]
if args.japanese:
    destination /= 'japanese'
    segments = [('one', 0.275, 0.615), ('two', 0.660, 1.005),
                ('three', 1.035, 1.355), ('four', 1.380, 1.730)]
destination.mkdir(parents=True, exist_ok=True)
for name, start, end in segments:
    # Keep pitch while shortening words to fit even the fastest supported beat (240 BPM).
    tempo = max(1, (end - start) / 0.235)
    filters = f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,atempo={tempo},afade=t=in:d=0.002,afade=t=out:st=0.230:d=0.005'
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source),
                                   '-af', filters, '-ac', '1', '-ar', '22050',
                                   '-f', 's16le', '-'])
    samples = array.array('h', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    # Normalize each word and limit the tail to 240 ms including a short fade.
    samples = samples[:5292]
    gain = 0.9 * 32767 / max(abs(value) for value in samples)
    samples = array.array('h', (round(value * gain) for value in samples))
    if sys.byteorder != 'little':
        samples.byteswap()
    with wave.open(str(destination / f'{name}.wav'), 'wb') as output:
        output.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        output.writeframes(samples.tobytes())
