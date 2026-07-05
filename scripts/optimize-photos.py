# -*- coding: utf-8 -*-
# scripts/optimize-photos.py
# build-products.mjs 가 만든 photo-manifest.json 을 읽어 완성 사진을 웹용으로 최적화 복사한다.
# - 긴 변 1400px 이하로 리사이즈(업스케일 안 함), EXIF 회전 보정, JPEG q85, sRGB
# - 대상: photos/products/{pc}_{n}.jpg  (기존 파일은 덮어씀)
# 실행: python scripts/optimize-photos.py
import json, os, sys
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "photo-manifest.json")
MAXPX = 1400
Q = 85

if not os.path.exists(MANIFEST):
    print("photo-manifest.json 없음 — 먼저 node scripts/build-products.mjs 실행"); sys.exit(1)

items = json.load(open(MANIFEST, encoding="utf-8"))
outdir = os.path.join(ROOT, "photos", "products")
os.makedirs(outdir, exist_ok=True)

ok = skip = err = 0
for it in items:
    src = it["src"]; dest = os.path.join(ROOT, it["dest"].replace("/", os.sep))
    try:
        im = Image.open(src)
        im = ImageOps.exif_transpose(im)          # EXIF 회전 보정
        im = im.convert("RGB")
        w, h = im.size
        if max(w, h) > MAXPX:                      # 축소만, 확대 안 함
            im.thumbnail((MAXPX, MAXPX), Image.LANCZOS)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        im.save(dest, "JPEG", quality=Q, optimize=True, progressive=True)
        ok += 1
    except Exception as e:
        print(f"  [실패] {os.path.basename(src)} -> {it['dest']}: {e}"); err += 1

print(f"완료: {ok}장 최적화 / 실패 {err} / 대상 {len(items)}장 → photos/products/")
