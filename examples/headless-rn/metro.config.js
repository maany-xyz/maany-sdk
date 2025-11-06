const path = require('path');

module.exports = {
  watchFolders: [path.resolve(__dirname, '../../')],
  resolver: {
    nodeModulesPath: [path.resolve(__dirname, 'node_modules')]
  }
};
