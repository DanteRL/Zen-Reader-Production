

export type Locale = 'en' | 'zh';

export const translations = {
  zh: {
    // Bookshelf
    bookshelf_title: '书架',
    selected: '已选择',
    search_placeholder: '搜索书库...',
    add_book: '添加书籍',
    empty_hint: '你的书架还是空的，点击上方卡片添加第一本书吧。',
    no_results: '未找到匹配的书籍。',
    delete_confirm_title: '删除书籍？',
    delete_confirm_msg: '你确定要删除',
    delete_confirm_suffix: '本书吗？此操作无法撤销。',
    delete_local: '同时删除本地文件',
    delete_local_hint: '从同步文件夹中移除',
    cancel: '取消',
    delete: '删除',
    total_books: '共 {count} 本书',
    
    // Tabs
    tab_default: '默认',
    tab_recent: '更新',
    tab_progress: '进度',
    tab_title: '书名',
    tab_length: '字数',
    not_started: '未开始',

    // Toolbar (Sync/Import/Export)
    sync: '同步',
    sync_status: '同步状态',
    connected: '已连接',
    disconnected: '未连接',
    sync_now: '立即同步',
    change_folder: '修改同步文件夹',
    set_folder: '设置同步文件夹',
    reconnect_sync: '重新连接',
    permission_required: '需要权限恢复同步',
    
    import: '导入',
    import_file: '添加文件',
    scan_folder: '扫描文件夹',
    restore_backup: '恢复备份',
    
    export: '导出',
    backup_data: '备份数据',

    // Reader
    chapter: '章节',
    page: '页',
    prev_chapter: '上一章',
    next_chapter: '下一章',
    back_to_shelf: '返回书架',
    toc: '目录',
    
    // Settings
    settings_title: '阅读设置',
    theme: '主题',
    theme_day: '日间',
    theme_warm: '护眼',
    theme_night: '夜间',
    
    pdf_options: 'PDF 选项',
    pdf_scroll: '滚动',
    pdf_single: '单页',
    pdf_spread: '双页',
    pdf_zoom: '缩放',
    
    typography: '字体排版',
    font_size: '字号',
    line_height: '行高',
    page_width: '页面宽度',
    align_left: '左对齐',
    align_justify: '两端对齐',
    
    layout_behavior: '布局与交互',
    auto_hide_toolbar: '自动隐藏工具栏',
    hide_delay: '隐藏延迟',
    focus_mode: '专注模式',
    focus_lines: '高亮行数',
    
    ai_companion: 'AI 伴读',
    ai_desc: '选中文字并右键单击以触发 AI 解释或翻译。',
    output_lang: '输出语言',
    api_key: 'Gemini API 密钥',
    get_key: '获取密钥 →',

    // App Interface
    app_language: '界面语言',
    lang_auto: '自动 (Auto)',
    lang_zh: '简体中文',
    lang_en: 'English',
    
    // Text Conversion
    text_conversion: '文本转换',
    text_conv_none: '原文',
    text_conv_cn2tw: '繁体',
    text_conv_tw2cn: '简体',
  },
  en: {
    // Bookshelf
    bookshelf_title: 'Library',
    selected: 'Selected',
    search_placeholder: 'Search library...',
    add_book: 'Add Book',
    empty_hint: 'Your library is empty. Click the card above to add your first book.',
    no_results: 'No matching books found.',
    delete_confirm_title: 'Delete Books?',
    delete_confirm_msg: 'Are you sure you want to delete',
    delete_confirm_suffix: 'book(s)? This action cannot be undone.',
    delete_local: 'Delete local files',
    delete_local_hint: 'Remove from sync folder',
    cancel: 'Cancel',
    delete: 'Delete',
    total_books: '{count} items',

    // Tabs
    tab_default: 'Default',
    tab_recent: 'Recent',
    tab_progress: 'Progress',
    tab_title: 'Title',
    tab_length: 'Length',
    not_started: 'Not Started',

    // Toolbar
    sync: 'Sync',
    sync_status: 'Sync Status',
    connected: 'Connected',
    disconnected: 'Disconnected',
    sync_now: 'Sync Now',
    change_folder: 'Change Folder',
    set_folder: 'Set Sync Folder',
    reconnect_sync: 'Reconnect Sync',
    permission_required: 'Permission Required',

    import: 'Import',
    import_file: 'Add Files',
    scan_folder: 'Scan Folder',
    restore_backup: 'Restore Backup',

    export: 'Export',
    backup_data: 'Backup Data',

    // Reader
    chapter: 'Chapter',
    page: 'Page',
    prev_chapter: 'Previous',
    next_chapter: 'Next Chapter',
    back_to_shelf: 'Back to Shelf',
    toc: 'Table of Contents',

    // Settings
    settings_title: 'Reading Settings',
    theme: 'Theme',
    theme_day: 'Day',
    theme_warm: 'Warm',
    theme_night: 'Night',

    pdf_options: 'PDF Options',
    pdf_scroll: 'Scroll',
    pdf_single: 'Single',
    pdf_spread: 'Spread',
    pdf_zoom: 'Zoom',

    typography: 'Typography',
    font_size: 'Font Size',
    line_height: 'Line Height',
    page_width: 'Page Width',
    align_left: 'Left Align',
    align_justify: 'Justify',

    layout_behavior: 'Layout & Behavior',
    auto_hide_toolbar: 'Auto-hide Toolbar',
    hide_delay: 'Hide Delay',
    focus_mode: 'Focus Mode',
    focus_lines: 'Focus Lines',

    ai_companion: 'AI Companion',
    ai_desc: 'Select text and right-click to trigger AI explanations and translations.',
    output_lang: 'Output Language',
    api_key: 'Gemini API Key',
    get_key: 'Get Key →',

    // App Interface
    app_language: 'Interface Language',
    lang_auto: 'Auto',
    lang_zh: '简体中文',
    lang_en: 'English',

    // Text Conversion
    text_conversion: 'Text Format',
    text_conv_none: 'Original',
    text_conv_cn2tw: 'Traditional',
    text_conv_tw2cn: 'Simplified',
  }
};