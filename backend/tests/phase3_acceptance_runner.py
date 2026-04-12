from __future__ import annotations

import sys
import unittest


ACCEPTANCE_CASES: list[tuple[str, str]] = [
    (
        "3-B WebSocket/Reconnect baseline (LLM parse task lifecycle)",
        "backend.tests.test_task_flows.TaskFlowTest.test_llm_parse_task_completes_and_persists",
    ),
    (
        "2-B/Phase3 export readiness (subtitle + archive)",
        "backend.tests.test_task_flows.TaskFlowTest.test_tts_synthesis_task_completes",
    ),
    (
        "3-C project delete cleanup",
        "backend.tests.test_task_flows.TaskFlowTest.test_delete_project_cleans_outputs_and_logs",
    ),
    (
        "P0/P1 API baseline",
        "backend.tests.test_api_smoke.ApiSmokeTest.test_project_crud",
    ),
]


def run_case(loader: unittest.TestLoader, runner: unittest.TextTestRunner, test_name: str) -> bool:
    suite = loader.loadTestsFromName(test_name)
    result = runner.run(suite)
    return result.wasSuccessful()


def main() -> int:
    print("== Phase 3 Acceptance (Automated) ==")
    loader = unittest.TestLoader()
    runner = unittest.TextTestRunner(verbosity=2)

    statuses: list[tuple[str, bool]] = []
    for title, test_name in ACCEPTANCE_CASES:
        print(f"\n[RUN] {title}")
        ok = run_case(loader, runner, test_name)
        statuses.append((title, ok))

    print("\n== Acceptance Summary ==")
    for title, ok in statuses:
        mark = "PASS" if ok else "FAIL"
        print(f"- {mark}: {title}")

    failed = [title for title, ok in statuses if not ok]
    if failed:
        print("\nPhase 3 acceptance has failures. Please inspect logs above.")
        return 1

    print("\nPhase 3 acceptance passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
