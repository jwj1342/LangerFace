"""本地静态服务器，托管 web/ 实时网页。

  python3 tools/serve_web.py            # http://localhost:8000
  python3 tools/serve_web.py 8080

getUserMedia 在 http://localhost 下属安全上下文，可正常访问摄像头。
"""
from __future__ import annotations

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".ts": "text/javascript",
        ".json": "application/json",
        ".task": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass  # 安静


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8000))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=WEB))
    print(f"实时网页: http://localhost:{port}  (Ctrl+C 停止)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
