#!/usr/bin/env python
"""Download the all-MiniLM-L6-v2 ONNX model + tokenizer files.

Model: sentence-transformers/all-MiniLM-L6-v2 (384-dim embeddings).
NO torch, NO sentence-transformers package — ONNX Runtime only.

Files land in backend/ml_models/ (override with SKILLSWAP_MODEL_DIR).
Run once during setup so the first API request does not wait on a download,
and run it from the Render build command on deploy:

    python download_model.py          # fp32 model (90 MB) + tokenizer files
    python download_model.py --all    # also the 23 MB INT8 quantized model
                                      # (recommended for deploy: identical
                                      # match quality, much lower memory)

Existing non-empty files are skipped unless --force is given.
"""
import argparse
import os
import sys
import urllib.request
from pathlib import Path

BASE_URL = (
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"
    "/resolve/main"
)
MODEL_DIR = Path(
    os.environ.get(
        "SKILLSWAP_MODEL_DIR",
        Path(__file__).resolve().parent / "ml_models",
    )
)

FP32_MODEL = "onnx/model.onnx"
QUANTIZED_MODEL = "onnx/model_qint8_arm64.onnx"
TOKENIZER_FILES = [
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
    "special_tokens_map.json",
    "config.json",
]


def _download(rel_path, dest, force=False):
    if dest.exists() and dest.stat().st_size > 0 and not force:
        print(f"  exists, skipping: {dest.name} "
              f"({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    url = f"{BASE_URL}/{rel_path}"
    print(f"  downloading {url} ...")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        urllib.request.urlretrieve(url, tmp)
    except Exception as exc:  # noqa: BLE001
        if tmp.exists():
            tmp.unlink()
        print(f"  FAILED to download {url}: {exc}", file=sys.stderr)
        raise
    tmp.replace(dest)
    print(f"  saved {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
    return dest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all", action="store_true",
        help="Also download the INT8 quantized model (23 MB).")
    parser.add_argument(
        "--force", action="store_true",
        help="Re-download even if the files already exist.")
    args = parser.parse_args()

    print(f"Skill Swap Platform with AI Matching — model download")
    print(f"Target dir: {MODEL_DIR}")
    files = [FP32_MODEL] + TOKENIZER_FILES
    if args.all:
        files.append(QUANTIZED_MODEL)
    for rel in files:
        dest = MODEL_DIR / Path(rel).name
        _download(rel, dest, force=args.force)
    print("Done. Model files ready in", MODEL_DIR)


if __name__ == "__main__":
    main()
