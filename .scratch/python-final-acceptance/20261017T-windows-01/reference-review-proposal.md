# 参考资料人工审核清单（尚未批准）

本清单仅供实际参与者核对，不代表内容、来源或公开范围已经审核通过。
目标仅为本轮隔离验收库；没有执行治理 PATCH，没有改变任何复核或保存决定。

| 已索引 ID | 本机源文件 | 拟选疾病编码 | 拟选主题编码 |
|---|---|---|---|
| 2 | [01-normal.md](D:/Work/code/eye-diagnosis/src/main/resources/rag/01-normal.md) | normal | DISEASE_OVERVIEW |
| 4 | [03-cataract.md](D:/Work/code/eye-diagnosis/src/main/resources/rag/03-cataract.md) | cataract | DISEASE_OVERVIEW |
| 8 | [07-myopia.md](D:/Work/code/eye-diagnosis/src/main/resources/rag/07-myopia.md) | myopia | DISEASE_OVERVIEW |

文件 SHA256（2026-10-17 本机复算）：

- 01-normal.md：`0a8fbbb041255889816aebb1f45c1b19885cb5784c0efa1219744b20313fe24f`
- 03-cataract.md：`2aa7211a8c4d4d1e5b0ddf43a870ec0769097bf2c2090fd5882e49fe9d5e1852`
- 07-myopia.md：`6a7de402e6315f3a1e4a0429de39704645bcbf534b39e0e6c7cadc5d1bb0a35b`

## 实际参与者操作

1. 医生先阅读本机源文件，核对内容、来源及可分享范围。未认可的文件保持待审核；发现问题时记录原因，不为跑通验收而批准。
2. 审核认可后，以本轮隔离账号 `accept_admin` 登录 <http://127.0.0.1:5173/admin/knowledge>。
3. 在对应文件行点击“审核属性”，核对文件名与当前版本。可见范围选“公共参考资料”，审核状态选“审核通过”，按上表核对疾病编码及 DISEASE_OVERVIEW。只选择实际认可的范围。
4. 核对后由参与者勾选“我已核对资料来源、分享范围和以上属性”，点击“确认保存审核变更”。若版本冲突，刷新重新核对。
5. 告知已批准的文件名，或记录未批准原因。自动化只读回治理状态和版本，不代替审核。

资料公开/审核不是确认模型预测，不是最终临床复核，也不是患者保存授权。
已完成的 1_left.jpg、0_left.jpg 任务保持原终态，不直接改库让它们重跑。
后续解释与保存场景须在资料可用后另行准备；真实解释超时仍保留为独立阻塞，不保证审核资料后即可保存。

本轮剩余格式探针及其余资料不在此批准建议范围内。
