import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.jdsoliveiraa.fitdeck.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
    input: "src/plugin.ts",
    output: {
        file: `${sdPlugin}/bin/plugin.js`,
        format: "es",
        sourcemap: isWatching,
        sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
            return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
        }
    },
    external: [],
    plugins: [
        {
            name: "watch-externals",
            buildStart: function () {
                this.addWatchFile(`${sdPlugin}/manifest.json`);
            },
        },
        typescript({
            mapRoot: isWatching ? "./" : undefined
        }),
        nodeResolve({
            browser: false,
            exportConditions: ["node"],
            preferBuiltins: true
        }),
        commonjs(),
        !isWatching && terser(),
        {
            name: "emit-module-package-file",
            generateBundle() {
                this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
            }
        },
        {
            name: "generate-ble-app-bundle",
            writeBundle() {
                const appBase = `${sdPlugin}/ble-helper/FitDeckBLE.app/Contents`;
                const macosDir = `${appBase}/MacOS`;
                fs.mkdirSync(macosDir, { recursive: true });

                fs.writeFileSync(`${appBase}/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>com.jdsoliveiraa.fitdeck.ble-helper</string>
\t<key>CFBundleName</key>
\t<string>FitDeck BLE</string>
\t<key>CFBundleVersion</key>
\t<string>1.0</string>
\t<key>CFBundleExecutable</key>
\t<string>FitDeckBLE</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>LSBackgroundOnly</key>
\t<true/>
\t<key>NSBluetoothAlwaysUsageDescription</key>
\t<string>FitDeck needs Bluetooth to connect to and control your treadmill.</string>
</dict>
</plist>
`);

                const launcher = `#!/bin/bash
# FitDeck BLE Helper — runs noble in a properly entitled app bundle
# Path: ble-helper/FitDeckBLE.app/Contents/MacOS/FitDeckBLE
#   → ../../.. = ble-helper/
#   → ../../../.. = .sdPlugin/
HELPER_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
PLUGIN_DIR="$(cd "$HELPER_DIR/.." && pwd)"
NODE="$HOME/Library/Application Support/com.elgato.StreamDeck/NodeJS/20.20.0/node"

if [ ! -f "$NODE" ]; then
  NODE="$(find "$HOME/Library/Application Support/com.elgato.StreamDeck/NodeJS" -name node -type f 2>/dev/null | head -1)"
fi

export NODE_PATH="$PLUGIN_DIR/node_modules"
exec "$NODE" "$HELPER_DIR/ble-server.mjs" "$PLUGIN_DIR"
`;
                fs.writeFileSync(`${macosDir}/FitDeckBLE`, launcher, { mode: 0o755 });
            }
        }
    ]
};

export default config;
