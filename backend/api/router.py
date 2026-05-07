from fastapi import APIRouter

from . import asr_routes, llm_routes, music_routes, project_routes, system_routes, tts_routes, voice_routes, ws_routes

api_router = APIRouter()
api_router.include_router(system_routes.router, prefix="/system", tags=["system"])
api_router.include_router(llm_routes.router, prefix="/llm", tags=["llm"])
api_router.include_router(project_routes.router, prefix="/projects", tags=["projects"])
api_router.include_router(voice_routes.router, prefix="/voices", tags=["voices"])
api_router.include_router(tts_routes.router, prefix="/tts", tags=["tts"])
api_router.include_router(music_routes.router, prefix="/music", tags=["music"])
api_router.include_router(asr_routes.router, prefix="/asr", tags=["asr"])
api_router.include_router(ws_routes.router, prefix="/ws", tags=["ws"])
