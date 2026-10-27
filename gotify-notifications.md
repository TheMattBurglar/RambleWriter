---
name: gotify-notifications
description: How to send the user a phone notification via their Gotify server on the NAS (set up 2026-09-26)

---

The user's Gotify server runs on their NAS at http://192.168.6.255:8089. It also receives notifications from their Creality 3D printer. The URL and an app token for the "Claude tests" app are in ~/.config/gotify/claude.env (GOTIFY_URL, GOTIFY_TOKEN; mode 600). Load it with `set -a; . ~/.config/gotify/claude.env; set +a` and never print the token.

Send: `curl -sS "$GOTIFY_URL/message" -H "X-Gotify-Key: $GOTIFY_TOKEN" -F title=... -F message=... -F priority=5`

The user is new to Gotify. Use it to notify them when long jobs finish while they're away. Never include financial details in messages, per [[fin-app]].
