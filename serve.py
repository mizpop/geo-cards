#!/usr/bin/env python3
"""ローカル確認用サーバー（キャッシュさせないので、更新後の再読み込みで古いファイルが混ざらない）

使い方: python3 serve.py  → http://localhost:8000
/api/refimg は本番（Cloudflare Pages Functions の functions/api/refimg.js）と同じく GeoHints の画像を中継する
/api/ask（AI アシスタント）は、環境変数 MOCK_ASK=1 で起動したときだけ、動作確認用の仮の答えを返す（Gemini には接続しない）。
  それ以外は、本番で API キーが未設定のときと同じ not_configured を返す（実際の動作は functions/api/ask.js）
  例: MOCK_ASK=1 python3 serve.py 8831
"""
import http.server
import json
import os
import re
import time
import sys
import urllib.parse
import urllib.request

ALLOWED = 'https://ocsc00skc0wokcs8kw8g8k84.geohints.com/storage/'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != '/api/ask':
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if os.environ.get('MOCK_ASK') != '1':
            data = json.dumps({'error': 'not_configured'}).encode()
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        req = json.loads(body or b'{}')
        ctx = req.get('context', '')
        ids = re.findall(r'\[([CP]\d+)\]', ctx)
        # ログ: テストで「何が送られたか」を確かめられるように
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.ask-last.json'), 'w', encoding='utf-8') as f:
            json.dump({**req, 'image': ('(%d chars)' % len(req['image']['data'])) if req.get('image') else None}, f, ensure_ascii=False)
        text = '（テスト応答）資料は %d 文字、項目 %s、画像 %s でした。\n\n- **ポイント**: ボラードの形に注目 %s\n- 国: [国:PL]\n\n1. 一つ目\n2. 二つ目' % (
            len(ctx), '・'.join(dict.fromkeys(ids)) or 'なし', 'あり' if req.get('image') else 'なし', ('[%s]' % ids[0]) if ids else '')
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        def ev(obj):
            self.wfile.write(('data: %s\n\n' % json.dumps(obj, ensure_ascii=False)).encode())
            self.wfile.flush()
        for i in range(0, len(text), 6):
            ev({'text': text[i:i + 6]})
            time.sleep(0.02)
        ev({'done': True, 'reason': 'STOP'})

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
