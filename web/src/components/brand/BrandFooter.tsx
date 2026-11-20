import { Link } from "react-router-dom"

import { Wordmark } from "@/components/shell/Wordmark"
import { useMediaQuery } from "@/lib/useMediaQuery"
import type { FooterSection } from "@/components/SiteFooter"

/**
 * 品牌层页脚：**Solid Brand Surface**（实体品牌表面），不做整块玻璃模糊。
 * 浅色主题 = 亮白实体面，暗色主题 = 深海蓝——实体面随主题翻转，
 * 浅色页面底部不出现暗房断层（DESIGN.md §2.1.4）。
 *
 * <p>页脚承载大量文字与免责条款，可读性优先于材质表现（DESIGN.md §2.1.4）。
 * 三层信息架构：
 * <ol>
 *   <li>品牌收尾——虹膜标 + 字标 + 主张；</li>
 *   <li>信息导航——产品入口（真实路由）+ 页面章节（真实锚点）+ 平台读数（不是链接）；</li>
 *   <li>可信信息——免责、模型与权重可追溯、版权、返回顶部。</li>
 * </ol>
 *
 * <p>只为真实存在的页面建链接：没有隐私政策、法律声明、联系方式这些页面，
 * 就不出现这些名字。既有规格信息（模型、类别数、权重指纹）重新排布，不删。
 *
 * <p>返回顶部尊重 `prefers-reduced-motion`：用户要求减少动画时直接跳转，
 * 不做平滑滚动。
 */
export function BrandFooter({
  sections = [],
  compact = false,
}: {
  sections?: FooterSection[]
  /** 精简版：门户/资讯列表用。保留品牌、产品入口、免责与版权，去掉长主张与平台读数。 */
  compact?: boolean
}) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)")

  return (
    <footer className={`brand-foot no-print${compact ? " brand-foot--compact" : ""}`}>
      <div className="brand-foot__inner">
        {/* 第一层：品牌收尾 */}
        <div className="brand-foot__brand">
          <Wordmark />
          <p className="brand-foot__claim">看清更多，理解更深。</p>
          {compact ? null : (
            <p className="brand-foot__lead">
              融合眼底影像分析与多智能体协作，让复杂的视觉信息变得清晰、可解释、可追溯。
            </p>
          )}
        </div>

        {/* 第二层：信息导航 */}
        <div className="brand-foot__nav">
          <nav className="brand-foot__group" aria-label="产品">
            <span className="brand-foot__label">产品 · PRODUCT</span>
            <Link className="brand-foot__link" to="/diagnosis">
              影像判读
            </Link>
            <Link className="brand-foot__link" to="/agent">
              诊断 Agent
            </Link>
            <Link className="brand-foot__link" to="/news">
              新闻资讯
            </Link>
          </nav>

          {sections.length > 0 ? (
            <nav className="brand-foot__group" aria-label="页面章节">
              <span className="brand-foot__label">页面内 · ON THIS PAGE</span>
              {sections.map((item) => (
                <a key={item.href} className="brand-foot__link" href={item.href}>
                  {item.label}
                </a>
              ))}
            </nav>
          ) : null}

          {compact ? null : (
            <div className="brand-foot__group">
              <span className="brand-foot__label">平台 · PLATFORM</span>
              <span className="brand-foot__spec num">EFFICIENTNET-B4</span>
              <span className="brand-foot__spec num">8 CLASSES</span>
              <span className="brand-foot__spec num">DIAGNOSIS AGENT · MCP</span>
              {/* 质量门只有「通过 / 拒识」两种真实结果；86 是示例记录里的读数，
                  不是平台阈值，不能挪到这里当指标。 */}
              <span className="brand-foot__spec num">QUALITY GATE · PASS/REJECT</span>
              <span className="brand-foot__spec num">SHA-256 WEIGHTS</span>
            </div>
          )}
        </div>
      </div>

      {/* 第三层：可信信息 */}
      <div className="brand-foot__trust">
        <p className="brand-foot__note">
          <span className="brand-foot__note-mark">免责 · DISCLAIMER</span>
          系统输出为 AI 辅助判读，不构成诊断结论，不能替代执业医师的检查与判断。
          所有判读记录均保留模型版本与权重指纹，供事后复核。
        </p>
        {compact ? null : (
          <span className="brand-foot__stamp num" aria-hidden="true">
            辅助判读
            <br />
            NOT A DIAGNOSIS
          </span>
        )}
      </div>

      <div className="brand-foot__legal">
        <span className="brand-foot__copy num">© 2026 Iris · FUNDUS READING</span>
        <a
          href="#top"
          className="brand-foot__top"
          onClick={(event) => {
            // 页面上并没有 #top 这个锚点，交给浏览器会落空。
            event.preventDefault()
            window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
          }}
        >
          回到顶部
          <span className="brand-foot__top-mark num" aria-hidden="true">
            ↑
          </span>
        </a>
      </div>
    </footer>
  )
}
