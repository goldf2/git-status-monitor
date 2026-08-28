const { registerTrustedHandler } = require('./security');
const fileOperationService = require('../services/fileOperationService');

function registerFileOperationsIPC() {
  registerTrustedHandler('fileOps:getHistory', async (event, limit) => {
    return fileOperationService.getHistory(limit);
  });

  registerTrustedHandler('fileOps:getRecoveryStatus', async () => {
    return fileOperationService.getRecoveryStatus();
  });

  registerTrustedHandler('fileOps:previewTransfer', async (event, paths, destinationDirectory, mode, options) => {
    return fileOperationService.previewTransfer(paths, destinationDirectory, mode, options);
  });

  registerTrustedHandler('fileOps:applyTransfer', async (event, request) => {
    return fileOperationService.applyTransfer(request);
  });

  registerTrustedHandler('fileOps:getTransferStatus', async (event, operationId) => {
    return fileOperationService.getTransferStatus(operationId);
  });

  registerTrustedHandler('fileOps:cancelTransfer', async (event, operationId) => {
    return fileOperationService.cancelTransfer(operationId);
  });

  registerTrustedHandler('fileOps:move', async (event, paths, destinationDirectory) => {
    return fileOperationService.move(paths, destinationDirectory);
  });

  registerTrustedHandler('fileOps:copy', async (event, paths, destinationDirectory) => {
    return fileOperationService.copy(paths, destinationDirectory);
  });

  registerTrustedHandler('fileOps:rename', async (event, sourcePath, nextName) => {
    return fileOperationService.rename(sourcePath, nextName);
  });

  registerTrustedHandler('fileOps:previewBatchRename', async (event, sourcePaths, options) => {
    return fileOperationService.previewBatchRename(sourcePaths, options);
  });

  registerTrustedHandler('fileOps:applyBatchRename', async (event, request) => {
    return fileOperationService.applyBatchRename(request);
  });

  registerTrustedHandler('fileOps:trash', async (event, paths) => {
    return fileOperationService.trash(paths);
  });

  registerTrustedHandler('fileOps:createDirectory', async (event, parentPath, name) => {
    return fileOperationService.createDirectory(parentPath, name);
  });

  registerTrustedHandler('fileOps:createFile', async (event, parentPath, name) => {
    return fileOperationService.createFile(parentPath, name);
  });

  registerTrustedHandler('fileOps:previewImport', async (event, sourcePaths, destinationDirectory) => {
    return fileOperationService.previewImport(sourcePaths, destinationDirectory);
  });

  registerTrustedHandler('fileOps:applyImport', async (event, request) => {
    return fileOperationService.applyImport(request);
  });

  registerTrustedHandler('fileOps:undo', async (event, operationId) => {
    return fileOperationService.undo(operationId);
  });

  registerTrustedHandler('fileOps:redo', async (event, operationId) => {
    return fileOperationService.redo(operationId);
  });
}

module.exports = { registerFileOperationsIPC };
