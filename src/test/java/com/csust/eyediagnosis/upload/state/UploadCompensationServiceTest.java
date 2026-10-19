package com.csust.eyediagnosis.upload.state;

import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UploadCompensationServiceTest {

    @Mock private CosManager cosManager;
    @Mock private UploadTaskMapper taskMapper;
    @Mock private UploadStateMachine stateMachine;

    @InjectMocks
    private UploadCompensationService service;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "minAgeMinutes", 30L);
    }

    @Test
    void reconcileDeletesOrphanObjectsUnderOwnerPrefix() {
        when(taskMapper.selectActiveKeys(eq(7L), anyList())).thenReturn(List.of("agent-chat/7/keep.png"));
        when(cosManager.listObjects("agent-chat/7/")).thenReturn(List.of(
                object("agent-chat/7/keep.png", hoursAgo(5)),
                object("agent-chat/7/orphan.png", hoursAgo(5))));

        int removed = service.reconcileOwner(7L);

        assertEquals(1, removed);
        verify(cosManager).deleteObject("agent-chat/7/orphan.png");
    }

    @Test
    void reconcileKeepsObjectsWhoseTaskIsStillActive() {
        when(taskMapper.selectActiveKeys(eq(7L), anyList())).thenReturn(List.of("agent-chat/7/keep.png"));
        when(cosManager.listObjects("agent-chat/7/")).thenReturn(
                List.of(object("agent-chat/7/keep.png", hoursAgo(5))));

        int removed = service.reconcileOwner(7L);

        assertEquals(0, removed);
        verify(cosManager, never()).deleteObject(any());
    }

    @Test
    void reconcileSkipsObjectsStillInsideGracePeriod() {
        when(taskMapper.selectActiveKeys(eq(7L), anyList())).thenReturn(List.of());
        when(cosManager.listObjects("agent-chat/7/")).thenReturn(
                List.of(object("agent-chat/7/fresh.png", new Date())));

        int removed = service.reconcileOwner(7L);

        assertEquals(0, removed);
        verify(cosManager, never()).deleteObject(any());
    }

    @Test
    void reconcileAllGroupsObjectsByOwner() {
        when(taskMapper.selectActiveKeys(eq(7L), anyList())).thenReturn(List.of("agent-chat/7/keep.png"));
        when(taskMapper.selectActiveKeys(eq(9L), anyList())).thenReturn(List.of());
        when(cosManager.listObjects("agent-chat/")).thenReturn(List.of(
                object("agent-chat/7/keep.png", hoursAgo(5)),
                object("agent-chat/7/orphan.png", hoursAgo(5)),
                object("agent-chat/9/orphan.png", hoursAgo(5))));

        int removed = service.reconcileAll();

        assertEquals(2, removed);
        verify(cosManager).deleteObject("agent-chat/7/orphan.png");
        verify(cosManager).deleteObject("agent-chat/9/orphan.png");
        verify(cosManager, never()).deleteObject("agent-chat/7/keep.png");
    }

    @Test
    void reconcileAllIgnoresKeysWithoutOwnerPrefix() {
        when(cosManager.listObjects("agent-chat/")).thenReturn(List.of(
                object("other-prefix/1/x.png", hoursAgo(5))));

        assertEquals(0, service.reconcileAll());
        verify(cosManager, never()).deleteObject(any());
    }

    @Test
    void markDeletedMovesPersistedTaskToDeleted() {
        UploadTask task = new UploadTask();
        task.setTaskId("task-1");
        task.setUserId(7L);
        task.setObjectKey("agent-chat/7/a.png");
        task.setStatus(UploadStatus.PERSISTED.getCode());
        when(taskMapper.selectByObjectKey(7L, "agent-chat/7/a.png")).thenReturn(task);
        when(taskMapper.updateStatus("task-1", UploadStatus.PERSISTED.getCode(), UploadStatus.DELETED.getCode()))
                .thenReturn(1);

        assertTrue(service.markDeleted("agent-chat/7/a.png", 7L));
        verify(stateMachine).transition("task-1", UploadStatus.PERSISTED, UploadStatus.DELETED);
    }

    @Test
    void markDeletedReturnsFalseWhenNoTaskRowExists() {
        when(taskMapper.selectByObjectKey(7L, "agent-chat/7/missing.png")).thenReturn(null);

        assertFalse(service.markDeleted("agent-chat/7/missing.png", 7L));
        verify(taskMapper, never()).updateStatus(any(), any(), any());
    }

    @Test
    void markDeletedIsIdempotentForAlreadyDeletedTask() {
        UploadTask task = new UploadTask();
        task.setTaskId("task-2");
        task.setStatus(UploadStatus.DELETED.getCode());
        when(taskMapper.selectByObjectKey(7L, "agent-chat/7/b.png")).thenReturn(task);

        assertTrue(service.markDeleted("agent-chat/7/b.png", 7L));
        verify(taskMapper, never()).updateStatus(any(), any(), any());
    }

    private CosManager.CosObjectInfo object(String key, Date lastModified) {
        return new CosManager.CosObjectInfo(key, lastModified);
    }

    private Date hoursAgo(int hours) {
        return new Date(System.currentTimeMillis() - hours * 3600_000L);
    }
}
