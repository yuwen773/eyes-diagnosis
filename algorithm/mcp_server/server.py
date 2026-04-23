import logging

from mcp.server.fastmcp import FastMCP

from mcp_server.config import MCPConfig
from mcp_server.tools import diagnose, load_model

logger = logging.getLogger(__name__)

mcp = FastMCP(
    "Eye Disease Diagnosis",
    instructions="眼科疾病AI诊断服务。提供眼底图像分析，可识别8种常见眼科疾病：正常、年龄相关性黄斑变性、白内障、糖尿病视网膜病变、青光眼、高血压视网膜病变、病理性近视、其他疾病。",
)


@mcp.tool()
async def eye_disease_diagnosis(image_input: str) -> str:
    """对眼科眼底图像进行AI疾病诊断。

    接收眼底图像（支持本地文件路径、HTTP/HTTPS URL、Base64编码），返回疾病预测结果，
    包括预测标签、概率、可靠性评分、疾病描述和Top3预测。

    Args:
        image_input: 图片输入，支持以下格式：
            - 本地文件路径: /path/to/image.jpg 或 C:\\path\\to\\image.png
            - HTTP/HTTPS URL: https://example.com/eye.png
            - Base64编码字符串: iVBORw0KGgo...

    Returns:
        JSON格式的诊断结果，包含 predicted_label、predicted_label_cn、probability、
        reliability_score、description 和 top_predictions 字段。
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
    logger.info("Model loaded, server ready")

    mcp.run(transport="streamable-http", host=config.host, port=config.port)


if __name__ == "__main__":
    main()
