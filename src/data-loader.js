import isEqual from 'lodash/isEqual';

import { loadFailure, loadSuccess } from './action';
import { isAction } from './utils';
import { fixedWait } from './wait-strategies';

const DEFAULT_OPTIONS = {
  ttl: 10000, // Default TTL: 10s
  retryTimes: 1,
  retryWait: fixedWait(0),
};

function sleep(ms = 0) {
  return new Promise(r => setTimeout(r, ms));
}

class DataLoaderTask {
  constructor(context, monitoredAction, params = {}) {
    if (!isAction(monitoredAction)) {
      throw new Error('action must be a plain object');
    }

    this.context = {
      ...context,
      action: monitoredAction,
    };

    this.params = {
      success({ action }) {
        throw new Error('success() is not implemented', action.type);
      },
      error({ action }) {
        throw new Error('error() is not implemented', action.type);
      },
      loading({ action }) {
        return action;
      },
      shouldFetch() {
        return true;
      },
      async fetch({ action }) {
        throw new Error('Not implemented', action);
      },
      ...params,
    };
  }

  async execute(options = {}) {
    const opts = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    const disableInternalAction = !!options.disableInternalAction;

    if (!this.params.shouldFetch(this.context)) {
      if (!disableInternalAction) {
        const successAction = loadSuccess(this.context.action);
        this.context.dispatch(successAction); // load nothing
      }
      return null;
    }
    const loadingAction = this.params.loading(this.context);
    this.context.dispatch(loadingAction);

    let currentRetry = 0;
    let result;
    let error;

    for (;;) {
      try {
        result = await this.params.fetch(this.context);
        break;
      } catch (ex) {
        currentRetry += 1;
        if (options.retryTimes && currentRetry < opts.retryTimes) {
          const sleepTime = opts.retryWait.next().value;
          await sleep(sleepTime);
        } else {
          error = ex;
          break;
        }
      }
    }

    if (!error) {
      const successAction = this.params.success(this.context, result);

      // Check successAction
      if (successAction.type === this.context.action.type) {
        const errorAction = this.params.error(
          this.context,
          new Error('Result action type equals origial action type', this.context.action),
        );
        this.context.dispatch(errorAction);
        if (!disableInternalAction) {
          this.context.dispatch(loadFailure(this.context.action, error));
        }
        return errorAction;
      }

      this.context.dispatch(successAction);
      if (!disableInternalAction) {
        this.context.dispatch(loadSuccess(this.context.action, result));
      }
      return successAction;
    }

    const errorAction = this.params.error(this.context, error);

    // Check errorAction
    if (errorAction.type === this.context.action.type) {
      this.context.dispatch(errorAction);
      if (!disableInternalAction) {
        this.context.dispatch(loadFailure(this.context.action, error));
      }
      return errorAction;
    }
    this.context.dispatch(errorAction);
    if (!disableInternalAction) {
      this.context.dispatch(loadFailure(this.context.action, error));
    }
    return errorAction;
  }

}

class DataLoaderTaskDescriptor {
  constructor(pattern, params, options) {
    this.pattern = pattern;
    this.params = params;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    if (this.options.retryTimes < 1) {
      this.options.retryTimes = 1;
    }
  }

  supports(action) {
    switch (typeof this.pattern) {
      case 'object':
        return isEqual(this.pattern, action);
      case 'function':
        return this.pattern(action) === true;
      default:
        return this.pattern === action.type;
    }
  }

  newTask(context, action) {
    const worker = new DataLoaderTask(context, action, this.params);
    return worker;
  }
}

/**
 * Create a new DataLoaderDescriptor
 *
 * @param {string|object|function} pattern pattern to match action
 * @param {object} params parameters
 * @param {object} options options
 * @returns {DataLoaderTaskDescriptor} a descriptor object for creating data loader
 */
function createLoader(pattern, params, options) {
  const dataLoaderDescriptor = new DataLoaderTaskDescriptor(pattern, params, options);
  return dataLoaderDescriptor;
}

export default createLoader;
