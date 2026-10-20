package com.csust.eyediagnosis.upload.state;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UploadStatusTest {

    @Test
    void codesMatchTheValuesPersistedInTheDatabase() {
        // 这些数值已经写进 t_upload_task.status，不能随意改动
        assertEquals(1, UploadStatus.UPLOADING.getCode());
        assertEquals(2, UploadStatus.PERSISTED.getCode());
        assertEquals(3, UploadStatus.FAILED.getCode());
        assertEquals(4, UploadStatus.COMPLETED.getCode());
        assertEquals(5, UploadStatus.DELETED.getCode());
    }

    @Test
    void activeCodesKeepPersistedTasksAndDropFailedOrDeletedOnes() {
        // 补偿对账据此决定"哪些 COS 对象必须保留"：
        // 历史上误把 PERSISTED 排除在外，会导致用户全部图片被清理
        assertTrue(UploadStatus.activeCodes().contains(UploadStatus.UPLOADING.getCode()));
        assertTrue(UploadStatus.activeCodes().contains(UploadStatus.PERSISTED.getCode()));
        assertTrue(UploadStatus.activeCodes().contains(UploadStatus.COMPLETED.getCode()));
        assertFalse(UploadStatus.activeCodes().contains(UploadStatus.FAILED.getCode()));
        assertFalse(UploadStatus.activeCodes().contains(UploadStatus.DELETED.getCode()));
    }

    @Test
    void fromCodeResolvesKnownCodesOnly() {
        assertEquals(UploadStatus.PERSISTED, UploadStatus.fromCode(2));
        assertNull(UploadStatus.fromCode(99));
        assertNull(UploadStatus.fromCode(null));
    }
}
