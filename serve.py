#!/usr/bin/env python3
"""ローカル確認用サーバー（キャッシュさせないので、更新後の再読み込みで古いファイルが混ざらない）

使い方: python3 serve.py  → http://localhost:8000
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'http://localhost:{port} で起動しました（Ctrl+C で停止）')
http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
