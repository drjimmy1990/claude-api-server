/**
 * Simple async queue to ensure only one message is processed at a time.
 * Claude.ai can't handle parallel interactions in the same tab.
 */
class AsyncQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Add a task to the queue and wait for its result
   * @param {Function} task - async function to execute
   * @returns {Promise} - resolves with the task result
   */
  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._process();
    });
  }

  async _process() {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    const { task, resolve, reject } = this.queue.shift();

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.processing = false;
      this._process(); // Process next in queue
    }
  }

  /**
   * Get current queue size
   */
  get size() {
    return this.queue.length;
  }

  /**
   * Check if currently processing
   */
  get busy() {
    return this.processing;
  }
}

module.exports = new AsyncQueue();
