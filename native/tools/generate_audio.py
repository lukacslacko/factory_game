#!/usr/bin/env python3
"""Original MIT-licensed procedural Plant01 sounds; no samples or external assets.

Pure Python, deterministic PCM16 mono. --check verifies the committed bank rather
than changing it. Engine loops use band-limited harmonics and filtered seeded noise;
short smooth seam blends avoid discontinuities. These are stylized synthetic
industrial sounds, not recordings or physically accurate acoustic measurements.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct

RATE = 22050
ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'audio'
TAU = math.tau


def noise_sequence(n, seed, smoothing):
    rng = random.Random(seed)
    value = 0.0
    result = []
    for _ in range(n):
        value += smoothing * (rng.uniform(-1, 1) - value)
        result.append(value)
    return result


def loop_engine(fundamental, firing, grit, seed, pump=False):
    seconds = 3.0
    n = int(seconds * RATE)
    noise = noise_sequence(n, seed, grit)
    # Whole cycles before seam blending; no aliased square/saw oscillators.
    f = round(fundamental * seconds) / seconds
    p = round(firing * seconds) / seconds
    result = []
    for i in range(n):
        t = i / RATE
        modulation = .78 + .22 * math.sin(TAU * p * t)
        tone = .36 * math.sin(TAU * f * t)
        tone += .18 * math.sin(TAU * 2 * f * t + .30)
        tone += .10 * math.sin(TAU * 3 * f * t + .71)
        tone += .045 * math.sin(TAU * 5 * f * t + .15)
        rattle = noise[i] * (.55 if pump else .90) * modulation
        exhaust = .08 * math.sin(TAU * p * t) * (1 - .35 * math.sin(TAU * f * t))
        result.append(math.tanh((tone * modulation + rattle + exhaust) * 1.2) * .68)
    return seam(result)


def seam(samples):
    blend = 900
    result = samples[blend:]
    for i in range(blend):
        f = (i + 1) / blend
        # A smooth constant-gain seam avoids a volume bump in correlated tones.
        f = f * f * (3 - 2 * f)
        result[len(result) - blend + i] = samples[len(samples) - blend + i] * (1 - f) + samples[i] * f
    return result


def liquid(seed, fill):
    n = RATE * 2
    noise = noise_sequence(n, seed, .18)
    result = []
    for i in range(n):
        t = i / RATE
        burble = .55 + .45 * math.sin(TAU * (5.0 if fill else 7.5) * t) ** 2
        result.append((noise[i] * burble + .055 * math.sin(TAU * 180 * t) * math.sin(TAU * 4 * t)) * .8)
    return seam(result)


def impact(seed, kind):
    duration = {'footstep': .22, 'ratchet': .42, 'hammer': .26, 'slab': .48}[kind]
    n = int(duration * RATE)
    noise = noise_sequence(n, seed, .65 if kind == 'ratchet' else .36)
    result = []
    for i in range(n):
        t = i / RATE
        attack = min(1., t / .004)
        if kind == 'footstep':
            value = .55 * noise[i] * math.exp(-t * 23) + .24 * math.sin(TAU * 115 * t) * math.exp(-t * 34)
        elif kind == 'ratchet':
            clicks = (.5 + .5 * math.sin(TAU * 26 * t)) ** 14
            value = noise[i] * clicks * .65 * math.exp(-t * 6) + .06 * math.sin(TAU * 1500 * t) * math.exp(-t * 18)
        elif kind == 'hammer':
            value = .23 * noise[i] * math.exp(-t * 45) + (.21 * math.sin(TAU * 730 * t) + .12 * math.sin(TAU * 1193 * t)) * math.exp(-t * 18)
        else:
            value = .5 * noise[i] * math.exp(-t * 16) + .32 * math.sin(TAU * 74 * t) * math.exp(-t * 17) + .08 * math.sin(TAU * 440 * t) * math.exp(-t * 23)
        result.append(math.tanh(value * 1.2) * attack * min(1., (duration-t)/.02))
    return result


def signal_tone(kind):
    duration = .52 if kind == 'honk' else .46
    result = []
    for i in range(int(RATE * duration)):
        t = i / RATE
        if kind == 'honk':
            env = min(1., t / .04) * min(1., (duration-t)/.08)
            value = (.23 * math.sin(TAU * 327 * t) + .18 * math.sin(TAU * 415 * t) + .08 * math.sin(TAU * 654 * t) + .045 * math.sin(TAU * 830 * t)) * env
        else:
            notes = {'complete': (620, 930), 'delivery': (740, 620), 'warning': (390, 330)}[kind]
            value = 0.
            for index, frequency in enumerate(notes):
                age = t - index * .13
                if age >= 0:
                    envelope = min(1., age / .008) * math.exp(-age * 16)
                    value += (.23 * math.sin(TAU * frequency * age) + .035 * math.sin(TAU * 2 * frequency * age)) * envelope
            value *= min(1., (duration-t)/.03)
        result.append(value)
    return result


def wav(samples):
    pcm = b''.join(struct.pack('<h', max(-32767, min(32767, round(v * 32767)))) for v in samples)
    header = b'RIFF' + struct.pack('<I', 36+len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH',16,1,1,RATE,RATE*2,2,16) + b'data' + struct.pack('<I',len(pcm))
    return header + pcm


def build():
    bank = {}
    for name, f, pulse, grit, seed in [('excavator',43,10,.13,4101),('forklift',57,14,.18,4102),('truck',38,9,.11,4103),('bus',46,11,.07,4104),('shunter',28,7,.10,4105),('pump',88,16,.09,4106)]:
        bank['engine-'+name] = (loop_engine(f,pulse,grit,seed,name=='pump'), True)
    bank['can-fill'] = (liquid(4201,True),True)
    bank['can-pour'] = (liquid(4202,False),True)
    for name, seed, kind in [('footstep-a',4301,'footstep'),('footstep-b',4302,'footstep'),('ratchet',4303,'ratchet'),('hammer',4304,'hammer'),('slab-setdown',4305,'slab')]:
        bank[name] = (impact(seed,kind),False)
    for name in ['honk','complete','delivery','warning']:
        bank[name] = (signal_tone(name),False)
    metadata = {'license':'MIT','author':'Plant01 project contributors','origin':'Original deterministic procedural synthesis; no external recordings, samples, music, or third-party sound assets.','generator':'native/tools/generate_audio.py','format':'PCM16 little-endian mono WAV','sample_rate':RATE,'loop_seam':'900-sample smooth constant-gain crossfade','sounds':{}}
    files = {}
    for name, (samples, loop) in bank.items():
        data = wav(samples); files[name+'.wav'] = data
        metadata['sounds'][name] = {'file':name+'.wav','loop':loop,'frames':len(samples),'seconds':round(len(samples)/RATE,6),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    files['provenance.json'] = (json.dumps(metadata,indent=2)+'\n').encode()
    return files


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    args = parser.parse_args()
    files = build()
    ROOT.mkdir(parents=True,exist_ok=True)
    for filename, data in files.items():
        destination = ROOT / filename
        if args.check:
            if not destination.exists() or destination.read_bytes() != data:
                raise SystemExit('Generated audio differs: '+str(destination))
        else:
            destination.write_bytes(data)
    print(json.dumps({'verified' if args.check else 'generated':len(files)-1,'bytes':sum(map(len,files.values())),'license':'MIT','external_samples':False}))
