"""Structural security/package checks. These do not compile or execute Swift."""
from pathlib import Path
import json
import plistlib
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CarrierChecks(unittest.TestCase):
    def test_background_modes_and_usage_descriptions(self):
        info = plistlib.loads((ROOT / 'RitmNative/Info.plist').read_bytes())
        self.assertIn('location', info['UIBackgroundModes'])
        self.assertTrue(info['NSLocationWhenInUseUsageDescription'])
        self.assertTrue(info['NSLocationAlwaysAndWhenInUseUsageDescription'])
        self.assertTrue(info['NSMotionUsageDescription'])
        self.assertNotIn('NSHealthShareUsageDescription', info)

    def test_trusted_main_frame_bridge_and_safe_serialization(self):
        text = (ROOT / 'RitmNative/WebView.swift').read_text('utf-8')
        self.assertIn('message.frameInfo.isMainFrame', text)
        self.assertIn('securityOrigin.protocol == "ritm"', text)
        self.assertIn('securityOrigin.host == "app"', text)
        self.assertIn('JSONSerialization.data', text)
        self.assertIn('base64EncodedString()', text)

    def test_manifest_allowlist_and_escape_checks(self):
        text = (ROOT / 'RitmNative/LocalAssets.swift').read_text('utf-8')
        self.assertIn('manifest.files.contains(path)', text)
        self.assertIn('pathComponents.contains("..")', text)
        self.assertIn('pathComponents.contains(".local")', text)
        self.assertIn('URLResponse', text)

    def test_build_is_explicitly_unsigned_and_hardware_status_documented(self):
        text = (ROOT / 'README.md').read_text('utf-8')
        self.assertIn('BUILD-STATUS.md', text)
        script = (ROOT / 'scripts/build-macos.sh').read_text('utf-8')
        self.assertIn('CODE_SIGNING_ALLOWED=NO', script)
        self.assertIn('xcodegen generate', script)
        self.assertIn('xcodebuild', script)

    def test_packaging_explicit_files_and_no_sensitive_copy(self):
        script = (ROOT / 'scripts/package-assets.ps1').read_text('utf-8')
        self.assertNotIn('Copy-Item -Recurse', script)
        self.assertIn("'.local'", script)
        self.assertIn('asset-manifest.json', script)

    def test_packaged_files_equal_manifest(self):
        assets = ROOT / 'RitmNative/WebAssets'
        manifest = json.loads((assets / 'asset-manifest.json').read_text('utf-8-sig'))
        actual = {str(p.relative_to(assets)).replace('\\', '/') for p in assets.rglob('*') if p.is_file()}
        self.assertEqual(actual, set(manifest['files']) | {'asset-manifest.json'})
        self.assertIn('index.html', actual)
        self.assertFalse(any(part.startswith('.') for file in actual for part in file.split('/')))

    def test_confirmation_and_bounded_text_share(self):
        text = (ROOT / 'RitmNative/WebView.swift').read_text('utf-8')
        self.assertIn('runJavaScriptConfirmPanelWithMessage', text)
        self.assertIn('completionHandler(true)', text)
        self.assertIn('UIActivityViewController', text)
        self.assertIn('content.utf8.count <= 64 * 1024 * 1024', text)
        self.assertIn('values.isExcludedFromBackup = true', text)
        self.assertIn('completionWithItemsHandler', text)
        self.assertIn('extensionName == "json"', text)
        self.assertIn('extensionName == "ics"', text)

    def test_recording_and_recovery_safety_conditions(self):
        engine = (ROOT / 'RitmNative/RunEngine.swift').read_text('utf-8')
        model = (ROOT / 'RitmNative/RunModel.swift').read_text('utf-8')
        store = (ROOT / 'RitmNative/RunStore.swift').read_text('utf-8')
        self.assertIn('location.allowsBackgroundLocationUpdates = true', engine)
        self.assertIn('pedometer.startUpdates', engine)
        self.assertIn('pedometer.queryPedometerData', engine)
        self.assertIn('recoverAfterReopening()', engine)
        self.assertIn('accuracy <= 40', model)
        self.assertIn('seconds > 20', model)
        self.assertIn('distanceMetres: gap ? 0 : distance', model)
        self.assertIn('.atomic', store)
        self.assertIn('.completeFileProtectionUntilFirstUserAuthentication', store)

    def test_native_jitter_filter_guard_present(self):
        model = (ROOT / 'RitmNative/RunModel.swift').read_text('utf-8')
        self.assertIn('let minimumDistance = max(3, min(10, max(previous.accuracy, accuracy) / 2))', model)
        self.assertIn('if !gap && (seconds < 2 || distance < minimumDistance)', model)

if __name__ == '__main__':
    unittest.main()
