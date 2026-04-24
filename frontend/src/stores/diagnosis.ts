import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getDiagnosisResultVo } from '@/api/diagnosisController'



export const useDiagnosisStore = defineStore('diagnosis', () => {
  const reportModalVisible = ref(false)
  const currentReport  = ref<API.DiagnosisResultVO>()

  // const diagnosisResult = ref<DiagnosisResult | null>(null);
  const loading = ref(false);
  //诊断图片
  const imageUrl = ref<string>('');
  //诊断结果
  const diagnosisResult = ref<API.DiagnosisResultVO>()

  //设置加载中
  function setLoading(value: boolean) {
    loading.value = value;
  }
  // 保存诊断结果
  function setDiagnosisResult(result: API.DiagnosisResultVO) {
    diagnosisResult.value = result;
  }

  /**
   * 打开诊断报告模态框
   * @param report 诊断报告
   */
  async function openReportModal(report: any) {
    const res = await getDiagnosisResultVo({
      id: report.id,
    })
    if(res.data.data && res.data.code ===0 ){
      currentReport.value = res.data.data
      reportModalVisible.value = true
    }
  }


  return {
    reportModalVisible,
    currentReport,
    loading,
    imageUrl,
    diagnosisResult,
    setDiagnosisResult,
    setLoading,
    openReportModal
  };
});
