package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import org.apache.ibatis.annotations.*;

import java.util.Date;
import java.util.List;

@Mapper
public interface AgentMessageMapper extends BaseMapper<AgentMessage> {

    @Select("<script>" +
            "SELECT * FROM t_agent_message " +
            "WHERE session_id = #{sessionId} " +
            "<if test='beforeId != null'> AND id < #{beforeId} </if>" +
            "ORDER BY created_time DESC LIMIT #{limit}" +
            "</script>")
    List<AgentMessage> selectByCursor(
            @Param("sessionId") String sessionId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Select("SELECT * FROM t_agent_message " +
            "WHERE session_id = #{sessionId} " +
            "ORDER BY created_time ASC LIMIT #{limit}")
    List<AgentMessage> selectBySessionIdOrderByTimeASC(
            @Param("sessionId") String sessionId,
            @Param("limit") int limit);

    @Select("SELECT * FROM t_agent_message " +
            "WHERE session_id = #{sessionId} " +
            "ORDER BY created_time DESC LIMIT #{limit}")
    List<AgentMessage> selectBySessionIdOrderByTimeDESC(
            @Param("sessionId") String sessionId,
            @Param("limit") int limit);

    @Update("UPDATE t_agent_message SET is_summary = 1 " +
            "WHERE session_id = #{sessionId} AND created_time < #{summaryTime}")
    int markAsSummary(@Param("sessionId") String sessionId,
                     @Param("summaryTime") Date summaryTime);
}