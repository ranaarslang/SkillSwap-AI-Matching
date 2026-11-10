"""Matching for the Skill Swap Platform with AI Matching (SDD section 5).

REAL MACHINE LEARNING (default)
-------------------------------
``OnnxMiniLmMatcher`` — the actual sentence-transformers/all-MiniLM-L6-v2
model (384-dim embeddings) run via ONNX Runtime. NO torch, NO
sentence-transformers package. Pipeline, exactly as specified:

    AutoTokenizer -> onnxruntime InferenceSession (CPU provider)
    -> last hidden state -> mean pooling weighted by attention_mask
    -> L2 normalize -> 384-dim vectors -> cosine similarity

Score (SDD section 5): consolidate each user's TEACH tags into one text
and LEARN tags into one text, then
  score = average of cosine(my TEACH vs their LEARN) and
          cosine(their TEACH vs my LEARN), as a percentage 0-100;
drop everything below 50%; sort descending; additive location bonus +5
for the same city (case-insensitive), capped at 100.

Model files live in backend/ml_models/ (override with SKILLSWAP_MODEL_DIR)
and are downloaded once by backend/download_model.py (run it during setup
and from the Render build command). If the model file is missing at first
use it is downloaded on demand with a clear log line; if it cannot be
downloaded/loaded at all, the matcher falls back to TF-IDF + cosine with a
logged warning — TF-IDF is ONLY a fallback, never the default when the
model is available.

INTERFACE (swappable — the vectoriser is a one-module change)
------------------------------------------------------------
``get_matcher()`` returns the configured matcher. Every matcher implements::

    score_pair(me, candidate) -> MatchResult
    rank_candidates(me, candidates) -> list[(candidate, MatchResult)] (desc)

where ``me`` / ``candidate`` are :class:`CandidateSkills` (plain skill lists
+ location, no Django objects) and :class:`MatchResult` carries the score
plus the human-readable reasons (``can_teach_you`` /
``you_can_teach_them``). Views, serializers and endpoints only ever talk to
this interface, so swapping the vectoriser never touches them.
``SKILLSWAP_MATCHER`` env var selects the backend: "onnx" (default) or
"tfidf" (force the fallback, e.g. for offline testing).
"""
import logging
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

LOCATION_BONUS = 5
MATCH_THRESHOLD = 50
EMBEDDING_DIM = 384

MODEL_DIR = Path(
    os.environ.get(
        "SKILLSWAP_MODEL_DIR",
        Path(__file__).resolve().parent.parent / "ml_models",
    )
)
FP32_MODEL_FILE = "model.onnx"
QUANTIZED_MODEL_FILE = "model_qint8_arm64.onnx"
HF_REPO_URL = (
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"
    "/resolve/main"
)


@dataclass
class CandidateSkills:
    """Plain input to a matcher — no Django objects, easy to swap backends."""

    user_id: int
    username: str
    teach_skills: list = field(default_factory=list)
    learn_skills: list = field(default_factory=list)
    location: str = ""


@dataclass
class MatchResult:
    match_score: int
    location_bonus: int
    same_location: bool
    can_teach_you: list
    you_can_teach_them: list

    def as_dict(self):
        return {
            "match_score": self.match_score,
            "location_bonus": self.location_bonus,
            "same_location": self.same_location,
            "can_teach_you": list(self.can_teach_you),
            "you_can_teach_them": list(self.you_can_teach_them),
        }


class BaseMatcher:
    """Interface every matching backend must implement."""

    name = "base"

    def score_pair(self, me: CandidateSkills,
                   candidate: CandidateSkills) -> MatchResult:
        raise NotImplementedError

    def rank_candidates(self, me: CandidateSkills,
                        candidates: list) -> list:
        """Return [(candidate, MatchResult)] sorted by score desc."""
        scored = [(c, self.score_pair(me, c)) for c in candidates]
        scored.sort(key=lambda pair: (-pair[1].match_score,
                                      pair[0].username))
        return scored


def _norm_skill(skill):
    """'Data Visualization' -> 'data_visualization' (for exact overlap)."""
    return re.sub(r"[^a-z0-9]+", "_", str(skill).strip().lower()).strip("_")


def _skills_text(skills):
    """Consolidate a skill list into one text for embedding."""
    return ", ".join(str(s).strip() for s in skills if s and str(s).strip())


def _overlap(wanted, offered):
    """Exact skill intersection (case-insensitive); returns offered's names."""
    wanted_norm = {_norm_skill(s) for s in wanted}
    return [skill for skill in offered if _norm_skill(skill) in wanted_norm]


def _location_bonus(me_location, them_location):
    same = bool(
        me_location and them_location
        and me_location.strip().lower() == them_location.strip().lower()
    )
    return (LOCATION_BONUS if same else 0), same


def _result_from_base(base, me, candidate):
    bonus, same = _location_bonus(me.location, candidate.location)
    return MatchResult(
        match_score=min(100, round(base) + bonus),
        location_bonus=bonus,
        same_location=same,
        # Skills they can teach me: my LEARN ∩ their TEACH.
        can_teach_you=_overlap(me.learn_skills, candidate.teach_skills),
        # Skills I can teach them: my TEACH ∩ their LEARN.
        you_can_teach_them=_overlap(candidate.learn_skills,
                                    me.teach_skills),
    )


# ---------------------------------------------------------------- ONNX / MiniLM
def _download_file(url, dest):
    import urllib.request

    print(f"[matcher] downloading {url} -> {dest}")
    logger.warning("Downloading model file %s", url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dest)
    print(f"[matcher] saved {dest.name} "
          f"({dest.stat().st_size / 1e6:.1f} MB)")


def resolve_model_path(model_dir=None):
    """Return the model file to use, downloading it on first use if needed.

    Default: the 23 MB INT8 quantized file (``model_qint8_arm64.onnx``)
    when present — it measured IDENTICAL match quality to the 90 MB fp32
    file (same-topic cosine 0.783 vs 0.787, identical scores on all seed
    pairs) at much lower cost (peak RSS 132 MB vs 221 MB, 23 MB vs 90 MB
    on disk, faster load). The fp32 ``onnx/model.onnx`` is used when the
    quantized file is absent. ``SKILLSWAP_MODEL_FILE`` overrides the choice.
    Tokenizer files are expected in the same directory
    (download_model.py fetches them).
    """
    model_dir = Path(model_dir or MODEL_DIR)
    wanted = os.environ.get("SKILLSWAP_MODEL_FILE", "")
    candidates = []
    if wanted:
        candidates.append(wanted)
    candidates += [QUANTIZED_MODEL_FILE, FP32_MODEL_FILE]
    for name in candidates:
        path = model_dir / name
        if path.exists() and path.stat().st_size > 0:
            return path
    # Nothing on disk — download the fp32 model (plus tokenizer files).
    print("[matcher] model file not found locally; downloading "
          "all-MiniLM-L6-v2 ONNX model (one-time, ~90 MB) ...")
    logger.warning("Model file missing; downloading all-MiniLM-L6-v2 ONNX")
    _download_file(f"{HF_REPO_URL}/onnx/{FP32_MODEL_FILE}",
                   model_dir / FP32_MODEL_FILE)
    for fname in ("tokenizer.json", "tokenizer_config.json", "vocab.txt",
                  "special_tokens_map.json", "config.json"):
        dest = model_dir / fname
        if not (dest.exists() and dest.stat().st_size > 0):
            _download_file(f"{HF_REPO_URL}/{fname}", dest)
    return model_dir / FP32_MODEL_FILE


class OnnxMiniLmMatcher(BaseMatcher):
    """Real ML matcher: all-MiniLM-L6-v2 via ONNX Runtime (no torch)."""

    name = "onnx"

    def __init__(self, model_dir=None, model_path=None):
        self.model_dir = Path(model_dir or MODEL_DIR)
        self._model_path = Path(model_path) if model_path else None
        self._session = None
        self._tokenizer = None
        self.active_model_file = None

    def _ensure_loaded(self):
        if self._session is not None:
            return
        # Lazy imports: `manage.py check` / the TF-IDF fallback must work
        # even if onnxruntime/transformers are not installed.
        import onnxruntime as ort
        from transformers import AutoTokenizer

        model_path = self._model_path or resolve_model_path(self.model_dir)
        print(f"[matcher] loading ONNX model {model_path} ...")
        logger.info("Loading ONNX model %s", model_path)
        self._tokenizer = AutoTokenizer.from_pretrained(str(self.model_dir))
        self._session = ort.InferenceSession(
            str(model_path), providers=["CPUExecutionProvider"]
        )
        self.active_model_file = model_path.name
        print(f"[matcher] ONNX model loaded ({model_path.name}); "
              f"embedding dim {EMBEDDING_DIM}")

    def embed(self, texts):
        """Return L2-normalized 384-dim embeddings, shape (n, 384).

        Mean pooling over the last hidden state, weighted by attention_mask.
        Empty/blank texts map to the zero vector (cosine 0 with anything).
        """
        self._ensure_loaded()
        cleaned = [t if t and str(t).strip() else "" for t in texts]
        encoded = self._tokenizer(
            cleaned, padding=True, truncation=True, max_length=128,
            return_tensors="np",
        )
        inputs = {
            "input_ids": encoded["input_ids"],
            "attention_mask": encoded["attention_mask"],
        }
        if "token_type_ids" in encoded:
            inputs["token_type_ids"] = encoded["token_type_ids"]
        outputs = self._session.run(None, inputs)
        last_hidden = outputs[0]  # (batch, seq, 384)
        mask = encoded["attention_mask"].astype(np.float32)
        mask_expanded = mask[:, :, None]
        summed = (last_hidden * mask_expanded).sum(axis=1)
        counts = np.clip(mask_expanded.sum(axis=1), 1e-9, None)
        mean_pooled = summed / counts
        norms = np.linalg.norm(mean_pooled, axis=1, keepdims=True)
        norms = np.clip(norms, 1e-9, None)
        normalized = mean_pooled / norms
        # Zero out rows that came from blank texts.
        for i, text in enumerate(cleaned):
            if not text:
                normalized[i] = 0.0
        return normalized

    @staticmethod
    def _cosine(vec_a, vec_b):
        return float(np.dot(vec_a, vec_b))

    def score_pair(self, me, candidate):
        texts = [
            _skills_text(me.teach_skills),
            _skills_text(me.learn_skills),
            _skills_text(candidate.teach_skills),
            _skills_text(candidate.learn_skills),
        ]
        vectors = self.embed(texts)
        dir1 = self._cosine(vectors[0], vectors[3])  # my TEACH vs their LEARN
        dir2 = self._cosine(vectors[2], vectors[1])  # their TEACH vs my LEARN
        base = (dir1 + dir2) / 2 * 100
        return _result_from_base(base, me, candidate)


# ---------------------------------------------------------------- TF-IDF fallback
class TfidfMatcher(BaseMatcher):
    """Fallback ONLY: TF-IDF + cosine (scikit-learn).

    Used only when the ONNX model cannot be downloaded/loaded, or when
    SKILLSWAP_MATCHER=tfidf is set explicitly. Never the default when the
    model is available.
    """

    name = "tfidf"

    @staticmethod
    def _cosine(vectorizer, text_a, text_b):
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity

        if not text_a or not text_b:
            return 0.0
        matrix = vectorizer.transform([text_a, text_b])
        return float(cosine_similarity(matrix[0], matrix[1])[0][0])

    def score_pair(self, me, candidate):
        from sklearn.feature_extraction.text import TfidfVectorizer

        def norm(skill):
            return re.sub(r"[^a-z0-9]+", "_",
                          str(skill).strip().lower()).strip("_")

        def text(skills):
            return " ".join(norm(s) for s in skills if s and str(s).strip())

        my_teach, my_learn = text(me.teach_skills), text(me.learn_skills)
        their_teach = text(candidate.teach_skills)
        their_learn = text(candidate.learn_skills)
        texts = [t for t in (my_teach, my_learn, their_teach, their_learn)
                 if t]
        base = 0.0
        if texts:
            try:
                vectorizer = TfidfVectorizer(token_pattern=r"(?u)\b\w+\b")
                vectorizer.fit(texts)
                dir1 = self._cosine(vectorizer, my_teach, their_learn)
                dir2 = self._cosine(vectorizer, their_teach, my_learn)
                base = (dir1 + dir2) / 2 * 100
            except ValueError:
                base = 0.0
        return _result_from_base(base, me, candidate)


_MATCHERS = {
    "onnx": OnnxMiniLmMatcher,
    "tfidf": TfidfMatcher,
}

_fallback_warned = False
_matcher_instances = {}
# Guards first-use model loading: the dashboard fires /matches/ and
# /community/ in parallel, and two threads racing the lazy
# `from transformers import AutoTokenizer` could see a partially
# initialised module (ImportError) and permanently cache the TF-IDF
# fallback. The lock makes first load single-threaded; scores and the
# 50% threshold are unchanged.
_matcher_lock = threading.Lock()


def get_matcher(name=None):
    """Return the configured matcher instance (singleton per backend).

    ``SKILLSWAP_MATCHER`` env var (default "onnx") selects the backend.
    The instance is cached process-wide: the ONNX model loads once (~25s
    first use) and is reused for every later request. If the ONNX model
    cannot be loaded, fall back to TF-IDF with a logged warning — TF-IDF
    is never the default when the model is available.
    """
    global _fallback_warned
    key = (name or os.environ.get("SKILLSWAP_MATCHER", "onnx")).lower()
    if key in _matcher_instances:
        return _matcher_instances[key]
    with _matcher_lock:
        if key in _matcher_instances:
            return _matcher_instances[key]
        cls = _MATCHERS.get(key)
        if cls is None:
            raise ValueError(
                f"Unknown matcher {key!r}. Available: {sorted(_MATCHERS)}")
        matcher = cls()
        if key == "onnx":
            try:
                matcher._ensure_loaded()
            except Exception as exc:  # noqa: BLE001
                if not _fallback_warned:
                    print(f"[matcher] WARNING: ONNX model unavailable ({exc}); "
                          f"falling back to TF-IDF matching.")
                    logger.warning(
                        "ONNX model unavailable (%s); TF-IDF fallback active",
                        exc)
                    _fallback_warned = True
                matcher = TfidfMatcher()
        _matcher_instances[key] = matcher
        return matcher


def compute_match(me_teach, me_learn, them_teach, them_learn,
                  me_location="", them_location=""):
    """Backwards-compatible helper: score one pair with the default matcher.

    Returns the plain dict {match_score, location_bonus, same_location,
    can_teach_you, you_can_teach_them}. New code should use get_matcher().
    """
    me = CandidateSkills(user_id=0, username="",
                         teach_skills=list(me_teach),
                         learn_skills=list(me_learn),
                         location=me_location)
    them = CandidateSkills(user_id=0, username="",
                           teach_skills=list(them_teach),
                           learn_skills=list(them_learn),
                           location=them_location)
    return get_matcher().score_pair(me, them).as_dict()
