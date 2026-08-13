export type LatestTaskQueue<T> = {
  push: (value: T) => void;
  flush: () => Promise<void>;
};

/**
 * Executa no máximo uma tarefa por vez. Enquanto ela está em andamento,
 * substitui trabalhos intermediários pelo estado mais recente. É ideal para
 * persistência de snapshots grandes, em que gravar A, B e C não traz benefício
 * se C já contém o estado completo.
 */
export function createLatestTaskQueue<T, R>(
  task: (value: T) => Promise<R>,
  onResult?: (result: R) => void,
): LatestTaskQueue<T> {
  let pending: T | undefined;
  let running: Promise<void> | null = null;

  const drain = async () => {
    while (pending !== undefined) {
      const value = pending;
      pending = undefined;
      const result = await task(value);
      onResult?.(result);
    }
  };

  const start = () => {
    if (running) return running;
    running = drain().finally(() => {
      running = null;
      if (pending !== undefined) void start();
    });
    return running;
  };

  return {
    push(value) {
      pending = value;
      void start();
    },
    async flush() {
      while (running || pending !== undefined) {
        await (running ?? start());
      }
    },
  };
}
