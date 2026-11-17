import { Component, type ErrorInfo, type ReactNode } from "react"
import { FaultNote } from "@/components/fault"
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
 * 没有它的时候，render 期抛错就是整页白屏——用户看到一块空白，没有解释，
 * 也没有出口。这里接住错误，复用全站的故障读数把「哪里坏了、还能做什么」
 * 讲清楚，并给一个刷新动作。
 *
 * 只接渲染期的错误；事件处理器与异步回调里的错误仍走各自的故障提示。
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // 留一份现场：生产环境至少能从控制台/上报里追到是哪个组件树炸的。
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
        <FaultNote
          variant="panel"
          fault={fault({
            severity: "critical",
            kind: "client",
            title: "这个页面没能渲染出来",
            detail: "已经记下这次错误。刷新页面可以重新加载；如果反复出现，请把当前网址反馈给我们。",
            action: { label: "刷新页面", run: () => window.location.reload() },
          })}
        />
      </main>
    )
  }
}
