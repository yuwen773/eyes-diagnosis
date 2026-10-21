package com.csust.eyediagnosis.manager;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.qcloud.cos.COSClient;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.DeleteObjectsRequest;
import com.qcloud.cos.model.DeleteObjectRequest;
import com.qcloud.cos.model.GetObjectRequest;
import com.qcloud.cos.model.ListObjectsRequest;
import com.qcloud.cos.model.ObjectListing;
import com.qcloud.cos.model.PutObjectRequest;
import com.qcloud.cos.model.PutObjectResult;
import com.qcloud.cos.model.ciModel.persistence.PicOperations;
import org.springframework.stereotype.Component;

import jakarta.annotation.Resource;
import java.io.File;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * @ClassNameCosManager
 * @Description 通用的对象存储cos操作
 * @Author钰玟
 * @Date2025/4/17 下午1:15
 * @Version 1.0
 **/
@Component
public class CosManager {
    // 引入对象存储配置
    @Resource
    private CosClientConfig cosClientConfig;

    //Cos客户端
    @Resource
    private COSClient cosClient;


    /**
     * 上传对象
     *
     * @param key  唯一键
     * @param file 文件
     */
    public PutObjectResult putObject(String key, File file) {
        PutObjectRequest putObjectRequest = new PutObjectRequest(cosClientConfig.getBucket(), key,
                file);
        return cosClient.putObject(putObjectRequest);
    }
    /**
     * 下载对象
     *
     * @param key 唯一键
     */
    public COSObject getObject(String key) {
        GetObjectRequest getObjectRequest = new GetObjectRequest(cosClientConfig.getBucket(), key);
        return cosClient.getObject(getObjectRequest);
    }

    /**
     * 上传对象（附带图片信息）
     *
     * @param key  唯一键
     * @param file 文件
     */
    public PutObjectResult putPictureObject(String key, File file) {
        PutObjectRequest putObjectRequest = new PutObjectRequest(cosClientConfig.getBucket(), key,
                file);
        // 对图片进行处理（获取基本信息也被视作为一种处理）
        PicOperations picOperations = new PicOperations();
        // 1 表示返回原图信息
        picOperations.setIsPicInfo(1);
        // 构造处理参数
        putObjectRequest.setPicOperations(picOperations);
        return cosClient.putObject(putObjectRequest);
    }

    /**
     * 删除对象：调用方必须已校验 object key 的归属（owner 前缀），否则可能删除他人文件。
     */
    public void deleteObject(String objectKey) {
        cosClient.deleteObject(new DeleteObjectRequest(cosClientConfig.getBucket(), objectKey));
    }

    /**
     * 判断对象是否存在：用于删除前的对账/补偿，避免无意义的删除请求。
     */
    public boolean objectExists(String objectKey) {
        return cosClient.doesObjectExist(cosClientConfig.getBucket(), objectKey);
    }

    /**
     * 按前缀列举对象，用于补偿任务对账。
     *
     * <p>同时返回最后修改时间：补偿任务需要据此跳过"刚刚上传、任务行可能尚未落库"的对象，
     * 避免把进行中的上传误判为孤儿。
     */
    public List<CosObjectInfo> listObjects(String prefix) {
        List<CosObjectInfo> objects = new ArrayList<>();
        ListObjectsRequest request = new ListObjectsRequest();
        request.setBucketName(cosClientConfig.getBucket());
        request.setPrefix(prefix);
        request.setMaxKeys(1000);
        ObjectListing listing;
        do {
            listing = cosClient.listObjects(request);
            listing.getObjectSummaries()
                    .forEach(s -> objects.add(new CosObjectInfo(s.getKey(), s.getLastModified())));
            request.setMarker(listing.getNextMarker());
        } while (listing.isTruncated());
        return objects;
    }

    /**
     * COS 对象摘要：key 与最后修改时间。
     *
     * @param key          对象 key
     * @param lastModified 最后修改时间，COS 正常返回；为 {@code null} 表示未知
     */
    public record CosObjectInfo(String key, Date lastModified) {
    }

}
