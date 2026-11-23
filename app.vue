<template>
  <div>
    <UIPrHeader />
    <main>
      <NuxtPage />
    </main>
    <UIPrFooter/>
    <UIPrAgentChat/>
  </div>
</template>

<script>
import AOS from "aos";
import 'aos/dist/aos.css';

export default {
  mounted() {
    if (process.client) {
      AOS.init();
    }
  },
}
</script>