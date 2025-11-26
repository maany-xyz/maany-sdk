const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), workspaceRoot]));
config.resolver = {
  ...(config.resolver ?? {}),
  nodeModulesPaths: Array.from(
    new Set([
      ...(config.resolver?.nodeModulesPaths ?? []),
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ])
  ),
  disableHierarchicalLookup: true,
};

module.exports = config;
