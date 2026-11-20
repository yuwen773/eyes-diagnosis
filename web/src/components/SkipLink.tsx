/**
 * 全站跳转链接（WCAG 2.4.1）。
 *
 * <p>产品顶栏在每一页正文之前有导航、主题切换、账号菜单与 CTA；键盘用户
 * 不跳过就要 Tab 六七次才进内容。链接平时收在视口外（见 app.css 的
 * `.skip-link`），聚焦时出现在左上角，回车直接落到页面的 `<main>`。
 *
 * <p>目标 `#main-content` 由各页面自己的 `<main>` 携带：本仓库没有包住全部
 * 路由的统一布局壳，顶栏属于页面，所以 id 也必须落在页面的地标上。
 */
export function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      跳到主要内容
    </a>
  )
}

export default SkipLink
