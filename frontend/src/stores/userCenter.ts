// stores/user.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

interface UserInfo {
  id: string
  name: string
  avatar: string
  gender: string
  age: number
  phone: string
  email: string
  role: 'doctor' | 'patient'
  registerTime: string
}

interface DiagnosisRecord {
  id: string
  date: string
  result: string
  status: string
  patientName: string
  patientAge: number
  doctorName: string
  department: string
  details: string
  suggestions: string
  images?: string[]
}

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserInfo>({
    id: '123456',
    name: '张三',
    avatar: 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/avatar.jpg',
    gender: 'male',
    age: 35,
    phone: '13800138000',
    email: 'zhangsan@example.com',
    role: 'patient',
    registerTime: '2023-01-15 10:30:00'
  })

  const diagnosisHistory = ref<DiagnosisRecord[]>([])

  const updateUserInfo = async (data: Partial<UserInfo>) => {
    // 模拟API调用
    await new Promise(resolve => setTimeout(resolve, 1000))
    userInfo.value = { ...userInfo.value, ...data }
  }

  const getDiagnosisHistory = async (params: any) => {
    // 模拟API调用
    await new Promise(resolve => setTimeout(resolve, 800))
    const mockData: DiagnosisRecord[] = [
      {
        id: 'D20230001',
        date: '2023-06-15 14:30:00',
        result: '青光眼早期症状',
        status: '已完成',
        patientName: '张三',
        patientAge: 35,
        doctorName: '李医生',
        department: '眼科',
        details: '患者主诉视力模糊，经检查发现眼压偏高，视野检查显示周边视野轻微缺损。',
        suggestions: '建议使用降眼压药物，定期复查眼压和视野，避免长时间在暗处用眼。',
        images: [
          'https://example.com/image1.jpg',
          'https://example.com/image2.jpg'
        ]
      },
      // 更多模拟数据...
    ]

    return {
      list: mockData,
      total: mockData.length
    }
  }

  return { userInfo, diagnosisHistory, updateUserInfo, getDiagnosisHistory }
})
