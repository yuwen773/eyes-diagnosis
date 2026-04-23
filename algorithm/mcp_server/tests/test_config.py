import os
import pytest
from unittest.mock import patch


def test_default_config():
    from mcp_server.config import MCPConfig

    config = MCPConfig()
    assert config.host == "0.0.0.0"
    assert config.port == 8000
    assert config.model_arch == "efficientnet_b4"
    assert config.num_classes == 8
    assert config.log_level == "INFO"


def test_config_from_env():
    from mcp_server.config import MCPConfig

    env = {
        "MCP_HOST": "127.0.0.1",
        "MCP_PORT": "9000",
        "MODEL_ARCH": "resnet50",
        "DEVICE": "cpu",
        "NUM_CLASSES": "10",
        "LOG_LEVEL": "DEBUG",
    }
    with patch.dict(os.environ, env, clear=False):
        config = MCPConfig.from_env()
    assert config.host == "127.0.0.1"
    assert config.port == 9000
    assert config.model_path is None  # MODEL_PATH not in env, should be None
    assert config.model_arch == "resnet50"
    assert config.device == "cpu"
    assert config.num_classes == 10
    assert config.log_level == "DEBUG"


def test_config_device_auto():
    from mcp_server.config import MCPConfig

    config = MCPConfig()
    assert config.device in ("cuda", "cpu")


def test_config_invalid_port():
    from mcp_server.config import MCPConfig
    with pytest.raises(ValueError):
        MCPConfig(port=-1)