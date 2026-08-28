const { registerTrustedHandler } = require('./security');
const localProjectService = require('../services/localProjectService');

function registerLocalProjectsIPC() {
  registerTrustedHandler('localProjects:describe', async (event, directoryPath) => {
    return localProjectService.describeDirectory(directoryPath);
  });

  registerTrustedHandler('localProjects:get', async (event, directoryPath) => {
    return localProjectService.getProject(directoryPath);
  });

  registerTrustedHandler('localProjects:list', async () => {
    return localProjectService.listProjects();
  });

  registerTrustedHandler('localProjects:initialize', async (event, directoryPath, values = {}) => {
    return localProjectService.initializeProject(directoryPath, values);
  });

  registerTrustedHandler('localProjects:update', async (event, directoryPath, values = {}) => {
    return localProjectService.updateProject(directoryPath, values);
  });
}

module.exports = { registerLocalProjectsIPC };
