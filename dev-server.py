# Local preview server with caching disabled, so edited ES modules are always
# re-fetched (python's plain http.server lets the browser cache them).
#   python3 dev-server.py [port]     (default 4650; launch config "workshop")
import http.server, os, sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4650

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

http.server.ThreadingHTTPServer.allow_reuse_address = True
http.server.ThreadingHTTPServer(('', PORT), NoCache).serve_forever()
