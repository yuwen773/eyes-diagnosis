/**
 * 底部免责条。
 *
 * 功能页（判读、资讯、个人中心、诊断记录）不摆整块页脚——页脚是落地页的
 * 章节索引载体，在应用内页面上是噪声。但医疗产品的免责必须留着，所以收成
 * 一行：左端是等宽标签，中间一句话，右端一枚「NOT A DIAGNOSIS」印章。
 */

/**
 * 免责条。页脚去掉后，页面底部的最后一句话。
 */
export function DisclaimerBar() {
  return (
    <div className="wrap">
      <aside className="disclaimer-bar" aria-label="免责声明">
        <span className="disclaimer-bar__mark">免责 · DISCLAIMER</span>
        <p className="disclaimer-bar__text">
          系统输出为 AI 辅助判读，不构成诊断结论，不能替代执业医师的检查与判断。
        </p>
        <span className="disclaimer-bar__stamp num" aria-hidden="true">
          NOT A DIAGNOSIS
        </span>
      </aside>
    </div>
  )
}
