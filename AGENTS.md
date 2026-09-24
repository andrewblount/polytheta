<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Chrome login handoffs

Before asking the user to log in or complete authentication in Google Chrome, Codex must open or select the exact tab requiring login, bring its Chrome window to the foreground above other apps, and leave that tab active and visible. Only then ask the user to sign in.
