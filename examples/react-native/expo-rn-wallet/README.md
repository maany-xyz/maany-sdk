# Expo RN Wallet playground

An Expo Router app that integrates the local `@maany/sdk-react-native` package so we can hit the MPC
coordinator end-to-end from a vanilla Expo project.

## Install & run

```bash
cd examples/react-native/expo-rn-wallet
npm install
npm run ios   # or: npm run android / npm run web / npm start
```

On first run for iOS, generate the native project and install pods so the Maany native bindings + OpenSSL
slice are linked:

```bash
npx expo prebuild ios
cd ios && pod install
```

Patch `ios/Podfile` once with the OpenSSL embed phase (see `.codex/Codex.md` in the repo) or copy the
snippet below and re-run `pod install`:

```ruby
  installer.aggregate_targets.each do |aggregate|
    next unless aggregate.pod_targets.any? { |t| t.name == 'MaanyMpc' }

    aggregate.user_targets.each do |user_target|
      next if user_target.shell_script_build_phases.any? { |p| p.name == '[Maany] Embed OpenSSL' }

      phase = user_target.new_shell_script_build_phase('[Maany] Embed OpenSSL')
      phase.shell_path = '/bin/sh'
      phase.shell_script = <<~'SH'
        set -euo pipefail
        if [ -z "${FRAMEWORKS_FOLDER_PATH:-}" ]; then
          exit 0
        fi
        MAANY_ROOT="${PODS_ROOT}/../../node_modules/@maanyio/mpc-rn-bare/ios"
        if [[ "${PLATFORM_NAME}" == "iphonesimulator" ]]; then
          SLICE="ios-arm64_x86_64-simulator"
        else
          SLICE="ios-arm64_arm64e"
        fi
        FRAMEWORK_SRC="${MAANY_ROOT}/dist/openssl.xcframework/${SLICE}/openssl.framework"
        FRAMEWORK_DEST="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}/openssl.framework"
        rm -rf "${FRAMEWORK_DEST}"
        mkdir -p "$(dirname "${FRAMEWORK_DEST}")"
        cp -R "${FRAMEWORK_SRC}" "${FRAMEWORK_DEST}"
      SH
    end
  end
```

## Wallet tab

The default Expo tabs are intact, plus a new **Wallet** tab that uses the SDK helper methods:

- Enter your coordinator URL + optional token, then tap **Connect & Run DKG**.
- The UI listens to the adapter events to show wallet status, derived address, active session ID and key ID.
- Use the message box to sign arbitrary bytes; the signature (DER by default) is shown as hex.
- Tap **Disconnect** to clear in-memory storage and reset the adapter.

Set `DEFAULT_SERVER_URL` in `app/(tabs)/wallet.tsx` or pass `EXPO_PUBLIC_MPC_SERVER_URL` when starting Metro
if you want a different default coordinator.
