# InferenceEnvelope and one Diagnose invocation

`Diagnose` is invoked only through `GrpcDiagnoseModelClient`. Its gRPC channel has an explicit finite deadline from `diagnosis.grpc.deadline-ms` and disables gRPC retries.

Before a worker invokes the model, it creates a unique `IMAGE_INFERENCE` invocation reservation in `t_workflow_node_execution`. The idempotency key is the workflow id, graph definition version, action version, literal `IMAGE_INFERENCE`, and inference epoch. A competing worker, or a retry that finds a reservation with no accepted Envelope, returns `RPC_OUTCOME_UNKNOWN`; it never sends another RPC for that epoch. This is at-most-once, not exactly-once: a crash after the RPC begins and before the Envelope commit fails closed.

`InferenceEnvelope` is the immutable snapshot shared by `ImageQualityAction` and `VisionExposureAction`. Its outcomes are mutually exclusive:

- `VALID_PREDICTION` has one validated prediction and a model fingerprint.
- `SAFETY_ABSTENTION` carries a controlled abstention reason and never a patient projection.
- `TECHNICAL_FAILURE` carries a controlled failure code and never creates review work.

OOD and low-confidence outcomes withhold all prediction projection fields. Quality routing reads only quality score, decision, and reason codes; it does not receive prediction values. A quality gate can additionally withhold a valid prediction.

`InferenceEnvelopeDeltaWriter` runs in PR-05's commit transaction. It inserts the immutable Envelope, completes the existing reservation, and CAS-attaches the Envelope id to the workflow. It does not call gRPC, choose graph successors, create jobs, or select workflow terminal status. The PR-05 commit coordinator alone creates any resume job.

New image data increments `inferenceEpoch` and may therefore reserve one new call. Retried jobs and quality-review resumption reuse the existing Envelope or fail closed. This design makes no claim of clinical validity. Evidence retrieval, source governance, and explanation remain deferred to PR-07/PR-08.
