import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from starlette.routing import WebSocketRoute

from main import app as monolith_app


app = FastAPI()
allowed_origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

for route in monolith_app.routes:
    if isinstance(route, WebSocketRoute) or (
        isinstance(route, APIRoute) and route.path in {"/health", "/api/create_room"}
    ):
        app.router.routes.append(route)