declare namespace API {
  type BaseResponseBoolean = {
    code?: number
    msg?: string
    data?: boolean
  }

  type BaseResponseDiagnosisManageVO = {
    code?: number
    msg?: string
    data?: DiagnosisManageVO
  }

  type BaseResponseDiagnosisResultVO = {
    code?: number
    msg?: string
    data?: DiagnosisResultVO
  }

  type BaseResponseLoginUserVO = {
    code?: number
    msg?: string
    data?: LoginUserVO
  }

  type BaseResponseLong = {
    code?: number
    msg?: string
    data?: number
  }

  type BaseResponseNewsVO = {
    code?: number
    msg?: string
    data?: NewsVO
  }

  type BaseResponsePageChatHistory = {
    code?: number
    msg?: string
    data?: PageChatHistory
  }

  type BaseResponsePageChatsession = {
    code?: number
    msg?: string
    data?: PageChatsession
  }

  type BaseResponsePageDiagnosisManageVO = {
    code?: number
    msg?: string
    data?: PageDiagnosisManageVO
  }

  type BaseResponsePageNewsVO = {
    code?: number
    msg?: string
    data?: PageNewsVO
  }

  type BaseResponsePageUserVO = {
    code?: number
    msg?: string
    data?: PageUserVO
  }

  type BaseResponseString = {
    code?: number
    msg?: string
    data?: string
  }

  type BaseResponseUser = {
    code?: number
    msg?: string
    data?: User
  }

  type BaseResponseUserVO = {
    code?: number
    msg?: string
    data?: UserVO
  }

  type chatByQuestionWithAIParams = {
    sessionId: number
    message: string
    isThinking: boolean
  }

  type ChatHistory = {
    id?: number
    message?: string
    messageType?: string
    sessionId?: number
    userId?: number
    createTime?: string
    updateTime?: string
    isDelete?: number
  }

  type ChatHistoryQueryRequest = {
    current?: number
    pageSize?: number
    sortField?: string
    sortOrder?: string
    id?: number
    message?: string
    messageType?: string
    sessionId?: number
    userId?: number
    lastCreateTime?: string
  }

  type Chatsession = {
    id?: number
    title?: string
    userId?: number
    createTime?: string
    updateTime?: string
  }

  type ChatSessionAddRequest = {
    initPrompt?: string
  }

  type deleteDiagnosisParams = {
    id: number
  }

  type deleteNewsParams = {
    id: number
  }

  type deleteUserParams = {
    id: number
  }

  type DiagnosisDTO = {
    imageUrl?: string
  }

  type DiagnosisManageVO = {
    id?: number
    url?: string
    username?: string
    result?: string
    confidence?: number
    severity?: string
    reexamineStatus?: number
    createTime?: string
    status?: string
  }

  type DiagnosisQueryDTO = {
    current?: number
    pageSize?: number
    sortField?: string
    sortOrder?: string
    id?: number
    result?: string
    userRole?: string
    userId?: number
    diagnosisTime?: string
  }

  type DiagnosisReexamineDTO = {
    id?: number
  }

  type DiagnosisResultDTO = {
    id?: number
    url?: string
    result?: string
    probability?: number
    confidence?: number
    recommendations?: string
    details?: string
    severity?: string
    createTime?: string
  }

  type DiagnosisResultVO = {
    id?: number
    url?: string
    result?: string
    probability?: number
    confidence?: number
    recommendations?: string
    details?: string
    severity?: string
    createTime?: string
    otherDisease?: Disease[]
  }

  type DiagnosisUploadDTO = {
    id?: number
  }

  type Disease = {
    name?: string
    probability?: number
  }

  type getDiagnosisResultVOParams = {
    id: number
  }

  type getNewsVOParams = {
    id: number
  }

  type getUserByIdParams = {
    id: number
  }

  type getUserVOByIdParams = {
    id: number
  }

  type listChatSessionChatHistoryParams = {
    sessionId: number
    pageSize?: number
    lastCreateTime?: string
  }

  type LoginUserVO = {
    id?: number
    userAccount?: string
    userName?: string
    userAvatar?: string
    userProfile?: string
    userRole?: string
    createTime?: string
    updateTime?: string
    gender?: number
    phone?: string
    email?: string
  }

  type NewsQueryDTO = {
    current?: number
    pageSize?: number
    sortField?: string
    sortOrder?: string
    id?: number
    title?: string
    summary?: string
    userRole?: string
  }

  type NewsUpdateDTO = {
    id?: number
    title?: string
    content?: string
    status?: number
    coverImage?: string
  }

  type NewsUploadDTO = {
    id?: number
  }

  type NewsVO = {
    id?: number
    title?: string
    author?: string
    avatar?: string
    content?: string
    summary?: string
    coverImage?: string
    publishTime?: string
  }

  type OrderItem = {
    column?: string
    asc?: boolean
  }

  type PageChatHistory = {
    records?: ChatHistory[]
    total?: number
    size?: number
    current?: number
    orders?: OrderItem[]
    optimizeCountSql?: PageChatHistory
    searchCount?: PageChatHistory
    optimizeJoinOfCountSql?: boolean
    maxLimit?: number
    countId?: string
    pages?: number
  }

  type PageChatsession = {
    records?: Chatsession[]
    total?: number
    size?: number
    current?: number
    orders?: OrderItem[]
    optimizeCountSql?: PageChatsession
    searchCount?: PageChatsession
    optimizeJoinOfCountSql?: boolean
    maxLimit?: number
    countId?: string
    pages?: number
  }

  type PageDiagnosisManageVO = {
    records?: DiagnosisManageVO[]
    total?: number
    size?: number
    current?: number
    orders?: OrderItem[]
    optimizeCountSql?: PageDiagnosisManageVO
    searchCount?: PageDiagnosisManageVO
    optimizeJoinOfCountSql?: boolean
    maxLimit?: number
    countId?: string
    pages?: number
  }

  type PageNewsVO = {
    records?: NewsVO[]
    total?: number
    size?: number
    current?: number
    orders?: OrderItem[]
    optimizeCountSql?: PageNewsVO
    searchCount?: PageNewsVO
    optimizeJoinOfCountSql?: boolean
    maxLimit?: number
    countId?: string
    pages?: number
  }

  type PageUserVO = {
    records?: UserVO[]
    total?: number
    size?: number
    current?: number
    orders?: OrderItem[]
    optimizeCountSql?: PageUserVO
    searchCount?: PageUserVO
    optimizeJoinOfCountSql?: boolean
    maxLimit?: number
    countId?: string
    pages?: number
  }

  type reexamineDiagnosisParams = {
    diagnosisReexamineDTO: DiagnosisReexamineDTO
  }

  type ServerSentEventString = true

  type uploadAvatarPictureParams = {
    userEditDTO: UserEditDTO
  }

  type uploadCoverImageParams = {
    newsUploadDTO: NewsUploadDTO
  }

  type uploadPictureParams = {
    diagnosisUploadDTO: DiagnosisUploadDTO
  }

  type User = {
    id?: number
    userAccount?: string
    userPassword?: string
    userName?: string
    userAvatar?: string
    userProfile?: string
    userRole?: string
    editTime?: string
    createTime?: string
    updateTime?: string
    isDelete?: number
  }

  type UserAddDTO = {
    userName?: string
    userAccount?: string
    userAvatar?: string
    userProfile?: string
    userRole?: string
  }

  type UserEditDTO = {
    id?: number
    userName?: string
    userAvatar?: string
    userProfile?: string
    gender?: number
    phone?: string
    email?: string
  }

  type UserLoginDTO = {
    userAccount?: string
    userPassword?: string
  }

  type UserQueryDTO = {
    current?: number
    pageSize?: number
    sortField?: string
    sortOrder?: string
    id?: number
    userName?: string
    userAccount?: string
    userProfile?: string
    userRole?: string
  }

  type UserRegisterDTO = {
    userAccount?: string
    userPassword?: string
    checkPassword?: string
  }

  type UserUpdateDTO = {
    id?: number
    userName?: string
    userAvatar?: string
    userProfile?: string
    userRole?: string
  }

  type UserVO = {
    id?: number
    userAccount?: string
    userName?: string
    userAvatar?: string
    userProfile?: string
    userRole?: string
    createTime?: string
  }
}
