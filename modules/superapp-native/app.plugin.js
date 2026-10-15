// Adds the build phase that installs the embedded Python into the app bundle,
// and the Shortcuts action, which has to be compiled in the app target itself.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const APP_TARGET_FILES = ['DownloadLinkIntent.swift'];

const PHASE_NAME = 'Install Python';

function withAppTargetFiles(config) {
  config = withDangerousMod(config, ['ios', (cfg) => {
    const folder = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
    for (const file of APP_TARGET_FILES) fs.copyFileSync(path.join(__dirname, 'app-target', file), path.join(folder, file));
    return cfg;
  }]);
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const app = project.getTarget('com.apple.product-type.application');
    const group = cfg.modRequest.projectName;
    for (const file of APP_TARGET_FILES) {
      const filepath = `${group}/${file}`;
      if (!project.hasFile(filepath)) IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: group, project, targetUuid: app.uuid });
    }
    return cfg;
  });
}

module.exports = function withSuperappNative(config) {
  config = withAppTargetFiles(config);
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
