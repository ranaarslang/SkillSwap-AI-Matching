"""Direct matcher verification for the Skill Swap Platform with AI Matching.

Checks the ONNX MiniLM matcher end to end (no Django, no server):
  - embeddings are 384-dim and L2-normalized
  - same-topic cosine is high, different-topic cosine is low
  - seed-pair match scores (maya vs every candidate)

Usage:
  python matcher_test.py                 # fp32 model.onnx (default)
  python matcher_test.py --model qint8   # INT8 quantized model
  python matcher_test.py --model tfidf   # TF-IDF fallback path
"""
import argparse
import resource
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from swaps.matcher import (  # noqa: E402
    CandidateSkills,
    OnnxMiniLmMatcher,
    TfidfMatcher,
    get_matcher,
)

SEED = {
    "maya": (["Python", "Data Visualization"],
             ["Public Speaking", "UI Design"], "Lahore"),
    "leo": (["Video Editing", "Storytelling"],
            ["Python", "Product Design"], "Lahore"),
    "jonah": (["React", "TypeScript"],
              ["Photography", "Figma"], "Karachi"),
    "sana": (["UI Design", "Figma"], ["Video Editing"], "Islamabad"),
    "alex": (["Guitar", "Music Theory"], ["React"], "Karachi"),
    "priya": (["Public Speaking", "Content Writing"],
              ["Data Visualization"], "Lahore"),
}


def peak_rss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["fp32", "qint8", "tfidf"],
                        default="fp32")
    args = parser.parse_args()

    if args.model == "tfidf":
        matcher = TfidfMatcher()
        print("matcher: TF-IDF fallback")
    else:
        fname = ("model.onnx" if args.model == "fp32"
                 else "model_qint8_arm64.onnx")
        t0 = time.time()
        matcher = OnnxMiniLmMatcher(
            model_path=Path(__file__).resolve().parent / "ml_models" / fname)
        # Force load now so load time is measured honestly.
        matcher._ensure_loaded()
        print(f"matcher: ONNX {fname} (loaded in {time.time() - t0:.1f}s)")
        t0 = time.time()
        vecs = matcher.embed([
            "Python programming, data visualization",
            "Python programming, data analysis",
            "Guitar, music theory",
        ])
        print(f"embed: shape {vecs.shape} (expect (3, 384)), "
              f"embed time {time.time() - t0:.2f}s")
        assert vecs.shape == (3, 384), f"wrong dim: {vecs.shape}"
        import numpy as np
        norms = np.linalg.norm(vecs, axis=1)
        print(f"embed: L2 norms {norms.round(4).tolist()} (expect ~1.0)")
        same = float(np.dot(vecs[0], vecs[1]))
        diff = float(np.dot(vecs[0], vecs[2]))
        print(f"cosine same-topic (python/data-viz vs python/data-analysis): "
              f"{same:.3f} (expect ~0.85+)")
        print(f"cosine diff-topic (python/data-viz vs guitar/music): "
              f"{diff:.3f} (expect ~0.1 or below)")
        assert same >= 0.7, f"same-topic cosine too low: {same}"
        assert diff <= 0.2, f"diff-topic cosine too high: {diff}"

    maya_teach, maya_learn, maya_loc = SEED["maya"]
    me = CandidateSkills(user_id=1, username="maya",
                         teach_skills=maya_teach, learn_skills=maya_learn,
                         location=maya_loc)
    print("match scores for maya:")
    for name, (teach, learn, loc) in SEED.items():
        if name == "maya":
            continue
        cand = CandidateSkills(user_id=0, username=name,
                               teach_skills=teach, learn_skills=learn,
                               location=loc)
        r = matcher.score_pair(me, cand)
        print(f"  maya <-> {name}: {r.match_score} "
              f"(bonus {r.location_bonus}, same_location "
              f"{r.same_location}, can_teach_you {r.can_teach_you}, "
              f"you_can_teach_them {r.you_can_teach_them})")
    print(f"peak RSS: {peak_rss_mb():.0f} MB")
    print("MATCHER TEST OK")


if __name__ == "__main__":
    main()
