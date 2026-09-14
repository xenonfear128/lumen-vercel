# Cloud clients v0.3.0 — implementation and release handoff

The installed applications load bundled UI and call only https://lumen.rupa.best for business APIs. Audio is decoded on the device and fetched directly from the NetEase CDN. The website remains a separate deployment; client UI is never remotely replaced.

## Layout and commands

- `src/lib/device.ts`: device bridge, SQLite-backed storage facade and durable-write barrier; browser storage stays the web implementation.
- `src/lib/androidPlayer.ts`: native player adapter; it creates no HTMLAudioElement.
- `desktop/`: Electron main/preload, fixed-origin transport, protected secret storage, SQLite, resource protocol and explicit old-origin migration.
- `android/`: Capacitor Android 10+ project, Kotlin Media3 service, Keystore storage, SAF references, PCM EQ and output analysis.
- `server/migrations/002_client_sessions.sql`: additive `kind` column, existing rows remain web sessions.
- `config/client-release.json`: versioned protocol and release manifest. `published` stays false until acceptance; never invent artifact URLs or checksums.

Use Node 24. `npm run build:win` creates unsigned Windows x64 NSIS; `npm run build:mac` on macOS creates both DMGs. `npm run android:sync`, then `android/gradlew -p android testDebugUnitTest assembleDebug lintDebug` builds a verification APK. JDK 21 and Android SDK 36 are required. Local Docker is prohibited.

Desktop packaging uses an isolated app directory as the builder project root. It bundles the metadata reader with esbuild and has no production npm dependencies. The afterPack gate rejects node_modules, backend and environment files. Keep this isolation: running electron-builder directly against the root package would collect backend dependencies.

## Authentication, migration and deployment

Run the independent database migration before deploying the new backend. Back up the database first. Use the existing migration connection through the environment, not a client setting; do not place it in a VITE variable. `npm run db:migrate` performs explicit transactional migrations. No request or frontend build performs schema changes.

The client auth namespace is separate from website auth. Only client-kind hashed sessions authorize Bearer requests. Both kinds use the existing account disable/reset/password invalidation. Client sessions cannot call admin routes. Browser origin and CSRF rules have not been broadened. Protocol 1 uses one-song playback and the existing 10-operation sync batches/server budget. Vercel remains sin1.

Native token and personal NetEase cookie remain in OS-protected storage. Renderer responses never contain device tokens or personal raw cookies. The React storage cache holds only a personal-login marker. Local resource IDs resolve against the native account scope; real paths and document URIs are never sync fields. Cloud sync still uses the metadata allowlist.

Desktop old-origin migration is explicit in account settings. A temporary intercepted HTTP scheme reads the old Electron origin without any listening socket. It keeps original localStorage/IndexedDB intact and preserves prior stored audio in a legacy directory. It does not import old cookies. It is transactional and marked once after successful import. Ordinary newly selected music remains an original-file reference.

## Android playback and statistics

The service owns next/previous, repeat/shuffle, focus, headphone removal, queue selection and lock-screen actions. The WebView subscribes and reads state on re-entry. PCM16 processing uses ten RBJ biquads with Q=sqrt(2), shelving endpoints and preamp, followed by real waveform/FFT extraction; no microphone permission. Analysis switches off when not needed. The fixed CDN HTTP client refuses arbitrary hosts and redirects.

The service persists unique `stats.add` events every 15 seconds and flushes on pause/track/exit. It submits ten at a time, deletes only acknowledged events, and retains original IDs on retry. Events capture the statistics epoch; a pending clear delays background submission. The UI and service use a singleton SQLite repository and shared native transport. Browser/desktop statistics continue through CloudSync. Device-only queue selection, volume/EQ and other preferences are not synced.

## Distribution

`.github/workflows/clients.yml` builds unsigned desktop tests and Android build checks. Manual Android release packaging requires these existing repository/environment secrets:

- `LUMEN_ANDROID_KEYSTORE_BASE64`
- `LUMEN_ANDROID_STORE_PASSWORD`
- `LUMEN_ANDROID_KEY_ALIAS`
- `LUMEN_ANDROID_KEY_PASSWORD`

Create the fixed Android key in the release environment and back it up securely before first distribution. Never distribute a debug-key APK as the upgradeable release; CI fails release packaging when the fixed key is absent. Increment Android versionCode for every published APK. Credentials/signatures are not generated or committed by the build. Desktop tests are explicitly unsigned and not Apple-notarized.

After hardware and upgrade acceptance, add all four artifacts (windows-x64, macos-arm64, macos-x64, android), HTTPS URLs and SHA-256 digests to the manifest and set published=true. The website then shows working downloads. Clients check the server manifest and open the website for manual installation. A protocol mismatch disables cloud calls while local playback remains available.

## Verification boundaries

Automated checks cover backend session type/role/revocation and cloud merges, desktop packaged runtime/sandbox/SQLite/file Range/migration, and Android compilation/lint/tone-response tests. They do not establish phone battery/background behavior, physical Bluetooth/headphone/phone-call handling, true cloud member playback, macOS hardware behavior or installer upgrade guarantees.

Still required before public release: actual administrator/member playback with the production source; Android physical-device 30-minute screen-off multi-track session and interruption tests; Windows/macOS install and overwrite upgrade; macOS Intel and Apple Silicon runtime/keychain/menu verification; fixed Android release signing and its backup; Linux production-volume restart regression on CI/remote only. No real user audio, credentials or production database contents belong in test artifacts.
