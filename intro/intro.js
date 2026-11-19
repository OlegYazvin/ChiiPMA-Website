(() => {
  const button = document.querySelector('#fullscreen');
  if (!document.fullscreenEnabled) return;
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      button.textContent = 'Use browser fullscreen';
    }
  });
})();
