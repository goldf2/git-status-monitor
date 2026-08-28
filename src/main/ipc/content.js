const { registerTrustedHandler } = require('./security');
const workspaceContentService = require('../services/workspaceContentService');

const THUMBNAIL_SIZE = Object.freeze({ width: 192, height: 128 });

async function createNativeThumbnailDataUrl(sourcePath, size = THUMBNAIL_SIZE) {
  const { nativeImage } = require('electron');
  const thumbnail = await nativeImage.createThumbnailFromPath(sourcePath, {
    width: Math.min(THUMBNAIL_SIZE.width, Math.max(1, Number(size.width) || THUMBNAIL_SIZE.width)),
    height: Math.min(THUMBNAIL_SIZE.height, Math.max(1, Number(size.height) || THUMBNAIL_SIZE.height))
  });
  if (!thumbnail || thumbnail.isEmpty()) return '';
  return thumbnail.toDataURL();
}

function registerContentIPC(options = {}) {
  if (options.indexFilePath) workspaceContentService.configurePersistence(options.indexFilePath);
  workspaceContentService.configureThumbnailProvider(options.createThumbnail || createNativeThumbnailDataUrl);

  registerTrustedHandler('content:getPreview', async (event, filePath, previewOptions) => {
    return workspaceContentService.getPreview(filePath, previewOptions);
  });

  registerTrustedHandler('content:convertBinaryPlist', async (event, filePath) => {
    return workspaceContentService.convertBinaryPlistPreview(filePath);
  });

  registerTrustedHandler('content:getTextPage', async (event, pageToken) => {
    return workspaceContentService.getTextPage(pageToken);
  });

  registerTrustedHandler('content:releaseTextPage', async (event, pageToken) => {
    return workspaceContentService.releaseTextPage(pageToken);
  });

  registerTrustedHandler('content:getThumbnail', async (event, filePath) => {
    return workspaceContentService.getThumbnail(filePath);
  });

  registerTrustedHandler('content:search', async (event, query, options) => {
    return workspaceContentService.search(query, options);
  });

  registerTrustedHandler('content:getIndexStatus', async () => {
    return workspaceContentService.getIndexStatus();
  });

  registerTrustedHandler('content:invalidateIndex', async () => {
    return workspaceContentService.invalidateIndex();
  });

  registerTrustedHandler('content:cancelIndexBuild', async () => {
    return workspaceContentService.cancelIndexBuild();
  });

  registerTrustedHandler('content:cancelSearch', async () => {
    return workspaceContentService.cancelContentSearch();
  });
}

module.exports = { registerContentIPC, createNativeThumbnailDataUrl };
