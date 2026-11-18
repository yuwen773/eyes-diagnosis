package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentToolAudit;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface AgentToolAuditMapper extends BaseMapper<AgentToolAudit> {

    /** Owner-scoped: never accept a session/user pair from the caller without this filter. */
    @Select("SELECT * FROM t_agent_tool_audit WHERE sessionId = #{sessionId} AND userId = #{userId} "
            + "ORDER BY startedAt ASC, auditId ASC LIMIT #{limit}")
    List<AgentToolAudit> selectOwned(@Param("sessionId") String sessionId,
                                     @Param("userId") Long userId,
                                     @Param("limit") int limit);

    /** Aggregation by tool/status for an owner. No patient identifiers in the result. */
    @Select("SELECT toolName, toolStatus, COUNT(*) AS cnt FROM t_agent_tool_audit "
            + "WHERE sessionId = #{sessionId} AND userId = #{userId} "
            + "GROUP BY toolName, toolStatus ORDER BY toolName, toolStatus")
    List<java.util.Map<String, Object>> summarizeOwned(@Param("sessionId") String sessionId,
                                                       @Param("userId") Long userId);
}
