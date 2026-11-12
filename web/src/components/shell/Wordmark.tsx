/**
 * 铭牌：虹膜标记 + 品名 + 英文 mono 副标。
 *
 * 虹膜标记是金属虹膜标：两片错开的月牙夹一枚橙色星芒，读起来是一只眼睛。
 * 浅色底用暗金属那版，深色底用亮金属那版——渐变在 SVG 里，
 * 不用 CSS filter 反相（反相会把金属高光变成脏灰）。
 * 两版一起挂在 DOM 里，靠 <html>.dark 切换，主题切换是即时的，也不会有闪烁。
 *
 * 全站唯一字标：顶栏、页脚、认证页与页脚都从这里取（R2.5 收敛）。
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark">
      <span className="wordmark__iris" aria-hidden="true">
        <img
          className="wordmark__mark wordmark__mark--light"
          src="/iris-mark-metallic-light.svg"
          alt=""
          width={30}
          height={30}
        />
        <img
          className="wordmark__mark wordmark__mark--dark"
          src="/iris-mark-metallic-dark.svg"
          alt=""
          width={30}
          height={30}
        />
      </span>
      <span className="wordmark__zh">Iris</span>
      {compact ? null : <span className="wordmark__en">FUNDUS READING</span>}
    </span>
  )
}
