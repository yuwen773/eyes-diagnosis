<template>
  <a-card>
<!--小标题    -->
    <template #title>
      <span>
        <UploadOutlined />
        眼部图像上传
      </span>
    </template>
<!--拖拽上传图片组件-->
    <a-upload-dragger
      :file-list="fileList"
      :before-upload="beforeUpload"
      :custom-request="handleUpload"
      :show-upload-list="false"
    >
<!--      <p class="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p class="ant-upload-text">点击或拖拽眼部图像到此区域上传</p>
      <p class="ant-upload-hint">
        支持 JPG、PNG 格式，最大 5MB
      </p>-->

      <img
        v-if="picture?.url" :src="picture?.url" alt="avatar" width="450px" height="300px" />
      <div v-else>
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽眼部图像到此区域上传</p>
        <p class="ant-upload-hint">
          支持 JPG、PNG 格式，最大 5MB
        </p>
      </div>
    </a-upload-dragger>
<!--图片预览展示-->
<!--    <div v-if="picture?.url" class="uploaded-image-preview">
      <a-image
        :src="picture?.url"
        :preview="false"
        style="width: 100%; max-width: 600px; margin-bottom: 16px;margin-left: 150px"
      />
    </div>-->
<!--诊断按钮-->
    <a-button
      type="primary"
      :disabled="!uploadedImageUrl || loading"
      @click="startDiagnosis"
      block
      style="margin-top: 16px;"
    >
      <template #icon>
        <PlayCircleOutlined />
      </template>
      开始诊断
    </a-button>
<!--加载效果-->
    <a-spin
      v-if="loading"
      tip="正在分析图像，请稍候..."
      size="large"
      style="margin-top: 24px;margin-left: 350px"
    />
  </a-card>
</template>

<script lang="ts" setup>
import { reactive, ref } from 'vue'
import { message, type UploadProps } from 'ant-design-vue'
import { UploadOutlined, InboxOutlined, PlayCircleOutlined } from '@ant-design/icons-vue';
import { useDiagnosisStore } from '@/stores/diagnosis';
import { doDiagnosis, uploadPicture } from '@/api/diagnosisController'


//受控组件，由父元素 图片创建页面来管理 定义属性
interface Props {
  picture?: API.DiagnosisManageVO
  onSuccess?: (newPicture: API.DiagnosisManageVO) => void
}


const props = defineProps<Props>()

//是否为加载中
const loading = ref<boolean>(false)

//引入诊断模块的pinia
    const diagnosisStore = useDiagnosisStore();
//加载，上传图片
    const { setDiagnosisResult,setLoading } = diagnosisStore;
    //图片
    const fileList = ref([]);

const uploadedImageUrl = ref<string | null>(null);
const uploadedFile = ref<File | null>(null);

//图片校验
const beforeUpload: UploadProps['beforeUpload'] = (file) => {
  const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
  if (!isJpgOrPng) {
    message.error('只能上传 JPG 或 PNG 格式的图片!');
  }

  const isLt5M = file.size / 1024 / 1024 < 5;
  if (!isLt5M) {
    message.error('图片大小不能超过 5MB!');
  }

  return isJpgOrPng && isLt5M;
};


//处理上传
const handleUpload = async ({ file }: any) => {
  // //设置为加载中
  loading.value = true
  try {
    //设置参数
    const params = props.picture ? { diagnosisUploadDTO: { id: props.picture.id } } : { diagnosisUploadDTO: {} };
    const res = await uploadPicture(params, {}, file)

    if (res.data.code === 0 && res.data.data) {
      message.success('图片上传成功')
      // 设置图像url
      uploadedImageUrl.value = res.data.data.url ?? null
      uploadedFile.value = (file as File)
      console.log(uploadedImageUrl.value)
      // setLoading(loading.value)
      // 将上传成功的图片信息传递给父组件
      props.onSuccess?.(res.data.data)
    } else {
      message.error('图片上传失败,' + res.data.msg)
    }
  } catch (error) {
    message.error('图片上传失败')
  } finally {
    loading.value = false
  }
}


//开始诊断
const startDiagnosis = async () => {
  if (!uploadedFile.value) return;
  //点击按钮，设置加载中
  loading.value=true
  // 调用诊断服务，诊断中=》加载中
  loading.value=true
  setLoading(loading.value)
  const res = await doDiagnosis(uploadedFile.value)
  if(res.data.data&&res.data.code===0){
    setDiagnosisResult(res.data.data)
    //结束加载
    loading.value=false
  }else{
    message.error('诊断失败，请稍后重试'+res.data.msg)
    //结束加载
    loading.value=false
  }
  //结束加载
  loading.value=false
};

//开始诊断 TODO
//     const startDiagnosis = async () => {
//       if (!uploadedImageUrl.value) return;
//       //点击按钮，设置加载中
//       loading.value=true
//       // 调用诊断服务
//       const result = await simulateDiagnosis(uploadedImageUrl.value);
//       //调用诊断服务，诊断中=》加载中
//       loading.value=true
//       setLoading(loading.value)
//       //得到诊断结果，将结果进行页面渲染
//       setDiagnosisResult(result);
//       //结束加载
//       loading.value=false
//     };

</script>

<style scoped>
.uploaded-image-preview {
  margin: 16px 0;
}

:deep(.ant-upload-drag-icon) {
  font-size: 48px;
  color: var(--claude-brand);
}

:deep(.ant-upload-text),
:deep(.ant-upload-hint) {
  color: var(--claude-text-secondary);
}
</style>
