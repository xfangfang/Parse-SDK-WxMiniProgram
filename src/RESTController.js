/**
 * Copyright (c) 2015-present, Parse, LLC.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 */
/* global XMLHttpRequest, XDomainRequest */
import CoreManager from './CoreManager';
import ParseError from './ParseError';

export type RequestOptions = {
  useMasterKey?: boolean;
  sessionToken?: string;
  installationId?: string;
  batchSize?: number;
  include?: any;
  progress?: any;
};

export type FullOptions = {
  success?: any;
  error?: any;
  useMasterKey?: boolean;
  sessionToken?: string;
  installationId?: string;
  progress?: any;
};

const RESTController = {
  ajax(method: string, url: string, data: any, headers?: any, options?: FullOptions) {

    let res, rej;
    const promise = new Promise((resolve, reject) => { res = resolve; rej = reject; });
    promise.resolve = res;
    promise.reject = rej;
    let attempts = 0;

    const dispatch = function() {

      headers = headers || {};
      if (typeof(headers['Content-Type']) !== 'string') {
        headers['Content-Type'] = 'text/plain'; // Avoid pre-flight
      }
      if (CoreManager.get('SERVER_AUTH_TYPE') && CoreManager.get('SERVER_AUTH_TOKEN')) {
        headers['Authorization'] = CoreManager.get('SERVER_AUTH_TYPE') + ' ' + CoreManager.get('SERVER_AUTH_TOKEN');
      }
      wx.request({
              url, data, method, headers,
              success: (res) => {
                // 请求成功并返回了json对象
                if(res.statusCode == 200 && typeof(res.data) === 'object'){
                    var response = res.data
                    promise.resolve({response,status:res.statusCode,res});
                }else if(res.statusCode >= 500 || res.statusCode === 0){
                    //重试
                    if (++attempts < CoreManager.get('REQUEST_ATTEMPT_LIMIT')) {
                      // Exponentially-growing random delay
                      const delay = Math.round(
                        Math.random() * 125 * Math.pow(2, attempts)
                      );
                      setTimeout(dispatch, delay);
                    }else if (res.statusCode === 0) {
                        promise.reject('Unable to connect to the Parse API');
                    }else{
                        try{
                            promise.reject(JSON.stringify(res));
                        }catch (e) {
                          promise.reject(res);
                        }
                    }
                }else{
                    try{
                        promise.reject(JSON.stringify(res));
                    }catch (e) {
                      promise.reject(res);
                    }
                }
              },
              fail: (res) => {
                // 请求失败
                try{
                    promise.reject(JSON.stringify(res));
                }catch (e) {
                  promise.reject(res);
                }

              },
              complete: (res) => {
                // 请求完成
              }
            });
    }
    dispatch();

    return promise;
  },

  request(method: string, path: string, data: mixed, options?: RequestOptions) {
    options = options || {};
    let url = CoreManager.get('SERVER_URL');
    if (url[url.length - 1] !== '/') {
      url += '/';
    }
    url += path;

    const payload = {};
    if (data && typeof data === 'object') {
      for (const k in data) {
        payload[k] = data[k];
      }
    }

    if (method !== 'POST') {
      payload._method = method;
      method = 'POST';
    }

    payload._ApplicationId = CoreManager.get('APPLICATION_ID');
    const jsKey = CoreManager.get('JAVASCRIPT_KEY');
    if (jsKey) {
      payload._JavaScriptKey = jsKey;
    }
    payload._ClientVersion = CoreManager.get('VERSION');

    let useMasterKey = options.useMasterKey;
    if (typeof useMasterKey === 'undefined') {
      useMasterKey = CoreManager.get('USE_MASTER_KEY');
    }
    if (useMasterKey) {
      if (CoreManager.get('MASTER_KEY')) {
        delete payload._JavaScriptKey;
        payload._MasterKey = CoreManager.get('MASTER_KEY');
      } else {
        throw new Error('Cannot use the Master Key, it has not been provided.');
      }
    }

    if (CoreManager.get('FORCE_REVOCABLE_SESSION')) {
      payload._RevocableSession = '1';
    }

    const installationId = options.installationId;
    let installationIdPromise;
    if (installationId && typeof installationId === 'string') {
      installationIdPromise = Promise.resolve(installationId);
    } else {
      const installationController = CoreManager.getInstallationController();
      installationIdPromise = installationController.currentInstallationId();
    }

    return installationIdPromise.then((iid) => {
      payload._InstallationId = iid;
      const userController = CoreManager.getUserController();
      if (options && typeof options.sessionToken === 'string') {
        return Promise.resolve(options.sessionToken);
      } else if (userController) {
        return userController.currentUserAsync().then((user) => {
          if (user) {
            return Promise.resolve(user.getSessionToken());
          }
          return Promise.resolve(null);
        });
      }
      return Promise.resolve(null);
    }).then((token) => {
      if (token) {
        payload._SessionToken = token;
      }

      const payloadString = JSON.stringify(payload);
      return RESTController.ajax(method, url, payloadString, {}, options).then(({ response }) => {
        return response;
      });
    }).catch(function(response: { responseText: string }) {
      // Transform the error into an instance of ParseError by trying to parse
      // the error string as JSON
      let error;
      if (response && response.responseText) {
        try {
          const errorJSON = JSON.parse(response.responseText);
          error = new ParseError(errorJSON.code, errorJSON.error);
        } catch (e) {
          // If we fail to parse the error text, that's okay.
          error = new ParseError(
            ParseError.INVALID_JSON,
            'Received an error with invalid JSON from Parse: ' +
              response.responseText
          );
        }
      } else {
        error = new ParseError(
          ParseError.CONNECTION_FAILED,
          'XMLHttpRequest failed: ' + JSON.stringify(response)
        );
      }

      return Promise.reject(error);
    });
  },
}

module.exports = RESTController;
