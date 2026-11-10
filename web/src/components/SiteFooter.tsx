import { Wordmark } from "./SiteHeader"

export type FooterSection = {
  href: string
  label: string
}

/**
 * 页脚 · 仪器铭牌端。
 *
 * 顶栏已经让给跨产品目的地，页面内的章节从页脚进。整块按 readout 条的
 * 语言搭：大字铭牌行 → 四格读数条 → 章节索引 → 免责栏 → 法律行。
 * sections 只在落地页上传；其他页面不传，就不渲染章节索引。
 */
export function SiteFooter({ sections = [] }: { sections?: FooterSection[] }) {
  return (
    <footer className="site-foot no-print">
      <div className="site-foot__masthead">
        <Wordmark />
        <a
          href="#top"
          className="site-foot__top"
          data-cursor
          onClick={(event) => {
            // 显式滚回顶部：页面上并没有 #top 这个锚点，交给浏览器会落空。
            event.preventDefault()
            window.scrollTo({ top: 0, behavior: "smooth" })
          }}
        >
          回到顶部
          <span className="site-foot__top-mark num" aria-hidden="true">
            ↑
          </span>
        </a>
      </div>

      <div className="site-foot__specs num">
        <span className="site-foot__spec">EFFICIENTNET-B4</span>
        <span className="site-foot__spec">8 CLASSES</span>
        <span className="site-foot__spec">DIAGNOSIS AGENT · MCP</span>
        <span className="site-foot__spec">SHA-256 WEIGHTS</span>
        <span className="site-foot__spec">© 2026 Iris</span>
      </div>

      {sections.length > 0 ? (
        <nav className="site-foot__nav" aria-label="页面章节">
          <span className="site-foot__nav-label">页面内 · ON THIS PAGE</span>
          {sections.map((item, index) => (
            <a key={item.href} href={item.href} className="site-foot__nav-link" data-cursor>
              <span className="site-foot__nav-code num" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="site-foot__legal">
        <p className="site-foot__note">
          <span className="site-foot__note-mark">免责 · DISCLAIMER</span>
          系统输出为 AI 辅助判读，不构成诊断结论，不能替代执业医师的检查与判断。
          所有判读记录均保留模型版本与权重指纹，供事后复核。
        </p>
        <span className="site-foot__stamp num" aria-hidden="true">
          辅助判读
          <br />
          NOT A DIAGNOSIS
        </span>
      </div>
    </footer>
  )
}
