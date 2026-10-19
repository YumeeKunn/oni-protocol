#!/usr/bin/env python3
"""
DUST STRIKE — audio build pipeline.

Reads raw source recordings from tools/audio/sources/*.ogg|wav, finds clean
single-shot transients, trims/normalises them, encodes game-ready OGG Vorbis
into assets/audio/ and writes assets/audio/CREDITS.md.

Needs: gst-launch-1.0 (decode/encode). Pure-python DSP (no numpy).
"""
import math
import os
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'tools' / 'audio' / 'sources'
OUT = ROOT / 'assets' / 'audio'
RATE = 44100

# ─────────────────────────── audio helpers ───────────────────────────

def gst(*args):
    cmd = ['gst-launch-1.0', '-q', *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'gst failed: {r.stderr[-500:]}')


def decode(src: Path, dst: Path, mono=True):
    """Any audio file -> 16-bit PCM wav."""
    chans = 1 if mono else 2
    gst('filesrc', f'location={src}', '!', 'decodebin', '!', 'audioconvert', '!', 'audioresample', '!',
        'audio/x-raw,format=S16LE,rate=%d,channels=%d' % (RATE, chans), '!',
        'wavenc', '!', 'filesink', f'location={dst}')


def encode_ogg(src: Path, dst: Path, quality=0.55):
    gst('filesrc', f'location={src}', '!', 'wavparse', '!', 'audioconvert', '!', 'audioresample',
        '!', 'vorbisenc', f'quality={quality}', '!', 'oggmux', '!', 'filesink', f'location={dst}')


def read_wav(path: Path):
    with wave.open(str(path)) as w:
        n = w.getnframes()
        raw = w.readframes(n)
        d = struct.unpack('<%dh' % (n * w.getnchannels()), raw)
        if w.getnchannels() == 2:
            d = d[::2]
        return list(d)


def write_wav(path: Path, samples):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack('<%dh' % len(samples), *samples))


def envelope(samples, win=256):
    """peak envelope, one value per `win` samples"""
    out = []
    for i in range(0, len(samples) - win, win):
        m = 0
        for v in samples[i:i + win]:
            a = v if v >= 0 else -v
            if a > m:
                m = a
        out.append(m)
    return out


def find_onsets(samples, thresh_ratio=0.22, min_gap=0.32, win=256):
    """returns onset times (seconds) of sharp, well-separated transients"""
    env = envelope(samples, win)
    if not env:
        return []
    peak = max(env) or 1
    thr = peak * thresh_ratio
    onsets = []
    last = -1e9
    wsec = win / RATE
    for i in range(1, len(env)):
        t = i * wsec
        if env[i] > thr and env[i] > env[i - 1] * 1.6 and (t - last) > min_gap:
            onsets.append(round(t, 3))
            last = t
    return onsets


def tail_len(samples, start, peak, ratio=0.06, max_len=1.4):
    """how long the sound stays above `ratio*peak` after the transient"""
    i = start
    n = len(samples)
    limit = min(n, start + int(max_len * RATE))
    lastloud = start
    while i < limit:
        if abs(samples[i]) > peak * ratio:
            lastloud = i
        i += 32
    return (lastloud - start) / RATE


def low_ratio(samples, start, length, block=8):
    """crude low-frequency energy ratio — downsampled mean |x| vs |diff|.
    High diff energy => bright (rifle crack). Low diff energy => boomy (shotgun)."""
    end = min(len(samples), start + int(length * RATE))
    seg = samples[start:end]
    if len(seg) < block * 4:
        return 0
    s = 0.0
    d = 0.0
    n = 0
    for i in range(0, len(seg) - block, block):
        v = sum(seg[i:i + block]) / block
        s += abs(v)
        d += abs(seg[i + block] - seg[i])
        n += 1
    if n == 0 or d < 1e-3:
        return 1.0
    return (s / n) / ((s / n) + (d / n) + 1e-6)


def normalise(samples, target=0.92):
    peak = max((abs(v) for v in samples), default=0)
    if peak == 0:
        return samples
    k = (target * 32767) / peak
    return [max(-32768, min(32767, int(v * k))) for v in samples]


def fade(samples, fin=0.002, fout=0.07):
    n = len(samples)
    a = min(n // 2, int(fin * RATE))
    b = min(n // 2, int(fout * RATE))
    for i in range(a):
        samples[i] = int(samples[i] * (i / a))
    for i in range(b):
        samples[n - 1 - i] = int(samples[n - 1 - i] * (i / b))
    return samples


def slice_shot(src_samples, onset, length, pre=0.015):
    start = max(0, int((onset - pre) * RATE))
    end = min(len(src_samples), start + int(length * RATE))
    seg = src_samples[start:end]
    return fade(normalise(seg))


# ─────────────────────────── recipe ───────────────────────────
# each entry: source file -> list of (output name, picker)
# picker: 'loudest' | 'index:N' | 'longest' | 'brightest' | 'boomiest'

RECIPES = {
    'ak47_single.ogg': [
        ('rifle_fire_1.ogg', 'loudest', 1.05),
        ('rifle_fire_2.ogg', 'index:1', 0.95),
    ],
    'ak47_double.ogg': [
        ('rifle_fire_3.ogg', 'index:0', 0.95),
        ('smg_fire_1.ogg', 'index:1', 0.8),
    ],
    'gunshots8.ogg': [
        ('pistol_fire_1.ogg', 'index:0', 0.62),
        ('pistol_fire_2.ogg', 'index:2', 0.62),
        ('pistol_fire_3.ogg', 'index:4', 0.62),
        ('smg_fire_2.ogg', 'index:1', 0.55),
        ('smg_fire_3.ogg', 'index:3', 0.55),
    ],
    'puska.ogg': [
        ('sniper_fire_1.ogg', 'tailest', 1.5),
        ('sniper_fire_2.ogg', 'boomiest', 1.3),
        ('rifle_fire_4.ogg', 'index:40', 0.85),
    ],
    'war_cc0.ogg': [
        ('shotgun_fire_1.ogg', 'boomiest', 0.85),
        ('shotgun_fire_2.ogg', 'tailest', 0.8),
        ('war_ambience.ogg', '*loop', 0),
    ],
}

LICENSES = {
    'ak47_single.ogg': ('AK-47 (Kalasjnikov), een schot — Beeld en Geluid (SoundCloud)',
                        'CC BY-SA 3.0', 'https://commons.wikimedia.org/wiki/File:AK-47_(Kalasjnikov),_een_schot_-_SoundCloud_-_Beeld_en_Geluid.ogg'),
    'ak47_double.ogg': ('AK-47 (Kalasjnikov), twee schoten — Beeld en Geluid (SoundCloud)',
                        'CC BY-SA 3.0', 'https://commons.wikimedia.org/wiki/File:AK-47_(Kalasjnikov),_twee_schoten_-_SoundCloud_-_Beeld_en_Geluid.ogg'),
    'gunshots8.ogg': ('Gunshots 8', 'Public domain',
                      'https://commons.wikimedia.org/wiki/File:Gunshots_8.ogg'),
    'puska.ogg': ('Puška Puca (rifle firing, field recording)', 'CC BY-SA 4.0',
                  'https://commons.wikimedia.org/wiki/File:Pu%C5%A1ka_Puca.ogg'),
    'war_cc0.ogg': ('Dragout — War sounds', 'CC0',
                    'https://commons.wikimedia.org/wiki/File:Dragout_-_War_sounds_(cc0)_(freesound).ogg'),
    'gun_cock.ogg': ('Gun Cocking Slow — Mike Koenig (SoundBible)', 'CC BY 3.0',
                     'https://soundbible.com/2098-Gun-Cocking-Slow.html'),
}


def pick(samples, onsets, mode, default_end):
    """returns (onset_seconds, segment_length_seconds)"""
    if not onsets:
        return 0.0, default_end
    peak_positions = {}
    for t in onsets:
        i = int(t * RATE)
        seg = samples[i:i + int(0.12 * RATE)]
        p = max((abs(v) for v in seg), default=0)
        peak_positions[t] = p

    if mode == 'loudest':
        t = max(peak_positions, key=lambda k: peak_positions[k])
    elif mode == 'boomiest':
        t = max(onsets, key=lambda k: low_ratio(samples, int(k * RATE), 0.25))
    elif mode == 'brightest':
        t = min(onsets, key=lambda k: low_ratio(samples, int(k * RATE), 0.25))
    elif mode == 'tailest':
        scored = []
        for k in onsets:
            i = int(k * RATE)
            p = peak_positions[k]
            scored.append((tail_len(samples, i, p), k))
        t = max(scored)[1]
    elif mode.startswith('index:'):
        idx = int(mode.split(':')[1])
        t = onsets[min(idx, len(onsets) - 1)]
    else:
        t = onsets[0]
    return t, default_end


def make_loop(path: Path, samples, seconds=6.0):
    """pick the most energetic window → loop bed"""
    win = int(seconds * RATE)
    if len(samples) <= win:
        seg = samples
    else:
        best, bi = -1, 0
        step = RATE
        for i in range(0, len(samples) - win, step):
            e = sum(abs(v) for v in samples[i:i + win:512])
            if e > best:
                best, bi = e, i
        seg = samples[bi:bi + win]
    seg = normalise(seg, 0.55)
    # crossfade the seam so it loops cleanly
    xf = int(0.4 * RATE)
    for i in range(xf):
        k = i / xf
        seg[i] = int(seg[i] * k + seg[len(seg) - xf + i] * (1 - k))
    return seg[:-xf]


def main():
    if not SRC.exists():
        print('no sources dir:', SRC)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    work = OUT / '.work'
    work.mkdir(exist_ok=True)

    creds = []
    total = 0
    for name, jobs in RECIPES.items():
        src = SRC / name
        if not src.exists():
            print(f'  ! missing source {name}')
            continue
        wav = work / (src.stem + '.wav')
        decode(src, wav)
        samples = read_wav(wav)
        onsets = find_onsets(samples)
        print(f'  {name}: {len(samples)/RATE:.1f}s, {len(onsets)} onsets')

        for out_name, mode, length in jobs:
            if mode == '*loop':
                seg = make_loop(OUT / out_name, samples)
            else:
                onset, ln = pick(samples, onsets, mode, length)
                seg = slice_shot(samples, onset, ln)
            tmp = work / (out_name.replace('.ogg', '.wav'))
            write_wav(tmp, seg)
            encode_ogg(tmp, OUT / out_name)
            total += 1
            title, lic, url = LICENSES.get(name, ('unknown', 'unknown', ''))
            creds.append((out_name, title, lic, url, len(seg) / RATE))
            print(f'      -> {out_name:22} {len(seg)/RATE:5.2f}s   (from {mode})')

    # gun-cocking foley -> mech sounds (kept raw, just trimmed/normalised)
    cock = SRC / 'gun_cock.ogg'
    if cock.exists():
        wav = work / 'cock.wav'
        decode(cock, wav)
        s = read_wav(wav)
        onsets = find_onsets(s, thresh_ratio=0.15, min_gap=0.2)
        for i, t in enumerate(onsets[:4]):
            seg = slice_shot(s, t, 0.42)
            tmp = work / f'mech_{i}.wav'
            write_wav(tmp, seg)
            encode_ogg(tmp, OUT / f'mech_{i + 1}.ogg')
            total += 1
            print(f'      -> mech_{i + 1}.ogg           0.42s   (gun cock)')
            title, lic, url = LICENSES['gun_cock.ogg']
            creds.append((f'mech_{i + 1}.ogg', title, lic, url, 0.42))

    # ── credits ──
    lines = ['# Audio credits', '',
             'Real recorded weapon audio, trimmed + normalised by `tools/audio/build_audio.py`.', '']
    for out_name, title, lic, url, dur in creds:
        lines.append(f'## `{out_name}`  ({dur:.2f}s)')
        lines.append(f'- Source: {title}')
        lines.append(f'- License: {lic}')
        if url:
            lines.append(f'- Link: {url}')
        lines.append('')
    lines += [
        '## Procedural layers',
        '',
        'Impact, ricochet, footstep, reload-mechanics, explosion and ambience layers are',
        'synthesised at runtime in `src/core/audio.js` (WebAudio) and mixed under the',
        'recorded gunshots — crack sample + synth sub-thump + outdoor convolution tail.',
        '',
    ]
    (OUT / 'CREDITS.md').write_text('\n'.join(lines), encoding='utf-8')
    shutil.rmtree(work, ignore_errors=True)
    print(f'\n  {total} clips -> {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
