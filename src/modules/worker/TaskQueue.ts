import type { QueuedTask } from './types.js';

function getPriority(task: QueuedTask): number {
  const priority = task.message.priority;
  return typeof priority === 'number' ? priority : 0;
}

function compareTasks(left: QueuedTask, right: QueuedTask): number {
  const priorityDiff = getPriority(left) - getPriority(right);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return left.submittedAt - right.submittedAt;
}

export class TaskQueue {
  private readonly items: QueuedTask[] = [];

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  enqueue(task: QueuedTask): void {
    this.items.push(task);
    this.items.sort(compareTasks);
  }

  dequeue(): QueuedTask | undefined {
    return this.items.shift();
  }

  peek(): QueuedTask | undefined {
    return this.items[0];
  }

  cancel(taskId: string): boolean {
    const index = this.items.findIndex((item) => item.message.id === taskId);
    if (index < 0) {
      return false;
    }

    const [task] = this.items.splice(index, 1);
    if (task) {
      task.reject(new Error(`Task ${taskId} cancelled`));
    }
    return true;
  }

  drain(): QueuedTask[] {
    const drained = [...this.items];
    this.items.length = 0;
    return drained;
  }
}
