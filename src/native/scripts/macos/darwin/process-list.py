"""Template script for macOS CoreGraphics window enumeration.

`{{PID}}` is replaced at runtime by ScriptLoader template rendering.
"""

# pyright: reportMissingImports=false
import json
import Quartz  # type: ignore[import-not-found]

pid = int("{{PID}}")

window_list = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionAll,
    Quartz.kCGNullWindowID
)

result = []
for window in window_list:
    if window.get('kCGWindowOwnerPID') == pid:
        result.append({
            'handle': str(window.get('kCGWindowNumber', 0)),
            'title': window.get('kCGWindowName', ''),
            'className': window.get('kCGWindowOwnerName', ''),
            'processId': pid,
            'bounds': window.get('kCGWindowBounds', {})
        })

print(json.dumps(result))
