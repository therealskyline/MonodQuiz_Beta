import os
from pathlib import Path

from huggingface_hub import HfApi


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "QCM_data_base"


def main() -> None:
    repo_id = os.getenv("HF_REPO_ID", "").strip()
    token = os.getenv("HF_TOKEN", "").strip()
    repo_type = os.getenv("HF_REPO_TYPE", "dataset").strip() or "dataset"
    if not repo_id or not token:
        raise SystemExit("Définis HF_REPO_ID et HF_TOKEN avant la migration.")

    files = [
        path for path in DATA_DIR.rglob("*.json")
        if path.is_file() and path.relative_to(DATA_DIR).parts[0] in {"public_data_base", "private_data_base"}
    ]
    if not files:
        raise SystemExit(f"Aucun fichier QCM trouvé dans {DATA_DIR}.")

    api = HfApi(token=token)
    api.upload_folder(
        folder_path=str(DATA_DIR),
        repo_id=repo_id,
        repo_type=repo_type,
        allow_patterns=["public_data_base/**", "private_data_base/**"],
        commit_message="Importer les QCM MonodQuiz",
    )
    print(f"{len(files)} fichier(s) envoyé(s) dans {repo_type} {repo_id}.")


if __name__ == "__main__":
    main()