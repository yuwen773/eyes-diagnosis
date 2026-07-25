package com.csust.eyediagnosis;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.qcloud.cos.COSClient;
import org.junit.jupiter.api.Test;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verifyNoInteractions;

@SpringBootTest
@ActiveProfiles("test")
class EyeDiagnosisApplicationTests {

    @MockitoBean
    private COSClient cosClient;

    @MockitoBean
    private VectorStore vectorStore;

    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void contextLoads() {
    }

    @Test
    void testContextUsesMockCosClient() {
        assertSame(cosClient, applicationContext.getBean(COSClient.class));
        assertTrue(mockingDetails(cosClient).isMock());
    }

    @Test
    void cosClientRejectsMissingCredentials() {
        assertThrows(IllegalArgumentException.class, () -> new CosClientConfig().cosClient());
    }

    @Test
    void testContextDoesNotCallCos() {
        verifyNoInteractions(cosClient);
    }
}
