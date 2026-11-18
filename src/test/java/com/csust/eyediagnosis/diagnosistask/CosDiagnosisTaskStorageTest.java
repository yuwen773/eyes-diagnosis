package com.csust.eyediagnosis.diagnosistask;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.qcloud.cos.COSClient;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.GetObjectRequest;
import com.qcloud.cos.model.ObjectMetadata;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.io.ByteArrayInputStream;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CosDiagnosisTaskStorageTest {
    @Test
    void readsOnlyTheRequestedVersionAndRejectsMissingOrDifferentVersions() {
        var client = mock(COSClient.class);
        var config = new CosClientConfig(); config.setBucket("test-bucket");
        var storage = new CosDiagnosisTaskStorage(client, config);
        assertThrows(IllegalArgumentException.class, () -> storage.readVersion("key", "null"));
        verifyNoInteractions(client);
        var object = new COSObject();
        var metadata = mock(ObjectMetadata.class);
        when(metadata.getVersionId()).thenReturn("v1");
        object.setObjectMetadata(metadata);
        object.setObjectContent(new com.qcloud.cos.model.COSObjectInputStream(new ByteArrayInputStream(new byte[]{1, 2, 3}), new org.apache.http.client.methods.HttpGet()));
        when(client.getObject(any(GetObjectRequest.class))).thenReturn(object);
        assertArrayEquals(new byte[]{1, 2, 3}, storage.readVersion("key", "v1"));
        var request = ArgumentCaptor.forClass(GetObjectRequest.class);
        verify(client).getObject(request.capture());
        assertEquals("v1", request.getValue().getVersionId());
        assertEquals("key", request.getValue().getKey());
        var changed = new COSObject(); changed.setObjectMetadata(metadata);
        changed.setObjectContent(new com.qcloud.cos.model.COSObjectInputStream(new ByteArrayInputStream(new byte[]{1}), new org.apache.http.client.methods.HttpGet()));
        when(client.getObject(any(GetObjectRequest.class))).thenReturn(changed);
        assertThrows(IllegalStateException.class, () -> storage.readVersion("key", "v2"));
    }
}
