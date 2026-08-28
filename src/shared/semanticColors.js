(function exposeSemanticColors(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SemanticColors = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSemanticColorsApi() {
  const VERSION = 1;
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
  const ROLE_KEYS = Object.freeze(['folder', 'project', 'gitBadge', 'gitMark']);
  const LIFECYCLE_KEYS = Object.freeze([
    'inbox', 'planned', 'active', 'validation', 'deployed',
    'maintenance', 'paused', 'frozen', 'abandoned', 'archived'
  ]);
  const LIFECYCLE_LABELS = Object.freeze({
    inbox: '待整理',
    planned: '已规划',
    active: '开发中',
    validation: '验证中',
    deployed: '已部署',
    maintenance: '维护中',
    paused: '暂停',
    frozen: '已冻结',
    abandoned: '已废弃',
    archived: '归档'
  });

  const PRESETS = Object.freeze({
    finder: Object.freeze({
      label: '访达语义',
      colors: Object.freeze({
        folder: '#4f7fa8',
        project: '#0a84ff',
        gitBadge: '#7a4fd0',
        gitMark: '#ffffff'
      }),
      lifecycle: Object.freeze({
        inbox: '#8e8e93', planned: '#5e5ce6', active: '#2f9e54', validation: '#c47a00', deployed: '#007aff',
        maintenance: '#168aad', paused: '#d97706', frozen: '#6b7280', abandoned: '#d63b35', archived: '#636366'
      })
    }),
    contrast: Object.freeze({
      label: '高对比',
      colors: Object.freeze({
        folder: '#0072b2',
        project: '#009e73',
        gitBadge: '#7e3ff2',
        gitMark: '#ffffff'
      }),
      lifecycle: Object.freeze({
        inbox: '#5f6368', planned: '#005bbb', active: '#007f5f', validation: '#b35c00', deployed: '#0067c5',
        maintenance: '#0072b2', paused: '#b35c00', frozen: '#5f6368', abandoned: '#c62828', archived: '#3f4348'
      })
    }),
    soft: Object.freeze({
      label: '柔和',
      colors: Object.freeze({
        folder: '#7890a8',
        project: '#6a8a6e',
        gitBadge: '#8066b3',
        gitMark: '#ffffff'
      }),
      lifecycle: Object.freeze({
        inbox: '#8b8b91', planned: '#7674a8', active: '#6a8a6e', validation: '#9a8055', deployed: '#617f9d',
        maintenance: '#668d99', paused: '#9a8055', frozen: '#7d8188', abandoned: '#a86868', archived: '#696b70'
      })
    })
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeHex(value, fallback) {
    const candidate = String(value || '').trim().toLowerCase();
    return COLOR_PATTERN.test(candidate) ? candidate : fallback;
  }

  function profileForPreset(presetId = 'finder') {
    const id = Object.hasOwn(PRESETS, presetId) ? presetId : 'finder';
    const preset = PRESETS[id];
    return {
      version: VERSION,
      preset: id,
      colors: clone(preset.colors),
      lifecycle: clone(preset.lifecycle)
    };
  }

  function normalizeProfile(value) {
    const fallback = profileForPreset('finder');
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const preset = Object.hasOwn(PRESETS, source.preset) ? source.preset : 'custom';
    const profile = {
      version: VERSION,
      preset,
      colors: {},
      lifecycle: {}
    };
    for (const key of ROLE_KEYS) {
      profile.colors[key] = normalizeHex(source.colors?.[key], fallback.colors[key]);
    }
    for (const key of LIFECYCLE_KEYS) {
      profile.lifecycle[key] = normalizeHex(source.lifecycle?.[key], fallback.lifecycle[key]);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) profile.preset = 'finder';
    return profile;
  }

  function hexToRgb(value) {
    const normalized = normalizeHex(value, '#000000');
    return {
      r: Number.parseInt(normalized.slice(1, 3), 16),
      g: Number.parseInt(normalized.slice(3, 5), 16),
      b: Number.parseInt(normalized.slice(5, 7), 16)
    };
  }

  function colorDistance(left, right) {
    const a = hexToRgb(left);
    const b = hexToRgb(right);
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  }

  function roleCollisions(value, threshold = 56) {
    const profile = normalizeProfile(value);
    const pairs = [
      ['folder', 'gitBadge'],
      ['project', 'gitBadge']
    ];
    return pairs
      .filter(([left, right]) => colorDistance(profile.colors[left], profile.colors[right]) < threshold)
      .map(([left, right]) => ({ left, right }));
  }

  function cssVariables(value) {
    const profile = normalizeProfile(value);
    const variables = {
      '--folder-color': profile.colors.folder,
      '--project-folder-default-color': profile.colors.project,
      '--repository-color': profile.colors.gitBadge,
      '--repository-mark-color': profile.colors.gitMark
    };
    for (const key of LIFECYCLE_KEYS) variables[`--lifecycle-${key}`] = profile.lifecycle[key];
    return variables;
  }

  function applyToElement(element, value) {
    if (!element?.style?.setProperty) return normalizeProfile(value);
    const profile = normalizeProfile(value);
    for (const [name, color] of Object.entries(cssVariables(profile))) element.style.setProperty(name, color);
    return profile;
  }

  function lifecycleColor(value, lifecycle) {
    const profile = normalizeProfile(value);
    return profile.lifecycle[LIFECYCLE_KEYS.includes(lifecycle) ? lifecycle : 'active'];
  }

  return {
    VERSION,
    COLOR_PATTERN,
    ROLE_KEYS,
    LIFECYCLE_KEYS,
    LIFECYCLE_LABELS,
    PRESETS,
    normalizeHex,
    normalizeProfile,
    profileForPreset,
    colorDistance,
    roleCollisions,
    cssVariables,
    applyToElement,
    lifecycleColor
  };
});
