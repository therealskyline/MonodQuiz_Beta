import json
import os
from pathlib import Path, PurePosixPath
from typing import Any


class QCMStorageError(RuntimeError):
    pass


def _hf_settings() -> tuple[str, str, str] | None:
    repo_id = os.getenv("HF_REPO_ID", "").strip()
    if not repo_id:
        return None
    return repo_id, os.getenv("HF_TOKEN", "").strip(), os.getenv("HF_REPO_TYPE", "dataset").strip() or "dataset"


def _repo_path(file_path: str) -> str:
    parts = PurePosixPath(file_path.replace("\\", "/")).parts
    if parts and parts[0] == "QCM_data_base":
        parts = parts[1:]
    if len(parts) < 2 or parts[0] not in {"public_data_base", "private_data_base"}:
        raise QCMStorageError("Chemin de QCM invalide")
    if any(part in {".", ".."} for part in parts):
        raise QCMStorageError("Chemin de QCM invalide")
    if not parts[-1].endswith(".json"):
        raise QCMStorageError("Les QCM doivent être des fichiers JSON")
    return "/".join(parts)


def list_qcm_files(public_dir: Path, private_dir: Path, base_dir: Path) -> list[str]:
    settings = _hf_settings()
    if settings:
        repo_id, token, repo_type = settings
        try:
            from huggingface_hub import HfApi

            files = HfApi(token=token or None).list_repo_files(repo_id=repo_id, repo_type=repo_type)
        except Exception as exc:
            raise QCMStorageError(f"Impossible de lire le dépôt Hugging Face : {exc}") from exc
        return [
            f"QCM_data_base/{file_path}"
            for file_path in files
            if file_path.endswith(".json")
            and file_path.split("/", 1)[0] in {"public_data_base", "private_data_base"}
            and len(file_path.split("/")) >= 3
        ]

    result = []
    for data_dir in (public_dir, private_dir):
        if data_dir.exists():
            result.extend(str(path.relative_to(base_dir)).replace("\\", "/") for path in data_dir.glob("*/*.json"))
    return result


def read_qcm(file_path: str, base_dir: Path) -> dict[str, Any]:
    settings = _hf_settings()
    if settings:
        repo_id, token, repo_type = settings
        remote_path = _repo_path(file_path)
        try:
            from huggingface_hub import hf_hub_download

            downloaded = hf_hub_download(
                repo_id=repo_id,
                filename=remote_path,
                repo_type=repo_type,
                token=token or None,
                cache_dir=os.getenv("HF_HOME", "/tmp/huggingface"),
            )
            return json.loads(Path(downloaded).read_text(encoding="utf-8"))
        except Exception as exc:
            raise QCMStorageError(f"Impossible de lire le QCM dans Hugging Face : {exc}") from exc

    target = (base_dir / file_path).resolve()
    data_root = (base_dir / "QCM_data_base").resolve()
    if not target.is_relative_to(data_root) or not target.is_file():
        raise FileNotFoundError(file_path)
    return json.loads(target.read_text(encoding="utf-8"))


def write_qcm(file_path: str, data: dict[str, Any], base_dir: Path, commit_message: str) -> None:
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    settings = _hf_settings()
    if settings:
        repo_id, token, repo_type = settings
        if not token:
            raise QCMStorageError("HF_TOKEN est requis pour enregistrer un QCM")
        remote_path = _repo_path(file_path)
        try:
            from huggingface_hub import HfApi

            HfApi(token=token).upload_file(
                path_or_fileobj=serialized.encode("utf-8"),
                path_in_repo=remote_path,
                repo_id=repo_id,
                repo_type=repo_type,
                commit_message=commit_message,
            )
            return
        except Exception as exc:
            raise QCMStorageError(f"Impossible d'enregistrer le QCM dans Hugging Face : {exc}") from exc

    target = (base_dir / file_path).resolve()
    data_root = (base_dir / "QCM_data_base").resolve()
    if not target.is_relative_to(data_root):
        raise QCMStorageError("Chemin de QCM invalide")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(serialized, encoding="utf-8")