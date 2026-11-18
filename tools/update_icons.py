import os
import re

apps = [
    'gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'forms',
    'meet', 'chat', 'gemini', 'keep', 'tasks'
]

def clean_svg(svg_content):
    s = re.sub(r'<\?xml[^>]*\?>', '', svg_content)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.DOTALL)
    # Ensure width and height are 100%
    if 'width=' in s:
        s = re.sub(r'width=[\"\'][^\"\']*[\"\']', 'width="100%"', s, count=1)
    else:
        s = re.sub(r'<svg', '<svg width="100%"', s, count=1)
    if 'height=' in s:
        s = re.sub(r'height=[\"\'][^\"\']*[\"\']', 'height="100%"', s, count=1)
    else:
        s = re.sub(r'<svg', '<svg height="100%"', s, count=1)
    return s.strip()

def make_badged(svg_content):
    vb_match = re.search(r'viewBox=[\"\']([^\"\']+)[\"\']', svg_content)
    if not vb_match:
        return svg_content
    vb = [float(v) for v in vb_match.group(1).replace(',', ' ').split() if v.strip()]
    if len(vb) != 4:
        return svg_content
    x0, y0, w, h = vb
    cx = x0 + w * 0.82
    cy = y0 + h * 0.18
    r = min(w, h) * 0.14
    stroke_r = r * 1.35

    badge = f'<g id="notification-dot"><circle cx="{cx:.2f}" cy="{cy:.2f}" r="{stroke_r:.2f}" fill="#202124"/><circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="#EA4335"/></g></svg>'
    return re.sub(r'</svg>\s*$', badge, svg_content.strip(), flags=re.IGNORECASE)

entries = []

for app in apps:
    svg_path = os.path.join('icons', 'official', f'{app}.svg')
    with open(svg_path, 'r', encoding='utf-8') as f:
        raw = f.read()
    cleaned = clean_svg(raw)
    badged = make_badged(cleaned)
    entries.append(f'  {app}: `{cleaned}`,')
    entries.append(f'  "{app}_badged": `{badged}`,')

ui_icons = """
  newtab: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>`,

  pin: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,

  lock: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`,

  audio: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z"/></svg>`,

  muted: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M16.5 12c0-1.8-1-3.3-2.5-4v2.2l2.5 2.5c0-.2 0-.5 0-.7zm2.5 0c0 .9-.2 1.8-.5 2.6l1.5 1.5c.7-1.2 1-2.6 1-4.1 0-4.3-3-7.9-7-8.8v2.1c2.9.9 5 3.5 5 6.7zM4.3 3 3 4.3l4 4H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.1v2.1c1.4-.3 2.6-.9 3.7-1.8l2 2 1.3-1.3L4.3 3zM12 4 9.9 6.1 12 8.2V4z"/></svg>`,

  tray: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>`,

  tray_badged: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/><circle cx="19.5" cy="4.5" r="4.5" fill="#202124"/><circle cx="19.5" cy="4.5" r="3.5" fill="#EA4335"/></svg>`,

  layoutVertical: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H9V5h10v14zM5 5h2v14H5V5z"/></svg>`,

  layoutHorizontal: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10zm0-12H5V5h14v2z"/></svg>`
"""

output = f"""// Official Google Workspace Vector SVGs & UI Icons (Downloaded directly from official branding assets)
const ICONS = {{
{chr(10).join(entries)}
{ui_icons}
}};

if (typeof module !== 'undefined' && module.exports) {{
  module.exports = {{ ICONS }};
}}
"""

with open('svg-icons.js', 'w', encoding='utf-8') as f:
    f.write(output)

print("svg-icons.js generated successfully! Length:", len(output))
