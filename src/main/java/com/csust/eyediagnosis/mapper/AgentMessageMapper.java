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

    /**
     * 指定几轮的回答版本，按首次出现的 id 升序（= 生成顺序）。
     *
     * <p>只查这一页里出现的轮次：整会话聚合会在每次翻页时重扫全部行，
     * 翻完一个大会话是 O(n²/limit) 次 GROUP BY。调用方保证传入的集合非空。
     */
    @Select("<script>SELECT replyToId, variantId, MIN(id) AS firstId FROM t_agent_message " +
            "WHERE sessionId = #{sessionId} AND replyToId IN " +
            "<foreach collection='replyToIds' item='id' open='(' separator=',' close=')'>#{id}</foreach> " +
            "AND variantId IS NOT NULL " +
            "GROUP BY replyToId, variantId ORDER BY replyToId ASC, MIN(id) ASC</script>")
    List<java.util.Map<String, Object>> selectVariants(
            @Param("sessionId") String sessionId, @Param("replyToIds") List<Long> replyToIds);

    /** 这一轮之后的下一轮用户提问 id；没有时返回 null（本回合是最后一轮）。 */
    @Select("SELECT MIN(id) FROM t_agent_message WHERE sessionId = #{sessionId} " +
            "AND role = 'USER' AND id > #{afterId}")
    Long selectNextUserMessageId(@Param("sessionId") String sessionId, @Param("afterId") long afterId);

    /**
     * 把升级前的回答行（replyToId/variantId 为 NULL）归入一个版本。
     *
     * <p>只补元数据、不动内容，且只落在「这一轮的用户消息之后、下一轮提问之前」，
     * 避免把别的回合一并改掉。已带版本的行走不到。
     */
    @Update("UPDATE t_agent_message SET replyToId = #{replyToId}, variantId = #{variantId} " +
            "WHERE sessionId = #{sessionId} AND role = 'ASSISTANT' " +
            "AND replyToId IS NULL AND id > #{afterId} AND id < #{beforeId}")
    int adoptLegacyAnswers(@Param("sessionId") String sessionId,
                           @Param("replyToId") long replyToId,
                           @Param("variantId") String variantId,
                           @Param("afterId") long afterId,
                           @Param("beforeId") long beforeId);

    /** 这一轮里还有没有未归版本的旧回答行（区间口径同上）。 */
    @Select("SELECT COUNT(*) FROM t_agent_message WHERE sessionId = #{sessionId} " +
            "AND role = 'ASSISTANT' AND replyToId IS NULL AND id > #{afterId} AND id < #{beforeId}")
    int countLegacyAnswers(@Param("sessionId") String sessionId,
                           @Param("afterId") long afterId,
                           @Param("beforeId") long beforeId);

    /**
     * 用户实际看得到的条数：隐藏的未选中版本不计入。
     *
     * <p>写入时每行都 +1，重新生成会让统计与可见内容脱节；版本切换（含
     * 生成正常收口）后重算一次，会话列表的条数与历史可见行保持一致。
     */
    @Select("SELECT COUNT(*) FROM t_agent_message m " +
            "LEFT JOIN t_agent_message u ON u.id = m.replyToId " +
            "WHERE m.sessionId = #{sessionId} " +
            "AND (m.replyToId IS NULL OR u.selectedVariantId IS NULL " +
            "     OR u.selectedVariantId = m.variantId)")
    int countVisibleMessages(@Param("sessionId") String sessionId);

    /** 最后一条可见消息的正文：与 {@link #countVisibleMessages} 同一口径。 */
    @Select("SELECT m.content FROM t_agent_message m " +
            "LEFT JOIN t_agent_message u ON u.id = m.replyToId " +
            "WHERE m.sessionId = #{sessionId} " +
            "AND (m.replyToId IS NULL OR u.selectedVariantId IS NULL " +
            "     OR u.selectedVariantId = m.variantId) " +
            "ORDER BY m.id DESC LIMIT 1")
    String selectLastVisibleContent(@Param("sessionId") String sessionId);

    @Update("UPDATE t_agent_message SET isSummary = 1 " +
            "WHERE sessionId = #{sessionId} AND createdTime < #{summaryTime}")
    int markAsSummary(@Param("sessionId") String sessionId,
                     @Param("summaryTime") Date summaryTime);
}
