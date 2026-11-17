import { Component, type ErrorInfo, type ReactNode } from "react"

import { IrisErrorState } from "@/components/system/IrisStates"
import { fault } from "@/lib/faults"

type Props = {
  children: ReactNode
  /** 路由标识：换页时自动复位，错误状态不会带到下一页。 */
  resetKey: string
}

type State = { failed: boolean }

/**
 * 路由级错误边界。
 *
 * 只接渲染期的错误；事件处理器与异步回调里的错误仍走各自的故障提示。
 * 边界自身保持极小：静态 getDerivedStateFromError + 一个刷新动作，
 * 不依赖 WebGL / 远程图片 / 动态导入，稳定的兜底优先于视觉。
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // 留一份现场供控制台排查；不向用户展示堆栈，也不谎称"已上报"。
    console.error("路由渲染失败", error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="route-fault">
        <IrisErrorState
          fault={fault({
            severity: "critical",
            kind: "client",
            title: "这个页面没能显示出来",
            detail:
              "页面遇到了意外情况，可以重新加载这一页；如果反复出现，请记下当前网址并联系我们。已经提交的内容不会被这个提示更改。",
            action: { label: "重新加载本页", run: () => window.location.reload() },
          })}
          secondary={
            // 兜底不能再依赖路由 context：用普通链接给一条稳定的离场路径。
            <a className="iris-action iris-action--secondary" href="/">
              回到首页
            </a>
          }
        />
      </main>
    )
  }
}
