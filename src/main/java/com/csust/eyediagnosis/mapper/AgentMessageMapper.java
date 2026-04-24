package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import org.apache.ibatis.annotations.*;

import java.util.Date;
import java.util.List;

@Mapper
public interface AgentMessageMapper extends BaseMapper<AgentMessage> {

    String SUBTYPE_SORT = "CASE subType WHEN 'reasoning' THEN 1 WHEN 'tool-call' THEN 2 WHEN 'tool-result' THEN 3 WHEN 'mcp-confirm' THEN 4 WHEN 'text' THEN 5 ELSE 0 END";

    @Select("<script>" +
            "SELECT * FROM t_agent_message " +
            "WHERE sessionId = #{sessionId} " +
            "<if test='beforeId != null'> AND id &lt; #{beforeId} </if>" +
            "ORDER BY createdTime DESC, " + SUBTYPE_SORT + " ASC LIMIT #{limit}" +
            "</script>")
    List<AgentMessage> selectByCursor(
            @Param("sessionId") String sessionId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Select("SELECT * FROM t_agent_message " +
            "WHERE sessionId = #{sessionId} " +
            "ORDER BY createdTime ASC, " + SUBTYPE_SORT + " ASC LIMIT #{limit}")
    List<AgentMessage> selectBySessionIdOrderByTimeASC(
            @Param("sessionId") String sessionId,
            @Param("limit") int limit);

    @Update("UPDATE t_agent_message SET isSummary = 1 " +
            "WHERE sessionId = #{sessionId} AND createdTime < #{summaryTime}")
    int markAsSummary(@Param("sessionId") String sessionId,
                     @Param("summaryTime") Date summaryTime);
}
