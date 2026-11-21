import org.flywaydb.core.Flyway;
import java.nio.file.*;
import java.sql.*;
import java.security.MessageDigest;
import java.util.*;

/** Disposable MySQL backup/restore evidence; never accepts a production URL. */
public class IrisRollbackDataProbe {
    public static void main(String[] args) throws Exception {
        String container = args[0];
        if (!container.matches("iris-rc-final-[a-z-]+")) throw new IllegalArgumentException("Disposable container required");
        int port = Integer.parseInt(args[1]);
        Path output = Path.of(args[2]).toAbsolutePath();
        Files.createDirectories(output);
        String source = "diagnosis_ci_rollback_source", restored = "diagnosis_ci_rollback_restored";
        String url = "jdbc:mysql://127.0.0.1:" + port + "/?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC";
        try (Connection connection = DriverManager.getConnection(url, "root", ""); Statement sql = connection.createStatement()) {
            sql.executeUpdate("CREATE DATABASE " + source);
            sql.executeUpdate("CREATE DATABASE " + restored);
            try {
                flyway(url, source, "17").migrate();
                sql.executeUpdate("INSERT INTO " + source + ".t_user(id,userAccount,userPassword,userName,userRole) VALUES (7,'snapshot-updated','synthetic','before','user'),(8,'snapshot-deleted','synthetic','deleted','user')");
                Path dump = output.resolve("synthetic-v17.sql");
                Process backup = new ProcessBuilder("docker", "exec", container, "mysqldump", "-uroot", "--single-transaction", "--routines", "--triggers", source)
                        .redirectOutput(dump.toFile()).redirectError(output.resolve("dump-stderr.log").toFile()).start();
                if (backup.waitFor() != 0 || Files.size(dump) == 0) throw new AssertionError("Backup failed");
                System.out.println("BACKUP SHA256=" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(dump))));
                flyway(url, source, null).migrate();
                sql.executeUpdate("UPDATE " + source + ".t_user SET userName='after' WHERE id=7");
                sql.executeUpdate("DELETE FROM " + source + ".t_user WHERE id=8");
                sql.executeUpdate("INSERT INTO " + source + ".t_user(id,userAccount,userPassword,userName,userRole) VALUES(9,'post-backup-created','synthetic','new','user')");
                Process restore = new ProcessBuilder("docker", "exec", "-i", container, "mysql", "-uroot", restored)
                        .redirectInput(dump.toFile()).redirectError(output.resolve("restore-stderr.log").toFile()).start();
                if (restore.waitFor() != 0) throw new AssertionError("Actual backup restore failed");
                Map<Long,String> latest = rows(sql, source), recovered = rows(sql, restored);
                long inserted = latest.keySet().stream().filter(id -> !recovered.containsKey(id)).count();
                long deleted = recovered.keySet().stream().filter(id -> !latest.containsKey(id)).count();
                long updated = latest.entrySet().stream().filter(e -> recovered.containsKey(e.getKey()) && !e.getValue().equals(recovered.get(e.getKey()))).count();
                if (inserted != 1 || deleted != 1 || updated != 1) throw new AssertionError("Delta reconciliation failed");
                String current = flyway(url, source, null).info().current().getVersion().toString();
                String old = flyway(url, restored, "17").info().current().getVersion().toString();
                if (!"29".equals(current) || !"17".equals(old)) throw new AssertionError("Migration history mismatch");
                System.out.println("RESTORE sourceVersion=" + current + " restoredVersion=" + old + " actualDumpRestore=true");
                System.out.println("RECONCILIATION table=t_user inserted=" + inserted + " updated=" + updated + " deleted=" + deleted + " equalRowCount=" + (latest.size() == recovered.size()));
                System.out.println("PASS: equal row counts conceal changes; restored deleted row must not regain authorization; no cutover permitted");
            } finally {
                sql.executeUpdate("DROP DATABASE " + source);
                sql.executeUpdate("DROP DATABASE " + restored);
            }
        }
    }
    private static Flyway flyway(String url, String schema, String target) {
        var config = Flyway.configure().dataSource(url, "root", "").schemas(schema)
                .locations("classpath:db/migration", "classpath:db/callback");
        if (target != null) config.target(target);
        return config.load();
    }
    private static Map<Long,String> rows(Statement sql, String schema) throws Exception {
        Map<Long,String> rows = new TreeMap<>();
        try (ResultSet result = sql.executeQuery("SELECT id,userAccount,userPassword,userName,userRole,isDelete FROM " + schema + ".t_user ORDER BY id")) {
            while (result.next()) rows.put(result.getLong(1), result.getString(2) + "|" + result.getString(3) + "|" + result.getString(4) + "|" + result.getString(5) + "|" + result.getInt(6));
        }
        return rows;
    }
}
