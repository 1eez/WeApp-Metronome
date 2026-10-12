"""Extract the four opening count-in words from the user-provided practice backing track."""
import argparse
import array
from pathlib import Path
import subprocess
import sys
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
args = parser.parse_args()
source = args.source
destination = Path(__file__).resolve().parents[1] / 'miniprogram/assets/voice'
# The source count-in is at 80 BPM; keep only the opening four words.
segments = [('one', 0.000, 0.240), ('two', 0.744, 0.980),
            ('three', 1.497, 1.757), ('four', 2.246, 2.513)]
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
