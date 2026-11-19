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
    /**
     * 只返回**当前选中版本**的回答行，以及全部用户行。
     *
     * <p>版本过滤必须发生在 SQL 里：若先取一页再在内存里过滤，LIMIT 已经被
     * 未显示的旧版本占满，翻页会看到空页、并把历史的条数算错。旧数据
     * （replyToId / selectedVariantId 为 null）保持原样全部可见。
     */
    @Select("<script>" +
            "SELECT m.* FROM t_agent_message m " +
            "LEFT JOIN t_agent_message u ON u.id = m.replyToId " +
            "WHERE m.sessionId = #{sessionId} " +
            "AND (m.replyToId IS NULL OR u.selectedVariantId IS NULL " +
            "     OR u.selectedVariantId = m.variantId) " +
            "<if test='beforeId != null'> AND m.id &lt; #{beforeId} </if>" +
            "ORDER BY m.id DESC LIMIT #{limit} " +
            "</script>")
    List<AgentMessage> selectByCursor(
            @Param("sessionId") String sessionId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Select("SELECT m.* FROM t_agent_message m " +
            "LEFT JOIN t_agent_message u ON u.id = m.replyToId " +
            "WHERE m.sessionId = #{sessionId} " +
            "AND (m.replyToId IS NULL OR u.selectedVariantId IS NULL " +
            "     OR u.selectedVariantId = m.variantId) " +
            "ORDER BY m.id ASC LIMIT #{limit}")
    List<AgentMessage> selectBySessionIdOrderByTimeASC(
            @Param("sessionId") String sessionId,
            @Param("limit") int limit);

    /** 会话里最后一条用户提问：客户端刚发完还没拿到 id 时，重新生成用它定位。 */
    @Select("SELECT id FROM t_agent_message WHERE sessionId = #{sessionId} AND role = 'USER' " +
            "ORDER BY id DESC LIMIT 1")
    Long selectLastUserMessageId(@Param("sessionId") String sessionId);

    /** 会话里每一轮的回答版本，按首次出现的 id 升序（= 生成顺序）。 */
    @Select("SELECT replyToId, variantId, MIN(id) AS firstId FROM t_agent_message " +
            "WHERE sessionId = #{sessionId} AND replyToId IS NOT NULL AND variantId IS NOT NULL " +
            "GROUP BY replyToId, variantId ORDER BY replyToId ASC, MIN(id) ASC")
    List<java.util.Map<String, Object>> selectVariants(@Param("sessionId") String sessionId);

    @Update("UPDATE t_agent_message SET isSummary = 1 " +
            "WHERE sessionId = #{sessionId} AND createdTime < #{summaryTime}")
    int markAsSummary(@Param("sessionId") String sessionId,
                     @Param("summaryTime") Date summaryTime);
}
