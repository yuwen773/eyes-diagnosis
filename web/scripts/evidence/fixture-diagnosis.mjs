// Iris 2.1 · R3.3 · 判读夹具生成器（本地开发库 3306，非生产库）
//
// 用法：
//   node web/scripts/evidence/fixture-diagnosis.mjs seed   # 造夹具
//   node web/scripts/evidence/fixture-diagnosis.mjs clean  # 清夹具（并回报残留行数）
//
// 纪律：
// - 所有夹具行以 modelVersion = 'fixture-iris21' 标记，清理按该标记整段删。
// - 只写本地开发 MySQL 3306（eyeuser 所在实例），不碰 3307 / 生产库。
// - 不伪造医学结论的「真值」：result 用算法侧英文原始标签，正好用来验证
//   canonicalClassName 归一是否生效（页面上必须显示规范中文名）。
import { execFileSync } from "node:child_process"

const MYSQL = "mysql"
// --default-character-set=utf8mb4 在这台机器上不生效（会话 character_set_client
// 实测仍是 latin1），中文会被当成单字节字符塞进 utf8mb4 列，存进去就是双重
// 编码的乱码。SET NAMES 才是真正改变会话字符集的那一句，必须放在 SQL 最前面。
const SET_NAMES = "SET NAMES utf8mb4;\n"
const CONN = ["-h127.0.0.1", "-P3306", "-uroot", "-p123456", "--default-character-set=utf8mb4", "diagnosis"]
const MARKER = "fixture-iris21"

/** 真实存在的 COS 影像地址（复用已有判读记录的公开图，给缩略图用）。 */
const IMAGE_URLS = [
  "https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_4027317000837089.jpg",
  "https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_0955942204744016.jpg",
  "https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_8418142450123121.jpg",
  "https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-28_3189631787333631.jpg",
]

const USERS = ["1913835897733287938", "2120924169975005185", "1915412470597001217"]

/**
 * 病种 → [原始 result 标签, 严重度, 出现次数]
 * 标签刻意混用算法侧英文（cataract / glaucoma / diabetes…）与后端中文短名，
 * 页面必须把它们归一到同一个规范中文类名。
 */
const DISEASES = [
  ["cataract", "moderate", 12],
  ["glaucoma", "mild", 9],
  ["diabetes", "severe", 8],
  ["amd", "moderate", 5],
  ["normal", "normal", 4],
  ["hypertension", "mild", 3],
  ["myopia", "moderate", 2],
  ["other", "mild", 1],
]

/** 确定性伪随机：同一个 seed 永远得到同一批夹具，截图可复现。 */
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seed() {
  const rand = mulberry32(20261115)
  const rows = []
  const now = new Date("2026-11-15T09:00:00")

  // 摊平病种清单
  const plan = []
  for (const [label, severity, count] of DISEASES) {
    for (let i = 0; i < count; i += 1) plan.push([label, severity])
  }
  // 打散：下面按序号分配的「拒识 / 待复核 / 已复核」不该与病种相关，
  // 否则会出现「白内障全是拒识、其它全正常」这种一眼假的规律。
  for (let i = plan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[plan[i], plan[j]] = [plan[j], plan[i]]
  }

  plan.forEach(([label, severity], index) => {
    // 时间：最近 30 天内，略带「近期更密」的倾向，但**不按病种聚簇**——
    // 真实数据里各病种都散布在整个窗口，聚簇会让小倍数图看起来像
    // 「每个病种只活跃过一段时间」，那是假象。
    const daysAgo = Math.floor(rand() * 30)
    const date = new Date(now.getTime() - daysAgo * 86400000)
    const stamp =
      date.toISOString().slice(0, 10) +
      " " +
      String(8 + Math.floor(rand() * 10)).padStart(2, "0") +
      ":" +
      String(Math.floor(rand() * 60)).padStart(2, "0") +
      ":" +
      String(Math.floor(rand() * 60)).padStart(2, "0")

    // 每 9 条里有 1 条是 AI 拒识：result / confidence 为空，带拒识原因。
    const rejected = index % 9 === 4
    // 每 4 条里有 1 条待人工复核（模型给了结论但标记了需要人工过目）。
    const awaiting = !rejected && index % 4 === 1
    const reviewed = !rejected && !awaiting && index % 3 === 0
    // 余下的分两半：模型还没出结论 / 模型已出结论但没人复核。
    const pending = !rejected && !awaiting && !reviewed && index % 2 === 0

    const confidence = rejected
      ? "NULL"
      : (0.42 + rand() * 0.55).toFixed(4)
    const result = rejected ? "NULL" : `'${label}'`
    const reexamine = reviewed ? 3 : awaiting ? 2 : pending ? 0 : 1
    const humanStatus = rejected
      ? "'AWAITING_REVIEW'"
      : reviewed
        ? "'REVIEWED'"
        : awaiting
          ? "'AWAITING_REVIEW'"
          : pending
            ? "'PENDING_AI'"
            : "'AI_ONLY'"
    // 每 5 条里有 1 条没有图（占位态必须有真实样本，不能只靠想象）。
    const url = index % 5 === 2 ? "''" : `'${IMAGE_URLS[index % IMAGE_URLS.length]}'`
    const abstain = rejected ? "'图像质量不足 · 视野受限'" : "NULL"
    const userId = USERS[index % USERS.length]

    rows.push(
      `(${Date.now() + index}, ${url}, ${userId}, ${result}, ${confidence}, ` +
        `'建议结合裂隙灯检查进一步确认。', '模型自评置信度，非诊断准确率。', '${severity}', ` +
        `${reexamine}, 640, 480, 1.0, 'jpg', '${stamp}', 0, ${confidence}, ` +
        // imageHash 留 NULL：真实链路里它是模型算出的感知哈希，这里造一个
        // 假字符串只会让「缩略图去重」之类的判断读到不该有的输入。
        `${url === "''" ? "NULL" : "NULL"}, ${rejected ? 1 : 0}, ${abstain}, ` +
        `${humanStatus}, '${MARKER}')`,
    )
  })

  const sql = `DELETE FROM t_diagnosis WHERE modelVersion='${MARKER}';\n` +
    `INSERT INTO t_diagnosis\n` +
    `(id, url, userId, result, confidence, recommendations, details, severity,\n` +
    ` reexamineStatus, picWidth, picHeight, picScale, picFormat, createTime, isDelete,\n` +
    ` probability, imageHash, aiRejected, abstainReason, humanReviewStatus, modelVersion)\nVALUES\n` +
    rows.join(",\n") +
    ";\n" +
    `SELECT COUNT(*) AS fixture_rows FROM t_diagnosis WHERE modelVersion='${MARKER}';`

  // SQL 走 stdin 的字节流，不走 argv。
  // argv 在 Windows 上会被转成系统 ANSI 代码页（这里是 GBK），中文再被
  // --default-character-set=utf8mb4 当成 UTF-8 解一次，存进库就是双重编码的
  // 乱码（「图像质量不足」变成 a⁠.⁠a⁠|⁠e⁠…）。stdin 是原始字节，不经这层转码。
  execFileSync(MYSQL, [...CONN], { input: SET_NAMES + sql, stdio: ["pipe", "inherit", "inherit"] })
  console.log(`seeded ${rows.length} fixture diagnosis rows (modelVersion=${MARKER})`)
}

function clean() {
  const sql =
    `DELETE FROM t_diagnosis WHERE modelVersion='${MARKER}';\n` +
    `SELECT COUNT(*) AS residual_rows FROM t_diagnosis WHERE modelVersion='${MARKER}';\n` +
    `SELECT COUNT(*) AS total_rows FROM t_diagnosis WHERE isDelete=0;`
  execFileSync(MYSQL, [...CONN], { input: SET_NAMES + sql, stdio: ["pipe", "inherit", "inherit"] })
  console.log("fixture rows removed")
}

const mode = process.argv[2] ?? "seed"
if (mode === "seed") seed()
else if (mode === "clean") clean()
else throw new Error(`unknown mode: ${mode}`)
