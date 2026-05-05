# Changes in PG Call 1.0.0 (xx-xx-2025)

Upstream merge ✨:

- Base update to v0.17.0 (https://github.com/element-hq/element-call/tree/v0.17.0)

# Changes in PG Call 0.0.15 (xx-xx-2025)

Improvements 🙌:

- Add new translations

# Changes in PG Call 0.0.14 (xx-xx-2025)

Bugfix 🐛:

- fix yarn setup, so correct dependencies are installed

Improvements 🙌:

- Add release script for web-embedded

# Changes in PG Call 0.0.13 (xx-xx-2025)

Upstream merge ✨:

- Base update to v0.16.3 (https://github.com/element-hq/element-call/tree/v0.16.3)

# Changes in PG Call 0.0.12 (xx-xx-2025)

Bugfix 🐛:

- fix excessive rendering of audioContext which caused the waiting tone to start very late
- fix join soundEffect to only trigger when audioTrack is connected
- allow leaving call when audioContext is is broken state

Improvements 🙌:

- get microphone track early so waiting tone is played early & speaker button works earlier
- show loading indicator instead of white screen

# Changes in PG Call 0.0.11 (xx-xx-2025)

Bugfix 🐛:

- fixes matrix-js-sdk version required for underlying upstream element-call 0.16.0 version

# Changes in PG Call 0.0.10 (xx-xx-2025)

Features ✨:

- puts earpiece as first option in list for iOS

# Changes in PG Call 0.0.9 (xx-xx-2025)

Bugfix 🐛:

- Race condition where local microphone track was not always created in time before routing the audio to SPEAKER or EARPIECE

Improvements 🙌:

- Move speaker icon from top-bar to bottom-bar
- Remove earpiece overlay

# Changes in PG Call 0.0.8 (xx-xx-2025)

Upstream merge ✨:

- Base update to v0.16.0 (https://github.com/element-hq/element-call/tree/v0.16.0)

# Changes in PG Call 0.0.5 (xx-xx-2025)

Features ✨:

- Update translations

# Changes in PG Call 0.0.4 (xx-xx-2025)

Features ✨:

- Auto leave call if the other person leaves (DM only)

# Changes in PG Call 0.0.3 (xx-xx-2025)

Features ✨:

- Play beep tone when calling someone and join tone when first callee joins

# Changes in PG Call 0.0.2 (xx-xx-2025)

Upstream merge ✨:

- Base update to v0.13.1 (https://github.com/element-hq/element-call/tree/v0.13.1)

# Changes in PG Call 0.0.1 (xx-xx-2025)

Upstream merge ✨:

- Base update to v0.12.2 (https://github.com/element-hq/element-call/tree/v0.12.2)

Features ✨:

-

Improvements 🙌:

- No default auto mute of microphone.
- Visually set earpiece as default.
- Use of PG design compound (tokens).

Bugfix 🐛:

- Fix deploy build script. (`publish_android_package.sh`)
