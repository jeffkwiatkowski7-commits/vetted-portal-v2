# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2.0", "openpyxl>=3.1", "xlrd>=2.0", "numpy>=1.26"]
# ///
"""Spreadsheet sidecar: extract a summary, or run a constrained pandas query.

Subcommands (selected by the first positional arg):
  extract --mime <mime> [--filename <name>]
      Read file bytes from stdin, write a text summary to stdout.
  query --file <path> --mime <mime> [--sheet <name>]
      Read a pandas expression from stdin, AST-validate, run against the
      loaded sheets in a restricted namespace, print the result.
"""
from __future__ import annotations

import argparse
import ast
import builtins as _builtins
import io
import sys
from typing import Any

import numpy as np
import pandas as pd

MAX_ROWS_FULL = 500       # show full sheet up to this row count
MAX_ROWS_HEAD = 100       # otherwise show head() of this size
MAX_CELL_CHARS = 200      # truncate any single cell


def _truncate(df: pd.DataFrame) -> pd.DataFrame:
    return df.map(
        lambda v: (v if not isinstance(v, str) or len(v) <= MAX_CELL_CHARS
                   else v[:MAX_CELL_CHARS] + "…")
    )


def format_sheet(name: str, df: pd.DataFrame) -> str:
    out: list[str] = [f"### Sheet: {name}", f"Shape: {df.shape[0]} rows × {df.shape[1]} cols", ""]

    out.append("**Columns:**")
    for col in df.columns:
        s = df[col]
        out.append(f"- `{col}` ({s.dtype}, {int(s.isna().sum())} nulls)")
    out.append("")

    numeric = df.select_dtypes("number")
    if numeric.shape[1] > 0:
        out.append("**Numeric summary (describe):**")
        out.append("```")
        out.append(numeric.describe().round(4).to_string())
        out.append("```")
        out.append("")

    rendered = _truncate(df)
    if df.shape[0] <= MAX_ROWS_FULL:
        out.append("**Full data:**")
        out.append("```")
        out.append(rendered.to_string(index=False))
        out.append("```")
    else:
        out.append(f"**First {MAX_ROWS_HEAD} rows (full sheet has {df.shape[0]}):**")
        out.append("```")
        out.append(rendered.head(MAX_ROWS_HEAD).to_string(index=False))
        out.append("```")
        out.append(f"[... {df.shape[0] - MAX_ROWS_HEAD} more rows truncated]")

    return "\n".join(out)


BLOCKED_NAMES = {
    "open", "compile", "globals", "locals", "getattr", "setattr", "delattr",
    "vars", "dir", "input", "breakpoint", "help", "memoryview", "object",
}

SAFE_BUILTIN_NAMES = {
    "abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter",
    "float", "int", "isinstance", "issubclass", "len", "list", "map", "max",
    "min", "print", "range", "repr", "reversed", "round", "set", "slice",
    "sorted", "str", "sum", "tuple", "type", "zip",
    "True", "False", "None",
}


def load_sheets(source: Any, mime: str) -> dict[str, pd.DataFrame]:
    if mime == "text/csv":
        return {"(csv)": pd.read_csv(source)}
    if mime == "application/vnd.ms-excel":
        return pd.read_excel(source, sheet_name=None, engine="xlrd")
    return pd.read_excel(source, sheet_name=None, engine="openpyxl")


def cmd_extract(mime: str, filename: str) -> None:
    data = sys.stdin.buffer.read()
    sheets = load_sheets(io.BytesIO(data), mime)
    chunks = [format_sheet(name, df) for name, df in sheets.items()]
    sys.stdout.write("\n\n".join(chunks))


def validate_query_ast(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError("imports are not allowed in pandas_query")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError(f"underscore-prefixed attributes not allowed: .{node.attr}")
        if isinstance(node, ast.Name) and node.id in BLOCKED_NAMES:
            raise ValueError(f"name not allowed in pandas_query: {node.id}")


def build_safe_globals(df: pd.DataFrame, sheets: dict[str, pd.DataFrame]) -> dict[str, Any]:
    safe_builtins = {n: getattr(_builtins, n) for n in SAFE_BUILTIN_NAMES if hasattr(_builtins, n)}
    return {
        "__builtins__": safe_builtins,
        "pd": pd, "np": np,
        "df": df, "sheets": sheets,
    }


def run_query(code: str, g: dict[str, Any]) -> Any:
    tree = ast.parse(code, mode="exec")
    validate_query_ast(tree)
    # If the last statement is an expression, capture its value.
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = tree.body[-1].value
        prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
        _builtins.exec(compile(prefix, "<query>", "exec"), g)
        return _builtins.eval(compile(ast.Expression(last_expr), "<query>", "eval"), g)
    ns: dict[str, Any] = {}
    _builtins.exec(compile(tree, "<query>", "exec"), g, ns)
    return ns.get("result")


def format_query_result(r: Any) -> str:
    if r is None:
        return "(no result — end the code with an expression or assign to `result`)"
    if isinstance(r, (pd.DataFrame, pd.Series)):
        return r.to_string()
    if isinstance(r, np.ndarray):
        return str(r)
    if isinstance(r, (int, float, str, bool)):
        return str(r)
    if isinstance(r, dict):
        return "\n".join(f"{k}: {v}" for k, v in r.items())
    return repr(r)


def cmd_query(file_path: str, mime: str, sheet_name: str | None) -> None:
    code = sys.stdin.read()
    sheets = load_sheets(file_path, mime)
    if sheet_name:
        if sheet_name not in sheets:
            raise ValueError(f"sheet {sheet_name!r} not found; available: {list(sheets)}")
        df = sheets[sheet_name]
    else:
        df = next(iter(sheets.values()))
    result = run_query(code, build_safe_globals(df, sheets))
    sys.stdout.write(format_query_result(result))


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("extract")
    e.add_argument("--mime", required=True)
    e.add_argument("--filename", default="(input)")

    q = sub.add_parser("query")
    q.add_argument("--file", required=True)
    q.add_argument("--mime", required=True)
    q.add_argument("--sheet", default=None)

    args = p.parse_args()
    if args.cmd == "extract":
        cmd_extract(args.mime, args.filename)
    else:
        cmd_query(args.file, args.mime, args.sheet)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        sys.exit(1)
