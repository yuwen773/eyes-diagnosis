//引入自动生成请求代码
import {generateService} from '@umijs/openapi'

generateService({
  requestLibPath: "import request from '@/request'",
  schemaPath: "http://localhost:8081/api/v3/api-docs",
  serversPath: './src',
})
