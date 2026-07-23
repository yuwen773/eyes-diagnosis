package com.csust.eyediagnosis.upload.state;

import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class UploadCompensationService {

    private final CosManager cosManager;
    private final UploadTaskMapper taskMapper;
    private final UploadStateMachine stateMachine;

    public int reconcileOwner(Long userId) {
        Set<String> activeKeys = Set.copyOf(taskMapper.selectActiveKeys(userId));
        String prefix = "agent-chat/" + userId + "/";
        List<String> stored = cosManager.listObjectsByPrefix(prefix);
        int removed = 0;
        for (String key : stored) {
            if (activeKeys.contains(key)) {
                continue;
            }
            try {
                cosManager.deleteObject(key);
                removed++;
            } catch (Exception e) {
                log.warn("reconcile remove failed: {}", key, e);
            }
        }
        return removed;
    }
}