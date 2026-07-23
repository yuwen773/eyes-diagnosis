package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.manager.CosManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class AgentImageUploadServiceTest {

    @Mock
    private CosManager cosManager;
    @Mock
    private CosClientConfig cosClientConfig;
    @InjectMocks
    private AgentImageUploadService service;

    @Test
    void rejectsExecutableRenamedAsPng() {
        MockMultipartFile file = new MockMultipartFile(
                "file", "fake.png", "image/png", "not-an-image".getBytes());
        assertThrows(BusinessException.class, () -> service.uploadImage(file, 7L));
        verifyNoInteractions(cosManager);
    }

    @Test
    void deletionRejectsForeignObjectKey() {
        assertThrows(BusinessException.class,
                () -> service.deleteImage("https://cos-host/agent-chat/8/a.png", 7L));
        verifyNoInteractions(cosManager);
    }
}
