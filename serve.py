"""Local HTTP server for FeetDex NYC.

Run:    python serve.py
Open:   http://localhost:8000/index.html  (modular dev build — fastest iteration)
        http://localhost:8000/feetdex-nyc.html  (single-file bundle)

Why this exists:
- Chrome refuses to load ES modules from file:// URLs (CORS), which forces use
  of the bundled feetdex-nyc.html when double-clicking from disk.
- file:// URLs also have aggressive disk caching that ignores Ctrl+F5 in many
  Chrome versions, so even after rebuilding the bundle you may keep seeing
  stale code. Running through this server eliminates both problems.
- Each request is served with no-store headers, so the browser never caches.
"""
import http.server
import socketserver
import os

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    os.chdir(ROOT)
    with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
        print(f'Serving {ROOT} on http://localhost:{PORT}/')
        print(f'Open: http://localhost:{PORT}/index.html')
        print('Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')


if __name__ == '__main__':
    main()
