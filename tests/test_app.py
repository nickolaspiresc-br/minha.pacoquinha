import io
import unittest
from unittest.mock import patch

import app as application


class AppSocketTestCase(unittest.TestCase):
    def setUp(self):
        application.rooms.clear()
        application.connected_sids.clear()
        self.note = {
            "text": "",
            "history": [],
            "items": [],
            "events": [],
        }
        self.cycle = None
        self.client_a = application.socketio.test_client(application.app)
        self.client_b = None

    def tearDown(self):
        if self.client_b and self.client_b.is_connected():
            self.client_b.disconnect()
        if self.client_a.is_connected():
            self.client_a.disconnect()
        application.rooms.clear()
        application.connected_sids.clear()

    def authenticate(self, client, name, password="euteamoleide"):
        client.emit("authenticate", {"name": name, "password": password})
        return client.get_received()

    @staticmethod
    def event_names(events):
        return [event["name"] for event in events]

    def test_login_accepts_exact_password_and_rejects_wrong_password(self):
        events = self.authenticate(self.client_a, "Alice")
        self.assertIn("login_success", self.event_names(events))

        wrong_client = application.socketio.test_client(application.app)
        wrong_events = self.authenticate(wrong_client, "Wrong", "incorrecta")
        self.assertIn("login_failed", self.event_names(wrong_events))
        wrong_client.disconnect()

    def test_chat_text_is_broadcast_to_both_clients(self):
        self.authenticate(self.client_a, "Alice")
        self.client_b = application.socketio.test_client(application.app)
        self.authenticate(self.client_b, "Bob")
        self.client_a.get_received()
        self.client_b.get_received()

        self.client_a.emit("send_chat_message", {"text": "Oi, amor!"})
        first_events = self.client_a.get_received()
        second_events = self.client_b.get_received()

        self.assertTrue(any(event["name"] == "chat_message_received" for event in first_events))
        self.assertTrue(any(event["name"] == "chat_message_received" for event in second_events))

    def test_chat_media_metadata_is_broadcast_to_both_clients(self):
        self.authenticate(self.client_a, "Alice")
        self.client_b = application.socketio.test_client(application.app)
        self.authenticate(self.client_b, "Bob")
        self.client_a.get_received()
        self.client_b.get_received()

        self.client_a.emit(
            "send_chat_message",
            {"text": "Veja isto", "file": {"url": "/uploads/photo.jpg", "filename": "photo.jpg"}},
        )
        first_events = self.client_a.get_received()
        second_events = self.client_b.get_received()
        first_message = next(event for event in first_events if event["name"] == "chat_message_received")
        second_message = next(event for event in second_events if event["name"] == "chat_message_received")
        self.assertEqual(first_message["args"][0]["file"]["filename"], "photo.jpg")
        self.assertEqual(second_message["args"][0]["text"], "Veja isto")

    def test_games_broadcast_question_and_stopotes_state(self):
        self.authenticate(self.client_a, "Alice")
        self.client_b = application.socketio.test_client(application.app)
        self.authenticate(self.client_b, "Bob")
        self.client_a.get_received()
        self.client_b.get_received()

        self.client_a.emit("start_game", {"game": "questions"})
        question_events = self.client_b.get_received()
        self.assertTrue(any(event["name"] == "new_question" for event in question_events))

        self.client_a.emit("leave_game")
        self.client_a.get_received()
        self.client_b.get_received()
        self.client_a.emit("start_game", {"game": "stopotes"})
        game_events = self.client_b.get_received()
        self.assertTrue(any(event["name"] == "game_state" for event in game_events))

    def test_upload_rejects_invalid_extension_and_accepts_image(self):
        http_client = application.app.test_client()
        invalid = http_client.post(
            "/api/upload",
            data={"file": (io.BytesIO(b"bad"), "payload.exe")},
            content_type="multipart/form-data",
        )
        self.assertEqual(invalid.status_code, 415)

        valid = http_client.post(
            "/api/upload",
            data={"file": (io.BytesIO(b"image"), "photo.jpg")},
            content_type="multipart/form-data",
        )
        self.assertEqual(valid.status_code, 200)
        self.assertTrue(valid.get_json()["url"].startswith("/uploads/"))

    @patch.object(application, "load_note_sync")
    @patch.object(application, "save_note_sync")
    def test_list_add_persists_and_broadcasts_item(self, save_note, load_note):
        load_note.return_value = self.note
        self.authenticate(self.client_a, "Alice")
        self.client_a.get_received()

        item = {
            "imdbID": "tt123",
            "title": "About Time",
            "year": "2013",
            "plot": "Uma sinopse",
            "poster": "https://example.test/poster.jpg",
        }
        self.client_a.emit("list_add", {"item": item})
        events = self.client_a.get_received()

        save_note.assert_called_once()
        self.assertEqual(save_note.call_args.args[0]["items"][0]["title"], "About Time")
        self.assertTrue(any(event["name"] == "list_updated" for event in events))

    @patch.object(application, "fetch_omdb_title")
    def test_list_search_returns_omdb_result(self, fetch_title):
        fetch_title.return_value = {"imdbID": "tt123", "title": "About Time", "year": "2013"}
        self.authenticate(self.client_a, "Alice")
        self.client_a.get_received()

        self.client_a.emit("list_search", {"title": "About Time"})
        events = self.client_a.get_received()

        fetch_title.assert_called_once_with("About Time")
        self.assertEqual(events[-1]["name"], "list_search_result")
        self.assertTrue(events[-1]["args"][0]["ok"])

    @patch.object(application, "load_note_sync")
    @patch.object(application, "save_note_sync")
    def test_calendar_event_is_saved_and_broadcast(self, save_note, load_note):
        load_note.return_value = self.note
        self.authenticate(self.client_a, "Alice")
        self.client_a.get_received()

        self.client_a.emit("calendar_event_save", {"date": "2026-09-20", "title": "Jantar"})
        events = self.client_a.get_received()

        save_note.assert_called_once()
        self.assertEqual(save_note.call_args.args[0]["events"][0]["title"], "Jantar")
        self.assertTrue(any(event["name"] == "calendar_updated" for event in events))

    @patch.object(application, "load_note_sync", return_value={"text": "", "history": [], "items": [], "events": []})
    @patch.object(application, "save_cycle_sync")
    def test_cycle_uses_private_upsert_payload(self, save_cycle, load_note):
        self.authenticate(self.client_a, "Alice")
        self.client_a.get_received()

        self.client_a.emit(
            "calendar_cycle_save",
            {
                "last_period": "2026-09-01",
                "cycle_length": 30,
                "anotacoes_extras": "Observação privada",
            },
        )

        save_cycle.assert_called_once_with(
            "Alice",
            {
                "last_period": "2026-09-01",
                "cycle_length": 30,
                "notes": "Observação privada",
            },
        )


if __name__ == "__main__":
    unittest.main()
