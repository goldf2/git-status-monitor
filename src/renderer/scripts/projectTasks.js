Object.assign(App, {
  async renderProjectTasks(forceRefresh = false) {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    if (!contentArea) return;
    if (emptyState) emptyState.style.display = 'none';

    if (forceRefresh) {
      AppState.taskGitEvidenceByKey.clear();
      AppState.taskGitEvidenceLoading.clear();
    }

    if (!AppState.taskPortfolio || forceRefresh) {
      AppState.taskPortfolioLoading = true;
      contentArea.innerHTML = `
        <div class="task-loading" role="status">
          <div class="loading-spinner"></div>
          <div>${forceRefresh ? '正在重读任务投影…' : '正在连接 Local Project Manager…'}</div>
        </div>`;
      try {
        AppState.taskPortfolio = await window.gitFinder.projectTasks.getPortfolio({ forceRefresh });
      } catch (error) {
        AppState.taskPortfolio = {
          success: false,
          readOnly: true,
          projects: [],
          tasks: [],
          milestones: [],
          timeline: [],
          warnings: [],
          error: error?.message || String(error)
        };
      } finally {
        AppState.taskPortfolioLoading = false;
      }
    }

    this.renderProjectTasksView();
  },

  getFilteredProjectTasks() {
    const portfolio = AppState.taskPortfolio || {};
    const filters = AppState.taskFilters || {};
    const query = String(AppState.searchQuery || '').trim().toLocaleLowerCase('zh-CN');
    return (portfolio.tasks || []).filter(task => {
      if (filters.projectId !== 'all' && task.projectId !== filters.projectId) return false;
      if (filters.status === 'open' && task.status === '已验收完成') return false;
      if (!['all', 'open'].includes(filters.status) && task.status !== filters.status) return false;
      if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
      if (filters.leafOnly && !task.isLeaf) return false;
      if (!query) return true;
      const haystack = [
        task.title, task.taskId, task.projectName, task.projectId, task.stageName,
        task.owner, task.status, task.priority, task.nextAction
      ].join(' ').toLocaleLowerCase('zh-CN');
      return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
    });
  },

  getFilteredProjectTimeline() {
    const portfolio = AppState.taskPortfolio || {};
    const filters = AppState.taskFilters || {};
    const category = AppState.taskTimelineCategory || 'all';
    const query = String(AppState.searchQuery || '').trim().toLocaleLowerCase('zh-CN');
    return (portfolio.timeline || []).filter(event => {
      if (filters.projectId !== 'all' && event.projectId !== filters.projectId) return false;
      const categories = Array.isArray(event.categories) ? event.categories : [event.category];
      if (category !== 'all' && !categories.includes(category)) return false;
      if (!query) return true;
      const haystack = [
        event.summary, event.detail, event.type, event.status, event.actor,
        event.projectName, event.projectId, event.taskTitle, event.taskId,
        event.objectType, event.objectId, event.reference,
        event.evidence?.summary, event.evidence?.type
      ].join(' ').toLocaleLowerCase('zh-CN');
      return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
    });
  },

  getFilteredProjectMilestones() {
    const portfolio = AppState.taskPortfolio || {};
    const filters = AppState.taskFilters || {};
    const statusFilter = AppState.milestoneStatusFilter || 'open';
    const query = String(AppState.searchQuery || '').trim().toLocaleLowerCase('zh-CN');
    return (portfolio.milestones || []).filter(milestone => {
      if (filters.projectId !== 'all' && milestone.projectId !== filters.projectId) return false;
      if (statusFilter === 'open' && milestone.status === '已验收完成') return false;
      if (!['all', 'open'].includes(statusFilter) && milestone.status !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        milestone.name, milestone.milestoneId, milestone.projectName, milestone.projectId,
        milestone.stageName, milestone.stageId, milestone.status, milestone.targetDate,
        milestone.acceptanceSummary
      ].join(' ').toLocaleLowerCase('zh-CN');
      return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
    });
  },

  getFilteredProjectRelationTasks() {
    return ProjectTaskRelations.filterTasks(AppState.taskPortfolio?.tasks || [], {
      projectId: AppState.taskFilters?.projectId || 'all',
      query: AppState.searchQuery || ''
    });
  },

  renderProjectTasksView() {
    const contentArea = document.getElementById('content-area');
    const portfolio = AppState.taskPortfolio || {};
    if (!contentArea) return;

    if (!portfolio.success) {
      contentArea.innerHTML = `
        <section class="task-connection-empty" aria-labelledby="task-connection-title">
          <div class="task-empty-symbol" aria-hidden="true">⛓</div>
          <h2 id="task-connection-title">未连接到任务投影</h2>
          <p>${this.escapeHtml(portfolio.error || '未发现 Local Project Manager 的项目注册表。')}</p>
          <p class="task-empty-help">GitFinder 只会读取受管目录内的 <code>portfolio/projects.csv</code> 与项目投影，不会修改任务 CSV。</p>
          <button class="btn btn-primary" id="task-retry-connection" type="button">重新发现</button>
        </section>`;
      contentArea.querySelector('#task-retry-connection')?.addEventListener('click', () => this.renderProjectTasks(true));
      this.updateStatusBar();
      return;
    }

    const allTasks = portfolio.tasks || [];
    const leafTasks = allTasks.filter(task => task.isLeaf);
    const visibleTasks = this.getFilteredProjectTasks();
    const allTimeline = portfolio.timeline || [];
    const visibleTimeline = this.getFilteredProjectTimeline();
    const isTimeline = AppState.taskViewMode === 'timeline';
    const allMilestones = portfolio.milestones || [];
    const visibleMilestones = this.getFilteredProjectMilestones();
    const isMilestones = AppState.taskViewMode === 'milestones';
    const visibleRelationTasks = this.getFilteredProjectRelationTasks();
    const isRelations = AppState.taskViewMode === 'relations';
    const relationMetrics = ProjectTaskRelations.metrics(
      allTasks,
      portfolio.dependencies || [],
      AppState.taskFilters.projectId
    );
    const projectTimeline = allTimeline.filter(event => (
      AppState.taskFilters.projectId === 'all' || event.projectId === AppState.taskFilters.projectId
    ));
    const openCount = leafTasks.filter(task => task.status !== '已验收完成').length;
    const blockedCount = leafTasks.filter(task => task.status === '阻塞').length;
    const overdueCount = leafTasks.filter(task => task.overdue).length;
    const acceptanceCount = leafTasks.filter(task => task.status === '所有自动检查通过，待人工验收').length;
    const timelineHasCategory = (event, category) => (
      Array.isArray(event.categories) ? event.categories : [event.category]
    ).includes(category);
    const timelineTestCount = projectTimeline.filter(event => timelineHasCategory(event, 'test')).length;
    const timelineAcceptanceCount = projectTimeline.filter(event => timelineHasCategory(event, 'acceptance')).length;
    const timelineAutomationCount = projectTimeline.filter(event => timelineHasCategory(event, 'automation')).length;
    const milestoneProjectSet = allMilestones.filter(milestone => (
      AppState.taskFilters.projectId === 'all' || milestone.projectId === AppState.taskFilters.projectId
    ));
    const milestoneOverdueCount = milestoneProjectSet.filter(milestone => milestone.overdue).length;
    const milestoneDueSoonCount = milestoneProjectSet.filter(milestone => milestone.dueSoon).length;
    const milestoneCompletedCount = milestoneProjectSet.filter(milestone => milestone.status === '已验收完成').length;
    const statuses = [...new Set((isMilestones ? allMilestones : allTasks).map(item => item.status).filter(Boolean))];
    const priorities = [...new Set(allTasks.map(task => task.priority).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const selectableTasks = isRelations ? visibleRelationTasks : visibleTasks;
    const selectedStillVisible = selectableTasks.some(task => task.key === AppState.selectedTaskKey);
    if (!selectedStillVisible) AppState.selectedTaskKey = selectableTasks[0]?.key || null;
    const selectedTask = selectableTasks.find(task => task.key === AppState.selectedTaskKey) || null;
    const selectedMilestoneStillVisible = visibleMilestones.some(milestone => milestone.key === AppState.selectedMilestoneKey);
    if (!selectedMilestoneStillVisible) AppState.selectedMilestoneKey = visibleMilestones[0]?.key || null;
    const selectedMilestone = visibleMilestones.find(milestone => milestone.key === AppState.selectedMilestoneKey) || null;
    const warnings = portfolio.warnings || [];

    contentArea.innerHTML = `
      <section class="task-workspace" aria-labelledby="task-workspace-title">
        <header class="task-workspace-header">
          <div class="task-heading-block">
            <div class="task-title-row">
              <h1 id="task-workspace-title">开发任务</h1>
              <span class="task-source-badge" title="所有任务事实由 Local Project Manager 维护和写入">Local Project Manager · 权威数据</span>
            </div>
            <p>跨项目查看任务、里程碑、持久化时间线、验收证据和关联仓库；写回继续由权威适配器确认执行。</p>
          </div>
          <div class="task-source-meta">
            <span title="${this.escapeHtml(portfolio.connector?.registryPath || '')}">${portfolio.projects.length} 个项目</span>
            <span>重读于 ${this.escapeHtml(this.formatTaskTimestamp(portfolio.refreshedAt))}</span>
            <button class="btn btn-small btn-primary" id="task-create" type="button">新建任务</button>
            <button class="btn btn-small" id="task-refresh" type="button">重读投影</button>
          </div>
        </header>

        ${warnings.length ? `
          <div class="task-warning-strip" role="status">
            <div class="task-warning-title">数据新鲜度提醒</div>
            <div class="task-warning-list">
              ${warnings.slice(0, 4).map(warning => `<span class="task-warning-item" title="${this.escapeHtml(warning.path || '')}">${this.escapeHtml(this.getTaskWarningLabel(warning))}</span>`).join('')}
              ${warnings.length > 4 ? `<span class="task-warning-more">+${warnings.length - 4}</span>` : ''}
            </div>
          </div>` : ''}

        <div class="task-metrics" aria-label="任务摘要">
          ${isTimeline ? `
            ${this.getTaskMetricHtml('历史事件', projectTimeline.length, 'info')}
            ${this.getTaskMetricHtml('测试相关', timelineTestCount, timelineTestCount ? 'success' : 'muted')}
            ${this.getTaskMetricHtml('验收记录', timelineAcceptanceCount, timelineAcceptanceCount ? 'warning' : 'muted')}
            ${this.getTaskMetricHtml('自动化事件', timelineAutomationCount, timelineAutomationCount ? 'info' : 'muted')}
          ` : isMilestones ? `
            ${this.getTaskMetricHtml('里程碑', milestoneProjectSet.length, 'info')}
            ${this.getTaskMetricHtml('已逾期', milestoneOverdueCount, milestoneOverdueCount ? 'danger' : 'muted')}
            ${this.getTaskMetricHtml('七日内到期', milestoneDueSoonCount, milestoneDueSoonCount ? 'warning' : 'muted')}
            ${this.getTaskMetricHtml('已完成', milestoneCompletedCount, milestoneCompletedCount ? 'success' : 'muted')}
          ` : isRelations ? `
            ${this.getTaskMetricHtml('依赖连线', relationMetrics.dependencyCount, relationMetrics.dependencyCount ? 'info' : 'muted')}
            ${this.getTaskMetricHtml('关联任务', relationMetrics.relatedTaskCount, relationMetrics.relatedTaskCount ? 'info' : 'muted')}
            ${this.getTaskMetricHtml('验收待处理', relationMetrics.pendingAcceptanceCount, relationMetrics.pendingAcceptanceCount ? 'warning' : 'success')}
            ${this.getTaskMetricHtml('已阻塞', relationMetrics.blockedTaskCount, relationMetrics.blockedTaskCount ? 'danger' : 'muted')}
          ` : `
            ${this.getTaskMetricHtml('开放任务', openCount, 'info')}
            ${this.getTaskMetricHtml('已逾期', overdueCount, overdueCount ? 'danger' : 'muted')}
            ${this.getTaskMetricHtml('已阻塞', blockedCount, blockedCount ? 'danger' : 'muted')}
            ${this.getTaskMetricHtml('待人工验收', acceptanceCount, acceptanceCount ? 'warning' : 'muted')}
          `}
        </div>

        <div class="task-filter-row" aria-label="任务筛选">
          <label>项目
            <select id="task-project-filter">
              <option value="all">全部项目</option>
              ${portfolio.projects.map(project => `<option value="${this.escapeHtml(project.projectId)}" ${AppState.taskFilters.projectId === project.projectId ? 'selected' : ''}>${this.escapeHtml(project.name)}</option>`).join('')}
            </select>
          </label>
          ${isTimeline ? `
            <label>事件类型
              <select id="task-timeline-category-filter">
                ${[
                  ['all', '全部事件'], ['activity', '人工与计划活动'], ['test', '测试相关'],
                  ['evidence', '其他证据'], ['acceptance', '验收记录'], ['automation', '自动化运行']
                ].map(([value, label]) => `<option value="${value}" ${AppState.taskTimelineCategory === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
            <span class="task-timeline-readonly">只读历史 · 不含临时 Git 状态</span>
          ` : isMilestones ? `
            <label>里程碑状态
              <select id="milestone-status-filter">
                <option value="open" ${AppState.milestoneStatusFilter === 'open' ? 'selected' : ''}>未完成</option>
                <option value="all" ${AppState.milestoneStatusFilter === 'all' ? 'selected' : ''}>全部状态</option>
                ${statuses.map(status => `<option value="${this.escapeHtml(status)}" ${AppState.milestoneStatusFilter === status ? 'selected' : ''}>${this.escapeHtml(status)}</option>`).join('')}
              </select>
            </label>
            <span class="task-timeline-readonly">正式里程碑 · 应用前必须人工确认</span>
          ` : isRelations ? `
            <span class="task-timeline-readonly">只读门禁 · 依赖与验收事实由 Local Project Manager 维护</span>
          ` : `
            <label>状态
              <select id="task-status-filter">
                <option value="open" ${AppState.taskFilters.status === 'open' ? 'selected' : ''}>未完成</option>
                <option value="all" ${AppState.taskFilters.status === 'all' ? 'selected' : ''}>全部状态</option>
                ${statuses.map(status => `<option value="${this.escapeHtml(status)}" ${AppState.taskFilters.status === status ? 'selected' : ''}>${this.escapeHtml(status)}</option>`).join('')}
              </select>
            </label>
            <label>优先级
              <select id="task-priority-filter">
                <option value="all">全部</option>
                ${priorities.map(priority => `<option value="${this.escapeHtml(priority)}" ${AppState.taskFilters.priority === priority ? 'selected' : ''}>${this.escapeHtml(priority)}</option>`).join('')}
              </select>
            </label>
            <label class="task-leaf-filter">
              <input id="task-leaf-filter" type="checkbox" ${AppState.taskFilters.leafOnly ? 'checked' : ''}>
              仅显示可执行的末级任务
            </label>
          `}
          <div class="task-view-switch" role="group" aria-label="任务显示方式">
            <button type="button" data-task-view="list" class="${AppState.taskViewMode === 'list' ? 'active' : ''}" aria-pressed="${AppState.taskViewMode === 'list'}">列表</button>
            <button type="button" data-task-view="board" class="${AppState.taskViewMode === 'board' ? 'active' : ''}" aria-pressed="${AppState.taskViewMode === 'board'}">看板</button>
            <button type="button" data-task-view="timeline" class="${isTimeline ? 'active' : ''}" aria-pressed="${isTimeline}">时间线</button>
            <button type="button" data-task-view="milestones" class="${isMilestones ? 'active' : ''}" aria-pressed="${isMilestones}">里程碑</button>
            <button type="button" data-task-view="relations" class="${isRelations ? 'active' : ''}" aria-pressed="${isRelations}">依赖验收</button>
          </div>
          <span class="task-result-count">当前 ${isTimeline ? visibleTimeline.length : (isMilestones ? visibleMilestones.length : (isRelations ? visibleRelationTasks.length : visibleTasks.length))} / ${isTimeline ? allTimeline.length : (isMilestones ? allMilestones.length : allTasks.length)}</span>
        </div>

        ${isTimeline ? `
          <section class="task-timeline-pane" aria-label="开发历史时间线">
            ${visibleTimeline.length ? this.getProjectTaskTimelineHtml(visibleTimeline) : `
              <div class="task-pane-empty">
                <span aria-hidden="true">◷</span>
                <strong>没有匹配的历史事件</strong>
                <small>可清除搜索词或切换项目、事件类型</small>
              </div>`}
          </section>
        ` : isMilestones ? `
          <div class="task-split-layout milestone-split-layout">
            <section class="task-list-pane" aria-label="里程碑列表">
              ${visibleMilestones.length ? `
                <div class="task-list milestone-list" role="listbox" aria-label="项目里程碑">
                  ${visibleMilestones.map(milestone => this.getProjectMilestoneRowHtml(milestone)).join('')}
                </div>` : `
                <div class="task-pane-empty">
                  <span aria-hidden="true">◇</span>
                  <strong>没有匹配里程碑</strong>
                  <small>可清除搜索词或放宽项目、状态筛选</small>
                </div>`}
            </section>
            <aside class="task-detail-pane" aria-label="里程碑详情">
              ${selectedMilestone ? this.getProjectMilestoneDetailHtml(selectedMilestone) : '<div class="task-pane-empty"><span aria-hidden="true">◇</span><strong>选择一个里程碑查看正式计划</strong></div>'}
            </aside>
          </div>
        ` : isRelations ? `
          <div class="task-split-layout task-relations-layout">
            <section class="task-list-pane" aria-label="依赖与验收任务列表">
              ${visibleRelationTasks.length
                ? this.getProjectTaskRelationsListHtml(visibleRelationTasks)
                : `<div class="task-pane-empty">
                    <span aria-hidden="true">⇄</span>
                    <strong>没有匹配的依赖或验收门禁</strong>
                    <small>可清除搜索词或切换项目</small>
                  </div>`}
            </section>
            <aside class="task-detail-pane" aria-label="依赖与验收详情">
              ${selectedTask
                ? this.getProjectTaskRelationDetailHtml(selectedTask)
                : '<div class="task-pane-empty"><span aria-hidden="true">⇄</span><strong>选择一个任务查看执行门禁</strong></div>'}
            </aside>
          </div>
        ` : `
          <div class="task-split-layout ${AppState.taskViewMode === 'board' ? 'task-board-layout' : ''}">
            <section class="task-list-pane" aria-label="${AppState.taskViewMode === 'board' ? '任务看板' : '任务列表'}">
              ${visibleTasks.length ? `
                ${AppState.taskViewMode === 'board'
                  ? this.getProjectTaskBoardHtml(visibleTasks)
                  : `<div class="task-list" role="listbox" aria-label="开发任务">
                      ${visibleTasks.map(task => this.getProjectTaskRowHtml(task)).join('')}
                    </div>`}` : `
                <div class="task-pane-empty">
                  <span aria-hidden="true">⌕</span>
                  <strong>没有匹配任务</strong>
                  <small>可清除搜索词或放宽筛选条件</small>
                </div>`}
            </section>
            <aside class="task-detail-pane" aria-label="任务详情">
              ${selectedTask ? this.getProjectTaskDetailHtml(selectedTask) : '<div class="task-pane-empty"><span aria-hidden="true">✓</span><strong>选择一个任务查看事实与证据</strong></div>'}
            </aside>
          </div>
        `}
      </section>`;

    this.bindProjectTaskEvents(contentArea);
    this.restoreProjectTaskScrollState();
    this.updateStatusBar();
    if (!isTimeline && !isMilestones && !isRelations && selectedTask?.repositories?.some(repository => repository.available && repository.path)) {
      this.loadProjectTaskGitEvidence(selectedTask.key).catch(error => {
        console.warn('任务 Git 实况读取失败:', error);
      });
    }
  },

  getTaskMetricHtml(label, value, tone) {
    return `
      <div class="task-metric task-tone-${tone}">
        <span>${this.escapeHtml(label)}</span>
        <strong>${Number(value || 0)}</strong>
      </div>`;
  },

  getProjectTaskTimelineCategoryMeta(event) {
    const category = String(event?.category || 'activity');
    if (category === 'test') return { label: '测试证据', tone: 'success' };
    if (category === 'evidence') return { label: '项目证据', tone: 'muted' };
    if (category === 'acceptance') {
      const result = String(event?.status || '');
      if (result === '通过') return { label: '验收通过', tone: 'success' };
      if (['失败', '未通过'].includes(result)) return { label: '验收未通过', tone: 'danger' };
      return { label: '验收记录', tone: 'warning' };
    }
    if (category === 'automation') {
      const status = String(event?.status || '');
      if (/失败|错误/.test(status) || event?.detail) return { label: '自动化异常', tone: 'danger' };
      if (/待|确认|运行中/.test(status)) return { label: '自动化待处理', tone: 'warning' };
      return { label: '自动化运行', tone: 'info' };
    }
    return { label: '人工与计划活动', tone: 'info' };
  },

  getProjectTaskTimelineHtml(events) {
    const groups = new Map();
    for (const event of events || []) {
      const day = this.formatProjectTaskTimelineDay(event.timestamp);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(event);
    }
    return `
      <div class="task-timeline-scroll" tabindex="0" role="region" aria-label="Local Project Manager 持久化开发历史">
        <div class="task-timeline">
          ${[...groups].map(([day, dayEvents]) => `
            <section class="task-timeline-day" aria-labelledby="task-timeline-day-${this.getTaskDomId(day)}">
              <header>
                <h2 id="task-timeline-day-${this.getTaskDomId(day)}">${this.escapeHtml(day)}</h2>
                <span>${dayEvents.length} 条</span>
              </header>
              <div class="task-timeline-day-events">
                ${dayEvents.map(event => this.getProjectTaskTimelineEventHtml(event)).join('')}
              </div>
            </section>`).join('')}
        </div>
      </div>`;
  },

  getProjectTaskTimelineEventHtml(event) {
    const meta = this.getProjectTaskTimelineCategoryMeta(event);
    const taskContext = event.taskId
      ? `${event.taskTitle || event.taskId} · ${event.taskId}`
      : `${event.objectType || 'project'} · ${event.objectId || event.projectId || ''}`;
    const evidenceSummary = event.evidence?.summary && event.evidence.summary !== event.summary
      ? event.evidence.summary
      : '';
    const detail = event.detail && event.detail !== event.summary ? event.detail : evidenceSummary;
    return `
      <article class="task-timeline-event task-timeline-tone-${meta.tone}">
        <div class="task-timeline-rail" aria-hidden="true">
          <span class="task-timeline-dot"></span>
        </div>
        <div class="task-timeline-card">
          <div class="task-timeline-card-header">
            <div>
              <span class="task-timeline-category">${this.escapeHtml(meta.label)}</span>
              ${event.status ? `<span class="task-timeline-status">${this.escapeHtml(event.status)}</span>` : ''}
            </div>
            <time datetime="${this.escapeHtml(event.timestamp || '')}">${this.escapeHtml(this.formatProjectTaskTimelineTime(event.timestamp))}</time>
          </div>
          <strong class="task-timeline-summary">${this.escapeHtml(event.summary || event.type || event.id || '未命名事件')}</strong>
          ${detail ? `<p class="task-timeline-detail">${this.escapeHtml(detail)}</p>` : ''}
          <div class="task-timeline-context">
            <span>${this.escapeHtml(event.projectName || event.projectId || '')}</span>
            <span>${this.escapeHtml(taskContext)}</span>
            ${event.actor ? `<span>${this.escapeHtml(event.actor)}</span>` : ''}
          </div>
          ${event.reference ? `<code class="task-timeline-reference" title="${this.escapeHtml(event.reference)}">${this.escapeHtml(event.reference)}</code>` : ''}
          ${event.taskKey ? `
            <div class="task-timeline-actions">
              <button type="button" class="btn btn-small" data-task-timeline-open="${this.escapeHtml(event.taskKey)}">查看任务</button>
            </div>` : ''}
        </div>
      </article>`;
  },

  formatProjectTaskTimelineDay(value) {
    if (!value) return '日期未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '日期未知';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    }).format(date);
  },

  formatProjectTaskTimelineTime(value) {
    if (!value) return '时间未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(date);
  },

  getProjectTaskRowHtml(task) {
    const selected = task.key === AppState.selectedTaskKey;
    const timing = task.overdue ? '已逾期' : (task.dueSoon ? '即将到期' : (task.targetDate || '未设截止日'));
    return `
      <button class="task-row ${selected ? 'selected' : ''}" type="button" data-task-key="${this.escapeHtml(task.key)}" role="option" aria-selected="${selected ? 'true' : 'false'}">
        <span class="task-status-dot task-tone-${this.escapeHtml(task.statusTone || 'info')}" aria-hidden="true"></span>
        <span class="task-row-main">
          <span class="task-row-title">${this.escapeHtml(task.title)}</span>
          <span class="task-row-context">${this.escapeHtml(task.projectName)} · ${this.escapeHtml(task.stageName)}</span>
          <span class="task-row-status">${this.escapeHtml(task.status)}</span>
        </span>
        <span class="task-row-side">
          ${task.priority ? `<span class="task-priority">${this.escapeHtml(task.priority)}</span>` : ''}
          <span class="task-timing ${task.overdue ? 'overdue' : ''}">${this.escapeHtml(timing)}</span>
        </span>
      </button>`;
  },

  getProjectTaskRelationsListHtml(tasks) {
    return `
      <div class="task-list task-relations-list" role="listbox" aria-label="依赖与验收任务">
        ${tasks.map(task => {
          const selected = task.key === AppState.selectedTaskKey;
          const predecessorCount = task.predecessors?.length || 0;
          const successorCount = task.successors?.length || 0;
          const acceptanceTotal = Number(task.acceptanceTotal || 0);
          const acceptancePassed = Number(task.acceptancePassed || 0);
          return `
            <button class="task-relation-row ${selected ? 'selected' : ''}" type="button" data-task-key="${this.escapeHtml(task.key)}" role="option" aria-selected="${selected}">
              <span class="task-status-dot task-tone-${this.escapeHtml(task.statusTone || 'info')}" aria-hidden="true"></span>
              <span class="task-relation-row-main">
                <span class="task-row-title">${this.escapeHtml(task.title)}</span>
                <span class="task-row-context">${this.escapeHtml(task.projectName)} · ${this.escapeHtml(task.stageName || '未分阶段')}</span>
                <span class="task-row-status">${this.escapeHtml(task.status || '无法判定')}</span>
              </span>
              <span class="task-relation-counts" aria-label="关系与验收摘要">
                ${predecessorCount ? `<span>前置 ${predecessorCount}</span>` : ''}
                ${successorCount ? `<span>后继 ${successorCount}</span>` : ''}
                ${acceptanceTotal ? `<span class="${acceptancePassed < acceptanceTotal ? 'pending' : 'complete'}">验收 ${acceptancePassed}/${acceptanceTotal}</span>` : ''}
              </span>
            </button>`;
        }).join('')}
      </div>`;
  },

  getProjectTaskRelationPeerHtml(peer, direction) {
    const relationLabel = ProjectTaskRelations.relationLabel(peer.relation);
    const lagLabel = ProjectTaskRelations.lagLabel(peer.lagDays);
    return `
      <button class="task-relation-peer" type="button" data-task-key="${this.escapeHtml(peer.taskKey)}">
        <span class="task-relation-peer-direction" aria-hidden="true">${direction === 'predecessor' ? '→' : '↳'}</span>
        <span class="task-relation-peer-main">
          <strong>${this.escapeHtml(peer.title || peer.taskId || '未命名任务')}</strong>
          <small><code>${this.escapeHtml(peer.taskId || '')}</code> · ${this.escapeHtml(peer.status || '无法判定')}</small>
        </span>
        <span class="task-relation-kind">
          <strong>${this.escapeHtml(relationLabel)}</strong>
          <small>${this.escapeHtml(lagLabel)}</small>
        </span>
      </button>`;
  },

  getProjectTaskRelationDetailHtml(task) {
    const predecessors = task.predecessors || [];
    const successors = task.successors || [];
    const acceptance = task.acceptance || [];
    const acceptancePassed = Number(task.acceptancePassed || 0);
    const acceptanceTotal = Number(task.acceptanceTotal || acceptance.length || 0);
    return `
      <div class="task-detail-scroll task-relation-detail-scroll">
        <div class="task-detail-kicker">
          <span>${this.escapeHtml(task.projectName)}</span>
          <span>${this.escapeHtml(task.taskId)}</span>
        </div>
        <div class="task-detail-title-row">
          <div>
            <h2>${this.escapeHtml(task.title)}</h2>
            <div class="task-detail-status task-tone-${this.escapeHtml(task.statusTone || 'info')}">${this.escapeHtml(task.status || '无法判定')}</div>
          </div>
          <span class="task-source-badge">执行门禁</span>
        </div>

        <div class="task-detail-actions">
          <button class="btn btn-primary" type="button" data-task-open-path="${this.escapeHtml(task.projectRoot || '')}">进入项目目录</button>
          <button class="btn" type="button" data-task-open-detail="${this.escapeHtml(task.key)}">打开完整任务详情</button>
        </div>

        <div class="task-relation-summary" aria-label="当前任务门禁摘要">
          <div><span>前置任务</span><strong>${predecessors.length}</strong></div>
          <div><span>后继任务</span><strong>${successors.length}</strong></div>
          <div class="${acceptancePassed < acceptanceTotal ? 'pending' : 'complete'}"><span>验收条件</span><strong>${acceptancePassed}/${acceptanceTotal}</strong></div>
        </div>

        <section class="task-detail-section task-relation-section">
          <div class="task-section-heading"><h3>前置门禁</h3><span>${predecessors.length}</span></div>
          ${predecessors.length
            ? `<div class="task-relation-peers">${predecessors.map(peer => this.getProjectTaskRelationPeerHtml(peer, 'predecessor')).join('')}</div>`
            : '<div class="task-section-empty">没有前置任务，可独立开始</div>'}
        </section>

        <section class="task-detail-section task-relation-section">
          <div class="task-section-heading"><h3>后继影响</h3><span>${successors.length}</span></div>
          ${successors.length
            ? `<div class="task-relation-peers">${successors.map(peer => this.getProjectTaskRelationPeerHtml(peer, 'successor')).join('')}</div>`
            : '<div class="task-section-empty">没有后继任务依赖当前任务</div>'}
        </section>

        <section class="task-detail-section task-relation-section">
          <div class="task-section-heading"><h3>验收门禁</h3><span>${acceptancePassed}/${acceptanceTotal}</span></div>
          ${acceptance.length ? `
            <ul class="task-acceptance-gates">
              ${acceptance.map(item => {
                const passed = item.result === '通过';
                const checkType = item.checkType || item.check_type || '';
                const confirmedBy = item.confirmedBy || item.confirmed_by || '';
                const evidenceId = item.evidenceId || item.evidence_id || '';
                return `
                  <li class="${passed ? 'passed' : 'pending'}">
                    <span class="task-check ${passed ? 'passed' : ''}" aria-hidden="true">${passed ? '✓' : '·'}</span>
                    <span class="task-acceptance-gate-main">
                      <strong>${this.escapeHtml(item.criterion || '未命名验收条件')}</strong>
                      <small>${this.escapeHtml(item.result || '待检查')}${checkType ? ` · ${this.escapeHtml(checkType)}` : ''}${confirmedBy ? ` · ${this.escapeHtml(confirmedBy)}` : ''}</small>
                      ${evidenceId ? `<code>${this.escapeHtml(evidenceId)}</code>` : ''}
                    </span>
                  </li>`;
              }).join('')}
            </ul>` : '<div class="task-section-empty">尚未配置验收条件</div>'}
        </section>

        <footer class="task-source-footer">
          <strong>事实来源</strong>
          <span>${this.escapeHtml(task.source?.authority || 'Local Project Manager')} · schema 1.1 · 只读投影</span>
          <code title="${this.escapeHtml(task.source?.projectionPath || '')}">${this.escapeHtml(task.source?.projectionPath || '')}</code>
          <span>依赖和验收事实只能在 Local Project Manager 中维护，GitFinder 不直接改写。</span>
        </footer>
      </div>`;
  },

  getProjectMilestoneRowHtml(milestone) {
    const selected = milestone.key === AppState.selectedMilestoneKey;
    const timing = milestone.overdue
      ? '已逾期'
      : (milestone.dueSoon ? '七日内到期' : (milestone.targetDate || '未设目标日'));
    return `
      <button class="task-row milestone-row ${selected ? 'selected' : ''}" type="button" data-milestone-key="${this.escapeHtml(milestone.key)}" role="option" aria-selected="${selected ? 'true' : 'false'}">
        <span class="task-status-dot task-tone-${this.escapeHtml(milestone.statusTone || 'info')}" aria-hidden="true"></span>
        <span class="task-row-main">
          <span class="task-row-title">${this.escapeHtml(milestone.name)}</span>
          <span class="task-row-context">${this.escapeHtml(milestone.projectName)} · ${this.escapeHtml(milestone.stageName)}</span>
          <span class="task-row-status">${this.escapeHtml(milestone.status)}</span>
        </span>
        <span class="task-row-side">
          <code class="milestone-row-id">${this.escapeHtml(milestone.milestoneId)}</code>
          <span class="task-timing ${milestone.overdue ? 'overdue' : ''}">${this.escapeHtml(timing)}</span>
        </span>
      </button>`;
  },

  getProjectMilestoneDetailHtml(milestone) {
    const timingLabel = milestone.overdue ? ' · 已逾期' : (milestone.dueSoon ? ' · 七日内到期' : '');
    return `
      <div class="task-detail-scroll milestone-detail-scroll">
        <div class="task-detail-kicker">
          <span>${this.escapeHtml(milestone.projectName)}</span>
          <span>${this.escapeHtml(milestone.milestoneId)}</span>
        </div>
        <div class="task-detail-title-row">
          <div>
            <h2>${this.escapeHtml(milestone.name)}</h2>
            <div class="task-detail-status task-tone-${this.escapeHtml(milestone.statusTone || 'info')}">${this.escapeHtml(milestone.status)}</div>
          </div>
          <span class="task-source-badge">正式计划</span>
        </div>

        <div class="task-detail-actions">
          <button class="btn btn-primary" type="button" data-task-open-path="${this.escapeHtml(milestone.projectRoot)}">进入项目目录</button>
          <button class="btn" type="button" data-task-terminal-path="${this.escapeHtml(milestone.projectRoot)}">打开终端</button>
          <button class="btn" type="button" data-milestone-edit="${this.escapeHtml(milestone.key)}">编辑里程碑</button>
        </div>

        <dl class="task-facts-grid milestone-facts-grid">
          <div><dt>阶段</dt><dd>${this.escapeHtml(milestone.stageName || '未分阶段')}</dd></div>
          <div><dt>阶段 ID</dt><dd><code>${this.escapeHtml(milestone.stageId || '未设置')}</code></dd></div>
          <div><dt>目标日期</dt><dd class="${milestone.overdue ? 'task-danger-text' : ''}">${this.escapeHtml(milestone.targetDate || '未设置')}${timingLabel}</dd></div>
          <div><dt>状态</dt><dd>${this.escapeHtml(milestone.status)}</dd></div>
        </dl>

        <section class="task-detail-section">
          <h3>验收摘要</h3>
          <div class="task-next-action">${milestone.acceptanceSummary ? this.escapeHtml(milestone.acceptanceSummary) : '尚未记录验收摘要'}</div>
        </section>

        <section class="task-detail-section task-status-action">
          <div class="task-section-heading">
            <div>
              <h3>权威编辑边界</h3>
              <small>名称、阶段、目标日期、状态和验收摘要均需先预览，再由人工确认</small>
            </div>
            <span>LPM 权威写回</span>
          </div>
          <div class="task-status-preview-notice">
            <strong>“已验收完成”是人工决定</strong>
            <span>自动检查通过不会自动完成里程碑；GitFinder 会记录计划差异和人工审计。</span>
          </div>
        </section>

        <footer class="task-source-footer">
          <strong>事实来源</strong>
          <span>${this.escapeHtml(milestone.source?.authority || 'Local Project Manager')} · schema 1.1 · 投影只读，确认后的里程碑字段由权威适配器写入</span>
          <code title="${this.escapeHtml(milestone.source?.projectionPath || '')}">${this.escapeHtml(milestone.source?.projectionPath || '')}</code>
          <span>投影生成：${this.escapeHtml(this.formatTaskTimestamp(milestone.source?.generatedAt))}</span>
        </footer>
      </div>`;
  },

  getProjectTaskBoardColumns(tasks) {
    const orderedStatuses = [
      '未开始',
      '已有活动但未达标',
      '部分验收条件通过',
      '所有自动检查通过，待人工验收',
      '阻塞',
      '无法判定',
      '已验收完成'
    ];
    const activeFilter = AppState.taskFilters?.status || 'open';
    let visibleStatuses = activeFilter === 'all'
      ? [...orderedStatuses]
      : activeFilter === 'open'
        ? orderedStatuses.filter(status => status !== '已验收完成')
        : [activeFilter];
    const unknownStatuses = [...new Set(tasks.map(task => task.status).filter(status => (
      status && !orderedStatuses.includes(status) && !visibleStatuses.includes(status)
    )))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    if (['all', 'open'].includes(activeFilter)) visibleStatuses = [...visibleStatuses, ...unknownStatuses];
    return visibleStatuses.map(status => ({
      status,
      tone: this.getProjectTaskStatusTone(status),
      tasks: tasks.filter(task => task.status === status)
    }));
  },

  getProjectTaskBoardHtml(tasks) {
    const columns = this.getProjectTaskBoardColumns(tasks);
    return `
      <div class="task-board-scroll" role="region" aria-label="开发任务看板" tabindex="0">
        <div class="task-board">
          ${columns.map(column => `
            <section class="task-board-column task-board-tone-${this.escapeHtml(column.tone)}" aria-labelledby="task-board-${this.escapeHtml(this.getTaskDomId(column.status))}">
              <header class="task-board-column-header">
                <div><span class="task-status-dot task-tone-${this.escapeHtml(column.tone)}" aria-hidden="true"></span><h2 id="task-board-${this.escapeHtml(this.getTaskDomId(column.status))}">${this.escapeHtml(column.status)}</h2></div>
                <span>${column.tasks.length}</span>
              </header>
              <div class="task-board-column-body">
                ${column.tasks.length
                  ? column.tasks.map(task => this.getProjectTaskBoardCardHtml(task)).join('')
                  : '<div class="task-board-column-empty">暂无任务</div>'}
              </div>
            </section>`).join('')}
        </div>
      </div>`;
  },

  getProjectTaskBoardCardHtml(task) {
    const selected = task.key === AppState.selectedTaskKey;
    const timing = task.overdue ? '已逾期' : (task.dueSoon ? '即将到期' : (task.targetDate || '未设截止日'));
    return `
      <button class="task-board-card ${selected ? 'selected' : ''}" type="button" data-task-key="${this.escapeHtml(task.key)}" aria-pressed="${selected}">
        <span class="task-board-card-topline">
          <strong>${this.escapeHtml(task.title)}</strong>
          ${task.priority ? `<span class="task-priority">${this.escapeHtml(task.priority)}</span>` : ''}
        </span>
        <span class="task-board-card-context">${this.escapeHtml(task.projectName)} · ${this.escapeHtml(task.stageName || '未分阶段')}</span>
        ${task.nextAction ? `<span class="task-board-card-next">${this.escapeHtml(task.nextAction)}</span>` : ''}
        <span class="task-board-card-footer">
          <code>${this.escapeHtml(task.taskId || '')}</code>
          <span class="${task.overdue ? 'overdue' : ''}">${this.escapeHtml(timing)}</span>
        </span>
      </button>`;
  },

  getProjectTaskStatusTone(status) {
    if (status === '阻塞') return 'danger';
    if (status === '已验收完成') return 'success';
    if (status === '所有自动检查通过，待人工验收' || status === '部分验收条件通过') return 'warning';
    if (status === '无法判定') return 'muted';
    return 'info';
  },

  getTaskDomId(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0).toString(36);
  },

  getProjectTaskDetailHtml(task) {
    const acceptanceRatio = task.acceptanceTotal ? `${task.acceptancePassed}/${task.acceptanceTotal}` : '未配置';
    return `
      <div class="task-detail-scroll">
        <div class="task-detail-kicker">
          <span>${this.escapeHtml(task.projectName)}</span>
          <span>${this.escapeHtml(task.taskId)}</span>
        </div>
        <div class="task-detail-title-row">
          <div>
            <h2>${this.escapeHtml(task.title)}</h2>
            <div class="task-detail-status task-tone-${this.escapeHtml(task.statusTone || 'info')}">${this.escapeHtml(task.status)}</div>
          </div>
          <span class="task-source-badge">权威事实</span>
        </div>

        <div class="task-detail-actions">
          <button class="btn btn-primary" type="button" data-task-open-path="${this.escapeHtml(task.projectRoot)}">进入项目目录</button>
          <button class="btn" type="button" data-task-terminal-path="${this.escapeHtml(task.projectRoot)}">打开终端</button>
          <button class="btn" type="button" data-task-edit="${this.escapeHtml(task.key)}">编辑任务</button>
          <button class="btn" type="button" data-task-create-child="${this.escapeHtml(task.key)}">新建子任务</button>
        </div>

        <dl class="task-facts-grid">
          <div><dt>阶段</dt><dd>${this.escapeHtml(task.stageName || '未分阶段')}</dd></div>
          <div><dt>优先级</dt><dd>${this.escapeHtml(task.priority || '未设置')}</dd></div>
          <div><dt>负责人</dt><dd>${this.escapeHtml(task.owner || '未分配')}</dd></div>
          <div><dt>目标日期</dt><dd class="${task.overdue ? 'task-danger-text' : ''}">${this.escapeHtml(task.targetDate || '未设置')}${task.overdue ? ' · 已逾期' : ''}</dd></div>
          <div><dt>验收进度</dt><dd>${this.escapeHtml(acceptanceRatio)}</dd></div>
          <div><dt>更新时间</dt><dd>${this.escapeHtml(this.formatTaskTimestamp(task.updatedAt))}</dd></div>
        </dl>

        <section class="task-detail-section">
          <h3>下一步行动</h3>
          <div class="task-next-action">${task.nextAction ? this.escapeHtml(task.nextAction) : '尚未记录下一步行动'}</div>
        </section>

        <section class="task-detail-section task-status-action" data-task-status-action="${this.escapeHtml(task.key)}">
          <div class="task-section-heading">
            <div>
              <h3>推进任务</h3>
              <small>先预览变更，确认后由 Local Project Manager 备份并写入</small>
            </div>
            <span>LPM 权威写回</span>
          </div>
          <div class="task-status-action-controls">
            <label>
              <span>目标状态</span>
              <select data-task-status-select="${this.escapeHtml(task.key)}" aria-label="目标任务状态">
                ${this.getProjectTaskStatusOptionsHtml(task.status)}
              </select>
            </label>
            <button class="btn btn-primary" type="button" data-task-status-preview="${this.escapeHtml(task.key)}">预览变更</button>
          </div>
          <div class="task-status-action-feedback" data-task-status-feedback="${this.escapeHtml(task.key)}" role="status" aria-live="polite"></div>
        </section>

        <section class="task-detail-section">
          <div class="task-section-heading"><h3>验收条件</h3><span>${task.acceptancePassed}/${task.acceptanceTotal}</span></div>
          ${task.acceptance.length ? `
            <ul class="task-fact-list">
              ${task.acceptance.map(item => `
                <li>
                  <span class="task-check ${item.result === '通过' ? 'passed' : ''}" aria-hidden="true">${item.result === '通过' ? '✓' : '·'}</span>
                  <span><strong>${this.escapeHtml(item.criterion || '未命名验收条件')}</strong><small>${this.escapeHtml(item.result || '未检查')}${item.confirmedBy ? ` · ${this.escapeHtml(item.confirmedBy)}` : ''}</small></span>
                </li>`).join('')}
            </ul>` : '<div class="task-section-empty">尚未投影验收条件</div>'}
        </section>

        <section class="task-detail-section">
          <div class="task-section-heading"><h3>项目事实证据</h3><span>Local Project Manager · ${task.evidence.length}</span></div>
          ${task.evidence.length ? `
            <ul class="task-evidence-list">
              ${task.evidence.map(item => `
                <li>
                  <div><span class="task-evidence-type">${this.escapeHtml(item.type || '证据')}</span>${this.escapeHtml(item.summary || '未命名证据')}</div>
                  ${item.reference ? `<code title="${this.escapeHtml(item.reference)}">${this.escapeHtml(item.reference)}</code>` : ''}
                </li>`).join('')}
            </ul>` : '<div class="task-section-empty">尚未投影证据</div>'}
        </section>

        <section class="task-detail-section">
          <div class="task-section-heading"><h3>关联仓库</h3><span>${task.repositories.length}</span></div>
          ${task.repositories.length ? `
            <div class="task-repositories">
              ${task.repositories.map(repo => `
                <button class="task-repository" type="button" ${repo.path && repo.available ? `data-task-open-path="${this.escapeHtml(repo.path)}"` : 'disabled'} title="${this.escapeHtml(repo.available ? repo.path : '投影仓库路径已失效，请在 Local Project Manager 更新事实')}">
                  <span>${this.escapeHtml(repo.name)}</span>
                  <small>${this.escapeHtml(repo.relation || '关联')}</small>
                </button>`).join('')}
            </div>` : '<div class="task-section-empty">没有仓库关联</div>'}
        </section>

        ${this.getProjectTaskGitEvidenceSectionHtml(task)}

        <footer class="task-source-footer">
          <strong>事实来源</strong>
          <span>${this.escapeHtml(task.source.authority)} · schema 1.1 · 投影只读，确认后的状态与任务字段由权威适配器写入</span>
          <code title="${this.escapeHtml(task.source.projectionPath)}">${this.escapeHtml(task.source.projectionPath)}</code>
          <span>投影生成：${this.escapeHtml(this.formatTaskTimestamp(task.source.generatedAt))}</span>
        </footer>
      </div>`;
  },

  getProjectTaskStatuses() {
    return [
      '未开始',
      '已有活动但未达标',
      '部分验收条件通过',
      '所有自动检查通过，待人工验收',
      '已验收完成',
      '阻塞',
      '无法判定'
    ];
  },

  getProjectTaskStatusOptionsHtml(currentStatus) {
    return this.getProjectTaskStatuses()
      .filter(status => status !== currentStatus)
      .map(status => `<option value="${this.escapeHtml(status)}">${this.escapeHtml(status)}</option>`)
      .join('');
  },

  getProjectTaskStatusPreviewHtml(preview) {
    const validations = Array.isArray(preview?.validations) ? preview.validations : [];
    const files = Array.isArray(preview?.affected_files) ? preview.affected_files : [];
    return `
      <div class="task-status-preview-authority">
        <span class="task-source-badge">${this.escapeHtml(preview?.authority || 'Local Project Manager')}</span>
        <span>修订 <code>${this.escapeHtml(preview?.revision || '未知')}</code></span>
      </div>
      <div class="task-status-preview-task">
        <strong>${this.escapeHtml(preview?.task_title || preview?.task_id || '任务')}</strong>
        <code>${this.escapeHtml(preview?.task_id || '')}</code>
      </div>
      <div class="task-status-transition" aria-label="状态变更">
        <div><span>当前状态</span><strong>${this.escapeHtml(preview?.current_status || '')}</strong></div>
        <span class="task-status-transition-arrow" aria-hidden="true">→</span>
        <div><span>目标状态</span><strong>${this.escapeHtml(preview?.target_status || '')}</strong></div>
      </div>
      <section class="task-status-preview-section">
        <h4>写入前校验</h4>
        <ul>${validations.map(item => `
          <li class="${item?.passed ? 'passed' : 'failed'}">
            <span aria-hidden="true">${item?.passed ? '✓' : '!'}</span>
            ${this.escapeHtml(item?.label || item?.code || '未命名校验')}
          </li>`).join('')}</ul>
      </section>
      <section class="task-status-preview-section">
        <h4>受影响文件</h4>
        <ul class="task-status-file-list">${files.map(file => `<li><code>${this.escapeHtml(file)}</code></li>`).join('')}</ul>
      </section>
      <div class="task-status-preview-notice">
        <strong>应用时会自动备份</strong>
        <span>GitFinder 不直接修改 CSV；Local Project Manager 会在修订再次匹配后原子写入、记录人工活动并重建投影。</span>
      </div>`;
  },

  getProjectTaskEditFormHtml(task, draft = {}) {
    const value = (field, fallback = '') => this.escapeHtml(draft[field] ?? fallback ?? '');
    return `
      <form class="task-edit-form" id="task-edit-form">
        <div class="task-edit-context">
          <strong>${this.escapeHtml(task?.title || task?.taskId || '任务')}</strong>
          <code>${this.escapeHtml(task?.taskId || '')}</code>
        </div>
        <label class="task-edit-field task-edit-field-wide">
          <span>标题</span>
          <input id="task-edit-field-title" name="title" type="text" maxlength="240" required value="${value('title', task?.title)}">
        </label>
        <div class="task-edit-grid">
          <label class="task-edit-field">
            <span>负责人</span>
            <input id="task-edit-field-owner" name="owner" type="text" maxlength="120" required value="${value('owner', task?.owner)}">
          </label>
          <label class="task-edit-field">
            <span>优先级</span>
            <select id="task-edit-field-priority" name="priority">
              ${Array.from({ length: 10 }, (_, index) => `
                <option value="P${index}" ${value('priority', task?.priority || 'P1') === `P${index}` ? 'selected' : ''}>P${index}</option>`).join('')}
            </select>
          </label>
          <label class="task-edit-field">
            <span>开始日期</span>
            <input id="task-edit-field-start-date" name="start_date" type="date" value="${value('start_date', task?.startDate)}">
          </label>
          <label class="task-edit-field">
            <span>目标日期</span>
            <input id="task-edit-field-target-date" name="target_date" type="date" value="${value('target_date', task?.targetDate)}">
          </label>
        </div>
        <label class="task-edit-field task-edit-field-wide">
          <span>下一步行动</span>
          <textarea id="task-edit-field-next-action" name="next_action" maxlength="2000" rows="4">${value('next_action', task?.nextAction)}</textarea>
        </label>
        <p class="task-edit-help">阶段、父任务、状态和任务 ID 不在本次编辑范围内。</p>
      </form>`;
  },

  getProjectMilestoneEditFormHtml(milestone, draft = {}) {
    const project = (AppState.taskPortfolio?.projects || [])
      .find(item => item.projectId === milestone?.projectId);
    const stages = project?.stages || [];
    const value = (field, fallback = '') => this.escapeHtml(draft[field] ?? fallback ?? '');
    return `
      <form class="task-edit-form" id="milestone-edit-form">
        <div class="task-edit-context">
          <strong>${this.escapeHtml(milestone?.name || milestone?.milestoneId || '里程碑')}</strong>
          <code>${this.escapeHtml(milestone?.milestoneId || '')}</code>
        </div>
        <label class="task-edit-field task-edit-field-wide">
          <span>名称</span>
          <input id="milestone-edit-field-name" name="name" type="text" maxlength="240" required value="${value('name', milestone?.name)}">
        </label>
        <div class="task-edit-grid">
          <label class="task-edit-field">
            <span>阶段</span>
            <select name="stage_id" required>
              ${stages.map(stage => `<option value="${this.escapeHtml(stage.stageId)}" ${value('stage_id', milestone?.stageId) === stage.stageId ? 'selected' : ''}>${this.escapeHtml(stage.name)} · ${this.escapeHtml(stage.stageId)}</option>`).join('')}
            </select>
          </label>
          <label class="task-edit-field">
            <span>目标日期</span>
            <input name="target_date" type="date" value="${value('target_date', milestone?.targetDate)}">
          </label>
          <label class="task-edit-field task-edit-field-wide">
            <span>状态</span>
            <select name="status" required>
              ${this.getProjectTaskStatuses().map(status => `<option value="${this.escapeHtml(status)}" ${value('status', milestone?.status) === status ? 'selected' : ''}>${this.escapeHtml(status)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="task-edit-field task-edit-field-wide">
          <span>验收摘要</span>
          <textarea name="acceptance_summary" maxlength="2000" rows="5">${value('acceptance_summary', milestone?.acceptanceSummary)}</textarea>
        </label>
        <p class="task-edit-help">里程碑 ID 不可修改。“已验收完成”必须由你在差异预览中明确确认。</p>
      </form>`;
  },

  getProjectTaskCreateFormHtml(draft = {}) {
    const projects = AppState.taskPortfolio?.projects || [];
    const selectedProject = projects.find(project => project.projectId === draft.project_id) || projects[0] || null;
    const projectTasks = (AppState.taskPortfolio?.tasks || []).filter(task => task.projectId === selectedProject?.projectId);
    const stages = selectedProject?.stages || [];
    const selectedStageId = stages.some(stage => stage.stageId === draft.stage_id)
      ? draft.stage_id
      : (stages[0]?.stageId || '');
    const value = (field, fallback = '') => this.escapeHtml(draft[field] ?? fallback ?? '');
    return `
      <form class="task-edit-form" id="task-create-form">
        <div class="task-edit-grid task-create-context-grid">
          <label class="task-edit-field">
            <span>权威项目</span>
            <select id="task-create-field-project" name="project_id" required>
              ${projects.map(project => `
                <option value="${this.escapeHtml(project.projectId)}" ${project.projectId === selectedProject?.projectId ? 'selected' : ''}>${this.escapeHtml(project.name)}</option>`).join('')}
            </select>
          </label>
          <label class="task-edit-field">
            <span>阶段</span>
            <select id="task-create-field-stage" name="stage_id" required ${stages.length ? '' : 'disabled'}>
              ${stages.map(stage => `
                <option value="${this.escapeHtml(stage.stageId)}" ${stage.stageId === selectedStageId ? 'selected' : ''}>${this.escapeHtml(stage.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="task-edit-field task-edit-field-wide">
          <span>父任务（可选）</span>
          <select id="task-create-field-parent" name="parent_task_id">
            <option value="">无 · 创建根任务</option>
            ${projectTasks.map(task => `
              <option value="${this.escapeHtml(task.taskId)}" ${task.taskId === draft.parent_task_id ? 'selected' : ''}>${this.escapeHtml(task.title)} · ${this.escapeHtml(task.taskId)}</option>`).join('')}
          </select>
        </label>
        <label class="task-edit-field task-edit-field-wide">
          <span>标题</span>
          <input id="task-create-field-title" name="title" type="text" maxlength="240" required value="${value('title')}">
        </label>
        <div class="task-edit-grid">
          <label class="task-edit-field">
            <span>负责人</span>
            <input id="task-create-field-owner" name="owner" type="text" maxlength="120" required value="${value('owner', '未分配')}">
          </label>
          <label class="task-edit-field">
            <span>优先级</span>
            <select id="task-create-field-priority" name="priority">
              ${Array.from({ length: 10 }, (_, index) => `
                <option value="P${index}" ${value('priority', 'P1') === `P${index}` ? 'selected' : ''}>P${index}</option>`).join('')}
            </select>
          </label>
          <label class="task-edit-field">
            <span>开始日期</span>
            <input id="task-create-field-start-date" name="start_date" type="date" value="${value('start_date')}">
          </label>
          <label class="task-edit-field">
            <span>目标日期</span>
            <input id="task-create-field-target-date" name="target_date" type="date" value="${value('target_date')}">
          </label>
        </div>
        <label class="task-edit-field task-edit-field-wide">
          <span>下一步行动</span>
          <textarea id="task-create-field-next-action" name="next_action" maxlength="2000" rows="4">${value('next_action')}</textarea>
        </label>
        <p class="task-edit-help">任务 ID 由 GitFinder 主进程生成；初始状态固定为“未开始”。${stages.length ? '' : ' 当前项目没有可用阶段，无法创建任务。'}</p>
      </form>`;
  },

  getProjectTaskUpdatePreviewHtml(preview, options = {}) {
    const validations = Array.isArray(preview?.validations) ? preview.validations : [];
    const files = Array.isArray(preview?.affected_files) ? preview.affected_files : [];
    const changes = Array.isArray(preview?.changes) ? preview.changes : [];
    const displayValue = value => String(value ?? '') || '未设置';
    const differenceTitle = options.differenceTitle || '字段差异';
    const noticeTitle = options.noticeTitle || '应用时会自动备份';
    const noticeText = options.noticeText || '确认后由 Local Project Manager 锁定修订、原子写入、记录人工活动并重建投影。';
    return `
      <div class="task-status-preview-authority">
        <span class="task-source-badge">${this.escapeHtml(preview?.authority || 'Local Project Manager')}</span>
        <span>修订 <code>${this.escapeHtml(preview?.revision || '未知')}</code></span>
      </div>
      <div class="task-status-preview-task">
        <strong>${this.escapeHtml(preview?.task_title || preview?.task_id || '任务')}</strong>
        <code>${this.escapeHtml(preview?.task_id || '')}</code>
      </div>
      <section class="task-status-preview-section task-edit-diff-section">
        <h4>${this.escapeHtml(differenceTitle)} · ${changes.length}</h4>
        <div class="task-edit-diff-list">${changes.map(change => `
          <article class="task-edit-diff-item">
            <strong>${this.escapeHtml(change?.label || change?.field || '字段')}</strong>
            <div>
              <span>${this.escapeHtml(displayValue(change?.before))}</span>
              <b aria-hidden="true">→</b>
              <span>${this.escapeHtml(displayValue(change?.after))}</span>
            </div>
          </article>`).join('')}</div>
      </section>
      <section class="task-status-preview-section">
        <h4>写入前校验</h4>
        <ul>${validations.map(item => `
          <li class="${item?.passed ? 'passed' : 'failed'}">
            <span aria-hidden="true">${item?.passed ? '✓' : '!'}</span>
            ${this.escapeHtml(item?.label || item?.code || '未命名校验')}
          </li>`).join('')}</ul>
      </section>
      <section class="task-status-preview-section">
        <h4>受影响文件</h4>
        <ul class="task-status-file-list">${files.map(file => `<li><code>${this.escapeHtml(file)}</code></li>`).join('')}</ul>
      </section>
      <div class="task-status-preview-notice">
        <strong>${this.escapeHtml(noticeTitle)}</strong>
        <span>${this.escapeHtml(noticeText)}</span>
      </div>`;
  },

  getProjectTaskCreatePreviewHtml(preview) {
    return this.getProjectTaskUpdatePreviewHtml({
      ...preview,
      changes: (preview?.changes || []).filter(change => change?.field !== '__created__')
    }, {
      differenceTitle: '新任务字段',
      noticeTitle: '创建时会自动备份',
      noticeText: '确认后任务将以“未开始”写入计划，同时记录创建活动和 __created__ 计划差异并重建投影。'
    });
  },

  getProjectMilestoneUpdatePreviewHtml(preview) {
    return this.getProjectTaskUpdatePreviewHtml({
      ...preview,
      task_title: preview?.milestone_name,
      task_id: preview?.milestone_id
    }, {
      differenceTitle: '里程碑计划差异',
      noticeTitle: '确认后记录人工计划决定',
      noticeText: 'Local Project Manager 会备份事实表、逐字段写入 plan_changes.csv、记录人工活动并重建投影；自动检查不会自动完成里程碑。'
    });
  },

  getProjectTaskGitEvidenceSectionHtml(task) {
    const loading = AppState.taskGitEvidenceLoading.has(task.key);
    const evidence = AppState.taskGitEvidenceByKey.get(task.key);
    const availableRepositories = task.repositories.filter(repository => repository.available && repository.path);
    return `
      <section class="task-detail-section task-git-evidence" data-task-git-evidence="${this.escapeHtml(task.key)}">
        <div class="task-section-heading task-git-evidence-heading">
          <div>
            <h3>Git 实况</h3>
            <small>本机只读 · 不执行 fetch · 不等同于完成证明</small>
          </div>
          ${availableRepositories.length ? `<button class="btn btn-small" type="button" data-task-git-refresh="${this.escapeHtml(task.key)}" ${loading ? 'disabled' : ''}>${loading ? '读取中…' : '刷新实况'}</button>` : ''}
        </div>
        <div class="task-git-evidence-body">
          ${this.getProjectTaskGitEvidenceBodyHtml(task, evidence, loading)}
        </div>
      </section>`;
  },

  getProjectTaskGitEvidenceBodyHtml(task, evidence, loading = false) {
    const availableRepositories = task.repositories.filter(repository => repository.available && repository.path);
    if (!availableRepositories.length) {
      return '<div class="task-section-empty">尚未关联可读取的 Git 仓库</div>';
    }
    if (loading && !evidence) {
      return '<div class="task-git-loading" role="status"><span class="loading-spinner"></span><span>正在读取所选任务的本机 Git 实况…</span></div>';
    }
    if (!evidence) {
      return '<div class="task-git-loading" role="status"><span class="loading-spinner"></span><span>正在准备 Git 实况…</span></div>';
    }
    if (!evidence.success) {
      return `<div class="task-git-error" role="status">${this.escapeHtml(evidence.error || 'Git 实况读取失败')}</div>`;
    }
    if (!evidence.repositories.length) {
      return '<div class="task-section-empty">此任务没有仓库关联</div>';
    }
    return `
      <div class="task-git-repository-list">
        ${evidence.repositories.map(repository => this.getTaskGitRepositoryEvidenceHtml(repository, task.taskId)).join('')}
      </div>
      <div class="task-git-read-time">读取于 ${this.escapeHtml(this.formatTaskTimestamp(evidence.generatedAt))} · 30 秒内复用本机缓存</div>`;
  },

  getTaskGitRepositoryEvidenceHtml(repository, taskId) {
    if (!repository.success) {
      return `
        <article class="task-git-repository-card task-git-repository-error">
          <div class="task-git-repository-title"><strong>${this.escapeHtml(repository.name)}</strong><span>${this.escapeHtml(repository.relation || '关联')}</span></div>
          <p>${this.escapeHtml(repository.error || '无法读取仓库')}</p>
        </article>`;
    }

    const git = repository.git;
    const workingTree = git.workingTree || { files: [] };
    const matchedHashes = new Set((git.matchedCommits || []).map(commit => commit.hash));
    const contextualCommits = (git.recentCommits || []).filter(commit => !matchedHashes.has(commit.hash)).slice(0, 5);
    const visibleFiles = (workingTree.files || []).slice(0, 8);
    return `
      <article class="task-git-repository-card">
        <header class="task-git-repository-title">
          <div>
            <strong>${this.escapeHtml(repository.name)}</strong>
            <small title="${this.escapeHtml(repository.path)}">${this.escapeHtml(git.branch || '未命名分支')}</small>
          </div>
          <span class="task-git-status task-git-status-${this.escapeHtml(git.overallStatus)}">${this.escapeHtml(this.getTaskGitStatusLabel(git.overallStatus))}</span>
        </header>

        <div class="task-git-metrics" aria-label="Git 状态摘要">
          <span><strong>${Number(workingTree.stagedCount || 0)}</strong> 已暂存</span>
          <span><strong>${Number(workingTree.unstagedCount || 0)}</strong> 未暂存</span>
          <span class="${workingTree.conflictCount ? 'danger' : ''}"><strong>${Number(workingTree.conflictCount || 0)}</strong> 冲突</span>
          <span><strong>${Number(git.ahead || 0)}</strong> 领先</span>
          <span><strong>${Number(git.behind || 0)}</strong> 落后</span>
        </div>

        <section class="task-git-layer task-git-layer-evidence">
          <div class="task-git-layer-heading"><strong>明确关联提交</strong><span>强归因</span></div>
          ${(git.matchedCommits || []).length ? `
            <ul class="task-git-commit-list">
              ${git.matchedCommits.map(commit => this.getTaskGitCommitHtml(commit, true)).join('')}
            </ul>` : `
            <p class="task-git-layer-empty">最近提交未明确引用 ${this.escapeHtml(taskId || '任务 ID')}，也没有匹配投影声明的 commit hash，不能作为任务完成证明。</p>`}
        </section>

        <section class="task-git-layer">
          <div class="task-git-layer-heading"><strong>当前工作区</strong><span>上下文，不归因</span></div>
          ${workingTree.success === false ? `<p class="task-git-layer-empty">${this.escapeHtml(workingTree.error || '工作区读取失败')}</p>` : visibleFiles.length ? `
            <ul class="task-git-file-list">
              ${visibleFiles.map(file => `<li><code title="${this.escapeHtml(file.path)}">${this.escapeHtml(file.path)}</code><span>${this.escapeHtml(this.getTaskGitFileLabel(file))}</span></li>`).join('')}
            </ul>
            ${Number(workingTree.totalCount || 0) > visibleFiles.length ? `<div class="task-git-more">另有 ${Number(workingTree.totalCount) - visibleFiles.length} 个变更文件，请进入仓库审查。</div>` : ''}` : '<p class="task-git-layer-empty">工作区干净</p>'}
        </section>

        <section class="task-git-layer">
          <div class="task-git-layer-heading"><strong>近期仓库活动</strong><span>未归因</span></div>
          ${contextualCommits.length ? `
            <ul class="task-git-commit-list task-git-context-list">
              ${contextualCommits.map(commit => this.getTaskGitCommitHtml(commit, false)).join('')}
            </ul>` : '<p class="task-git-layer-empty">没有其他近期提交</p>'}
        </section>
        <footer class="task-git-card-actions">
          <button class="btn btn-small" type="button" data-task-review-path="${this.escapeHtml(repository.path)}">打开仓库审查</button>
        </footer>
      </article>`;
  },

  getTaskGitCommitHtml(commit, attributed) {
    const attribution = commit.attribution === 'declared-hash' ? '投影声明 hash' : '任务 ID';
    return `
      <li>
        <code>${this.escapeHtml(commit.hash || '')}</code>
        <span><strong>${this.escapeHtml(commit.message || '无提交说明')}</strong><small>${this.escapeHtml(commit.author || '未知作者')} · ${this.escapeHtml(this.formatGitCommitTimestamp(commit.timestamp))}${attributed ? ` · ${attribution}` : ''}</small></span>
      </li>`;
  },

  getTaskGitStatusLabel(status) {
    if (status === 'dirty') return '有工作区变更';
    if (status === 'ahead') return '有未推送提交';
    if (status === 'behind') return '有远程更新';
    return '工作区干净';
  },

  getTaskGitFileLabel(file) {
    if (file.conflict) return '冲突';
    if (file.untracked) return '未跟踪';
    if (file.staged && file.unstaged) return '已暂存 + 未暂存';
    if (file.staged) return '已暂存';
    return '未暂存';
  },

  formatGitCommitTimestamp(timestamp) {
    const numeric = Number(timestamp);
    if (!numeric) return '时间未知';
    return this.formatTaskTimestamp(new Date(numeric * 1000).toISOString());
  },

  async loadProjectTaskGitEvidence(taskKey, forceRefresh = false) {
    if (!taskKey || AppState.taskGitEvidenceLoading.has(taskKey)) return;
    const cached = AppState.taskGitEvidenceByKey.get(taskKey);
    if (!forceRefresh && this.isProjectTaskGitEvidenceFresh(cached)) return;

    AppState.taskGitEvidenceLoading.add(taskKey);
    this.updateProjectTaskGitEvidenceSection(taskKey);
    try {
      const evidence = await window.gitFinder.projectTasks.getGitEvidence(taskKey, { forceRefresh });
      AppState.taskGitEvidenceByKey.set(taskKey, evidence);
    } catch (error) {
      AppState.taskGitEvidenceByKey.set(taskKey, {
        success: false,
        readOnly: true,
        repositories: [],
        error: error?.message || String(error)
      });
    } finally {
      AppState.taskGitEvidenceLoading.delete(taskKey);
      this.updateProjectTaskGitEvidenceSection(taskKey);
    }
  },

  isProjectTaskGitEvidenceFresh(evidence) {
    const generatedAt = Date.parse(evidence?.generatedAt || '');
    return Number.isFinite(generatedAt) && Date.now() - generatedAt < 30000;
  },

  updateProjectTaskGitEvidenceSection(taskKey) {
    if (AppState.currentMode !== 'tasks' || AppState.selectedTaskKey !== taskKey) return;
    const task = (AppState.taskPortfolio?.tasks || []).find(item => item.key === taskKey);
    if (!task) return;
    const section = [...document.querySelectorAll('[data-task-git-evidence]')]
      .find(element => element.dataset.taskGitEvidence === taskKey);
    if (!section) return;
    const loading = AppState.taskGitEvidenceLoading.has(taskKey);
    const evidence = AppState.taskGitEvidenceByKey.get(taskKey);
    const body = section.querySelector('.task-git-evidence-body');
    const refreshButton = section.querySelector('[data-task-git-refresh]');
    if (body) body.innerHTML = this.getProjectTaskGitEvidenceBodyHtml(task, evidence, loading);
    if (body) this.bindProjectTaskGitEvidenceActions(body);
    if (refreshButton) {
      refreshButton.disabled = loading;
      refreshButton.textContent = loading ? '读取中…' : '刷新实况';
    }
  },

  captureProjectTaskScrollState() {
    const board = document.querySelector('.task-board-scroll');
    const list = document.querySelector('.task-list');
    const relations = document.querySelector('.task-relations-list');
    const timeline = document.querySelector('.task-timeline-scroll');
    if (board) AppState.taskBoardScrollLeft = board.scrollLeft;
    if (relations) AppState.taskRelationScrollTop = relations.scrollTop;
    else if (list) AppState.taskListScrollTop = list.scrollTop;
    if (timeline) AppState.taskTimelineScrollTop = timeline.scrollTop;
  },

  restoreProjectTaskScrollState() {
    const board = document.querySelector('.task-board-scroll');
    const list = document.querySelector('.task-list');
    const relations = document.querySelector('.task-relations-list');
    const timeline = document.querySelector('.task-timeline-scroll');
    if (board) board.scrollLeft = Number(AppState.taskBoardScrollLeft) || 0;
    if (relations) relations.scrollTop = Number(AppState.taskRelationScrollTop) || 0;
    else if (list) list.scrollTop = Number(AppState.taskListScrollTop) || 0;
    if (timeline) timeline.scrollTop = Number(AppState.taskTimelineScrollTop) || 0;
  },

  selectProjectTask(taskKey) {
    if (!taskKey || taskKey === AppState.selectedTaskKey) return;
    this.captureProjectTaskScrollState();
    AppState.selectedTaskKey = taskKey;
    this.renderProjectTasksView();
  },

  selectProjectMilestone(milestoneKey) {
    if (!milestoneKey || milestoneKey === AppState.selectedMilestoneKey) return;
    this.captureProjectTaskScrollState();
    AppState.selectedMilestoneKey = milestoneKey;
    this.renderProjectTasksView();
  },

  async setProjectTaskViewMode(viewMode) {
    if (!['list', 'board', 'timeline', 'milestones', 'relations'].includes(viewMode) || viewMode === AppState.taskViewMode) return;
    this.captureProjectTaskScrollState();
    AppState.taskViewMode = viewMode;
    this.renderProjectTasksView();
    try {
      await window.gitFinder.config.set('taskViewMode', viewMode);
    } catch (error) {
      console.warn('任务视图偏好保存失败:', error);
    }
  },

  resetProjectTaskScrollState() {
    AppState.taskBoardScrollLeft = 0;
    AppState.taskListScrollTop = 0;
    AppState.taskTimelineScrollTop = 0;
    AppState.taskRelationScrollTop = 0;
  },

  async openProjectTaskDetail(taskKey) {
    const task = this.getProjectTaskByKey(taskKey);
    if (!task) return;
    this.captureProjectTaskScrollState();
    AppState.selectedTaskKey = task.key;
    AppState.taskFilters.projectId = task.projectId;
    AppState.taskFilters.status = 'all';
    AppState.taskFilters.priority = 'all';
    AppState.taskFilters.leafOnly = false;
    AppState.taskViewMode = 'list';
    AppState.taskListScrollTop = 0;
    this.renderProjectTasksView();
    try {
      await window.gitFinder.config.set('taskViewMode', 'list');
    } catch (error) {
      console.warn('任务视图偏好保存失败:', error);
    }
  },

  async openProjectTaskFromTimeline(taskKey) {
    const task = this.getProjectTaskByKey(taskKey);
    if (!task) return;
    this.captureProjectTaskScrollState();
    AppState.selectedTaskKey = task.key;
    AppState.taskFilters.projectId = task.projectId;
    AppState.taskFilters.status = 'all';
    AppState.taskFilters.priority = 'all';
    AppState.taskFilters.leafOnly = false;
    AppState.taskViewMode = 'list';
    AppState.taskListScrollTop = 0;
    this.renderProjectTasksView();
    try {
      await window.gitFinder.config.set('taskViewMode', 'list');
    } catch (error) {
      console.warn('任务视图偏好保存失败:', error);
    }
  },

  setProjectTaskStatusFeedback(taskKey, message, tone = '') {
    const feedback = [...document.querySelectorAll('[data-task-status-feedback]')]
      .find(element => element.dataset.taskStatusFeedback === taskKey);
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.className = `task-status-action-feedback ${tone}`.trim();
  },

  getProjectTaskByKey(taskKey) {
    return (AppState.taskPortfolio?.tasks || []).find(task => task.key === taskKey) || null;
  },

  setProjectTaskEditFeedback(message, tone = '') {
    const feedback = document.getElementById('task-edit-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.className = tone;
  },

  openProjectTaskEdit(taskKey) {
    const task = this.getProjectTaskByKey(taskKey);
    const modal = document.getElementById('task-edit-modal');
    if (!task || !modal || AppState.taskEditApplying) return;
    AppState.taskEditTaskKey = taskKey;
    AppState.taskEditDraft = {
      title: task.title || '',
      owner: task.owner || '',
      start_date: task.startDate || '',
      target_date: task.targetDate || '',
      priority: task.priority || 'P1',
      next_action: task.nextAction || ''
    };
    AppState.taskEditPreview = null;
    AppState.taskEditStage = 'form';
    modal.style.display = 'flex';
    this.renderProjectTaskEditStage();
  },

  renderProjectTaskEditStage() {
    const task = this.getProjectTaskByKey(AppState.taskEditTaskKey);
    const body = document.getElementById('task-edit-body');
    const title = document.getElementById('task-edit-title');
    const description = document.getElementById('task-edit-description');
    const backButton = document.getElementById('task-edit-back-btn');
    const primaryButton = document.getElementById('task-edit-primary-btn');
    if (!task || !body || !primaryButton) return;

    const reviewing = AppState.taskEditStage === 'preview' && AppState.taskEditPreview;
    if (title) title.textContent = reviewing ? '确认任务字段变更' : '编辑任务';
    if (description) {
      description.textContent = reviewing
        ? '逐项审查差异，确认后才会备份并写入'
        : '编辑六个可审查字段；阶段、层级、状态和 ID 保持不变';
    }
    if (reviewing) {
      body.innerHTML = this.getProjectTaskUpdatePreviewHtml(AppState.taskEditPreview);
      if (backButton) backButton.style.display = '';
      primaryButton.textContent = '确认并应用';
      primaryButton.disabled = false;
      this.setProjectTaskEditFeedback('预览为只读；尚未写入任何文件');
      requestAnimationFrame(() => backButton?.focus());
      return;
    }

    body.innerHTML = this.getProjectTaskEditFormHtml(task, AppState.taskEditDraft || {});
    if (backButton) backButton.style.display = 'none';
    primaryButton.textContent = '预览字段变更';
    primaryButton.disabled = false;
    this.setProjectTaskEditFeedback('填写后先生成只读差异预览');
    body.querySelector('#task-edit-form')?.addEventListener('submit', event => {
      event.preventDefault();
      this.previewProjectTaskUpdate().catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
    });
    requestAnimationFrame(() => body.querySelector('#task-edit-field-title')?.focus());
  },

  collectProjectTaskEditDraft() {
    const body = document.getElementById('task-edit-body');
    const form = body?.querySelector('#task-edit-form');
    if (!form) return null;
    if (!form.reportValidity()) return null;
    return {
      title: form.elements.title.value,
      owner: form.elements.owner.value,
      start_date: form.elements.start_date.value,
      target_date: form.elements.target_date.value,
      priority: form.elements.priority.value,
      next_action: form.elements.next_action.value
    };
  },

  async previewProjectTaskUpdate() {
    if (AppState.taskEditStage !== 'form' || AppState.taskEditPreviewLoading || AppState.taskEditApplying) return;
    const draft = this.collectProjectTaskEditDraft();
    if (!draft) return;
    const primaryButton = document.getElementById('task-edit-primary-btn');
    AppState.taskEditDraft = draft;
    AppState.taskEditPreviewLoading = true;
    if (primaryButton) {
      primaryButton.disabled = true;
      primaryButton.textContent = '正在生成…';
    }
    this.setProjectTaskEditFeedback('正在校验字段、日期关系和当前修订…', 'working');
    try {
      const preview = await window.gitFinder.projectTasks.previewTaskUpdate(AppState.taskEditTaskKey, draft);
      if (!preview?.success) {
        const message = this.getProjectTaskWritebackError(preview, '无法生成任务字段预览');
        this.setProjectTaskEditFeedback(message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      AppState.taskEditPreview = { ...preview, taskKey: AppState.taskEditTaskKey };
      AppState.taskEditStage = 'preview';
      this.renderProjectTaskEditStage();
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectTaskEditFeedback(message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.taskEditPreviewLoading = false;
      if (primaryButton?.isConnected && AppState.taskEditStage === 'form') {
        primaryButton.disabled = false;
        primaryButton.textContent = '预览字段变更';
      }
    }
  },

  returnToProjectTaskEdit() {
    if (AppState.taskEditApplying) return;
    AppState.taskEditPreview = null;
    AppState.taskEditStage = 'form';
    this.renderProjectTaskEditStage();
  },

  closeProjectTaskEdit() {
    if (AppState.taskEditApplying) return;
    const modal = document.getElementById('task-edit-modal');
    if (modal) modal.style.display = 'none';
    AppState.taskEditTaskKey = null;
    AppState.taskEditDraft = null;
    AppState.taskEditPreview = null;
    AppState.taskEditStage = 'form';
  },

  async applyProjectTaskUpdate() {
    const preview = AppState.taskEditPreview;
    if (!preview || AppState.taskEditStage !== 'preview' || AppState.taskEditApplying) return;
    const primaryButton = document.getElementById('task-edit-primary-btn');
    const backButton = document.getElementById('task-edit-back-btn');
    const cancelButton = document.getElementById('task-edit-cancel-btn');
    const closeButton = document.getElementById('task-edit-close-btn');
    AppState.taskEditApplying = true;
    for (const button of [primaryButton, backButton, cancelButton, closeButton]) {
      if (button) button.disabled = true;
    }
    if (primaryButton) primaryButton.textContent = '正在应用…';
    this.setProjectTaskEditFeedback('正在锁定修订、备份事实并重建投影…', 'working');
    try {
      const result = await window.gitFinder.projectTasks.applyTaskUpdate(preview.taskKey, {
        changes: preview.proposed_values,
        revision: preview.revision,
        previewToken: preview.preview_token,
        operationId: preview.operation_id
      });
      if (!result?.success) {
        const message = this.getProjectTaskWritebackError(result, '任务字段变更失败');
        this.setProjectTaskEditFeedback(message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      const message = result.already_applied
        ? '任务字段已经是所确认的结果'
        : '任务字段已由 Local Project Manager 安全写入';
      this._showStatusMessage(message, 'success');
      const modal = document.getElementById('task-edit-modal');
      if (modal) modal.style.display = 'none';
      AppState.taskEditTaskKey = null;
      AppState.taskEditDraft = null;
      AppState.taskEditPreview = null;
      AppState.taskEditStage = 'form';
      await this.renderProjectTasks(true);
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectTaskEditFeedback(message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.taskEditApplying = false;
      for (const button of [primaryButton, backButton, cancelButton, closeButton]) {
        if (button?.isConnected) button.disabled = false;
      }
      if (primaryButton?.isConnected && AppState.taskEditPreview) primaryButton.textContent = '确认并应用';
    }
  },

  getProjectMilestoneByKey(milestoneKey) {
    return (AppState.taskPortfolio?.milestones || []).find(milestone => milestone.key === milestoneKey) || null;
  },

  setProjectMilestoneEditFeedback(message, tone = '') {
    const feedback = document.getElementById('milestone-edit-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.className = tone;
  },

  openProjectMilestoneEdit(milestoneKey) {
    const milestone = this.getProjectMilestoneByKey(milestoneKey);
    const modal = document.getElementById('milestone-edit-modal');
    if (!milestone || !modal || AppState.milestoneEditApplying) return;
    AppState.milestoneEditKey = milestoneKey;
    AppState.milestoneEditDraft = {
      stage_id: milestone.stageId || '',
      name: milestone.name || '',
      target_date: milestone.targetDate || '',
      status: milestone.status || '未开始',
      acceptance_summary: milestone.acceptanceSummary || ''
    };
    AppState.milestoneEditPreview = null;
    AppState.milestoneEditStage = 'form';
    modal.style.display = 'flex';
    this.renderProjectMilestoneEditStage();
  },

  renderProjectMilestoneEditStage() {
    const milestone = this.getProjectMilestoneByKey(AppState.milestoneEditKey);
    const body = document.getElementById('milestone-edit-body');
    const title = document.getElementById('milestone-edit-title');
    const description = document.getElementById('milestone-edit-description');
    const backButton = document.getElementById('milestone-edit-back-btn');
    const primaryButton = document.getElementById('milestone-edit-primary-btn');
    if (!milestone || !body || !primaryButton) return;
    const reviewing = AppState.milestoneEditStage === 'preview' && AppState.milestoneEditPreview;
    if (title) title.textContent = reviewing ? '确认里程碑计划变更' : '编辑里程碑';
    if (description) {
      description.textContent = reviewing
        ? '逐项审查差异；“已验收完成”等状态由你的确认生效'
        : '先预览计划差异，再由 Local Project Manager 备份、审计并写入';
    }
    if (reviewing) {
      body.innerHTML = this.getProjectMilestoneUpdatePreviewHtml(AppState.milestoneEditPreview);
      if (backButton) backButton.style.display = '';
      primaryButton.textContent = '确认并应用';
      primaryButton.disabled = false;
      this.setProjectMilestoneEditFeedback('预览为只读；尚未写入任何文件');
      requestAnimationFrame(() => backButton?.focus());
      return;
    }
    body.innerHTML = this.getProjectMilestoneEditFormHtml(milestone, AppState.milestoneEditDraft || {});
    if (backButton) backButton.style.display = 'none';
    primaryButton.textContent = '预览里程碑变更';
    primaryButton.disabled = false;
    this.setProjectMilestoneEditFeedback('填写后先生成只读差异预览');
    body.querySelector('#milestone-edit-form')?.addEventListener('submit', event => {
      event.preventDefault();
      this.previewProjectMilestoneUpdate().catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
    });
    requestAnimationFrame(() => body.querySelector('#milestone-edit-field-name')?.focus());
  },

  collectProjectMilestoneEditDraft() {
    const form = document.getElementById('milestone-edit-form');
    if (!form || !form.reportValidity()) return null;
    return {
      stage_id: form.elements.stage_id.value,
      name: form.elements.name.value,
      target_date: form.elements.target_date.value,
      status: form.elements.status.value,
      acceptance_summary: form.elements.acceptance_summary.value
    };
  },

  async previewProjectMilestoneUpdate() {
    if (AppState.milestoneEditStage !== 'form' || AppState.milestoneEditPreviewLoading || AppState.milestoneEditApplying) return;
    const draft = this.collectProjectMilestoneEditDraft();
    if (!draft) return;
    const primaryButton = document.getElementById('milestone-edit-primary-btn');
    AppState.milestoneEditDraft = draft;
    AppState.milestoneEditPreviewLoading = true;
    if (primaryButton) {
      primaryButton.disabled = true;
      primaryButton.textContent = '正在生成…';
    }
    this.setProjectMilestoneEditFeedback('正在校验里程碑、阶段、状态与当前修订…', 'working');
    try {
      const preview = await window.gitFinder.projectTasks.previewMilestoneUpdate(AppState.milestoneEditKey, draft);
      if (!preview?.success) {
        const message = this.getProjectTaskWritebackError(preview, '无法生成里程碑变更预览');
        this.setProjectMilestoneEditFeedback(message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      AppState.milestoneEditPreview = { ...preview, milestoneKey: AppState.milestoneEditKey };
      AppState.milestoneEditStage = 'preview';
      this.renderProjectMilestoneEditStage();
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectMilestoneEditFeedback(message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.milestoneEditPreviewLoading = false;
      if (primaryButton?.isConnected && AppState.milestoneEditStage === 'form') {
        primaryButton.disabled = false;
        primaryButton.textContent = '预览里程碑变更';
      }
    }
  },

  returnToProjectMilestoneEdit() {
    if (AppState.milestoneEditApplying) return;
    AppState.milestoneEditPreview = null;
    AppState.milestoneEditStage = 'form';
    this.renderProjectMilestoneEditStage();
  },

  closeProjectMilestoneEdit() {
    if (AppState.milestoneEditApplying) return;
    const modal = document.getElementById('milestone-edit-modal');
    if (modal) modal.style.display = 'none';
    AppState.milestoneEditKey = null;
    AppState.milestoneEditDraft = null;
    AppState.milestoneEditPreview = null;
    AppState.milestoneEditStage = 'form';
  },

  async applyProjectMilestoneUpdate() {
    const preview = AppState.milestoneEditPreview;
    if (!preview || AppState.milestoneEditStage !== 'preview' || AppState.milestoneEditApplying) return;
    const primaryButton = document.getElementById('milestone-edit-primary-btn');
    const backButton = document.getElementById('milestone-edit-back-btn');
    const cancelButton = document.getElementById('milestone-edit-cancel-btn');
    const closeButton = document.getElementById('milestone-edit-close-btn');
    AppState.milestoneEditApplying = true;
    for (const button of [primaryButton, backButton, cancelButton, closeButton]) {
      if (button) button.disabled = true;
    }
    if (primaryButton) primaryButton.textContent = '正在应用…';
    this.setProjectMilestoneEditFeedback('正在锁定修订、备份里程碑、记录计划差异并重建投影…', 'working');
    try {
      const result = await window.gitFinder.projectTasks.applyMilestoneUpdate(preview.milestoneKey, {
        changes: preview.proposed_values,
        revision: preview.revision,
        previewToken: preview.preview_token,
        operationId: preview.operation_id
      });
      if (!result?.success) {
        const message = this.getProjectTaskWritebackError(result, '里程碑变更失败');
        this.setProjectMilestoneEditFeedback(message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      const message = result.already_applied ? '该里程碑变更已经安全应用' : '里程碑已由 Local Project Manager 安全写入';
      this._showStatusMessage(message, 'success');
      const modal = document.getElementById('milestone-edit-modal');
      if (modal) modal.style.display = 'none';
      AppState.selectedMilestoneKey = `${result.project_id}:${result.milestone_id}`;
      AppState.milestoneEditKey = null;
      AppState.milestoneEditDraft = null;
      AppState.milestoneEditPreview = null;
      AppState.milestoneEditStage = 'form';
      await this.renderProjectTasks(true);
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectMilestoneEditFeedback(message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.milestoneEditApplying = false;
      for (const button of [primaryButton, backButton, cancelButton, closeButton]) {
        if (button?.isConnected) button.disabled = false;
      }
      if (primaryButton?.isConnected && AppState.milestoneEditPreview) primaryButton.textContent = '确认并应用';
    }
  },

  setProjectTaskCreateFeedback(message, tone = '') {
    const feedback = document.getElementById('task-create-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.className = tone;
  },

  openProjectTaskCreate(parentTaskKey = '') {
    const modal = document.getElementById('task-create-modal');
    const selectedTask = this.getProjectTaskByKey(parentTaskKey || AppState.selectedTaskKey);
    const projects = AppState.taskPortfolio?.projects || [];
    const project = projects.find(item => item.projectId === selectedTask?.projectId) || projects[0];
    if (!modal || !project || AppState.taskCreateApplying) return;
    AppState.taskCreateDraft = {
      project_id: project.projectId,
      stage_id: selectedTask?.stageId || project.stages?.[0]?.stageId || '',
      parent_task_id: parentTaskKey ? (selectedTask?.taskId || '') : '',
      title: '',
      owner: selectedTask?.owner || project.owner || '未分配',
      start_date: '',
      target_date: '',
      priority: 'P1',
      next_action: ''
    };
    AppState.taskCreatePreview = null;
    AppState.taskCreateStage = 'form';
    modal.style.display = 'flex';
    this.renderProjectTaskCreateStage();
  },

  renderProjectTaskCreateStage() {
    const body = document.getElementById('task-create-body');
    const title = document.getElementById('task-create-title');
    const description = document.getElementById('task-create-description');
    const backButton = document.getElementById('task-create-back-btn');
    const primaryButton = document.getElementById('task-create-primary-btn');
    if (!body || !primaryButton) return;
    const reviewing = AppState.taskCreateStage === 'preview' && AppState.taskCreatePreview;
    if (title) title.textContent = reviewing ? '确认创建任务' : '新建任务';
    if (description) {
      description.textContent = reviewing
        ? '逐项审查计划字段，确认后才会创建未开始任务'
        : '选择权威项目、阶段与可选父任务，再审查创建计划';
    }
    if (reviewing) {
      body.innerHTML = this.getProjectTaskCreatePreviewHtml(AppState.taskCreatePreview);
      if (backButton) backButton.style.display = '';
      primaryButton.textContent = '确认并创建';
      primaryButton.disabled = false;
      this.setProjectTaskCreateFeedback('创建预览为只读；尚未写入任何文件');
      requestAnimationFrame(() => backButton?.focus());
      return;
    }

    body.innerHTML = this.getProjectTaskCreateFormHtml(AppState.taskCreateDraft || {});
    if (backButton) backButton.style.display = 'none';
    primaryButton.textContent = '预览创建计划';
    const selectedProject = (AppState.taskPortfolio?.projects || [])
      .find(project => project.projectId === AppState.taskCreateDraft?.project_id);
    primaryButton.disabled = !(selectedProject?.stages || []).length;
    this.setProjectTaskCreateFeedback(
      primaryButton.disabled ? '当前项目没有可用阶段，无法创建任务' : '填写后先生成只读创建预览',
      primaryButton.disabled ? 'error' : ''
    );
    const form = body.querySelector('#task-create-form');
    form?.addEventListener('submit', event => {
      event.preventDefault();
      this.previewProjectTaskCreate().catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
    });
    form?.elements.project_id?.addEventListener('change', event => {
      const draft = this.collectProjectTaskCreateDraft(false);
      const project = (AppState.taskPortfolio?.projects || []).find(item => item.projectId === event.target.value);
      if (!draft || !project) return;
      AppState.taskCreateDraft = {
        ...draft,
        project_id: project.projectId,
        stage_id: project.stages?.[0]?.stageId || '',
        parent_task_id: ''
      };
      this.renderProjectTaskCreateStage();
    });
    form?.elements.parent_task_id?.addEventListener('change', event => {
      const parent = (AppState.taskPortfolio?.tasks || []).find(task => (
        task.projectId === form.elements.project_id.value && task.taskId === event.target.value
      ));
      if (!parent) return;
      const draft = this.collectProjectTaskCreateDraft(false);
      if (!draft) return;
      AppState.taskCreateDraft = { ...draft, stage_id: parent.stageId };
      this.renderProjectTaskCreateStage();
    });
    requestAnimationFrame(() => body.querySelector('#task-create-field-title')?.focus());
  },

  collectProjectTaskCreateDraft(validate = true) {
    const form = document.getElementById('task-create-form');
    if (!form || (validate && !form.reportValidity())) return null;
    return {
      project_id: form.elements.project_id.value,
      stage_id: form.elements.stage_id.value,
      parent_task_id: form.elements.parent_task_id.value,
      title: form.elements.title.value,
      owner: form.elements.owner.value,
      start_date: form.elements.start_date.value,
      target_date: form.elements.target_date.value,
      priority: form.elements.priority.value,
      next_action: form.elements.next_action.value
    };
  },

  async previewProjectTaskCreate() {
    if (AppState.taskCreateStage !== 'form' || AppState.taskCreatePreviewLoading || AppState.taskCreateApplying) return;
    const draft = this.collectProjectTaskCreateDraft(true);
    if (!draft) return;
    const primaryButton = document.getElementById('task-create-primary-btn');
    AppState.taskCreateDraft = draft;
    AppState.taskCreatePreviewLoading = true;
    if (primaryButton) {
      primaryButton.disabled = true;
      primaryButton.textContent = '正在生成…';
    }
    this.setProjectTaskCreateFeedback('正在校验任务 ID、阶段、父任务、日期与当前修订…', 'working');
    try {
      const { project_id: projectId, ...values } = draft;
      const preview = await window.gitFinder.projectTasks.previewTaskCreate(projectId, values);
      if (!preview?.success) {
        const message = this.getProjectTaskWritebackError(preview, '无法生成任务创建预览');
        this.setProjectTaskCreateFeedback(message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      AppState.taskCreatePreview = { ...preview, projectId };
      AppState.taskCreateStage = 'preview';
      this.renderProjectTaskCreateStage();
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectTaskCreateFeedback(message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.taskCreatePreviewLoading = false;
      if (primaryButton?.isConnected && AppState.taskCreateStage === 'form') {
        primaryButton.disabled = false;
        primaryButton.textContent = '预览创建计划';
      }
    }
  },

  returnToProjectTaskCreate() {
    if (AppState.taskCreateApplying) return;
    AppState.taskCreatePreview = null;
    AppState.taskCreateStage = 'form';
    this.renderProjectTaskCreateStage();
  },

  closeProjectTaskCreate() {
    if (AppState.taskCreateApplying) return;
    const modal = document.getElementById('task-create-modal');
    if (modal) modal.style.display = 'none';
    AppState.taskCreateDraft = null;
    AppState.taskCreatePreview = null;
    AppState.taskCreateStage = 'form';
  },

  async applyProjectTaskCreate() {
    const preview = AppState.taskCreatePreview;
    if (!preview || AppState.taskCreateStage !== 'preview' || AppState.taskCreateApplying) return;
    const primaryButton = document.getElementById('task-create-primary-btn');
    const backButton = document.getElementById('task-create-back-btn');
    const cancelButton = document.getElementById('task-create-cancel-btn');
    const closeButton = document.getElementById('task-create-close-btn');
    AppState.taskCreateApplying = true;
    for (const button of [primaryButton, backButton, cancelButton, closeButton]) {
      if (button) button.disabled = true;
    }
    if (primaryButton) primaryButton.textContent = '正在创建…';
    this.setProjectTaskCreateFeedback('正在锁定修订、备份计划并重建投影…', 'working');
    try {
      const result = await window.gitFinder.projectTasks.applyTaskCreate(preview.projectId, {
        taskId: preview.task_id,
        values: preview.proposed_values,
        revision: preview.revision,
        previewToken: preview.preview_token,
        operationId: preview.operation_id
      });
      if (!result?.success) {
        const message = this.getProjectTaskWritebackError(result, '任务创建失败');
        this.setProjectTaskCreateFeedback(message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      const message = result.already_applied ? '该任务已经安全创建' : '任务已由 Local Project Manager 安全创建';
      this._showStatusMessage(message, 'success');
      const modal = document.getElementById('task-create-modal');
      if (modal) modal.style.display = 'none';
      AppState.selectedTaskKey = `${result.project_id}:${result.task_id}`;
      AppState.taskCreateDraft = null;
      AppState.taskCreatePreview = null;
      AppState.taskCreateStage = 'form';
      await this.renderProjectTasks(true);
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectTaskCreateFeedback(message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.taskCreateApplying = false;
      for (const button of [primaryButton, backButton, cancelButton, closeButton]) {
        if (button?.isConnected) button.disabled = false;
      }
      if (primaryButton?.isConnected && AppState.taskCreatePreview) primaryButton.textContent = '确认并创建';
    }
  },

  getProjectTaskWritebackError(result, fallback = '任务状态变更失败') {
    const code = result?.error_code;
    if (code === 'pending_proposal') return '该任务的相关字段有待确认建议，请先在 Local Project Manager 中处理';
    if (code === 'revision_conflict' || code === 'status_conflict') return '任务事实已变化，请重读投影后重新预览';
    if (code === 'preview_mismatch') return '预览已失效，请关闭后重新生成';
    if (code === 'projection_failed') return '任务事实已回滚，但投影重建失败，请检查 Local Project Manager';
    if (code === 'no_changes') return '没有检测到字段变化';
    if (code === 'invalid_date' || code === 'invalid_date_range') return '请检查开始日期与目标日期';
    if (code === 'stage_not_found' || code === 'parent_task_not_found') return '阶段或父任务已经变化，请重读投影后重新预览';
    if (code === 'task_already_exists' || code === 'pending_task_proposal') return '任务 ID 已被占用，请关闭后重新生成创建预览';
    return result?.error || fallback;
  },

  async previewProjectTaskStatus(taskKey, targetStatus, triggerButton) {
    if (!taskKey || !targetStatus || AppState.taskStatusPreviewLoading || AppState.taskStatusApplying) return;
    AppState.taskStatusPreviewLoading = true;
    if (triggerButton) {
      triggerButton.disabled = true;
      triggerButton.textContent = '正在生成…';
    }
    this.setProjectTaskStatusFeedback(taskKey, '正在由 Local Project Manager 校验当前修订…');
    try {
      const preview = await window.gitFinder.projectTasks.previewStatusChange(taskKey, targetStatus);
      if (!preview?.success) {
        const message = this.getProjectTaskWritebackError(preview, '无法生成状态变更预览');
        this.setProjectTaskStatusFeedback(taskKey, message, 'error');
        this._showStatusMessage(message, 'error');
        return;
      }
      AppState.taskStatusPreview = { ...preview, taskKey };
      this.openProjectTaskStatusPreview();
      this.setProjectTaskStatusFeedback(taskKey, '预览已生成，尚未写入任何文件', 'success');
    } catch (error) {
      const message = error?.message || String(error);
      this.setProjectTaskStatusFeedback(taskKey, message, 'error');
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.taskStatusPreviewLoading = false;
      if (triggerButton?.isConnected) {
        triggerButton.disabled = false;
        triggerButton.textContent = '预览变更';
      }
    }
  },

  openProjectTaskStatusPreview() {
    const preview = AppState.taskStatusPreview;
    const modal = document.getElementById('task-status-modal');
    const body = document.getElementById('task-status-preview-body');
    const feedback = document.getElementById('task-status-review-feedback');
    const applyButton = document.getElementById('task-status-apply-btn');
    const cancelButton = document.getElementById('task-status-cancel-btn');
    if (!preview || !modal || !body || !applyButton) return;
    body.innerHTML = this.getProjectTaskStatusPreviewHtml(preview);
    if (feedback) {
      feedback.textContent = '预览为只读；确认后才会创建备份并写入';
      feedback.className = '';
    }
    applyButton.disabled = false;
    applyButton.textContent = '确认并应用';
    modal.style.display = 'flex';
    requestAnimationFrame(() => cancelButton?.focus());
  },

  closeProjectTaskStatusPreview() {
    if (AppState.taskStatusApplying) return;
    const preview = AppState.taskStatusPreview;
    const modal = document.getElementById('task-status-modal');
    if (modal) modal.style.display = 'none';
    AppState.taskStatusPreview = null;
    if (preview?.taskKey) {
      this.setProjectTaskStatusFeedback(preview.taskKey, '预览已取消，未写入任何文件');
    }
  },

  async applyProjectTaskStatus() {
    const preview = AppState.taskStatusPreview;
    if (!preview || AppState.taskStatusApplying) return;
    const applyButton = document.getElementById('task-status-apply-btn');
    const cancelButton = document.getElementById('task-status-cancel-btn');
    const closeButton = document.getElementById('task-status-close-btn');
    const feedback = document.getElementById('task-status-review-feedback');
    AppState.taskStatusApplying = true;
    if (applyButton) {
      applyButton.disabled = true;
      applyButton.textContent = '正在应用…';
    }
    if (cancelButton) cancelButton.disabled = true;
    if (closeButton) closeButton.disabled = true;
    if (feedback) {
      feedback.textContent = '正在锁定修订、备份事实并重建投影…';
      feedback.className = 'working';
    }
    try {
      const result = await window.gitFinder.projectTasks.applyStatusChange(preview.taskKey, {
        currentStatus: preview.current_status,
        targetStatus: preview.target_status,
        revision: preview.revision,
        previewToken: preview.preview_token,
        operationId: preview.operation_id
      });
      if (!result?.success) {
        const message = this.getProjectTaskWritebackError(result);
        if (feedback) {
          feedback.textContent = message;
          feedback.className = 'error';
        }
        this._showStatusMessage(message, 'error');
        return;
      }
      if (feedback) {
        feedback.textContent = result.already_applied ? '该操作已安全应用，无重复写入' : '状态已写入，正在重读任务投影…';
        feedback.className = 'success';
      }
      const message = result.already_applied ? '任务状态已是所确认的结果' : '任务状态已由 Local Project Manager 安全写入';
      this._showStatusMessage(message, 'success');
      const modal = document.getElementById('task-status-modal');
      if (modal) modal.style.display = 'none';
      AppState.taskStatusPreview = null;
      await this.renderProjectTasks(true);
    } catch (error) {
      const message = error?.message || String(error);
      if (feedback) {
        feedback.textContent = message;
        feedback.className = 'error';
      }
      this._showStatusMessage(message, 'error');
    } finally {
      AppState.taskStatusApplying = false;
      if (applyButton?.isConnected) {
        applyButton.disabled = false;
        applyButton.textContent = '确认并应用';
      }
      if (cancelButton?.isConnected) cancelButton.disabled = false;
      if (closeButton?.isConnected) closeButton.disabled = false;
    }
  },

  bindProjectTaskStatusModalEvents() {
    const modal = document.getElementById('task-status-modal');
    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';
    document.getElementById('task-status-close-btn')?.addEventListener('click', () => this.closeProjectTaskStatusPreview());
    document.getElementById('task-status-cancel-btn')?.addEventListener('click', () => this.closeProjectTaskStatusPreview());
    document.getElementById('task-status-apply-btn')?.addEventListener('click', () => this.applyProjectTaskStatus());
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      event.stopImmediatePropagation();
      if (!AppState.taskStatusApplying) this.closeProjectTaskStatusPreview();
    }, true);
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || AppState.taskStatusApplying) return;
      event.preventDefault();
      this.closeProjectTaskStatusPreview();
    });
  },

  bindProjectTaskEditModalEvents() {
    const modal = document.getElementById('task-edit-modal');
    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';
    document.getElementById('task-edit-close-btn')?.addEventListener('click', () => this.closeProjectTaskEdit());
    document.getElementById('task-edit-cancel-btn')?.addEventListener('click', () => this.closeProjectTaskEdit());
    document.getElementById('task-edit-back-btn')?.addEventListener('click', () => this.returnToProjectTaskEdit());
    document.getElementById('task-edit-primary-btn')?.addEventListener('click', () => {
      const action = AppState.taskEditStage === 'preview'
        ? this.applyProjectTaskUpdate()
        : this.previewProjectTaskUpdate();
      action?.catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
    });
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      event.stopImmediatePropagation();
      if (!AppState.taskEditApplying) this.closeProjectTaskEdit();
    }, true);
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || AppState.taskEditApplying) return;
      event.preventDefault();
      this.closeProjectTaskEdit();
    });
  },

  bindProjectTaskCreateModalEvents() {
    const modal = document.getElementById('task-create-modal');
    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';
    document.getElementById('task-create-close-btn')?.addEventListener('click', () => this.closeProjectTaskCreate());
    document.getElementById('task-create-cancel-btn')?.addEventListener('click', () => this.closeProjectTaskCreate());
    document.getElementById('task-create-back-btn')?.addEventListener('click', () => this.returnToProjectTaskCreate());
    document.getElementById('task-create-primary-btn')?.addEventListener('click', () => {
      const action = AppState.taskCreateStage === 'preview'
        ? this.applyProjectTaskCreate()
        : this.previewProjectTaskCreate();
      action?.catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
    });
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      event.stopImmediatePropagation();
      if (!AppState.taskCreateApplying) this.closeProjectTaskCreate();
    }, true);
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || AppState.taskCreateApplying) return;
      event.preventDefault();
      this.closeProjectTaskCreate();
    });
  },

  bindProjectMilestoneEditModalEvents() {
    const modal = document.getElementById('milestone-edit-modal');
    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';
    document.getElementById('milestone-edit-close-btn')?.addEventListener('click', () => this.closeProjectMilestoneEdit());
    document.getElementById('milestone-edit-cancel-btn')?.addEventListener('click', () => this.closeProjectMilestoneEdit());
    document.getElementById('milestone-edit-back-btn')?.addEventListener('click', () => this.returnToProjectMilestoneEdit());
    document.getElementById('milestone-edit-primary-btn')?.addEventListener('click', () => {
      const action = AppState.milestoneEditStage === 'preview'
        ? this.applyProjectMilestoneUpdate()
        : this.previewProjectMilestoneUpdate();
      action?.catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
    });
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      event.stopImmediatePropagation();
      if (!AppState.milestoneEditApplying) this.closeProjectMilestoneEdit();
    }, true);
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || AppState.milestoneEditApplying) return;
      event.preventDefault();
      this.closeProjectMilestoneEdit();
    });
  },

  bindProjectTaskEvents(contentArea) {
    this.bindProjectTaskStatusModalEvents();
    this.bindProjectTaskEditModalEvents();
    this.bindProjectTaskCreateModalEvents();
    this.bindProjectMilestoneEditModalEvents();
    contentArea.querySelector('#task-refresh')?.addEventListener('click', () => this.renderProjectTasks(true));
    contentArea.querySelector('#task-create')?.addEventListener('click', () => this.openProjectTaskCreate());
    contentArea.querySelector('#task-project-filter')?.addEventListener('change', event => {
      AppState.taskFilters.projectId = event.target.value;
      this.resetProjectTaskScrollState();
      this.renderProjectTasksView();
    });
    contentArea.querySelector('#task-status-filter')?.addEventListener('change', event => {
      AppState.taskFilters.status = event.target.value;
      this.resetProjectTaskScrollState();
      this.renderProjectTasksView();
    });
    contentArea.querySelector('#task-priority-filter')?.addEventListener('change', event => {
      AppState.taskFilters.priority = event.target.value;
      this.resetProjectTaskScrollState();
      this.renderProjectTasksView();
    });
    contentArea.querySelector('#task-leaf-filter')?.addEventListener('change', event => {
      AppState.taskFilters.leafOnly = event.target.checked;
      this.resetProjectTaskScrollState();
      this.renderProjectTasksView();
    });
    contentArea.querySelector('#milestone-status-filter')?.addEventListener('change', event => {
      AppState.milestoneStatusFilter = event.target.value;
      AppState.taskListScrollTop = 0;
      this.renderProjectTasksView();
    });
    contentArea.querySelector('#task-timeline-category-filter')?.addEventListener('change', event => {
      const category = event.target.value;
      if (!['all', 'activity', 'test', 'evidence', 'acceptance', 'automation'].includes(category)) return;
      AppState.taskTimelineCategory = category;
      AppState.taskTimelineScrollTop = 0;
      this.renderProjectTasksView();
      window.gitFinder.config.set('taskTimelineCategory', category).catch(error => {
        console.warn('时间线筛选偏好保存失败:', error);
      });
    });
    contentArea.querySelectorAll('[data-task-view]').forEach(button => {
      button.addEventListener('click', () => {
        this.setProjectTaskViewMode(button.dataset.taskView).catch(error => {
          console.warn('任务视图切换失败:', error);
        });
      });
    });
    contentArea.querySelectorAll('[data-task-key]').forEach(button => {
      button.addEventListener('click', () => this.selectProjectTask(button.dataset.taskKey));
    });
    contentArea.querySelectorAll('[data-milestone-key]').forEach(button => {
      button.addEventListener('click', () => this.selectProjectMilestone(button.dataset.milestoneKey));
    });
    contentArea.querySelectorAll('[data-task-timeline-open]').forEach(button => {
      button.addEventListener('click', () => {
        this.openProjectTaskFromTimeline(button.dataset.taskTimelineOpen).catch(error => {
          console.warn('时间线任务打开失败:', error);
        });
      });
    });
    contentArea.querySelectorAll('[data-task-open-detail]').forEach(button => {
      button.addEventListener('click', () => {
        this.openProjectTaskDetail(button.dataset.taskOpenDetail).catch(error => {
          console.warn('完整任务详情打开失败:', error);
        });
      });
    });
    contentArea.querySelectorAll('[data-task-open-path]').forEach(button => {
      button.addEventListener('click', () => this.openTaskPath(button.dataset.taskOpenPath));
    });
    contentArea.querySelectorAll('[data-task-terminal-path]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await window.gitFinder.terminal.openExternal(button.dataset.taskTerminalPath);
        } catch (error) {
          this._showStatusMessage(`终端打开失败：${error?.message || error}`, 'error');
        }
      });
    });
    contentArea.querySelectorAll('[data-task-edit]').forEach(button => {
      button.addEventListener('click', () => this.openProjectTaskEdit(button.dataset.taskEdit));
    });
    contentArea.querySelectorAll('[data-milestone-edit]').forEach(button => {
      button.addEventListener('click', () => this.openProjectMilestoneEdit(button.dataset.milestoneEdit));
    });
    contentArea.querySelectorAll('[data-task-create-child]').forEach(button => {
      button.addEventListener('click', () => this.openProjectTaskCreate(button.dataset.taskCreateChild));
    });
    contentArea.querySelectorAll('[data-task-git-refresh]').forEach(button => {
      button.addEventListener('click', () => {
        this.loadProjectTaskGitEvidence(button.dataset.taskGitRefresh, true).catch(error => {
          console.warn('任务 Git 实况刷新失败:', error);
        });
      });
    });
    contentArea.querySelectorAll('[data-task-status-preview]').forEach(button => {
      button.addEventListener('click', () => {
        const taskKey = button.dataset.taskStatusPreview;
        const select = [...contentArea.querySelectorAll('[data-task-status-select]')]
          .find(element => element.dataset.taskStatusSelect === taskKey);
        this.previewProjectTaskStatus(taskKey, select?.value, button).catch(error => {
          this._showStatusMessage(error?.message || String(error), 'error');
        });
      });
    });
    this.bindProjectTaskGitEvidenceActions(contentArea);
  },

  bindProjectTaskGitEvidenceActions(scope) {
    scope.querySelectorAll('[data-task-review-path]').forEach(button => {
      button.addEventListener('click', () => {
        this.openTaskRepositoryReview(button.dataset.taskReviewPath).catch(error => {
          this._showStatusMessage(`仓库审查打开失败：${error?.message || error}`, 'error');
        });
      });
    });
  },

  async openTaskRepositoryReview(repoPath) {
    if (!repoPath) return;
    AppState.currentMode = 'tree';
    AppState.contentQuery = window.ContentQuery.queryForPreset('current-all');
    AppState.searchScope = 'current';
    this.updateModeUI();
    this.updateBreadcrumbs();
    await this.navigateTo(repoPath);
    await this.selectRepo(repoPath);
  },

  openTaskPath(targetPath) {
    if (!targetPath) return;
    AppState.currentMode = 'tree';
    AppState.contentQuery = window.ContentQuery.queryForPreset('current-all');
    AppState.searchScope = 'current';
    this.updateModeUI();
    this.updateBreadcrumbs();
    this.navigateTo(targetPath);
  },

  getTaskWarningLabel(warning) {
    if (warning.code === 'path-rebound') return `${warning.projectId || '项目'}：注册路径已自动重绑定`;
    if (warning.code === 'projection-stale') return `${warning.projectId || '项目'}：投影已过期`;
    if (warning.code === 'invalid-project') return `${warning.projectId || '项目'}：投影不可用`;
    return warning.message || '投影需要检查';
  },

  formatTaskTimestamp(value) {
    if (!value) return '未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }
});
