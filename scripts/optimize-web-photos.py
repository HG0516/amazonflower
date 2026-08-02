# -*- coding: utf-8 -*-
# scripts/optimize-web-photos.py
# 저장소에 이미 들어와 있는 웹 사진을 제자리에서 최적화한다.
#
# optimize-photos.py 와 다른 점:
#   저쪽은 아버지 PC의 원본 폴더 + photo-manifest.json 이 있어야 돌아간다(빌드 파이프라인용).
#   이쪽은 원본 폴더 없이, 이미 커밋된 photos/ 를 직접 줄인다. 맥에서도 돌아간다.
#
# 기준: 긴 변 1200px(축소만, 확대 안 함) · JPEG q82 · progressive · EXIF 회전 보정 · 메타데이터 제거
#   화면에서 가장 크게 쓰이는 곳이 상세창(폭 480px 안팎)이라 고해상도 기기(3배)를 감안해도 1200px 이면 충분하다.
#   리본 글자가 이 사진들에서 가장 미세한 요소인데 q82 에서 또렷하게 남는 것을 눈으로 확인했다.
#
# 실행: python3 scripts/optimize-web-photos.py           (실제 적용)
#       python3 scripts/optimize-web-photos.py --dry-run (측정만, 파일 안 건드림)
import os
import sys
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET_DIRS = ["photos"]
MAXPX = 1200
Q = 82
DRY = "--dry-run" in sys.argv

# 이미 충분히 작은 파일은 다시 인코딩하지 않는다 — 매번 재압축하면 화질만 깎인다.
SKIP_UNDER_BYTES = 120 * 1024


def iter_jpgs():
    for d in TARGET_DIRS:
        base = os.path.join(ROOT, d)
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in filenames:
                if fn.lower().endswith((".jpg", ".jpeg")):
                    yield os.path.join(dirpath, fn)


def main():
    before = after = 0
    done = skipped = failed = 0
    for path in sorted(iter_jpgs()):
        size = os.path.getsize(path)
        before += size
        if size < SKIP_UNDER_BYTES:
            after += size
            skipped += 1
            continue
        try:
            im = Image.open(path)
            im = ImageOps.exif_transpose(im).convert("RGB")
            if max(im.size) > MAXPX:
                im.thumbnail((MAXPX, MAXPX), Image.LANCZOS)
            if DRY:
                import io
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=Q, optimize=True, progressive=True)
                after += buf.tell()
            else:
                im.save(path, "JPEG", quality=Q, optimize=True, progressive=True)
                after += os.path.getsize(path)
            done += 1
        except Exception as e:
            print(f"  [실패] {os.path.relpath(path, ROOT)}: {e}")
            after += size
            failed += 1

    mb = lambda n: n / 1024 / 1024
    tag = "[측정만] " if DRY else ""
    print(f"{tag}최적화 {done}장 · 건너뜀 {skipped}장(이미 작음) · 실패 {failed}장")
    print(f"{tag}{mb(before):.1f}MB → {mb(after):.1f}MB  ({(1 - after / before) * 100:.0f}% 감소)")
    if not DRY:
        print("service-worker.js 의 VERSION 을 올려야 손님 브라우저가 새 사진을 받습니다.")


if __name__ == "__main__":
    main()
