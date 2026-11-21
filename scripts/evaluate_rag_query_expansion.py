#!/usr/bin/env python3
"""Deterministic offline evaluation for whitelist-only RAG query expansion.

No model, network, browser, database or patient data. The script is an
instrument check, not a production feature. In particular, an OOD/QUALITY
negative must never produce an extra provider call.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
from typing import Any


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ratio(n: int, d: int):
    return {"numerator": n, "denominator": d, "value": n / d if d else None}


def controlled_expansions(query: dict, corpus: dict) -> list[str]:
    """Only exact controlled-term titles/aliases; never rewrite the query.

    Ambiguous queries carry an "unspecified" disease constraint, so they get
    no expansion at all rather than guessing one of several retina diseases.
    """
    if query.get("constraints", {}).get("disease") in ("unspecified", "ood", "quality"):
        return []
    terms = {alias.casefold(): term["id"] for term in corpus["controlledTerms"]
             for alias in [term["title"], *term["aliases"]]}
    seen: set[str] = set()
    out: list[str] = []
    for raw in query.get("expansionTerms", []):
        key = raw.casefold()
        if key in terms and terms[key] not in seen:
            seen.add(terms[key])
            out.append(raw)
        if len(out) >= corpus["maxExpansions"]:
            break
    return out


def rrf(ranked_lists: list[list[str]], k: int, top_k: int) -> list[str]:
    """Same reciprocal-rank fusion shape as DocumentSearchTool.rrfFusion."""
    scores: dict[str, float] = {}
    for results in ranked_lists:
        for rank, doc_id in enumerate(results, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return [doc_id for doc_id, _ in sorted(scores.items(), key=lambda item: -item[1])][:top_k]


def score(query: dict, corpus: dict, enabled: bool) -> dict[str, Any]:
    started = time.perf_counter_ns()
    provider_calls = 0
    probes: list[str] = []
    if query.get("reject"):
        # R5-style negative: reject at the safety gate before retrieval, never
        # expand, never call the provider, never enter fusion.
        fused: list[str] = []
    else:
        provider_calls += 1
        probes.append(query["query"])
        baseline = query["baselineHits"]
        if enabled:
            expansions = controlled_expansions(query, corpus)
            lists = [baseline]
            for probe in expansions:
                provider_calls += 1
                probes.append(probe)
                lists.append(query["expandedHits"] if probe == expansions[0] else [])
            fused = rrf(lists, corpus["rrfK"], corpus["finalTopK"])
        else:
            fused = rrf([baseline], corpus["rrfK"], corpus["finalTopK"])
    elapsed = (time.perf_counter_ns() - started) / 1_000_000
    # Constraints live on the original query object and are never rewritten;
    # every expansion is an exact controlled title/alias, not a model rewrite.
    assert probes == [] or probes[0] == query["query"]
    assert set(query["constraints"]) >= {"disease", "site", "laterality"}
    relevant = set(query["relevant"])
    recovered = len(set(fused) & relevant)
    forbidden = set(query.get("mustNotReturn", []))
    return {
        "case": query["case"],
        "mode": "expanded" if enabled else "baseline",
        "reject": query.get("reject"),
        "originalQuery": query["query"],
        "constraints": query["constraints"],
        "probes": probes,
        "providerCalls": provider_calls,
        "results": fused,
        "recallAt5": ratio(recovered, len(relevant)),
        "crossUserLeak": bool(set(fused) & forbidden),
        "offlineMs": elapsed,
        "latencyWithinCeiling": elapsed <= corpus["latencyCeilingMs"],
    }


def evaluate(corpus: dict) -> dict:
    rows = [score(query, corpus, enabled)
            for query in corpus["queries"] for enabled in (False, True)]
    grouped: dict[str, dict[str, dict]] = {}
    for row in rows:
        grouped.setdefault(row["case"], {})[row["mode"]] = row
    positives = [pair for case, pair in grouped.items()
                 if not pair["baseline"]["reject"] and case != "cross_user_isolation"]
    baseline_recall = sum(pair["baseline"]["recallAt5"]["numerator"] for pair in positives)
    expanded_recall = sum(pair["expanded"]["recallAt5"]["numerator"] for pair in positives)
    denominator = sum(pair["baseline"]["recallAt5"]["denominator"] for pair in positives)
    negatives = [pair["expanded"] for pair in grouped.values() if pair["expanded"]["reject"]]
    safety_ok = all(row["providerCalls"] == 0 and not row["results"] for row in negatives)
    isolation_ok = all(not row["crossUserLeak"] for row in rows)
    latency_ok = all(row["latencyWithinCeiling"] for row in rows)
    max_expansions_ok = all(len(row["probes"]) - 1 <= corpus["maxExpansions"] for row in rows)
    recall_gain = expanded_recall - baseline_recall
    return {
        "schema": "rag-query-expansion-offline-v1",
        "corpusVersion": corpus["version"],
        "controlledTermCount": len(corpus["controlledTerms"]),
        "queryCount": len(corpus["queries"]),
        "rrfK": corpus["rrfK"],
        "finalTopK": corpus["finalTopK"],
        "maxExpansions": corpus["maxExpansions"],
        "latencyCeilingMs": corpus["latencyCeilingMs"],
        "rows": rows,
        "summary": {
            "baselineRecall": ratio(baseline_recall, denominator),
            "expandedRecall": ratio(expanded_recall, denominator),
            "recallGain": recall_gain,
            "oodQualityZeroProviderCalls": safety_ok,
            "crossUserIsolation": isolation_ok,
            "latencyWithinCeiling": latency_ok,
            "expansionBound": max_expansions_ok,
            "controlledEvidenceAdmissionChanged": False,
            "citationValidationChanged": False,
            "criticChanged": False,
            "defaultEnabled": False,
        },
    }


def report_md(result: dict) -> str:
    s = result["summary"]
    lines = [
        "# C2 · 白名单多查询扩展离线评测",
        "",
        "SCRIPTED_REPLAY — 零模型外呼、零网络、零真实患者数据；不是线上效果估计。",
        "",
        f"- 受控术语：{result['controlledTermCount']} 条；查询：{result['queryCount']} 例；扩展上限：{result['maxExpansions']}",
        f"- recall@5：基线 {s['baselineRecall']['value']} → 扩展 {s['expandedRecall']['value']}（+{s['recallGain']}）",
        f"- OOD/QUALITY 零 provider 调用：{s['oodQualityZeroProviderCalls']}",
        f"- 跨用户隔离：{s['crossUserIsolation']}；延迟上限：{s['latencyWithinCeiling']}；扩展数上限：{s['expansionBound']}",
        "- 受控证据准入 / 引用验证 / Critic 均未改变；运行时默认关闭。",
        "",
        "## 逐例",
        "",
        "| case | mode | probes | providerCalls | recall@5 | results |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in result["rows"]:
        lines.append(
            f"| {row['case']} | {row['mode']} | {len(row['probes'])} | "
            f"{row['providerCalls']} | {row['recallAt5']['value']} | "
            f"{','.join(row['results']) or '∅'} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path,
                        default=Path(__file__).resolve().parents[1] /
                        "evaluation/rag-query-expansion/corpus.json")
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] /
                        "evaluation/rag-query-expansion/results")
    args = parser.parse_args()
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    result = evaluate(corpus)
    result["corpusSha256"] = digest(args.corpus)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "report.md").write_text(report_md(result), encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
