// Existing upload/query adapter types. Python remains the wire-contract authority.
declare namespace API {
  type uploadPictureParams = {
    diagnosisUploadDTO: DiagnosisUploadDTO
  }

  type DiagnosisUploadDTO = {
    id?: number
  }

  type uploadAvatarPictureParams = {
    userEditDTO: UserEditDTO
  }

  type uploadCoverImageParams = {
    newsUploadDTO: NewsUploadDTO
  }

  type NewsUploadDTO = {
    id?: number
  }

  type reexamineDiagnosisParams = {
    diagnosisReexamineDTO: DiagnosisReexamineDTO
  }
}
