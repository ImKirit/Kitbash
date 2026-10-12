// The one place that knows what this product is called and where it lives.
// Renaming the launcher means editing this file (and nothing else in src/).
'use strict';

const brand = {
  productName: 'Kitbash',
  appId: 'dev.imkirit.kitbash',
  owner: 'ImKirit',
  repo: 'Kitbash',
  modsRepo: 'Kitbash-Mods',
  modsBranch: 'main',
  // Folder the engine parks foreign loader files in, inside a game folder.
  asideName: '.kitbash-aside',
  // Prefix of exported modpack codes.
  packPrefix: 'KB1-',
};

brand.officialCatalogUrl = `https://raw.githubusercontent.com/${brand.owner}/${brand.modsRepo}/${brand.modsBranch}/catalog.json`;
brand.homepage = `https://github.com/${brand.owner}/${brand.repo}`;
brand.userAgent = brand.productName;

module.exports = brand;
