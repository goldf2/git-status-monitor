const BoardRenderer = {
  render(container, board) {
    container.innerHTML = `
      <div class="board-toolbar">
        <button class="board-toolbar-btn" id="board-back-btn">← 白板列表</button>
        <button class="board-toolbar-btn" id="board-add-sticky">+ 便签</button>
        <button class="board-toolbar-btn" id="board-add-repo">+ 仓库</button>
      </div>
      <div class="board-container" id="board-container">
        <div class="board-canvas" id="board-canvas">
          <svg class="board-svg-layer" id="board-svg"></svg>
          <div id="board-components"></div>
        </div>
      </div>
    `;

    this._board = board;
    this._scale = board.viewport?.scale || 1;
    this._offsetX = board.viewport?.x || 0;
    this._offsetY = board.viewport?.y || 0;
    this._isPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._selectedId = null;

    this._setupInteractions();
    this._renderComponents();
    this._updateTransform();
  },

  _setupInteractions() {
    const canvas = document.getElementById('board-canvas');

    canvas.addEventListener('mousedown', (e) => {
      if (e.target === canvas || e.target.classList.contains('board-svg-layer')) {
        this._isPanning = true;
        this._panStartX = e.clientX - this._offsetX;
        this._panStartY = e.clientY - this._offsetY;
        canvas.classList.add('panning');
        this._selectComponent(null);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this._isPanning) {
        this._offsetX = e.clientX - this._panStartX;
        this._offsetY = e.clientY - this._panStartY;
        this._updateTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this._isPanning) {
        this._isPanning = false;
        document.getElementById('board-canvas')?.classList.remove('panning');
        this._saveViewport();
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.2, Math.min(3, this._scale * delta));

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this._offsetX = mouseX - (mouseX - this._offsetX) * (newScale / this._scale);
      this._offsetY = mouseY - (mouseY - this._offsetY) * (newScale / this._scale);
      this._scale = newScale;

      this._updateTransform();
      this._saveViewport();
    }, { passive: false });

    document.getElementById('board-back-btn')?.addEventListener('click', () => {
      AppState.currentBoardId = null;
      App.renderContent();
    });

    document.getElementById('board-add-sticky')?.addEventListener('click', () => {
      this._addComponent({
        type: 'sticky',
        content: '新便签',
        color: '#FEF3C7',
        x: 100 - this._offsetX,
        y: 100 - this._offsetY,
        width: 150,
        height: 100
      });
    });

    document.getElementById('board-add-repo')?.addEventListener('click', async () => {
      const folder = await window.gitFinder.fs.selectFolder();
      if (folder) {
        this._addComponent({
          type: 'repo',
          repoPath: folder,
          x: 100 - this._offsetX,
          y: 100 - this._offsetY,
          width: 260,
          height: 160
        });
      }
    });
  },

  _updateTransform() {
    const components = document.getElementById('board-components');
    const svg = document.getElementById('board-svg');
    if (components) {
      components.style.transform = `translate(${this._offsetX}px, ${this._offsetY}px) scale(${this._scale})`;
      components.style.transformOrigin = '0 0';
    }
    if (svg) {
      svg.style.transform = `translate(${this._offsetX}px, ${this._offsetY}px) scale(${this._scale})`;
      svg.style.transformOrigin = '0 0';
    }
  },

  _saveViewport() {
    if (!this._board) return;
    this._board.viewport = {
      x: this._offsetX,
      y: this._offsetY,
      scale: this._scale
    };
    window.gitFinder.boards.save(this._board.id, this._board);
  },

  _addComponent(componentData) {
    if (!this._board) return;

    const id = 'comp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const component = {
      id,
      zIndex: (this._board.components?.length || 0) + 1,
      ...componentData
    };

    if (!this._board.components) this._board.components = [];
    this._board.components.push(component);

    this._renderComponents();
    window.gitFinder.boards.save(this._board.id, this._board);
  },

  _selectComponent(id) {
    this._selectedId = id;
    document.querySelectorAll('.board-component').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
  },

  _renderComponents() {
    const container = document.getElementById('board-components');
    if (!container || !this._board) return;

    container.innerHTML = (this._board.components || []).map(comp => {
      if (comp.type === 'repo') {
        return this._renderRepoComponent(comp);
      } else if (comp.type === 'sticky') {
        return this._renderStickyComponent(comp);
      } else if (comp.type === 'group') {
        return this._renderGroupComponent(comp);
      }
      return '';
    }).join('');

    this._makeDraggable();
  },

  _renderRepoComponent(comp) {
    const repoInfo = this._getRepoInfo(comp.repoPath);
    return `
      <div class="board-component" data-id="${comp.id}"
           style="left:${comp.x}px;top:${comp.y}px;width:${comp.width}px;z-index:${comp.zIndex || 1};">
        <div class="board-component-header">
          <span>📁 ${repoInfo.name}</span>
          <span style="font-size:10px;color:#86868b;">${repoInfo.status || ''}</span>
        </div>
        <div class="board-component-body">
          <div style="font-size:11px;color:#86868b;margin-bottom:4px;">${comp.repoPath}</div>
          <div style="font-size:11px;">${repoInfo.desc || ''}</div>
        </div>
      </div>
    `;
  },

  _renderStickyComponent(comp) {
    return `
      <div class="board-component board-component-sticky" data-id="${comp.id}"
           style="left:${comp.x}px;top:${comp.y}px;width:${comp.width}px;z-index:${comp.zIndex || 1};">
        <div class="board-component-body" style="padding:10px;">
          <div style="font-size:12px;line-height:1.4;">${comp.content || ''}</div>
        </div>
      </div>
    `;
  },

  _renderGroupComponent(comp) {
    return `
      <div class="board-component" data-id="${comp.id}"
           style="left:${comp.x}px;top:${comp.y}px;width:${comp.width}px;height:${comp.height}px;z-index:${comp.zIndex || 0};background:rgba(0,122,255,0.05);border:2px dashed rgba(0,122,255,0.3);">
        <div class="board-component-header" style="background:transparent;border:none;">
          <span style="color:${comp.color || '#007AFF'};font-weight:600;">${comp.name || '组'}</span>
        </div>
      </div>
    `;
  },

  _getRepoInfo(repoPath) {
    const name = repoPath.split(/[\\/]/).pop() || repoPath;
    return { name, status: '', desc: '' };
  },

  _makeDraggable() {
    document.querySelectorAll('.board-component').forEach(el => {
      const header = el.querySelector('.board-component-header') || el;
      let isDragging = false;
      let startX, startY, startLeft, startTop;

      header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = el.offsetLeft;
        startTop = el.offsetTop;
        e.stopPropagation();

        const id = el.dataset.id;
        const comp = this._board.components.find(c => c.id === id);
        if (comp) {
          const maxZ = Math.max(...this._board.components.map(c => c.zIndex || 0));
          comp.zIndex = maxZ + 1;
          el.style.zIndex = comp.zIndex;
          this._selectComponent(id);
        }
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - startX) / this._scale;
        const dy = (e.clientY - startY) / this._scale;
        el.style.left = (startLeft + dx) + 'px';
        el.style.top = (startTop + dy) + 'px';
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          const id = el.dataset.id;
          const comp = this._board?.components?.find(c => c.id === id);
          if (comp) {
            comp.x = el.offsetLeft;
            comp.y = el.offsetTop;
            window.gitFinder.boards.save(this._board.id, this._board);
          }
        }
      });
    });
  }
};
