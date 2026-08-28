const { registerTrustedHandler } = require('./security');
const projectTaskProjectionService = require('../services/projectTaskProjectionService');
const projectTaskGitEvidenceService = require('../services/projectTaskGitEvidenceService');
const projectTaskWritebackService = require('../services/projectTaskWritebackService');

function registerProjectTasksIPC() {
  registerTrustedHandler('projectTasks:getPortfolio', async (event, options = {}) => {
    return projectTaskProjectionService.getPortfolio({
      forceRefresh: Boolean(options?.forceRefresh)
    });
  });

  registerTrustedHandler('projectTasks:getGitEvidence', async (event, taskKey, options = {}) => {
    return projectTaskGitEvidenceService.getTaskEvidence(taskKey, {
      forceRefresh: Boolean(options?.forceRefresh)
    });
  });

  registerTrustedHandler('projectTasks:previewStatusChange', async (event, taskKey, targetStatus) => {
    return projectTaskWritebackService.previewStatusChange(taskKey, targetStatus);
  });

  registerTrustedHandler('projectTasks:applyStatusChange', async (event, taskKey, request = {}) => {
    return projectTaskWritebackService.applyStatusChange(taskKey, request);
  });

  registerTrustedHandler('projectTasks:previewTaskUpdate', async (event, taskKey, changes = {}) => {
    return projectTaskWritebackService.previewTaskUpdate(taskKey, changes);
  });

  registerTrustedHandler('projectTasks:applyTaskUpdate', async (event, taskKey, request = {}) => {
    return projectTaskWritebackService.applyTaskUpdate(taskKey, request);
  });

  registerTrustedHandler('projectTasks:previewTaskCreate', async (event, projectId, values = {}) => {
    return projectTaskWritebackService.previewTaskCreate(projectId, values);
  });

  registerTrustedHandler('projectTasks:applyTaskCreate', async (event, projectId, request = {}) => {
    return projectTaskWritebackService.applyTaskCreate(projectId, request);
  });

  registerTrustedHandler('projectTasks:previewMilestoneUpdate', async (event, milestoneKey, changes = {}) => {
    return projectTaskWritebackService.previewMilestoneUpdate(milestoneKey, changes);
  });

  registerTrustedHandler('projectTasks:applyMilestoneUpdate', async (event, milestoneKey, request = {}) => {
    return projectTaskWritebackService.applyMilestoneUpdate(milestoneKey, request);
  });
}

module.exports = { registerProjectTasksIPC };
