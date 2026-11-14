# 知识库文档工作区 · 截图证据（PR-A）

这些图是**真实运行系统**的截图：React 前端（`web/`，Vite，:5183）+ 本工作树的 Spring Boot
后端（:8083）+ 本地 MySQL 8 / Redis / ChromaDB。没有 ImageGen、没有静态 HTML 模拟、没有
手工填充的假数据；每张图里的文件名、状态、切片、时间戳都来自接口与数据库。

- 采集脚本：`web/scripts/evidence/admin-doc-preview.mjs`（Playwright，Chromium 1234）
- 采集方式：脚本自备 PDF / DOCX / DOC 三份夹具（真实走上传接口入库），登录 → 知识库列表按
  文件名筛选 → 点行内「预览文档」→ 等原文容器出现 → 截图；采完按文件名删除夹具，库里不留测试数据
- 覆盖视口：390 / 768 / 1280 / 1440 / 1920；主题：浅色 + 深色（全格式覆盖深色）
- 截图**不等于**人工视觉签收；最终判断仍由人做。

## 文件与已验证内容

| 文件 | 文档 | 状态 | 证明什么 |
|---|---|---|---|
| `workspace-md-1440-light.png` | 眼科疾病知识库.md（id 11） | 已完成 | 双栏：左 Markdown 富文本，右切片清单；头部读数与切片栏一致 |
| `workspace-md-1440-light-chunk-collapsed.png` | 同上 | 已完成 | 单块折叠可交互（CHUNK 01 收起、CHUNK 02 仍展开） |
| `workspace-md-1440-light-chunks-scrolled.png` | 同上 | 已完成 | 两栏独立滚动：只滚切片栏，原文栏停在原处 |
| `workspace-md-1440-dark.png` | 同上 | 已完成 | 深色主题同构，语义色未翻转错位 |
| `workspace-md-1440-dark-chunk-collapsed.png` / `-chunks-scrolled.png` | 同上 | 已完成 | 深色下的折叠与独立滚动 |
| `workspace-pdf-1440-light.png` | 眼底影像判读规范.pdf | 处理失败 | PDF 由浏览器内置查看器内嵌渲染（同源代理、inline） |
| `workspace-pdf-1440-dark.png` | 同上 | 处理失败 | 深色下 PDF 外观由浏览器内置查看器决定，不随站点翻转（如实记录） |
| `workspace-pdf-390-light.png` | 同上 | 处理失败 | 窄屏下 PDF 仍可读，「原文 / 切片」页签切换 |
| `workspace-docx-1440-light.png` | 眼科疾病分类说明.docx | 处理失败 | DOCX 在浏览器内（mammoth）转 HTML：标题、列表、三列宽表都在，无外部服务 |
| `workspace-docx-1440-dark.png` | 同上 | 处理失败 | 深色下 DOCX 解析产物与卡片层级 |
| `workspace-docx-1280-light.png` | 同上 | 处理失败 | 1280 视口下抽屉宽 `min(1180px, 100vw-248px)`：侧栏完整可见、不再被盖住 |
| `workspace-docx-390-light.png` | 同上 | 处理失败 | 390 下 DOCX 页签形态：标题与列表 |
| `workspace-docx-390-light-table.png` | 同上 | 处理失败 | 390 下滚到表格，三列宽表逐列可读（表格在首屏折线以下，需滚动才看得到） |
| `workspace-doc-1440-light.png` | 旧版病历模板.doc | 处理失败 | DOC 明确降级：实线边框说明卡 + 只给下载，绝不按 DOCX 解析 |
| `workspace-doc-1440-dark.png` | 同上 | 处理失败 | 深色下降级卡与「DOC 不做在线解析」切片栏故障文案 |
| `workspace-txt-1440-light.png` | prompt.txt（id 2） | 已完成 | TXT 按纯文本原样呈现，Markdown 记号不被二次渲染 |
| `workspace-txt-1440-dark.png` | 同上 | 已完成 | 深色下 `<pre>` 等宽排版与换行保留 |
| `workspace-md-390-light.png` | 眼科疾病知识库.md | 已完成 | 390 视口切换为「原文 / 切片」页签，面板全屏 |
| `workspace-md-390-light-chunks.png` | 同上 | 已完成 | 390 下的切片清单（含入库计数与重放计数不一致的说明） |
| `workspace-md-390-dark.png` | 同上 | 已完成 | 390 深色：页签、关闭按钮 40×40 目标、读数换行 |
| `workspace-md-768-light.png` / `-dark.png` | 同上 | 已完成 | 768 平板视口：页签形态 + 重放计数限定语 |
| `workspace-md-1920-light.png` / `-dark.png` | 同上 | 已完成 | 1920 宽屏：双栏比例、目录式排版与深色宽屏层级 |

## 视觉审查整改复验（本轮截图对应的修复）

### 第 4 轮（视觉审查 verdict：READY FOR HUMAN REVIEW，无 P0/P1）

- **窄屏关闭键回到右上角**（P2-1）：头部换行后「下载 / 关闭」原本落到第二行左对齐，关闭键
  离右缘约 160px、紧挨下载按钮，误触风险高。现在窄屏（≤560px）下关闭键绝对定位到头部
  右上角，40×40 命中区不变（`workspace-md-390-light.png` / `-dark.png`、
  `workspace-pdf-390-light.png`、`workspace-docx-390-light.png`）。
- **切片头部真的吸顶**（P2-2）：卡片原本是 `overflow: hidden`，卡片自身成为最近滚动容器，
  `position: sticky` 的头只能在不滚动的卡片里粘——等于没吸顶。改成 `overflow: clip`
  （保留圆角裁剪但不建立滚动容器）后实测吸顶生效：切片栏滚到中段时，卡片顶已到 -737px，
  卡片头仍钉在容器顶 123px（`workspace-md-1440-*-chunks-scrolled.png`）。
- **窄屏元信息不再以「·」领行**（P3-1）：≤560px 时分隔点会孤零零地起一行、看着像 bullet，
  改为去掉分隔点、用更宽的间距区分各项（`workspace-md-390-light.png`）。
- **PDF 文件名的归属写准**（P3-3）：真正让人认出「这是哪个文件」的是内嵌查看器**上方**的
  徽标（`眼底影像判读规范.pdf · 浏览器内嵌查看器`）；Chrome 原生工具栏里的 `about:blank`
  是浏览器自身行为，iframe 的 `title` 属性改不动它——这一点如实写明，不假装能改。

### 第 1 轮（REQUEST CHANGES，4 个 P1）

第一轮视觉审查给出 REQUEST CHANGES（4 个 P1，无 P0），整改后重采：

- **1280 不再盖住侧栏**：抽屉宽度改为 `min(1180px, calc(100vw - 248px))`，
  `workspace-docx-1280-light.png` 可见侧栏完整、抽屉与侧栏之间是叠加层而不是互相吃掉。
- **关闭目标**：headless 抽屉 + 工作区自带 40×40 关闭按钮（`workspace-md-390-dark.png`
  等窄屏图可见），不再依赖被遮罩的侧栏关闭入口。
- **未定义令牌**：切片栏提示改用 `--admin-line-strong` / `--admin-surface-deep`
  （`workspace-doc-1440-light.png` / `-dark.png` 的提示块）。
- **元信息分隔与换行**：头部读数用 `span + span::before` 的「·」分隔且不折行
  （全部 1440/1920 图）。
- **计数口径**：重放切片时头部与切片栏都带「当前规则重放」限定语，不再暗示一一对应
  （`workspace-md-*` 各图）。
- **下载入口统一**：只有头部一个「下载原文件」；不支持格式的说明卡上是同一个链接的
  次级按钮（`workspace-doc-1440-light.png`）。
- **PDF 归属**：内嵌查看器**上方**的徽标写清「文件名 · 浏览器内嵌查看器」，避免 Chrome
  原生工具栏的 `about:blank` 造成「空白页」误读（`workspace-pdf-*`）。
- **切片栏可操作目标**：卡片头吸顶（第 4 轮修复，程序化实测过）、折叠 / 复制按钮最小 28px
  （`workspace-md-1440-*-chunks-scrolled.png`）。

## 环境限制（如实记录，不是产品缺陷的遮羞布）

1. **向量化失败（status=2）**：本机 `application-local.yml` 里的 DashScope key 调用
   embedding 接口返回 **HTTP 401**，因此本轮上传的四份夹具（pdf/docx/doc/txt）停在
   「失败」而不是「已完成」。切片清单仍可读——它走的是「下载原文件 → 同一套解析与切分规则
   重放」，不依赖向量库。界面因此分成两种读数：
   - 已入库文档：`N 块切片` + 「每条与向量库序号一一对应」；
   - 未入库文档：头部 `N 块 · 未入库`，切片栏明确写「尚未入库（状态：失败）」并说明
     这些块只是本地重放、检索不会命中。
   没有把失败状态改成成功来凑截图。
2. **`眼科疾病知识库.md` 入库 11 块 / 当前规则重放 9 块**：该文档入库时与现在的切分参数
   并不完全一致。界面不假设两者相等：头部跟随**看到的清单**（9），切片栏摘要写
   「入库时 11 块，按当前规则重放 9 块」，不再声称与向量库序号一一对应。
3. **DOC 夹具是合成的 OLE2 头**：资源生成脚本造了一个带复合文档头的 .doc；解析器读不出
   正文，所以切片栏显示「文档正文为空」的不可读态，而不是空列表。真实老 Word 文件
   行为相同：不解析、只下载。

## 未覆盖 / 需要人复核

- 未做真实扫描件 PDF 的 OCR 路径（产品不做 OCR，只如实报告「读不到」）。
- PDF 内嵌查看器的深色外观由浏览器决定，不随站点主题翻转（`workspace-pdf-1440-dark.png`
  如实记录）；DOCX/TXT/MD 的深色渲染由本站样式控制，已覆盖。
- 截图里出现的文档都是本地库中的既有内容或本轮上传的测试夹具；夹具文档在验收结束后删除（不留在库里）。
