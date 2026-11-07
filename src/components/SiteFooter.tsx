import { Wordmark } from "./SiteHeader"

export type FooterSection = {
  href: string
  label: string
}

/**
 * 页脚。
 *
 * sections 只在落地页上传：顶栏已经让给跨产品目的地，页面内的章节从页脚进。
 * 其他页面不传，就不渲染这一行。
 */
export function SiteFooter({ sections = [] }: { sections?: FooterSection[] }) {
  return (
    <footer className="site-foot no-print">
      <div>
        <Wordmark />
        <div className="site-foot__meta" style={{ marginTop: 18 }}>
          <span>EFFICIENTNET-B4</span>
          <span>8 CLASSES</span>
          <span>DIAGNOSIS AGENT · MCP</span>
          <span>SHA-256 WEIGHTS</span>
          <span>© 2026 IRIS</span>
        </div>

        {sections.length > 0 ? (
          <nav className="site-foot__nav" aria-label="页面章节">
            <span className="site-foot__nav-label">页面内 · ON THIS PAGE</span>
            {sections.map((item) => (
              <a key={item.href} href={item.href} className="site-foot__nav-link">
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
      <p className="site-foot__note">
        系统输出为 AI 辅助判读，不构成诊断结论，不能替代执业医师的检查与判断。
        所有判读记录均保留模型版本与权重指纹，供事后复核。
      </p>
    </footer>
  )
}
