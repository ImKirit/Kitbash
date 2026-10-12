// Build settings. Names come from src/brand.js so a rename stays a one file change.
const brand = require('./src/brand');

module.exports = {
  appId: brand.appId,
  productName: brand.productName,
  directories: { output: 'dist' },
  files: ['src/**/*', 'build/icon.png', 'package.json'],
  win: { target: 'nsis', icon: 'build/icon.ico' },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    shortcutName: brand.productName,
  },
  publish: [{ provider: 'github', owner: brand.owner, repo: brand.repo }],
};
