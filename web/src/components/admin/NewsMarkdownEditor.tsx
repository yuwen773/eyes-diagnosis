import MDEditor from "@uiw/react-md-editor"

import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

/**
 * 新闻正文编辑器（Markdown）。
 *
 * <p>单独成模块并由编辑页 `lazy()` 挂载：`@uiw/react-md-editor` + highlight.js
 * 打包后约 1.1MB。放在编辑页路由块里，打开编辑页要先等它下载并解析完；
 * 拆出来后页面外壳先画，编辑器按需补上。样式也随这个块走，不压进首屏 CSS。
 *
 * <p>这里收住编辑器自己的参数，页面只传 value / onChange：换编辑器时
 * 页面与测试都不用跟着改。
 */
export function NewsMarkdownEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <MDEditor
      value={value}
      onChange={(next) => onChange(next ?? "")}
      preview="edit"
      visibleDragbar={false}
      height={520}
      extraCommands={[]}
      textareaProps={{
        placeholder: "用 Markdown 撰写正文…",
        "aria-label": "正文",
      }}
    />
  )
}

export default NewsMarkdownEditor
