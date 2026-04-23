/**
 * 图表渲染 Composable（Stub）
 * eye-diagnosis 暂不需要图表渲染功能
 */
export function useDiagramRenderer() {
  const renderDiagrams = async (htmlContent: string): Promise<string> => {
    return htmlContent
  }

  const unbindDiagramEvents = () => {}

  return {
    renderDiagrams,
    unbindDiagramEvents,
  }
}
