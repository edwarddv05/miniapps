// Adds the build phase that installs the embedded Python into the app bundle.
const { withXcodeProject } = require('expo/config-plugins');

const PHASE_NAME = 'Install Python';

module.exports = function withSuperappNative(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const app = project.getTarget('com.apple.product-type.application');
    if (!app) throw new Error('superapp-native: no application target found');

    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const exists = Object.values(phases).some((phase) => typeof phase === 'object' && phase.name === `"${PHASE_NAME}"`);
    if (!exists) {
      const { buildPhase } = project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, app.uuid, {
        shellPath: '/bin/sh',
        shellScript: '"$PROJECT_DIR/../modules/superapp-native/scripts/install-python.sh"',
      });
      // Run on every build: the script decides what to copy.
      buildPhase.alwaysOutOfDate = 1;
    }

    // The script reads files outside the project folder.
    const lists = project.hash.project.objects.XCConfigurationList;
    const configurations = project.hash.project.objects.XCBuildConfiguration;
    for (const reference of lists[app.target.buildConfigurationList].buildConfigurations) {
      configurations[reference.value].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
    }
    return cfg;
  });
};
