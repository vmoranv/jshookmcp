import DefaultTheme from 'vitepress/theme';
import { h, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vitepress';
import mediumZoom from 'medium-zoom';
import './style.css';
import ShareButton from './components/ShareButton.vue';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'aside-outline-after': () => h(ShareButton),
    });
  },
  setup() {
    const route = useRoute();
    const initZoom = () => {
      // Initialize zoom on all images inside the main VitePress document container
      mediumZoom('.vp-doc img', { background: 'var(--vp-c-bg)' });
    };
    onMounted(() => {
      initZoom();
    });
    watch(
      () => route.path,
      () => nextTick(() => initZoom())
    );
  },
};
