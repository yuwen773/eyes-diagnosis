package com.csust.eyediagnosis.model.dto.knowledge;

import lombok.Data;
import org.springframework.web.multipart.MultipartFile;

@Data
public class KnowledgeUploadRequest {
    private String title;
    private MultipartFile file;
}
