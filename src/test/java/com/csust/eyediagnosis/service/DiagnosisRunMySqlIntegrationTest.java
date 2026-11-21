package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.mapper.DiagnosisRunMapper;
import com.csust.eyediagnosis.model.entity.DiagnosisRun;
import com.csust.eyediagnosis.service.impl.DiagnosisRunServiceImpl;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「取消判读」仲裁点的真实 MySQL 门禁。
 *
 * <p>取消与落库是两条并发路径，胜负**只能**由数据库的条件更新决定——把它写成
 * 「先 select 再 update」在小流量下永远看着是对的，压力一上来就把取消掉的判读
 * 落进了医疗记录表。这里在真 MySQL 上验证：
 * <ul>
 *   <li>PENDING 只能被 claim 或 cancel 中的一个抢到；</li>
 *   <li>一旦 DONE，cancel 拿不到，状态不被覆盖；</li>
 *   <li>一旦 CANCELLED，claim 拿不到；</li>
 *   <li>同一 runId 重复登记被唯一键挡住，且不覆盖已有状态。</li>
 * </ul>
 *
 * <p>需要 {@code FLYWAY_TEST_URL} / {@code FLYWAY_TEST_USERNAME} /
 * {@code FLYWAY_TEST_PASSWORD}；未设置时整类跳过。使用一次性 schema，跑完删除。
 */
class DiagnosisRunMySqlIntegrationTest {

    private static final long USER_A = 9_999_981L;
    private static final long USER_B = 9_999_982L;

    private static String schema;
    private static SqlSessionTemplate mappers;
    private static JdbcTemplate admin;
    private static JdbcTemplate jdbc;
    private static DriverManagerDataSource dataSource;

    /**
     * 未配置数据库时，让**每个**用例各自 skip（而不是整类 abort）。
     *
     * <p>{@code @BeforeAll} 里的 {@code Assumptions} 会让 Surefire 报
     * “Tests run: 0, Skipped: 0”，{@code check_surefire_skips.py} 就看不到这些用例，
     * 门禁形同虚设；放在 {@code @BeforeEach} 里才会如实记成 skipped。
     * 建库与迁移只在第一个用例时做一次。
     */
    @BeforeEach
    void clean() {
        Assumptions.assumeTrue(System.getenv("FLYWAY_TEST_URL") != null
                        && !System.getenv("FLYWAY_TEST_URL").isBlank(),
                "Set FLYWAY_TEST_URL to run the real diagnosis-run cancellation gate");
        ensureDatabase();
        jdbc.execute("DELETE FROM t_diagnosis_run");
    }

    private static synchronized void ensureDatabase() {
        if (jdbc != null) {
            return;
        }
        String url = System.getenv("FLYWAY_TEST_URL");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        schema = "diagnosis_ci_run_" + UUID.randomUUID().toString().replace("-", "");

        admin = new JdbcTemplate(new DriverManagerDataSource(url, username, password));
        admin.execute("CREATE DATABASE `" + schema + "`");

        dataSource = new DriverManagerDataSource(withSchema(url, schema), username, password);
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration", "classpath:db/callback")
                .load()
                .migrate();
        jdbc = new JdbcTemplate(dataSource);

        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.setMapUnderscoreToCamelCase(false);
        configuration.addMapper(DiagnosisRunMapper.class);
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        factory.setConfiguration(configuration);
        try {
            mappers = new SqlSessionTemplate(factory.getObject());
        } catch (Exception e) {
            throw new IllegalStateException("cannot build the MyBatis-Plus session for this gate", e);
        }
    }

    @AfterAll
    static void tearDownAll() {
        if (schema == null || admin == null) {
            return;
        }
        admin.execute("DROP DATABASE IF EXISTS `" + schema + "`");
    }

    @Test
    void theMigrationCreatedTheRunTable() {
        Integer tables = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = 't_diagnosis_run'",
                Integer.class, schema);
        assertEquals(1, tables, "V31 必须真的建出 t_diagnosis_run");
    }

    @Test
    void claimWinsExactlyOnce() {
        service().begin("run-claim", USER_A);

        assertTrue(service().claim("run-claim"), "第一次 claim 必须赢");
        assertFalse(service().claim("run-claim"), "DONE 之后不能再被 claim");
        assertEquals(DiagnosisRun.DONE, statusOf("run-claim"));
    }

    @Test
    void cancelAfterCompletionReportsAlreadyFinishedAndKeepsTheResult() {
        service().begin("run-done", USER_A);
        service().claim("run-done");
        service().attachDiagnosis("run-done", 4242L);

        assertEquals(DiagnosisRunService.CancelOutcome.ALREADY_FINISHED,
                service().cancel("run-done", USER_A));
        assertEquals(DiagnosisRun.DONE, statusOf("run-done"), "取消了也不能把一个已生成的医疗记录改成 CANCELLED");
        assertEquals(4242L, diagnosisIdOf("run-done"));
    }

    @Test
    void cancelBeforeClaimMakesTheCommitImpossible() {
        service().begin("run-cancel", USER_A);

        assertEquals(DiagnosisRunService.CancelOutcome.CANCELLED, service().cancel("run-cancel", USER_A));
        assertFalse(service().claim("run-cancel"), "取消赢了之后不能再落库");
        assertEquals(DiagnosisRun.CANCELLED, statusOf("run-cancel"));
    }

    @Test
    void cancellingSomeoneElsesRunLooksLikeItDoesNotExist() {
        service().begin("run-foreign", USER_A);

        assertEquals(DiagnosisRunService.CancelOutcome.NOT_FOUND, service().cancel("run-foreign", USER_B));
        assertEquals(DiagnosisRun.PENDING, statusOf("run-foreign"), "别人的取消不能改动本次运行");
    }

    @Test
    void theSameRunIdCannotBeRegisteredTwice() {
        service().begin("run-duplicate", USER_A);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service().begin("run-duplicate", USER_A));
        assertTrue(ex.getMessage().contains("正在进行中"), "重复登记要如实说明原因，实际: " + ex.getMessage());
        assertEquals(DiagnosisRun.PENDING, statusOf("run-duplicate"));
        assertEquals(1, runCount("run-duplicate"), "唯一键必须把重复行挡在门外");
    }

    @Test
    void anotherUserCannotHijackTheRunId() {
        service().begin("run-owned", USER_A);

        assertThrows(BusinessException.class, () -> service().begin("run-owned", USER_B));
        assertEquals(1, runCount("run-owned"));
    }

    /**
     * 真并发：同一瞬间一个 claim、一个 cancel。数据库只能让其中一个赢，
     * 且最终状态必须与赢家一致——不能出现「claim 返回 false 但状态是 DONE」。
     */
    @Test
    void concurrentClaimAndCancelHaveExactlyOneWinner() throws Exception {
        for (int round = 0; round < 20; round++) {
            String runId = "run-race-" + round;
            service().begin(runId, USER_A);

            CountDownLatch start = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                Future<Boolean> claimed = pool.submit(race(start, () -> service().claim(runId)));
                Future<DiagnosisRunService.CancelOutcome> cancelled = pool.submit(
                        race(start, () -> service().cancel(runId, USER_A)));
                start.countDown();

                boolean claimWon = claimed.get();
                DiagnosisRunService.CancelOutcome cancelOutcome = cancelled.get();

                assertTrue(claimWon ^ (cancelOutcome == DiagnosisRunService.CancelOutcome.CANCELLED),
                        "必须恰好一个赢：claim=" + claimWon + " cancel=" + cancelOutcome);
                assertEquals(claimWon ? DiagnosisRun.DONE : DiagnosisRun.CANCELLED, statusOf(runId));
            } finally {
                pool.shutdownNow();
            }
        }
    }

    // --- helpers -----------------------------------------------------------

    /**
     * 把连接串指到一次性 schema 上。
     *
     * <p>不假设 `FLYWAY_TEST_URL` 一定带库名：`jdbc:mysql://host:3307/?...` 这种写法
     * 用正则替换会**静默地什么都不做**，然后在「没有选中库」的连接上跑出满屏错误。
     */
    private static String withSchema(String url, String schema) {
        int query = url.indexOf('?');
        String base = query < 0 ? url : url.substring(0, query);
        String params = query < 0 ? "" : url.substring(query);
        int slash = base.lastIndexOf('/');
        return base.substring(0, slash + 1) + schema + params;
    }

    private static DiagnosisRunService service() {
        return new DiagnosisRunServiceImpl(mappers.getMapper(DiagnosisRunMapper.class));
    }

    private static String statusOf(String runId) {
        return jdbc.queryForObject("SELECT status FROM t_diagnosis_run WHERE runId = ?", String.class, runId);
    }

    private static long diagnosisIdOf(String runId) {
        Long id = jdbc.queryForObject("SELECT diagnosisId FROM t_diagnosis_run WHERE runId = ?", Long.class, runId);
        return id == null ? -1L : id;
    }

    private static int runCount(String runId) {
        List<String> rows = jdbc.queryForList(
                "SELECT runId FROM t_diagnosis_run WHERE runId = ?", String.class, runId);
        return rows.size();
    }

    private static <T> Callable<T> race(CountDownLatch start, Callable<T> body) {
        return () -> {
            start.await();
            return body.call();
        };
    }
}
