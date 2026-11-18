package com.csust.eyediagnosis;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;

@SpringBootTest
// Stop scheduled workers before another application fixture uses the same CI schema.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class EyeDiagnosisApplicationTests {

    @Test
    void contextLoads() {
    }

}
