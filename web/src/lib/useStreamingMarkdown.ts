import { useEffect, useMemo, useRef, useState } from "react"

import { createIncrementalMarkdownRenderer, renderMarkdown } from "./markdown"

/**
 * 流式渲染的最小间隔。SSE 每个 token 来一次；Markdown 解析 + 净化按 60ms
 * 合帧，既保证「字在成形」，又不会把主线程按在每一片上。
 */
const RENDER_INTERVAL_MS = 60

/**
 * 渐进式 Markdown：流式期间也能看到标题、段落、列表、表格与代码块。
 *
 * <p>渲染器按稳定段缓存，只重渲仍在生成的尾部（见
 * `createIncrementalMarkdownRenderer`）。流结束时立刻整篇渲染收口，
 * 避免分段边界带来的结构差异。返回值始终是已净化的 HTML。
 */
export function useStreamingMarkdown(content: string, streaming: boolean): string {
  // 渲染器是「每个组件实例一份」的普通状态：惰性初始化只跑一次，
  // 不在渲染期读写 ref（渲染期碰 ref 会违反 hooks 规则）。
  const [renderer] = useState(createIncrementalMarkdownRenderer)
  const [html, setHtml] = useState(() => renderer.render(content, streaming))

  // 已收口的内容在渲染期直接算：它是最终结果，整篇渲染一次即可。
  const finalHtml = useMemo(
    () => (streaming ? null : renderMarkdown(content)),
    [content, streaming],
  )

  // 定时器回调要拿到「最新一片」，但只在回调里读，不在渲染期读。
  const latestRef = useRef({ content, streaming })
  useEffect(() => {
    latestRef.current = { content, streaming }
  }, [content, streaming])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!streaming) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    if (timerRef.current !== null) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const latest = latestRef.current
      setHtml(renderer.render(latest.content, latest.streaming))
    }, RENDER_INTERVAL_MS)
  }, [content, streaming, renderer])

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        // 必须一并置空：只 clear 不置空，StrictMode 的「卸载→重挂载」会让
        // 上面那条守卫以为还排着帧，之后再也不渲染任何一片。
        timerRef.current = null
      }
    },
    [],
  )

  return finalHtml ?? html
}
