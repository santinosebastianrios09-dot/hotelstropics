import Bottleneck from 'bottleneck';

// Cola global simple para tareas costosas (ej. LLM o Sheets)
const limiter = new Bottleneck({ maxConcurrent: 3, minTime: 100 });

export function enqueue<T>(task: () => Promise<T>) {
  return limiter.schedule(task);
}
