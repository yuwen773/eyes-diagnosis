package com.csust.eyediagnosis.mapper;

import com.csust.eyediagnosis.model.vo.stats.StatBucket;
import com.csust.eyediagnosis.model.vo.stats.StatDayCount;
import com.csust.eyediagnosis.model.vo.stats.StatDayNameCount;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Date;
import java.util.List;

/**
 * 管理端的统计查询。
 *
 * <p>仪表盘与数据分析要的读数都是「按维度分组计数」，用 MyBatis Plus 的
 * QueryWrapper 拼 select + groupBy 要写一堆字符串拼接，这里直接写成 SQL：
 * 列别名与 VO 属性同名（小驼峰），因为项目配置了 map-underscore-to-camel-case: false。
 *
 * <p>所有查询都显式带上 {@code isDelete = 0}：逻辑删除的记录不该进统计，
 * 否则「已删掉的数据」会继续出现在仪表盘上。
 */
public interface AdminStatsMapper {

    @Select("SELECT COUNT(*) FROM t_user WHERE isDelete = 0")
    long countUsers();

    @Select("SELECT COUNT(*) FROM t_user WHERE isDelete = 0 AND createTime >= #{from}")
    long countUsersSince(@Param("from") Date from);

    @Select("SELECT COUNT(*) FROM t_user WHERE isDelete = 0 AND userRole = 'admin'")
    long countAdmins();

    @Select("SELECT COUNT(*) FROM t_diagnosis WHERE isDelete = 0")
    long countDiagnoses();

    @Select("SELECT COUNT(*) FROM t_diagnosis WHERE isDelete = 0 AND createTime >= #{from}")
    long countDiagnosesSince(@Param("from") Date from);

    @Select("SELECT COUNT(*) FROM t_diagnosis WHERE isDelete = 0 AND createTime >= #{today}")
    long countDiagnosesToday(@Param("today") Date today);

    @Select("SELECT COUNT(*) FROM t_diagnosis WHERE isDelete = 0 AND createTime >= #{from} AND aiRejected = 1")
    long countAiRejectedSince(@Param("from") Date from);

    @Select("SELECT COUNT(*) FROM t_diagnosis WHERE isDelete = 0 AND createTime >= #{from} "
            + "AND humanReviewStatus = 'AWAITING_REVIEW'")
    long countAwaitingReviewSince(@Param("from") Date from);

    @Select("SELECT COUNT(*) FROM t_diagnosis WHERE isDelete = 0 AND createTime >= #{from} "
            + "AND humanReviewStatus IN ('REVIEWED', 'OVERRIDDEN')")
    long countReviewedSince(@Param("from") Date from);

    /** 平均置信度：没有结论的记录（NULL）不参与平均，无样本时返回 null。 */
    @Select("SELECT AVG(confidence) FROM t_diagnosis "
            + "WHERE isDelete = 0 AND createTime >= #{from} AND confidence IS NOT NULL")
    Double avgConfidenceSince(@Param("from") Date from);

    @Select("SELECT result AS name, COUNT(*) AS `value` FROM t_diagnosis "
            + "WHERE isDelete = 0 AND createTime >= #{from} AND result IS NOT NULL AND result <> '' "
            + "GROUP BY result ORDER BY `value` DESC LIMIT 12")
    List<StatBucket> diagnosisDistributionSince(@Param("from") Date from);

    @Select("SELECT humanReviewStatus AS name, COUNT(*) AS `value` FROM t_diagnosis "
            + "WHERE isDelete = 0 AND createTime >= #{from} "
            + "GROUP BY humanReviewStatus ORDER BY `value` DESC")
    List<StatBucket> reviewDistributionSince(@Param("from") Date from);

    @Select("SELECT DATE_FORMAT(createTime, '%Y-%m-%d') AS day, COUNT(*) AS `value` FROM t_diagnosis "
            + "WHERE isDelete = 0 AND createTime >= #{from} "
            + "GROUP BY DATE_FORMAT(createTime, '%Y-%m-%d') ORDER BY day")
    List<StatDayCount> diagnosisDailySince(@Param("from") Date from);

    @Select("SELECT DATE_FORMAT(createTime, '%Y-%m-%d') AS day, result AS name, COUNT(*) AS `value` "
            + "FROM t_diagnosis WHERE isDelete = 0 AND createTime >= #{from} "
            + "AND result IS NOT NULL AND result <> '' "
            + "GROUP BY DATE_FORMAT(createTime, '%Y-%m-%d'), result ORDER BY day, `value` DESC")
    List<StatDayNameCount> diagnosisDailyByResultSince(@Param("from") Date from);

    @Select("SELECT DATE_FORMAT(createTime, '%Y-%m-%d') AS day, COUNT(*) AS `value` FROM t_user "
            + "WHERE isDelete = 0 AND createTime >= #{from} "
            + "GROUP BY DATE_FORMAT(createTime, '%Y-%m-%d') ORDER BY day")
    List<StatDayCount> userDailySince(@Param("from") Date from);

    @Select("SELECT COUNT(*) FROM t_knowledge_document WHERE isDelete = 0")
    long countKnowledgeDocs();

    @Select("SELECT COALESCE(SUM(chunkCount), 0) FROM t_knowledge_document WHERE isDelete = 0")
    long sumKnowledgeChunks();

    @Select("SELECT status AS name, COUNT(*) AS `value` FROM t_knowledge_document "
            + "WHERE isDelete = 0 GROUP BY status ORDER BY `value` DESC")
    List<StatBucket> knowledgeByStatus();

    @Select("SELECT COUNT(*) FROM t_news WHERE isDelete = 0")
    long countNews();

    @Select("SELECT status AS name, COUNT(*) AS `value` FROM t_news "
            + "WHERE isDelete = 0 GROUP BY status ORDER BY `value` DESC")
    List<StatBucket> newsByStatus();
}
