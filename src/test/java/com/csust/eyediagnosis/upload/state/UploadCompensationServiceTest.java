package com.csust.eyediagnosis.upload.state;

import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UploadCompensationServiceTest {

    @Mock private CosManager cosManager;
    @Mock private UploadTaskMapper taskMapper;
    @Mock private UploadStateMachine stateMachine;

    @InjectMocks
    private UploadCompensationService service;

    @Test
    void reconcileDeletesOrphanObjectsUnderOwnerPrefix() {
        when(taskMapper.selectActiveKeys(any(Long.class))).thenReturn(List.of("agent-chat/7/keep.png"));
        when(cosManager.listObjectsByPrefix("agent-chat/7/")).thenReturn(
                List.of("agent-chat/7/keep.png", "agent-chat/7/orphan.png"));

        int removed = service.reconcileOwner(7L);

        assertEquals(1, removed);
        verify(cosManager).deleteObject("agent-chat/7/orphan.png");
    }
}