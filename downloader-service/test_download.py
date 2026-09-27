import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

import server


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.patch_directory = patch.object(server, "DOWNLOADS", self.root)
        self.patch_directory.start()
        self.addCleanup(self.patch_directory.stop)

    def downloader(self, options):
        instance = unittest.mock.MagicMock()

        def create_file(urls):
            audio = bool(options.get("postprocessors"))
            output = Path(options["outtmpl"]).parent / ("sample.m4a" if audio else "sample.mp4")
            output.write_bytes(b"test fixture")

        instance.__enter__.return_value.download.side_effect = create_file
        return instance

    def test_repeated_downloads_return_separate_existing_files(self):
        with patch.object(server, "YoutubeDL", side_effect=self.downloader):
            first = server.download(server.DownloadRequest(url="https://example.com/video.mp4"))
            second = server.download(server.DownloadRequest(url="https://example.com/video.mp4"))
        self.assertNotEqual(first["fileUrl"], second["fileUrl"])
        for result in [first, second]:
            relative_path = unquote(result["fileUrl"].removeprefix("/files/"))
            self.assertTrue((self.root / relative_path).is_file())
            self.assertEqual(result["mimeType"], "video/mp4")

    def test_audio_is_extracted_and_has_the_ios_audio_mime_type(self):
        with patch.object(server, "YoutubeDL", side_effect=self.downloader) as downloader:
            result = server.download(server.DownloadRequest(url="https://example.com/video.mp4", mode="audio"))
        self.assertEqual(result["mimeType"], "audio/mp4")
        self.assertTrue(result["filename"].endswith(".m4a"))
        self.assertIn({"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}, downloader.call_args.args[0]["postprocessors"])


    def test_job_reports_progress_and_finishes_with_a_file(self):
        def downloader(options):
            instance = unittest.mock.MagicMock()

            def create_file(urls):
                for hook in options["progress_hooks"]:
                    hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
                    hook({"status": "finished"})
                (Path(options["outtmpl"]).parent / "sample.mp4").write_bytes(b"test fixture")

            instance.__enter__.return_value.download.side_effect = create_file
            return instance

        with patch.object(server, "YoutubeDL", side_effect=downloader):
            job_id = server.create_job(server.DownloadRequest(url="https://example.com/video"))["jobId"]
            for _ in range(100):
                job = server.get_job(job_id)
                if job["status"] != "running":
                    break
                time.sleep(0.01)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["progress"], 1)
        self.assertTrue(job["result"]["filename"].endswith(".mp4"))

    def test_cancelled_job_stops_at_the_next_progress_update(self):
        started = threading.Event()
        release = threading.Event()

        def downloader(options):
            instance = unittest.mock.MagicMock()

            def create_file(urls):
                started.set()
                release.wait(2)
                for hook in options["progress_hooks"]:
                    hook({"status": "downloading", "downloaded_bytes": 10, "total_bytes": 100})

            instance.__enter__.return_value.download.side_effect = create_file
            return instance

        with patch.object(server, "YoutubeDL", side_effect=downloader):
            job_id = server.create_job(server.DownloadRequest(url="https://example.com/video"))["jobId"]
            started.wait(2)
            server.cancel_job(job_id)
            release.set()
            for _ in range(100):
                job = server.get_job(job_id)
                if job["status"] != "running":
                    break
                time.sleep(0.01)
        self.assertEqual(job["status"], "cancelled")

    def test_extractor_errors_become_short_spanish_messages(self):
        self.assertEqual(server.friendly_error(Exception("ERROR: [instagram] abc: Requested content is not available, rate-limit reached or login required")), "El sitio pide iniciar sesión para este enlace.")
        self.assertEqual(server.friendly_error(Exception("ERROR: Unsupported URL: https://example.com")), "Este sitio no es compatible.")


if __name__ == "__main__":
    unittest.main()
