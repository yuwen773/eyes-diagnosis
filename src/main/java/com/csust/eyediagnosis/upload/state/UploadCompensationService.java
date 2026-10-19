package com.csust.eyediagnosis.upload.state;

import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 上传补偿服务。
 *
 * <p>对象存储里的图片与 {@code t_upload_task} 的任务行是两个独立写入的存储，
 * 进程在"COS 写入成功、任务行落库前"崩溃就会留下没有任务行的孤儿对象。
 * 本服务按 owner 前缀对账，删除这类孤儿对象。
 *
 * <p>保留集合来自 {@link UploadTaskMapper#selectActiveKeys}：只有仍处于
 * UPLOADING / PERSISTED / COMPLETED 的任务，其对象才必须留在 COS 上。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UploadCompensationService {

    /** Agent 对话图片在 COS 上的前缀。 */
    public static final String OBJECT_KEY_PREFIX = "agent-chat/";

    private final CosManager cosManager;
    private final UploadTaskMapper taskMapper;
    private final UploadStateMachine stateMachine;

    /**
     * 宽限期（分钟）。最近这段时间内被修改过的对象不参与清理：
     * 上传流程是"先写 COS、再落任务行"，宽限期用来避开这段窗口，
     * 防止把正在上传的图片误判为孤儿。
     */
    @Value("${eye-diagnosis.upload.compensation.min-age-minutes:30}")
    private long minAgeMinutes = 30;

    /**
     * 对账单个用户：删除该用户前缀下没有有效任务登记的孤儿对象。
     *
     * @return 删除的对象数
     */
    public int reconcileOwner(Long userId) {
        if (userId == null) {
            return 0;
        }
        return reconcile(userId, cosManager.listObjects(ownerPrefix(userId)));
    }

    /**
     * 全量对账：一次列举 {@code agent-chat/} 前缀，按 owner 分组后逐个对账。
     *
     * @return 删除的对象数
     */
    public int reconcileAll() {
        Map<Long, List<CosManager.CosObjectInfo>> byOwner = new LinkedHashMap<>();
        for (CosManager.CosObjectInfo object : cosManager.listObjects(OBJECT_KEY_PREFIX)) {
            Long owner = parseOwnerId(object.key());
            if (owner == null) {
                log.warn("无法解析 owner，跳过对账: key={}", object.key());
                continue;
            }
            byOwner.computeIfAbsent(owner, key -> new ArrayList<>()).add(object);
        }
        int removed = 0;
        for (Map.Entry<Long, List<CosManager.CosObjectInfo>> entry : byOwner.entrySet()) {
            removed += reconcile(entry.getKey(), entry.getValue());
        }
        return removed;
    }

    /**
     * 把对象对应的上传任务标记为已删除。
     *
     * <p>用户主动删除图片时调用。即使随后 COS 删除失败，任务已标记为 DELETED，
     * 补偿任务下次对账时仍会把它当作可清理对象，完成重试。
     *
     * @return 是否成功标记（对象没有对应任务行时返回 false）
     */
    public boolean markDeleted(String objectKey, Long userId) {
        if (objectKey == null || userId == null) {
            return false;
        }
        UploadTask task = taskMapper.selectByObjectKey(userId, objectKey);
        if (task == null) {
            return false;
        }
        UploadStatus current = UploadStatus.fromCode(task.getStatus());
        if (current == null) {
            log.warn("未知的上传状态，跳过删除标记: taskId={}, status={}", task.getTaskId(), task.getStatus());
            return false;
        }
        if (current == UploadStatus.DELETED) {
            return true;
        }
        try {
            stateMachine.transition(task.getTaskId(), current, UploadStatus.DELETED);
        } catch (IllegalStateTransitionException e) {
            log.warn("非法的删除状态迁移: taskId={}, {} -> DELETED", task.getTaskId(), current);
            return false;
        }
        return taskMapper.updateStatus(task.getTaskId(), current.getCode(), UploadStatus.DELETED.getCode()) > 0;
    }

    private int reconcile(Long userId, List<CosManager.CosObjectInfo> stored) {
        Set<String> activeKeys = new HashSet<>(taskMapper.selectActiveKeys(userId, UploadStatus.activeCodes()));
        Instant deadline = Instant.now().minus(Duration.ofMinutes(minAgeMinutes));
        int removed = 0;
        for (CosManager.CosObjectInfo object : stored) {
            if (activeKeys.contains(object.key())) {
                continue;
            }
            if (isWithinGracePeriod(object.lastModified(), deadline)) {
                log.debug("对象仍在宽限期内，跳过: key={}", object.key());
                continue;
            }
            try {
                cosManager.deleteObject(object.key());
                removed++;
            } catch (Exception e) {
                log.warn("补偿删除失败: key={}", object.key(), e);
            }
        }
        if (removed > 0) {
            log.info("用户 {} 的补偿对账清理了 {} 个孤儿对象", userId, removed);
        }
        return removed;
    }

    private boolean isWithinGracePeriod(Date lastModified, Instant deadline) {
        if (lastModified == null) {
            log.warn("对象缺少最后修改时间，按可清理处理");
            return false;
        }
        return lastModified.toInstant().isAfter(deadline);
    }

    private String ownerPrefix(Long userId) {
        return OBJECT_KEY_PREFIX + userId + "/";
    }

    /**
     * 从对象 key 解析 owner：{@code agent-chat/{userId}/{name}}。
     *
     * @return owner 用户 id；格式不符时返回 {@code null}
     */
    private Long parseOwnerId(String objectKey) {
        if (objectKey == null) {
            return null;
        }
        String[] parts = objectKey.split("/");
        if (parts.length < 3 || !OBJECT_KEY_PREFIX.equals(parts[0] + "/")) {
            return null;
        }
        try {
            return Long.parseLong(parts[1]);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
