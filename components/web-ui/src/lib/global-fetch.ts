const originalFetch = window.fetch;
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const res = await originalFetch(...args);
  if (res.status === 403) {
    window.dispatchEvent(new CustomEvent('openvelo:forbidden'));
  }
  return res;
};