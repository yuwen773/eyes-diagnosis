package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import org.apache.ibatis.annotations.*;

import java.util.Date;
import java.util.List;

@Mapper
public interface AgentMessageMapper extends BaseMapper<AgentMessage> {

    // 只按 id 排序：写入由 SessionMessageQueue 按会话串行、id 单调递增，
    // id 序就是事件序。旧的「createdTime 主序 + subtype 次序」在秒级时间戳下
    // 会把同一秒的 reasoning/tool-call/tool-result 重新洗牌，且与游标
    // （id < beforeId）不一致——翻页会重复返回同一段。
    @Select("<script>" +
            "SELECT * FROM t_agent_message " +
            "WHERE sessionId = #{sessionId} " +
            "<if test='beforeId != null'> AND id &lt; #{beforeId} </if>" +
            "ORDER BY id DESC LIMIT #{limit} " +
            "</script>")
    List<AgentMessage> selectByCursor(
            @Param("sessionId") String sessionId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Select("SELECT * FROM t_agent_message " +
            "WHERE sessionId = #{sessionId} " +
            "ORDER BY id ASC LIMIT #{limit}")
    List<AgentMessage> selectBySessionIdOrderByTimeASC(
            @Param("sessionId") String sessionId,
            @Param("limit") int limit);

    @Update("UPDATE t_agent_message SET isSummary = 1 " +
            "WHERE sessionId = #{sessionId} AND createdTime < #{summaryTime}")
    int markAsSummary(@Param("sessionId") String sessionId,
                     @Param("summaryTime") Date summaryTime);
}
