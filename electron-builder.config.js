// Build settings. Names come from src/brand.js so a rename stays a one file change.
const brand = require('./src/brand');

module.exports = {
  appId: brand.appId,
  productName: brand.productName,
  directories: { output: 'dist' },
  files: ['src/**/*', 'build/icon.png', 'package.json'],
  win: { target: 'nsis', icon: 'build/icon.ico' },
  nsis: {
    // no spaces in the file name: GitHub renames such uploads and the updater would not find them
    artifactName: '${productName}-Setup-${version}.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    shortcutName: brand.productName,
  },
  publish: [{ provider: 'github', owner: brand.owner, repo: brand.repo }],
};
