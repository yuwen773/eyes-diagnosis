package com.csust.eyediagnosis.controlledreference;

import com.csust.eyediagnosis.agent.rag.Bm25Segmenter;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.function.Supplier;

/** Server-side evidence boundary. Ordinary chat RAG results are never eligibility proof. */
@Service
public class ControlledEvidenceRetriever {
    private static final String ELIGIBLE = "r.isDelete=0 AND r.enabled=1 AND r.isTest=0 AND r.visibility='CURATED_PUBLIC' AND r.reviewStatus='APPROVED'"
            + " AND JSON_CONTAINS(r.diseaseCodes,JSON_QUOTE(?)) AND JSON_CONTAINS(r.topicCodes,JSON_QUOTE(?))";
    private static final String SELECT_CITATION = "SELECT r.id,r.title,r.source,r.documentVersion,r.governanceVersion,r.reviewStatus,r.reviewedBy,c.chunkIndex,c.excerpt,c.excerptDigest"
            + " FROM t_controlled_reference r JOIN t_controlled_reference_chunk c ON c.documentId=r.id WHERE ";
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final Bm25Segmenter segmenter = new Bm25Segmenter();

    public ControlledEvidenceRetriever(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource()));
    }

    /** Disease and topic must come from the server-bound workflow scope, never model-supplied authority. */
    public List<Citation> retrieve(String diseaseCode, String topicCode, String query) {
        ControlledReferenceService.requireText(diseaseCode, 64);
        ControlledReferenceService.requireText(topicCode, 64);
        ControlledReferenceService.requireText(query, 2000);
        var terms = new HashSet<>(segmenter.tokenize(query));
        var candidates = jdbc.query(SELECT_CITATION + ELIGIBLE + " ORDER BY r.id,c.chunkIndex", this::mapCitation, diseaseCode, topicCode);
        return candidates.stream().filter(this::intact)
                .map(citation -> new Scored(citation, segmenter.tokenize(citation.excerpt()).stream().filter(terms::contains).count()))
                .filter(scored -> scored.score() > 0)
                .sorted(Comparator.comparingLong(Scored::score).reversed())
                .limit(5).map(Scored::citation).toList();
    }

    /**
     * Revalidates the exact frozen sources and keeps their rows locked until the consuming transaction finishes.
     * Publication/save callers must do their database write inside action, on the same DataSource.
     */
    public <T> T withValidatedEvidence(String diseaseCode, String topicCode, List<Citation> frozen, Supplier<T> action) {
        ControlledReferenceService.requireText(diseaseCode, 64);
        ControlledReferenceService.requireText(topicCode, 64);
        if (frozen == null || frozen.isEmpty() || frozen.stream().anyMatch(Objects::isNull)) throw new EvidenceUnavailable();
        return transactions.execute(status -> {
            // Stable lock ordering also covers citation sets spanning several documents.
            for (String id : frozen.stream().map(Citation::documentId).filter(Objects::nonNull).distinct().sorted().toList()) {
                jdbc.queryForList("SELECT id FROM t_controlled_reference WHERE id=? FOR UPDATE", id);
            }
            for (Citation citation : frozen) {
                var current = jdbc.query(SELECT_CITATION + ELIGIBLE + " AND r.id=? AND c.chunkIndex=? FOR UPDATE",
                        this::mapCitation, diseaseCode, topicCode, citation.documentId(), citation.chunkIndex());
                if (current.size() != 1 || !sameSource(citation, current.getFirst()) || !intact(current.getFirst())) {
                    throw new EvidenceUnavailable();
                }
            }
            return action.get();
        });
    }

    private boolean sameSource(Citation frozen, Citation current) {
        return Objects.equals(frozen.documentVersion(), current.documentVersion())
                && frozen.governanceVersion() == current.governanceVersion()
                && Objects.equals(frozen.excerpt(), current.excerpt())
                && Objects.equals(frozen.excerptDigest(), current.excerptDigest())
                && Objects.equals(frozen.title(), current.title()) && Objects.equals(frozen.source(), current.source())
                && Objects.equals(frozen.reviewStatus(), current.reviewStatus()) && Objects.equals(frozen.reviewedBy(), current.reviewedBy());
    }

    private boolean intact(Citation citation) {
        return citation.reviewedBy() != null && citation.documentVersion() != null && citation.documentVersion().matches("[0-9a-f]{64}")
                && Objects.equals(citation.excerptDigest(), ControlledReferenceService.digest(citation.excerpt().getBytes(StandardCharsets.UTF_8)));
    }

    private Citation mapCitation(ResultSet rs, int row) throws SQLException {
        return new Citation(rs.getString("id"), rs.getString("title"), rs.getString("source"), rs.getString("documentVersion"),
                rs.getLong("governanceVersion"), rs.getInt("chunkIndex"), rs.getString("excerpt"), rs.getString("excerptDigest"),
                rs.getString("reviewStatus"), rs.getObject("reviewedBy", Long.class), Instant.now());
    }

    public record Citation(String documentId, String title, String source, String documentVersion, long governanceVersion,
            int chunkIndex, String excerpt, String excerptDigest, String reviewStatus, Long reviewedBy, Instant retrievedAt) {}
    private record Scored(Citation citation, long score) {}
    public static class EvidenceUnavailable extends BusinessException {
        public EvidenceUnavailable() { super(ErrorCode.OPERATION_ERROR, "参考资料资格或冻结引用已失效"); }
    }
}
