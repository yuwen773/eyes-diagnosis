# #24 四 Agent 协作评估

对应 [工单 #24](https://github.com/yuwen773/eyes-diagnosis/issues/24)。入口为 `scripts/evaluate_agent_collaboration.py`，只使用 Python 标准库，不读取应用配置、患者数据或模型密钥，不调用外部模型。

## 固定对照

`corpus.json` 固定八个合成样例：完整说明、Vision 限制遗漏、Critic 无依据声明、Critic 内容遗漏、证据不足、质量失败、OOD 拒识、来源撤回。每个样例只定义一套输入、来源、角色响应脚本与独立 gold 标注。六个条件均逐例执行：单 Agent、四 Agent、分别移除 Vision / Evidence / Explanation / Critic。每个条件的分母为 8，配对单元共 48。

这是 **SCRIPTED_REPLAY**：测试专用的参考协调流程实际执行各角色阶段，模型边界使用人工响应脚本。Vision 可提供补充限制；Evidence 提供来源 ID，独立资格过滤保留；Explanation 消费已有上下文；Critic 可触发一次重写。单 Agent 消费相同输入与来源可用性，只执行一次 SINGLE 脚本；移除 Explanation 不生成草稿。所有条件共用质量、OOD、来源资格和引用可追溯门禁。gold 声明及支持关系仅进入评分器，不传入角色上下文。

**参考流程不等同产品协调器。** 脚本故意植入遗漏和无依据声明，输出差异只说明这个固定替身的行为与评分是否可复核，不能估计真实 Agent 的贡献、排名或收益。参考流程未模拟产品的完整冻结、预算、事务或医生发布流程；真实 `PatientDraftCoordinator.run/inspect` 与患者 HTTP 可靠性另行运行并列示。评估没有在产品中添加角色跳过、权限放宽或自动发布入口。

## 评分与时间成本

- 引用正确性：合格来源、精确非空引文、完全匹配的合成 gold 声明，以及该声明与该精确引文的独立支持标注全部成立。另报引文可追溯率，防止将“引文存在”当成“支持声明”。这不是医学语义自动判定。
- 无依据声明：候选声明没有任何正确支持引用；分母为全部内部候选声明。受限候选也计入，患者不会看到这些材料。
- 遗漏：必需 gold 事实未被有依据声明覆盖；按唯一事实计数，重复声明不增加覆盖。受限输入预期不生成解释，必需事实集合为空。
- 同时报状态正确率、应生成样本的就绪召回与应受限样本的错误就绪。这样全量拒绝的条件不会被误当成高质量。各比率保留整数分子/分母，零分母为 `null` / N/A，跨样本采用微平均。
- 耗时用单调时钟实测，分别记录本地替身流程和评分耗时，以及每个实际执行阶段的重放耗时，均包含材料复制开销；不解释为模型推理延迟。每个条件提供方调用及费用均为 0；真实模型延迟、token、费用标记 **NOT_RUN**。单轮八例耗时不用于性能排名。

`results.json` 保留逐样例、逐条件的候选、停止原因、实际阶段、阶段输入/输出、分母和全部失败例；`report.md` 展示汇总。来源文件与评估器 SHA-256、Git 源提交和生成时间用于复核。它们不能独立证明报告的新鲜度，传入可靠性报告时必须使用同次实际运行的产物，不得混用旧 XML。

## 重跑

在仓库根目录执行（Windows 通过 PowerShell 7 调用）：

```text
python -m unittest discover -s scripts/tests -p test_evaluate_agent_collaboration.py
python -m py_compile scripts/evaluate_agent_collaboration.py
python scripts/evaluate_agent_collaboration.py --corpus evaluation/agent-collaboration/corpus.json --output tmp/issue24/replay
```

只执行上述命令时，Java/MySQL/HTTP 可靠性必须显示 **NOT_RUN**。需要当前可靠性证据时，先按 `docs/patient-draft.md`、`docs/patient-explanation.md` 配置专用 `ISSUE19_TEST_URL` 和 `ISSUE21_TEST_URL`；数据库名、用户、密码均使用对应的 `issue19` / `issue21` 测试约定。这两套测试会清空各自测试库中的合成表，不得连接业务库。使用项目规定的 JDK 21：

```text
mvn -B clean -Dtest=PatientDraftTest,PatientExplanationApiTest test
python scripts/check_surefire_skips.py target/surefire-reports issue19
python scripts/check_surefire_skips.py target/surefire-reports issue21
python scripts/evaluate_agent_collaboration.py --corpus evaluation/agent-collaboration/corpus.json --surefire-dir target/surefire-reports --output tmp/issue24/current
```

导入器要求两套当前报告完整存在（27 + 37 = 64 项），并要求证据不足、工具越权、独立进程崩溃恢复、受限提示、患者越权、迟到输出、来源撤回等行为用例存在。失败、错误或跳过均保留在分母与逐例列表中，不能升级为通过。退出码：0 为评分完成且所提供可靠性全部通过（未提供时仍为 NOT_RUN）；1 为提供的可靠性有失败/错误/跳过；2 为输入或报告不完整。离线样例中预先植入的反例用于比较，不使 CLI 自身失败。

新增 `verify.yml` 的 `issue24-evaluation` 作业执行同样流程，保存 Markdown、JSON 及原始 XML 工件。当前提交的离线、本地实际真库、远端 CI、浏览器、真实模型、领域、临床与生产证据必须分别报告；配置 CI 作业不表示已运行远端 CI。

真实模型服务、真实 Python 推理、浏览器、真实资料领域审核、临床和生产验收均不由本 CLI 执行。任何评估结果都不声明临床有效性或生产验收。
