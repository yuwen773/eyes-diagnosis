// Acceptance-only source, compiled outside src/. Never packaged or deployed.
import com.csust.eyediagnosis.EyeDiagnosisApplication;
import com.csust.eyediagnosis.agent.tools.DocumentSearchTool;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import org.springframework.ai.document.Document;
import org.springframework.ai.embedding.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.web.bind.annotation.*;

@Configuration(proxyBeanMethods = false)
@RestController
public class Issue19Probe {
    private final UserService users;
    private final DocumentSearchTool reader;

    public Issue19Probe(UserService users, DocumentSearchTool reader) {
        this.users = users;
        this.reader = reader;
    }
    public static void main(String[] args) {
        SpringApplication.run(new Class<?>[]{EyeDiagnosisApplication.class, Issue19Probe.class}, args);
    }

    // Uses the unchanged legacy reader and its actual ChromaVectorStore bean.
    // User identity comes from the real Java session, never query parameters.
    @GetMapping("/issue19/search")
    public String search(@RequestParam("query") String query, HttpServletRequest request) {
        return reader.searchDocuments(query, users.getLoginUser(request).getId());
    }

    @Bean
    @Primary
    @ConditionalOnProperty(name = "issue19.controlled-embedding", havingValue = "true")
    static EmbeddingModel controlledEmbedding() {
        return new EmbeddingModel() {
            public float[] embed(Document document) { return embed(document.getText()); }
            public EmbeddingResponse call(EmbeddingRequest request) {
                var results = new ArrayList<Embedding>();
                for (String text : request.getInstructions()) {
                    try {
                        byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
                        float[] vector = new float[8];
                        for (int i = 0; i < 8; i++) vector[i] = ((digest[i] & 255) + 1) / 256.0f;
                        results.add(new Embedding(vector, results.size()));
                    } catch (java.security.NoSuchAlgorithmException impossible) {
                        throw new IllegalStateException(impossible);
                    }
                }
                return new EmbeddingResponse(results);
            }
        };
    }
}
