import os
import torch


class MCPConfig:
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8000,
        model_path: str | None = None,
        model_arch: str = "efficientnet_b4",
        device: str | None = None,
        num_classes: int = 8,
        log_level: str = "INFO",
    ):
        self.host = host
        if not isinstance(port, int) or port < 1 or port > 65535:
            raise ValueError(f"port must be an integer between 1 and 65535, got {port!r}")
        self.port = port
        self.model_path = model_path
        self.model_arch = model_arch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.num_classes = num_classes
        self.log_level = log_level

    def __repr__(self) -> str:
        return (f"MCPConfig(host={self.host!r}, port={self.port}, "
                f"model_path={self.model_path!r}, model_arch={self.model_arch!r}, "
                f"device={self.device!r}, num_classes={self.num_classes}, "
                f"log_level={self.log_level!r})")

    @classmethod
    def from_env(cls) -> "MCPConfig":
        return cls(
            host=os.getenv("MCP_HOST", "0.0.0.0"),
            port=int(os.getenv("MCP_PORT", "8000")),
            model_path=os.getenv("MODEL_PATH") or None,
            model_arch=os.getenv("MODEL_ARCH", "efficientnet_b4"),
            device=os.getenv("DEVICE") or None,
            num_classes=int(os.getenv("NUM_CLASSES", "8")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )