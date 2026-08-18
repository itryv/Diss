'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Electron opens camera devices from its Helper processes. electron-builder's
 * mac.extendInfo only updates the main app, so macOS still warns unless the
 * Continuity Camera declaration is copied into each Helper.app before signing.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const frameworks = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Frameworks');
  for (const entry of fs.readdirSync(frameworks, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.includes(' Helper') || !entry.name.endsWith('.app')) continue;
    const plist = path.join(frameworks, entry.name, 'Contents', 'Info.plist');
    if (!fs.existsSync(plist)) continue;
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :NSCameraUseContinuityCameraDeviceType true', plist], { stdio: 'ignore' });
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSCameraUseContinuityCameraDeviceType bool true', plist], { stdio: 'ignore' });
    }
  }
};
