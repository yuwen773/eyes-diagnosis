"""Absolute launcher path makes owned Windows processes identifiable."""

import sys

if sys.argv[1:] == ["api"]:
    from web.delivery import api
    api()
elif sys.argv[1:] == ["worker"]:
    from web.workflow.worker import main
    sys.argv = sys.argv[:1]
    main()
else:
    raise SystemExit("Expected api or worker")
