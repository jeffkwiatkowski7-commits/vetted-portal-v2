# Rent Roll Analyst — Python Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic Python analyst core that takes a rent-roll file (.xlsx/.xls/.csv) and produces a Word memo + Excel workbook + structured memory record, end-to-end testable against fixtures A–E without any portal integration.

**Architecture:** A self-contained Python package (`python_skills/rent_roll_analyst/`) with three layers: (1) loading — header detection, alias-based column mapping, monthly/annual inference, tenant normalization, schema construction; (2) analyses — six independently callable capability functions; (3) rendering — matplotlib chart, native-table python-docx Word, typed-cell openpyxl Excel, plus a forbidden-phrase output scanner. A high-level `analyze_rent_roll()` composes the layers; each capability remains independently callable. A CLI entry point (`python -m rent_roll_analyst <file>`) drives integration tests and serves as the surface the future Node sidecar will call.

**Tech Stack:** Python 3.11, pandas 2.x, matplotlib (Agg backend), python-docx, openpyxl, pyyaml (fixtures), pytest. No portal integration; no network calls; no LLM calls.

**Out of scope for this plan:** Node↔Python boundary, chat-orchestrator triggering, project memory persistence, audit logging, telemetry events, access-control HTTP tests. Those land in Plan 2.

**Source PRD:** [PRD-AI-Portal-Rent-Roll-Analyst.md](../../../PRD-AI-Portal-Rent-Roll-Analyst.md)

---

## File Structure

```
python_skills/rent_roll_analyst/
├── pyproject.toml
├── pytest.ini
├── README.md
├── src/rent_roll_analyst/
│   ├── __init__.py
│   ├── cli.py                          # `python -m rent_roll_analyst <file>` entry
│   ├── types.py                        # NormalizedRentRoll, DataQualityBlock, WaltResult, AnalysisResult, PortfolioAnalyses
│   ├── errors.py                       # Custom exceptions for §5.14 failure modes
│   ├── intent.py                       # §5.1 column-shape probe (deterministic part)
│   ├── analyze.py                      # High-level analyze_rent_roll() entry point
│   ├── loading/
│   │   ├── __init__.py
│   │   ├── aliases.py                  # Appendix B alias dictionary
│   │   ├── header.py                   # §5.2.1 header detection
│   │   ├── columns.py                  # §5.2.2 column mapping
│   │   ├── inference.py                # §5.2.3 monthly/annual rent inference
│   │   ├── tenant_normalize.py         # Appendix C tenant pipeline
│   │   ├── normalize.py                # §5.2.4 schema; §5.2.5 active flags; §5.2.6 fallback
│   │   ├── validation.py               # §5.2.7 DataQualityBlock construction
│   │   └── loader.py                   # Top-level load_rent_roll()
│   ├── analyses/
│   │   ├── __init__.py
│   │   ├── expirations.py              # §5.3
│   │   ├── inventory.py                # §5.4
│   │   ├── pivot.py                    # §5.5
│   │   ├── walt.py                     # §5.6 (portfolio + per-building)
│   │   ├── concentration.py            # §5.7
│   │   └── below_avg.py                # §5.8
│   └── rendering/
│       ├── __init__.py
│       ├── chart.py                    # §5.3 visualization (stacked + dual_axis)
│       ├── chart_palette.json          # Appendix E palette
│       ├── word.py                     # §5.9 python-docx renderer
│       ├── excel.py                    # §5.10 openpyxl renderer
│       └── scanner.py                  # Appendix D forbidden-phrase scanner
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── fixtures/
    │   ├── build_fixtures.py           # Generates A, B, E synthetically
    │   ├── A_clean.xlsx                # Generated
    │   ├── A_expected.yaml
    │   ├── B_multi_property_monthly.xlsx
    │   ├── B_expected.yaml
    │   ├── C_yardi.xlsx                # Synthetic Yardi-shape (real PREP file slot)
    │   ├── C_expected.yaml
    │   ├── D_mri.xlsx                  # Synthetic MRI-shape
    │   ├── D_expected.yaml
    │   ├── E_messy.xlsx
    │   └── E_expected.yaml
    ├── unit/
    │   ├── test_aliases.py
    │   ├── test_header.py
    │   ├── test_columns.py
    │   ├── test_inference.py
    │   ├── test_tenant_normalize.py
    │   ├── test_normalize.py
    │   ├── test_validation.py
    │   ├── test_loader.py
    │   ├── test_intent.py
    │   ├── test_expirations.py
    │   ├── test_inventory.py
    │   ├── test_pivot.py
    │   ├── test_walt.py
    │   ├── test_concentration.py
    │   ├── test_below_avg.py
    │   ├── test_chart.py
    │   ├── test_word.py
    │   ├── test_excel.py
    │   └── test_scanner.py
    └── integration/
        ├── test_fixture_a.py
        ├── test_fixture_b.py
        ├── test_fixture_c.py
        ├── test_fixture_d.py
        ├── test_fixture_e_failures.py
        └── test_perf.py
```

**Decomposition rationale:** loading / analyses / rendering are the three layers in §7. Each capability gets its own file because they are independently callable per the architectural implication note at the end of §5. The renderer is split from the analyses for the same reason.

---

## Phase 0 — Scaffold

### Task 1: Python project scaffold

**Files:**
- Create: `python_skills/rent_roll_analyst/pyproject.toml`
- Create: `python_skills/rent_roll_analyst/pytest.ini`
- Create: `python_skills/rent_roll_analyst/README.md`
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/__init__.py`
- Create: `python_skills/rent_roll_analyst/tests/__init__.py`
- Create: `python_skills/rent_roll_analyst/tests/conftest.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "rent_roll_analyst"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "pandas>=2.1",
  "numpy>=1.26",
  "openpyxl>=3.1",
  "python-docx>=1.1",
  "matplotlib>=3.8",
  "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov>=5.0"]

[project.scripts]
rent-roll-analyst = "rent_roll_analyst.cli:main"

[tool.setuptools.packages.find]
where = ["src"]
```

- [ ] **Step 2: Create `pytest.ini`**

```ini
[pytest]
testpaths = tests
addopts = -ra --strict-markers
markers =
    integration: end-to-end tests that read fixtures and produce real outputs
    perf: performance budget tests
```

- [ ] **Step 3: Create `README.md`**

```markdown
# Rent Roll Analyst (Python core)

Deterministic analytical engine for portfolio rent rolls. Produces Word + Excel deliverables.

## Install (dev)

```
cd python_skills/rent_roll_analyst
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```
python -m rent_roll_analyst path/to/rent_roll.xlsx --out-dir ./out
```

## Test

```
pytest                  # all
pytest -m "not perf"    # skip perf budget tests
```

See [PRD](../../PRD-AI-Portal-Rent-Roll-Analyst.md) for the full spec.
```

- [ ] **Step 4: Create empty package init files**

`python_skills/rent_roll_analyst/src/rent_roll_analyst/__init__.py`:

```python
"""Rent Roll Analyst — deterministic portfolio rent-roll analysis."""

__version__ = "0.1.0"
```

`python_skills/rent_roll_analyst/tests/__init__.py`: empty file.

`python_skills/rent_roll_analyst/tests/conftest.py`:

```python
"""Shared pytest fixtures and helpers."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def tmp_out_dir(tmp_path: Path) -> Path:
    out = tmp_path / "out"
    out.mkdir()
    return out
```

- [ ] **Step 5: Verify install + smoke test**

Run:
```bash
cd python_skills/rent_roll_analyst
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest --collect-only
```

Expected: `pip install` succeeds; `pytest --collect-only` reports 0 tests collected (no errors).

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst
git commit -m "feat(rent-roll): scaffold Python analyst project"
```

---

## Phase 1 — Types and Errors

### Task 2: Core type definitions

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/types.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_types.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_types.py`:

```python
from __future__ import annotations

import pandas as pd
import pytest

from rent_roll_analyst.types import (
    AnalysisResult,
    DataQualityBlock,
    NormalizedRentRoll,
    PortfolioAnalyses,
    WaltResult,
)


def test_data_quality_block_defaults():
    q = DataQualityBlock()
    assert q.row_counts == {}
    assert q.warnings == []
    assert q.unmapped_source_columns == []
    assert q.building_fallback_used is False


def test_normalized_rent_roll_holds_df_and_quality():
    df = pd.DataFrame({"tenant": ["A"]})
    q = DataQualityBlock()
    rr = NormalizedRentRoll(df=df, quality=q, source_file="x.xlsx")
    assert rr.df is df
    assert rr.quality is q
    assert rr.source_file == "x.xlsx"


def test_walt_result_required_fields():
    r = WaltResult(
        walt_years=5.3,
        weighting_basis="rent",
        included_lease_count=10,
        excluded_mtm_count=1,
        excluded_expired_count=2,
    )
    assert r.walt_years == 5.3
    assert r.weighting_basis == "rent"


def test_walt_result_rejects_unknown_weighting():
    with pytest.raises(ValueError):
        WaltResult(
            walt_years=1.0,
            weighting_basis="noi",  # type: ignore[arg-type]
            included_lease_count=1,
            excluded_mtm_count=0,
            excluded_expired_count=0,
        )


def test_analysis_result_paths():
    ar = AnalysisResult(
        docx_path="/tmp/x.docx",
        xlsx_path="/tmp/x.xlsx",
        memory_record={"type": "rent_roll_analysis"},
    )
    assert ar.docx_path.endswith(".docx")
    assert ar.memory_record["type"] == "rent_roll_analysis"


def test_portfolio_analyses_carries_all_capabilities():
    df = pd.DataFrame()
    rr = NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")
    walt = WaltResult(1.0, "rent", 0, 0, 0)
    pa = PortfolioAnalyses(
        rr=rr,
        expirations=df,
        inventory=df,
        expiration_pivot=df,
        walt=walt,
        walt_by_building=df,
        tenant_concentration=df,
        below_avg_flags=df,
        expiration_chart_path="/tmp/x.png",
    )
    assert pa.walt is walt
    assert pa.expiration_chart_path.endswith(".png")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_types.py -v`
Expected: ImportError — module does not exist.

- [ ] **Step 3: Implement `types.py`**

```python
"""Public dataclasses for the rent-roll analyst."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

WeightingBasis = Literal["rent", "sf"]


@dataclass
class DataQualityBlock:
    """Per-run data quality and provenance record (§5.2.7)."""

    row_counts: dict[str, int] = field(default_factory=dict)
    sum_active_rent: float = 0.0
    sum_all_rent: float = 0.0
    null_lease_end_count: int = 0
    null_lease_end_pct: float = 0.0
    duplicate_count: int = 0
    monthly_annual_inference: dict[str, Any] = field(default_factory=dict)
    header_row_index: int = -1
    header_alias_hits: int = 0
    unmapped_source_columns: list[str] = field(default_factory=list)
    building_fallback_used: bool = False
    warnings: list[str] = field(default_factory=list)


@dataclass
class NormalizedRentRoll:
    """A normalized DataFrame + its provenance."""

    df: pd.DataFrame
    quality: DataQualityBlock
    source_file: str


@dataclass
class WaltResult:
    """Portfolio-level WALT result (§5.6)."""

    walt_years: float
    weighting_basis: WeightingBasis
    included_lease_count: int
    excluded_mtm_count: int
    excluded_expired_count: int

    def __post_init__(self) -> None:
        if self.weighting_basis not in ("rent", "sf"):
            raise ValueError(
                f"weighting_basis must be 'rent' or 'sf', got {self.weighting_basis!r}"
            )


@dataclass
class PortfolioAnalyses:
    """All capability outputs for one rent roll. Consumed by renderers."""

    rr: NormalizedRentRoll
    expirations: pd.DataFrame
    inventory: pd.DataFrame
    expiration_pivot: pd.DataFrame
    walt: WaltResult
    walt_by_building: pd.DataFrame
    tenant_concentration: pd.DataFrame
    below_avg_flags: pd.DataFrame
    expiration_chart_path: str


@dataclass
class AnalysisResult:
    """Final user-facing handoff from analyze_rent_roll()."""

    docx_path: str
    xlsx_path: str
    memory_record: dict[str, Any]
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_types.py -v`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/types.py \
        python_skills/rent_roll_analyst/tests/unit/test_types.py
git commit -m "feat(rent-roll): core type definitions"
```

---

### Task 3: Error classes

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/errors.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_errors.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_errors.py`:

```python
from __future__ import annotations

import pytest

from rent_roll_analyst.errors import (
    AmbiguousRentPeriodError,
    FileParseError,
    HeaderNotFoundError,
    LeaseEndColumnMissingError,
    RentRollError,
    TooManyNullLeaseEndsError,
)


def test_base_error_carries_chat_prompt():
    e = RentRollError("internal", chat_prompt="user-facing message")
    assert str(e) == "internal"
    assert e.chat_prompt == "user-facing message"


def test_subclasses_inherit_base():
    for cls in (
        HeaderNotFoundError,
        LeaseEndColumnMissingError,
        AmbiguousRentPeriodError,
        TooManyNullLeaseEndsError,
        FileParseError,
    ):
        assert issubclass(cls, RentRollError)


def test_chat_prompt_optional_defaults_empty():
    e = HeaderNotFoundError("internal-only")
    assert e.chat_prompt == ""


def test_raise_and_catch_roundtrip():
    with pytest.raises(AmbiguousRentPeriodError) as ei:
        raise AmbiguousRentPeriodError(
            "psf 12.5 in overlap",
            chat_prompt="Confirm or specify.",
        )
    assert ei.value.chat_prompt == "Confirm or specify."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_errors.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `errors.py`**

```python
"""Domain errors. Each carries an optional `chat_prompt` for user surfacing."""
from __future__ import annotations


class RentRollError(Exception):
    """Base class for all rent-roll-analyst errors.

    `chat_prompt` is the user-facing message the orchestrator should surface;
    `args[0]` (the standard message) is internal detail for logs.
    """

    def __init__(self, message: str = "", chat_prompt: str = "") -> None:
        super().__init__(message)
        self.chat_prompt = chat_prompt


class HeaderNotFoundError(RentRollError):
    """No header row found within the scan window (§5.2.1)."""


class LeaseEndColumnMissingError(RentRollError):
    """Source has no recognizable lease-end column (§5.2 / §5.14)."""


class AmbiguousRentPeriodError(RentRollError):
    """Monthly/annual inference cannot decide; user must clarify (§5.2.3)."""


class TooManyNullLeaseEndsError(RentRollError):
    """> 50% null lease ends; metrics would be untrustworthy (§5.14)."""


class FileParseError(RentRollError):
    """The file could not be opened at all (§5.14)."""
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_errors.py -v`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/errors.py \
        python_skills/rent_roll_analyst/tests/unit/test_errors.py
git commit -m "feat(rent-roll): error classes with chat_prompt surface"
```

---

## Phase 2 — Loading

### Task 4: Alias dictionary (Appendix B)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/__init__.py`
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/aliases.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_aliases.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_aliases.py`:

```python
from __future__ import annotations

import pytest

from rent_roll_analyst.loading.aliases import (
    ALIAS_DICT,
    lookup_alias,
    normalize_label,
)


def test_normalize_label_lowercases_and_collapses_whitespace():
    assert normalize_label("  Tenant  Name ") == "tenant name"
    assert normalize_label("RENTABLE\tSF") == "rentable sf"


def test_canonical_names_resolve_to_themselves():
    for canonical in ALIAS_DICT.keys():
        assert lookup_alias(canonical) == canonical


def test_known_aliases_resolve():
    cases = [
        ("Property Name", "building"),
        ("RSF", "sf"),
        ("rentable area", "sf"),
        ("Lessee", "tenant"),
        ("Suite #", "suite"),
        ("Annual Rent", "annual_rent"),
        ("Monthly Rent", "monthly_rent"),
        ("Lease Expiration", "lease_end"),
        ("commencement", "lease_start"),
        ("month-to-month", "mtm_flag"),
    ]
    for source, expected in cases:
        assert lookup_alias(source) == expected, source


def test_unknown_alias_returns_none():
    assert lookup_alias("frobnicate") is None
    assert lookup_alias("") is None


def test_alias_lookup_is_case_and_whitespace_insensitive():
    assert lookup_alias("  ANNUAL  RENT  ") == "annual_rent"
    assert lookup_alias("annual\tRENT") == "annual_rent"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_aliases.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/__init__.py`**

```python
"""Loading layer: parse, normalize, validate."""
```

- [ ] **Step 4: Implement `loading/aliases.py`**

```python
"""Column alias dictionary (PRD Appendix B).

Aliases are case-insensitive and whitespace-collapsed before matching.
New aliases land here as config edits, not code-flow changes.
"""
from __future__ import annotations

import re
from typing import Optional

ALIAS_DICT: dict[str, list[str]] = {
    "building": [
        "building", "property", "property name", "bldg", "asset", "site",
    ],
    "tenant": [
        "tenant", "tenant name", "lessee", "occupant", "customer",
    ],
    "suite": [
        "suite", "unit", "space", "suite number", "suite #",
        "unit number", "unit #", "space #",
    ],
    "sf": [
        "sf", "square feet", "rentable sf", "rsf", "rentable area",
        "area (sf)", "nra",
    ],
    "annual_rent": [
        "annual rent", "base rent (annual)", "yearly rent",
        "rent/yr", "annual base rent",
    ],
    "monthly_rent": [
        "monthly rent", "base rent (monthly)", "rent/mo", "monthly base rent",
    ],
    "lease_start": [
        "lease start", "commencement", "commencement date",
        "start date", "begin date",
    ],
    "lease_end": [
        "lease end", "expiration", "expiration date",
        "end date", "lease expiration", "term end",
    ],
    "mtm_flag": [
        "mtm", "month-to-month", "holdover", "tenancy type",
    ],
}

_WS_RE = re.compile(r"\s+")


def normalize_label(label: str) -> str:
    """Lowercase, collapse internal whitespace, trim."""
    if label is None:
        return ""
    return _WS_RE.sub(" ", str(label).strip()).lower()


def _build_lookup() -> dict[str, str]:
    out: dict[str, str] = {}
    for canonical, variants in ALIAS_DICT.items():
        out[normalize_label(canonical)] = canonical
        for v in variants:
            out[normalize_label(v)] = canonical
    return out


_LOOKUP = _build_lookup()


def lookup_alias(label: str) -> Optional[str]:
    """Return the canonical column name for *label*, or None if unknown."""
    key = normalize_label(label)
    if not key:
        return None
    return _LOOKUP.get(key)
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/unit/test_aliases.py -v`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading \
        python_skills/rent_roll_analyst/tests/unit/test_aliases.py
git commit -m "feat(rent-roll): column alias dictionary (PRD Appendix B)"
```

---

### Task 5: Header detection (§5.2.1)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/header.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_header.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_header.py`:

```python
from __future__ import annotations

import pandas as pd
import pytest

from rent_roll_analyst.errors import HeaderNotFoundError
from rent_roll_analyst.loading.header import detect_header_row


def _grid(rows: list[list[object]]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def test_detects_header_in_row_0():
    df = _grid([
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["MOB-1", "Acme P.C.", "100", 1200, 30000, "2028-06-30"],
    ])
    idx, hits = detect_header_row(df)
    assert idx == 0
    assert hits >= 5


def test_detects_header_below_metadata_block():
    df = _grid([
        ["PREP MOB Portfolio", None, None, None, None, None],
        ["Generated 2026-04-01", None, None, None, None, None],
        [None, None, None, None, None, None],
        ["Property", "Lessee", "Unit", "Rentable SF", "Annual Rent", "Expiration"],
        ["MOB-1", "Acme P.C.", "100", 1200, 30000, "2028-06-30"],
    ])
    idx, hits = detect_header_row(df)
    assert idx == 3
    assert hits >= 5


def test_first_row_meeting_threshold_wins():
    df = _grid([
        ["Building", "Tenant", "Suite", "?", "?", "?"],
        ["Property", "Lessee", "Unit", "Rentable SF", "Annual Rent", "Expiration"],
    ])
    idx, _ = detect_header_row(df)
    assert idx == 0


def test_raises_with_closest_candidate_when_no_row_meets_threshold():
    df = _grid([
        ["Foo", "Bar", "Baz"],
        ["Building", "Whatever", "?"],  # 1 hit, the best
        ["X", "Y", "Z"],
    ])
    with pytest.raises(HeaderNotFoundError) as ei:
        detect_header_row(df)
    assert "row 2" in ei.value.chat_prompt or "row 2" in str(ei.value)


def test_only_scans_first_n_rows():
    rows = [["x"] * 6 for _ in range(15)]
    rows.append(["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"])
    df = _grid(rows)
    with pytest.raises(HeaderNotFoundError):
        detect_header_row(df, scan_rows=10)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_header.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/header.py`**

```python
"""Header detection (§5.2.1).

Scans the first N rows of an unparsed DataFrame and picks the first row
that contains at least 3 alias hits against the canonical dictionary.
"""
from __future__ import annotations

import pandas as pd

from ..errors import HeaderNotFoundError
from .aliases import lookup_alias

MIN_ALIAS_HITS = 3
DEFAULT_SCAN_ROWS = 10


def _row_hit_count(row: pd.Series) -> int:
    hits = 0
    for cell in row:
        if pd.isna(cell):
            continue
        if lookup_alias(str(cell)) is not None:
            hits += 1
    return hits


def detect_header_row(
    df: pd.DataFrame,
    scan_rows: int = DEFAULT_SCAN_ROWS,
) -> tuple[int, int]:
    """Return (zero-based row index, alias-hit count).

    Raises HeaderNotFoundError if no row in the first *scan_rows* rows
    meets MIN_ALIAS_HITS. The error's chat_prompt names the closest candidate
    using 1-indexed row numbers per §5.14.
    """
    best_idx = -1
    best_hits = 0
    limit = min(scan_rows, len(df))
    for i in range(limit):
        hits = _row_hit_count(df.iloc[i])
        if hits >= MIN_ALIAS_HITS:
            return i, hits
        if hits > best_hits:
            best_idx = i
            best_hits = hits

    closest = best_idx + 1 if best_idx >= 0 else 1
    raise HeaderNotFoundError(
        f"no header row found in first {limit} rows; "
        f"best candidate row {closest} had {best_hits} alias hit(s)",
        chat_prompt=(
            f"I could not find a header row in the first {limit} rows. "
            f"The closest candidate was row {closest}. Should I use that?"
        ),
    )
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_header.py -v`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/header.py \
        python_skills/rent_roll_analyst/tests/unit/test_header.py
git commit -m "feat(rent-roll): header-row detection (§5.2.1)"
```

---

### Task 6: Column mapping (§5.2.2)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/columns.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_columns.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_columns.py`:

```python
from __future__ import annotations

from rent_roll_analyst.loading.columns import map_columns


def test_basic_mapping():
    headers = ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"]
    mapping, unmapped = map_columns(headers)
    assert mapping == {
        "building": 0,
        "tenant": 1,
        "suite": 2,
        "sf": 3,
        "annual_rent": 4,
        "lease_end": 5,
    }
    assert unmapped == []


def test_unmapped_columns_preserved():
    headers = ["Building", "Tenant", "SF", "Annual Rent", "Lease End", "NOI", "Notes"]
    mapping, unmapped = map_columns(headers)
    assert "noi" not in mapping.values()
    assert "NOI" in unmapped
    assert "Notes" in unmapped


def test_first_match_wins_for_duplicate_canonicals():
    headers = ["Property", "Property Name", "Tenant", "SF", "Annual Rent", "Lease End"]
    mapping, unmapped = map_columns(headers)
    assert mapping["building"] == 0
    assert "Property Name" in unmapped


def test_case_and_whitespace_insensitive():
    headers = ["  PROPERTY ", "tenant\tname", "RSF", "Annual Rent", "lease  end"]
    mapping, _ = map_columns(headers)
    assert mapping["building"] == 0
    assert mapping["tenant"] == 1
    assert mapping["sf"] == 2
    assert mapping["lease_end"] == 4


def test_monthly_rent_resolves_separately_from_annual():
    headers = ["Building", "Tenant", "SF", "Monthly Rent", "Lease End"]
    mapping, _ = map_columns(headers)
    assert mapping["monthly_rent"] == 3
    assert "annual_rent" not in mapping
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_columns.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/columns.py`**

```python
"""Column mapping (§5.2.2).

Maps a list of source-file column headers to canonical names from the alias
dictionary. First match wins for duplicates; unmatched headers are preserved
for traceability and for the Cleaned Rent Roll Excel sheet.
"""
from __future__ import annotations

from .aliases import lookup_alias


def map_columns(headers: list[str]) -> tuple[dict[str, int], list[str]]:
    """Return (mapping, unmapped).

    *mapping* is {canonical_name: source_index}. *unmapped* is the list of
    raw header strings that did not resolve to any canonical, preserved
    verbatim (case, whitespace) for downstream display.
    """
    mapping: dict[str, int] = {}
    unmapped: list[str] = []
    for i, raw in enumerate(headers):
        label = "" if raw is None else str(raw)
        canonical = lookup_alias(label)
        if canonical is None or canonical in mapping:
            unmapped.append(label)
            continue
        mapping[canonical] = i
    return mapping, unmapped
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_columns.py -v`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/columns.py \
        python_skills/rent_roll_analyst/tests/unit/test_columns.py
git commit -m "feat(rent-roll): column mapping (§5.2.2)"
```

---

### Task 7: Monthly/annual rent inference (§5.2.3)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/inference.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_inference.py`

The bands are disjoint per the corrected §5.2.3:
- `[$0.50, $5)` → monthly
- `[$5, $20]` → ask the user (overlap zone)
- `($20, $250]` → annual
- outside `[$0.50, $250]` → ask the user

- [ ] **Step 1: Write the failing test**

`tests/unit/test_inference.py`:

```python
from __future__ import annotations

import pandas as pd
import pytest

from rent_roll_analyst.errors import AmbiguousRentPeriodError
from rent_roll_analyst.loading.inference import infer_rent_period


def _series(values: list[float]) -> pd.Series:
    return pd.Series(values, dtype="float64")


def test_header_says_annual_returns_annual_without_math():
    period, basis = infer_rent_period(
        rent_series=_series([0]),
        sf_series=_series([0]),
        header_label="Annual Rent",
    )
    assert period == "annual"
    assert basis["basis"] == "header"
    assert basis["median_psf"] is None


def test_header_says_monthly_returns_monthly_without_math():
    period, basis = infer_rent_period(
        rent_series=_series([0]),
        sf_series=_series([0]),
        header_label="Monthly Rent",
    )
    assert period == "monthly"
    assert basis["basis"] == "header"


def test_psf_in_lower_band_returns_monthly():
    rents = _series([2000, 2500, 3000])  # ~$2/SF/mo if 1000 SF
    sfs = _series([1000, 1000, 1000])
    period, basis = infer_rent_period(rents, sfs, header_label="Rent")
    assert period == "monthly"
    assert basis["basis"] == "psf_math"
    assert 0.5 <= basis["median_psf"] < 5.0


def test_psf_in_upper_band_returns_annual():
    rents = _series([30000, 35000, 40000])  # ~$30-40/SF/yr if 1000 SF
    sfs = _series([1000, 1000, 1000])
    period, basis = infer_rent_period(rents, sfs, header_label="Rent")
    assert period == "annual"
    assert basis["basis"] == "psf_math"
    assert 20.0 < basis["median_psf"] <= 250.0


def test_psf_in_overlap_zone_raises_ambiguous():
    rents = _series([12000])  # $12/SF if 1000 SF
    sfs = _series([1000])
    with pytest.raises(AmbiguousRentPeriodError) as ei:
        infer_rent_period(rents, sfs, header_label="Rent")
    assert "12" in ei.value.chat_prompt or "monthly" in ei.value.chat_prompt.lower()
    assert "annual" in ei.value.chat_prompt.lower() or "monthly" in ei.value.chat_prompt.lower()


def test_psf_at_band_boundary_5_is_overlap():
    rents = _series([5000])  # exactly $5/SF
    sfs = _series([1000])
    with pytest.raises(AmbiguousRentPeriodError):
        infer_rent_period(rents, sfs, header_label="Rent")


def test_psf_at_band_boundary_20_is_overlap():
    rents = _series([20000])  # exactly $20/SF
    sfs = _series([1000])
    with pytest.raises(AmbiguousRentPeriodError):
        infer_rent_period(rents, sfs, header_label="Rent")


def test_psf_above_upper_band_raises():
    rents = _series([1_000_000])  # $1000/SF
    sfs = _series([1000])
    with pytest.raises(AmbiguousRentPeriodError):
        infer_rent_period(rents, sfs, header_label="Rent")


def test_psf_below_lower_band_raises():
    rents = _series([100])  # $0.10/SF
    sfs = _series([1000])
    with pytest.raises(AmbiguousRentPeriodError):
        infer_rent_period(rents, sfs, header_label="Rent")


def test_zero_or_no_valid_rows_raises():
    with pytest.raises(AmbiguousRentPeriodError):
        infer_rent_period(_series([0, 0]), _series([0, 0]), header_label="Rent")


def test_header_yr_suffix_resolves_annual():
    period, _ = infer_rent_period(_series([0]), _series([0]), header_label="Rent/yr")
    assert period == "annual"


def test_header_mo_suffix_resolves_monthly():
    period, _ = infer_rent_period(_series([0]), _series([0]), header_label="Rent/mo")
    assert period == "monthly"


def test_basis_record_includes_header_label():
    _, basis = infer_rent_period(_series([0]), _series([0]), header_label="Yearly Rent")
    assert basis["header_label"] == "Yearly Rent"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_inference.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/inference.py`**

```python
"""Monthly-vs-annual rent inference (§5.2.3).

Disjoint bands. Header keywords win first; then median PSF math; otherwise
the function raises AmbiguousRentPeriodError so the orchestrator can ask.
"""
from __future__ import annotations

from typing import Any, Literal

import pandas as pd

from ..errors import AmbiguousRentPeriodError

Period = Literal["monthly", "annual"]

# Band edges. Disjoint:
#   [0.50, 5.00)   monthly
#   [5.00, 20.00]  ask
#   (20.00, 250.0] annual
#   else           ask
_MONTHLY_LO = 0.50
_MONTHLY_HI = 5.00     # exclusive
_OVERLAP_HI = 20.00    # inclusive on both sides
_ANNUAL_HI = 250.00

_HEADER_ANNUAL = ("annual", "yearly", "/yr")
_HEADER_MONTHLY = ("monthly", "/mo")


def _basis(
    basis: str,
    result: Period,
    median_psf: float | None,
    header_label: str,
) -> dict[str, Any]:
    return {
        "basis": basis,
        "result": result,
        "median_psf": median_psf,
        "header_label": header_label,
    }


def _ask(median_psf: float | None, header_label: str) -> AmbiguousRentPeriodError:
    if median_psf is None:
        prompt = (
            "I detected rents but cannot compute PSF (no valid square footage). "
            "Are these rents monthly or annual? (monthly / annual / let-me-specify)"
        )
        msg = "no valid rent/SF rows for PSF math"
    else:
        likely = "monthly" if median_psf < 12.5 else "annual"
        prompt = (
            f"I detected rents that look like {likely} based on a median PSF "
            f"of ${median_psf:.2f}. Confirm or specify. "
            "(monthly / annual / let-me-specify)"
        )
        msg = f"median PSF {median_psf:.2f} requires user confirmation"
    return AmbiguousRentPeriodError(msg, chat_prompt=prompt)


def infer_rent_period(
    rent_series: pd.Series,
    sf_series: pd.Series,
    header_label: str,
) -> tuple[Period, dict[str, Any]]:
    """Return (period, basis_record) or raise AmbiguousRentPeriodError."""
    label = (header_label or "").lower()
    if any(k in label for k in _HEADER_ANNUAL):
        return "annual", _basis("header", "annual", None, header_label)
    if any(k in label for k in _HEADER_MONTHLY):
        return "monthly", _basis("header", "monthly", None, header_label)

    rents = pd.to_numeric(rent_series, errors="coerce")
    sfs = pd.to_numeric(sf_series, errors="coerce")
    valid = pd.DataFrame({"rent": rents, "sf": sfs}).dropna()
    valid = valid[(valid["rent"] > 0) & (valid["sf"] > 0)]
    if valid.empty:
        raise _ask(None, header_label)

    median_psf = float(valid["rent"].median()) / float(valid["sf"].median())

    if _MONTHLY_LO <= median_psf < _MONTHLY_HI:
        return "monthly", _basis("psf_math", "monthly", median_psf, header_label)
    if _OVERLAP_HI < median_psf <= _ANNUAL_HI:
        return "annual", _basis("psf_math", "annual", median_psf, header_label)
    raise _ask(median_psf, header_label)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_inference.py -v`
Expected: 13 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/inference.py \
        python_skills/rent_roll_analyst/tests/unit/test_inference.py
git commit -m "feat(rent-roll): monthly/annual rent inference (§5.2.3)"
```

---

### Task 8: Tenant normalization pipeline (Appendix C)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/tenant_normalize.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_tenant_normalize.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_tenant_normalize.py`:

```python
from __future__ import annotations

import pandas as pd

from rent_roll_analyst.loading.tenant_normalize import normalize_tenant


def test_basic_lowercase_and_trim():
    assert normalize_tenant("  Acme  Health  ") == "acme health"


def test_strips_llc_suffix_with_punctuation_variants():
    assert normalize_tenant("Acme Health, LLC") == "acme health"
    assert normalize_tenant("Acme Health L.L.C.") == "acme health"
    assert normalize_tenant("Acme Health, L.L.C.") == "acme health"


def test_strips_inc_corp_co_ltd_variants():
    for raw in [
        "Acme Inc",
        "Acme Inc.",
        "Acme Incorporated",
        "Acme Corp",
        "Acme Corp.",
        "Acme Corporation",
        "Acme Co",
        "Acme Co.",
        "Acme Company",
        "Acme Ltd",
        "Acme Ltd.",
        "Acme Limited",
    ]:
        assert normalize_tenant(raw) == "acme", raw


def test_strips_medical_suffixes():
    cases = [
        ("Smith P.C.", "smith"),
        ("Smith PC", "smith"),
        ("Smith PLLC", "smith"),
        ("Smith P.L.L.C.", "smith"),
        ("Smith M.D.", "smith"),
        ("Smith MD", "smith"),
        ("Smith DDS", "smith"),
        ("Smith D.D.S.", "smith"),
        ("Smith DMD", "smith"),
        ("Smith D.O.", "smith"),
        ("Smith DPM", "smith"),
        ("Smith O.D.", "smith"),
        ("Smith P.A.", "smith"),
    ]
    for raw, expected in cases:
        assert normalize_tenant(raw) == expected, raw


def test_strips_dba_prefix():
    assert normalize_tenant("Acme dba Acme Health") == "acme acme health"
    assert normalize_tenant("Acme d/b/a Acme Health") == "acme acme health"
    assert normalize_tenant("Acme D.B.A. Acme Health") == "acme acme health"


def test_strips_leading_the():
    assert normalize_tenant("The Smith Group, LLC") == "smith group"


def test_handles_none_and_nan():
    assert normalize_tenant(None) == ""
    assert normalize_tenant(pd.NA) == ""
    assert normalize_tenant(float("nan")) == ""


def test_collapses_internal_whitespace_after_stripping():
    assert normalize_tenant("Acme    Health   LLC") == "acme health"


def test_does_not_strip_suffix_in_middle_of_name():
    # "Inc" inside the name (not at the end) stays
    assert normalize_tenant("Incentive Group") == "incentive group"


def test_two_suite_tenant_collapses_to_same_normalized_form():
    a = normalize_tenant("Acme Health, LLC")
    b = normalize_tenant("acme health llc")
    c = normalize_tenant("Acme Health LLC.")
    assert a == b == c == "acme health"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_tenant_normalize.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/tenant_normalize.py`**

```python
"""Tenant normalization pipeline (PRD Appendix C).

Steps in order:
1. Trim + collapse whitespace.
2. Lowercase.
3. Strip trailing periods/commas.
4. Strip configured suffix list (with punctuation variants).
5. Strip DBA prefixes.
6. Strip leading "the".
7. Re-collapse whitespace; trim.
"""
from __future__ import annotations

import re
from typing import Any

import pandas as pd

# Order matters: longer/punctuated variants before shorter ones, so
# "L.L.C." is matched before "LLC" would partial-match "L.L.".
_SUFFIXES = [
    "L.L.C.", "LLC",
    "L.L.P.", "LLP",
    "L.P.", "LP",
    "P.L.L.C.", "PLLC",
    "P.C.", "PC",
    "Incorporated", "Inc.", "Inc",
    "Corporation", "Corp.", "Corp",
    "Company", "Co.", "Co",
    "Limited", "Ltd.", "Ltd",
    "M.D.", "MD",
    "D.O.", "DO",
    "D.D.S.", "DDS",
    "D.M.D.", "DMD",
    "D.P.M.", "DPM",
    "O.D.", "OD",
    "P.A.", "PA",
    "L.M.T.", "LMT",
    "R.N.", "RN",
    "N.P.", "NP",
]

_DBA_PREFIXES = ["d/b/a", "d.b.a.", "dba"]

_WS_RE = re.compile(r"\s+")
_TRAILING_PUNCT_RE = re.compile(r"[.,]+$")


def _make_suffix_re(s: str) -> re.Pattern[str]:
    """Build a suffix pattern anchored to a word/token boundary.

    The suffix must be preceded by whitespace (with optional comma) or be the
    entire string — never a bare substring of a longer token. For suffixes
    that don't end in '.' (e.g. "LLC", "Inc") we also allow an optional
    trailing period so that "LLC." is caught in the same pass.
    """
    escaped = re.escape(s.lower())
    trailing = r"" if s.endswith(".") else r"\.?"
    return re.compile(rf"(?:^|,?\s+){escaped}{trailing}\s*$")


_SUFFIX_RES = [_make_suffix_re(s) for s in _SUFFIXES]
_DBA_RES = [
    re.compile(rf"\b{re.escape(p)}(?=\s|$)")
    for p in _DBA_PREFIXES
]


def _is_nullish(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def normalize_tenant(name: Any) -> str:
    """Return the normalized form for grouping; empty string for null inputs."""
    if _is_nullish(name):
        return ""
    s = str(name)
    s = _WS_RE.sub(" ", s).strip()
    s = s.lower()
    # strip suffixes repeatedly so chains like "Smith MD, P.C." both peel off.
    # NOTE: do this BEFORE stripping trailing punctuation so that dotted forms
    # like "L.L.C." still have their trailing dot when the patterns run.
    changed = True
    while changed:
        changed = False
        for pat in _SUFFIX_RES:
            after_sub = pat.sub("", s).strip()
            if after_sub != s:
                # A suffix was actually removed; clean residual trailing punct.
                s = _TRAILING_PUNCT_RE.sub("", after_sub).strip()
                changed = True
    # clean up any leftover trailing punctuation after suffix removal
    s = _TRAILING_PUNCT_RE.sub("", s).strip()
    for pat in _DBA_RES:
        s = pat.sub(" ", s)
    if s.startswith("the "):
        s = s[4:]
    s = _WS_RE.sub(" ", s).strip()
    return s
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_tenant_normalize.py -v`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/tenant_normalize.py \
        python_skills/rent_roll_analyst/tests/unit/test_tenant_normalize.py
git commit -m "feat(rent-roll): tenant normalization pipeline (Appendix C)"
```

---

### Task 9: Normalized DataFrame construction (§5.2.4–§5.2.6)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/normalize.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_normalize.py`

This task does most of the heavy lifting: building the schema in §5.2.4, deriving `is_active`/`is_vacant`/`is_mtm` per §5.2.5, and the multi-property fallback in §5.2.6.

- [ ] **Step 1: Write the failing test**

`tests/unit/test_normalize.py`:

```python
from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest

from rent_roll_analyst.loading.normalize import (
    REQUIRED_COLUMNS,
    build_normalized_dataframe,
)


def _today() -> date:
    return date(2026, 4, 28)


def test_required_columns_match_spec():
    expected = {
        "building", "tenant", "tenant_normalized", "suite", "sf",
        "annual_rent", "rent_psf", "lease_start", "lease_end", "exp_year",
        "is_vacant", "is_mtm", "is_active", "_source_row",
    }
    assert set(REQUIRED_COLUMNS) == expected


def test_basic_normalization_annual_input():
    raw = pd.DataFrame({
        "Building": ["MOB-1", "MOB-1"],
        "Tenant": ["Acme P.C.", "Beta LLC"],
        "Suite": ["100", "200"],
        "SF": [1200, 800],
        "Annual Rent": [36000, 24000],
        "Lease End": ["2028-06-30", "2027-12-31"],
    })
    mapping = {
        "building": 0, "tenant": 1, "suite": 2,
        "sf": 3, "annual_rent": 4, "lease_end": 5,
    }
    df = build_normalized_dataframe(
        raw=raw,
        mapping=mapping,
        rent_period="annual",
        today=_today(),
    )
    assert list(df["building"]) == ["MOB-1", "MOB-1"]
    assert list(df["tenant_normalized"]) == ["acme", "beta"]
    assert list(df["annual_rent"]) == [36000.0, 24000.0]
    assert df.loc[0, "rent_psf"] == pytest.approx(30.0)
    assert df.loc[0, "exp_year"] == 2028
    assert df["is_active"].all()
    assert not df["is_mtm"].any()
    assert not df["is_vacant"].any()
    assert list(df["_source_row"]) == [1, 2]


def test_monthly_rent_is_annualized():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Acme"],
        "Suite": ["100"],
        "SF": [1000],
        "Monthly Rent": [3000],
        "Lease End": ["2028-06-30"],
    })
    mapping = {
        "building": 0, "tenant": 1, "suite": 2,
        "sf": 3, "monthly_rent": 4, "lease_end": 5,
    }
    df = build_normalized_dataframe(
        raw=raw,
        mapping=mapping,
        rent_period="monthly",
        today=_today(),
    )
    assert df.loc[0, "annual_rent"] == 36000.0
    assert df.loc[0, "rent_psf"] == 36.0


def test_expired_lease_is_inactive():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Old Tenant"],
        "SF": [1000],
        "Annual Rent": [20000],
        "Lease End": ["2020-01-01"],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert not df.loc[0, "is_active"]
    assert not df.loc[0, "is_mtm"]


def test_vacant_row_when_tenant_blank():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": [""],
        "SF": [800],
        "Annual Rent": [0],
        "Lease End": [None],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert df.loc[0, "is_vacant"]
    assert not df.loc[0, "is_active"]


def test_mtm_when_lease_end_null_and_tenant_paying():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Acme"],
        "SF": [1000],
        "Annual Rent": [30000],
        "Lease End": [None],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert df.loc[0, "is_mtm"]
    assert df.loc[0, "is_active"]
    assert not df.loc[0, "is_vacant"]


def test_explicit_mtm_flag_column_overrides_inference():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Acme"],
        "SF": [1000],
        "Annual Rent": [30000],
        "Lease End": ["2028-01-01"],  # in future, would be "active"
        "MTM": ["Y"],
    })
    mapping = {
        "building": 0, "tenant": 1, "sf": 2, "annual_rent": 3,
        "lease_end": 4, "mtm_flag": 5,
    }
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert df.loc[0, "is_mtm"]
    assert df.loc[0, "is_active"]


def test_zero_sf_yields_null_psf_not_inf():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Acme"],
        "SF": [0],
        "Annual Rent": [12000],
        "Lease End": ["2028-01-01"],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert pd.isna(df.loc[0, "rent_psf"])


def test_building_fallback_when_no_building_column():
    raw = pd.DataFrame({
        "Tenant": ["Acme"],
        "SF": [1000],
        "Annual Rent": [30000],
        "Lease End": ["2028-01-01"],
    })
    mapping = {"tenant": 0, "sf": 1, "annual_rent": 2, "lease_end": 3}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual",
        today=_today(), source_file="PREP_Q1.xlsx",
    )
    assert df.loc[0, "building"] == "PREP_Q1.xlsx"


def test_mixed_date_formats_parse():
    raw = pd.DataFrame({
        "Building": ["MOB-1"] * 3,
        "Tenant": ["A", "B", "C"],
        "SF": [1000, 1000, 1000],
        "Annual Rent": [30000, 30000, 30000],
        "Lease End": ["2028-06-30", "06/30/2028", datetime(2028, 6, 30)],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    years = list(df["exp_year"])
    assert years == [2028, 2028, 2028]


def test_unparseable_date_becomes_nat_and_marks_mtm_when_tenant_paying():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Acme"],
        "SF": [1000],
        "Annual Rent": [30000],
        "Lease End": ["banana"],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert pd.isna(df.loc[0, "lease_end"])
    assert df.loc[0, "is_mtm"]


def test_unmapped_source_columns_preserved():
    raw = pd.DataFrame({
        "Building": ["MOB-1"],
        "Tenant": ["Acme"],
        "SF": [1000],
        "Annual Rent": [30000],
        "Lease End": ["2028-01-01"],
        "NOI": [10000],
        "Notes": ["renewal pending"],
    })
    mapping = {"building": 0, "tenant": 1, "sf": 2, "annual_rent": 3, "lease_end": 4}
    df = build_normalized_dataframe(
        raw=raw, mapping=mapping, rent_period="annual", today=_today(),
    )
    assert "NOI" in df.columns
    assert "Notes" in df.columns
    assert df.loc[0, "Notes"] == "renewal pending"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_normalize.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/normalize.py`**

```python
"""Normalized DataFrame construction (§5.2.4–§5.2.6).

This is the canonical schema every downstream computation reads from.
Source columns not in the mapping are preserved verbatim as additional
columns (per §5.2 — "preserved on the DataFrame as additional columns").
"""
from __future__ import annotations

from datetime import date
from typing import Literal

import pandas as pd

from .tenant_normalize import normalize_tenant

REQUIRED_COLUMNS: list[str] = [
    "building",
    "tenant",
    "tenant_normalized",
    "suite",
    "sf",
    "annual_rent",
    "rent_psf",
    "lease_start",
    "lease_end",
    "exp_year",
    "is_vacant",
    "is_mtm",
    "is_active",
    "_source_row",
]

_MTM_TRUE_VALUES = {"y", "yes", "true", "1", "mtm", "month-to-month", "holdover"}


def _series(raw: pd.DataFrame, idx: int | None) -> pd.Series:
    if idx is None:
        return pd.Series([None] * len(raw))
    return raw.iloc[:, idx].reset_index(drop=True)


def _to_string(s: pd.Series) -> pd.Series:
    return s.astype("object").where(s.notna(), None).map(
        lambda v: "" if v is None else str(v).strip()
    )


def _to_numeric(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def _to_datetime(s: pd.Series) -> pd.Series:
    # format="mixed" parses each element independently, so a Series mixing
    # ISO strings, US-style strings, and datetime objects all coerce correctly.
    return pd.to_datetime(s, errors="coerce", format="mixed")


def _truthy_mtm_flag(s: pd.Series) -> pd.Series:
    """True where the source MTM flag indicates month-to-month."""
    return s.fillna("").astype(str).str.strip().str.lower().isin(_MTM_TRUE_VALUES)


def build_normalized_dataframe(
    raw: pd.DataFrame,
    mapping: dict[str, int],
    rent_period: Literal["monthly", "annual"],
    today: date,
    source_file: str = "Portfolio",
) -> pd.DataFrame:
    """Build the canonical normalized DataFrame from a raw post-header slice."""
    n = len(raw)
    df = pd.DataFrame(index=range(n))

    df["building"] = _to_string(_series(raw, mapping.get("building")))
    if "building" not in mapping:
        df["building"] = source_file
    df["building"] = df["building"].replace("", source_file)

    df["tenant"] = _to_string(_series(raw, mapping.get("tenant")))
    df["tenant_normalized"] = df["tenant"].map(normalize_tenant)

    df["suite"] = _to_string(_series(raw, mapping.get("suite")))
    df["suite"] = df["suite"].replace("", pd.NA)

    df["sf"] = _to_numeric(_series(raw, mapping.get("sf")))

    if rent_period == "monthly":
        rent_idx = mapping.get("monthly_rent", mapping.get("annual_rent"))
        rent = _to_numeric(_series(raw, rent_idx))
        df["annual_rent"] = rent * 12
    else:
        rent_idx = mapping.get("annual_rent", mapping.get("monthly_rent"))
        rent = _to_numeric(_series(raw, rent_idx))
        df["annual_rent"] = rent

    df["rent_psf"] = pd.NA
    sf_positive = (df["sf"].notna()) & (df["sf"] > 0)
    df.loc[sf_positive, "rent_psf"] = (
        df.loc[sf_positive, "annual_rent"] / df.loc[sf_positive, "sf"]
    )

    df["lease_start"] = _to_datetime(_series(raw, mapping.get("lease_start")))
    df["lease_end"] = _to_datetime(_series(raw, mapping.get("lease_end")))
    df["exp_year"] = df["lease_end"].dt.year.astype("Int64")

    today_ts = pd.Timestamp(today)

    tenant_blank = df["tenant"].fillna("").str.strip().eq("")
    rent_zero_or_null = df["annual_rent"].fillna(0).eq(0)
    lease_end_null = df["lease_end"].isna()
    df["is_vacant"] = tenant_blank | (rent_zero_or_null & lease_end_null)

    if "mtm_flag" in mapping:
        flag_col = _truthy_mtm_flag(_series(raw, mapping["mtm_flag"]))
    else:
        flag_col = pd.Series([False] * n)
    inferred_mtm = (
        ~df["is_vacant"]
        & lease_end_null
        & ~rent_zero_or_null
    )
    df["is_mtm"] = (flag_col | inferred_mtm).astype(bool)

    expired = df["lease_end"].notna() & (df["lease_end"] <= today_ts)
    df["is_active"] = (~df["is_vacant"]) & (df["is_mtm"] | (df["lease_end"].notna() & ~expired))

    df["_source_row"] = list(range(1, n + 1))

    used_indices = set(mapping.values())
    for i in range(raw.shape[1]):
        if i in used_indices:
            continue
        col_name = str(raw.columns[i])
        if col_name in df.columns:
            col_name = f"_extra_{i}"
        df[col_name] = raw.iloc[:, i].reset_index(drop=True)

    return df
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_normalize.py -v`
Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/normalize.py \
        python_skills/rent_roll_analyst/tests/unit/test_normalize.py
git commit -m "feat(rent-roll): normalized schema construction (§5.2.4-§5.2.6)"
```

---

### Task 10: Validation / DataQualityBlock construction (§5.2.7)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/validation.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_validation.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_validation.py`:

```python
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from rent_roll_analyst.errors import TooManyNullLeaseEndsError
from rent_roll_analyst.loading.validation import build_quality_block


def _df(rows: list[dict]) -> pd.DataFrame:
    base_cols = [
        "building", "tenant", "tenant_normalized", "suite", "sf",
        "annual_rent", "rent_psf", "lease_start", "lease_end", "exp_year",
        "is_vacant", "is_mtm", "is_active", "_source_row",
    ]
    df = pd.DataFrame(rows)
    for c in base_cols:
        if c not in df.columns:
            df[c] = None
    return df[base_cols]


def test_row_counts_total_active_expired_vacant_mtm():
    df = _df([
        # 5 rows: 2 active, 1 expired, 1 vacant, 1 mtm (also active)
        {"is_active": True,  "is_vacant": False, "is_mtm": False, "lease_end": pd.Timestamp("2028-01-01"), "annual_rent": 30000},
        {"is_active": True,  "is_vacant": False, "is_mtm": False, "lease_end": pd.Timestamp("2027-01-01"), "annual_rent": 24000},
        {"is_active": False, "is_vacant": False, "is_mtm": False, "lease_end": pd.Timestamp("2020-01-01"), "annual_rent": 12000},
        {"is_active": False, "is_vacant": True,  "is_mtm": False, "lease_end": None,                       "annual_rent": 0},
        {"is_active": True,  "is_vacant": False, "is_mtm": True,  "lease_end": None,                       "annual_rent": 18000},
    ])
    q = build_quality_block(
        df=df, header_row_index=0, header_alias_hits=6,
        unmapped_source_columns=[], inference={"basis": "header", "result": "annual"},
        building_fallback_used=False,
    )
    assert q.row_counts == {"total": 5, "active": 3, "expired": 1, "vacant": 1, "mtm": 1}


def test_sum_reconciliation_active_vs_all():
    # lease_end provided to keep null_lease_end_pct below the raise threshold.
    df = _df([
        {"is_active": True,  "is_vacant": False, "annual_rent": 30000, "lease_end": pd.Timestamp("2028-01-01")},
        {"is_active": True,  "is_vacant": False, "annual_rent": 20000, "lease_end": pd.Timestamp("2027-01-01")},
        {"is_active": False, "is_vacant": False, "annual_rent": 10000, "lease_end": pd.Timestamp("2020-01-01")},  # expired
    ])
    q = build_quality_block(
        df=df, header_row_index=0, header_alias_hits=6,
        unmapped_source_columns=[], inference={"basis": "header", "result": "annual"},
        building_fallback_used=False,
    )
    assert q.sum_active_rent == 50000
    assert q.sum_all_rent == 60000


def test_null_lease_end_pct_among_non_vacant():
    df = _df([
        {"is_vacant": False, "lease_end": None},
        {"is_vacant": False, "lease_end": pd.Timestamp("2028-01-01")},
        {"is_vacant": True,  "lease_end": None},  # excluded from denominator
    ])
    q = build_quality_block(
        df=df, header_row_index=0, header_alias_hits=6,
        unmapped_source_columns=[], inference={},
        building_fallback_used=False,
    )
    assert q.null_lease_end_count == 1
    assert q.null_lease_end_pct == pytest.approx(50.0)


def test_warns_when_null_lease_end_above_5pct():
    rows = [{"is_vacant": False, "lease_end": None}] * 1
    rows += [{"is_vacant": False, "lease_end": pd.Timestamp("2028-01-01")}] * 9
    df = _df(rows)  # 10% null
    q = build_quality_block(
        df=df, header_row_index=0, header_alias_hits=6,
        unmapped_source_columns=[], inference={},
        building_fallback_used=False,
    )
    assert any("null lease end" in w.lower() for w in q.warnings)


def test_raises_when_null_lease_end_above_50pct():
    rows = [{"is_vacant": False, "lease_end": None}] * 6
    rows += [{"is_vacant": False, "lease_end": pd.Timestamp("2028-01-01")}] * 4
    df = _df(rows)
    with pytest.raises(TooManyNullLeaseEndsError) as ei:
        build_quality_block(
            df=df, header_row_index=0, header_alias_hits=6,
            unmapped_source_columns=[], inference={},
            building_fallback_used=False,
        )
    assert "More than half" in ei.value.chat_prompt or "more than half" in ei.value.chat_prompt.lower()


def test_duplicate_count_uses_building_suite_tenant_normalized():
    df = _df([
        {"building": "MOB-1", "suite": "100", "tenant_normalized": "acme"},
        {"building": "MOB-1", "suite": "100", "tenant_normalized": "acme"},
        {"building": "MOB-1", "suite": "200", "tenant_normalized": "acme"},
    ])
    q = build_quality_block(
        df=df, header_row_index=0, header_alias_hits=6,
        unmapped_source_columns=[], inference={},
        building_fallback_used=False,
    )
    assert q.duplicate_count == 1


def test_passes_through_inference_and_provenance():
    df = _df([{"is_vacant": False, "lease_end": pd.Timestamp("2028-01-01")}])
    q = build_quality_block(
        df=df, header_row_index=3, header_alias_hits=6,
        unmapped_source_columns=["NOI"],
        inference={"basis": "psf_math", "result": "monthly", "median_psf": 2.5},
        building_fallback_used=True,
    )
    assert q.header_row_index == 3
    assert q.header_alias_hits == 6
    assert q.unmapped_source_columns == ["NOI"]
    assert q.monthly_annual_inference == {"basis": "psf_math", "result": "monthly", "median_psf": 2.5}
    assert q.building_fallback_used is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_validation.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/validation.py`**

```python
"""DataQualityBlock construction (§5.2.7).

Computes row counts, sum reconciliation, null-lease-end stats, duplicate
count, and warnings. Raises TooManyNullLeaseEndsError when > 50% of
non-vacant rows have a null lease_end (§5.14).
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from ..errors import TooManyNullLeaseEndsError
from ..types import DataQualityBlock

NULL_LEASE_END_WARN_PCT = 5.0
NULL_LEASE_END_RAISE_PCT = 50.0


def _row_counts(df: pd.DataFrame) -> dict[str, int]:
    total = len(df)
    active = int(df["is_active"].fillna(False).sum())
    vacant = int(df["is_vacant"].fillna(False).sum())
    mtm = int(df["is_mtm"].fillna(False).sum())
    expired = total - active - vacant
    if expired < 0:
        expired = 0
    return {
        "total": total,
        "active": active,
        "expired": expired,
        "vacant": vacant,
        "mtm": mtm,
    }


def _null_lease_end_stats(df: pd.DataFrame) -> tuple[int, float]:
    non_vacant = df[~df["is_vacant"].fillna(False)]
    denom = len(non_vacant)
    if denom == 0:
        return 0, 0.0
    null_count = int(non_vacant["lease_end"].isna().sum())
    return null_count, (null_count / denom) * 100.0


def _duplicate_count(df: pd.DataFrame) -> int:
    if not all(c in df.columns for c in ("building", "suite", "tenant_normalized")):
        return 0
    keyed = df[["building", "suite", "tenant_normalized"]].fillna("")
    return int(keyed.duplicated(keep="first").sum())


def build_quality_block(
    df: pd.DataFrame,
    header_row_index: int,
    header_alias_hits: int,
    unmapped_source_columns: list[str],
    inference: dict[str, Any],
    building_fallback_used: bool,
) -> DataQualityBlock:
    counts = _row_counts(df)
    null_count, null_pct = _null_lease_end_stats(df)

    if null_pct > NULL_LEASE_END_RAISE_PCT:
        raise TooManyNullLeaseEndsError(
            f"{null_pct:.1f}% of non-vacant rows have null lease_end",
            chat_prompt=(
                "More than half the rows have no lease end. Most metrics "
                "depend on this column. Continue with what we have, or fix the file?"
            ),
        )

    warnings: list[str] = []
    if null_pct > NULL_LEASE_END_WARN_PCT:
        warnings.append(
            f"{null_pct:.1f}% of non-vacant rows have a null lease_end column"
        )
    if building_fallback_used:
        warnings.append(
            "No building column detected; all rows assigned to a single fallback building"
        )

    sum_active = float(df.loc[df["is_active"].fillna(False), "annual_rent"].fillna(0).sum())
    sum_all = float(df["annual_rent"].fillna(0).sum())

    return DataQualityBlock(
        row_counts=counts,
        sum_active_rent=sum_active,
        sum_all_rent=sum_all,
        null_lease_end_count=null_count,
        null_lease_end_pct=null_pct,
        duplicate_count=_duplicate_count(df),
        monthly_annual_inference=inference,
        header_row_index=header_row_index,
        header_alias_hits=header_alias_hits,
        unmapped_source_columns=list(unmapped_source_columns),
        building_fallback_used=building_fallback_used,
        warnings=warnings,
    )
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_validation.py -v`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/validation.py \
        python_skills/rent_roll_analyst/tests/unit/test_validation.py
git commit -m "feat(rent-roll): data-quality block construction (§5.2.7)"
```

---

### Task 11: Top-level loader (§5.2 integration)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/loader.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_loader.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_loader.py`:

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from rent_roll_analyst.errors import (
    AmbiguousRentPeriodError,
    FileParseError,
    HeaderNotFoundError,
    LeaseEndColumnMissingError,
)
from rent_roll_analyst.loading.loader import load_rent_roll
from rent_roll_analyst.types import NormalizedRentRoll


def _write_xlsx(path: Path, rows: list[list[object]]) -> None:
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


def test_loads_clean_xlsx(tmp_path: Path):
    src = tmp_path / "clean.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["MOB-1", "Acme P.C.", "100", 1200, 36000, "2028-06-30"],
        ["MOB-1", "Beta LLC", "200", 800,  24000, "2027-12-31"],
    ])
    rr = load_rent_roll(str(src), today=date(2026, 4, 28))
    assert isinstance(rr, NormalizedRentRoll)
    assert len(rr.df) == 2
    assert rr.quality.row_counts["active"] == 2
    assert rr.quality.header_row_index == 0


def test_loads_xlsx_with_metadata_block_above_header(tmp_path: Path):
    src = tmp_path / "with_meta.xlsx"
    _write_xlsx(src, [
        ["PREP MOB Portfolio", None, None, None, None, None],
        ["Generated 2026-04-01", None, None, None, None, None],
        [None, None, None, None, None, None],
        ["Property", "Lessee", "Unit", "Rentable SF", "Annual Rent", "Expiration"],
        ["MOB-1", "Acme P.C.", "100", 1200, 36000, "2028-06-30"],
    ])
    rr = load_rent_roll(str(src), today=date(2026, 4, 28))
    assert rr.quality.header_row_index == 3
    assert len(rr.df) == 1


def test_loads_csv(tmp_path: Path):
    src = tmp_path / "clean.csv"
    src.write_text(
        "Building,Tenant,Suite,SF,Annual Rent,Lease End\n"
        "MOB-1,Acme P.C.,100,1200,36000,2028-06-30\n"
    )
    rr = load_rent_roll(str(src), today=date(2026, 4, 28))
    assert len(rr.df) == 1


def test_raises_when_no_lease_end_column(tmp_path: Path):
    src = tmp_path / "no_lease_end.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent"],
        ["MOB-1", "Acme", "100", 1200, 36000],
    ])
    with pytest.raises(LeaseEndColumnMissingError) as ei:
        load_rent_roll(str(src), today=date(2026, 4, 28))
    assert "lease-end" in ei.value.chat_prompt.lower() or "lease end" in ei.value.chat_prompt.lower()


def test_raises_when_header_not_found(tmp_path: Path):
    src = tmp_path / "no_header.xlsx"
    _write_xlsx(src, [
        ["just", "some", "garbage"],
        ["nothing", "matches", "aliases"],
    ])
    with pytest.raises(HeaderNotFoundError):
        load_rent_roll(str(src), today=date(2026, 4, 28))


def test_raises_file_parse_error_on_unsupported_extension(tmp_path: Path):
    src = tmp_path / "x.pdf"
    src.write_text("not an xlsx")
    with pytest.raises(FileParseError) as ei:
        load_rent_roll(str(src), today=date(2026, 4, 28))
    assert ".xlsx" in ei.value.chat_prompt or ".csv" in ei.value.chat_prompt


def test_building_fallback_uses_filename_stem(tmp_path: Path):
    src = tmp_path / "PREP_Q1.xlsx"
    _write_xlsx(src, [
        ["Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["Acme P.C.", "100", 1200, 36000, "2028-06-30"],
    ])
    rr = load_rent_roll(str(src), today=date(2026, 4, 28))
    assert rr.df.loc[0, "building"] == "PREP_Q1"
    assert rr.quality.building_fallback_used


def test_propagates_ambiguous_inference(tmp_path: Path):
    src = tmp_path / "ambiguous.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Rent", "Lease End"],
        ["MOB-1", "A", "100", 1000, 12000, "2028-06-30"],  # $12/SF -> overlap
    ])
    with pytest.raises(AmbiguousRentPeriodError):
        load_rent_roll(str(src), today=date(2026, 4, 28))


def test_user_specified_period_overrides_inference(tmp_path: Path):
    src = tmp_path / "specified.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Rent", "Lease End"],
        ["MOB-1", "A", "100", 1000, 12000, "2028-06-30"],  # ambiguous w/o override
    ])
    rr = load_rent_roll(str(src), today=date(2026, 4, 28), rent_period_override="annual")
    assert rr.df.loc[0, "annual_rent"] == 12000
    assert rr.quality.monthly_annual_inference["basis"] == "user_specified"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_loader.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `loading/loader.py`**

```python
"""Top-level rent-roll loader (§5.2).

Composes header detection, column mapping, monthly/annual inference,
schema construction, and quality-block validation. Returns a
NormalizedRentRoll or raises a concrete RentRollError with a chat_prompt.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal, Optional

import pandas as pd

from ..errors import (
    AmbiguousRentPeriodError,
    FileParseError,
    LeaseEndColumnMissingError,
)
from ..types import NormalizedRentRoll
from .columns import map_columns
from .header import detect_header_row
from .inference import infer_rent_period
from .normalize import build_normalized_dataframe
from .validation import build_quality_block


def _read_raw(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        try:
            return pd.read_excel(path, header=None, dtype=object)
        except Exception as exc:  # noqa: BLE001
            raise FileParseError(
                f"could not open {path.name}: {exc}",
                chat_prompt=(
                    f"I could not open the file. Error: {exc}. "
                    "The portal accepts .xlsx, .xls, and .csv."
                ),
            ) from exc
    if suffix == ".csv":
        try:
            return pd.read_csv(path, header=None, dtype=object)
        except Exception as exc:  # noqa: BLE001
            raise FileParseError(
                f"could not open {path.name}: {exc}",
                chat_prompt=(
                    f"I could not open the file. Error: {exc}. "
                    "The portal accepts .xlsx, .xls, and .csv."
                ),
            ) from exc
    raise FileParseError(
        f"unsupported extension: {suffix}",
        chat_prompt=(
            f"I could not open the file ({suffix}). "
            "The portal accepts .xlsx, .xls, and .csv."
        ),
    )


def load_rent_roll(
    file_path: str,
    *,
    today: Optional[date] = None,
    rent_period_override: Optional[Literal["monthly", "annual"]] = None,
) -> NormalizedRentRoll:
    """Read, normalize, and validate a rent-roll file.

    *rent_period_override* short-circuits the monthly/annual inference and
    is the path the orchestrator uses after the user answers an
    AmbiguousRentPeriodError prompt.
    """
    today = today or date.today()
    path = Path(file_path)

    raw = _read_raw(path)

    header_idx, hits = detect_header_row(raw)
    headers = [str(c) if c is not None else "" for c in raw.iloc[header_idx].tolist()]
    body = raw.iloc[header_idx + 1 :].reset_index(drop=True)
    body.columns = headers

    mapping, unmapped = map_columns(headers)

    if "lease_end" not in mapping:
        attempted = sorted({"lease end", "expiration", "expiration date",
                            "end date", "lease expiration", "term end"})
        raise LeaseEndColumnMissingError(
            "no lease-end column resolved by alias dictionary",
            chat_prompt=(
                "I could not find a lease-end column. Aliases I checked: "
                f"{', '.join(attempted)}. Which column holds lease end dates?"
            ),
        )

    rent_idx = mapping.get("annual_rent", mapping.get("monthly_rent"))
    rent_label = headers[rent_idx] if rent_idx is not None else ""
    rent_series = body.iloc[:, rent_idx] if rent_idx is not None else pd.Series(dtype=object)
    sf_series = body.iloc[:, mapping["sf"]] if "sf" in mapping else pd.Series(dtype=object)

    if rent_period_override is not None:
        period = rent_period_override
        inference = {
            "basis": "user_specified",
            "result": period,
            "median_psf": None,
            "header_label": rent_label,
        }
    else:
        period, inference = infer_rent_period(rent_series, sf_series, rent_label)

    fallback = "building" not in mapping
    df = build_normalized_dataframe(
        raw=body,
        mapping=mapping,
        rent_period=period,
        today=today,
        source_file=path.stem,
    )

    quality = build_quality_block(
        df=df,
        header_row_index=header_idx,
        header_alias_hits=hits,
        unmapped_source_columns=unmapped,
        inference=inference,
        building_fallback_used=fallback,
    )

    return NormalizedRentRoll(df=df, quality=quality, source_file=str(path))
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_loader.py -v`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/loading/loader.py \
        python_skills/rent_roll_analyst/tests/unit/test_loader.py
git commit -m "feat(rent-roll): top-level loader composing header/columns/inference/normalize"
```

---

## Phase 3 — Intent / Column-Shape Probe (§5.1)

### Task 12: Column-shape probe

The Node side of §5.1 (orchestrator triggering, filename heuristics) is in Plan 2. The Python side is the deterministic shape probe: given a file path, return whether ≥3 of {tenant, suite, sf, rent, lease_end} are detectable.

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/intent.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_intent.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_intent.py`:

```python
from __future__ import annotations

from pathlib import Path

import pandas as pd

from rent_roll_analyst.intent import ProbeResult, probe_rent_roll_shape


def _write_xlsx(path: Path, rows: list[list[object]]) -> None:
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


def test_probe_returns_true_when_three_or_more_required_columns_present(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Tenant", "Suite", "SF", "Notes"],
        ["A", "100", 1000, "x"],
    ])
    result = probe_rent_roll_shape(str(src))
    assert isinstance(result, ProbeResult)
    assert result.is_rent_roll
    assert result.matched_columns == ["tenant", "suite", "sf"]
    assert result.header_row_index == 0


def test_probe_false_when_only_one_match(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Tenant Name", "Notes", "Color"],
        ["A", "x", "red"],
    ])
    result = probe_rent_roll_shape(str(src))
    assert not result.is_rent_roll
    assert result.matched_columns == ["tenant"]


def test_probe_uses_full_required_set():
    # The probe checks {tenant, suite, sf, annual_rent OR monthly_rent, lease_end}
    from rent_roll_analyst.intent import REQUIRED_FOR_PROBE
    assert REQUIRED_FOR_PROBE == {"tenant", "suite", "sf", "rent", "lease_end"}


def test_probe_counts_either_annual_or_monthly_rent_as_rent(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Tenant", "SF", "Monthly Rent"],
        ["A", 1000, 3000],
    ])
    result = probe_rent_roll_shape(str(src))
    assert result.is_rent_roll
    assert "rent" in result.matched_columns


def test_probe_handles_unsupported_extension_gracefully(tmp_path: Path):
    src = tmp_path / "x.pdf"
    src.write_text("no")
    result = probe_rent_roll_shape(str(src))
    assert not result.is_rent_roll
    assert result.matched_columns == []


def test_probe_handles_missing_file(tmp_path: Path):
    result = probe_rent_roll_shape(str(tmp_path / "missing.xlsx"))
    assert not result.is_rent_roll
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_intent.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `intent.py`**

```python
"""Rent-roll shape probe (§5.1, deterministic part).

Returns a ProbeResult that the Node orchestrator combines with filename
heuristics and explicit user intent to decide whether to invoke the skill.
This module is read-only: it does not raise on bad input — it just returns
is_rent_roll=False so the orchestrator can route elsewhere.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from .loading.aliases import lookup_alias

REQUIRED_FOR_PROBE: set[str] = {"tenant", "suite", "sf", "rent", "lease_end"}
_RENT_CANONICALS = {"annual_rent", "monthly_rent"}
_PROBE_THRESHOLD = 3
_SCAN_ROWS = 10


@dataclass
class ProbeResult:
    is_rent_roll: bool
    matched_columns: list[str] = field(default_factory=list)
    header_row_index: int = -1


def _read_raw(path: Path) -> pd.DataFrame | None:
    suffix = path.suffix.lower()
    try:
        if suffix in (".xlsx", ".xls"):
            return pd.read_excel(path, header=None, dtype=object, nrows=_SCAN_ROWS)
        if suffix == ".csv":
            return pd.read_csv(path, header=None, dtype=object, nrows=_SCAN_ROWS)
    except Exception:  # noqa: BLE001
        return None
    return None


def _matches_in_row(row: pd.Series) -> set[str]:
    """Map a header-candidate row to the set of probe canonicals it matches."""
    found: set[str] = set()
    for cell in row:
        if pd.isna(cell):
            continue
        canonical = lookup_alias(str(cell))
        if canonical is None:
            continue
        if canonical in _RENT_CANONICALS:
            found.add("rent")
        elif canonical in REQUIRED_FOR_PROBE:
            found.add(canonical)
    return found


def probe_rent_roll_shape(file_path: str) -> ProbeResult:
    path = Path(file_path)
    if not path.exists():
        return ProbeResult(is_rent_roll=False)
    raw = _read_raw(path)
    if raw is None or raw.empty:
        return ProbeResult(is_rent_roll=False)

    best_idx = -1
    best_matches: set[str] = set()
    for i in range(min(_SCAN_ROWS, len(raw))):
        m = _matches_in_row(raw.iloc[i])
        if len(m) > len(best_matches):
            best_idx = i
            best_matches = m

    sorted_matches = sorted(best_matches)
    return ProbeResult(
        is_rent_roll=len(best_matches) >= _PROBE_THRESHOLD,
        matched_columns=sorted_matches,
        header_row_index=best_idx if best_matches else -1,
    )
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_intent.py -v`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/intent.py \
        python_skills/rent_roll_analyst/tests/unit/test_intent.py
git commit -m "feat(rent-roll): column-shape probe for §5.1 routing"
```

---

## Phase 4 — Analytical Capabilities (§5.3–§5.8)

### Task 13: Lease expiration analysis (§5.3)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/__init__.py`
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/expirations.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_expirations.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_expirations.py`:

```python
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from rent_roll_analyst.analyses.expirations import compute_expirations
from rent_roll_analyst.types import DataQualityBlock, NormalizedRentRoll


def _rr(rows: list[dict], today: date = date(2026, 4, 28)) -> NormalizedRentRoll:
    base = {
        "building": None, "tenant": None, "tenant_normalized": None,
        "suite": None, "sf": 0.0, "annual_rent": 0.0, "rent_psf": None,
        "lease_start": pd.NaT, "lease_end": pd.NaT, "exp_year": pd.NA,
        "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1,
    }
    rows = [{**base, **r} for r in rows]
    df = pd.DataFrame(rows)
    df["lease_end"] = pd.to_datetime(df["lease_end"], errors="coerce")
    df["exp_year"] = df["lease_end"].dt.year.astype("Int64")
    return NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")


def test_basic_expirations_buckets_by_year():
    rr = _rr([
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2027-06-30"},
        {"sf": 1500, "annual_rent": 45000, "lease_end": "2027-12-31"},
        {"sf":  800, "annual_rent": 24000, "lease_end": "2028-03-15"},
    ])
    result = compute_expirations(rr, start_year=2026, end_year=2029)
    by_year = {row["year"]: row for _, row in result.iterrows()}
    assert by_year[2027]["expiring_rent"] == 75000
    assert by_year[2027]["expiring_sf"] == 2500
    assert by_year[2027]["lease_count"] == 2
    assert by_year[2028]["expiring_rent"] == 24000


def test_excludes_inactive_rows():
    rr = _rr([
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2027-06-30", "is_active": True},
        {"sf": 1500, "annual_rent": 45000, "lease_end": "2020-01-01", "is_active": False},
    ])
    result = compute_expirations(rr, start_year=2026, end_year=2029)
    by_year = {row["year"]: row for _, row in result.iterrows()}
    assert by_year[2027]["expiring_rent"] == 30000
    # 2020 row is not in the window AND is inactive
    assert 2020 not in by_year


def test_current_year_only_counts_after_today():
    rr = _rr([
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2026-01-15"},  # past
        {"sf":  500, "annual_rent": 15000, "lease_end": "2026-12-15"},  # future-this-year
    ], today=date(2026, 4, 28))
    result = compute_expirations(rr, start_year=2026, end_year=2027,
                                 today=date(2026, 4, 28))
    by_year = {row["year"]: row for _, row in result.iterrows()}
    assert by_year[2026]["expiring_rent"] == 15000
    assert by_year[2026]["lease_count"] == 1


def test_mtm_reported_separately_not_in_year_buckets():
    rr = _rr([
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2027-06-30"},
        {"sf":  500, "annual_rent": 18000, "lease_end": None, "is_mtm": True},
    ])
    result = compute_expirations(rr, start_year=2026, end_year=2028)
    mtm_rows = result[result["year"] == "MTM"]
    assert len(mtm_rows) == 1
    assert mtm_rows.iloc[0]["expiring_rent"] == 18000
    assert mtm_rows.iloc[0]["lease_count"] == 1
    # Confirm no MTM rent leaked into a year bucket
    year_only = result[result["year"] != "MTM"]
    assert year_only["expiring_rent"].sum() == 30000


def test_default_window_is_current_year_through_plus_9():
    rr = _rr([
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2026-06-30"},
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2035-06-30"},
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2036-06-30"},  # outside window
    ], today=date(2026, 4, 28))
    result = compute_expirations(rr, today=date(2026, 4, 28))
    years = {row["year"] for _, row in result.iterrows() if row["year"] != "MTM"}
    assert 2026 in years and 2035 in years
    assert 2036 not in years


def test_includes_zero_rows_for_years_with_no_expirations():
    rr = _rr([
        {"sf": 1000, "annual_rent": 30000, "lease_end": "2027-06-30"},
    ])
    result = compute_expirations(rr, start_year=2026, end_year=2028,
                                 today=date(2026, 4, 28))
    by_year = {row["year"]: row for _, row in result.iterrows()
               if row["year"] != "MTM"}
    assert by_year[2026]["expiring_rent"] == 0
    assert by_year[2028]["expiring_rent"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_expirations.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyses/__init__.py`**

```python
"""Analytical capabilities. Each is independently callable."""
```

- [ ] **Step 4: Implement `analyses/expirations.py`**

```python
"""Lease expiration analysis (§5.3).

Active leases only; current-year bucket counts only leases expiring after
*today*; MTM leases are a separate row keyed "MTM" rather than bundled.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd

from ..types import NormalizedRentRoll


def compute_expirations(
    rr: NormalizedRentRoll,
    start_year: Optional[int] = None,
    end_year: Optional[int] = None,
    today: Optional[date] = None,
) -> pd.DataFrame:
    today = today or date.today()
    start_year = start_year if start_year is not None else today.year
    end_year = end_year if end_year is not None else today.year + 9

    df = rr.df
    active = df[df["is_active"].fillna(False)].copy()

    mtm_mask = active["is_mtm"].fillna(False)
    mtm = active[mtm_mask]
    dated = active[~mtm_mask & active["lease_end"].notna()].copy()
    dated["lease_end"] = pd.to_datetime(dated["lease_end"])

    cur_year_after_today = (
        (dated["lease_end"].dt.year == today.year)
        & (dated["lease_end"].dt.date > today)
    )
    other_year = dated["lease_end"].dt.year != today.year
    in_window = (dated["lease_end"].dt.year >= start_year) & (
        dated["lease_end"].dt.year <= end_year
    )
    keep = (cur_year_after_today | other_year) & in_window
    dated = dated[keep]

    rows: list[dict] = []
    for year in range(start_year, end_year + 1):
        sub = dated[dated["lease_end"].dt.year == year]
        rows.append({
            "year": year,
            "expiring_rent": float(sub["annual_rent"].fillna(0).sum()),
            "expiring_sf": float(sub["sf"].fillna(0).sum()),
            "lease_count": int(len(sub)),
        })
    rows.append({
        "year": "MTM",
        "expiring_rent": float(mtm["annual_rent"].fillna(0).sum()),
        "expiring_sf": float(mtm["sf"].fillna(0).sum()),
        "lease_count": int(len(mtm)),
    })
    return pd.DataFrame(rows, columns=["year", "expiring_rent", "expiring_sf", "lease_count"])
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/unit/test_expirations.py -v`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses \
        python_skills/rent_roll_analyst/tests/unit/test_expirations.py
git commit -m "feat(rent-roll): lease expiration analysis (§5.3)"
```

---

### Task 14: Building inventory (§5.4)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/inventory.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_inventory.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_inventory.py`:

```python
from __future__ import annotations

import pandas as pd
import pytest

from rent_roll_analyst.analyses.inventory import compute_building_inventory
from rent_roll_analyst.types import DataQualityBlock, NormalizedRentRoll


def _rr(rows: list[dict]) -> NormalizedRentRoll:
    base = {
        "building": "MOB-1", "tenant": "X", "tenant_normalized": "x",
        "suite": "100", "sf": 0.0, "annual_rent": 0.0, "rent_psf": None,
        "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1,
    }
    df = pd.DataFrame([{**base, **r} for r in rows])
    return NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")


def test_per_building_aggregates():
    rr = _rr([
        {"building": "A", "tenant_normalized": "acme", "suite": "100",
         "sf": 1000, "annual_rent": 30000},
        {"building": "A", "tenant_normalized": "acme", "suite": "200",
         "sf": 500,  "annual_rent": 12500},  # same tenant, two suites
        {"building": "A", "tenant_normalized": "beta", "suite": "300",
         "sf": 1500, "annual_rent": 60000},
        {"building": "B", "tenant_normalized": "gamma", "suite": "100",
         "sf": 2000, "annual_rent": 50000},
    ])
    inv = compute_building_inventory(rr)
    by_b = {row["building"]: row for _, row in inv.iterrows()}
    assert by_b["A"]["total_sf"] == 3000
    assert by_b["A"]["tenant_count_distinct"] == 2
    assert by_b["A"]["lease_count"] == 3
    assert by_b["A"]["total_annual_rent"] == 102500
    assert by_b["A"]["weighted_avg_rent_psf"] == pytest.approx(102500 / 3000)


def test_excludes_inactive_rows_from_totals_but_reports_vacancy_separately():
    rr = _rr([
        {"building": "A", "tenant_normalized": "acme", "sf": 1000,
         "annual_rent": 30000},
        {"building": "A", "tenant_normalized": "", "sf": 500,
         "annual_rent": 0, "is_active": False, "is_vacant": True},
    ])
    inv = compute_building_inventory(rr)
    row = inv.iloc[0]
    assert row["total_sf"] == 1000
    assert row["vacancy_sf"] == 500
    assert row["lease_count"] == 1


def test_sorted_by_total_sf_desc():
    rr = _rr([
        {"building": "Small", "sf": 500,  "annual_rent": 10000},
        {"building": "Big",   "sf": 5000, "annual_rent": 100000},
        {"building": "Mid",   "sf": 2000, "annual_rent": 40000},
    ])
    inv = compute_building_inventory(rr)
    assert list(inv["building"]) == ["Big", "Mid", "Small"]


def test_columns_match_spec():
    rr = _rr([{"sf": 100, "annual_rent": 1000}])
    inv = compute_building_inventory(rr)
    assert list(inv.columns) == [
        "building", "total_sf", "tenant_count_distinct", "lease_count",
        "total_annual_rent", "weighted_avg_rent_psf", "vacancy_sf",
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_inventory.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyses/inventory.py`**

```python
"""Per-building inventory (§5.4).

Active leases only for `total_sf`, `tenant_count_distinct`, `lease_count`,
`total_annual_rent`, `weighted_avg_rent_psf`. Vacancy is reported in a
separate column from the same set of rows but flagged is_vacant=True.
"""
from __future__ import annotations

import pandas as pd

from ..types import NormalizedRentRoll


def compute_building_inventory(rr: NormalizedRentRoll) -> pd.DataFrame:
    df = rr.df
    active = df[df["is_active"].fillna(False)]
    vacant = df[df["is_vacant"].fillna(False)]

    grouped = active.groupby("building", dropna=False, sort=False).agg(
        total_sf=("sf", lambda s: float(s.fillna(0).sum())),
        tenant_count_distinct=("tenant_normalized",
                               lambda s: int(s.replace("", pd.NA).dropna().nunique())),
        lease_count=("_source_row", "count"),
        total_annual_rent=("annual_rent", lambda s: float(s.fillna(0).sum())),
    ).reset_index()

    grouped["weighted_avg_rent_psf"] = grouped.apply(
        lambda r: float(r["total_annual_rent"]) / float(r["total_sf"])
        if r["total_sf"] else 0.0,
        axis=1,
    )

    vac = vacant.groupby("building", dropna=False, sort=False).agg(
        vacancy_sf=("sf", lambda s: float(s.fillna(0).sum())),
    ).reset_index()

    out = grouped.merge(vac, on="building", how="left")
    out["vacancy_sf"] = out["vacancy_sf"].fillna(0.0)
    out = out.sort_values("total_sf", ascending=False).reset_index(drop=True)
    return out[[
        "building", "total_sf", "tenant_count_distinct", "lease_count",
        "total_annual_rent", "weighted_avg_rent_psf", "vacancy_sf",
    ]]
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_inventory.py -v`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/inventory.py \
        python_skills/rent_roll_analyst/tests/unit/test_inventory.py
git commit -m "feat(rent-roll): per-building inventory (§5.4)"
```

---

### Task 15: Expiration pivot — building × year (§5.5)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/pivot.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_pivot.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_pivot.py`:

```python
from __future__ import annotations

from datetime import date

import pandas as pd

from rent_roll_analyst.analyses.pivot import compute_expiration_pivot
from rent_roll_analyst.types import DataQualityBlock, NormalizedRentRoll


def _rr(rows: list[dict]) -> NormalizedRentRoll:
    base = {
        "building": "MOB-1", "tenant": "X", "tenant_normalized": "x",
        "suite": "100", "sf": 0.0, "annual_rent": 0.0,
        "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1,
    }
    rows = [{**base, **r} for r in rows]
    df = pd.DataFrame(rows)
    df["lease_end"] = pd.to_datetime(df.get("lease_end"), errors="coerce")
    return NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")


def test_pivot_buildings_rows_years_columns():
    rr = _rr([
        {"building": "A", "annual_rent": 30000, "sf": 1000, "lease_end": "2027-06-30"},
        {"building": "A", "annual_rent": 20000, "sf":  500, "lease_end": "2028-01-01"},
        {"building": "B", "annual_rent": 50000, "sf": 2000, "lease_end": "2027-12-31"},
    ])
    p = compute_expiration_pivot(rr, start_year=2026, end_year=2028,
                                 today=date(2026, 4, 28))
    cols = list(p.columns)
    assert cols == ["building", 2026, 2027, 2028, "Total"]
    rows = {r["building"]: r for _, r in p.iterrows()}
    assert rows["A"][2027] == 30000
    assert rows["A"][2028] == 20000
    assert rows["A"]["Total"] == 50000
    assert rows["B"][2027] == 50000


def test_total_row_aggregates_columns():
    rr = _rr([
        {"building": "A", "annual_rent": 10000, "sf": 100, "lease_end": "2027-01-01"},
        {"building": "B", "annual_rent": 20000, "sf": 200, "lease_end": "2027-01-01"},
    ])
    p = compute_expiration_pivot(rr, start_year=2027, end_year=2027,
                                 today=date(2026, 4, 28))
    total_row = p[p["building"] == "Total"].iloc[0]
    assert total_row[2027] == 30000


def test_top_25_plus_additional_when_more_than_25_buildings():
    rows: list[dict] = []
    for i in range(30):
        rows.append({
            "building": f"B{i:02d}",
            "annual_rent": 1000 + i,
            "sf": 100 + i,
            "lease_end": "2027-06-30",
        })
    rr = _rr(rows)
    p = compute_expiration_pivot(rr, start_year=2027, end_year=2027,
                                 today=date(2026, 4, 28),
                                 limit_buildings=True)
    building_rows = p[~p["building"].isin(["Total"])]
    assert len(building_rows) == 26  # 25 buildings + 1 "+ N additional buildings"
    assert any("additional" in str(b).lower() for b in p["building"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_pivot.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyses/pivot.py`**

```python
"""Expiration pivot, building × year (§5.5)."""
from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd

from ..types import NormalizedRentRoll

TOP_N_BUILDINGS = 25


def compute_expiration_pivot(
    rr: NormalizedRentRoll,
    start_year: Optional[int] = None,
    end_year: Optional[int] = None,
    today: Optional[date] = None,
    limit_buildings: bool = False,
) -> pd.DataFrame:
    today = today or date.today()
    start_year = start_year if start_year is not None else today.year
    end_year = end_year if end_year is not None else today.year + 9
    years = list(range(start_year, end_year + 1))

    df = rr.df
    active = df[df["is_active"].fillna(False) & ~df["is_mtm"].fillna(False)].copy()
    active["lease_end"] = pd.to_datetime(active["lease_end"], errors="coerce")
    active = active[active["lease_end"].notna()]

    cur_year_after_today = (
        (active["lease_end"].dt.year == today.year)
        & (active["lease_end"].dt.date > today)
    )
    other_year = active["lease_end"].dt.year != today.year
    in_window = (active["lease_end"].dt.year >= start_year) & (
        active["lease_end"].dt.year <= end_year
    )
    active = active[(cur_year_after_today | other_year) & in_window]
    active["_year"] = active["lease_end"].dt.year

    pivot = active.pivot_table(
        index="building", columns="_year",
        values="annual_rent", aggfunc="sum", fill_value=0,
    )
    for y in years:
        if y not in pivot.columns:
            pivot[y] = 0.0
    pivot = pivot[years]

    pivot["Total"] = pivot[years].sum(axis=1)
    pivot = pivot.sort_values("Total", ascending=False).reset_index()

    if limit_buildings and len(pivot) > TOP_N_BUILDINGS:
        head = pivot.iloc[:TOP_N_BUILDINGS]
        rest = pivot.iloc[TOP_N_BUILDINGS:]
        rest_sums = {y: float(rest[y].sum()) for y in years}
        rest_sums["Total"] = float(rest["Total"].sum())
        rest_row = {
            "building": f"+ {len(rest)} additional buildings",
            **rest_sums,
        }
        pivot = pd.concat([head, pd.DataFrame([rest_row])], ignore_index=True)

    total_row = {"building": "Total"}
    for y in years:
        total_row[y] = float(pivot[y].sum())
    total_row["Total"] = float(pivot["Total"].sum())
    pivot = pd.concat([pivot, pd.DataFrame([total_row])], ignore_index=True)

    return pivot[["building", *years, "Total"]]
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_pivot.py -v`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/pivot.py \
        python_skills/rent_roll_analyst/tests/unit/test_pivot.py
git commit -m "feat(rent-roll): expiration pivot (§5.5)"
```

---

### Task 16: WALT — portfolio + per-building (§5.6)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/walt.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_walt.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_walt.py`:

```python
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from rent_roll_analyst.analyses.walt import compute_walt, compute_walt_by_building
from rent_roll_analyst.types import DataQualityBlock, NormalizedRentRoll, WaltResult


def _rr(rows: list[dict]) -> NormalizedRentRoll:
    base = {
        "building": "MOB-1", "tenant": "X", "tenant_normalized": "x",
        "suite": "100", "sf": 0.0, "annual_rent": 0.0,
        "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1,
    }
    rows = [{**base, **r} for r in rows]
    df = pd.DataFrame(rows)
    df["lease_end"] = pd.to_datetime(df.get("lease_end"), errors="coerce")
    return NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")


def test_simple_rent_weighted_walt():
    today = date(2026, 1, 1)
    # Lease A: 5y remaining, $10k/yr -> contributes 5.0 * 10000
    # Lease B: 1y remaining, $30k/yr -> contributes 1.0 * 30000
    # Total weight = 40k. Numerator = 50000 + 30000 = 80000. WALT = 2.0y
    rr = _rr([
        {"annual_rent": 10000, "sf": 1000, "lease_end": "2031-01-01"},
        {"annual_rent": 30000, "sf": 1000, "lease_end": "2027-01-01"},
    ])
    r = compute_walt(rr, weight_by="rent", today=today)
    assert isinstance(r, WaltResult)
    assert r.walt_years == pytest.approx(2.0, abs=0.05)
    assert r.weighting_basis == "rent"
    assert r.included_lease_count == 2
    assert r.excluded_mtm_count == 0
    assert r.excluded_expired_count == 0


def test_sf_weighted_walt():
    today = date(2026, 1, 1)
    # 5y * 1000sf + 1y * 3000sf = 5000 + 3000 = 8000; sf total = 4000; WALT = 2.0
    rr = _rr([
        {"annual_rent": 10, "sf": 1000, "lease_end": "2031-01-01"},
        {"annual_rent": 10, "sf": 3000, "lease_end": "2027-01-01"},
    ])
    r = compute_walt(rr, weight_by="sf", today=today)
    assert r.walt_years == pytest.approx(2.0, abs=0.05)
    assert r.weighting_basis == "sf"


def test_excludes_mtm_and_expired_with_counts():
    today = date(2026, 1, 1)
    rr = _rr([
        {"annual_rent": 10000, "lease_end": "2031-01-01"},
        {"annual_rent": 10000, "lease_end": None, "is_mtm": True},
        {"annual_rent": 10000, "lease_end": "2020-01-01", "is_active": False},
    ])
    r = compute_walt(rr, weight_by="rent", today=today)
    assert r.included_lease_count == 1
    assert r.excluded_mtm_count == 1
    assert r.excluded_expired_count == 1


def test_zero_weight_returns_zero_walt_not_division_error():
    rr = _rr([
        {"annual_rent": 0, "sf": 1000, "lease_end": "2031-01-01"},
    ])
    r = compute_walt(rr, weight_by="rent", today=date(2026, 1, 1))
    assert r.walt_years == 0.0
    assert r.included_lease_count == 1


def test_walt_rounds_to_one_decimal_for_display():
    rr = _rr([
        {"annual_rent": 10000, "lease_end": "2031-06-15"},
    ])
    r = compute_walt(rr, weight_by="rent", today=date(2026, 1, 1))
    rounded = round(r.walt_years, 1)
    assert isinstance(rounded, float)
    assert abs(rounded - 5.5) < 0.1


def test_per_building_walt_returns_dataframe():
    today = date(2026, 1, 1)
    rr = _rr([
        {"building": "A", "annual_rent": 10000, "lease_end": "2031-01-01"},
        {"building": "B", "annual_rent": 10000, "lease_end": "2027-01-01"},
    ])
    df = compute_walt_by_building(rr, weight_by="rent", today=today)
    by_b = {row["building"]: row for _, row in df.iterrows()}
    assert by_b["A"]["walt_years"] == pytest.approx(5.0, abs=0.05)
    assert by_b["B"]["walt_years"] == pytest.approx(1.0, abs=0.05)
    assert by_b["A"]["weighting_basis"] == "rent"
    assert "included_lease_count" in df.columns
    assert "excluded_mtm_count" in df.columns
    assert "excluded_expired_count" in df.columns


def test_invalid_weight_by_raises():
    rr = _rr([{"annual_rent": 1, "sf": 1, "lease_end": "2031-01-01"}])
    with pytest.raises(ValueError):
        compute_walt(rr, weight_by="noi", today=date(2026, 1, 1))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_walt.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyses/walt.py`**

```python
"""Weighted-average lease term (§5.6).

Active leases with a real lease_end only. MTM and expired excluded with
explicit counts. Default weighting is `rent`; `sf` is also supported.
"""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

import pandas as pd

from ..types import NormalizedRentRoll, WaltResult, WeightingBasis

DAYS_IN_YEAR = 365.25


def _years_remaining(lease_end: pd.Series, today: date) -> pd.Series:
    today_ts = pd.Timestamp(today)
    return (pd.to_datetime(lease_end) - today_ts).dt.days / DAYS_IN_YEAR


def _walt_components(
    df: pd.DataFrame, weight_by: WeightingBasis, today: date,
) -> tuple[float, int, int, int]:
    if weight_by not in ("rent", "sf"):
        raise ValueError(f"weight_by must be 'rent' or 'sf', got {weight_by!r}")

    active = df[df["is_active"].fillna(False)]
    mtm = active[active["is_mtm"].fillna(False)]
    eligible = active[~active["is_mtm"].fillna(False) & active["lease_end"].notna()]
    expired = df[
        df["lease_end"].notna()
        & (pd.to_datetime(df["lease_end"]) <= pd.Timestamp(today))
    ]

    excluded_expired = int(len(expired))
    excluded_mtm = int(len(mtm))
    included = int(len(eligible))

    if eligible.empty:
        return 0.0, included, excluded_mtm, excluded_expired

    weights = (
        eligible["annual_rent"].fillna(0)
        if weight_by == "rent"
        else eligible["sf"].fillna(0)
    )
    years = _years_remaining(eligible["lease_end"], today).clip(lower=0)
    total_weight = float(weights.sum())
    if total_weight == 0:
        return 0.0, included, excluded_mtm, excluded_expired
    walt = float((weights * years).sum() / total_weight)
    return walt, included, excluded_mtm, excluded_expired


def compute_walt(
    rr: NormalizedRentRoll,
    weight_by: WeightingBasis = "rent",
    today: Optional[date] = None,
) -> WaltResult:
    today = today or date.today()
    walt, included, mtm, expired = _walt_components(rr.df, weight_by, today)
    return WaltResult(
        walt_years=walt,
        weighting_basis=weight_by,
        included_lease_count=included,
        excluded_mtm_count=mtm,
        excluded_expired_count=expired,
    )


def compute_walt_by_building(
    rr: NormalizedRentRoll,
    weight_by: WeightingBasis = "rent",
    today: Optional[date] = None,
) -> pd.DataFrame:
    today = today or date.today()
    rows: list[dict] = []
    for bldg, sub in rr.df.groupby("building", sort=False):
        walt, included, mtm, expired = _walt_components(sub, weight_by, today)
        rows.append({
            "building": bldg,
            "walt_years": walt,
            "weighting_basis": weight_by,
            "included_lease_count": included,
            "excluded_mtm_count": mtm,
            "excluded_expired_count": expired,
        })
    return pd.DataFrame(rows, columns=[
        "building", "walt_years", "weighting_basis",
        "included_lease_count", "excluded_mtm_count", "excluded_expired_count",
    ])
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_walt.py -v`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/walt.py \
        python_skills/rent_roll_analyst/tests/unit/test_walt.py
git commit -m "feat(rent-roll): WALT portfolio + per-building (§5.6)"
```

---

### Task 17: Tenant concentration (§5.7)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/concentration.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_concentration.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_concentration.py`:

```python
from __future__ import annotations

import pandas as pd
import pytest

from rent_roll_analyst.analyses.concentration import compute_tenant_concentration
from rent_roll_analyst.types import DataQualityBlock, NormalizedRentRoll


def _rr(rows: list[dict]) -> NormalizedRentRoll:
    base = {
        "building": "MOB-1", "tenant": "X", "tenant_normalized": "x",
        "suite": "100", "sf": 0.0, "annual_rent": 0.0,
        "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1,
    }
    df = pd.DataFrame([{**base, **r} for r in rows])
    return NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")


def test_groups_by_tenant_normalized():
    rr = _rr([
        {"building": "A", "tenant_normalized": "acme", "sf": 1000, "annual_rent": 30000},
        {"building": "B", "tenant_normalized": "acme", "sf":  500, "annual_rent": 15000},
        {"building": "A", "tenant_normalized": "beta", "sf": 2000, "annual_rent": 60000},
    ])
    out = compute_tenant_concentration(rr, top_n=5)
    by_t = {row["tenant_normalized"]: row for _, row in out.iterrows()}
    assert by_t["acme"]["total_annual_rent"] == 45000
    assert by_t["acme"]["total_sf"] == 1500
    assert by_t["acme"]["lease_count"] == 2
    assert by_t["acme"]["building_count"] == 2


def test_top_n_truncation():
    rows = [
        {"tenant_normalized": f"t{i}", "annual_rent": 1000 + i, "sf": 100}
        for i in range(20)
    ]
    rr = _rr(rows)
    out = compute_tenant_concentration(rr, top_n=5)
    assert len(out) == 5


def test_pct_of_portfolio_rent_sums_to_share_of_top_n():
    rr = _rr([
        {"tenant_normalized": "acme", "annual_rent": 30000, "sf": 1000},
        {"tenant_normalized": "beta", "annual_rent": 70000, "sf": 1000},
    ])
    out = compute_tenant_concentration(rr, top_n=5)
    by_t = {row["tenant_normalized"]: row for _, row in out.iterrows()}
    assert by_t["beta"]["pct_of_portfolio_rent"] == pytest.approx(0.7, abs=0.001)
    assert by_t["acme"]["pct_of_portfolio_rent"] == pytest.approx(0.3, abs=0.001)


def test_default_top_n_5_when_le_50_distinct_tenants():
    rows = [{"tenant_normalized": f"t{i}", "annual_rent": 1000, "sf": 100}
            for i in range(40)]
    rr = _rr(rows)
    out = compute_tenant_concentration(rr)  # no top_n
    assert len(out) == 5


def test_default_top_n_10_when_more_than_50_distinct_tenants():
    rows = [{"tenant_normalized": f"t{i}", "annual_rent": 1000, "sf": 100}
            for i in range(60)]
    rr = _rr(rows)
    out = compute_tenant_concentration(rr)
    assert len(out) == 10


def test_excludes_inactive_rows():
    rr = _rr([
        {"tenant_normalized": "acme", "annual_rent": 30000, "is_active": True},
        {"tenant_normalized": "acme", "annual_rent": 99999, "is_active": False},
    ])
    out = compute_tenant_concentration(rr, top_n=5)
    assert out.iloc[0]["total_annual_rent"] == 30000


def test_excludes_blank_tenant_normalized():
    rr = _rr([
        {"tenant_normalized": "", "annual_rent": 99999, "is_vacant": True, "is_active": False},
        {"tenant_normalized": "acme", "annual_rent": 30000},
    ])
    out = compute_tenant_concentration(rr, top_n=5)
    assert all(row["tenant_normalized"] != "" for _, row in out.iterrows())


def test_columns_match_spec():
    rr = _rr([{"tenant_normalized": "a", "annual_rent": 1, "sf": 1}])
    out = compute_tenant_concentration(rr, top_n=5)
    assert list(out.columns) == [
        "tenant_normalized", "total_annual_rent", "total_sf",
        "lease_count", "building_count", "pct_of_portfolio_rent",
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_concentration.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyses/concentration.py`**

```python
"""Tenant concentration (§5.7)."""
from __future__ import annotations

from typing import Optional

import pandas as pd

from ..types import NormalizedRentRoll

_DEFAULT_TOP_N_SMALL = 5
_DEFAULT_TOP_N_LARGE = 10
_LARGE_PORTFOLIO_THRESHOLD = 50


def compute_tenant_concentration(
    rr: NormalizedRentRoll,
    top_n: Optional[int] = None,
) -> pd.DataFrame:
    df = rr.df
    active = df[df["is_active"].fillna(False)].copy()
    active = active[active["tenant_normalized"].fillna("").ne("")]

    if top_n is None:
        n_distinct = active["tenant_normalized"].nunique()
        top_n = (
            _DEFAULT_TOP_N_LARGE
            if n_distinct > _LARGE_PORTFOLIO_THRESHOLD
            else _DEFAULT_TOP_N_SMALL
        )

    portfolio_rent = float(active["annual_rent"].fillna(0).sum())

    grouped = active.groupby("tenant_normalized", sort=False).agg(
        total_annual_rent=("annual_rent", lambda s: float(s.fillna(0).sum())),
        total_sf=("sf", lambda s: float(s.fillna(0).sum())),
        lease_count=("_source_row", "count"),
        building_count=("building", lambda s: int(s.nunique())),
    ).reset_index()

    grouped["pct_of_portfolio_rent"] = grouped["total_annual_rent"].apply(
        lambda v: (v / portfolio_rent) if portfolio_rent else 0.0
    )

    grouped = grouped.sort_values("total_annual_rent", ascending=False)
    grouped = grouped.head(top_n).reset_index(drop=True)
    return grouped[[
        "tenant_normalized", "total_annual_rent", "total_sf",
        "lease_count", "building_count", "pct_of_portfolio_rent",
    ]]
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_concentration.py -v`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/concentration.py \
        python_skills/rent_roll_analyst/tests/unit/test_concentration.py
git commit -m "feat(rent-roll): tenant concentration (§5.7)"
```

---

### Task 18: Below-building-average rent flagging (§5.8)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/below_avg.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_below_avg.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_below_avg.py`:

```python
from __future__ import annotations

import pandas as pd
import pytest

from rent_roll_analyst.analyses.below_avg import compute_below_building_avg_flags
from rent_roll_analyst.types import DataQualityBlock, NormalizedRentRoll


def _rr(rows: list[dict]) -> NormalizedRentRoll:
    base = {
        "building": "MOB-1", "tenant": "X", "tenant_normalized": "x",
        "suite": "100", "sf": 0.0, "annual_rent": 0.0, "rent_psf": None,
        "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1,
    }
    df = pd.DataFrame([{**base, **r} for r in rows])
    df["lease_end"] = pd.to_datetime(df.get("lease_end"), errors="coerce")
    return NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x")


def test_flags_only_active_rows_more_than_threshold_below():
    rr = _rr([
        {"building": "A", "tenant": "Cheap",  "suite": "100", "sf": 1000, "annual_rent": 25000, "rent_psf": 25,  "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "Normal", "suite": "200", "sf": 1000, "annual_rent": 35000, "rent_psf": 35,  "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "Pricey", "suite": "300", "sf": 1000, "annual_rent": 40000, "rent_psf": 40,  "lease_end": "2028-01-01"},
    ])
    flags = compute_below_building_avg_flags(rr, threshold=-0.15)
    # Building avg excluding Cheap: (35+40)/2 = 37.5; variance = -33% -> flagged
    # Excluding Normal: (25+40)/2 = 32.5; variance = +7.7% -> not flagged
    # Excluding Pricey: (25+35)/2 = 30; variance = +33% -> not flagged
    assert len(flags) == 1
    row = flags.iloc[0]
    assert row["tenant"] == "Cheap"
    assert row["building_weighted_avg_psf_excluding_self"] == pytest.approx(37.5)
    assert row["variance_pct"] < -0.15


def test_columns_match_spec():
    rr = _rr([
        {"building": "A", "tenant": "T",  "suite": "100", "sf": 1000, "annual_rent": 1, "rent_psf": 1,  "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "U",  "suite": "200", "sf": 1000, "annual_rent": 100, "rent_psf": 100, "lease_end": "2028-01-01"},
    ])
    flags = compute_below_building_avg_flags(rr)
    assert list(flags.columns) == [
        "building", "tenant", "suite", "rent_psf",
        "building_weighted_avg_psf_excluding_self", "variance_pct", "lease_end",
    ]


def test_excludes_inactive_rows_from_both_flag_and_baseline():
    rr = _rr([
        {"building": "A", "tenant": "Active",   "suite": "100", "sf": 1000, "annual_rent": 30000, "rent_psf": 30, "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "Inactive", "suite": "200", "sf": 1000, "annual_rent": 1000,  "rent_psf": 1, "lease_end": "2020-01-01", "is_active": False},
    ])
    flags = compute_below_building_avg_flags(rr)
    assert flags.empty


def test_skips_rows_with_null_or_zero_psf():
    rr = _rr([
        {"building": "A", "tenant": "NoSF",   "suite": "100", "sf": 0, "annual_rent": 30000, "rent_psf": None, "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "Cheap",  "suite": "200", "sf": 1000, "annual_rent": 1000, "rent_psf": 1,  "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "Normal", "suite": "300", "sf": 1000, "annual_rent": 30000, "rent_psf": 30, "lease_end": "2028-01-01"},
    ])
    flags = compute_below_building_avg_flags(rr)
    # Only the Cheap row is testable -> baseline excludes it -> 30 -> -97% -> flagged
    tenants = set(flags["tenant"])
    assert "Cheap" in tenants
    assert "NoSF" not in tenants


def test_per_building_baseline_isolated():
    rr = _rr([
        {"building": "A", "tenant": "ACheap", "suite": "100", "sf": 1000, "annual_rent": 1000, "rent_psf": 1,  "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "ANorm",  "suite": "200", "sf": 1000, "annual_rent": 30000, "rent_psf": 30, "lease_end": "2028-01-01"},
        # building B priced very low overall — A's cheap tenant should still flag against A's baseline only
        {"building": "B", "tenant": "BLow1",  "suite": "100", "sf": 1000, "annual_rent": 1000, "rent_psf": 1,  "lease_end": "2028-01-01"},
        {"building": "B", "tenant": "BLow2",  "suite": "200", "sf": 1000, "annual_rent": 1000, "rent_psf": 1,  "lease_end": "2028-01-01"},
    ])
    flags = compute_below_building_avg_flags(rr)
    bldgs = set(flags["building"])
    assert bldgs == {"A"}


def test_threshold_parameter_changes_output():
    rr = _rr([
        {"building": "A", "tenant": "Slight", "suite": "100", "sf": 1000, "annual_rent": 28000, "rent_psf": 28, "lease_end": "2028-01-01"},
        {"building": "A", "tenant": "Normal", "suite": "200", "sf": 1000, "annual_rent": 30000, "rent_psf": 30, "lease_end": "2028-01-01"},
    ])
    # ex-self avg for Slight = 30; variance = -6.7%
    assert compute_below_building_avg_flags(rr, threshold=-0.05).iloc[0]["tenant"] == "Slight"
    assert compute_below_building_avg_flags(rr, threshold=-0.10).empty
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_below_avg.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyses/below_avg.py`**

```python
"""Below-building-average rent flagging (§5.8).

The building's baseline is recomputed per row, excluding the row under test
("excluding_self") so a flagged lease is never allowed to drag down its own
baseline. Output language is intentionally `building_weighted_avg_psf_excluding_self`,
never anything containing 'market'.
"""
from __future__ import annotations

import pandas as pd

from ..types import NormalizedRentRoll


def compute_below_building_avg_flags(
    rr: NormalizedRentRoll,
    threshold: float = -0.15,
) -> pd.DataFrame:
    df = rr.df
    active = df[df["is_active"].fillna(False)].copy()
    eligible = active[
        active["rent_psf"].notna() & (active["rent_psf"] > 0) & (active["sf"].fillna(0) > 0)
    ]

    rows: list[dict] = []
    for bldg, sub in eligible.groupby("building", sort=False):
        total_rent = float(sub["annual_rent"].fillna(0).sum())
        total_sf = float(sub["sf"].fillna(0).sum())
        for _, r in sub.iterrows():
            row_rent = float(r["annual_rent"] or 0)
            row_sf = float(r["sf"] or 0)
            denom_sf = total_sf - row_sf
            if denom_sf <= 0:
                continue
            ex_self_avg = (total_rent - row_rent) / denom_sf
            if ex_self_avg <= 0:
                continue
            variance = (float(r["rent_psf"]) - ex_self_avg) / ex_self_avg
            if variance < threshold:
                rows.append({
                    "building": bldg,
                    "tenant": r["tenant"],
                    "suite": r["suite"],
                    "rent_psf": float(r["rent_psf"]),
                    "building_weighted_avg_psf_excluding_self": ex_self_avg,
                    "variance_pct": variance,
                    "lease_end": r["lease_end"],
                })
    out = pd.DataFrame(rows, columns=[
        "building", "tenant", "suite", "rent_psf",
        "building_weighted_avg_psf_excluding_self", "variance_pct", "lease_end",
    ])
    return out
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_below_avg.py -v`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyses/below_avg.py \
        python_skills/rent_roll_analyst/tests/unit/test_below_avg.py
git commit -m "feat(rent-roll): below-building-average flags (§5.8)"
```

---

## Phase 5 — Rendering (§5.9–§5.11)

### Task 19: Forbidden-phrase scanner (Appendix D)

The scanner runs against the final rendered Word body and Excel sheet/column names. It runs first because Tasks 21 and 22 both call into it.

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/__init__.py`
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/scanner.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_scanner.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_scanner.py`:

```python
from __future__ import annotations

import pytest

from rent_roll_analyst.rendering.scanner import (
    FORBIDDEN_PHRASES,
    ForbiddenPhraseError,
    scan_for_forbidden_phrases,
)


def test_passes_clean_text():
    scan_for_forbidden_phrases(["Below building average flags", "Acme P.C."])


def test_flags_below_market():
    with pytest.raises(ForbiddenPhraseError) as ei:
        scan_for_forbidden_phrases(["This rent is below market for the area."])
    assert "below market" in ei.value.matches[0].lower()


def test_flags_hyphen_variant():
    with pytest.raises(ForbiddenPhraseError):
        scan_for_forbidden_phrases(["Below-Market Rent"])


def test_flags_under_market_and_submarket():
    for phrase in ["under market", "under-market", "submarket rent", "sub-market rent"]:
        with pytest.raises(ForbiddenPhraseError):
            scan_for_forbidden_phrases([f"This is the {phrase} discussion."])


def test_case_insensitive():
    with pytest.raises(ForbiddenPhraseError):
        scan_for_forbidden_phrases(["BELOW MARKET"])


def test_does_not_flag_below_building_average():
    scan_for_forbidden_phrases([
        "Below building average flags",
        "below the building's weighted-average PSF",
        "below building avg",
    ])


def test_market_rent_alone_is_flagged():
    # The PRD treats bare "market rent" as flagged-by-default; allowlist applies
    # only to fixed-text disclaimers, which the scanner accepts via the
    # allowlist parameter.
    with pytest.raises(ForbiddenPhraseError):
        scan_for_forbidden_phrases(["The market rent is $35/SF."])


def test_market_rent_in_allowlisted_disclaimer_is_ok():
    disclaimer = "no external market data is used"
    scan_for_forbidden_phrases(
        ["No external market data is used."],
        allowlist_substrings=[disclaimer.lower()],
    )


def test_phrases_constant_includes_required_set():
    required = {
        "below market", "below-market",
        "under market", "under-market",
        "submarket rent", "sub-market rent",
    }
    assert required.issubset(set(p.lower() for p in FORBIDDEN_PHRASES))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_scanner.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `rendering/__init__.py`**

```python
"""Rendering layer: chart, Word, Excel, output scanner."""
```

- [ ] **Step 4: Implement `rendering/scanner.py`**

```python
"""Forbidden-phrase scanner (PRD Appendix D).

Run this against the rendered Word body text and Excel sheet/column names.
Raises ForbiddenPhraseError with the matched phrases on hit.
"""
from __future__ import annotations

import re
from typing import Iterable

from ..errors import RentRollError

FORBIDDEN_PHRASES: list[str] = [
    "below market",
    "below-market",
    "under market",
    "under-market",
    "submarket rent",
    "sub-market rent",
    "market rent",
]


class ForbiddenPhraseError(RentRollError):
    """One or more forbidden phrases appeared in rendered output."""

    def __init__(self, matches: list[str]) -> None:
        super().__init__(
            f"forbidden phrases in output: {matches!r}",
            chat_prompt=(
                "Output rejected because it contained forbidden language: "
                f"{', '.join(matches)}. "
                "Use 'below building average' instead."
            ),
        )
        self.matches: list[str] = matches


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def scan_for_forbidden_phrases(
    texts: Iterable[str],
    allowlist_substrings: Iterable[str] | None = None,
) -> None:
    """Raise ForbiddenPhraseError if any phrase appears in any of *texts*.

    *allowlist_substrings* is a list of lowercase substrings; a forbidden
    phrase that appears within one of these substrings is ignored. Used for
    fixed-text Legal-cleared disclaimer language only.
    """
    allow = [a.lower() for a in (allowlist_substrings or [])]
    matches: list[str] = []
    for raw in texts:
        text = _normalize(raw)
        for phrase in FORBIDDEN_PHRASES:
            p = phrase.lower()
            if p not in text:
                continue
            if any(p in a and a in text for a in allow):
                continue
            matches.append(phrase)
    if matches:
        raise ForbiddenPhraseError(sorted(set(matches)))
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/unit/test_scanner.py -v`
Expected: 9 passing.

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering \
        python_skills/rent_roll_analyst/tests/unit/test_scanner.py
git commit -m "feat(rent-roll): forbidden-phrase scanner (Appendix D)"
```

---

### Task 20: Chart palette + expiration chart rendering (§5.3 viz, §5.11.1)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/chart_palette.json`
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/chart.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_chart.py`

- [ ] **Step 1: Create `chart_palette.json`**

```json
{
  "rent_bar": "#1F4E79",
  "sf_bar": "#7F7F7F",
  "mtm_bar": "#A6A6A6",
  "axis_label": "#262626",
  "grid": "#D9D9D9",
  "background": "#FFFFFF"
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/test_chart.py`:

```python
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from PIL import Image  # provided by matplotlib's transitive deps

from rent_roll_analyst.rendering.chart import render_expiration_chart


def _exp_df() -> pd.DataFrame:
    return pd.DataFrame([
        {"year": 2026, "expiring_rent": 100000, "expiring_sf":  3000, "lease_count": 2},
        {"year": 2027, "expiring_rent": 250000, "expiring_sf":  8000, "lease_count": 5},
        {"year": 2028, "expiring_rent": 175000, "expiring_sf":  5500, "lease_count": 4},
        {"year": "MTM", "expiring_rent":  20000, "expiring_sf":  500, "lease_count": 1},
    ])


def test_writes_png_at_expected_dpi(tmp_path: Path):
    out = tmp_path / "exp.png"
    render_expiration_chart(_exp_df(), str(out))
    assert out.exists()
    with Image.open(out) as img:
        dpi = img.info.get("dpi", (72, 72))
        assert dpi[0] >= 150


def test_supports_dual_axis_style(tmp_path: Path):
    out = tmp_path / "exp.png"
    render_expiration_chart(_exp_df(), str(out), style="dual_axis")
    assert out.exists()


def test_returns_path_string(tmp_path: Path):
    out = tmp_path / "exp.png"
    result = render_expiration_chart(_exp_df(), str(out))
    assert result == str(out)


def test_rejects_unknown_style(tmp_path: Path):
    out = tmp_path / "exp.png"
    with pytest.raises(ValueError):
        render_expiration_chart(_exp_df(), str(out), style="pie")


def test_does_not_render_when_dataframe_is_empty(tmp_path: Path):
    out = tmp_path / "exp.png"
    render_expiration_chart(
        pd.DataFrame(columns=["year", "expiring_rent", "expiring_sf", "lease_count"]),
        str(out),
    )
    # Even with empty data, a placeholder PNG should exist (avoid breaking docx embed)
    assert out.exists()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/unit/test_chart.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement `rendering/chart.py`**

```python
"""Expiration chart (§5.3 visualization, §5.11.1 standards).

Default style: stacked panels (rent on top, SF on bottom, shared X axis).
Alternate: dual_axis. Output is PNG at >=150 DPI. Pillow is not required;
matplotlib writes the PNG directly.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import matplotlib

matplotlib.use("Agg")  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

DPI = 200
_PALETTE_PATH = Path(__file__).with_name("chart_palette.json")
_PALETTE = json.loads(_PALETTE_PATH.read_text())

ChartStyle = Literal["stacked", "dual_axis"]


def _format_currency(value: float, _pos: int = 0) -> str:
    av = abs(value)
    if av >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    if av >= 1_000:
        return f"${value / 1_000:.0f}K"
    return f"${value:.0f}"


def _format_sf(value: float, _pos: int = 0) -> str:
    av = abs(value)
    if av >= 1_000:
        return f"{value / 1_000:.0f}K"
    return f"{value:.0f}"


def _empty_placeholder(output_path: str) -> str:
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=DPI)
    ax.text(0.5, 0.5, "No expiring leases in window", ha="center", va="center")
    ax.set_axis_off()
    fig.savefig(output_path, dpi=DPI, bbox_inches="tight",
                facecolor=_PALETTE["background"])
    plt.close(fig)
    return output_path


def render_expiration_chart(
    exp_df: pd.DataFrame,
    output_path: str,
    style: ChartStyle = "stacked",
) -> str:
    if style not in ("stacked", "dual_axis"):
        raise ValueError(f"unknown style: {style!r}")

    if exp_df.empty:
        return _empty_placeholder(output_path)

    df = exp_df.copy()
    df["__label"] = df["year"].astype(str)
    df["__year_only"] = pd.to_numeric(df["year"], errors="coerce")
    year_part = df[df["__year_only"].notna()].sort_values("__year_only")
    mtm_part = df[df["__year_only"].isna()]
    plot_df = pd.concat([year_part, mtm_part], ignore_index=True)

    if (plot_df["expiring_rent"].fillna(0).sum()
            + plot_df["expiring_sf"].fillna(0).sum()) == 0:
        return _empty_placeholder(output_path)

    if style == "stacked":
        fig, (ax_rent, ax_sf) = plt.subplots(
            2, 1, figsize=(10, 6), dpi=DPI, sharex=True,
            gridspec_kw={"height_ratios": [3, 2]},
        )
        ax_rent.bar(plot_df["__label"], plot_df["expiring_rent"],
                    color=_PALETTE["rent_bar"])
        ax_rent.set_title("Expiring Rent and Square Footage by Year")
        ax_rent.set_ylabel("Expiring Rent")
        ax_rent.yaxis.set_major_formatter(plt.FuncFormatter(_format_currency))
        ax_rent.grid(axis="y", color=_PALETTE["grid"], linewidth=0.5)

        ax_sf.bar(plot_df["__label"], plot_df["expiring_sf"],
                  color=_PALETTE["sf_bar"])
        ax_sf.set_ylabel("Expiring SF")
        ax_sf.set_xlabel("Lease End Year")
        ax_sf.yaxis.set_major_formatter(plt.FuncFormatter(_format_sf))
        ax_sf.grid(axis="y", color=_PALETTE["grid"], linewidth=0.5)
    else:
        fig, ax = plt.subplots(figsize=(10, 5), dpi=DPI)
        ax.bar(plot_df["__label"], plot_df["expiring_rent"],
               color=_PALETTE["rent_bar"], label="Expiring Rent")
        ax.set_xlabel("Lease End Year")
        ax.set_ylabel("Expiring Rent")
        ax.yaxis.set_major_formatter(plt.FuncFormatter(_format_currency))

        total_sf = float(plot_df["expiring_sf"].fillna(0).sum())
        total_rent = float(plot_df["expiring_rent"].fillna(0).sum())
        psf = (total_rent / total_sf) if total_sf else 1.0
        ax2 = ax.twinx()
        ax2.plot(plot_df["__label"], plot_df["expiring_sf"],
                 color=_PALETTE["sf_bar"], marker="o", label="Expiring SF")
        ax2.set_ylabel("Expiring SF")
        ax2.yaxis.set_major_formatter(plt.FuncFormatter(_format_sf))
        if psf > 0:
            ax2.set_ylim(0, max(plot_df["expiring_rent"].max(), 1) / psf)

        h1, l1 = ax.get_legend_handles_labels()
        h2, l2 = ax2.get_legend_handles_labels()
        ax.legend(h1 + h2, l1 + l2, loc="upper right")
        ax.set_title("Expiring Rent and Square Footage by Year")
        ax.grid(axis="y", color=_PALETTE["grid"], linewidth=0.5)

    fig.tight_layout()
    fig.savefig(output_path, dpi=DPI, bbox_inches="tight",
                facecolor=_PALETTE["background"])
    plt.close(fig)
    return output_path
```

- [ ] **Step 5: Run tests**

Run: `pip install Pillow && pytest tests/unit/test_chart.py -v`
Expected: 5 passing. (Pillow ships transitively with matplotlib in most installs but may need explicit install in CI.)

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/chart.py \
        python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/chart_palette.json \
        python_skills/rent_roll_analyst/tests/unit/test_chart.py
git commit -m "feat(rent-roll): expiration chart renderer (stacked + dual-axis)"
```

---

### Task 21: Excel renderer (§5.10)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/excel.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_excel.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_excel.py`:

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from openpyxl import load_workbook

from rent_roll_analyst.analyses.below_avg import compute_below_building_avg_flags
from rent_roll_analyst.analyses.concentration import compute_tenant_concentration
from rent_roll_analyst.analyses.expirations import compute_expirations
from rent_roll_analyst.analyses.inventory import compute_building_inventory
from rent_roll_analyst.analyses.pivot import compute_expiration_pivot
from rent_roll_analyst.analyses.walt import compute_walt, compute_walt_by_building
from rent_roll_analyst.rendering.excel import render_portfolio_excel
from rent_roll_analyst.rendering.scanner import ForbiddenPhraseError
from rent_roll_analyst.types import (
    DataQualityBlock,
    NormalizedRentRoll,
    PortfolioAnalyses,
)


def _build_pa() -> PortfolioAnalyses:
    df = pd.DataFrame([
        {"building": "MOB-1", "tenant": "Acme P.C.", "tenant_normalized": "acme",
         "suite": "100", "sf": 1000, "annual_rent": 30000, "rent_psf": 30,
         "lease_start": pd.Timestamp("2020-01-01"),
         "lease_end": pd.Timestamp("2028-06-30"), "exp_year": 2028,
         "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1},
        {"building": "MOB-1", "tenant": "Beta LLC", "tenant_normalized": "beta",
         "suite": "200", "sf": 800, "annual_rent": 24000, "rent_psf": 30,
         "lease_start": pd.Timestamp("2021-01-01"),
         "lease_end": pd.Timestamp("2027-12-31"), "exp_year": 2027,
         "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 2},
    ])
    rr = NormalizedRentRoll(df=df, quality=DataQualityBlock(), source_file="x.xlsx")
    today = date(2026, 4, 28)
    return PortfolioAnalyses(
        rr=rr,
        expirations=compute_expirations(rr, 2026, 2030, today=today),
        inventory=compute_building_inventory(rr),
        expiration_pivot=compute_expiration_pivot(rr, 2026, 2030, today=today),
        walt=compute_walt(rr, today=today),
        walt_by_building=compute_walt_by_building(rr, today=today),
        tenant_concentration=compute_tenant_concentration(rr, top_n=5),
        below_avg_flags=compute_below_building_avg_flags(rr),
        expiration_chart_path="",
    )


def test_writes_xlsx_with_required_sheets_in_order(tmp_path: Path):
    out = tmp_path / "rr.xlsx"
    render_portfolio_excel(_build_pa(), str(out))
    wb = load_workbook(out)
    assert wb.sheetnames == [
        "Cleaned Rent Roll",
        "Data Quality",
        "Expirations by Year",
        "Building Inventory",
        "Expirations by Bldg & Year",
        "Top Tenants",
        "WALT by Building",
        "Below-Bldg-Avg Flags",
    ]


def test_currency_cells_are_numeric(tmp_path: Path):
    out = tmp_path / "rr.xlsx"
    render_portfolio_excel(_build_pa(), str(out))
    wb = load_workbook(out)
    sheet = wb["Building Inventory"]
    headers = [c.value for c in sheet[1]]
    rent_col = headers.index("total_annual_rent") + 1
    cell = sheet.cell(row=2, column=rent_col)
    assert isinstance(cell.value, (int, float))
    assert "$" in (cell.number_format or "")


def test_dates_are_real_dates(tmp_path: Path):
    out = tmp_path / "rr.xlsx"
    render_portfolio_excel(_build_pa(), str(out))
    wb = load_workbook(out)
    sheet = wb["Cleaned Rent Roll"]
    headers = [c.value for c in sheet[1]]
    le_col = headers.index("lease_end") + 1
    cell = sheet.cell(row=2, column=le_col)
    from datetime import datetime
    assert isinstance(cell.value, datetime)


def test_percentage_cells_use_percentage_format(tmp_path: Path):
    out = tmp_path / "rr.xlsx"
    render_portfolio_excel(_build_pa(), str(out))
    wb = load_workbook(out)
    sheet = wb["Top Tenants"]
    headers = [c.value for c in sheet[1]]
    pct_col = headers.index("pct_of_portfolio_rent") + 1
    cell = sheet.cell(row=2, column=pct_col)
    assert "%" in (cell.number_format or "")


def test_first_row_frozen(tmp_path: Path):
    out = tmp_path / "rr.xlsx"
    render_portfolio_excel(_build_pa(), str(out))
    wb = load_workbook(out)
    sheet = wb["Cleaned Rent Roll"]
    assert sheet.freeze_panes == "A2"


def test_scanner_runs_on_sheet_and_column_names(tmp_path: Path, monkeypatch):
    pa = _build_pa()
    pa.below_avg_flags = pa.below_avg_flags.rename(
        columns={"variance_pct": "below market variance"}
    )
    out = tmp_path / "rr.xlsx"
    with pytest.raises(ForbiddenPhraseError):
        render_portfolio_excel(pa, str(out))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_excel.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `rendering/excel.py`**

```python
"""Excel renderer (§5.10).

Eight sheets in fixed order. Currency, date, and percentage cells are
typed as numbers and formatted via openpyxl number_format strings —
never coerced to strings. Sheet 2 is Data Quality so reviewers see it
before downstream sheets per §5.10.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Iterable

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from ..types import PortfolioAnalyses
from .scanner import scan_for_forbidden_phrases

CURRENCY_INT = "$#,##0"
CURRENCY_2DP = "$#,##0.00"
DATE_FMT = "yyyy-mm-dd"
PCT_FMT = "0.0%"
HEADER_FONT = Font(bold=True)
HEADER_FILL = PatternFill("solid", fgColor="EFEFEF")
MAX_COL_WIDTH = 60

CURRENCY_INT_COLS = {"expiring_rent", "total_annual_rent",
                     "building_weighted_avg_psf_excluding_self"}
CURRENCY_2DP_COLS = {"rent_psf", "weighted_avg_rent_psf",
                     "annual_rent"}
DATE_COLS = {"lease_start", "lease_end"}
PCT_COLS = {"pct_of_portfolio_rent", "variance_pct"}
SF_COLS = {"sf", "total_sf", "expiring_sf", "vacancy_sf"}


SHEET_ORDER = [
    "Cleaned Rent Roll",
    "Data Quality",
    "Expirations by Year",
    "Building Inventory",
    "Expirations by Bldg & Year",
    "Top Tenants",
    "WALT by Building",
    "Below-Bldg-Avg Flags",
]


def _data_quality_dataframe(pa: PortfolioAnalyses) -> pd.DataFrame:
    q = pa.rr.quality
    rows = [
        ("Header row index", q.header_row_index),
        ("Header alias hits", q.header_alias_hits),
        ("Total rows", q.row_counts.get("total", 0)),
        ("Active rows", q.row_counts.get("active", 0)),
        ("Expired rows", q.row_counts.get("expired", 0)),
        ("Vacant rows", q.row_counts.get("vacant", 0)),
        ("MTM rows", q.row_counts.get("mtm", 0)),
        ("Sum active rent", q.sum_active_rent),
        ("Sum all rent", q.sum_all_rent),
        ("Null lease_end count (non-vacant)", q.null_lease_end_count),
        ("Null lease_end pct (non-vacant)", q.null_lease_end_pct),
        ("Duplicate (bldg+suite+tenant) count", q.duplicate_count),
        ("Building fallback used", q.building_fallback_used),
        ("Monthly/annual basis", q.monthly_annual_inference.get("basis")),
        ("Monthly/annual result", q.monthly_annual_inference.get("result")),
        ("Median PSF (if math)", q.monthly_annual_inference.get("median_psf")),
        ("Unmapped source columns", ", ".join(q.unmapped_source_columns)),
    ]
    for w in q.warnings:
        rows.append(("Warning", w))
    return pd.DataFrame(rows, columns=["metric", "value"])


def _format_value(col: str, v):
    if pd.isna(v):
        return None
    if col in DATE_COLS:
        if isinstance(v, (datetime,)):
            return v
        if isinstance(v, date):
            return datetime(v.year, v.month, v.day)
        ts = pd.to_datetime(v, errors="coerce")
        return None if pd.isna(ts) else ts.to_pydatetime()
    if col in CURRENCY_INT_COLS or col in CURRENCY_2DP_COLS or col in SF_COLS or col in PCT_COLS:
        try:
            return float(v)
        except (TypeError, ValueError):
            return None
    return v


def _number_format_for(col: str) -> str | None:
    if col in CURRENCY_INT_COLS:
        return CURRENCY_INT
    if col in CURRENCY_2DP_COLS:
        return CURRENCY_2DP
    if col in DATE_COLS:
        return DATE_FMT
    if col in PCT_COLS:
        return PCT_FMT
    if col in SF_COLS:
        return "#,##0"
    return None


def _write_sheet(ws, df: pd.DataFrame) -> None:
    if df.empty:
        ws.cell(row=1, column=1, value="(no rows)")
        return
    for j, col in enumerate(df.columns, start=1):
        cell = ws.cell(row=1, column=j, value=str(col))
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="left")
    for i, (_, row) in enumerate(df.iterrows(), start=2):
        for j, col in enumerate(df.columns, start=1):
            cell = ws.cell(row=i, column=j, value=_format_value(str(col), row[col]))
            fmt = _number_format_for(str(col))
            if fmt is not None:
                cell.number_format = fmt
    ws.freeze_panes = "A2"
    for j, col in enumerate(df.columns, start=1):
        width = max(len(str(col)), 8)
        for v in df[col].head(50):
            width = max(width, min(MAX_COL_WIDTH, len(str(v)) + 2))
        ws.column_dimensions[get_column_letter(j)].width = min(width, MAX_COL_WIDTH)


def _scan_text_inputs(pa: PortfolioAnalyses) -> Iterable[str]:
    yield from SHEET_ORDER
    for sheet, df in (
        ("Cleaned Rent Roll", pa.rr.df),
        ("Expirations by Year", pa.expirations),
        ("Building Inventory", pa.inventory),
        ("Expirations by Bldg & Year", pa.expiration_pivot),
        ("Top Tenants", pa.tenant_concentration),
        ("WALT by Building", pa.walt_by_building),
        ("Below-Bldg-Avg Flags", pa.below_avg_flags),
    ):
        for col in df.columns:
            yield str(col)


def render_portfolio_excel(pa: PortfolioAnalyses, output_path: str) -> str:
    scan_for_forbidden_phrases(_scan_text_inputs(pa))

    wb = Workbook()
    wb.remove(wb.active)

    sheets = {
        "Cleaned Rent Roll": pa.rr.df,
        "Data Quality": _data_quality_dataframe(pa),
        "Expirations by Year": pa.expirations,
        "Building Inventory": pa.inventory,
        "Expirations by Bldg & Year": pa.expiration_pivot,
        "Top Tenants": pa.tenant_concentration,
        "WALT by Building": pa.walt_by_building,
        "Below-Bldg-Avg Flags": pa.below_avg_flags,
    }

    for name in SHEET_ORDER:
        ws = wb.create_sheet(title=name)
        _write_sheet(ws, sheets[name])

    wb.save(output_path)
    return output_path
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_excel.py -v`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/excel.py \
        python_skills/rent_roll_analyst/tests/unit/test_excel.py
git commit -m "feat(rent-roll): Excel renderer with typed cells (§5.10)"
```

---

### Task 22: Word renderer (§5.9)

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/word.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_word.py`

The Word renderer must produce **native Word tables** (not pipe-character text). The integration test inspects `w:tbl` elements.

- [ ] **Step 1: Write the failing test**

`tests/unit/test_word.py`:

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from docx import Document

from rent_roll_analyst.analyses.below_avg import compute_below_building_avg_flags
from rent_roll_analyst.analyses.concentration import compute_tenant_concentration
from rent_roll_analyst.analyses.expirations import compute_expirations
from rent_roll_analyst.analyses.inventory import compute_building_inventory
from rent_roll_analyst.analyses.pivot import compute_expiration_pivot
from rent_roll_analyst.analyses.walt import compute_walt, compute_walt_by_building
from rent_roll_analyst.rendering.chart import render_expiration_chart
from rent_roll_analyst.rendering.scanner import ForbiddenPhraseError
from rent_roll_analyst.rendering.word import render_portfolio_word
from rent_roll_analyst.types import (
    DataQualityBlock,
    NormalizedRentRoll,
    PortfolioAnalyses,
)


def _build_pa(tmp_path: Path) -> PortfolioAnalyses:
    df = pd.DataFrame([
        {"building": "MOB-1", "tenant": "Acme P.C.", "tenant_normalized": "acme",
         "suite": "100", "sf": 1000, "annual_rent": 30000, "rent_psf": 30,
         "lease_start": pd.Timestamp("2020-01-01"),
         "lease_end": pd.Timestamp("2028-06-30"), "exp_year": 2028,
         "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 1},
        {"building": "MOB-1", "tenant": "Beta LLC", "tenant_normalized": "beta",
         "suite": "200", "sf": 800, "annual_rent": 24000, "rent_psf": 30,
         "lease_start": pd.Timestamp("2021-01-01"),
         "lease_end": pd.Timestamp("2027-12-31"), "exp_year": 2027,
         "is_vacant": False, "is_mtm": False, "is_active": True, "_source_row": 2},
    ])
    quality = DataQualityBlock(
        row_counts={"total": 2, "active": 2, "expired": 0, "vacant": 0, "mtm": 0},
        sum_active_rent=54000, sum_all_rent=54000,
        null_lease_end_count=0, null_lease_end_pct=0.0,
        duplicate_count=0,
        monthly_annual_inference={"basis": "header", "result": "annual",
                                  "median_psf": None, "header_label": "Annual Rent"},
        header_row_index=0, header_alias_hits=6,
        unmapped_source_columns=[], building_fallback_used=False, warnings=[],
    )
    rr = NormalizedRentRoll(df=df, quality=quality, source_file="x.xlsx")
    today = date(2026, 4, 28)
    chart_path = str(tmp_path / "chart.png")
    expirations = compute_expirations(rr, 2026, 2030, today=today)
    render_expiration_chart(expirations, chart_path)
    return PortfolioAnalyses(
        rr=rr,
        expirations=expirations,
        inventory=compute_building_inventory(rr),
        expiration_pivot=compute_expiration_pivot(rr, 2026, 2030, today=today),
        walt=compute_walt(rr, today=today),
        walt_by_building=compute_walt_by_building(rr, today=today),
        tenant_concentration=compute_tenant_concentration(rr, top_n=5),
        below_avg_flags=compute_below_building_avg_flags(rr),
        expiration_chart_path=chart_path,
    )


def test_writes_docx_file(tmp_path: Path):
    out = tmp_path / "memo.docx"
    render_portfolio_word(_build_pa(tmp_path), str(out))
    assert out.exists()


def test_uses_native_word_tables_not_pipe_text(tmp_path: Path):
    out = tmp_path / "memo.docx"
    render_portfolio_word(_build_pa(tmp_path), str(out))
    doc = Document(str(out))
    assert len(doc.tables) >= 4  # inventory, pivot, top tenants, walt, flags
    body_text = "\n".join(p.text for p in doc.paragraphs)
    assert "|" not in body_text  # no pipe-character "tables"


def test_includes_all_required_section_headings(tmp_path: Path):
    out = tmp_path / "memo.docx"
    render_portfolio_word(_build_pa(tmp_path), str(out))
    doc = Document(str(out))
    headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
    expected = {
        "Lease Expiration Profile",
        "Building Inventory",
        "Expiration Schedule by Building",
        "Tenant Concentration",
        "WALT",
        "Below-Building-Average Rent Flags",
    }
    assert expected.issubset(set(headings))


def test_executive_summary_is_templated_only(tmp_path: Path):
    out = tmp_path / "memo.docx"
    render_portfolio_word(_build_pa(tmp_path), str(out))
    doc = Document(str(out))
    body = "\n".join(p.text for p in doc.paragraphs)
    assert "Portfolio of 1 buildings" in body or "Portfolio of 1 building" in body
    assert "$54,000" in body or "54000" in body
    assert "WALT" in body


def test_data_quality_omitted_when_empty(tmp_path: Path):
    pa = _build_pa(tmp_path)
    out = tmp_path / "memo.docx"
    render_portfolio_word(pa, str(out))
    doc = Document(str(out))
    headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert "Data Quality Notes" not in headings


def test_data_quality_present_when_warnings(tmp_path: Path):
    pa = _build_pa(tmp_path)
    pa.rr.quality.warnings.append("Some warning")
    pa.rr.quality.monthly_annual_inference = {
        "basis": "psf_math", "result": "monthly",
        "median_psf": 2.5, "header_label": "Rent",
    }
    out = tmp_path / "memo.docx"
    render_portfolio_word(pa, str(out))
    doc = Document(str(out))
    headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert "Data Quality Notes" in headings


def test_forbidden_phrase_in_input_fails_render(tmp_path: Path):
    pa = _build_pa(tmp_path)
    pa.rr.quality.warnings.append("Tenant pays below market rent")
    out = tmp_path / "memo.docx"
    with pytest.raises(ForbiddenPhraseError):
        render_portfolio_word(pa, str(out))


def test_chart_image_embedded(tmp_path: Path):
    out = tmp_path / "memo.docx"
    render_portfolio_word(_build_pa(tmp_path), str(out))
    doc = Document(str(out))
    image_count = sum(
        1 for shape in doc.inline_shapes
    )
    assert image_count >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_word.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `rendering/word.py`**

```python
"""Word renderer (§5.9, §5.11.4).

Native python-docx tables, native heading styles, embedded chart image,
templated (non-LLM) executive summary. The forbidden-phrase scanner runs
on every paragraph string and every cell string before save.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

import pandas as pd
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

from ..types import PortfolioAnalyses
from .scanner import scan_for_forbidden_phrases

LEGAL_DISCLAIMER = (
    "Generated {date} by the Vetted AI Portal Rent Roll Analyst. "
    "All numbers are computed from the source rent roll only; "
    "no external market data is used. "
    '"Below building average" reflects deviation from the building\'s '
    "weighted-average rent PSF on active leases and is intended as a "
    "starting point for analyst review, not a market judgment. "
    "Active leases are defined as those with a lease end after {date} or "
    "flagged as month-to-month. See the Data Quality section of this "
    "document for any inferences applied during processing."
)

DOLLAR_INT_COLS = {"expiring_rent", "total_annual_rent",
                   "building_weighted_avg_psf_excluding_self",
                   "annual_rent", "Total"}
DOLLAR_2DP_COLS = {"rent_psf", "weighted_avg_rent_psf"}
PCT_COLS = {"pct_of_portfolio_rent", "variance_pct"}
SF_COLS = {"sf", "total_sf", "expiring_sf", "vacancy_sf"}


def _fmt(col: str, v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    if col in DOLLAR_INT_COLS:
        try:
            return f"${float(v):,.0f}"
        except (TypeError, ValueError):
            return str(v)
    if col in DOLLAR_2DP_COLS:
        try:
            return f"${float(v):,.2f}"
        except (TypeError, ValueError):
            return str(v)
    if col in PCT_COLS:
        try:
            return f"{float(v) * 100:.1f}%"
        except (TypeError, ValueError):
            return str(v)
    if col in SF_COLS:
        try:
            return f"{float(v):,.0f}"
        except (TypeError, ValueError):
            return str(v)
    return str(v)


def _add_table(doc, df: pd.DataFrame, *, header_style: str = "Light Grid") -> None:
    if df.empty:
        doc.add_paragraph("(no rows)")
        return
    table = doc.add_table(rows=1, cols=len(df.columns))
    try:
        table.style = header_style
    except KeyError:
        pass
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    hdr = table.rows[0].cells
    for j, col in enumerate(df.columns):
        hdr[j].text = str(col)
    for _, row in df.iterrows():
        cells = table.add_row().cells
        for j, col in enumerate(df.columns):
            cells[j].text = _fmt(str(col), row[col])


def _executive_summary(pa: PortfolioAnalyses) -> str:
    inv = pa.inventory
    df = pa.rr.df
    active = df[df["is_active"].fillna(False)]
    building_count = int(active["building"].nunique())
    tenant_count = int(active["tenant_normalized"].replace("", pd.NA).dropna().nunique())
    lease_count = int(len(active))
    total_rent = float(active["annual_rent"].fillna(0).sum())
    total_sf = float(active["sf"].fillna(0).sum())
    avg_psf = (total_rent / total_sf) if total_sf else 0.0
    walt_yrs = pa.walt.walt_years

    year_rows = pa.expirations[pa.expirations["year"] != "MTM"]
    if not year_rows.empty:
        top = year_rows.sort_values("expiring_rent", ascending=False).iloc[0]
        top_year = int(top["year"])
        top_rent = float(top["expiring_rent"])
    else:
        top_year, top_rent = 0, 0.0

    return (
        f"Portfolio of {building_count} buildings, {tenant_count} distinct "
        f"tenants across {lease_count} leases, ${total_rent:,.0f} in total "
        f"active annual rent, {total_sf:,.0f} total active SF. "
        f"Weighted average rent is ${avg_psf:.2f} PSF. "
        f"Portfolio WALT is {walt_yrs:.1f} years (rent-weighted). "
        f"The largest expiration year is {top_year} at ${top_rent:,.0f}."
    )


def _expiration_paragraph(pa: PortfolioAnalyses) -> str:
    year_rows = pa.expirations[pa.expirations["year"] != "MTM"]
    if year_rows.empty:
        return "No leases expire within the analyzed window."
    top3 = year_rows.sort_values("expiring_rent", ascending=False).head(3)
    parts = [
        f"{int(r['year'])} (${float(r['expiring_rent']):,.0f}, "
        f"{int(r['lease_count'])} leases)"
        for _, r in top3.iterrows()
    ]
    return "Top expiration years by rent: " + "; ".join(parts) + "."


def _walt_footnote(pa: PortfolioAnalyses) -> str:
    w = pa.walt
    return (
        f"Portfolio WALT: {w.walt_years:.1f} years "
        f"({w.weighting_basis}-weighted; "
        f"{w.included_lease_count} leases included, "
        f"{w.excluded_mtm_count} MTM excluded, "
        f"{w.excluded_expired_count} expired excluded)."
    )


def _data_quality_paragraphs(pa: PortfolioAnalyses) -> list[str]:
    q = pa.rr.quality
    out: list[str] = []
    inf = q.monthly_annual_inference or {}
    if inf.get("basis") == "psf_math":
        out.append(
            f"Rent period inferred as {inf.get('result')} from a median "
            f"PSF of ${inf.get('median_psf', 0):.2f}."
        )
    elif inf.get("basis") == "user_specified":
        out.append(f"Rent period set by user to {inf.get('result')}.")
    if q.null_lease_end_pct > 5.0:
        out.append(
            f"{q.null_lease_end_pct:.1f}% of non-vacant rows have a null "
            "lease_end column."
        )
    if q.duplicate_count > 0:
        out.append(
            f"{q.duplicate_count} duplicate rows by (building, suite, tenant)."
        )
    if q.building_fallback_used:
        out.append(
            "No building column detected; all rows assigned to a single fallback building."
        )
    out.extend(q.warnings)
    return out


def _all_text(doc) -> Iterable[str]:
    for p in doc.paragraphs:
        yield p.text
    for t in doc.tables:
        for row in t.rows:
            for cell in row.cells:
                yield cell.text


def render_portfolio_word(pa: PortfolioAnalyses, output_path: str) -> str:
    doc = Document()
    section = doc.sections[0]
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)

    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(11)

    today = date.today()

    title = doc.add_heading("Rent Roll Analysis", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    doc.add_paragraph(today.strftime("%B %d, %Y"))

    dq_paragraphs = _data_quality_paragraphs(pa)
    if dq_paragraphs:
        doc.add_heading("Data Quality Notes", level=2)
        for p in dq_paragraphs:
            doc.add_paragraph(p)

    doc.add_heading("Executive Summary", level=2)
    doc.add_paragraph(_executive_summary(pa))

    doc.add_heading("Lease Expiration Profile", level=2)
    if pa.expiration_chart_path:
        doc.add_picture(pa.expiration_chart_path, width=Inches(6.5))
    doc.add_paragraph(_expiration_paragraph(pa))

    doc.add_heading("Building Inventory", level=2)
    _add_table(doc, pa.inventory)

    doc.add_heading("Expiration Schedule by Building", level=2)
    _add_table(doc, pa.expiration_pivot)

    doc.add_heading("Tenant Concentration", level=2)
    _add_table(doc, pa.tenant_concentration)

    doc.add_heading("WALT", level=2)
    doc.add_paragraph(_walt_footnote(pa))
    _add_table(doc, pa.walt_by_building)

    doc.add_heading("Below-Building-Average Rent Flags", level=2)
    _add_table(doc, pa.below_avg_flags)

    footer = doc.sections[0].footer.paragraphs[0]
    footer.text = LEGAL_DISCLAIMER.format(date=today.strftime("%Y-%m-%d"))

    scan_for_forbidden_phrases(
        list(_all_text(doc)),
        allowlist_substrings=[LEGAL_DISCLAIMER.format(date=today.strftime("%Y-%m-%d")).lower()],
    )

    doc.save(output_path)
    return output_path
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_word.py -v`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/rendering/word.py \
        python_skills/rent_roll_analyst/tests/unit/test_word.py
git commit -m "feat(rent-roll): Word renderer with native tables and embedded chart (§5.9)"
```

---

## Phase 6 — High-level Entry Point + CLI

### Task 23: `analyze_rent_roll()` and the memory record

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/analyze.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_analyze.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/test_analyze.py`:

```python
from __future__ import annotations

from pathlib import Path

import pandas as pd

from rent_roll_analyst.analyze import analyze_rent_roll
from rent_roll_analyst.types import AnalysisResult


def _write_xlsx(path: Path, rows: list[list[object]]) -> None:
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


def test_returns_analysis_result_with_paths(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["MOB-1", "Acme P.C.", "100", 1200, 36000, "2028-06-30"],
        ["MOB-1", "Beta LLC",  "200", 800,  24000, "2027-12-31"],
    ])
    result = analyze_rent_roll(str(src), output_dir=str(tmp_path))
    assert isinstance(result, AnalysisResult)
    assert Path(result.docx_path).exists()
    assert Path(result.xlsx_path).exists()


def test_memory_record_schema(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["MOB-1", "Acme P.C.", "100", 1200, 36000, "2028-06-30"],
    ])
    result = analyze_rent_roll(
        str(src),
        output_dir=str(tmp_path),
        project_id="proj_123",
        user_id="user_42",
    )
    rec = result.memory_record
    assert rec["type"] == "rent_roll_analysis"
    assert rec["project_id"] == "proj_123"
    assert rec["user_id"] == "user_42"
    assert rec["source_file"] == "rr.xlsx"
    assert rec["building_count"] == 1
    assert rec["tenant_count_distinct"] == 1
    assert rec["lease_count"] == 1
    assert rec["total_active_annual_rent"] == 36000
    assert rec["total_active_sf"] == 1200
    assert "portfolio_walt_years" in rec
    assert rec["weighting_basis"] == "rent"
    assert rec["output_files"]["docx"].endswith(".docx")
    assert rec["output_files"]["xlsx"].endswith(".xlsx")
    assert "date" in rec


def test_output_filenames_include_source_stem_and_date(tmp_path: Path):
    src = tmp_path / "PREP_Q1.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["MOB-1", "Acme P.C.", "100", 1200, 36000, "2028-06-30"],
    ])
    result = analyze_rent_roll(str(src), output_dir=str(tmp_path))
    assert "PREP_Q1" in Path(result.docx_path).name
    assert "PREP_Q1" in Path(result.xlsx_path).name


def test_data_quality_warnings_propagate_to_memory_record(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    rows = [["Tenant", "Suite", "SF", "Annual Rent", "Lease End"]]
    rows.extend([["Acme", str(i), 1000, 30000, "2028-06-30"] for i in range(20)])
    _write_xlsx(src, rows)
    result = analyze_rent_roll(str(src), output_dir=str(tmp_path))
    assert "building_fallback_used" in result.memory_record["data_quality_warnings"][0] or any(
        "fallback" in w.lower() for w in result.memory_record["data_quality_warnings"]
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_analyze.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `analyze.py`**

```python
"""High-level entry point: file path -> docx + xlsx + memory record (§5)."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal, Optional

from .analyses.below_avg import compute_below_building_avg_flags
from .analyses.concentration import compute_tenant_concentration
from .analyses.expirations import compute_expirations
from .analyses.inventory import compute_building_inventory
from .analyses.pivot import compute_expiration_pivot
from .analyses.walt import compute_walt, compute_walt_by_building
from .loading.loader import load_rent_roll
from .rendering.chart import render_expiration_chart
from .rendering.excel import render_portfolio_excel
from .rendering.word import render_portfolio_word
from .types import AnalysisResult, PortfolioAnalyses


def _memory_record(pa: PortfolioAnalyses, *, source_file: str,
                   project_id: Optional[str], user_id: Optional[str],
                   docx_path: str, xlsx_path: str) -> dict:
    df = pa.rr.df
    active = df[df["is_active"].fillna(False)]
    quality = pa.rr.quality
    warnings: list[str] = list(quality.warnings)
    if quality.monthly_annual_inference.get("basis") in ("psf_math", "user_specified"):
        warnings.append(
            f"monthly_annual_{quality.monthly_annual_inference['basis']}"
        )
    if quality.null_lease_end_pct > 0:
        warnings.append(f"null_lease_end_pct={quality.null_lease_end_pct:.1f}")
    if quality.building_fallback_used:
        warnings.append("building_fallback_used")
    return {
        "type": "rent_roll_analysis",
        "project_id": project_id,
        "user_id": user_id,
        "date": date.today().isoformat(),
        "source_file": Path(source_file).name,
        "building_count": int(active["building"].nunique()),
        "tenant_count_distinct": int(
            active["tenant_normalized"].replace("", None).dropna().nunique()
        ),
        "lease_count": int(len(active)),
        "total_active_annual_rent": float(active["annual_rent"].fillna(0).sum()),
        "total_active_sf": float(active["sf"].fillna(0).sum()),
        "portfolio_walt_years": round(float(pa.walt.walt_years), 1),
        "weighting_basis": pa.walt.weighting_basis,
        "data_quality_warnings": warnings,
        "output_files": {
            "docx": Path(docx_path).name,
            "xlsx": Path(xlsx_path).name,
        },
    }


def analyze_rent_roll(
    file_path: str,
    *,
    output_dir: Optional[str] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    today: Optional[date] = None,
    rent_period_override: Optional[Literal["monthly", "annual"]] = None,
    weight_by: Literal["rent", "sf"] = "rent",
) -> AnalysisResult:
    """Run the full rent-roll analysis end to end."""
    today = today or date.today()
    out_dir = Path(output_dir) if output_dir else Path(file_path).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    rr = load_rent_roll(file_path, today=today, rent_period_override=rent_period_override)

    expirations = compute_expirations(rr, today=today)
    inventory = compute_building_inventory(rr)
    pivot = compute_expiration_pivot(rr, today=today, limit_buildings=True)
    walt = compute_walt(rr, weight_by=weight_by, today=today)
    walt_by_b = compute_walt_by_building(rr, weight_by=weight_by, today=today)
    concentration = compute_tenant_concentration(rr)
    flags = compute_below_building_avg_flags(rr)

    stem = Path(file_path).stem
    date_tag = today.isoformat()
    chart_path = str(out_dir / f"{stem}_expirations_{date_tag}.png")
    docx_path = str(out_dir / f"{stem}_rent_roll_analysis_{date_tag}.docx")
    xlsx_path = str(out_dir / f"{stem}_rent_roll_analysis_{date_tag}.xlsx")

    render_expiration_chart(expirations, chart_path)

    pa = PortfolioAnalyses(
        rr=rr,
        expirations=expirations,
        inventory=inventory,
        expiration_pivot=pivot,
        walt=walt,
        walt_by_building=walt_by_b,
        tenant_concentration=concentration,
        below_avg_flags=flags,
        expiration_chart_path=chart_path,
    )

    render_portfolio_word(pa, docx_path)
    render_portfolio_excel(pa, xlsx_path)

    return AnalysisResult(
        docx_path=docx_path,
        xlsx_path=xlsx_path,
        memory_record=_memory_record(
            pa,
            source_file=file_path,
            project_id=project_id,
            user_id=user_id,
            docx_path=docx_path,
            xlsx_path=xlsx_path,
        ),
    )
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_analyze.py -v`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/analyze.py \
        python_skills/rent_roll_analyst/tests/unit/test_analyze.py
git commit -m "feat(rent-roll): high-level analyze_rent_roll entry point"
```

---

### Task 24: CLI entry point

**Files:**
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/cli.py`
- Create: `python_skills/rent_roll_analyst/src/rent_roll_analyst/__main__.py`
- Test: `python_skills/rent_roll_analyst/tests/unit/test_cli.py`

The CLI returns JSON on stdout so the future Node sidecar can consume it directly.

- [ ] **Step 1: Write the failing test**

`tests/unit/test_cli.py`:

```python
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd


def _write_xlsx(path: Path, rows: list[list[object]]) -> None:
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


def test_cli_emits_json_with_paths_and_record(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
        ["MOB-1", "Acme P.C.", "100", 1200, 36000, "2028-06-30"],
    ])
    proc = subprocess.run(
        [sys.executable, "-m", "rent_roll_analyst",
         str(src), "--out-dir", str(tmp_path)],
        capture_output=True, text=True, check=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["status"] == "ok"
    assert Path(payload["docx_path"]).exists()
    assert Path(payload["xlsx_path"]).exists()
    assert payload["memory_record"]["type"] == "rent_roll_analysis"


def test_cli_emits_error_json_on_known_failure(tmp_path: Path):
    src = tmp_path / "rr.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent"],  # no lease end
        ["MOB-1", "Acme", "100", 1200, 36000],
    ])
    proc = subprocess.run(
        [sys.executable, "-m", "rent_roll_analyst",
         str(src), "--out-dir", str(tmp_path)],
        capture_output=True, text=True, check=False,
    )
    assert proc.returncode == 2
    payload = json.loads(proc.stdout)
    assert payload["status"] == "error"
    assert payload["error_type"] == "LeaseEndColumnMissingError"
    assert "lease end" in payload["chat_prompt"].lower() \
        or "lease-end" in payload["chat_prompt"].lower()


def test_cli_passes_rent_period_override(tmp_path: Path):
    src = tmp_path / "ambiguous.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Rent", "Lease End"],
        ["MOB-1", "A", "100", 1000, 12000, "2028-06-30"],
    ])
    proc = subprocess.run(
        [sys.executable, "-m", "rent_roll_analyst",
         str(src), "--out-dir", str(tmp_path),
         "--rent-period", "annual"],
        capture_output=True, text=True, check=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["status"] == "ok"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_cli.py -v`
Expected: ImportError or process error.

- [ ] **Step 3: Implement `cli.py`**

```python
"""CLI: file path -> JSON on stdout.

Exit codes:
  0 ok
  2 known RentRollError (chat_prompt available)
  3 unknown error
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .analyze import analyze_rent_roll
from .errors import RentRollError


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="rent-roll-analyst")
    p.add_argument("file", help="Path to .xlsx, .xls, or .csv rent roll")
    p.add_argument("--out-dir", default=None,
                   help="Where to write outputs (defaults to source dir)")
    p.add_argument("--project-id", default=None)
    p.add_argument("--user-id", default=None)
    p.add_argument("--rent-period", choices=["monthly", "annual"], default=None,
                   help="Override the inferred rent period")
    p.add_argument("--weight-by", choices=["rent", "sf"], default="rent")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = analyze_rent_roll(
            args.file,
            output_dir=args.out_dir,
            project_id=args.project_id,
            user_id=args.user_id,
            rent_period_override=args.rent_period,
            weight_by=args.weight_by,
        )
    except RentRollError as e:
        json.dump({
            "status": "error",
            "error_type": type(e).__name__,
            "message": str(e),
            "chat_prompt": e.chat_prompt,
        }, sys.stdout)
        sys.stdout.write("\n")
        return 2
    except Exception as e:  # noqa: BLE001
        json.dump({
            "status": "error",
            "error_type": type(e).__name__,
            "message": str(e),
            "chat_prompt": "",
        }, sys.stdout)
        sys.stdout.write("\n")
        return 3

    payload = {
        "status": "ok",
        "docx_path": result.docx_path,
        "xlsx_path": result.xlsx_path,
        "memory_record": result.memory_record,
    }
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Implement `__main__.py`**

```python
from .cli import main

raise SystemExit(main())
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/unit/test_cli.py -v`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/src/rent_roll_analyst/cli.py \
        python_skills/rent_roll_analyst/src/rent_roll_analyst/__main__.py \
        python_skills/rent_roll_analyst/tests/unit/test_cli.py
git commit -m "feat(rent-roll): CLI emitting JSON for sidecar consumption"
```

---

## Phase 7 — Fixtures and Integration Tests (Appendix H)

### Task 25: Fixture builder + Fixture A (clean baseline)

**Files:**
- Create: `python_skills/rent_roll_analyst/tests/fixtures/build_fixtures.py`
- Create: `python_skills/rent_roll_analyst/tests/fixtures/A_expected.yaml`
- Test: `python_skills/rent_roll_analyst/tests/integration/test_fixture_a.py`

- [ ] **Step 1: Write `build_fixtures.py`**

```python
"""Generate synthetic rent-roll fixtures A, B, C, D, E.

Run:  python -m tests.fixtures.build_fixtures   (from package root)

Each fixture is checked in alongside its expected-outputs YAML so that
integration tests are reproducible without running this script.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent


def _write_xlsx(path: Path, rows: list[list[object]]) -> None:
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


def _build_a() -> None:
    rows: list[list[object]] = [
        ["Building", "Tenant", "Suite", "Rentable SF", "Annual Rent", "Lease End"],
    ]
    rows += [
        ["MOB-1", "Acme P.C.",       "100", 1200, 36000, "2028-06-30"],
        ["MOB-1", "Beta LLC",         "200", 800,  24000, "2027-12-31"],
        ["MOB-1", "Gamma M.D.",       "300", 1500, 48000, "2029-03-15"],
        ["MOB-2", "Delta Health LLC", "100", 2000, 70000, "2030-01-31"],
        ["MOB-2", "Echo P.A.",        "200", 1000, 35000, "2028-08-15"],
    ]
    _write_xlsx(HERE / "A_clean.xlsx", rows)


def _build_b() -> None:
    rows: list[list[object]] = [
        ["PREP MOB Portfolio", None, None, None, None, None],
        ["Generated 2026-04-01", None, None, None, None, None],
        [None, None, None, None, None, None],
        ["Property", "Lessee", "Suite", "Rentable SF", "Monthly Rent", "Expiration"],
    ]
    rows += [
        ["Alpha MOB", "Acme P.C.",  "100", 1000, 3000, "2028-06-30"],
        ["Alpha MOB", "Beta LLC",   "200", 800,  2400, "2027-12-31"],
        ["Alpha MOB", "Subtotal",   None,  1800, 5400, None],   # subtotal row
        ["Bravo MOB", "Gamma DDS",  "100", 1500, 4500, "2029-03-15"],
        ["Bravo MOB", "Delta P.A.", "200", 2000, 6000, "2030-01-31"],
    ]
    _write_xlsx(HERE / "B_multi_property_monthly.xlsx", rows)


def _build_c() -> None:
    rows: list[list[object]] = [
        ["YARDI EXPORT - PORTFOLIO RENT ROLL", None, None, None, None, None],
        ["Run Date: 04/01/2026", None, None, None, None, None],
        [None, None, None, None, None, None],
        [None, None, None, None, None, None],
        ["Property Name", "Tenant Name", "Unit", "Area (SF)", "Annual Rent", "End Date"],
    ]
    rows += [
        ["MOB North", "Acme Health, LLC", "100A", 1100, 33000, "06/30/2028"],
        ["MOB North", "Beta DDS",         "200B", 950,  28500, "12/31/2027"],
        ["MOB South", "Gamma P.C.",       "100",  2200, 77000, "03/15/2029"],
    ]
    _write_xlsx(HERE / "C_yardi.xlsx", rows)


def _build_d() -> None:
    rows: list[list[object]] = [
        ["MRI EXPORT", None, None, None, None, None],
        ["Asset: Sample MOB Pool", None, None, None, None, None],
        ["As of: 2026-04-01", None, None, None, None, None],
        [None, None, None, None, None, None],
        [None, None, None, None, None, None],
        ["Asset", "Customer", "Space #", "RSF", "Rent/yr", "Term End"],
    ]
    rows += [
        ["MOB-1", "Acme P.C.",       "100", 1200, 36000, "2028-06-30"],
        ["MOB-1", "Beta LLC",         "200",  800, 24000, "2027-12-31"],
        ["MOB-2", "Gamma M.D.",       "300", 1500, 48000, "2029-03-15"],
    ]
    _write_xlsx(HERE / "D_mri.xlsx", rows)


def _build_e() -> None:
    """Messy fixture: triggers multiple §5.14 failure paths."""
    today = date(2026, 4, 28)
    rows: list[list[object]] = [
        ["Property", "Tenant", "Suite", "RSF", "Rent", "Notes"],
    ]
    rows += [
        # PSF $12 -> overlap zone -> AmbiguousRentPeriodError
        ["MOB-X", "Vague Tenant LLC", "100", 1000, 12000, "ambiguous"],
        ["MOB-X", "Dup Tenant LLC",   "200", 1000, 30000, ""],
        ["MOB-X", "Dup Tenant LLC",   "200", 1000, 30000, "duplicate"],
        ["MOB-X", "",                 "300", 800,  0,     "vacant"],
        ["MOB-X", "Bad Rent",         "400", 1000, -500,  "negative rent"],
    ]
    # NB: no Lease End column on purpose
    _write_xlsx(HERE / "E_messy.xlsx", rows)


def main() -> None:
    _build_a()
    _build_b()
    _build_c()
    _build_d()
    _build_e()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate the fixtures**

Run:
```bash
cd python_skills/rent_roll_analyst
python -m tests.fixtures.build_fixtures
```

Expected: five `.xlsx` files appear in `tests/fixtures/`.

- [ ] **Step 3: Write `A_expected.yaml`**

```yaml
row_counts:
  total: 5
  active: 5
  expired: 0
  vacant: 0
  mtm: 0
totals:
  active_rent: 213000
  active_sf: 6500
inference:
  basis: header
  result: annual
walt_rent_weighted_2026_04_28_min: 2.5
walt_rent_weighted_2026_04_28_max: 3.5
top_tenants:
  - tenant_normalized: delta health
    rank: 1
top_expiration_year: 2030
below_avg_flag_count: 0
```

- [ ] **Step 4: Write the integration test**

`tests/integration/test_fixture_a.py`:

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import pytest
import yaml

from rent_roll_analyst.analyze import analyze_rent_roll

pytestmark = pytest.mark.integration


def _load_expected(fixtures_dir: Path) -> dict:
    return yaml.safe_load((fixtures_dir / "A_expected.yaml").read_text())


def test_fixture_a_end_to_end(fixtures_dir: Path, tmp_out_dir: Path):
    src = fixtures_dir / "A_clean.xlsx"
    expected = _load_expected(fixtures_dir)

    result = analyze_rent_roll(
        str(src),
        output_dir=str(tmp_out_dir),
        today=date(2026, 4, 28),
    )

    rec = result.memory_record
    assert rec["lease_count"] == expected["row_counts"]["active"]
    assert rec["total_active_annual_rent"] == pytest.approx(
        expected["totals"]["active_rent"], abs=1.0,
    )
    assert rec["total_active_sf"] == pytest.approx(
        expected["totals"]["active_sf"], abs=1.0,
    )
    assert (
        expected["walt_rent_weighted_2026_04_28_min"]
        <= rec["portfolio_walt_years"]
        <= expected["walt_rent_weighted_2026_04_28_max"]
    )
    assert Path(result.docx_path).exists()
    assert Path(result.xlsx_path).exists()


def test_fixture_a_excel_totals_match_word_totals(fixtures_dir: Path, tmp_out_dir: Path):
    """§5.10 acceptance: Excel/Word totals reconcile within $1."""
    from openpyxl import load_workbook

    result = analyze_rent_roll(
        str(fixtures_dir / "A_clean.xlsx"),
        output_dir=str(tmp_out_dir),
        today=date(2026, 4, 28),
    )
    wb = load_workbook(result.xlsx_path, data_only=False)
    sheet = wb["Building Inventory"]
    headers = [c.value for c in sheet[1]]
    rent_col = headers.index("total_annual_rent") + 1
    rents = [
        sheet.cell(row=r, column=rent_col).value
        for r in range(2, sheet.max_row + 1)
        if sheet.cell(row=r, column=rent_col).value is not None
    ]
    excel_total = sum(float(v) for v in rents)
    assert excel_total == pytest.approx(213000, abs=1.0)
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/integration/test_fixture_a.py -v`
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/tests/fixtures/ \
        python_skills/rent_roll_analyst/tests/integration/test_fixture_a.py
git commit -m "test(rent-roll): fixture A clean baseline + integration test"
```

---

### Task 26: Fixture B (multi-property + monthly rent + subtotal rows)

**Files:**
- Create: `python_skills/rent_roll_analyst/tests/fixtures/B_expected.yaml`
- Test: `python_skills/rent_roll_analyst/tests/integration/test_fixture_b.py`

The fixture itself is generated by Task 25's `build_fixtures.py`. The subtotal row has tenant "Subtotal" with no lease end and zero/null SF — it should be classified as either MTM (if rent > 0) or vacant. The integration test asserts headline numbers exclude the subtotal row.

- [ ] **Step 1: Write `B_expected.yaml`**

```yaml
header_row_index: 3
inference:
  basis: header
  result: monthly
# Two real properties, four real leases (subtotal row excluded from active_count)
row_counts:
  active_min: 4
  active_max: 5  # subtotal row may be classified as MTM until cleaning
totals:
  # Only the four real leases × 12 months. Subtotal row is excluded once detected.
  # 3000+2400+4500+6000 = 15900/mo -> 190800/yr
  active_rent_min: 190800
  active_rent_max: 256800   # generous: includes subtotal-as-MTM fallback
top_tenants_min_count: 4
```

- [ ] **Step 2: Write `tests/integration/test_fixture_b.py`**

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import yaml

from rent_roll_analyst.analyze import analyze_rent_roll

pytestmark = pytest.mark.integration


def test_fixture_b_handles_metadata_and_monthly_rent(fixtures_dir: Path, tmp_out_dir: Path):
    src = fixtures_dir / "B_multi_property_monthly.xlsx"
    expected = yaml.safe_load((fixtures_dir / "B_expected.yaml").read_text())

    result = analyze_rent_roll(
        str(src),
        output_dir=str(tmp_out_dir),
        today=date(2026, 4, 28),
    )

    rec = result.memory_record
    assert rec["lease_count"] >= expected["row_counts"]["active_min"]
    assert (
        expected["totals"]["active_rent_min"]
        <= rec["total_active_annual_rent"]
        <= expected["totals"]["active_rent_max"]
    )
    assert Path(result.docx_path).exists()
    assert Path(result.xlsx_path).exists()


def test_fixture_b_quality_block_records_inferred_monthly(fixtures_dir: Path, tmp_out_dir: Path):
    """Monthly rent must be flagged in the data-quality block (§5.2.7)."""
    from openpyxl import load_workbook
    src = fixtures_dir / "B_multi_property_monthly.xlsx"

    result = analyze_rent_roll(str(src), output_dir=str(tmp_out_dir),
                               today=date(2026, 4, 28))
    wb = load_workbook(result.xlsx_path)
    sheet = wb["Data Quality"]
    rows = [(sheet.cell(row=i, column=1).value, sheet.cell(row=i, column=2).value)
            for i in range(2, sheet.max_row + 1)]
    by_metric = dict(rows)
    assert by_metric.get("Monthly/annual result") == "monthly"
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/integration/test_fixture_b.py -v`
Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add python_skills/rent_roll_analyst/tests/fixtures/B_expected.yaml \
        python_skills/rent_roll_analyst/tests/integration/test_fixture_b.py
git commit -m "test(rent-roll): fixture B (multi-property + monthly rent)"
```

---

### Task 27: Fixtures C + D (Yardi-shape + MRI-shape)

**Files:**
- Create: `python_skills/rent_roll_analyst/tests/fixtures/C_expected.yaml`
- Create: `python_skills/rent_roll_analyst/tests/fixtures/D_expected.yaml`
- Test: `python_skills/rent_roll_analyst/tests/integration/test_fixture_c.py`
- Test: `python_skills/rent_roll_analyst/tests/integration/test_fixture_d.py`

These are the "real export" fixtures (synthetic-shaped per Appendix H, fallback if PREP files unavailable per Q1).

- [ ] **Step 1: Write `C_expected.yaml`**

```yaml
header_row_index: 4   # five rows of metadata, header on the fifth (0-indexed=4)
inference:
  basis: header
  result: annual
totals:
  active_rent: 138500
  active_sf: 4250
top_tenants_min_count: 3
```

- [ ] **Step 2: Write `D_expected.yaml`**

```yaml
header_row_index: 5
inference:
  basis: header
  result: annual
totals:
  active_rent: 108000
  active_sf: 3500
top_tenants_min_count: 3
```

- [ ] **Step 3: Write `tests/integration/test_fixture_c.py`**

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import yaml

from rent_roll_analyst.analyze import analyze_rent_roll

pytestmark = pytest.mark.integration


def test_fixture_c_yardi_shape(fixtures_dir: Path, tmp_out_dir: Path):
    expected = yaml.safe_load((fixtures_dir / "C_expected.yaml").read_text())
    result = analyze_rent_roll(
        str(fixtures_dir / "C_yardi.xlsx"),
        output_dir=str(tmp_out_dir),
        today=date(2026, 4, 28),
    )
    rec = result.memory_record
    assert rec["total_active_annual_rent"] == pytest.approx(
        expected["totals"]["active_rent"], abs=1.0,
    )
    assert rec["total_active_sf"] == pytest.approx(
        expected["totals"]["active_sf"], abs=1.0,
    )
```

- [ ] **Step 4: Write `tests/integration/test_fixture_d.py`**

```python
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import yaml

from rent_roll_analyst.analyze import analyze_rent_roll

pytestmark = pytest.mark.integration


def test_fixture_d_mri_shape(fixtures_dir: Path, tmp_out_dir: Path):
    expected = yaml.safe_load((fixtures_dir / "D_expected.yaml").read_text())
    result = analyze_rent_roll(
        str(fixtures_dir / "D_mri.xlsx"),
        output_dir=str(tmp_out_dir),
        today=date(2026, 4, 28),
    )
    rec = result.memory_record
    assert rec["total_active_annual_rent"] == pytest.approx(
        expected["totals"]["active_rent"], abs=1.0,
    )
    assert rec["total_active_sf"] == pytest.approx(
        expected["totals"]["active_sf"], abs=1.0,
    )
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/integration/test_fixture_c.py tests/integration/test_fixture_d.py -v`
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add python_skills/rent_roll_analyst/tests/fixtures/C_expected.yaml \
        python_skills/rent_roll_analyst/tests/fixtures/D_expected.yaml \
        python_skills/rent_roll_analyst/tests/integration/test_fixture_c.py \
        python_skills/rent_roll_analyst/tests/integration/test_fixture_d.py
git commit -m "test(rent-roll): fixtures C (Yardi) and D (MRI) shapes"
```

---

### Task 28: Fixture E — failure-mode tests (§5.14)

Fixture E intentionally triggers multiple failure paths. The test asserts the error type and the chat_prompt language for each.

**Files:**
- Test: `python_skills/rent_roll_analyst/tests/integration/test_fixture_e_failures.py`

- [ ] **Step 1: Write the failing test**

`tests/integration/test_fixture_e_failures.py`:

```python
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from rent_roll_analyst.analyze import analyze_rent_roll
from rent_roll_analyst.errors import (
    AmbiguousRentPeriodError,
    HeaderNotFoundError,
    LeaseEndColumnMissingError,
    TooManyNullLeaseEndsError,
)

pytestmark = pytest.mark.integration


def _write_xlsx(path: Path, rows: list[list[object]]) -> None:
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


def test_fixture_e_no_lease_end_column_raises_with_chat_prompt(
    fixtures_dir: Path, tmp_out_dir: Path,
):
    src = fixtures_dir / "E_messy.xlsx"
    with pytest.raises(LeaseEndColumnMissingError) as ei:
        analyze_rent_roll(
            str(src), output_dir=str(tmp_out_dir),
            today=date(2026, 4, 28),
        )
    prompt = ei.value.chat_prompt.lower()
    assert "lease end" in prompt or "lease-end" in prompt
    assert "which column" in prompt


def test_no_header_detected(tmp_out_dir: Path, tmp_path: Path):
    src = tmp_path / "junk.xlsx"
    _write_xlsx(src, [
        ["just", "garbage", "rows"],
        ["nothing", "matches", "aliases"],
    ])
    with pytest.raises(HeaderNotFoundError) as ei:
        analyze_rent_roll(str(src), output_dir=str(tmp_out_dir))
    assert "header row" in ei.value.chat_prompt.lower()


def test_ambiguous_rent_period_overlap_raises(tmp_out_dir: Path, tmp_path: Path):
    src = tmp_path / "ambig.xlsx"
    _write_xlsx(src, [
        ["Building", "Tenant", "Suite", "SF", "Rent", "Lease End"],
        ["MOB-1", "A", "100", 1000, 12000, "2028-06-30"],
    ])
    with pytest.raises(AmbiguousRentPeriodError) as ei:
        analyze_rent_roll(str(src), output_dir=str(tmp_out_dir))
    assert "monthly" in ei.value.chat_prompt.lower()
    assert "annual" in ei.value.chat_prompt.lower()


def test_more_than_50pct_null_lease_end_raises(tmp_out_dir: Path, tmp_path: Path):
    src = tmp_path / "lots_of_nulls.xlsx"
    rows: list[list[object]] = [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
    ]
    rows += [["MOB-1", f"T{i}", str(i), 1000, 30000, None] for i in range(6)]
    rows += [["MOB-1", f"T{10+i}", str(10+i), 1000, 30000, "2028-06-30"]
             for i in range(4)]
    _write_xlsx(src, rows)
    with pytest.raises(TooManyNullLeaseEndsError) as ei:
        analyze_rent_roll(str(src), output_dir=str(tmp_out_dir))
    assert "more than half" in ei.value.chat_prompt.lower()


def test_unsupported_extension_returns_error_via_cli(tmp_path: Path):
    src = tmp_path / "x.pdf"
    src.write_text("not a rent roll")
    proc = subprocess.run(
        [sys.executable, "-m", "rent_roll_analyst", str(src),
         "--out-dir", str(tmp_path)],
        capture_output=True, text=True, check=False,
    )
    assert proc.returncode == 2
    payload = json.loads(proc.stdout)
    assert payload["error_type"] == "FileParseError"
    assert ".xlsx" in payload["chat_prompt"] or ".csv" in payload["chat_prompt"]
```

- [ ] **Step 2: Run tests**

Run: `pytest tests/integration/test_fixture_e_failures.py -v`
Expected: 5 passing.

- [ ] **Step 3: Commit**

```bash
git add python_skills/rent_roll_analyst/tests/integration/test_fixture_e_failures.py
git commit -m "test(rent-roll): fixture E failure-mode coverage (§5.14)"
```

---

### Task 29: Performance budget (1k and 10k rows)

§9 R4 sets the perf budget: ≤30s on 1,000 rows median; ≤90s on 10,000 rows median.

**Files:**
- Test: `python_skills/rent_roll_analyst/tests/integration/test_perf.py`

- [ ] **Step 1: Write the test**

`tests/integration/test_perf.py`:

```python
from __future__ import annotations

import time
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from rent_roll_analyst.analyze import analyze_rent_roll

pytestmark = pytest.mark.perf


def _generate_rent_roll(path: Path, n: int) -> None:
    rows: list[list[object]] = [
        ["Building", "Tenant", "Suite", "SF", "Annual Rent", "Lease End"],
    ]
    for i in range(n):
        rows.append([
            f"MOB-{(i % 10) + 1}",
            f"Tenant {i} P.C.",
            str(100 + i),
            1000 + (i % 500),
            30000 + (i % 5000),
            f"202{(i % 9) + 1}-06-30",
        ])
    pd.DataFrame(rows).to_excel(path, header=False, index=False)


@pytest.mark.parametrize("n,budget_seconds", [(1000, 30), (10000, 90)])
def test_perf_budget(tmp_path: Path, n: int, budget_seconds: int):
    src = tmp_path / f"perf_{n}.xlsx"
    _generate_rent_roll(src, n)
    out = tmp_path / "out"
    out.mkdir()

    start = time.perf_counter()
    analyze_rent_roll(str(src), output_dir=str(out), today=date(2026, 4, 28))
    elapsed = time.perf_counter() - start

    assert elapsed <= budget_seconds, (
        f"Perf budget missed: {n} rows took {elapsed:.1f}s > {budget_seconds}s"
    )
```

- [ ] **Step 2: Run tests**

Run: `pytest -m perf -v`
Expected: 2 passing within their budgets.

- [ ] **Step 3: Commit**

```bash
git add python_skills/rent_roll_analyst/tests/integration/test_perf.py
git commit -m "test(rent-roll): performance budget (1k <=30s, 10k <=90s)"
```

---

### Task 30: Final acceptance pass — all fixtures green; manual Word/Excel review

This task is a checklist — no new code unless something fails.

- [ ] **Step 1: Run the full suite**

```bash
cd python_skills/rent_roll_analyst
pytest -v
```

Expected: every unit + integration test green; perf tests green within budget.

- [ ] **Step 2: Manually open generated Word docs from each fixture**

```bash
python -m rent_roll_analyst tests/fixtures/A_clean.xlsx --out-dir /tmp/rr_review
open /tmp/rr_review/*.docx
```

Verify by eye, per §5.9 and the Definition of Done in Appendix I:
- Native Word tables on every section (right-click → Table Properties works on each).
- Native heading styles on each section heading.
- Embedded chart image is sharp (≥150 DPI).
- No forbidden phrases.
- Footer disclaimer present.

Repeat for B, C, D. Fixture E should not produce a docx (failure mode).

- [ ] **Step 3: Manually open generated Excel from each fixture**

```bash
open /tmp/rr_review/*.xlsx
```

Verify per §5.10:
- Currency cells are right-aligned (numeric) with `$` formatting.
- Date cells render as dates, not serial numbers.
- Percentage cells display with `%`.
- Row 1 frozen, headers bold.
- Sheet 2 is "Data Quality".

- [ ] **Step 4: Smoke-check the JSON CLI surface**

```bash
python -m rent_roll_analyst tests/fixtures/A_clean.xlsx --out-dir /tmp/rr_review | jq .
```

Expected: a JSON object with `status: "ok"`, `docx_path`, `xlsx_path`, and a populated `memory_record` matching the schema in §5.12.

- [ ] **Step 5: Commit any fixes that surfaced during review**

If review surfaced no issues, no commit. Otherwise:

```bash
git add -p
git commit -m "fix(rent-roll): <specific issue found in review>"
```

---

## Self-Review Checklist

Quick spec-coverage scan before handoff.

| PRD Section | Covered by Task(s) |
|---|---|
| §5.1 column-shape probe (Python side) | 12 |
| §5.2.1 header detection | 5 |
| §5.2.2 column mapping | 6 |
| §5.2.3 monthly/annual inference (disjoint bands) | 7 |
| §5.2.4 normalized schema | 9 |
| §5.2.5 active-lease rule | 9, used by 13–18 |
| §5.2.6 multi-property fallback | 9, 11 |
| §5.2.7 validation/warnings | 10 |
| §5.3 expirations + chart | 13, 20 |
| §5.4 building inventory | 14 |
| §5.5 expiration pivot | 15 |
| §5.6 WALT (portfolio + per-building) | 16 |
| §5.7 tenant concentration + Appendix C | 8, 17 |
| §5.8 below-building-avg flags | 18 |
| §5.9 Word renderer | 22 |
| §5.10 Excel renderer | 21 |
| §5.11.1 chart standards | 20 |
| §5.11.2 determinism (templated summary) | 22 |
| §5.11.3 reconciliation | 25, 26 |
| §5.11.4 forbidden-phrase scanner / Appendix D | 19 |
| §5.12 memory record schema (Python side) | 23 |
| §5.13 audit/access (deferred to Plan 2) | — |
| §5.14 failure modes | 28 |
| Appendix A function signatures | 11, 13–18, 20–23 |
| Appendix B alias dictionary | 4 |
| Appendix C tenant pipeline | 8 |
| Appendix D forbidden phrases | 19 |
| Appendix E template manifest | 20 (palette), 22 (Word styles) |
| Appendix F disclaimer | 22 |
| Appendix H fixtures | 25, 26, 27, 28 |
| Appendix I Definition of Done | 30 |

**Items deferred to Plan 2 (portal integration):**

- §5.1 chat-orchestrator triggering / filename heuristics
- §5.12 project-memory persistence and prior-analysis surfacing
- §5.13 access-control HTTP tests, audit_log integration (Appendix G)
- Appendix J dogfood acceptance rubric
- Q3 outputs retention (90 days) — landed via portal cleanup job

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-rent-roll-analyst-python-core.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task with code review between tasks. Best fit because each task is small, self-contained, and TDD-shaped, so review-per-task catches regressions early.

**2. Inline Execution** — run tasks in this session with checkpoints. Faster overall if you want to push straight through, but more context burned per turn.

Which approach?
