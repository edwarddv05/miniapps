/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'share',
  name: 'Downloader',
  bundleIdentifier: '.share',
  deploymentTarget: '16.4',
  frameworks: ['UniformTypeIdentifiers'],
});
