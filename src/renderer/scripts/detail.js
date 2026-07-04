const DetailPanel = {
  init() {
    document.getElementById('detail-pull-btn')?.addEventListener('click', async () => {
      if (AppState.selectedRepo) {
        await GitOps.pull(AppState.selectedRepo.path);
      }
    });

    document.getElementById('detail-push-btn')?.addEventListener('click', async () => {
      if (AppState.selectedRepo) {
        await GitOps.push(AppState.selectedRepo.path);
      }
    });

    document.getElementById('detail-fetch-btn')?.addEventListener('click', async () => {
      if (AppState.selectedRepo) {
        await GitOps.fetch(AppState.selectedRepo.path);
      }
    });

    document.getElementById('detail-commit-btn')?.addEventListener('click', () => {
      if (AppState.selectedRepo) {
        GitOps.openCommitModal(AppState.selectedRepo.path);
      }
    });

    document.getElementById('detail-open-btn')?.addEventListener('click', () => {
      if (AppState.selectedRepo) {
        window.gitFinder.fs.showInFinder(AppState.selectedRepo.path);
      }
    });

    document.getElementById('detail-terminal-btn')?.addEventListener('click', () => {
      if (AppState.selectedRepo) {
        Terminal.setCwd(AppState.selectedRepo.path);
        Terminal.openExternal();
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  DetailPanel.init();
});
