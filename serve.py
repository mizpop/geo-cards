#!/usr/bin/env python3
"""ローカル確認用サーバー（キャッシュさせないので、更新後の再読み込みで古いファイルが混ざらない）

使い方: python3 serve.py  → http://localhost:8000
/api/refimg は本番（Cloudflare Pages Functions の functions/api/refimg.js）と同じく GeoHints の画像を中継する
"""
import http.server
import re
import sys
import urllib.parse
import urllib.request

ALLOWED = 'https://ocsc00skc0wokcs8kw8g8k84.geohints.com/storage/'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/api/refimg':
            return super().do_GET()
        path = urllib.parse.parse_qs(u.query).get('path', [''])[0]
        if not re.fullmatch(r'[\w\-./%() ]+', path) or '..' in path:
            self.send_error(400)
            return
        try:
            req = urllib.request.Request(ALLOWED + urllib.parse.quote(path), headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
                ctype = r.headers.get('Content-Type', '')
        except Exception:
            self.send_error(404)
            return
        if not ctype.startswith('image/'):
            self.send_error(415)
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'http://localhost:{port} で起動しました（Ctrl+C で停止）')
http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
