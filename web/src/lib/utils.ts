/**
 * shadcn CLI 的 utils 落点（`components.json` 的 `aliases.utils`）。
 *
 * 项目不装 shadcn 生成的组件：`src/components/ui/` 里放的是 Base UI 的
 * 薄封装（`dialog.tsx` / `menu.tsx`），交互与样式都按 Iris 令牌手写。
 * 这个文件只为 CLI 留一个能落地的位置——生成出来的组件引用
 * `@/lib/utils` 的 `cn`，文件不在就断构建。
 *
 * 刻意不引 clsx / tailwind-merge：合并冲突类的能力这里用不上
 * （两个同名工具类的问题由生成后按 Iris 规范改写解决），
 * 多一套依赖就多一处版本漂移。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
