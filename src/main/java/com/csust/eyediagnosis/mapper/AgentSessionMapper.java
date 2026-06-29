package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import org.apache.ibatis.annotations.*;

import java.util.Date;
import java.util.List;

@Mapper
public interface AgentSessionMapper extends BaseMapper<AgentSession> {

    @Select("SELECT * FROM t_agent_session WHERE sessionId = #{sessionId} AND isDelete = 0")
    AgentSession selectBySessionId(@Param("sessionId") String sessionId);

    @Select("<script>" +
            "SELECT * FROM t_agent_session " +
            "WHERE userId = #{userId} AND isDelete = 0 " +
            "<if test='beforeId != null'> AND id &lt; #{beforeId} </if>" +
            "ORDER BY pinned DESC, CASE WHEN pinTime IS NULL THEN 1 ELSE 0 END ASC, pinTime ASC, updatedTime DESC LIMIT #{limit}" +
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

    @Update("UPDATE t_agent_session SET isDelete = 1, updatedTime = NOW() WHERE sessionId = #{sessionId}")
    int softDeleteBySessionId(@Param("sessionId") String sessionId);

    @Update("<script>" +
            "UPDATE t_agent_session SET isDelete = 1, updatedTime = NOW() WHERE sessionId IN " +
            "<foreach collection='sessionIds' item='id' open='(' separator=',' close=')'>" +
            "#{id}</foreach>" +
            "</script>")
    int batchSoftDelete(@Param("sessionIds") List<String> sessionIds);

    @Update("UPDATE t_agent_session SET title = #{title}, updatedTime = NOW() WHERE sessionId = #{sessionId}")
    int updateTitle(@Param("sessionId") String sessionId, @Param("title") String title);

    @Update("UPDATE t_agent_session SET pinned = #{pinned}, pinTime = #{pinTime}, updatedTime = NOW() WHERE sessionId = #{sessionId}")
    int updatePinStatus(@Param("sessionId") String sessionId, @Param("pinned") Integer pinned, @Param("pinTime") Date pinTime);
}