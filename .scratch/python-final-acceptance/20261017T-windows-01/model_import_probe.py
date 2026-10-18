"""Diagnostic only: trace a stalled model dependency import; no vendor calls."""
import faulthandler
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "algorithm"))
faulthandler.dump_traceback_later(25, repeat=False)
import eye_disease_model
faulthandler.cancel_dump_traceback_later()
print("MODEL_IMPORT_OK", flush=True)
