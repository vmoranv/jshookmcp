import type { Phase } from '@tests/e2e/helpers/types';

const DOM_FIXTURE_URL =
  'data:text/html,<html><body><button id="e2e_click_target">E2E Click</button><input id="e2e_text_input" type="text" /><div id="e2e_hover_target" style="width:120px;height:32px">E2E Hover</div></body></html>';

export const browserPhases: Phase[] = [
  {
    name: 'Browser Launch & Navigation',
    setup: ['browser_launch', 'page_navigate'],
    tools: ['browser_status', 'browser_list_tabs', 'browser_select_tab', 'browser_attach'],
  },
  {
    name: 'DOM & Page Interaction',
    setup: async (call) => {
      await call('page_navigate', {
        url: DOM_FIXTURE_URL,
        waitUntil: 'load',
        timeout: 15000,
      });
      await call('page_evaluate', {
        code: `
        (() => {
          if (!document.querySelector('#e2e_click_target')) {
            const button = document.createElement('button');
            button.id = 'e2e_click_target';
            button.textContent = 'E2E Click';
            document.body.appendChild(button);
          }
          if (!document.querySelector('#e2e_text_input')) {
            const input = document.createElement('input');
            input.id = 'e2e_text_input';
            input.type = 'text';
            input.value = '';
            document.body.appendChild(input);
          }
          if (!document.querySelector('#e2e_hover_target')) {
            const target = document.createElement('div');
            target.id = 'e2e_hover_target';
            target.textContent = 'E2E Hover';
            target.style.width = '120px';
            target.style.height = '32px';
            document.body.appendChild(target);
          }
          return 'ok';
        })()
        `,
      });
      await call('save_page_snapshot', { label: 'e2e-dom-phase' });
    },
    tools: [
      'canvas_trace_click_handler',
      'dom_query_selector',
      'dom_query_all',
      'dom_get_structure',
      'dom_find_clickable',
      'dom_find_by_text',
      'dom_get_xpath',
      'dom_is_in_viewport',
      'dom_get_computed_style',
      'page_click',
      'page_type',
      'page_hover',
      'page_scroll',
      'page_reload',
      'page_back',
      'page_forward',
      'page_press_key',
      'page_wait_for_selector',
      'page_evaluate',
      'page_inject_script',
      'page_get_all_links',
      'page_screenshot',
      'page_set_viewport',
      'page_emulate_device',
    ],
  },
  {
    name: 'Cookies & Storage',
    setup: ['page_navigate'],
    tools: [
      'page_get_cookies',
      'page_set_cookies',
      'page_clear_cookies',
      'page_get_local_storage',
      'page_set_local_storage',
    ],
  },
  { name: 'IndexedDB', setup: [], tools: ['indexeddb_dump'] },
  {
    name: 'Page Select (needs injected element)',
    setup: async (call) => {
      await call('page_navigate', {
        url: 'data:text/html,<html><body><select id="test_select_e2e"><option value="a">A</option><option value="b">B</option></select></body></html>',
        waitUntil: 'load',
        timeout: 15000,
      });
      await call('page_evaluate', {
        code: `
        (() => {
          if (!document.querySelector('#test_select_e2e')) {
            const s = document.createElement('select');
            s.id = 'test_select_e2e';
            s.innerHTML = '<option value="a">A</option><option value="b">B</option>';
            document.body.appendChild(s);
          }
          return 'ok';
        })()
      `,
      });
    },
    tools: ['page_select'],
  },
  {
    name: 'Stealth & Captcha',
    setup: [],
    tools: [
      'stealth_inject',
      'stealth_set_user_agent',
      'captcha_detect',
      'captcha_config',
      'captcha_wait',
    ],
  },
  {
    name: 'Camoufox',
    setup: [],
    tools: ['camoufox_server_status', 'camoufox_server_launch', 'camoufox_server_close'],
  },
  {
    name: 'Human Behavior Simulation',
    setup: async (call) => {
      await call('page_navigate', {
        url: DOM_FIXTURE_URL,
        waitUntil: 'load',
        timeout: 15000,
      });
      // Inject an <input> element so human_typing has a real target
      await call('page_evaluate', {
        code: `
        if (!document.querySelector('#e2e_hover_target')) {
          const target = document.createElement('div');
          target.id = 'e2e_hover_target';
          target.textContent = 'E2E Hover';
          target.style.width = '120px';
          target.style.height = '32px';
          document.body.appendChild(target);
        }
        if (!document.querySelector('#e2e_human_input')) {
          const inp = document.createElement('input');
          inp.id = 'e2e_human_input';
          inp.type = 'text';
          inp.placeholder = 'e2e human typing target';
          document.body.appendChild(inp);
        }
        'ok'
        `,
      });
    },
    tools: ['human_mouse', 'human_scroll', 'human_typing'],
  },
  {
    name: 'Captcha Advanced',
    setup: [],
    tools: ['captcha_vision_solve', 'widget_challenge_solve'],
  },
  {
    name: 'CDP Target Management',
    setup: [],
    tools: [
      'browser_list_cdp_targets',
      'browser_attach_cdp_target',
      'browser_detach_cdp_target',
      'browser_evaluate_cdp_target',
    ],
  },
  {
    name: 'JSDOM',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: [
      'browser_jsdom_parse',
      'browser_jsdom_query',
      'browser_jsdom_execute',
      'browser_jsdom_serialize',
      'browser_jsdom_cookies',
    ],
  },
  {
    name: 'Page Storage (short-name aliases)',
    setup: [],
    tools: ['page_cookies', 'page_local_storage'],
  },
  {
    name: 'Camoufox Server',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: ['camoufox_server', 'camoufox_geolocation'],
  },
];
