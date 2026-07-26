package com.csust.eyediagnosis.workflow.persistence;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import java.sql.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowPersistenceMysqlIT {
 @Test void migratesMysql8AndEnforcesWorkflowPersistenceContracts() throws Exception {
  String url=System.getenv("WORKFLOW_IT_MYSQL_URL"), user=System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), password=System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
  Assumptions.assumeTrue(url!=null&&!url.isBlank()&&user!=null&&!user.isBlank()&&password!=null,"Set all WORKFLOW_IT_MYSQL_* variables");
  Flyway flyway=Flyway.configure().dataSource(url,user,password).locations("classpath:db/migration","classpath:db/callback").load();
  assertEquals(12,flyway.migrate().migrationsExecuted); assertEquals(0,flyway.migrate().migrationsExecuted);
  try(Connection c=DriverManager.getConnection(url,user,password); Statement s=c.createStatement()) {
   try(ResultSet r=s.executeQuery("select version()")){assertTrue(r.next());assertTrue(r.getString(1).startsWith("8."));}
   s.execute("insert into t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) values('it-w',1,'it-k','CREATED','v','h','a','NONE','NOT_AVAILABLE')");
   assertThrows(SQLException.class,()->s.execute("insert into t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) values('it-w2',1,'it-k','CREATED','v','h','a','NONE','NOT_AVAILABLE')"));
   assertEquals(1,s.executeUpdate("update t_diagnosis_workflow set status='QUEUED',workflowVersion=workflowVersion+1 where workflowId='it-w' and workflowVersion=0")); assertEquals(0,s.executeUpdate("update t_diagnosis_workflow set status='RUNNING',workflowVersion=workflowVersion+1 where workflowId='it-w' and workflowVersion=0"));
   s.execute("insert into t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,actorType,workflowVersion) values('it-e','it-w',1,'X','SYSTEM',0)"); assertThrows(SQLException.class,()->s.execute("insert into t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,actorType,workflowVersion) values('it-e2','it-w',1,'X','SYSTEM',0)"));
   s.execute("insert into t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,maxAttempts) values('it-j','it-w','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',1)"); assertThrows(SQLException.class,()->s.execute("insert into t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,maxAttempts) values('it-j2','it-w','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',1)"));
   s.execute("insert into t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status) values('it-n','it-w',0,'INTAKE_INFERENCE_QUALITY','N','it-i','DONE')"); assertThrows(SQLException.class,()->s.execute("insert into t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status) values('it-n2','it-w',0,'INTAKE_INFERENCE_QUALITY','N','it-i','DONE')"));
   s.execute("insert into t_inference_envelope(inferenceEnvelopeId,workflowId,inferenceEpoch,imageObjectReference,inputDigest,qualityOutcome,qualityScore,inferenceOutcomeType,modelVersion,modelWeightFingerprint,inferredAt) values('it-i','it-w',0,'o','d','PASS',100,'VALID_PREDICTION','m','f',CURRENT_TIMESTAMP(6))"); assertThrows(SQLException.class,()->s.execute("insert into t_inference_envelope(inferenceEnvelopeId,workflowId,inferenceEpoch,imageObjectReference,inputDigest,qualityOutcome,qualityScore,inferenceOutcomeType,modelVersion,modelWeightFingerprint,inferredAt) values('it-i2','it-w',0,'o','d','PASS',100,'VALID_PREDICTION','m','f',CURRENT_TIMESTAMP(6))"));
   s.execute("insert into t_diagnosis_citation(citationId,workflowId,retrievalEpoch,sourceDocumentId,sourceRevision,visibilitySnapshot,reviewStatusSnapshot,quotedSpan,quotedSpanDigest,retrievedAt) values('it-c','it-w',0,'d','r','VISIBLE','OK','q','qd',CURRENT_TIMESTAMP(6))"); assertThrows(SQLException.class,()->s.execute("insert into t_diagnosis_citation(citationId,workflowId,retrievalEpoch,sourceDocumentId,sourceRevision,visibilitySnapshot,reviewStatusSnapshot,quotedSpan,quotedSpanDigest,retrievedAt) values('it-c2','it-w',0,'d','r','VISIBLE','OK','q','qd',CURRENT_TIMESTAMP(6))"));
   String longText="x".repeat(20000); try(PreparedStatement p=c.prepareStatement("insert into t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot) values('it-x','it-w',1,'DRAFT',?)")){p.setString(1,longText);p.executeUpdate();} try(ResultSet r=s.executeQuery("select contentSnapshot from t_explanation_snapshot where explanationSnapshotId='it-x'")){assertTrue(r.next());assertEquals(longText,r.getString(1));}
   assertThrows(SQLException.class,()->s.execute("insert into t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot) values('it-x2','it-w',1,'DRAFT','x')"));
   s.execute("insert into t_human_review_task(reviewTaskId,workflowId,reviewType,reviewRound,status) values('it-r','it-w','IMAGE_QUALITY_GATE',1,'OPEN')"); assertEquals(1,s.executeUpdate("update t_human_review_task set status='CLAIMED',taskVersion=taskVersion+1 where reviewTaskId='it-r' and taskVersion=0")); assertEquals(0,s.executeUpdate("update t_human_review_task set status='DONE',taskVersion=taskVersion+1 where reviewTaskId='it-r' and taskVersion=0"));
  }
 }
}
