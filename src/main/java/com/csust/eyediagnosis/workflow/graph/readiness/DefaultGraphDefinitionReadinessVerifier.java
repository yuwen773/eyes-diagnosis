package com.csust.eyediagnosis.workflow.graph.readiness;

import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.exception.GraphActionVersionMismatchException;
import com.csust.eyediagnosis.workflow.graph.exception.GraphDefinitionHashMismatchException;
import com.csust.eyediagnosis.workflow.graph.exception.GraphRuntimeNotReadyException;
import com.csust.eyediagnosis.workflow.graph.exception.UnsupportedGraphDefinitionVersionException;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.persistence.repository.ActiveWorkflowGraphBinding;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Set;
import java.util.TreeSet;

@Component
public class DefaultGraphDefinitionReadinessVerifier implements GraphDefinitionReadinessVerifier {
    private static final int MAX_AFFECTED_WORKFLOW_IDS = 20;
    private final DiagnosisWorkflowRepository repository;
    private final GraphDefinitionRegistry registry;

    public DefaultGraphDefinitionReadinessVerifier(DiagnosisWorkflowRepository repository, GraphDefinitionRegistry registry) {
        this.repository = repository;
        this.registry = registry;
    }

    @Override
    public GraphDefinitionReadinessReport verifyNonTerminalWorkflows() {
        var bindings = repository.findNonTerminalGraphBindings();
        Set<String> requiredVersions = new TreeSet<>();
        var affectedWorkflowIds = new ArrayList<String>();
        int unsupported = 0, hashMismatch = 0, actionMismatch = 0;
        for (ActiveWorkflowGraphBinding workflow : bindings) {
            requiredVersions.add(workflow.graphDefinitionVersion());
            try {
                registry.requireExecutableDefinition(new GraphDefinitionBinding(workflow.graphDefinitionVersion(), workflow.graphDefinitionHash(), workflow.actionVersion()));
            } catch (UnsupportedGraphDefinitionVersionException exception) {
                unsupported++; affectedWorkflowIds.add(workflow.workflowId());
            } catch (GraphDefinitionHashMismatchException exception) {
                hashMismatch++; affectedWorkflowIds.add(workflow.workflowId());
            } catch (GraphActionVersionMismatchException exception) {
                actionMismatch++; affectedWorkflowIds.add(workflow.workflowId());
            }
        }
        if (unsupported + hashMismatch + actionMismatch > 0) {
            throw new GraphRuntimeNotReadyException(unsupported, hashMismatch, actionMismatch,
                    affectedWorkflowIds.stream().sorted().limit(MAX_AFFECTED_WORKFLOW_IDS).toList());
        }
        return new GraphDefinitionReadinessReport(bindings.size(), requiredVersions);
    }
}
