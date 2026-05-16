from __future__ import annotations

import asyncio
import unittest

from backend.mcp_server import build_mcp_server
from backend.state import create_app_state


class McpServerTest(unittest.TestCase):
    def test_mcp_server_registers_core_tools(self) -> None:
        state = create_app_state()
        server = build_mcp_server(lambda: state)

        async def run() -> set[str]:
            tools = await server.list_tools()
            return {tool.name for tool in tools}

        tool_names = asyncio.run(run())
        self.assertIn("get_system_status", tool_names)
        self.assertIn("list_projects", tool_names)
        self.assertIn("start_parse_task", tool_names)
        self.assertIn("start_synthesis_task", tool_names)
        self.assertIn("start_music_task", tool_names)
        self.assertIn("cancel_task", tool_names)


if __name__ == "__main__":
    unittest.main()
