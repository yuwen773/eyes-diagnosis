# TASK-11 C2 · 白名单多查询扩展：确定性离线评测

本评测**不调用模型、不访问网络、不读取真实患者数据、不改受控证据准入**。
它回答一个有限问题：仅用受控医学术语表的标题/别名生成最多 2 条子查询，
对固定内置语料的 recall@5 是否有明确收益，以及 OOD/质量负例是否完全不产生额外外呼。

## 语料与判定

- 8 份内置 `src/main/resources/rag/*.md` 的 H1 标题构成受控术语表；别名只取标题里已有的中英文写法（不翻译、不臆造）。
- 每个查询带 `relevant` 文档 id、`constraints`（疾病/部位/左右眼）和固定的关键词命中矩阵；`original` 保留原始查询。
- 基线：原查询一次检索。扩展：原查询 + 最多 2 条术语子查询，各自保留原约束，按 `DocumentSearchTool.rrfFusion` 的 RRF 评分后按 id 去重。
- `providerCalls` 是离线评分器记录的检索次数，不是真实模型外呼；OOD/QUALITY 负例必须为 0。

## 运行

```bash
python scripts/evaluate_rag_query_expansion.py \
  --corpus evaluation/rag-query-expansion/corpus.json \
  --output evaluation/rag-query-expansion/results
```

输出 `results.json`（逐例指标 + 汇总）与 `report.md`（结论）。CI 只运行
`scripts/tests/test_evaluate_rag_query_expansion.py` 的固定夹具，不启用运行时扩展。
