package com.csust.eyediagnosis.workflow.graph.registry;

import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.StandardFundusDiagnosisGraphV1;
import com.csust.eyediagnosis.workflow.graph.exception.GraphActionVersionMismatchException;
import com.csust.eyediagnosis.workflow.graph.exception.GraphDefinitionHashMismatchException;
import com.csust.eyediagnosis.workflow.graph.exception.UnsupportedGraphDefinitionVersionException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class InMemoryGraphDefinitionRegistryTest {
    private final GraphDefinitionHasher hasher = new Sha256GraphDefinitionHasher();
    private final DiagnosisGraphDefinition v1 = new StandardFundusDiagnosisGraphV1(hasher);

    @Test
    void requiresAnExactVersionAndExactBinding() {
        var registry = new InMemoryGraphDefinitionRegistry(List.of(v1), hasher);
        assertEquals(v1, registry.require("fundus-diagnosis-v1"));
        registry.verifyBinding(new GraphDefinitionBinding(v1.definitionVersion(), v1.definitionHash(), v1.actionVersion()));
        assertThrows(UnsupportedGraphDefinitionVersionException.class, () -> registry.require("fundus-diagnosis-v2"));
        assertThrows(GraphDefinitionHashMismatchException.class, () -> registry.verifyBinding(new GraphDefinitionBinding(v1.definitionVersion(), v1.definitionHash().toUpperCase(), v1.actionVersion())));
        assertThrows(GraphActionVersionMismatchException.class, () -> registry.verifyBinding(new GraphDefinitionBinding(v1.definitionVersion(), v1.definitionHash(), "diagnosis-actions-v2")));
    }

    @Test
    void rejectsDuplicateVersionAtConstructionAndExposesAnImmutableStableList() {
        assertThrows(IllegalArgumentException.class, () -> new InMemoryGraphDefinitionRegistry(List.of(v1, v1), hasher));
        var registry = new InMemoryGraphDefinitionRegistry(List.of(v1), hasher);
        assertThrows(UnsupportedOperationException.class, () -> registry.listSupported().clear());
    }
}
