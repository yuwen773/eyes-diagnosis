declare namespace API {
  type approveSaveApiDiagnosisWorkflowsWorkflowIdSaveConfirmationsConfirmationIdApprovePostParams =
    {
      workflowId: string
      confirmationId: string
    }

  type BaseResponseBoolean = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    /** Data */
    data?: boolean
  }

  type BaseResponseDiagnosisManageVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: DiagnosisManageVO
  }

  type BaseResponseDiagnosisResultVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: DiagnosisResultVO
  }

  type BaseResponselistReviewSummary = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    /** Data */
    data?: ReviewSummary[]
  }

  type BaseResponseLoginUserVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: LoginUserVO
  }

  type BaseResponseLong = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    /** Data */
    data?: string
  }

  type BaseResponseNewsVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: NewsVO
  }

  type BaseResponsePageDiagnosisManageVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: PageDiagnosisManageVO
  }

  type BaseResponsePageNewsVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: PageNewsVO
  }

  type BaseResponsePageUserVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: PageUserVO
  }

  type BaseResponseReviewDetail = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: ReviewDetail
  }

  type BaseResponseReviewSummary = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: ReviewSummary
  }

  type BaseResponseSaveConfirmationView = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: SaveConfirmationView
  }

  type BaseResponseString = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    /** Data */
    data?: string
  }

  type BaseResponseSupplementView = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: SupplementView
  }

  type BaseResponseUnionSaveConfirmationViewNoneType = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: SaveConfirmationView
  }

  type BaseResponseUserVO = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: UserVO
  }

  type BaseResponseWorkflowStatusView = {
    /** Code */
    code?: number
    /** Msg */
    msg?: string
    data?: WorkflowStatusView
  }

  type BodyCreateWorkflowApiDiagnosisWorkflowsPost = {
    /** File */
    file?: string
    /** Idempotencykey */
    idempotencyKey?: string
    /** Question */
    question?: string
  }

  type BodyDoDiagnosis = {
    /** File */
    file?: string
  }

  type BodyUploadAttachment = {
    /** File */
    file?: string
  }

  type BodyUploadAvatarPicture = {
    /** File */
    file?: string
    /** Username */
    userName?: string
    /** Useravatar */
    userAvatar?: string
    /** Userprofile */
    userProfile?: string
  }

  type BodyUploadCoverImage = {
    body?: NewsUploadDTO
    /** File */
    file?: string
  }

  type BodyUploadDocument = {
    /** Files */
    files?: string[]
    /** Title */
    title?: string
  }

  type BodyUploadImageApiAgentImageUploadPost = {
    /** File */
    file?: string
  }

  type BodyUploadPicture = {
    /** File */
    file?: string
    /** Id */
    id?: string
  }

  type ChatRequest = {
    /** Message */
    message?: string
    /** Threadid */
    threadId?: string
    /** Imageurls */
    imageUrls?: string[]
    /** Enabledmcpservers */
    enabledMcpServers?: string[]
    /** Disablemcpdefault */
    disableMcpDefault?: boolean
    diagnosis?: DiagnosisRequest
    supplement?: SupplementRequest
  }

  type claimApiReviewsTasksTaskIdClaimPostParams = {
    taskId: string
  }

  type confirmationsApiAgentToolConfirmationsGetParams = {
    sessionId: string
  }

  type createSaveConfirmationApiDiagnosisWorkflowsWorkflowIdSaveConfirmationPostParams = {
    workflowId: string
  }

  type decisionApiAgentToolConfirmationsConfirmationIdActionPostParams = {
    confirmation_id: string
    action: string
  }

  type deleteDiagnosisParams = {
    id: number
  }

  type DeleteImageRequest = {
    /** Url */
    url?: string
  }

  type deleteMcpServerParams = {
    mcpServerCode: string
  }

  type deleteNewsParams = {
    id: number
  }

  type DeleteRequest = {
    /** Id */
    id?: number
  }

  type deleteSessionApiAgentSessionsSessionIdDeleteParams = {
    session_id: string
  }

  type deleteUserParams = {
    id: number
  }

  type detailApiReviewsTasksTaskIdGetParams = {
    taskId: string
  }

  type DiagnosisManageVO = {
    id?: number
    /** Url */
    url?: string
    /** Username */
    username?: string
    /** Result */
    result?: string
    /** Confidence */
    confidence?: number
    /** Severity */
    severity?: string
    /** Reexaminestatus */
    reexamineStatus?: number
    /** Createtime */
    createTime?: string
    /** Status */
    status?: string
    /** Airejected */
    aiRejected?: boolean
    /** Abstainreason */
    abstainReason?: string
    /** Requiresreview */
    requiresReview?: boolean
  }

  type DiagnosisQueryDTO = {
    /** Id */
    id?: number
    /** Result */
    result?: string
    /** Diagnosistime */
    diagnosisTime?: string
    /** Userrole */
    userRole?: string
    /** Userid */
    userId?: number
    /** Current */
    current?: number
    /** Pagesize */
    pageSize?: number
    /** Sortfield */
    sortField?: string
    /** Sortorder */
    sortOrder?: string
  }

  type DiagnosisReexamineDTO = {
    /** Id */
    id?: number
  }

  type DiagnosisRequest = {
    /** Workflowid */
    workflowId?: string
    /** Imageurl */
    imageUrl?: string
    /** Idempotencykey */
    idempotencyKey?: string
  }

  type DiagnosisResultDTO = {
    /** Id */
    id?: number
    /** Humanresult */
    humanResult?: string
    /** Humanseverity */
    humanSeverity?: string
    /** Humanrecommendations */
    humanRecommendations?: string
    /** Humanreviewnote */
    humanReviewNote?: string
  }

  type DiagnosisResultVO = {
    id?: number
    /** Url */
    url?: string
    /** Result */
    result?: string
    /** Probability */
    probability?: number
    /** Confidence */
    confidence?: number
    /** Recommendations */
    recommendations?: string
    /** Details */
    details?: string
    /** Severity */
    severity?: string
    /** Createtime */
    createTime?: string
    /** Otherdisease */
    otherDisease?: Disease[]
    /** Airejected */
    aiRejected?: boolean
    /** Abstainreason */
    abstainReason?: string
    /** Modelversion */
    modelVersion?: string
    /** Weightsha256 */
    weightSha256?: string
    /** Humanreviewstatus */
    humanReviewStatus?: string
    /** Humanresult */
    humanResult?: string
    /** Humanseverity */
    humanSeverity?: string
    /** Humanrecommendations */
    humanRecommendations?: string
    /** Humanreviewnote */
    humanReviewNote?: string
    /** Disclaimer */
    disclaimer?: string
    /** Requiresreview */
    requiresReview?: boolean
    /** Qualityscore */
    qualityScore?: number
    /** Qualityreasons */
    qualityReasons?: string
    /** Preprocessversion */
    preprocessVersion?: string
    /** Inferencepolicyversion */
    inferencePolicyVersion?: string
    /** Calibrationstatus */
    calibrationStatus?: string
    /** Calibratedprobability */
    calibratedProbability?: number
    /** Oodstatus */
    oodStatus?: string
    /** Oodscore */
    oodScore?: number
    chunkCount?: number
  }

  type Disease = {
    /** Name */
    name?: string
    /** Probability */
    probability?: number
  }

  type EvidenceCitationView = {
    /** Citationid */
    citationId?: string
    /** Documentid */
    documentId?: string
    /** Sourcerevision */
    sourceRevision?: number
    /** Title */
    title?: string
    /** Source */
    source?: string
    /** Quotedtextdigest */
    quotedTextDigest?: string
  }

  type EvidenceView = {
    /** Status */
    status?: 'SUFFICIENT' | 'INSUFFICIENT'
    /** Reasoncode */
    reasonCode?: string
    /** Attempts */
    attempts?: number
    /** Citations */
    citations?: EvidenceCitationView[]
  }

  type ExplanationView = {
    /** Publicationstatus */
    publicationStatus?: 'NONE' | 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'REJECTED' | 'WITHHELD'
    /** Snapshotid */
    snapshotId?: string
    /** Revision */
    revision?: string
    /** Validationstatus */
    validationStatus?: 'VALIDATED' | 'REJECTED'
  }

  type exportSessionApiAgentHistorySessionIdExportGetParams = {
    session_id: string
    format?: string
  }

  type FinalReviewView = {
    /** Status */
    status?: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
    /** Decisioncode */
    decisionCode?:
      | 'CONFIRM_AI_ASSESSMENT'
      | 'CORRECT_AI_ASSESSMENT'
      | 'INCONCLUSIVE'
      | 'CONFIRM_ABSTENTION'
      | 'PROVIDE_INDEPENDENT_REVIEW'
    /** Reasoncode */
    reasonCode?: string
    /** Audit */
    audit?: ReviewAuditEntry[]
  }

  type generateTitleApiAgentSessionsSessionIdGenerateTitlePostParams = {
    session_id: string
  }

  type GenerateTitleRequest = {
    /** Firstmessage */
    firstMessage?: string
  }

  type getDiagnosisResultVOParams = {
    id: number
  }

  type getMcpServerParams = {
    mcpServerCode: string
    needTools?: boolean
  }

  type getNewsVOParams = {
    id: number
  }

  type getSaveConfirmationApiDiagnosisWorkflowsWorkflowIdSaveConfirmationGetParams = {
    workflowId: string
  }

  type getSupplementApiAgentSupplementsRequestIdGetParams = {
    request_id: string
  }

  type getUserByIdParams = {
    id: number
  }

  type getUserVOByIdParams = {
    id: number
  }

  type getWorkflowApiDiagnosisWorkflowsWorkflowIdGetParams = {
    workflowId: string
  }

  type GovernanceUpdate = {
    /** Visibility */
    visibility?: 'CURATED_PUBLIC' | 'PRIVATE_USER' | 'QUARANTINED'
    /** Reviewstatus */
    reviewStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
    /** Diseasecodes */
    diseaseCodes?: string[]
    /** Topiccodes */
    topicCodes?: string[]
    /** Expectedversion */
    expectedVersion?: number
    /** Confirmed */
    confirmed?: boolean
  }

  type historyApiAgentHistoryThreadIdGetParams = {
    thread_id: string
    beforeId?: number | null
    limit?: number
  }

  type HTTPValidationError = {
    /** Detail */
    detail?: ValidationError[]
  }

  type imageApiReviewsTasksTaskIdImageGetParams = {
    taskId: string
  }

  type KnowledgePageQuery = {
    /** Current */
    current?: number
    /** Pagesize */
    pageSize?: number
    /** Sortfield */
    sortField?: string
    /** Sortorder */
    sortOrder?: string
  }

  type listMcpServersParams = {
    name?: string | null
    current?: number
    size?: number
  }

  type LoginUserVO = {
    id?: number
    /** Useraccount */
    userAccount?: string
    /** Username */
    userName?: string
    /** Useravatar */
    userAvatar?: string
    /** Userprofile */
    userProfile?: string
    /** Userrole */
    userRole?: string
    /** Createtime */
    createTime?: string
    /** Updatetime */
    updateTime?: string
    /** Gender */
    gender?: number
    /** Phone */
    phone?: string
    /** Email */
    email?: string
  }

  type McpServerDetail = {
    /** Mcpservercode */
    mcpServerCode?: string
    /** Name */
    name?: string
    /** Description */
    description?: string
    /** Deployconfig */
    deployConfig?: string
    /** Status */
    status?: number
    /** Installtype */
    installType?: string
    /** Host */
    host?: string
    /** Tools */
    tools?: any[]
  }

  type ModelAssessment = {
    /** Diseasecode */
    diseaseCode?: string
    /** Calibratedprobability */
    calibratedProbability?: number
    /** Modelversion */
    modelVersion?: string
    /** Modelweightfingerprint */
    modelWeightFingerprint?: string
    /** Inferencepolicyversion */
    inferencePolicyVersion?: string
    /** Calibrationstatus */
    calibrationStatus?: string
  }

  type NewsQueryDTO = {
    /** Id */
    id?: number
    /** Title */
    title?: string
    /** Summary */
    summary?: string
    /** Userrole */
    userRole?: string
    /** Current */
    current?: number
    /** Pagesize */
    pageSize?: number
    /** Sortfield */
    sortField?: string
    /** Sortorder */
    sortOrder?: string
  }

  type NewsUpdateDTO = {
    /** Id */
    id?: number
    /** Title */
    title?: string
    /** Content */
    content?: string
    /** Status */
    status?: number
    /** Coverimage */
    coverImage?: string
  }

  type NewsUploadDTO = {
    /** Id */
    id?: number
  }

  type NewsVO = {
    id?: number
    /** Title */
    title?: string
    /** Author */
    author?: string
    /** Avatar */
    avatar?: string
    /** Content */
    content?: string
    /** Summary */
    summary?: string
    /** Coverimage */
    coverImage?: string
    /** Publishtime */
    publishTime?: string
  }

  type PageDiagnosisManageVO = {
    /** Records */
    records?: DiagnosisManageVO[]
    total?: number
    size?: number
    current?: number
    pages?: number
  }

  type PageNewsVO = {
    /** Records */
    records?: NewsVO[]
    total?: number
    size?: number
    current?: number
    pages?: number
  }

  type PageUserVO = {
    /** Records */
    records?: UserVO[]
    total?: number
    size?: number
    current?: number
    pages?: number
  }

  type PinRequest = {
    /** Pinned */
    pinned?: boolean
  }

  type PrivateSearchRequest = {
    /** Query */
    query?: string
  }

  type PublishedCitation = {
    /** Citationid */
    citationId?: string
    /** Documentid */
    documentId?: string
    /** Sourcerevision */
    sourceRevision?: number
    /** Title */
    title?: string
    /** Source */
    source?: string
    /** Quotedtextdigest */
    quotedTextDigest?: string
    /** Quotedtext */
    quotedText?: string
  }

  type PublishedClaim = {
    /** Claimid */
    claimId?: string
    /** Type */
    type?: 'GENERAL_DISEASE_INFORMATION' | 'GENERAL_RISK_CONTEXT' | 'GENERAL_FOLLOW_UP_GUIDANCE'
    /** Text */
    text?: string
    /** Citationids */
    citationIds?: string[]
  }

  type PublishedExplanation = {
    /** Snapshotid */
    snapshotId?: string
    /** Revision */
    revision?: string
    modelAssessment?: ModelAssessment
    /** Generalinformation */
    generalInformation?: PublishedClaim[]
    /** Citations */
    citations?: PublishedCitation[]
    /** Risknotice */
    riskNotice?: string
    /** Limitation */
    limitation?: string
  }

  type QualityReviewView = {
    /** Status */
    status?: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
    /** Decisioncode */
    decisionCode?: 'APPROVE_CONTINUE' | 'REJECT_RESUBMIT'
    /** Reasoncode */
    reasonCode?: string
  }

  type rejectSaveApiDiagnosisWorkflowsWorkflowIdSaveConfirmationsConfirmationIdRejectPostParams = {
    workflowId: string
    confirmationId: string
  }

  type replySupplementApiAgentSupplementsRequestIdReplyPostParams = {
    request_id: string
  }

  type ResultAvailability = {
    /** Patientvisible */
    patientVisible?: boolean
    /** Doctorreviewrequired */
    doctorReviewRequired?: boolean
  }

  type ReviewAuditEntry = {
    /** Eventid */
    eventId?: string
    /** Eventtype */
    eventType?: string
    /** Actortype */
    actorType?: string
    /** Workflowversion */
    workflowVersion?: string
    /** Reasoncode */
    reasonCode?: string
    /** Occurredat */
    occurredAt?: string
  }

  type ReviewDetail = {
    /** Reviewtaskid */
    reviewTaskId?: string
    /** Workflowid */
    workflowId?: string
    /** Reviewtype */
    reviewType?: 'IMAGE_QUALITY_GATE' | 'FINAL_CLINICAL_REVIEW'
    /** Status */
    status?: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
    /** Taskversion */
    taskVersion?: string
    /** Workflowversion */
    workflowVersion?: string
    /** Assigneddoctorid */
    assignedDoctorId?: string
    /** Decisioncode */
    decisionCode?:
      | 'APPROVE_CONTINUE'
      | 'REJECT_RESUBMIT'
      | 'CONFIRM_AI_ASSESSMENT'
      | 'CORRECT_AI_ASSESSMENT'
      | 'INCONCLUSIVE'
      | 'CONFIRM_ABSTENTION'
      | 'PROVIDE_INDEPENDENT_REVIEW'
    /** Reasoncode */
    reasonCode?: string
    /** Question */
    question?: string
    /** Supplementarynotes */
    supplementaryNotes?: string[]
    /** Alloweddecisions */
    allowedDecisions?: (
      | 'APPROVE_CONTINUE'
      | 'REJECT_RESUBMIT'
      | 'CONFIRM_AI_ASSESSMENT'
      | 'CORRECT_AI_ASSESSMENT'
      | 'INCONCLUSIVE'
      | 'CONFIRM_ABSTENTION'
      | 'PROVIDE_INDEPENDENT_REVIEW'
    )[]
    /** Inferenceenvelopeid */
    inferenceEnvelopeId?: string
    /** Inferenceepoch */
    inferenceEpoch?: string
    /** Inputdigest */
    inputDigest?: string
    /** Qualityoutcome */
    qualityOutcome?: string
    /** Qualityscore */
    qualityScore?: number
    /** Qualityreasons */
    qualityReasons?: string[]
    /** Modelversion */
    modelVersion?: string
    /** Modelweightfingerprint */
    modelWeightFingerprint?: string
    /** Preprocessversion */
    preprocessVersion?: string
    /** Inferencepolicyversion */
    inferencePolicyVersion?: string
    /** Graphdefinitionversion */
    graphDefinitionVersion?: string
    /** Inferenceoutcome */
    inferenceOutcome?: string
    /** Abstentionreason */
    abstentionReason?: string
    /** Modelassessment */
    modelAssessment?: Record<string, any>
    /** Evidence */
    evidence?: Record<string, any>
    /** Explanation */
    explanation?: Record<string, any>
    /** Audit */
    audit?: ReviewAuditEntry[]
  }

  type ReviewSubmission = {
    /** Expectedtaskversion */
    expectedTaskVersion?: string
    /** Expectedworkflowversion */
    expectedWorkflowVersion?: string
    /** Expectedexplanationsnapshotid */
    expectedExplanationSnapshotId?: string
    /** Expectedexplanationrevision */
    expectedExplanationRevision?: string
    /** Decisioncode */
    decisionCode?:
      | 'APPROVE_CONTINUE'
      | 'REJECT_RESUBMIT'
      | 'CONFIRM_AI_ASSESSMENT'
      | 'CORRECT_AI_ASSESSMENT'
      | 'INCONCLUSIVE'
      | 'CONFIRM_ABSTENTION'
      | 'PROVIDE_INDEPENDENT_REVIEW'
    /** Reasoncode */
    reasonCode?:
      | 'QUALITY_APPROVED'
      | 'QUALITY_REJECTED'
      | 'AI_ASSESSMENT_CONFIRMED'
      | 'AI_ASSESSMENT_CORRECTED'
      | 'INCONCLUSIVE'
      | 'ABSTENTION_CONFIRMED'
      | 'INDEPENDENT_REVIEW_PROVIDED'
  }

  type ReviewSummary = {
    /** Reviewtaskid */
    reviewTaskId?: string
    /** Workflowid */
    workflowId?: string
    /** Reviewtype */
    reviewType?: 'IMAGE_QUALITY_GATE' | 'FINAL_CLINICAL_REVIEW'
    /** Status */
    status?: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
    /** Taskversion */
    taskVersion?: string
    /** Workflowversion */
    workflowVersion?: string
    /** Assigneddoctorid */
    assignedDoctorId?: string
    /** Decisioncode */
    decisionCode?:
      | 'APPROVE_CONTINUE'
      | 'REJECT_RESUBMIT'
      | 'CONFIRM_AI_ASSESSMENT'
      | 'CORRECT_AI_ASSESSMENT'
      | 'INCONCLUSIVE'
      | 'CONFIRM_ABSTENTION'
      | 'PROVIDE_INDEPENDENT_REVIEW'
    /** Reasoncode */
    reasonCode?: string
  }

  type ReviewVersions = {
    /** Expectedtaskversion */
    expectedTaskVersion?: string
    /** Expectedworkflowversion */
    expectedWorkflowVersion?: string
    /** Expectedexplanationsnapshotid */
    expectedExplanationSnapshotId?: string
    /** Expectedexplanationrevision */
    expectedExplanationRevision?: string
  }

  type SaveConfirmationView = {
    /** Confirmationid */
    confirmationId?: string
    /** Workflowid */
    workflowId?: string
    /** Operationtype */
    operationType?: string
    /** Status */
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED'
    /** Idempotencykey */
    idempotencyKey?: string
    /** Workflowversion */
    workflowVersion?: string
    /** Contentdigest */
    contentDigest?: string
    content?: SaveContent
    /** Expiresat */
    expiresAt?: string
    /** Diagnosisid */
    diagnosisId?: string
  }

  type SaveContent = {
    /** Imageurl */
    imageUrl?: string
    /** Imagedigest */
    imageDigest?: string
    /** Result */
    result?: string
    /** Calibratedprobability */
    calibratedProbability?: number
    /** Severity */
    severity?: string
    /** Details */
    details?: string
    explanation?: PublishedExplanation
    /** Finalreviewtaskid */
    finalReviewTaskId?: string
  }

  type SaveDecision = {
    /** Idempotencykey */
    idempotencyKey?: string
    /** Expectedcontentdigest */
    expectedContentDigest?: string
    /** Expectedworkflowversion */
    expectedWorkflowVersion?: string
  }

  type SaveRequest = {
    /** Idempotencykey */
    idempotencyKey?: string
    /** Expectedworkflowversion */
    expectedWorkflowVersion?: string
    /** Expectedexplanationsnapshotid */
    expectedExplanationSnapshotId?: string
    /** Expectedexplanationrevision */
    expectedExplanationRevision?: string
  }

  type SessionBatch = {
    /** Sessionids */
    sessionIds?: string[]
  }

  type sessionsApiAgentSessionsGetParams = {
    beforeId?: number | null
    limit?: number
  }

  type submitApiReviewsTasksTaskIdSubmitPostParams = {
    taskId: string
  }

  type SupplementItem = {
    /** Key */
    key?: string
    /** Prompt */
    prompt?: string
  }

  type SupplementReply = {
    /** Sessionid */
    sessionId?: string
    /** Workflowid */
    workflowId?: string
    /** Expectedversion */
    expectedVersion?: string
    /** Text */
    text?: string
  }

  type SupplementRequest = {
    /** Workflowid */
    workflowId?: string
    /** Idempotencykey */
    idempotencyKey?: string
  }

  type SupplementView = {
    /** Requestid */
    requestId?: string
    /** Sessionid */
    sessionId?: string
    /** Workflowid */
    workflowId?: string
    /** Status */
    status?: 'WAITING' | 'ANSWERED'
    /** Version */
    version?: string
    /** Items */
    items?: SupplementItem[]
    /** Answer */
    answer?: string
  }

  type TitleRequest = {
    /** Title */
    title?: string
  }

  type ToolDecision = {
    /** Idempotencykey */
    idempotencyKey?: string
    /** Expectedcontentdigest */
    expectedContentDigest?: string
  }

  type updateKnowledgeGovernanceParams = {
    document_id: number
  }

  type updatePinApiAgentSessionsSessionIdPinPutParams = {
    session_id: string
  }

  type updateTitleApiAgentSessionsSessionIdTitlePutParams = {
    session_id: string
  }

  type UserAddDTO = {
    /** Username */
    userName?: string
    /** Useraccount */
    userAccount?: string
    /** Useravatar */
    userAvatar?: string
    /** Userprofile */
    userProfile?: string
    /** Userrole */
    userRole?: string
    /** Userpassword */
    userPassword?: string
  }

  type UserEditDTO = {
    /** Username */
    userName?: string
    /** Useravatar */
    userAvatar?: string
    /** Userprofile */
    userProfile?: string
    id?: number
    gender?: number
    phone?: string
    email?: string
  }

  type UserLoginDTO = {
    /** Useraccount */
    userAccount?: string
    /** Userpassword */
    userPassword?: string
  }

  type UserQueryDTO = {
    /** Id */
    id?: number
    /** Username */
    userName?: string
    /** Useraccount */
    userAccount?: string
    /** Userprofile */
    userProfile?: string
    /** Userrole */
    userRole?: string
    /** Current */
    current?: number
    /** Pagesize */
    pageSize?: number
    /** Sortfield */
    sortField?: string
    /** Sortorder */
    sortOrder?: string
  }

  type UserRegisterDTO = {
    /** Useraccount */
    userAccount?: string
    /** Userpassword */
    userPassword?: string
    /** Checkpassword */
    checkPassword?: string
  }

  type UserUpdateDTO = {
    /** Id */
    id?: number
    /** Username */
    userName?: string
    /** Useravatar */
    userAvatar?: string
    /** Userprofile */
    userProfile?: string
    /** Userrole */
    userRole?: string
  }

  type UserVO = {
    id?: number
    /** Useraccount */
    userAccount?: string
    /** Username */
    userName?: string
    /** Useravatar */
    userAvatar?: string
    /** Userprofile */
    userProfile?: string
    /** Userrole */
    userRole?: string
    /** Createtime */
    createTime?: string
  }

  type ValidationError = {
    /** Location */
    loc?: (string | number)[]
    /** Message */
    msg?: string
    /** Error Type */
    type?: string
    /** Input */
    input?: any
    /** Context */
    ctx?: Record<string, any>
  }

  type workflowEventsApiDiagnosisWorkflowsWorkflowIdEventsGetParams = {
    workflowId: string
  }

  type workflowImageApiDiagnosisWorkflowsWorkflowIdImageGetParams = {
    workflowId: string
  }

  type WorkflowProgress = {
    /** Current */
    current?: string
    /** Completed */
    completed?: string[]
  }

  type WorkflowStatusView = {
    /** Workflowid */
    workflowId?: string
    /** Status */
    status?:
      | 'CREATED'
      | 'QUEUED'
      | 'RUNNING'
      | 'WAITING_HUMAN_REVIEW'
      | 'COMPLETED'
      | 'COMPLETED_LIMITED'
      | 'REJECTED'
      | 'CANCELLED'
      | 'FAILED'
    /** Workflowversion */
    workflowVersion?: string
    /** Segment */
    segment?: string
    /** Graphdefinitionversion */
    graphDefinitionVersion?: string
    progress?: WorkflowProgress
    /** Stopreasoncode */
    stopReasonCode?: string
    /** Qualitygate */
    qualityGate?: 'PASS' | 'REJECT' | 'REVIEW'
    qualityReview?: QualityReviewView
    finalReview?: FinalReviewView
    evidence?: EvidenceView
    explanation?: ExplanationView
    resultAvailability?: ResultAvailability
    result?: PublishedExplanation
  }
}
