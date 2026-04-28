package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import org.apache.ibatis.annotations.*;

@Mapper
public interface AgentSessionMapper extends BaseMapper<AgentSession> {

    @Select("SELECT * FROM t_agent_session WHERE session_id = #{sessionId} AND is_delete = 0")
    AgentSession selectBySessionId(@Param("sessionId") String sessionId);

    @Select("<script>" +
            "SELECT * FROM t_agent_session " +
            "WHERE user_id = #{userId} AND is_delete = 0 " +
            "<if test='beforeId != null'> AND id &lt; #{beforeId} </if>" +
            "ORDER BY pinned DESC, pin_time ASC, updated_time DESC LIMIT #{limit}" +
            "</script>")
    java.util.List<AgentSession> selectByUserIdCursor(
            @Param("userId") Long userId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Update("UPDATE t_agent_session SET message_count = message_count + 1, " +
            "last_message = #{lastMessage}, updated_time = NOW() " +
            "WHERE session_id = #{sessionId}")
    int updateMessageCount(@Param("sessionId") String sessionId,
                          @Param("lastMessage") String lastMessage);

    @Update("UPDATE t_agent_session SET checkpoint_data = #{checkpointData} " +
            "WHERE session_id = #{sessionId}")
    int updateCheckpointData(@Param("sessionId") String sessionId,
                            @Param("checkpointData") byte[] checkpointData);

    @Update("UPDATE t_agent_session SET checkpoint_data = NULL " +
            "WHERE session_id = #{sessionId}")
    int clearCheckpointData(@Param("sessionId") String sessionId);

    @Update("UPDATE t_agent_session SET is_delete = 1, updated_time = NOW() WHERE session_id = #{sessionId}")
    int softDeleteBySessionId(@Param("sessionId") String sessionId);

    @Update("<script>" +
            "UPDATE t_agent_session SET is_delete = 1, updated_time = NOW() WHERE session_id IN " +
            "<foreach collection='sessionIds' item='id' open='(' separator=',' close=')'>" +
            "#{id}</foreach>" +
            "</script>")
    int batchSoftDelete(@Param("sessionIds") List<String> sessionIds);

    @Update("UPDATE t_agent_session SET title = #{title}, updated_time = NOW() WHERE session_id = #{sessionId}")
    int updateTitle(@Param("sessionId") String sessionId, @Param("title") String title);

    @Update("UPDATE t_agent_session SET pinned = #{pinned}, pin_time = #{pinTime}, updated_time = NOW() WHERE session_id = #{sessionId}")
    int updatePinStatus(@Param("sessionId") String sessionId, @Param("pinned") Integer pinned, @Param("pinTime") Date pinTime);
}