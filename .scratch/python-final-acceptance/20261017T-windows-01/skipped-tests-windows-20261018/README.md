# Windows 原 43 项跳过测试补跑

结果：PASS；43/43 通过，0 失败，0 仍跳过。

保留原全量 829 通过/43 跳过，以及首轮 Nginx 5 通过/2 失败、MySQL 25 通过/11 准备错误；不将分次证据改写成一次全量执行。

修正旧登录必须去 Java 的测试断言，并加强三个登录态接口去向检查；应用实现未变。冻结版本解压失败路径为 263 字符，改用工作树内短临时目录后最长为 190 字符，压缩包 SHA256 一致；未改系统长路径设置、冻结 SQL、历史或 11 项恢复测试的断言。

使用已安装的原生 Windows Nginx、真实隔离 MySQL/Redis；后端标签、模型、资料和医生/保存决定均为合成夹具。没有运行 JVM、Linux、Docker/WSL，没有生产升级或切流。

临时进程已停止，测试库和短目录保留用于审计。原参与者 8 张业务表摘要不变，正式记录仍为 0；人工验收继续搁置，整体验收仍 BLOCKED。浏览器可选检查未运行，不计为实际人工 UI 证据。无新增供应商请求，累计 LLM 20/50、embedding 43/500。

## 逐项结果

| 原测试 | 原跳过条件 | 最新结果 | 最新证据 |
|---|---|---|---|
| `algorithm/web/tests/test_controlled_evidence.py::test_private_revocation_with_two_mysql_repeatable_read_connections` | isolated real MySQL URL not supplied | PASS | mysql.xml |
| `algorithm/web/tests/test_cutover_proxy.py::test_independent_routes_retain_python_state_and_cookie[java-java-pause]` | CUTOVER_NGINX required for real proxy tests | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_cutover_proxy.py::test_independent_routes_retain_python_state_and_cookie[python-java-pause]` | CUTOVER_NGINX required for real proxy tests | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_cutover_proxy.py::test_independent_routes_retain_python_state_and_cookie[python-python-active]` | CUTOVER_NGINX required for real proxy tests | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_cutover_proxy.py::test_independent_routes_retain_python_state_and_cookie[java-python-drain]` | CUTOVER_NGINX required for real proxy tests | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_database_handoff.py::test_mysql_handoff_and_repeat_preserve_legacy_history_and_data[empty]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_mysql_handoff_and_repeat_preserve_legacy_history_and_data[9]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_mysql_handoff_and_repeat_preserve_legacy_history_and_data[22]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_unknown_legacy_states_are_rejected_before_any_write[v8-V8_CHECKSUM]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_unknown_legacy_states_are_rejected_before_any_write[checksum-LEGACY_CHECKSUM]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_unknown_legacy_states_are_rejected_before_any_write[failed-FAILED_LEGACY_HISTORY]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_unknown_legacy_states_are_rejected_before_any_write[unknown-UNKNOWN_LEGACY_HISTORY]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_unknown_legacy_states_are_rejected_before_any_write[schema-SCHEMA]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_independent_increment_runs_once_without_changing_legacy_history` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_failed_nontransactional_ddl_is_not_replayed_or_marked_success` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_concurrent_upgrader_cannot_write` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_empty_python_history_is_an_interrupted_registration` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_unknown_schema_objects_are_not_treated_as_an_empty_database` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_applied_handoff_still_rejects_changed_original_history` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_interrupted_baseline_cannot_register_success_or_replay` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_stock_api_public_business_read_works_without_jvm[empty]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_stock_api_public_business_read_works_without_jvm[9]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_database_handoff.py::test_stock_api_public_business_read_works_without_jvm[22]` | Opt-in isolated real MySQL acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_handoff_recovery.py::test_four_human_waits_resume_after_database_handoff[quality]` | Opt-in isolated real MySQL handoff/restart acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_handoff_recovery.py::test_four_human_waits_resume_after_database_handoff[final]` | Opt-in isolated real MySQL handoff/restart acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_handoff_recovery.py::test_four_human_waits_resume_after_database_handoff[save]` | Opt-in isolated real MySQL handoff/restart acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_handoff_recovery.py::test_four_human_waits_resume_after_database_handoff[supplement]` | Opt-in isolated real MySQL handoff/restart acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_legacy_workflow_mysql.py::test_real_mysql_concurrent_rebuild_retries_commit_one_job_and_survive_restart` | Opt-in isolated local MySQL legacy acceptance | PASS | mysql.xml |
| `algorithm/web/tests/test_maintenance.py::test_maintenance_blocks_business_and_workflow_writes_but_allows_login_and_reads[legacy]` | CUTOVER_NGINX required for real Nginx admission checks | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_maintenance.py::test_maintenance_blocks_business_and_workflow_writes_but_allows_login_and_reads[python]` | CUTOVER_NGINX required for real Nginx admission checks | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_maintenance.py::test_active_python_routes_all_business_and_identity_to_python` | CUTOVER_NGINX required for real Nginx admission checks | PASS | nginx-recheck/nginx.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_frozen_wait_upgrade_real_login_and_process_restart[quality]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_frozen_wait_upgrade_real_login_and_process_restart[final]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_frozen_wait_upgrade_real_login_and_process_restart[save]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_frozen_wait_upgrade_real_login_and_process_restart[supplement]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_expired_save_survives_upgrade_without_formal_record` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_incompatible_wait_is_preserved_across_upgrade[graph_version]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_incompatible_wait_is_preserved_across_upgrade[graph_hash]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_incompatible_wait_is_preserved_across_upgrade[action_version]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_incompatible_wait_is_preserved_across_upgrade[supplement]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_mysql_resumed_wait_lease_fences_abandoned_worker[stale-executor]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_python_wait_recovery.py::test_mysql_resumed_wait_lease_fences_abandoned_worker[killed-executor]` | Opt-in ticket05 isolated real MySQL/Redis acceptance | PASS | recovery-recheck/recovery.xml |
| `algorithm/web/tests/test_worker_concurrency.py::test_mysql_claim_skips_locked_job_and_advances_other_task` | SKIP LOCKED requires real MySQL | PASS | mysql.xml |
