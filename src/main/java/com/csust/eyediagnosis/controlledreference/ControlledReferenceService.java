package com.csust.eyediagnosis.controlledreference;

import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.entity.User;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class ControlledReferenceService {
    private final JdbcTemplate jdbc;
    private final DocumentParser parser;
    private final TextChunkerService chunker;
    private final ObjectMapper json;
    private final TransactionTemplate transactions;

    public ControlledReferenceService(JdbcTemplate jdbc, DocumentParser parser, TextChunkerService chunker, ObjectMapper json) {
        this.jdbc = jdbc;
        this.parser = parser;
        this.chunker = chunker;
        this.json = json;
        this.transactions = new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource()));
    }

    public Reference upload(User actor, MultipartFile file, String title, String source, boolean isTest) {
        requireRole(actor, "admin");
        requireText(title, 200);
        requireText(source, 1024);
        String name = file == null ? null : file.getOriginalFilename();
        requireText(name, 255);
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (!Set.of("pdf", "doc", "docx", "txt", "md", "markdown").contains(extension)
                || file.isEmpty() || file.getSize() > 5 * 1024 * 1024) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请上传不超过 5 MB 的 PDF、Word 或文本资料");
        }
        Path temporary = null;
        try {
            byte[] bytes = file.getBytes();
            temporary = Files.createTempFile("controlled-reference-", "." + extension);
            Files.write(temporary, bytes);
            String content = parser.fetchContent(temporary.toString());
            requireText(content, 200_000);
            var chunks = chunker.chunk(content, Map.of());
            String id = UUID.randomUUID().toString();
            return transactions.execute(status -> {
                jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,diseaseCodes,topicCodes,uploadedBy) VALUES (?,?,?,?,?,?,?,JSON_ARRAY(),JSON_ARRAY(),?)",
                        id, title.trim(), source.trim(), name, digest(bytes), bytes, isTest, actor.getId());
                for (int i = 0; i < chunks.size(); i++) {
                    String text = chunks.get(i).getText();
                    jdbc.update("INSERT INTO t_controlled_reference_chunk (documentId,chunkIndex,excerpt,excerptDigest) VALUES (?,?,?,?)",
                            id, i, text, digest(text.getBytes(StandardCharsets.UTF_8)));
                }
                return reference(id);
            });
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "资料解析或存储失败");
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); }
                catch (java.io.IOException e) { throw new IllegalStateException("Cannot remove temporary reference file", e); }
            }
        }
    }

    public ReferencePage list(User actor, int page, int pageSize) {
        requireManager(actor);
        if (page < 1 || page > 100_000 || pageSize < 1 || pageSize > 100) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        var records = jdbc.query("SELECT * FROM t_controlled_reference WHERE isDelete=0 ORDER BY createdAt DESC,id LIMIT ? OFFSET ?",
                this::mapReference, pageSize, (page - 1) * pageSize);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM t_controlled_reference WHERE isDelete=0", Long.class);
        return new ReferencePage(records, total == null ? 0 : total);
    }

    public Detail detail(User actor, String id) {
        requireManager(actor);
        return new Detail(reference(id), jdbc.query("SELECT * FROM t_controlled_reference_chunk WHERE documentId=? ORDER BY chunkIndex",
                (rs, row) -> new Chunk(rs.getInt("chunkIndex"), rs.getString("excerpt"), rs.getString("excerptDigest")), id));
    }

    public byte[] originalFile(User actor, String id) {
        requireManager(actor);
        reference(id);
        return jdbc.queryForObject("SELECT fileContent FROM t_controlled_reference WHERE id=? AND isDelete=0", byte[].class, id);
    }

    public Reference govern(User actor, String id, Governance request) {
        requireRole(actor, "evidence_reviewer");
        if (request == null || request.expectedGovernanceVersion() < 1
                || !Set.of("PENDING", "APPROVED", "WITHDRAWN").contains(request.reviewStatus() == null ? "" : request.reviewStatus())
                || !Set.of("PRIVATE_USER", "CURATED_PUBLIC").contains(request.visibility() == null ? "" : request.visibility())) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        requireText(request.note(), 2000);
        validateCodes(request.diseaseCodes());
        validateCodes(request.topicCodes());
        if ("APPROVED".equals(request.reviewStatus()) && (!request.domainReviewed()
                || request.diseaseCodes().isEmpty() || request.topicCodes().isEmpty())) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "批准前须完成领域审核并指定疾病和主题范围");
        }
        return transactions.execute(status -> {
            Reference current = reference(id);
            if ("APPROVED".equals(request.reviewStatus()) && current.uploadedBy() == actor.getId()) {
                throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "上传人员不能审核自己的资料");
            }
            int changed = jdbc.update("UPDATE t_controlled_reference SET visibility=?,reviewStatus=?,diseaseCodes=?,topicCodes=?,enabled=?,reviewNote=?,reviewedBy=?,reviewedAt=CURRENT_TIMESTAMP(6),governanceVersion=governanceVersion+1 WHERE id=? AND isDelete=0 AND governanceVersion=?",
                    request.visibility(), request.reviewStatus(), writeCodes(request.diseaseCodes()), writeCodes(request.topicCodes()),
                    request.enabled(), request.note().trim(), actor.getId(), id, request.expectedGovernanceVersion());
            if (changed != 1) throw new GovernanceConflict();
            return reference(id);
        });
    }

    public void delete(User actor, String id, long expectedGovernanceVersion) {
        requireRole(actor, "admin");
        if (expectedGovernanceVersion < 1) throw new BusinessException(ErrorCode.PARAMS_ERROR);
        int changed = jdbc.update("UPDATE t_controlled_reference SET isDelete=1,governanceVersion=governanceVersion+1 WHERE id=? AND isDelete=0 AND governanceVersion=?",
                id, expectedGovernanceVersion);
        if (changed != 1) throw new GovernanceConflict();
    }

    private static void validateCodes(List<String> codes) {
        if (codes == null || codes.size() > 32 || codes.stream().anyMatch(code -> code == null || code.isBlank()
                || code.length() > 64 || !code.equals(code.trim())) || codes.stream().distinct().count() != codes.size()) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
    }

    private String writeCodes(List<String> codes) {
        try { return json.writeValueAsString(codes); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private Reference reference(String id) {
        var rows = jdbc.query("SELECT * FROM t_controlled_reference WHERE id=? AND isDelete=0", this::mapReference, id);
        if (rows.isEmpty()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        return rows.getFirst();
    }

    private Reference mapReference(ResultSet rs, int row) throws SQLException {
        return new Reference(rs.getString("id"), rs.getString("title"), rs.getString("source"), rs.getString("fileName"),
                rs.getString("documentVersion"), rs.getLong("governanceVersion"), rs.getBoolean("isTest"),
                rs.getString("visibility"), rs.getString("reviewStatus"), readCodes(rs.getString("diseaseCodes")),
                readCodes(rs.getString("topicCodes")), rs.getBoolean("enabled"), rs.getLong("uploadedBy"),
                rs.getObject("reviewedBy", Long.class), rs.getObject("reviewedAt", LocalDateTime.class), rs.getString("reviewNote"));
    }

    private List<String> readCodes(String value) {
        try { return json.readValue(value, new TypeReference<List<String>>() {}); }
        catch (Exception e) { throw new IllegalStateException("Invalid reference scope", e); }
    }

    static void requireRole(User actor, String role) {
        if (actor == null || actor.getId() == null) throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        if (!role.equals(actor.getUserRole())) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }

    private static void requireManager(User actor) {
        if (actor != null && "admin".equals(actor.getUserRole())) requireRole(actor, "admin");
        else requireRole(actor, "evidence_reviewer");
    }

    static void requireText(String text, int maxLength) {
        if (text == null || text.isBlank() || text.length() > maxLength) throw new BusinessException(ErrorCode.PARAMS_ERROR);
    }

    static String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    public record Reference(String id, String title, String source, String fileName, String documentVersion,
            long governanceVersion, boolean isTest, String visibility, String reviewStatus, List<String> diseaseCodes,
            List<String> topicCodes, boolean enabled, long uploadedBy, Long reviewedBy, LocalDateTime reviewedAt, String reviewNote) {}
    public record Chunk(int chunkIndex, String excerpt, String excerptDigest) {}
    public record Detail(Reference reference, List<Chunk> chunks) {}
    public record ReferencePage(List<Reference> records, long total) {}
    public record Governance(long expectedGovernanceVersion, String reviewStatus, String visibility,
            List<String> diseaseCodes, List<String> topicCodes, boolean enabled, boolean domainReviewed, String note) {}
    public static class GovernanceConflict extends RuntimeException {}
}
