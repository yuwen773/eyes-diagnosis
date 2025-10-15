package com.csust.eyediagnosis.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.mapper.AttachmentMapper;
import com.csust.eyediagnosis.model.entity.Attachment;
import com.csust.eyediagnosis.service.AttachmentService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
* @author 钰玟
* @description 针对表【t_attachment(新闻附件表)】的数据库操作Service实现
* @createDate 2025-04-29 16:27:36
*/
@Service
public class AttachmentServiceImpl extends ServiceImpl<AttachmentMapper, Attachment>
    implements AttachmentService{

    @Override
    public List<Attachment> getByNewsId() {
        return new ArrayList<>();
    }
}




