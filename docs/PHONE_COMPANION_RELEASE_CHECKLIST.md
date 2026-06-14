# Advanced Web Phone Companion validation checklist

Use this checklist before merging or releasing changes that touch the advanced web companion. This is for the LAN-served web companion that ships inside the Electron desktop app; do not treat it as a PWA or native mobile app release.

## Automated smoke checks

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run test:companion:smoke
pnpm run verify
pnpm run build:web:raw
pnpm run build:electron:raw
```

Release maintainers should also run the release preflight on macOS before uploading assets:

```bash
pnpm run release
```

`pnpm run release` now runs the companion smoke test before the signed/notarized app build, then continues with the existing Gatekeeper and upload validation.

## Manual desktop-to-phone smoke

1. Launch the desktop app in development or production mode:
   ```bash
   pnpm run app:dev
   # or, for a production-like local package smoke:
   pnpm run app:prod
   ```
2. Open Settings → Phone Companion.
3. Click Start and confirm the status changes to `Companion server running` with at least one LAN URL and a port.
4. Click Create QR code and confirm:
   - QR image renders.
   - The fallback URL is visible and uses a LAN IP when available.
   - The expiry is roughly five minutes in the future.
5. Open the fallback URL on a phone or second browser/device on the same network.
6. Confirm the companion page connects and the desktop Paired devices list shows the device.
7. Start or simulate a meeting state and confirm the companion mirrors:
   - current model/provider,
   - meeting/audio status,
   - live transcript rows,
   - latest assistant answers.
8. From the companion page, send each action once: Ask, What to say, Clarify, Recap, Brainstorm.
9. Upload one small image and one small text/PDF file and confirm the desktop receives `attach-file` context.
10. Revoke the device in Settings and confirm the phone disconnects and cannot refresh `/api/snapshot` with the old URL.
11. Stop the server and confirm the phone reconnect loop does not keep the desktop status stuck at an active connection.

## Likely failures and fixes

| Failure | Likely cause | Fix |
| --- | --- | --- |
| `401 Missing pairing token` on `/api/snapshot` | Phone URL lost the `token` query parameter | Regenerate QR/fallback URL and keep the full URL when copying. |
| `401 Pairing token expired or invalid` | QR is older than five minutes or was already consumed/revoked | Click Regenerate QR and pair again. |
| Phone cannot load fallback URL | Firewall/VPN, phone on guest network, or desktop bound to an unreachable interface | Verify same LAN, disable VPN/guest isolation, allow Node/Electron incoming connections, and try another URL from Settings. |
| WebSocket repeatedly disconnects | Device was revoked, server stopped, or LAN changed | Start the server, regenerate pairing, and reload the phone page. |
| Upload returns `Request too large` or `Upload is too large` | Companion JSON upload exceeds the server limit | Re-test with a file under 10 MB; compress photos before upload. |
| Uploaded filename/path looks unsafe | Filename sanitizer regression | `pnpm run test:companion:smoke` should catch this; inspect `CompanionServer.safeFilename`. |
| `pnpm run test:companion:smoke` times out waiting for `hello` or `snapshot` | WebSocket auth/upgrade or broadcast regression | Check `/ws` token handling, `authenticate`, and `broadcast` in `electron/services/CompanionServer.ts`. |
| `pnpm run build:electron:raw` fails after companion edits | Electron main process type mismatch | Re-run `pnpm run test:companion:smoke` for runtime signal, then fix the TypeScript error in the reported companion/IPC file. |
| `pnpm run release` fails at `gh release view vX.Y.Z` | release-please has not created the tag/release yet | Merge the release-please PR, fetch tags, verify `package.json` version matches the tag, then rerun. |
| `pnpm run release` fails at stapler/spctl | Missing/invalid Apple credentials or notarization issue | Check `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, signing identity, and rerun `pnpm run app:notarize` if the signed app was preserved. |

## Evidence to attach to PRs/releases

- Output from `pnpm run test:companion:smoke`.
- Output from `pnpm run verify`.
- Output from `pnpm run build:web:raw` and `pnpm run build:electron:raw`.
- OS, browser/phone model, and network used for manual pairing.
- Screenshots or short recordings of QR pairing, connected state, mirrored transcript/answer, command send, upload, and revoke.
