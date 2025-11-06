const path = require('path');

/**
 * Metro configuration that watches the repository root so local packages resolve.
 */
module.exports = {
  watchFolders: [path.resolve(__dirname, '../../')],
  resolver: {
    nodeModulesPath: [path.resolve(__dirname, 'node_modules')]
  }
};
