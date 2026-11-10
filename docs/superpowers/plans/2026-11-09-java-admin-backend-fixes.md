# React 管理后台后端缺陷修复 Implementation Plan

> **历史快照（2026-11-09）**：计划中的「本系统不实现新建路径」取舍已于 2026-11-10
> 被资讯生命周期建模 `4a3f0ac` 推翻（`/news/edit` id 为空即创建，新增 `status=3`
> 与 `note`）。其余缺陷均已按本计划修复并合入 `origin/master`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 2026-11-09 真实后端联调实测确认的 5 条 Java 后端缺陷（GitHub issue #26–#30），每条带回归测试。

**Architecture:** 每条缺陷是一个独立任务，落在 Spring Boot 后端（`src/main/java/com/csust/eyediagnosis/`）。修法一律走「把纯逻辑抽成可单测的方法 + 一条 JUnit 5 单测」的缝——本仓库的服务实现多数继承 MyBatis-Plus `ServiceImpl`，直接 new 出来调不了 SQL，所以可测性靠抽出静态/包级私有方法，不靠起 Spring 容器。

**Tech Stack:** Java 21（`C:\Users\yuwen\.jdks\corretto-21.0.7`）、Spring Boot 3.5.6、MyBatis-Plus、JUnit 5 + spring-boot-starter-test（Mockito 可用）。

**Spec:** 5 条缺陷的完整描述在 GitHub issue `#26`–`#30`（仓库 `yuwen773/eyes-diagnosis`）。**issue 正文就是各任务的验收标准**，实现前必读对应 issue。设计背景见 `docs/superpowers/specs/2026-11-08-react-admin-port-design.md` §7。

---

## Global Constraints

以下约束对每个任务都生效，违反即视为实现不合规：

1. **Java 版本**：用 `C:\Users\yuwen\.jdks\corretto-21.0.7`。每条 Maven 命令前先设 `JAVA_HOME`。不要用宿主默认的 JDK 23。
2. **包名与分层**：全部代码在 `com.csust.eyediagnosis` 下，遵守 Controller → Service → Mapper 分层。控制器只做参数校验与编排，业务规则落在 Service。
3. **响应契约**：统一 `BaseResponse<T>{code, data, msg}`；业务失败抛 `BusinessException(ErrorCode.X, msg)`，由全局异常处理器转成信封。**不要**自己 catch 异常再包 `ResultUtils.error`。
4. **错误码**：参数类问题用 `ErrorCode.PARAMS_ERROR`，不存在用 `ErrorCode.NOT_FOUND_ERROR`，无权限用 `ErrorCode.NO_AUTH_ERROR`。新增错误文案要写成给人看的一句话（说明发生了什么、怎么办）。
5. **MyBatis-Plus 约束**：`map-underscore-to-camel-case: false`，数据库列名就是小驼峰（`userId`/`coverImg`/`editTime`），实体字段名与列名逐字对应。默认字段策略 `NOT_NULL`——**null 字段不进 SET**，本计划的窄更新依赖这一点；空串会进 SET。
6. **不引新依赖**：只用仓库已有的依赖（spring-boot-starter-test 自带 JUnit 5 与 Mockito）。
7. **测试形态**：纯 JUnit 5 单测，**不起 Spring 容器**（本机 `mvn test` 的 `contextLoads` 必红——它要 Redis 与 MySQL，属已知环境限制，不要试图修它）。测试文件放 `src/test/java/com/csust/eyediagnosis/` 下与被测类对应的包路径。
8. **不碰的东西**：
   - 不改 `web/`（React 前端是独立内嵌 git 仓库，不属于这条分支）。
   - 不改 `frontend/`（Vue 前端属另一条线）。
   - 不改 `algorithm/`（Python 算法线）。
   - 不改 `src/main/resources/db/migration/` 下已应用的迁移文件；需要新表就加新迁移。
9. **提交**：一票一提交（或一票多提交），提交信息用中文规范式（`fix(后端): …` / `test(后端): …`）。不要 `git push`，不要合并到 master。
10. **本次执行方式**：按 `mattpocock-skills:implement` 的流程走——先读 issue 并复述标题，按预先约定的缝做 TDD（先写失败测试 → 跑 → 实现 → 跑），期间频繁跑类型检查与单个测试文件，最后跑一次完整测试套件；收尾时用 `mattpocock-skills:code-review` 自查一遍；提交到当前分支。

---

## Review Focus

以下是规格暗示、但没有哪条任务的测试直接覆盖、且最可能伤到真实用户的输入/条件。每条都写进了对应任务的测试步骤：

1. **窄更新会不会顺手改掉别的列**——依赖 MP 的 `NOT_NULL` 策略（null 不进 SET）。若将来有人给实体加 `@TableField(fill = ...)` 自动填充，这条保证就失效 → Task 1 的测试断言 patch 实体的 title/userId 为 null。
2. **空串与 null 在 UPDATE 里的含义不同**——空串会进 SET（=清除），null 被跳过（=保持原值）。清封面必须走空串，不能用 null → Task 2 的测试覆盖 null / "" / 有值三种。
3. **编辑新闻时不能把发布状态偷偷改成草稿**——请求体不含 `status` 时 DTO 该字段为 null，`BeanUtils.copyProperties` 不覆盖，库中现值保持 → Task 3 的测试断言 status 未被改动。
4. **给管理员全站视角不能顺带放宽普通用户**——非管理员仍必须按登录人过滤；且 `userId` 为 null 时查询包装器不能生成 `user_id IS NULL` 这种条件 → Task 4 的测试两条都断言。
5. **正文太短不能变成 500**——后端自己校验并返回业务错误码；摘要生成不得抛 `StringIndexOutOfBoundsException` → Task 5 的测试覆盖空正文/短正文/正常正文三条路径。

---

### Task 1: 上传新闻封面只更新封面（issue #26）

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/service/impl/NewsServiceImpl.java`（`uploadCoverImage`）
- Test: `src/test/java/com/csust/eyediagnosis/service/NewsCoverUpdateTest.java`

**Interfaces:**
- Consumes: 现有 `News` 实体（`src/main/java/com/csust/eyediagnosis/model/entity/News.java`，字段 `id`/`title`/`userId`/`content`/`summary`/`coverImg`/`status`/`publishTime`/`editTime`）、`FileManager.uploadPicture`、`NewsUploadDTO`。
- Produces: `NewsServiceImpl` 中一个包级可见（package-private）静态方法，供单测调用：
  ```java
  static News coverPatch(Long newsId, String coverUrl, Date editTime)
  ```
  返回的实体**只**带 `id`、`coverImg`、`editTime` 三个有值的字段，其余字段一律为 `null`。

- [ ] **Step 1: 读 issue #26 并复述标题**

  跑 `gh issue view 26 --repo yuwen773/eyes-diagnosis`。把你的理解写进报告第一行（含 issue 标题原文）。

- [ ] **Step 2: 写失败测试**

  建 `src/test/java/com/csust/eyediagnosis/service/NewsCoverUpdateTest.java`：

  ```java
  class NewsCoverUpdateTest {
      @Test
      void coverPatchCarriesOnlyCoverFields() {
          Date now = new Date();
          News patch = NewsServiceImpl.coverPatch(1L, "https://cdn/cover.png", now);
          Assertions.assertEquals(1L, patch.getId());
          Assertions.assertEquals("https://cdn/cover.png", patch.getCoverImg());
          Assertions.assertEquals(now, patch.getEditTime());
          // 其余列必须是 null——MP 的 NOT_NULL 策略会让 null 字段不进 SET，
          // 这是「不覆盖标题/作者」的全部保证。
          Assertions.assertNull(patch.getTitle());
          Assertions.assertNull(patch.getUserId());
          Assertions.assertNull(patch.getContent());
          Assertions.assertNull(patch.getSummary());
          Assertions.assertNull(patch.getStatus());
          Assertions.assertNull(patch.getPublishTime());
      }
  }
  ```

- [ ] **Step 3: 跑测试确认它失败**

  `mvn -q test -Dtest=NewsCoverUpdateTest` → 期望编译失败（`coverPatch` 不存在）。

- [ ] **Step 4: 实现**

  在 `NewsServiceImpl` 里加上面那个静态方法，并改写 `uploadCoverImage`：
  - `newsId != null`（更新分支）：**不再**构造带 `title=""`/`userId` 的实体再 `saveOrUpdate`，改为
    `this.updateById(coverPatch(newsId, uploadPictureDetail.getUrl(), new Date()))`。
  - `newsId == null`（新增分支）：保持现有插入语义不变（`saveOrUpdate`），本票不动它。
  - 删掉 `System.err.println(newsId)` 这行遗留调试输出。

- [ ] **Step 5: 跑测试确认通过**

  `mvn -q test -Dtest=NewsCoverUpdateTest` → PASS。

- [ ] **Step 6: 跑类型检查与相关既有测试**

  `mvn -q compile` 与 `mvn -q test -Dtest=NewsControllerOwnershipTest`（若存在同类测试则一并跑）。

- [ ] **Step 7: 提交**

  ```bash
  git add src/main/java/com/csust/eyediagnosis/service/impl/NewsServiceImpl.java src/test/java/com/csust/eyediagnosis/service/NewsCoverUpdateTest.java
  git commit -m "fix(后端): 上传新闻封面只更新 coverImg，不再清空标题与作者"
  ```

---

### Task 2: 新闻封面字段映射与清除语义（issue #27）

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/controller/NewsController.java`（`updateNews`）
- Test: `src/test/java/com/csust/eyediagnosis/controller/NewsCoverMappingTest.java`

**Interfaces:**
- Consumes: `NewsUpdateDTO`（`src/main/java/com/csust/eyediagnosis/model/dto/news/NewsUpdateDTO.java`，字段 `coverImage`）、`News`（字段 `coverImg`）、Task 1 的 `NewsServiceImpl.coverPatch`（**本任务不依赖它**，两条路径互不干扰）。
- Produces: `NewsController` 中一个包级可见静态方法：
  ```java
  static News buildNewsForEdit(NewsUpdateDTO dto)
  ```
  行为：`dto` 的 `coverImage` 非 null 时 → `news.setCoverImg(dto.getCoverImage())`（**空串也照传**，空串 = 清除）；为 null 时 → `coverImg` 保持 null（= 不动）。

- [ ] **Step 1: 读 issue #27 并复述标题**

- [ ] **Step 2: 写失败测试**

  建 `src/test/java/com/csust/eyediagnosis/controller/NewsCoverMappingTest.java`，三条用例：

  ```java
  class NewsCoverMappingTest {
      @Test
      void coverUrlIsMappedOntoCoverImg() {
          NewsUpdateDTO dto = new NewsUpdateDTO();
          dto.setId(1L);
          dto.setTitle("标题");
          dto.setContent("正文正文正文正文正文正文正文正文正文正文正文");
          dto.setCoverImage("https://cdn/x.png");
          News news = NewsController.buildNewsForEdit(dto);
          Assertions.assertEquals("https://cdn/x.png", news.getCoverImg());
      }

      @Test
      void emptyStringClearsCover() {
          NewsUpdateDTO dto = new NewsUpdateDTO();
          dto.setId(1L);
          dto.setCoverImage("");
          News news = NewsController.buildNewsForEdit(dto);
          Assertions.assertEquals("", news.getCoverImg());   // 空串进 SET = 清除
      }

      @Test
      void absentCoverLeavesCoverUntouched() {
          NewsUpdateDTO dto = new NewsUpdateDTO();
          dto.setId(1L);
          News news = NewsController.buildNewsForEdit(dto);
          Assertions.assertNull(news.getCoverImg());          // null 被跳过 = 保持原值
      }
  }
  ```

- [ ] **Step 3: 跑测试确认失败** → `mvn -q test -Dtest=NewsCoverMappingTest` 编译失败。

- [ ] **Step 4: 实现**

  在 `NewsController.updateNews` 里：
  - 保留 `BeanUtils.copyProperties(newsUpdateDTO, news)` 承担 title/content 等字段的拷贝；
  - 紧接着显式补一句封面映射（`coverImage` → `coverImg`），使 `buildNewsForEdit` 成为唯一构造入口，控制器只调它。
  - **不要**改 `NewsUpdateDTO` 的字段名（对外契约是 `coverImage`，前端在用）；也不要改 `NewsVO.coverImage`（读侧契约，前端在用）。

- [ ] **Step 5: 跑测试确认通过** → `mvn -q test -Dtest=NewsCoverMappingTest` PASS。

- [ ] **Step 6: 跑类型检查** → `mvn -q compile`。

- [ ] **Step 7: 提交**

  ```bash
  git add src/main/java/com/csust/eyediagnosis/controller/NewsController.java src/test/java/com/csust/eyediagnosis/controller/NewsCoverMappingTest.java
  git commit -m "fix(后端): 新闻编辑显式映射封面，空串可清除、缺省不改原封面"
  ```

---

### Task 3: NewsVO 暴露发布状态（issue #28）

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/model/vo/news/NewsVO.java`（加字段）
- Modify: `src/main/java/com/csust/eyediagnosis/service/impl/NewsServiceImpl.java`（VO 转换）
- Test: `src/test/java/com/csust/eyediagnosis/service/NewsStatusExposureTest.java`

**Interfaces:**
- Consumes: `News.status`（`Integer`，0 草稿 / 1 已发布 / 2 下架）、`BeanUtil`（hutool）。
- Produces: `NewsVO.status`（`Integer`）；`NewsServiceImpl` 中包级可见静态方法
  ```java
  static NewsVO toNewsVO(News news)
  ```
  承担现在的 `BeanUtil.copyProperties(news, newsVO)` 转换，供单测调用。

- [ ] **Step 1: 读 issue #28 并复述标题**

- [ ] **Step 2: 写失败测试**

  建 `src/test/java/com/csust/eyediagnosis/service/NewsStatusExposureTest.java`：

  ```java
  class NewsStatusExposureTest {
      @Test
      void voCarriesStatus() {
          News news = new News();
          news.setId(1L);
          news.setTitle("标题");
          news.setStatus(1);
          NewsVO vo = NewsServiceImpl.toNewsVO(news);
          Assertions.assertEquals(1, vo.getStatus());
          Assertions.assertEquals("标题", vo.getTitle());
      }

      @Test
      void statusSurvivesTheEditPathWhenAbsent() {
          NewsUpdateDTO dto = new NewsUpdateDTO();
          dto.setId(1L);
          dto.setTitle("标题");
          News news = NewsController.buildNewsForEdit(dto);   // 请求体不含 status
          Assertions.assertNull(news.getStatus());             // null → 不进 SET → 库中现值保持
      }
  }
  ```

  > 第二条用例是 Review Focus 第 3 条：编辑不能把发布状态偷偷改成草稿。它依赖 Task 2 的 `NewsController.buildNewsForEdit`——若 Task 2 尚未落地，先只写第一条，第二条留到 Task 3 与 Task 2 都完成后补（并在报告里说明）。

- [ ] **Step 3: 跑测试确认失败** → 编译失败（`getStatus` 不存在）。

- [ ] **Step 4: 实现**

  - `NewsVO` 增加 `private Integer status;`（字段名与实体一致，hutool `BeanUtil.copyProperties` 自动拷贝）。
  - 把 `NewsServiceImpl` 里所有 `BeanUtil.copyProperties(news, newsVO)` 的转换收拢到 `static NewsVO toNewsVO(News news)`，各处改调它；**列表批量转换也要走同一个方法**（否则列表页仍拿不到 status）。
  - 确认 `t_news.status` 为 `tinyint(1)`，取值 0/1/2 已在实体注释里写明。

- [ ] **Step 5: 跑测试确认通过** → `mvn -q test -Dtest=NewsStatusExposureTest` PASS。

- [ ] **Step 6: 跑类型检查与相关测试** → `mvn -q compile`；跑 `mvn -q test -Dtest=NewsControllerOwnershipTest`（若存在）。

- [ ] **Step 7: 提交**

  ```bash
  git add src/main/java/com/csust/eyediagnosis/model/vo/news/NewsVO.java src/main/java/com/csust/eyediagnosis/service/impl/NewsServiceImpl.java src/test/java/com/csust/eyediagnosis/service/NewsStatusExposureTest.java
  git commit -m "feat(后端): NewsVO 暴露 status，列表与详情都能读到发布状态"
  ```

---

### Task 4: 管理端诊断与知识库的全站视角（issue #29）

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/controller/DiagnosisController.java`（`listDiagnosisVOByPage` 与其 cache 变体）
- Modify: `src/main/java/com/csust/eyediagnosis/controller/KnowledgeBaseController.java`（`listPage`）
- Modify: `src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java`（查询包装器的 userId 条件）
- Test: `src/test/java/com/csust/eyediagnosis/controller/AdminScopeVisibilityTest.java`

**Interfaces:**
- Consumes: `UserRole`（`src/main/java/com/csust/eyediagnosis/model/enums/UserRole.java`，`UserRole.ADMIN`）、`DiagnosisQueryDTO.userId`、`User.userRole`。
- Produces: 一个包级可见静态判定方法（放在 `DiagnosisServiceImpl` 或一个共享位置，控制器与知识库控制器都用它）：
  ```java
  static boolean seesAllRecords(User loginUser)
  ```
  语义：`loginUser` 的角色是 admin 时返回 `true`（全站视角），否则 `false`。

- [ ] **Step 1: 读 issue #29 并复述标题**

- [ ] **Step 2: 写失败测试**

  建 `src/test/java/com/csust/eyediagnosis/controller/AdminScopeVisibilityTest.java`：

  ```java
  class AdminScopeVisibilityTest {
      @Test
      void adminSeesAllRecords() {
          User admin = new User();
          admin.setId(1L);
          admin.setUserRole(AuthConstant.ADMIN_ROLE);
          Assertions.assertTrue(DiagnosisServiceImpl.seesAllRecords(admin));
      }

      @Test
      void normalUserSeesOnlyOwn() {
          User user = new User();
          user.setId(2L);
          user.setUserRole(AuthConstant.DEFAULT_ROLE);
          Assertions.assertFalse(DiagnosisServiceImpl.seesAllRecords(user));
      }

      @Test
      void scopeIsNotAppliedToNonAdmin() {
          // 控制器对非管理员必须照旧覆盖 userId
          User user = new User();
          user.setId(2L);
          user.setUserRole(AuthConstant.DEFAULT_ROLE);
          DiagnosisQueryDTO dto = new DiagnosisQueryDTO();
          DiagnosisServiceImpl.applyVisibilityScope(dto, user);
          Assertions.assertEquals(2L, dto.getUserId());
      }

      @Test
      void scopeIsNotAppliedToAdmin() {
          User admin = new User();
          admin.setId(1L);
          admin.setUserRole(AuthConstant.ADMIN_ROLE);
          DiagnosisQueryDTO dto = new DiagnosisQueryDTO();
          DiagnosisServiceImpl.applyVisibilityScope(dto, admin);
          Assertions.assertNull(dto.getUserId());   // null → 查询不加 userId 条件
      }
  }
  ```

- [ ] **Step 3: 跑测试确认失败** → 编译失败（方法不存在）。

- [ ] **Step 4: 实现**

  - `DiagnosisServiceImpl` 加 `static boolean seesAllRecords(User loginUser)` 与 `static void applyVisibilityScope(DiagnosisQueryDTO dto, User loginUser)`：
    - `seesAllRecords`：`loginUser != null && AuthConstant.ADMIN_ROLE.equals(loginUser.getUserRole())`。
    - `applyVisibilityScope`：`seesAllRecords` 为真时**什么都不做**（`dto.userId` 保持 null）；否则 `dto.setUserId(loginUser.getId())`。
  - `DiagnosisController.listDiagnosisVOByPage` 与 `listDiagnosisVOByPageWithCache`：把 `diagnosisQueryDTO.setUserId(loginUser.getId())` 换成 `DiagnosisServiceImpl.applyVisibilityScope(diagnosisQueryDTO, loginUser)`。
    - **不要动** `/diagnosis/list/page/my`（那是给用户看「我的判读记录」的端点）。
  - `KnowledgeBaseController.listPage`：`userId` 改为条件取值——管理员为 null（不加 `eq` 条件），否则登录人 id。注意原来是 `.eq(KnowledgeDocument::getUserId, userId)`，条件化后管理员要**完全不加这个 eq**（不能 `eq(null)`）。
  - 检查 `DiagnosisServiceImpl.getDiagnosisQueryWrapper`：当 `userId` 为 null 时不能生成 `user_id IS NULL` 之类的条件——确认 wrapper 在 userId 为 null 时跳过该条件（若现在是无条件 `eq`，改成条件式）。

- [ ] **Step 5: 跑测试确认通过** → `mvn -q test -Dtest=AdminScopeVisibilityTest` PASS。

- [ ] **Step 6: 跑类型检查与相关测试** → `mvn -q compile`；跑既有的 `DiagnosisOwnershipTest`（若它断言 userId 被强制覆盖，需按本票语义更新该测试并在报告里说明）。

- [ ] **Step 7: 提交**

  ```bash
  git add src/main/java/com/csust/eyediagnosis/controller/DiagnosisController.java src/main/java/com/csust/eyediagnosis/controller/KnowledgeBaseController.java src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java src/test/java/com/csust/eyediagnosis/controller/AdminScopeVisibilityTest.java
  git commit -m "feat(后端): 管理端诊断与知识库列表提供全站视角，普通用户仍限本人"
  ```

---

### Task 5: 新闻编辑的正文校验与明确的新建口径（issue #30）

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/controller/NewsController.java`（`updateNews` 的校验与摘要生成）
- Test: `src/test/java/com/csust/eyediagnosis/controller/NewsContentValidationTest.java`

**Interfaces:**
- Consumes: `NewsUpdateDTO.content`、`ErrorCode.PARAMS_ERROR`、`BusinessException`。
- Produces: `NewsController` 中包级可见静态方法：
  ```java
  static String buildSummary(String content)   // 校验并截断；不合法时抛 BusinessException
  ```

- [ ] **Step 1: 读 issue #30 并复述标题**

- [ ] **Step 2: 写失败测试**

  建 `src/test/java/com/csust/eyediagnosis/controller/NewsContentValidationTest.java`：

  ```java
  class NewsContentValidationTest {
      @Test
      void blankContentIsRejected() {
          BusinessException ex = Assertions.assertThrows(BusinessException.class,
                  () -> NewsController.buildSummary("   "));
          Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
      }

      @Test
      void tooShortContentIsRejected() {
          BusinessException ex = Assertions.assertThrows(BusinessException.class,
                  () -> NewsController.buildSummary("只有十九个字而已这里凑不满三十"));
          Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
      }

      @Test
      void summaryIsFirstThirtyChars() {
          String content = "眼底影像人工智能分析系统Airdoc近日宣布其AI诊断功能实现重大更新，新版系统能够更精准地识别多种眼底疾病。";
          Assertions.assertEquals(content.substring(0, 30), NewsController.buildSummary(content));
      }
  }
  ```

- [ ] **Step 3: 跑测试确认失败** → 编译失败。

- [ ] **Step 4: 实现**

  - `buildSummary(String content)`：
    - `content == null` 或 `trim()` 后为空 → 抛 `BusinessException(ErrorCode.PARAMS_ERROR, "正文不能为空")`；
    - `content.length() < 30` → 抛 `BusinessException(ErrorCode.PARAMS_ERROR, "正文至少 30 字（后端以正文前 30 字生成摘要）")`；
    - 否则返回 `content.substring(0, 30)`（**不得**抛 `StringIndexOutOfBoundsException`）。
  - `updateNews` 用 `buildSummary` 取代现在的裸 `getContent().substring(0, 30)`。
  - `id == null` 的分支：保留抛 `BusinessException(ErrorCode.PARAMS_ERROR, ...)`，但文案改成明确的「暂不支持新建新闻，请指定新闻 id」——本系统**不实现**新建路径（见 issue #30 的方案取舍），前端入口的移除是另一张前端票。

- [ ] **Step 5: 跑测试确认通过** → `mvn -q test -Dtest=NewsContentValidationTest` PASS。

- [ ] **Step 6: 跑类型检查与全套测试**

  `mvn -q compile`；`mvn -q test`（完整套件；`EyeDiagnosisApplicationTests` 的 `contextLoads` 在本机预期失败——它要 Redis 与 MySQL，属已知环境限制，在报告里写明失败原因，不要去「修」它）。

- [ ] **Step 7: 提交**

  ```bash
  git add src/main/java/com/csust/eyediagnosis/controller/NewsController.java src/test/java/com/csust/eyediagnosis/controller/NewsContentValidationTest.java
  git commit -m "fix(后端): 新闻编辑校验正文长度，非法正文返回业务错误码而非 500"
  ```

---

## 自查记录（写计划时核对）

- **规格覆盖**：5 条 issue 各一个任务，issue 的验收标准全部落成测试或明确的口径说明；issue #30 的「新建路径」按「不支持」收敛并写进代码文案与本计划。
- **类型一致**：`coverPatch`（Task 1 产）、`buildNewsForEdit`（Task 2 产）、`toNewsVO`（Task 3 产）、`seesAllRecords`/`applyVisibilityScope`（Task 4 产）、`buildSummary`（Task 5 产）——每个都在产它的任务里被消费，跨任务依赖只有 Task 3 → Task 2 一处（已在 Task 3 Step 2 注明依赖与兜底做法）。
- **Review Focus 映射**：1→Task 1、2→Task 2、3→Task 3、4→Task 4、5→Task 5，每条都有一个具体测试钉住。
- **比例**：计划 5 个任务、约 400 行，与 spec §7 的 8 条边界相比不冗余——第 8 条（Long→String 全局序列化）是既有契约不是缺陷，不在本计划范围。
