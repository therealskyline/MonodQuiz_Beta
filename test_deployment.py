import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

import main
from api.index import app as vercel_app
from qcm_storage import list_qcm_files, read_qcm, write_qcm
from render_app import app as render_app


class QCMStorageTests(unittest.TestCase):
    def test_local_store_lists_reads_and_updates_qcms(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            base_dir = Path(temporary_directory)
            file_path = "QCM_data_base/public_data_base/math/sample.json"
            payload = {"qcm_name": "Test", "questions": [{"text": "2 + 2 ?"}]}
            write_qcm(file_path, payload, base_dir, "Créer un QCM test")

            files = list_qcm_files(
                base_dir / "QCM_data_base/public_data_base",
                base_dir / "QCM_data_base/private_data_base",
                base_dir,
            )
            self.assertEqual(files, [file_path])
            self.assertEqual(read_qcm(file_path, base_dir), payload)

            payload["qcm_name"] = "Mis à jour"
            write_qcm(file_path, payload, base_dir, "Mettre à jour un QCM test")
            self.assertEqual(read_qcm(file_path, base_dir)["qcm_name"], "Mis à jour")

    def test_huggingface_store_lists_reads_and_writes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            downloaded_file = Path(temporary_directory) / "sample.json"
            downloaded_file.write_text('{"questions": []}', encoding="utf-8")
            hf_api = Mock()
            hf_api.list_repo_files.return_value = [
                "public_data_base/math/sample.json",
                "private_data_base/history/hidden.json",
                "README.md",
            ]
            hf_module = types.ModuleType("huggingface_hub")
            hf_module.HfApi = Mock(return_value=hf_api)
            hf_module.hf_hub_download = Mock(return_value=str(downloaded_file))

            with patch("qcm_storage._hf_settings", return_value=("school/qcms", "hf_test", "dataset")):
                with patch.dict(sys.modules, {"huggingface_hub": hf_module}):
                    files = list_qcm_files(Path("public"), Path("private"), Path("."))
                    self.assertEqual(len(files), 2)
                    self.assertEqual(read_qcm(files[0], Path(".")), {"questions": []})
                    payload = {"qcm_name": "Nouveau", "questions": []}
                    write_qcm(files[0], payload, Path("."), "Mettre à jour")

            self.assertEqual(hf_api.upload_file.call_args.kwargs["path_in_repo"], "public_data_base/math/sample.json")
            self.assertEqual(hf_api.upload_file.call_args.kwargs["path_or_fileobj"], b'{\n  "qcm_name": "Nouveau",\n  "questions": []\n}')

    def test_local_store_rejects_paths_outside_qcm_data(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaises(FileNotFoundError):
                read_qcm("../secrets.json", Path(temporary_directory))


class DeploymentTests(unittest.TestCase):
    def test_live_ticket_and_render_room_creation(self):
        client = TestClient(main.app)
        with patch.object(main, "secret_key_access", hashlib.sha256(b"test-prof").hexdigest()):
            login = client.post("/api/login", json={"pseudo": "test-prof"})
            self.assertEqual(login.status_code, 200)
            token_response = client.get("/api/live-token")
            self.assertEqual(token_response.status_code, 200)
            ticket = token_response.json()["token"]
            self.assertEqual(main._verify_live_token(ticket), "prof")

            qcms = client.get("/api/qcm/list").json()
            self.assertTrue(qcms)
            response = client.post(
                "/api/create_room",
                json={"qcm_file": qcms[0]["full_path"]},
                headers={"Authorization": f"Bearer {ticket}"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(main.rooms[response.json()["code"]]["qcm_data"]["questions"])
            main.rooms.pop(response.json()["code"], None)

    def test_render_websocket_accepts_professor_ticket(self):
        client = TestClient(main.app)
        render_client = TestClient(render_app)
        with patch.object(main, "secret_key_access", hashlib.sha256(b"test-prof").hexdigest()):
            client.post("/api/login", json={"pseudo": "test-prof"})
            ticket = client.get("/api/live-token").json()["token"]
            qcm_path = client.get("/api/qcm/list").json()[0]["full_path"]
            room_response = client.post(
                "/api/create_room",
                json={"qcm_file": qcm_path},
                headers={"Authorization": f"Bearer {ticket}"},
            )
            code = room_response.json()["code"]
            try:
                with render_client.websocket_connect(
                    f"/ws/{code}?role=prof&name=Professeur&ticket={ticket}"
                ) as websocket:
                    message = websocket.receive_json()
                    self.assertEqual(message["type"], "student_list")
            finally:
                main.rooms.pop(code, None)

    def test_expired_ticket_is_rejected(self):
        self.assertIsNone(main._verify_live_token(main._issue_live_token("prof", -1)))

    def test_student_cannot_read_private_qcm(self):
        client = TestClient(main.app)
        client.post("/api/login", json={"pseudo": "test-student"})
        private_path = "QCM_data_base/private_data_base/math/secret.json"
        with patch("main.read_qcm", return_value={"visibilite": False, "questions": []}):
            response = client.get(f"/api/qcm/read/{private_path}")
        self.assertEqual(response.status_code, 404)

    def test_vercel_api_excludes_render_room_and_websocket_routes(self):
        paths = {getattr(route, "path", "") for route in vercel_app.routes}
        self.assertIn("/api/live-token", paths)
        self.assertNotIn("/api/create_room", paths)
        self.assertNotIn("/ws/{code}", paths)

    def test_render_app_only_exposes_health_and_live_routes(self):
        paths = {getattr(route, "path", "") for route in render_app.routes}
        self.assertIn("/health", paths)
        self.assertIn("/api/create_room", paths)
        self.assertIn("/ws/{code}", paths)
        self.assertNotIn("/api/qcm/list", paths)
        self.assertNotIn("/api/generate-qcm", paths)


if __name__ == "__main__":
    unittest.main()