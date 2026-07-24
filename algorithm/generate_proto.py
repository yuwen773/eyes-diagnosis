"""Generate the ignored Python protobuf bindings from diagnosis.proto."""

from pathlib import Path

from grpc_tools import protoc


def main() -> None:
    directory = Path(__file__).resolve().parent
    result = protoc.main([
        "grpc_tools.protoc",
        f"-I{directory}",
        f"--python_out={directory}",
        f"--grpc_python_out={directory}",
        str(directory / "diagnosis.proto"),
    ])
    if result != 0:
        raise SystemExit(result)


if __name__ == "__main__":
    main()
