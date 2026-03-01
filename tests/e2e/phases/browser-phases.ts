import type { Phase } from '../helpers/types.js';

export const browserPhases: Phase[] = [
  {
    name: 'Browser Launch & Navigation',
    setup: ['browser_launch', 'page_navigate'],
    tools: ['browser_status', 'browser_list_tabs', 'browser_select_tab', 'page_get_performance'],
  },
  {
    name: 'DOM & Page Interaction',
    setup: [],
    tools: [
      'dom_query_selector', 'dom_query_all', 'dom_get_structure',
      'dom_find_clickable', 'dom_find_by_text', 'dom_get_xpath',
      'dom_is_in_viewport', 'dom_get_computed_style',
      'page_click', 'page_type', 'page_hover', 'page_scroll',
      'page_back', 'page_forward', 'page_reload',
      'page_press_key', 'page_wait_for_selector',
      'page_evaluate', 'page_inject_script',
      'page_get_all_links', 'page_screenshot',
      'page_set_viewport', 'page_emulate_device',
    ],
  },
  {
    name: 'Cookies & Storage',
    setup: [],
    tools: ['page_get_cookies', 'page_set_cookies', 'page_clear_cookies', 'page_get_local_storage', 'page_set_local_storage'],
  },
  { name: 'IndexedDB', setup: [], tools: ['indexeddb_dump'] },
  {
    name: 'Page Select (needs injected element)',
    setup: async (call) => {
      await call('page_evaluate', { code: `
        if (!document.querySelector('#test_select_e2e')) {
          const s = document.createElement('select');
          s.id = 'test_select_e2e';
          s.innerHTML = '<option value="a">A</option><option value="b">B</option>';
          document.body.appendChild(s);
        }
        'ok'
      ` });
    },
    tools: ['page_select'],
  },
  {
    name: 'Stealth & Captcha',
    setup: [],
    tools: ['stealth_inject', 'stealth_set_user_agent', 'captcha_detect', 'captcha_config'],
  },
  { name: 'Camoufox', setup: [], tools: ['camoufox_server_status'] },
];
