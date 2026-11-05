import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist"


def build() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir()

    templates = ROOT / "templates"
    for template in templates.glob("*.html"):
        shutil.copy2(template, OUTPUT / template.name)
    shutil.copy2(templates / "login.html", OUTPUT / "index.html")
    shutil.copytree(ROOT / "static", OUTPUT / "static")

    live_api_url = os.getenv("LIVE_API_BASE_URL", "").strip().rstrip("/")
    config_path = OUTPUT / "static" / "js" / "app_config.js"
    config_path.write_text(
        "window.APP_CONFIG = Object.freeze({ liveApiBaseUrl: "
        + json.dumps(live_api_url)
        + " });\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    build()