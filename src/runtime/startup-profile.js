export function createStartupProfiler({ enabled = process.env.DOC_PI_STARTUP_PROFILE === '1', now = () => performance.now(), output = process.stderr } = {}) {
  const start = now();

  function write(name, elapsed) {
    if (!enabled) return;
    output.write(`[doc-pi] startup ${name}: ${Math.round(elapsed)}ms\n`);
  }

  return {
    async step(name, fn) {
      const stepStart = now();
      try {
        return await fn();
      } finally {
        write(name, now() - stepStart);
      }
    },
    done() {
      write('total', now() - start);
    },
  };
}
