from fastapi import FastAPI
from fastapi.routing import APIRoute

from main import app as monolith_app

app = FastAPI()

for route in monolith_app.routes:
    if not isinstance(route, APIRoute):
        continue
    if route.path == "/health" or (route.path.startswith("/api/") and route.path != "/api/create_room"):
        app.router.routes.append(route)