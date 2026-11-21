package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface KnowledgeDocumentMapper extends BaseMapper<KnowledgeDocument> {
    @Update("UPDATE t_knowledge_document SET indexVersion=#{version}, status=0, chunkCount=NULL "
            + "WHERE id=#{id} AND isDelete=0")
    int beginIndex(@Param("id") Long id, @Param("version") String version);

    @Update("UPDATE t_knowledge_document SET status=#{status}, chunkCount=#{chunkCount} "
            + "WHERE id=#{id} AND indexVersion=#{version} AND isDelete=0")
    int finishIndex(@Param("id") Long id, @Param("version") String version,
                    @Param("status") int status, @Param("chunkCount") Integer chunkCount);
}
