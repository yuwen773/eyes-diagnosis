package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import org.apache.ibatis.annotations.*;

@Mapper
public interface AgentSessionMapper extends BaseMapper<AgentSession> {

    @Select("SELECT * FROM t_agent_session WHERE sessionId = #{sessionId} AND isDelete = 0")
    AgentSession selectBySessionId(@Param("sessionId") String sessionId);

    @Select("<script>" +
            "SELECT * FROM t_agent_session " +
            "WHERE userId = #{userId} AND isDelete = 0 " +
            "<if test='beforeId != null'> AND id &lt; #{beforeId} </if>" +
            "ORDER BY updatedTime DESC LIMIT #{limit}" +
            "</script>")
    java.util.List<AgentSession> selectByUserIdCursor(
            @Param("userId") Long userId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Update("UPDATE t_agent_session SET messageCount = messageCount + 1, " +
            "lastMessage = #{lastMessage}, updatedTime = NOW() " +
            "WHERE sessionId = #{sessionId}")
    int updateMessageCount(@Param("sessionId") String sessionId,
                          @Param("lastMessage") String lastMessage);

    @Update("UPDATE t_agent_session SET checkpointData = #{checkpointData} " +
            "WHERE sessionId = #{sessionId}")
    int updateCheckpointData(@Param("sessionId") String sessionId,
                            @Param("checkpointData") byte[] checkpointData);

    @Update("UPDATE t_agent_session SET checkpointData = NULL " +
            "WHERE sessionId = #{sessionId}")
    int clearCheckpointData(@Param("sessionId") String sessionId);
}