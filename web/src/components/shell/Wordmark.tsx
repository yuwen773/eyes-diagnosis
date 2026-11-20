/**
 * 铭牌：虹膜标记 + 品名 + 英文 mono 副标。
 *
 * 虹膜标记是 Optical Iris 标 v1.0：旋转虹膜 + 中心四芒星，蓝青折射。
 * 浅色底用 primary 那版，深色底用 dark 那版——两版共享同一 alpha 轮廓
 * （品牌包 QA 里有 alpha sha256 证明），只是内部光色不同。
 * 两版一起挂在 DOM 里，靠 <html>.dark 切换，主题切换是即时的，也不会有闪烁；
 * 不用 CSS filter 反相（反相会把折射高光变成脏灰）。
 *
 * 位图按 64/96/192 三档提供，`sizes` 固定 30px：1x/2x/3x 都取到足量像素，
 * 不会在窄栏里拉 1024 母版。全站唯一字标：顶栏、页脚、认证页都从这里取。
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark">
      <span className="wordmark__iris" aria-hidden="true">
        <img
          className="wordmark__mark wordmark__mark--light"
          src="/brand/iris-optical-light-96.png"
          srcSet="/brand/iris-optical-light-64.png 64w, /brand/iris-optical-light-96.png 96w, /brand/iris-optical-light-192.png 192w"
          sizes="30px"
          alt=""
          width={30}
          height={30}
        />
        <img
          className="wordmark__mark wordmark__mark--dark"
          src="/brand/iris-optical-dark-96.png"
          srcSet="/brand/iris-optical-dark-64.png 64w, /brand/iris-optical-dark-96.png 96w, /brand/iris-optical-dark-192.png 192w"
          sizes="30px"
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
