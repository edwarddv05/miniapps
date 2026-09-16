import tempfile
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


if __name__ == "__main__":
    unittest.main()
