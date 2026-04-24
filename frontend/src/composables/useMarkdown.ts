import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

// 图表代码块语言列表
export const DIAGRAM_LANGUAGES = ['mermaid', 'drawio', 'plantuml']

// 创建 markdown-it 实例，启用 GFM
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: function (str: string, lang: string) {
    // 图表语言不做语法高亮，保持原始内容供前端渲染
    if (lang && DIAGRAM_LANGUAGES.includes(lang.toLowerCase())) {
      return `<pre class="hljs code-block diagram-block" data-lang="${lang}"><div class="code-header"><span class="code-lang">${lang}</span><button class="copy-btn" data-code>复制</button></div><code>${md.utils.escapeHtml(str)}</code></pre>`
    }

    // 如果有语言标识，使用 highlight.js 高亮
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs code-block"><div class="code-header"><span class="code-lang">' +
          lang +
          '</span><button class="copy-btn" data-code>复制</button></div><code>' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          '</code></pre>'
      } catch (__) {}
    }
    // 否则返回普通代码块
    return '<pre class="hljs code-block"><div class="code-header"><span class="code-lang">code</span><button class="copy-btn" data-code>复制</button></div><code>' + md.utils.escapeHtml(str) + '</code></pre>'
  },
})

export function useMarkdown() {
  const render = (content: string): string => {
    if (!content) return ''
    return md.render(content)
  }

  return {
    render,
  }
}
