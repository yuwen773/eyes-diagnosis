import logging

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from mcp_server.config import MCPConfig
from mcp_server.tools import diagnose, load_model

logger = logging.getLogger(__name__)

mcp = FastMCP(
    "Eye Disease Diagnosis",
    instructions="眼科疾病AI诊断服务。提供眼底图像分析，可识别8种常见眼科疾病：正常、年龄相关性黄斑变性、白内障、糖尿病视网膜病变、青光眼、高血压视网膜病变、病理性近视、其他疾病。",
)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))
async def eye_disease_diagnosis(image_input: str) -> str:
    """对眼科眼底图像进行AI疾病诊断。

    接收眼底图像（支持本地文件路径、HTTP/HTTPS URL、Base64编码），复用质量、校准、
    拒绝与模型来源校验管线。仅返回未发布分析的状态与来源，不展示预测或保存正式诊断。

    Args:
        image_input: 图片输入，支持以下格式：
            - 本地文件路径: /path/to/image.jpg 或 C:\\path\\to\\image.png
            - HTTP/HTTPS URL: https://example.com/eye.png
            - Base64编码字符串: iVBORw0KGgo...

    Returns:
        JSON格式的未发布分析状态、质量门和模型来源。患者可见预测必须通过诊断工作流。
    """
    return await diagnose(image_input)


def main():
    config = MCPConfig.from_env()

    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    logger.info(f"Starting MCP server on {config.host}:{config.port}")
    load_model(config)
    logger.info("Shared inference adapter configured; weights verified on first use")

    mcp.settings.host = config.host
    mcp.settings.port = config.port
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
