// 引入请求库
import axios from 'axios'
//导入 message
import { message } from 'ant-design-vue'
import { API_BASE_URL } from '@/config/env'
const DEV_BASE_URL = '/api'
const PRO_BASE_URL = 'http://121.199.77.168'
const DOMAIN_BASE_URL = 'https://lyf1210.top'

// 创建axios 实例
const myAxios = axios.create({
  // baseURL: "http://localhost:8081", // 请求地址(后端地址)
  baseURL: API_BASE_URL, // 请求地址(后端地址)
  timeout: 60000, //超时时间
  withCredentials: true, //是否允许携带Cookie
})
// 全局请求拦截器
myAxios.interceptors.request.use(
  function (config) {
    //发送请求之前  所需要的业务流程
    return config
  },
  function (error) {
    //出现错误 时候 处理错误的相关业务流程
    return Promise.reject(error)
  },
)

//全局响应拦截器
myAxios.interceptors.response.use(
  function (response) {
    const { data } = response
    //未登录
    if (data.code === 40100) {
      //非获取用户信息的请求，且当前用户处于未登录状态，则跳转至登录页面
      if (
        !response.request.responseURL.includes('user/get/login') &&
        !window.location.pathname.includes('user/login')
      ) {
        message.warning('请先登录')
        window.location.href = `/user/login?redirect=${window.location.href}`
      }
    }
    return response
  },
  function (error) {
    //出现错误 时候 处理错误的相关业务流程
    console.log('请求错误：', error.message)
    // 如果是网络错误或后端服务不可用，不要立即弹出错误信息
    if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
      console.warn('后端服务暂时不可用，请检查后端服务是否启动')
    }
    return Promise.reject(error)
  },
)

//将全局请求暴露
export default myAxios
