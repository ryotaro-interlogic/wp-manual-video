"""deck.json のナレーション（各スライドの say）と marks.json から、手順動画（MP4）を作る。

  python3 make_video.py deck.json manual.pdf out.mp4 [--only 4,15] [--voice Kyoko] [--rate 185]

各スライドは全体表示で intro を読み、steps の n 番目は赤枠 n にズームして読む。
赤枠のないスライドで寄せたいときは say.zoom に [x, y, w, h]（インチ）を書く。
音声は macOS の say、字幕は画面下に表示する。読み方の言い換えは deck.json の "speak" に書く。
"""
import argparse
import hashlib
import json
import subprocess
import wave
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('deck')
ap.add_argument('pdf')
ap.add_argument('out')
ap.add_argument('--only')
ap.add_argument('--voice', default='Kyoko')
ap.add_argument('--rate', default='185')
a = ap.parse_args()

DECK = Path(a.deck).resolve()
WORK = DECK.parent / 'video_work'
SLIDES = WORK / 'slides'
AUDIO = WORK / 'audio'
for d in (SLIDES, AUDIO):
    d.mkdir(parents=True, exist_ok=True)

W, H, FPS = 1920, 1080, 30
SW, SH = 13.333, 7.5
RATE = 22050
GAP = 0.45
ZOOM_SEC = 0.7
FONT = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', 40)

deck = json.loads(DECK.read_text())
marks = json.loads((DECK.parent / 'marks.json').read_text())
SPEAK = list((deck.get('speak') or {}).items())
only = {int(x) for x in a.only.split(',')} if a.only else None

# スライド画像（高解像度）
doc = pymupdf.open(a.pdf)
if doc.page_count != len(deck['slides']):
    raise SystemExit(f'PDF のページ数 {doc.page_count} と deck.json のスライド数 {len(deck["slides"])} が違います。PDF を書き出し直してください。')
for i in range(doc.page_count):
    f = SLIDES / f's{i + 1:02d}.png'
    if not f.exists() or f.stat().st_mtime < Path(a.pdf).stat().st_mtime:
        doc[i].get_pixmap(dpi=288).save(f)


def speak_text(t):
    for x, y in SPEAK:
        t = t.replace(x, y)
    return t


def tts(text):
    key = hashlib.md5(f'{a.voice}{a.rate}{speak_text(text)}'.encode()).hexdigest()[:12]
    p = AUDIO / f'{key}.wav'
    if not p.exists():
        subprocess.run(['say', '-v', a.voice, '-r', a.rate, '--file-format=WAVE', f'--data-format=LEI16@{RATE}', '-o', str(p), speak_text(text)], check=True)
    with wave.open(str(p)) as w:
        return p, w.getnframes() / RATE


def zoom_box(r):
    x, y, w, h = r
    cx, cy = x + w / 2, y + h / 2
    vw = min(max(w * 1.9, h * 1.9 * 16 / 9, 5.2), SW)
    vh = vw * 9 / 16
    x0 = min(max(cx - vw / 2, 0), SW - vw)
    # 字幕に重ならないよう、赤枠が画面のやや上に来るようにする
    y0 = min(max(cy - vh * 0.42, 0), SH - vh)
    return (x0, y0, vw, vh)


FULL = (0, 0, SW, SH)
segs = []
for n, sl in enumerate(deck['slides'], start=1):
    if only and n not in only:
        continue
    say = sl.get('say') or {}
    segs.append(dict(slide=n, a=FULL, b=FULL, dur=0.5, cap=None, audio=None))
    for line in say.get('intro', []):
        p, d = tts(line)
        segs.append(dict(slide=n, a=FULL, b=FULL, dur=d + GAP, cap=line, audio=p))
    ms = sorted([m for m in marks if m['slide'] == n], key=lambda m: m['n'])
    boxes = [zoom_box((m['x'], m['y'], m['w'], m['h'])) for m in ms] or [zoom_box(z) for z in say.get('zoom', [])]
    cur = FULL
    for i, group in enumerate(say.get('steps', [])):
        target = boxes[i] if i < len(boxes) else FULL
        if target != cur:
            segs.append(dict(slide=n, a=cur, b=target, dur=ZOOM_SEC, cap=None, audio=None))
            cur = target
        for line in group:
            p, d = tts(line)
            segs.append(dict(slide=n, a=cur, b=cur, dur=d + GAP, cap=line, audio=p))
    if cur != FULL:
        segs.append(dict(slide=n, a=cur, b=FULL, dur=ZOOM_SEC, cap=None, audio=None))
    segs.append(dict(slide=n, a=FULL, b=FULL, dur=0.6, cap=None, audio=None))

frames = [round(s['dur'] * FPS) for s in segs]
wav = WORK / 'narration.wav'
with wave.open(str(wav), 'wb') as out:
    out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE)
    for s, f in zip(segs, frames):
        need = int(f / FPS * RATE)
        data = b''
        if s['audio']:
            with wave.open(str(s['audio'])) as w:
                data = w.readframes(w.getnframes())
        out.writeframes(data[:need * 2] + b'\x00\x00' * max(0, need - len(data) // 2))
print(f'{len(segs)} segments, {sum(frames) / FPS:.1f}s', flush=True)

cache = {}


def slide_img(n):
    if n not in cache:
        cache.clear()
        cache[n] = Image.open(SLIDES / f's{n:02d}.png').convert('RGB')
    return cache[n]


def render(n, box, fast):
    im = slide_img(n)
    k = im.width / SW
    x, y, w, h = box
    return im.crop((round(x * k), round(y * k), round((x + w) * k), round((y + h) * k))).resize((W, H), Image.BILINEAR if fast else Image.LANCZOS)


def caption(text):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if not text:
        return layer
    d = ImageDraw.Draw(layer)
    rows, row = [], ''
    for ch in text:
        if d.textlength(row + ch, font=FONT) > W - 240:
            rows.append(row); row = ch
        else:
            row += ch
    rows.append(row)
    lh, bh = 58, 58 * len(rows) + 36
    d.rounded_rectangle((90, H - bh - 40, W - 90, H - 40), radius=16, fill=(15, 23, 42, 205))
    for i, r in enumerate(rows):
        d.text(((W - d.textlength(r, font=FONT)) / 2, H - bh - 22 + i * lh), r, font=FONT, fill=(255, 255, 255, 255))
    return layer


ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-i', str(wav), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
                       '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)
for s, f in zip(segs, frames):
    if s['a'] == s['b']:
        img = Image.alpha_composite(render(s['slide'], s['a'], False).convert('RGBA'), caption(s['cap'])).convert('RGB').tobytes()
        for _ in range(f):
            ff.stdin.write(img)
    else:
        for i in range(f):
            t = (i + 1) / f
            t = t * t * (3 - 2 * t)
            ff.stdin.write(render(s['slide'], tuple(p + (q - p) * t for p, q in zip(s['a'], s['b'])), True).tobytes())
ff.stdin.close()
ff.wait()
print('wrote', a.out)
