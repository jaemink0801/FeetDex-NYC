"""
Bundle FeetDex: NYC into a single self-contained HTML file that opens in
Chrome via file:// without a local server.

Strategy:
  1. Load Three.js as a non-module CDN global (window.THREE)
  2. Concatenate every src/*.js in dependency order into ONE inline <script>
     (NOT type=module — that would re-trigger the file:// CORS issue)
  3. Strip every `import` and `export` keyword so the modules become flat
     scope under a single IIFE wrapper
  4. Re-inject the original index.html body verbatim
"""
import re
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')

# Dependency order: each file may rely on names declared in earlier files.
# (audio/feetdex/input have no internal deps; main pulls everything together.)
ORDER = [
    'audio.js',
    'feetdex.js',
    'input.js',
    'player.js',
    'npc.js',
    'minigame.js',
    'interaction.js',
    'ui.js',
    'world.js',
    'main.js',
]

# Regex patterns to strip ESM syntax. We collapse imports to a comment that
# documents what the original line did, and rewrite `export ` away.
_IMPORT_RE = re.compile(r'^\s*import\s+[^;]*?;\s*$', re.MULTILINE)
_EXPORT_RE = re.compile(r'^(\s*)export\s+(default\s+)?', re.MULTILINE)

def transform(filename, source):
    # Strip imports entirely (Three is loaded as a global; locals are flat-scope)
    source = _IMPORT_RE.sub('', source)
    # Strip the `export` keyword while keeping the declaration
    source = _EXPORT_RE.sub(r'\1', source)
    return f"// ── {filename} ─────────────────────────────────────────────\n{source}\n"


def read_index_html():
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        return f.read()


def build():
    parts = []
    for fname in ORDER:
        path = os.path.join(SRC, fname)
        with open(path, encoding='utf-8') as f:
            parts.append(transform(fname, f.read()))
    bundled_js = '\n'.join(parts)

    # Pull the original index.html and replace its <script> block with our
    # inline single-file payload. We also drop the importmap (no longer needed).
    html = read_index_html()

    # Remove the importmap (we use the non-module global build instead)
    html = re.sub(
        r'<script type="importmap">.*?</script>',
        '',
        html,
        count=1,
        flags=re.DOTALL,
    )

    # Inject cache-control meta tags so browsers don't serve a stale
    # version of the inlined JS after a rebuild — common cause of
    # "won't make it past the start screen" reports when the file is
    # reloaded from disk but the browser kept its old in-memory copy.
    cache_meta = (
        '<meta http-equiv="Cache-Control" content="no-store, max-age=0"/>\n'
        '  <meta http-equiv="Pragma" content="no-cache"/>\n'
        '  <meta http-equiv="Expires" content="0"/>\n'
    )
    html = html.replace(
        '<title>FeetDex: NYC</title>',
        '<title>FeetDex: NYC</title>\n  ' + cache_meta,
        1,
    )

    # Read Three.js UMD build from disk and inline it. This makes the HTML
    # work on machines with no internet, ad-blockers, or strict firewalls.
    three_path = os.path.join(ROOT, 'vendor', 'three.min.js')
    with open(three_path, encoding='utf-8') as f:
        three_min = f.read()

    # Drop the <script>localStorage.clear();</script> + the type=module line.
    # Replace them with the inlined Three.js global build + bundled game code.
    # localStorage is wrapped so the page still loads if storage is disabled
    # (Mac Chrome private mode, restrictive site settings, etc.).
    new_loader = (
        '<script>try { localStorage.clear(); } catch (e) {}</script>\n'
        '<!-- Three.js (UMD r149) inlined so the file works fully offline. -->\n'
        '<script>\n'
        + three_min +
        '\n</script>\n'
        '<script>\n'
        '(function () {\n'
        '  // Bridge: code below was written against `import * as THREE from \'three\'`.\n'
        '  // The inlined script above sets window.THREE; alias it to a local const.\n'
        '  const THREE = window.THREE;\n'
        '  if (!THREE) {\n'
        '    document.body.innerHTML = '
        '      \'<div style="color:white;padding:40px;font-family:monospace">'
        'Three.js failed to initialize. Open the browser console (F12) for details.</div>\';\n'
        '    return;\n'
        '  }\n\n'
        + bundled_js +
        '\n})();\n'
        '</script>'
    )

    # Use a lambda so backslashes in the bundled JS aren't interpreted as
    # regex backreferences in the replacement string. .*? matches the optional
    # cache-busting comment between the two script tags.
    html = re.sub(
        r'<script>localStorage\.clear\(\);</script>.*?<script type="module" src="src/main\.js[^"]*"></script>',
        lambda _m: new_loader,
        html,
        count=1,
        flags=re.DOTALL,
    )

    out_path = os.path.join(ROOT, 'feetdex-nyc.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'Wrote {out_path} ({os.path.getsize(out_path):,} bytes)')

    # docs/index.html — what GitHub Pages serves at the site root. We put it
    # in /docs so the dev `index.html` at project root doesn't conflict.
    docs_dir = os.path.join(ROOT, 'docs')
    os.makedirs(docs_dir, exist_ok=True)
    docs_path = os.path.join(docs_dir, 'index.html')
    with open(docs_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  -> docs site:  {docs_path}')

    # Mirror the build to every reachable Desktop so the user can share the
    # file directly without ever copying manually. Works on Windows (with
    # OneDrive's redirected Desktop too) and on macOS / Linux.
    home = os.path.expanduser('~')
    candidates = [
        os.path.join(home, 'OneDrive', 'Desktop'),  # Windows + OneDrive
        os.path.join(home, 'Desktop'),              # macOS / Linux / plain Windows
    ]
    seen = set()
    for desk in candidates:
        if desk in seen or not os.path.isdir(desk):
            continue
        seen.add(desk)
        target = os.path.join(desk, 'feetdex-nyc.html')
        try:
            with open(target, 'w', encoding='utf-8') as f:
                f.write(html)
            print(f'  -> mirrored to {target}')
        except OSError as e:
            print(f'  ! could not mirror to {target}: {e}')

    # Auto-publish to GitHub Pages: if a `git` remote is configured for this
    # folder, stage docs/index.html, commit, and push. GitHub Pages picks it
    # up within ~30 seconds. Silently skipped if git or a remote isn't set.
    _autopublish(docs_path)


def _autopublish(docs_path):
    import subprocess
    def _git(*args, capture=False):
        return subprocess.run(
            ['git', '-C', ROOT, *args],
            check=False,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
            text=True,
        )

    # No git installed? Skip.
    try:
        _git('--version', capture=True)
    except FileNotFoundError:
        return

    # Not a git repo yet? Skip silently.
    inside = _git('rev-parse', '--is-inside-work-tree', capture=True)
    if inside.returncode != 0 or inside.stdout.strip() != 'true':
        return

    # No remote configured? Skip silently — the user hasn't done their
    # one-time GitHub setup yet.
    remote = _git('remote', 'get-url', 'origin', capture=True)
    if remote.returncode != 0 or not remote.stdout.strip():
        return

    # Stage docs (only commit if there are real changes to docs/index.html).
    _git('add', 'docs/index.html')
    diff = _git('diff', '--cached', '--quiet', '--', 'docs/index.html', capture=True)
    if diff.returncode == 0:
        # No staged changes to docs — nothing to publish.
        print('  -> github pages: docs/index.html unchanged, nothing to push')
        return

    # Commit only the docs change to keep auto-publish history clean.
    _git('commit', '-m', 'auto: rebuild feetdex bundle')
    push = _git('push', 'origin', 'HEAD', capture=True)
    if push.returncode == 0:
        print('  -> github pages: pushed (live in ~30s)')
    else:
        msg = (push.stderr or '').strip().splitlines()[-1] if push.stderr else 'unknown error'
        print(f'  ! github pages push failed: {msg}')


if __name__ == '__main__':
    build()
