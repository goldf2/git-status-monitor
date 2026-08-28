const { BrowserWindow, dialog } = require('electron');
const { registerTrustedHandler } = require('./security');
const relationshipBoardService = require('../services/relationshipBoardService');
const relationshipBoardImportService = require('../services/relationshipBoardImportService');
const coolifyReadOnlyConnectorService = require('../services/coolifyReadOnlyConnectorService');

async function selectRelationshipImportFile(event) {
  const options = {
    title: '导入关系白板 JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON 文件', extensions: ['json'] }]
  };
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  return relationshipBoardImportService.previewFromFile(result.filePaths[0]);
}

function registerRelationshipBoardsIPC() {
  registerTrustedHandler('relationshipBoards:get', async () => relationshipBoardService.load());
  registerTrustedHandler('relationshipBoards:save', async (event, store) => relationshipBoardService.save(store));
  registerTrustedHandler('relationshipBoards:previewImport', selectRelationshipImportFile);
  registerTrustedHandler('relationshipBoards:applyImport', async (event, request) => {
    return relationshipBoardImportService.applyImport(request);
  });
  registerTrustedHandler('relationshipBoards:previewCoolify', async (event, request) => {
    return coolifyReadOnlyConnectorService.preview(request);
  });
  registerTrustedHandler('relationshipBoards:applyCoolify', async (event, request) => {
    return relationshipBoardImportService.applyImport(request);
  });
}

module.exports = { registerRelationshipBoardsIPC, selectRelationshipImportFile };
