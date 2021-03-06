import { expect } from 'chai';
import { describe, it } from 'mocha';
import { createStore, applyMiddleware } from 'redux';

import { load, createLoader, fixedWait, createDataLoaderMiddleware } from '../src';

export const FETCH_USER_REQUEST = 'myapp/user/FETCH_USER/REQUEST';
export const FETCH_USER_SUCCESS = 'myapp/user/FETCH_USER/SUCCESS';
export const FETCH_USER_FAILURE = 'myapp/user/FETCH_USER/FAILURE';

/* API */
const users = {
  tom: {
    age: 21,
    givenName: 'Tom',
    familyName: 'TomFamilyName',
  },
  bob: {
    age: 30,
    givenName: 'Bob',
    familyName: 'BobFamilyName',
  },
};

function findUserByUsername(username) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const result = users[username];
      if (!result) {
        reject('notFound');
        return;
      }
      resolve(users[username]);
    }, 100);
  });
}

/* Actions */
const userActions = {
  fetchUserRequest: (username, ver = Date.now()) => load({
    type: FETCH_USER_REQUEST,
    payload: {
      username,
      ver,
    },
  }),
  fetchUserSuccess: (username, data) => ({
    type: FETCH_USER_SUCCESS,
    payload: {
      username,
      data,
    },
  }),
  fetchUserFailure: (username, error) => ({
    type: FETCH_USER_FAILURE,
    payload: {
      username,
      error,
    },
    error: true,
  }),
};

/* Dataloader */
const userLoader = createLoader(FETCH_USER_REQUEST, {
  success: ({ action }, result) => {
    const username = action.payload.username;
    return userActions.fetchUserSuccess(username, result);
  },
  error: ({ action }, error) => {
    const username = action.payload.username;
    return userActions.fetchUserFailure(username, error);
  },
  fetch: ({ action, api }) => {
    const { username } = action.payload;
    return api.read(username);
  },
  shouldFetch: ({ action, getState }) => {
    const username = action.payload.username;
    return !getState()[username];
  },
}, {
  ttl: 10000,
  retryTimes: 3,
  retryWait: fixedWait(500),
});


/* Reducer */
const initState = {};

function reducer(state = initState, action) {
  switch (action.type) {
    case FETCH_USER_SUCCESS: {
      const { username, data } = action.payload;
      return Object.assign({}, state, {
        [username]: data,
      });
    }
    case FETCH_USER_FAILURE: {
      const { username } = action.payload;
      return Object.assign({}, state, {
        [username]: {
          error: true,
        },
      });
    }
    default:
      return state;
  }
}

describe('createDataLoaderMiddleware', () => {
  it('dispatch a request action with exist username, data should be stored successfully', (done) => {
    const dataLoaderMiddleware = createDataLoaderMiddleware([userLoader], {
      api: {
        read: findUserByUsername,
      },
    });
    const store = createStore(
      reducer,
      applyMiddleware(dataLoaderMiddleware),
    );
    store
      .dispatch(userActions.fetchUserRequest('tom'))
      .then(() => {
        expect(store.getState()).to.be.deep.equal({
          tom: {
            age: 21,
            givenName: 'Tom',
            familyName: 'TomFamilyName',
          },
        });
        done();
      }).catch(done);
  });

  it('dispatch two request actions with exist username at the same time, data should be stored successfully', (done) => {
    const dataLoaderMiddleware = createDataLoaderMiddleware([userLoader], {
      api: {
        read: findUserByUsername,
      },
    });
    const store = createStore(
      reducer,
      applyMiddleware(dataLoaderMiddleware),
    );
    Promise.all([
      store.dispatch(userActions.fetchUserRequest('tom')),
      store.dispatch(userActions.fetchUserRequest('bob')),
    ])
      .then(() => {
        expect(store.getState()).to.be.deep.equal({
          bob: {
            age: 30,
            givenName: 'Bob',
            familyName: 'BobFamilyName',
          },
          tom: {
            age: 21,
            givenName: 'Tom',
            familyName: 'TomFamilyName',
          },
        });
        done();
      }).catch(done);
  });

  it('dispatch a request action and cause an error, data error action should be dispatched', (done) => {
    const dataLoaderMiddleware = createDataLoaderMiddleware([userLoader], {
      api: {
        read: findUserByUsername,
      },
    });
    const store = createStore(
      reducer,
      applyMiddleware(dataLoaderMiddleware),
    );
    store
      .dispatch(userActions.fetchUserRequest('lucy'))
      .then(() => {
        expect(store.getState().lucy.error).to.be.equal(true);
        done();
      }).catch(done);
  });

  it('use shouldFetch to prevent fetch()', (done) => {
    let count = 0;
    const dataLoaderMiddleware = createDataLoaderMiddleware([userLoader], {
      api: {
        read: (username) => {
          count += 1;
          return findUserByUsername(username);
        },
      },
    });
    const store = createStore(
      reducer,
      applyMiddleware(dataLoaderMiddleware),
    );
    store
      .dispatch(userActions.fetchUserRequest('tom'))
      .then((result) => {
        expect(result).to.be.deep.equal({
          type: 'myapp/user/FETCH_USER/SUCCESS',
          payload: {
            username: 'tom',
            data: {
              age: 21,
              givenName: 'Tom',
              familyName: 'TomFamilyName',
            },
          },
        });
        return store.dispatch(userActions.fetchUserRequest('tom'));
      })
      .then((result) => {
        expect(result).to.be.equal(undefined);
        return store.dispatch(userActions.fetchUserRequest('tom'));
      })
      .then(() => {
        expect(count).to.be.equal(1);
        expect(store.getState()).to.be.deep.equal({
          tom: {
            age: 21,
            givenName: 'Tom',
            familyName: 'TomFamilyName',
          },
        });
        done();
      })
      .catch(done);
  });

  it('prevent duplicated call', () => {
  });
});
