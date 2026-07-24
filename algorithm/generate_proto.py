"""Generate ignored Python protobuf bindings from the canonical Java schema."""

from pathlib import Path

from grpc_tools import protoc


def main() -> None:
    directory = Path(__file__).resolve().parent
    proto = directory.parent / "src" / "main" / "proto" / "diagnosis.proto"
    result = protoc.main([
        "grpc_tools.protoc",
        f"-I{proto.parent}",
        f"--python_out={directory}",
        f"--grpc_python_out={directory}",
        str(proto),
    ])
    if result != 0:
        raise SystemExit(result)


if __name__ == "__main__":
    main()
