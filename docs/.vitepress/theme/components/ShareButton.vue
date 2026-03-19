<script setup lang="ts">
import { useData } from 'vitepress';
import { computed, ref } from 'vue';

const { lang } = useData();
const copied = ref(false);

const shareText = computed(() => {
  if (copied.value) return lang.value === 'zh-CN' ? '已复制！' : 'COPIED!';
  return lang.value === 'zh-CN' ? '分享此页' : 'Share this page';
});

const sharePage = () => {
  navigator.clipboard
    .writeText(window.location.href)
    .then(() => {
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
    })
    .catch(console.error);
};
</script>

<template>
  <div class="share-widget">
    <button @click="sharePage" class="share-btn" :class="{ 'is-copied': copied }">
      <svg
        v-if="!copied"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="feather feather-share-2"
      >
        <circle cx="18" cy="5" r="3"></circle>
        <circle cx="6" cy="12" r="3"></circle>
        <circle cx="18" cy="19" r="3"></circle>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="feather feather-check"
      >
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>{{ shareText }}</span>
    </button>
  </div>
</template>

<style scoped>
.share-widget {
  margin-top: 1.5rem;
  display: flex;
  justify-content: flex-start;
}

.share-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  cursor: pointer;
  background: rgba(0, 229, 255, 0.05);
  border: 1px solid var(--vp-c-brand-1);
  padding: 8px 16px;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow:
    0 0 10px rgba(0, 229, 255, 0.1),
    inset 0 0 5px rgba(0, 229, 255, 0.1);
  letter-spacing: 0.5px;
}

.share-btn.is-copied {
  color: #050505;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 15px rgba(0, 229, 255, 0.6);
}

.share-btn:hover:not(.is-copied) {
  background: rgba(0, 229, 255, 0.15);
  box-shadow:
    0 0 15px rgba(0, 229, 255, 0.3),
    inset 0 0 8px rgba(0, 229, 255, 0.2);
}

.share-btn:active {
  transform: scale(0.96);
}

/* Neon scanner effect line */
.share-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 50%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
  transition: none;
}

.share-btn:hover::before {
  left: 200%;
  transition: left 0.6s ease-in-out;
}
</style>
