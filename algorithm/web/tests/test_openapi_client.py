"""Public schema contract for the existing Vue client imports (ticket 02)."""

from fastapi.testclient import TestClient

from web.app import create_app


def test_python_schema_keeps_existing_controller_and_operation_names():
    response = TestClient(create_app()).get("/api/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    expected = {
        "userController": {
            "userAdd", "deleteUser", "reexamineDiagnosis", "getUserById",
            "getLoginUser", "getUserVOById", "listUserVoByPage",
            "listUserVoByPageWithCache", "userLogin", "userLogout",
            "userRegister", "updateUser", "editUserCenter", "uploadAvatarPicture",
        },
        "diagnosisController": {
            "deleteDiagnosis", "doDiagnosis", "getDiagnosisResultVO",
            "listMyDiagnosisVoByPage", "listDiagnosisVoByPage",
            "listDiagnosisVoByPageWithCache", "updateDiagnosisResult", "uploadPicture",
        },
        "newsController": {
            "deleteNews", "updateNews", "getNewsVO", "listNewsVoByPage",
            "listNewsVoByPageWithCache", "uploadAttachment", "uploadCoverImage",
        },
        "mcpController": {
            "createMcpServer", "updateMcpServer", "deleteMcpServer", "getMcpServer", "listMcpServers",
        },
        "knowledgeController": {
            "getEvidenceCatalog", "listReferenceDocuments", "searchPrivateDocuments",
            "updateKnowledgeGovernance", "uploadDocument", "listKnowledgePage", "deleteKnowledge",
        },
    }
    for tag, names in expected.items():
        operations = [operation for path in schema["paths"].values()
                      for operation in path.values() if tag in operation.get("tags", [])]
        assert {operation["operationId"] for operation in operations} == names
        if tag in {"userController", "diagnosisController", "newsController"}:
            for operation in operations:
                assert "$ref" in operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert "LoginUserVO" in schema["components"]["schemas"]
    assert "userRole" in schema["components"]["schemas"]["UserVO"]["properties"]
