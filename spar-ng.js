/*
 * spar-ng v0.0.1
 */
'use strict';
angular.module('spar-ng', []).
    provider('sparFactory', function () {

        // when forwarding events, prefix the event name
        var defaultPrefix = 'spar:',
            ioSocket;
        // Define our interceptors (functions that will be called on recieved messages)
        var interceptorFactories = this.interceptors = [];
        // expose to provider
        this.$get = function ($q, $rootScope, $http, $injector, $timeout) {
            /**
             * Interceptors stored in reverse order. Inner interceptors before outer interceptors.
             * The reversal is needed so that we can build up the interception chain around the
             * server request.
             */
            var reversedInterceptors = [];
            angular.forEach(interceptorFactories, function (interceptorFactory) {
                reversedInterceptors.unshift(angular.isString(interceptorFactory) ? $injector.get(interceptorFactory) : $injector.invoke(interceptorFactory));
            });
            var asyncAngularify = function (socket, callback) {
                return callback ? function () {
                    var args = arguments;
                    $timeout(function () {
                        callback.apply(socket, args);
                    }, 0);
                } : angular.noop;
            };

            return function socketFactory(options) {
                options = options || {};
                var socket = options.ioSocket || io.connect();
                var prefix = options.prefix || defaultPrefix;
                var defaultScope = options.scope || $rootScope;


                /**
                 * Performs a request on the socket.
                 *
                 * @param requestConfig The config for the request
                 *
                 * @return A promise object.
                 */
                function socketRequest(requestConfig) {
                    var config = {};
                    angular.extend(config, requestConfig);
                    /**
                     * Makes the request.
                     *
                     * @param config The config with which to make the request
                     *
                     * @return A promise object.
                     */
                    var makeRequest = function (config) {
                        var deferred = $q.defer();
                        var requestCallback = function (result) {
                            $rootScope.$apply(function () {
                                if (result.errors || (result.status && result.status !== 200)) {
                                    return deferred.reject(result);
                                }
                                return deferred.resolve(result);
                            });
                        };
                        if (config.method === "get") {
                            socket.get(config.url, config.data, requestCallback);
                        } else if (config.method === "post") {
                            socket.post(config.url, config.data, requestCallback);
                        } else if (config.method === "put") {
                            socket.put(config.url, config.data, requestCallback);
                        } else if (config.method === "delete") {
                            socket.delete(config.url, config.data, requestCallback);
                        }
                        return deferred.promise;
                    };
                    var chain = [makeRequest, undefined];
                    var promise = $q.when(config);
                    // apply interceptors
                    angular.forEach(reversedInterceptors, function (interceptor) {
                        if (interceptor.request || interceptor.requestError) {
                            chain.unshift(interceptor.request, interceptor.requestError);
                        }
                        if (interceptor.response || interceptor.responseError) {
                            chain.push(interceptor.response, interceptor.responseError);
                        }
                    });
                    while (chain.length) {
                        var thenFn = chain.shift();
                        var rejectFn = chain.shift();
                        promise = promise.then(thenFn, rejectFn);
                    }
                    promise.success = function (fn) {
                        promise.then(function (response) {
                            fn(response);
                        });
                        return promise;
                    };
                    promise.error = function (fn) {
                        promise.then(null, function (response) {
                            fn(response.errors, response.status);
                        });
                        return promise;
                    };
                    return promise;
                }

                var wrappedSocket = {
                    /**
                     * Drop in replacement for the $http.get method
                     *
                     * @param url The URL to make the GET request to.
                     * @param config Optional configuration object
                     *
                     * @return A promise object with success and error callbacks
                     */
                    get: function (url, config) {
                        if (!socket.socket.connected && !socket.socket.connecting) {
                            return $http.get(url, config);
                        }
                        var data = {};
                        if (!config) {
                            config = {};
                        }
                        config.url = url;
                        if (config.params) {
                            data = config.params;
                        }
                        config.data = data;
                        config.method = "get";
                        return socketRequest(config);
                    },
                    /**
                     * Drop in replacement for the $http.post method
                     *
                     * @param url The URL to make the POST request to.
                     * @param data The data to post
                     * @param config Optional configuration object
                     *
                     * @return A promise object with success and error callbacks
                     */
                    post: function (url, data, config) {
                        if (!socket.socket.connected && !socket.socket.connecting) {
                            return $http.post(url, data, config);
                        }
                        if (!config) {
                            config = {};
                        }
                        config.url = url;
                        config.data = data;
                        config.method = "post";
                        return socketRequest(config);
                    },
                    /**
                     * Drop in replacement for the $http.put method
                     *
                     * @param url The URL to make the PUT request to.
                     * @param data The data to put
                     * @param config Optional configuration object
                     *
                     * @return A promise object with success and error callbacks
                     */
                    put: function (url, data, config) {
                        if (!socket.socket.connected && !socket.socket.connecting) {
                            return $http.put(url, data, config);
                        }
                        if (!config) {
                            config = {};
                        }
                        config.url = url;
                        config.data = data;
                        config.method = "put";
                        return socketRequest(config);
                    },
                    /**
                     * Drop in replacement for the $http.delete method
                     *
                     * @param url The URL to make the DELETE request to.
                     * @param config Optional configuration object
                     *
                     * @return A promise object with success and error callbacks
                     */
                    "delete": function (url, config) {
                        if (!socket.socket.connected && !socket.socket.connecting) {
                            return $http.delete(url, config);
                        }
                        var data = {}
                        if (!config) {
                            config = {};
                        }
                        if (config.params) {
                            data = config.params;
                        }
                        config.url = url;
                        config.data = data;
                        config.method = "delete";
                        return socketRequest(config);
                    },
                    /**
                     * Listens for messages on the socket and calls the callback provided with the message.
                     *
                     * @param model The model that the message listener is for.
                     * @param id The id of the object the message listener is for.
                     * @param cb The callback for when the websocket recieves a message.
                     *
                     * @return A deregister function to be called to remove the listener.
                     */
                    on: function (model, id, cb) {

                        if (typeof id === 'function') {
                            cb = id;
                            id = null;
                        }
                        var generateCallback = function(cb, id){
                            var _id = id;
                            var _cb = cb;

                            return function(message) {
                                if (_id && message.id !== _id) {
                                    return;
                                }
                                else{
                                    _cb(message)
                                }
                            };

                        }


                        var model_selector = model
                        //add listener

                        var listener = asyncAngularify(socket, generateCallback(cb,id))
                        socket.on(model_selector.toLowerCase(),listener );
                        return function () {
                            socket.removeListener(model_selector.toLowerCase(), listener);
                        };
                    },

                    /**
                     * Listens for messages on the socket and calls the callback provided with the message.
                     *
                     * @param model The model that the message listener is for.
                     * @param id The id of the object the message listener is for.
                     * @param cb The callback for when the websocket recieves a message.
                     *
                     * @return A deregister function to be called to remove the listener.
                     */
                    forward: function (model,id, scope) {
                        if (typeof scope == 'undefined') {
                            scope = id;
                            id = null;
                        }
                        if (!scope) {
                            scope = defaultScope;
                        }





                        var generateBroadcast = function(model, id, scope){
                            var model_selector = model+ (id ? ":"+id : "");
                            var prefixedEvent = prefix + model_selector;
                            var _id = id;
                            var _scope = scope;
                            return function(message) {

                                if(_id && message.id !== _id) {
                                    return;
                                }
                                else{
                                    _scope.$broadcast(prefixedEvent, message);
                                }
                            };
                        }
                        var forwardBroadcast = asyncAngularify(socket, generateBroadcast(model,id,scope));
                        scope.$on('$destroy', function () {
                            socket.removeListener(model.toLowerCase(), forwardBroadcast);
                        });
                        socket.on(model.toLowerCase(), forwardBroadcast);
                    }
                };
                return wrappedSocket;
            };
        };
    });