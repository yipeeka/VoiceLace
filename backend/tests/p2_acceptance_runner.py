from __future__ import annotations

import sys
import unittest


TEST_MODULES = [
    "backend.tests.test_api_smoke",
    "backend.tests.test_task_flows",
    "backend.tests.test_persistence",
    "backend.tests.test_state_factory",
    "backend.tests.test_model_orchestrator",
    "backend.tests.test_tts_overrides",
]


def main() -> int:
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    for module in TEST_MODULES:
        suite.addTests(loader.loadTestsFromName(module))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
