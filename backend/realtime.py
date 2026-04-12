from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import DefaultDict

from fastapi import WebSocket


class RealtimeHub:
    def __init__(self) -> None:
        self._channels: DefaultDict[str, DefaultDict[str, set[WebSocket]]] = defaultdict(lambda: defaultdict(set))
        self._lock = asyncio.Lock()

    async def subscribe(self, channel: str, key: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._channels[channel][key].add(websocket)

    async def unsubscribe(self, channel: str, key: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._channels[channel][key].discard(websocket)
            if not self._channels[channel][key]:
                del self._channels[channel][key]
            if not self._channels[channel]:
                del self._channels[channel]

    async def publish(self, channel: str, key: str, message: dict) -> None:
        async with self._lock:
            targets = list(self._channels.get(channel, {}).get(key, set()))
        stale: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)
        if stale:
            async with self._lock:
                for websocket in stale:
                    self._channels[channel][key].discard(websocket)
                if key in self._channels[channel] and not self._channels[channel][key]:
                    del self._channels[channel][key]
                if channel in self._channels and not self._channels[channel]:
                    del self._channels[channel]
