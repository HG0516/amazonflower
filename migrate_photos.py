#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
아마존플라워 — 사진 폴더 구조 마이그레이션

실행 방법:
  1. 터미널 열기 (Spotlight에서 'Terminal')
  2. 아래 명령어 한 줄씩 복붙:
     cd /Users/hg/Desktop/아마존/files/amazonflower
     python3 migrate_photos.py

Mac은 한글 파일명을 자음·모음 분리해서 저장(NFD)하는데,
일반 쉘 스크립트로 한글 파일명 매칭이 어려워서 Python으로 짰어요.
"""

import os
import sys
import shutil
import unicodedata
from pathlib import Path


def normalize(s: str) -> str:
    """한글 파일명을 NFC(완성형)로 정규화. Mac NFD ↔ NFC 차이 흡수."""
    return unicodedata.normalize("NFC", s)


# 스크립트가 있는 폴더로 이동
SCRIPT_DIR = Path(__file__).resolve().parent
os.chdir(SCRIPT_DIR)

PHOTOS = SCRIPT_DIR / "photos"

# photos 폴더 없으면 생성
PHOTOS.mkdir(exist_ok=True)

print("아마존플라워 사진 폴더 구조 마이그레이션 시작\n")

# ─────────────────────────────────────────────────
# 1) 새 폴더 구조 생성
# ─────────────────────────────────────────────────
print("  [1/4] 새 폴더 생성")
new_dirs = [
    "hero",
    "화환/근조",
    "화환/축하",
    "특별제작",
    "안내",
]
for d in new_dirs:
    (PHOTOS / d).mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────
# 2) 이동 규칙 — (옛 이름) → (새 위치/이름)
# ─────────────────────────────────────────────────
RULES = {
    # hero (옛 꽃집 사진)
    "대표1.jpg": "hero/대표1.jpg",
    "대표2.jpg": "hero/대표2.jpg",
    "대표3.jpg": "hero/대표3.jpg",
    # 축하 화환
    "축하_일반형.jpg": "화환/축하/일반형.jpg",
    "축하_중급형.jpg": "화환/축하/중급형.jpg",
    "축하_고급형.jpg": "화환/축하/고급형.jpg",
    "축하_최고급형.jpg": "화환/축하/최고급형.jpg",
    # 근조 화환
    "근조_일반형.jpg": "화환/근조/일반형.jpg",
    "근조_중급형.jpg": "화환/근조/중급형.jpg",
    "근조_고급형.jpg": "화환/근조/고급형.jpg",
    "근조_최고급형.jpg": "화환/근조/최고급형.jpg",
    # 특별제작
    "결혼당일부케.jpg": "특별제작/부케_결혼당일.jpg",
    "촬영용부케.jpg": "특별제작/부케_촬영용.jpg",
    "근조바구니_기본.jpg": "특별제작/근조바구니_기본.jpg",
    "근조바구니_고급.jpg": "특별제작/근조바구니_고급.jpg",
    "제단장식.jpg": "특별제작/제단장식.jpg",
    "축하바구니.jpg": "특별제작/축하바구니.jpg",
    # 안내
    "리본_예시.jpg": "안내/리본_예시.jpg",
}

# ─────────────────────────────────────────────────
# 3) 실제 파일 이동 (NFC 정규화 매칭)
# ─────────────────────────────────────────────────
print("  [2/4] 기존 사진 이동")

# photos/ 바로 아래에 있는 파일 목록을 NFC 정규화한 dict으로 만듦
existing = {}
for entry in PHOTOS.iterdir():
    if entry.is_file():
        existing[normalize(entry.name)] = entry  # 실제 경로는 NFD일 수 있음

moved = 0
for old_name, new_rel in RULES.items():
    key = normalize(old_name)
    if key in existing:
        src = existing[key]
        dst = PHOTOS / new_rel
        if dst.exists():
            print(f"    ⊘ {old_name} → 이미 존재, 건너뜀")
            continue
        shutil.move(str(src), str(dst))
        print(f"    ✓ {old_name} → {new_rel}")
        moved += 1

if moved == 0:
    print("    (이동할 파일 없음 — 이미 정리되어 있거나 사진이 아직 없습니다)")

# ─────────────────────────────────────────────────
# 4) .DS_Store 정리
# ─────────────────────────────────────────────────
print("  [3/4] .DS_Store 정리")
ds_count = 0
for ds in PHOTOS.rglob(".DS_Store"):
    ds.unlink()
    ds_count += 1
if ds_count:
    print(f"    {ds_count}개 삭제")

# ─────────────────────────────────────────────────
# 5) 결과 출력
# ─────────────────────────────────────────────────
print("  [4/4] 결과 확인\n")
print("새 폴더 구조:")
for path in sorted(PHOTOS.rglob("*")):
    if path.name == ".DS_Store":
        continue
    rel = path.relative_to(PHOTOS)
    depth = len(rel.parts) - 1
    indent = "  " * depth
    if path.is_dir():
        print(f"  photos/{rel}/")
    else:
        size_kb = path.stat().st_size // 1024
        print(f"  photos/{rel}  ({size_kb} KB)")

print("\n✅ 마이그레이션 완료\n")
print("이제 새 사진은 아래 위치에 두면 자동으로 사이트에 반영됩니다:")
print("  photos/hero/         첫 화면 슬라이드 (가로 4:3 권장)")
print("  photos/화환/근조/    일반형.jpg / 중급형.jpg / 고급형.jpg / 최고급형.jpg")
print("  photos/화환/축하/    일반형.jpg / 중급형.jpg / 고급형.jpg / 최고급형.jpg")
print("  photos/특별제작/     부케_*.jpg / 근조바구니_*.jpg / 제단장식.jpg")
print("  photos/안내/         리본_예시.jpg")
