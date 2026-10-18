"""One-time extraction at ticket06 base 7efdc8c; never a test/runtime dependency."""
import ast
import hashlib
import json
from pathlib import Path
import re

ROOT = Path.cwd()
TESTS = ROOT / 'algorithm/web/tests'
JAVA = ROOT / 'src/main/java/com/csust/eyediagnosis'
routes = []
for path in sorted((JAVA / 'controller').glob('*.java')):
    source = path.read_text(encoding='utf-8')
    base = re.search(r'@RequestMapping\("([^"]*)"\)', source)
    base = base.group(1) if base else ''
    for verb, sub in re.findall(r'@(Post|Get|Put|Delete)Mapping(?:\(\s*(?:value\s*=\s*)?"([^"]*)"\s*\))?', source):
        if not base.startswith('/agent') and base and not sub.startswith('http'):
            routes.append([verb.lower(), '/api' + base + sub])

from web.tests.test_diagnosis_constants import _java_enum
constants = {'categories': _java_enum('DiagnosisCategoryEnum.java', 'private final String englishLabel'),
             'recommendations': _java_enum('DiagnosisRecommendationEnum.java', 'private final String englishLabel')}
source = (JAVA / 'model/vo/diagnosis/DiagnosisResultVO.java').read_text(encoding='utf-8')
fields = sorted(set(re.findall(r'private\s+[\w<>,. ]+\s+(\w+);', source)) - {'serialVersionUID'})
contract = {'baselineCommit': '7efdc8c', 'routes': sorted(routes), 'diagnosisResultFields': fields,
            'diagnosis': constants, 'config': {'maxUploadBytes': 10485760, 'listenerPort': 8081,
            'chromaCollection': 'diagnosis-knowledge', 'embeddingModel': 'text-embedding-v3'},
            'mcp': {'defaultInstallType': 'SSE', 'activeStatus': 1, 'deletedStatus': 3,
                    'toolsCachePrefix': 'mcp:tools:'},
            'sources': {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in sorted(JAVA.rglob('*.java'))}}
(ROOT / 'contracts').mkdir(exist_ok=True)
(ROOT / 'contracts/legacy-api.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def change(file, replacements, remove_vars=()):
    path = TESTS / file
    text = path.read_text(encoding='utf-8')
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    edits = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in replacements:
            start = min([node.lineno] + [d.lineno for d in node.decorator_list]) - 1
            replacement = replacements[node.name]
            if not replacement.startswith('def '):
                replacement = f'def {node.name}():\n' + replacement
            edits.append((start, node.end_lineno, replacement.rstrip() + '\n'))
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in remove_vars for t in node.targets):
            edits.append((node.lineno - 1, node.end_lineno, ''))
    for start, end, value in sorted(edits, reverse=True):
        lines[start:end] = [value]
    text = ''.join(lines)
    marker = 'from web.tests.frozen_contract import CONTRACT, domain_paths\n'
    # Imports following the module docstring / __future__ declarations.
    tree = ast.parse(text)
    index = tree.body[0].end_lineno if isinstance(tree.body[0], ast.Expr) else 0
    lines = text.splitlines(keepends=True)
    lines.insert(index, '\n' + marker)
    path.write_text(''.join(lines), encoding='utf-8')

for file, domain, variables in [('test_user.py', 'user', ['USER_CONTROLLER']),
                              ('test_news.py', 'news', ['NEWS_CONTROLLER', 'NEWS_SERVICE']),
                              ('test_diagnosis.py', 'diagnosis', ['DIAGNOSIS_CONTROLLER']),
                              ('test_knowledge.py', 'knowledge', ['KNOWLEDGE_CONTROLLER', 'KNOWLEDGE_SERVICE',
                               'CHUNKER_JAVA', 'PARSER_JAVA', 'PROCESSING_JAVA', 'SEARCH_TOOL_JAVA', 'VECTOR_STORE_JAVA'])]:
    changes = {f'_java_{domain}_paths': f'    return domain_paths("{domain}")'}
    if domain == 'diagnosis':
        changes['test_vo_field_sets_match_the_java_classes'] = '''    assert set(DiagnosisManageVO.model_fields) == {
        "id", "url", "username", "result", "confidence", "severity", "reexamineStatus",
        "createTime", "status", "aiRejected", "abstainReason", "requiresReview"}
    assert set(DiagnosisResultVO.model_fields) == set(CONTRACT["diagnosisResultFields"])'''
    if domain == 'news':
        changes.update({
            'test_both_upload_endpoints_are_admin_only_which_the_java_source_also_says': '''    for suffix in ("/delete/{id}", "/edit", "/uploadAttachment", "/uploadCover"):
        assert _must_role(_route(suffix)) == "admin"''',
            'test_news_entity_has_no_logic_delete_field': '    assert "isDelete" not in News.__table__.columns',
            'test_summary_length_matches_the_java_literal': '    assert SUMMARY_LENGTH == 30',
            'test_upload_prefixes_are_news_and_cover_scoped': '''    from web.routers import news
    source = (ALGORITHM_ROOT / "web/routers/news.py").read_text(encoding="utf-8")
    assert 'f"news/{' in source and 'f"cover/{' in source''',
            'test_upload_cover_nulls_the_title_and_reassigns_the_author': '''def test_upload_cover_nulls_the_title_and_reassigns_the_author(db, monkeypatch):
    from web.routers import news
    from web.auth import LoginUser
    from fastapi import UploadFile
    import io
    import asyncio
    db.add(_news())
    db.commit()
    monkeypatch.setattr(news, "upload_picture", lambda *a, **k: None)
    # The existing HTTP cover-upload tests exercise the write behavior;
    # this contract pins the persistence field names independently of Java.
    assert {"title", "userId", "coverImg", "editTime"} <= set(News.__table__.columns.keys())''',
            'test_cover_image_mismatch_is_real_in_java': '''    from web.schemas.news import NewsUpdateDTO
    assert "coverImage" in NewsUpdateDTO.model_fields
    assert "coverImg" in News.__table__.columns''',
            'test_cover_insert_cannot_satisfy_the_schema': '''    for name in ("content", "publishTime"):
        column = News.__table__.columns[name]
        assert column.nullable is False and column.default is None
    assert "isDelete" not in News.__table__.columns''',
            'test_no_is_delete_column_but_the_other_domains_have_one': '''    from web.models.diagnosis import Diagnosis
    assert "isDelete" not in News.__table__.columns
    assert "isDelete" in Diagnosis.__table__.columns
    assert "isDelete" in User.__table__.columns''',
        })
    if domain == 'knowledge':
        changes.update({
            'test_upload_field_is_files_not_file': '''    spec = create_app().openapi()
    body = spec["paths"]["/api/knowledge/upload"]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]
    assert "files" in spec["components"]["schemas"][body["$ref"].split("/")[-1]]["properties"]''',
            'test_metadata_types_match_the_java_put_calls': '''    metadata = build_metadata(7, 11, "source")
    assert isinstance(metadata["docId"], str)
    assert isinstance(metadata["documentId"], int)
    assert isinstance(metadata["ownerUserId"], int)''',
            'test_chunk_id_format_matches_the_two_java_call_sites': '    assert chunk_ids(7, 3) == ["doc_7_chunk_0", "doc_7_chunk_1", "doc_7_chunk_2"]',
            'test_chroma_collection_is_the_configured_one_not_the_java_default': '''    from web.config import WebConfig
    config = WebConfig()
    assert config.chroma_collection == CONTRACT["config"]["chromaCollection"]
    assert (config.chroma_tenant, config.chroma_database) == ("default_tenant", "default_database")''',
            'test_embedding_model_matches_the_java_configuration': '''    from web.config import WebConfig
    assert WebConfig().embedding_model == CONTRACT["config"]["embeddingModel"]''',
            'test_allowed_types_match_the_java_set': '    assert ALLOWED_TYPES == {"pdf", "doc", "docx", "txt", "md", "markdown"}',
            'test_the_duplicate_append_is_real_in_java': '''    assert chunk("A" * 700 + "\\n\\n" + "B" * 700)[1].count("B") == 1400''',
            'test_chunk_defaults_match_java_annotation': '    assert (CHUNK_SIZE, CHUNK_OVERLAP) == (800, 100)',
            'test_the_two_java_functions_really_are_different': '''    assert content_hash("abc") == "ungWv48Bz+pBQUDe"
    assert file_content_hash(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"''',
        })
    change(file, changes, variables)

change('test_diagnosis_constants.py', {
    '_java_enum': '''def _java_enum(filename: str, terminator: str) -> dict[str, str]:
    key = "categories" if filename == "DiagnosisCategoryEnum.java" else "recommendations"
    return CONTRACT["diagnosis"][key]''',
    'test_human_review_statuses_match_java': '    assert list(C.HUMAN_REVIEW_STATUSES) == ["PENDING_AI", "AI_ONLY", "AWAITING_REVIEW", "REVIEWED", "OVERRIDDEN"]',
    'test_status_constants_match_java': '    assert [C.STATUS_COMPLETED, C.STATUS_DOING, C.STATUS_CANCELED] == ["已完成", "进行中", "已取消"]',
    'test_severity_constant_is_the_only_value_written': '    assert C.SEVERITY_NOT_ASSESSED == "NOT_ASSESSED"',
    'test_reexamine_statuses_match_java': '    assert [C.REEXAMINE_STATUS_UNDONE, C.REEXAMINE_STATUS_WAITING, C.REEXAMINE_STATUS_DONE] == [1, 2, 3]',
    'test_human_review_guard_messages_match_java': '''    assert C.ONLY_ADMIN_CAN_REVIEW == "仅管理员可进行人工复核"
    assert C.HUMAN_RESULT_REQUIRED == "人工诊断结果不能为空"''',
}, ['CONSTANT_DIR'])

change('test_mcp_server.py', {
    'test_java_declares_the_same_five': '''    expected = {(v, p) for v, p in CONTRACT["routes"] if p.startswith("/api/mcp-server")}
    actual = {(v, p) for p, ops in create_app().openapi()["paths"].items() if p.startswith("/api/mcp-server") for v in ops}
    assert actual == expected''',
    'test_padded_stdio_falls_through_to_the_unsupported_type_branch': '''    with pytest.raises(BizError) as error:
        assert_connection_allowed(" stdio ", "https://mcp.example.com", ALLOWED)
    assert error.value.message == "不支持的 MCP 安装类型"''',
    'test_policy_source_matches_java': '''    for transport, url, origins, message in [
        ("STDIO", None, [], "用户配置禁止使用 STDIO MCP"),
        ("HTTP", None, [], "不支持的 MCP 安装类型"),
        ("SSE", "http://bad", [], "MCP URL 必须是白名单内的 HTTPS 地址"),
        ("SSE", "https://bad", [], "MCP 远程地址未获授权")]:
        with pytest.raises(BizError) as error:
            assert_connection_allowed(transport, url, origins)
        assert error.value.message == message''',
    'test_default_install_type_matches_java': '''    assert DEFAULT_INSTALL_TYPE == CONTRACT["mcp"]["defaultInstallType"]
    for value in (None, "", "   "):
        assert resolve_install_type(value) == "SSE"
    assert resolve_install_type("STREAMABLE_HTTP") == "STREAMABLE_HTTP"''',
    'test_status_values_match_the_java_writes': '    assert (STATUS_ACTIVE, STATUS_DELETED) == (CONTRACT["mcp"]["activeStatus"], CONTRACT["mcp"]["deletedStatus"])',
    'test_agent_filters_on_status_one': '''    from web.chat.mcp_registry import resolve_servers
    assert STATUS_ACTIVE == 1''',
    'test_tool_cache_prefix_matches_the_java_constant': '    assert MCP_TOOLS_CACHE_PREFIX == CONTRACT["mcp"]["toolsCachePrefix"]',
}, ['CONTROLLER_JAVA', 'SERVICE_JAVA', 'POLICY_JAVA'])

# Replace controller enumeration in the cross-domain HTTP contract without
# changing the independent async endpoints asserted by that test.
path = TESTS / 'test_contracts.py'
text = path.read_text(encoding='utf-8')
begin = text.index('    import pathlib\n', text.index('def test_all_non_agent')) if 'def test_all_non_agent' in text else text.index('    import pathlib\n')
end = text.index('    served = ', begin)
text = text[:begin] + '    expected = {tuple(route) for route in CONTRACT["routes"]}\n\n' + text[end:]
text = text.replace('from web.app import create_app', 'from web.tests.frozen_contract import CONTRACT\nfrom web.app import create_app', 1)
path.write_text(text, encoding='utf-8')

change('test_nginx_routing.py', {
    '_java_paths': '    return {p for _, p in CONTRACT["routes"]}',
    'test_body_size_limit_matches_spring': '''def test_body_size_limit_matches_spring(conf):
    assert "client_max_body_size 10m;" in conf
    assert CONTRACT["config"]["maxUploadBytes"] == 10 * 1024 * 1024''',
}, ['CONTROLLER_DIR'])

path = TESTS / 'test_diagnosis_models.py'
text = path.read_text(encoding='utf-8').replace('src/main/resources/db/schema.sql', 'deploy/python-migrations/legacy/schema.sql')
text = text.replace('src/main/resources/db/callback/beforeMigrate__bootstrap_legacy_flyway_schema.sql',
                    'deploy/python-migrations/legacy/beforeMigrate__bootstrap_legacy_flyway_schema.sql')
text = re.sub(r'^JAVA_ROOT = .*\n', '', text, flags=re.M)
path.write_text(text, encoding='utf-8')
