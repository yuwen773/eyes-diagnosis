package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.entity.Attachment;

import java.util.List;

/**
* @author 钰玟
* @description 针对表【t_attachment(新闻附件表)】的数据库操作Service
* @createDate 2025-04-29 16:27:36
*/
public interface AttachmentService extends IService<Attachment> {

    List<Attachment> getByNewsId();
}
