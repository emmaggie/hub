/**
 * Created with JetBrains WebStorm.
 * User: gnewcomb
 * Date: 3/1/13
 * Time: 8:55 AM
 * To change this template use File | Settings | File Templates.
 */

// REPL MAGIC:  var dhh = require('/users/gnewcomb/hub/src/test/qatests/DH_test_helpers/DHtesthelpers.js');

"use strict";

var chai = require('chai'),
    expect = chai.expect,
    superagent = require('superagent'),
    crypto = require('crypto'),
    async = require('async'),
    http = require('http'),
    url = require('url'),
    ws = require('ws'),
    lodash = require('lodash');

var ranU = require('../randomUtils.js'),
    gu = require('../genericUtils.js');

var DOMAIN = process.env.hubDomain || 'hub.svc.dev';
exports.DOMAIN = DOMAIN;

var CP_DOMAIN = '10.11.15.162:8080';    // Crypto Proxy
exports.CP_DOMAIN = CP_DOMAIN;

var URL_ROOT = 'http://'+ DOMAIN;
exports.URL_ROOT = URL_ROOT;

var DEFAULT_TTL = 10368000000;
exports.DEFAULT_TTL = DEFAULT_TTL;

var FAKE_CHANNEL_URI = [URL_ROOT, 'channel', 'aslKewkfnjkzIKENVYGWHJEFlijf823JBFD2'].join('/');
exports.FAKE_CHANNEL_URI = FAKE_CHANNEL_URI;

var DEBUG = false;


var getRandomPayload = function() {
    return ranU.randomString(10 + ranU.randomNum(40));
}
exports.getRandomPayload = getRandomPayload;

// Returns true if data found at dataUri matches expectedData, else false.
var confirmExpectedData = function (dataUri, expectedData, callback) {
    var actualData = '';

    http.get(dataUri, function(res) {
        res.on('data', function (chunk) {
            actualData += chunk;
        }).on('end', function(){
                if (actualData != expectedData) {
                    gu.debugLog('Unexpected data found at '+ dataUri +': '+ actualData);
                }

                callback(true);
            });
    }).on('error', function(e) {
            gu.debugLog("Got error: " + e.message);
            callback(false);
        });
};
exports.confirmExpectedData = confirmExpectedData;

/**
 * Given a data uri, calls back with the checksum (or null if an error has occured).
 * @param dataUri
 * @param callback: checksum || null (on error)
 */
var getValidationChecksum = function (dataUri, callback)
{
    var md5sum = crypto.createHash('md5'),
        actChecksum;

    http.get(dataUri, function(res) {
        res.on('data', function (chunk) {
            md5sum.update(chunk);
        }).on('end', function(){
                actChecksum = md5sum.digest('hex');
                callback(actChecksum);
            });
    }).on('error', function(e) {
            console.log("Got error: " + e.message);
            callback(null);
        });

};
exports.getValidationChecksum = getValidationChecksum;

// Given a websocket URI, this will instantiate a websocket on that channel
var createWebSocket = function(wsUri, onOpen) {
    var myWs,
        VERBOSE = true;

    gu.debugLog('Trying uri: '+ wsUri, VERBOSE);

    myWs = new ws(wsUri);

    myWs.on('open', onOpen);

    return myWs;
}
exports.createWebSocket = createWebSocket;


/**
 * Wrapper for websocket to support test scenarios
 *
 * @param params: .domain (domain:port),
 *  .channel (name of channel in DH),
 *  .socketName (arbitrary name for identifying the socket),
 *  .onOpenCB (callback to call at end of Open event),
 *  .responseQueue (where each message is stashed),
 *  .onMessageCB (optional - callback to call at end of Message event),
 *  .onErrorCB (optional - callback to call at end of Error event),
 *  .doReconnect=false (optional: if true, will reconnect on close if due to timeout),
 *  .debug (optional).
 * @constructor
 */
function WSWrapper(params) {
    var requiredParams = ['uri', 'socketName', 'onOpenCB'];     // removed 'domain'

    lodash.forEach(requiredParams, function(p) {
        if (!params.hasOwnProperty(p)) {
            gu.debugLog('\nERROR in altWSWrapper(). Missing required param: '+ p);
        }
    })

    this.name = params.socketName;
    this.responseQueue = [];
    this.ws = null;
    this.uri = params.uri;
    //this.domain = params.domain;
    var _self = this,
        onOpenCB = params.onOpenCB,
        onMessageCB = params.onMessageCB || null,
        onErrorCB = params.onErrorCB || null,
        doReconnect = (undefined !== params.doReconnect) ? params.doReconnect : false,
        VERBOSE = (undefined !== params.debug) ? params.debug : DEBUG;

    this.onOpen = function() {
        gu.debugLog('OPEN EVENT at '+ Date.now());
        gu.debugLog('readystate: '+ _self.ws.readyState, VERBOSE);
        onOpenCB();
    };

    this.onMessage = function(data, flags) {
        gu.debugLog('MESSAGE EVENT at '+ Date.now(), VERBOSE);
        gu.debugLog('Readystate is '+ _self.ws.readyState, false);
        _self.responseQueue.push(data);

        if (null != onMessageCB) {
            onMessageCB();
        }
    };

    this.onError = function(msg) {
        gu.debugLog('ERROR event at '+ Date.now());
        gu.debugLog('Error message: '+ msg);
        gu.debugLog('object dump: ');
        console.dir(this);
        console.dir(this.ws);

        if (null != onErrorCB) {
            onErrorCB(msg);
        }
    };

    this.onClose = function(code, msg) {
        gu.debugLog('CLOSE event (code: '+ code +', msg: '+ msg +')\n at '+ Date.now());
        if ((doReconnect) && (msg.toLowerCase().lastIndexOf('idle') > -1)) {
            gu.debugLog('...attempting reconnect after idle timeout.');
            _self.createSocket();
        }
    }

    this.createSocket = function() {
        if (VERBOSE) {
            console.dir(this);
        }
        this.ws = createWebSocket(this.uri, this.onOpen);
        this.ws.on('message', this.onMessage);
        this.ws.on('error', this.onError);
        this.ws.on('close', this.onClose);
    };
}
exports.WSWrapper = WSWrapper;

/**
 * Create a channel.
 *
 * @param params: .name,
 *  .ttlMillis=null,
 *  .domain=DOMAIN,
 *  .description=null,
 *  .debug (optional)
 * @param myCallback: response || error, channelUri || null (if error)
 */
var createChannel = function(params, myCallback) {
    var cnName = params.name,
        payload = {name: cnName},
        domain = params.domain || DOMAIN,
        uri = ['http:/', domain, 'channel'].join('/'),
        VERBOSE = (undefined !== params.debug) ? params.debug : true;

    if (params.hasOwnProperty('ttlMillis')) {
        payload['ttlMillis'] = params.ttlMillis;
    }

    if (params.hasOwnProperty('ttlDays')) {
        payload['ttlDays'] = params.ttlDays;
    }

    if (params.hasOwnProperty('description')) {
        payload['description'] = params.description;
    }

    if (VERBOSE) {
        gu.debugLog('createChannel.uri: '+ uri);
        gu.debugLog('createChannel.payload: ');
        console.dir(payload);
        gu.debugLog('dump of params: ');
        console.dir(params);
    }

    superagent.agent().post(uri)
        .set('Content-Type', 'application/json')
        .send(payload)
        .end(function(err, res) {
            if (gu.isHTTPError(res.status)) {
                myCallback(res, null);
            }
            else {
                var cnMetadata = new channelMetadata(res.body),
                    location = cnMetadata.getChannelUri();
                gu.debugLog('Created channel named: '+ cnName)
                myCallback(res, location);
            }
        }).on('error', function(e) {
            gu.debugLog('...in makeChannel.post.error()');
            myCallback(e, null);
        });
};
exports.createChannel = createChannel;

/**
 * Create random channel name using only 0-9a-zA-Z (note that underscore is allowed in channel name but not provided here)
 *
 * @param length: optional, defaults to 5 + (1-25)
 * @return the name
 */
var getRandomChannelName = function(length) {
    var cnLength = (undefined === length) ? (5 + ranU.randomNum(26)) : length;

    return 'test'+ ranU.randomString(cnLength, ranU.limitedRandomChar);
}
exports.getRandomChannelName = getRandomChannelName;


var getRandomChannelDescription = function(length) {
    var descLength = ('undefined' == typeof length) ? (50 + ranU.randomNum(50)): length;

    if (descLength > 1000) {
        descLength = 1000;
    }

    return 'test _ '+ ranU.randomString(descLength, ranU.simulatedTextChar);
}
exports.getRandomChannelDescription = getRandomChannelDescription;


//     Current metadata structure for GET on a channel:
function channelMetadata(responseBody) {
    this.getChannelUri = function() {
        return responseBody._links.self.href;
    }

    this.getLatestUri = function() {
        return responseBody._links.latest.href;
    }

    this.getWebSocketUri = function() {
        return responseBody._links.ws.href;
    }

    this.getName = function() {
        return responseBody.name;
    }

    this.getTTL = function() {
        return responseBody.ttlDays;
    }

    this.getCreationDate = function() {
        return responseBody.creationDate;
    }

    this.getDescription = function() {
        return responseBody.hasOwnProperty('description') ? responseBody.description : null;
    }


    // No longer given.
    /*
    this.getLastUpdateDate = function() {
        return responseBody.lastUpdateDate;
    }
    */

}
exports.channelMetadata = channelMetadata;

/**
 * GET a channel
 *
 * @param params: .name || .uri,
 *  .domain=DOMAIN
 * @param myCallback: response, body
 */
var getChannel = function(params, myCallback) {
    var uri,
        myChannelName = params.name || null,
        channelUri = params.uri || null,
        domain = params.domain || DOMAIN;

    if (null != myChannelName) {
        uri = ['http:/', domain, 'channel', myChannelName].join('/');
    }
    else if (null != channelUri) {
        uri = channelUri;
    }
    else {
        gu.debugLog('Missing required parameter in getChannel()');
    }

    gu.debugLog('\nURI for getChannel(): '+ uri);

    superagent.agent().get(uri)
        .end(function(err, res) {
            if (err) {
                throw err
            };

            gu.debugLog('Res.body: ');
            console.dir(res.body);

            myCallback(res, res.body);
        });
};
exports.getChannel = getChannel;


/**
 * Basic health check.
 * @param params: .domain=DOMAIN
 * @param myCallback: Returns the get response or throws an error.
 */
var getHealth = function(params, myCallback) {
    var domain = params.domain || DOMAIN,
        uri = ['http:/', domain, 'health'].join('/');

    superagent.agent().get(uri)
        .end(function(err,res) {
            if (err) {throw err};
            myCallback(res);
        });
};
exports.getHealth = getHealth;


function packetMetadata(responseBody) {

    this.getChannelUri = function() {
        return responseBody._links.channel.href;
    } ;

    this.getPacketUri = function() {
        return responseBody._links.self.href;
    };

    this.getTimestamp = function() {
        return responseBody.timestamp;
    } ;
}
exports.packetMetadata = packetMetadata;

// Headers in a response to GET on a packet of data
function packetGETHeader(responseHeader){

    // returns null if no 'previous' header found
    this.getNext = function() {
        //console.log("Called getNext() with responseHeader: ");
        //console.dir(responseHeader);

        if (responseHeader.hasOwnProperty("link")) {
            var m = /<([^<]+)>;rel=\"next\"/.exec(responseHeader["link"]);
            return (null == m) ? null : m[1];
        }
        else {
            return null;
        }
    }

    // returns null if no 'previous' header found
    this.getPrevious = function() {
        //console.log("Called getPrevious() with responseHeader: ");
        //console.dir(responseHeader);

        if (responseHeader.hasOwnProperty("link")) {
            var m = /<([^<]+)>;rel=\"previous\"/.exec(responseHeader["link"]);
            return (null == m) ? null : m[1];
        }
        else {
            return null;
        }
    }
}
exports.packetGETHeader = packetGETHeader;

// Headers in response to POSTing a packet of data
function packetPOSTHeader(responseHeader){
    this.getLocation = function() {
        return (responseHeader.hasOwnProperty('location')) ? responseHeader.location : null;
    };
}
exports.packetPOSTHeader = packetPOSTHeader;

/**
 * Inserts data into channel.
 *
 * @param params: .channelUri, .data, .headers=(optional), if provided, then will be set on the superagent request,
 *  .debug=true, .ignoreDataUri=false (if true, then don't try to parse response for the dataUri -- this is used to
 *   allow this call to work for group callbacks, where the response body is simply 'OK)
 * @param myCallback: response, uri to data
 */
var postData = function(params, myCallback) {
    var dataUri = null,
        channelUri = params.channelUri,
        myData = params.data,
        headers = ('undefined' != typeof params.headers) ? params.headers : null,
        ignoreDataUri = ('undefined' != typeof params.ignoreDataUri) ? params.ignoreDataUri : false,
        VERBOSE = ('undefined' != typeof params.debug) ? params.debug : false;

    // Temporarily defaulting Accept-Encoding to */* because any POST through the crypto proxy will fail unless
    //      this is set.
    if (null == headers) {
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept-Encoding': '*/*'
        }
    }

    gu.debugLog('Channel Uri: '+ channelUri, VERBOSE);
    gu.debugLog('Data: '+ myData, VERBOSE);

    if (VERBOSE) {
        gu.debugLog('Headers: ');
        console.dir(headers);
    }

    superagent.agent().post(channelUri)
        .set(headers)
        .send(myData)
        .end(function(err, res) {
            if (err) {
                throw err;
            }

            if (!gu.isHTTPSuccess(res.status)) {
                gu.debugLog('POST of data did not return success: '+ res.status, VERBOSE);
                gu.debugLog('Response:');
                console.dir(res.text);
                dataUri = null;
            }
            else {
                gu.debugLog('POST of data succeeded.', VERBOSE);

                if (ignoreDataUri) {
                    dataUri = null;
                } else {
                    var pMetadata = new packetMetadata(res.body);
                    dataUri = pMetadata.getPacketUri();
                }
            }

            myCallback(res, dataUri);
        });
};
exports.postData = postData;

// Calls back with data
var getLatestDataFromChannel = function(channelUri, callback) {

    gu.debugLog('Channel uri in getLatestDataFromChannel: '+ channelUri);

    getLatestUri(channelUri, function(uri) {

        getDataFromChannel({uri: uri}, function(err, res, data) {
            var result = (null != err) ? err : data;

            callback(result);
        })
    });
};
exports.getLatestDataFromChannel = getLatestDataFromChannel;

/**
 * Git yo data from the channel.
 *
 * @param params: .uri (to the data), .debug (optional), .headers object (optional) - for usage, see docs on http.request
 * @param callback: error || null, response (note this is not the same as SuperAgent's response; check .statusCode for status), data
 */
var getDataFromChannel = function(params, callback) {

    var myData = '',
        dataUri = params.uri,
//        accepts = params.accepts || null,
        headers = params.headers || null,
        VERBOSE = (undefined !== params.debug) ? params.debug : false;

    gu.debugLog('DataUri in getDataFromChannel(): '+ dataUri);

    var options = url.parse(dataUri);

    if (null != headers) {
        options['headers'] = headers;
    }

    if (VERBOSE) {
        gu.debugLog('\nDump of options object for request: ');
        console.dir(options);
    }

    var req = http.request(options, function(res) {
        res.on('data', function (chunk) {
            myData += chunk;
        }).on('end', function(){
                gu.debugLog('Success. At end of data.', VERBOSE);

            callback(null, res, myData);
            });
    }).on('error', function(e) {
            gu.debugLog('Error in response');

            callback(e, null, null);
        });

    req.on('error', function(e) {
        gu.debugLog('Error in request');

        callback(e, null, null);
    });

    req.end();
}
exports.getDataFromChannel = getDataFromChannel;

/**
 * Gets list of all uris and their data in a channel from the passed-in 'start' uri and any more recent.
 *
 * @param params: .startUri, .debug (optional)
 * @param callback: err, array = [{uri: , data: }, {uri: , data: }, etc.]. Array is ordered starting with oldest data
 *          and ending with most recent.
 */
var getUrisAndDataSinceLocation = function(params, callback) {
    var startUri = params.startUri,
        dataList = [],
        VERBOSE = (undefined !== params.debug) ? params.debug : false;

    // First Uri, get data, stash both
    getDataFromChannel({uri: startUri}, function(err, getRes, data) {
        if (err) {
            callback(err, null);
        }
        dataList.push({'uri': startUri, 'data': data});
        gu.debugLog('Added new entry.\n'+ startUri +'\n(data): '+ data, VERBOSE);

        var next = null;

        async.doWhilst(
            function(cb) {
                var uri = dataList[dataList.length - 1].uri;    // most recent item in dataList

                superagent.agent().get(uri)
                    .end(function(err, res) {
                        if (err) {
                            gu.debugLog('Error GETting url '+ uri);
                            callback(err, null);
                        }

                        var pGetHeader = new packetGETHeader(res.headers) ;
                        next = pGetHeader.getNext();

                        if (null != next) {
                            getDataFromChannel({uri: next}, function(getErr, getRes, getData) {
                                if (getErr) {
                                    cb(getErr);
                                }

                                dataList.push({'uri': next, 'data': getData});
                                gu.debugLog('Added new entry.\n'+ next +'\n(data): '+ getData, VERBOSE);

                                cb();
                            })
                        }
                        else {
                            gu.debugLog('No more next headers!', VERBOSE);
                            cb();
                        }
                    });
            },
            function() {
                return (null != next);
            },
            function(err) {
                if (err) {
                    callback(err, null);
                }
                else {
                    callback(null, dataList);
                }
            }
        )
    })
}
exports.getUrisAndDataSinceLocation = getUrisAndDataSinceLocation;

/**
 * For some or all items in a channel, tests the accuracy of the next/previous headers as well as the /latest link
 * given by the channel metadata.
 *
 * @param params: .channelUri,
 *  .numItems [optional, number of items back from latest to include (same param as in getListOfLatestUrisFromChannel())
 *  defaults to Inifinity],
 *  .debug (optional).
 * @param callback: err || null
 */
var testRelativeLinkInformation = function(params, callback) {

    // handle params
    var allUris = [],
        numItems = params.numItems || Infinity,
        channelUri = params.channelUri,
        VERBOSE = (undefined !== params.debug) ? params.debug : true,
        listPayload = {
            channelUri: channelUri,
            numItems: numItems,
            debug: VERBOSE
        };

    getListOfLatestUrisFromChannel(listPayload, function(theUris, gotEntireChannel) {

        var testUri = function(index, callback) {

            var uri = theUris[index],
                expPrevious = (0 == index) ? null : theUris[index - 1],
                expNext = (index < (theUris.length -1)) ? theUris[index + 1] : null,
                err = null;

            superagent.agent().get(uri)
                .end(function(err, res) {
                    var pGetHeader = new packetGETHeader(res.headers),
                        previous = pGetHeader.getPrevious(),
                        next = pGetHeader.getNext();

                    if (expPrevious != previous) {
                        if (0 == index && !gotEntireChannel) {
                            gu.debugLog('Ignoring results for previous since expected previous link is unknown.', VERBOSE);
                        } else {
                            err = 'Previous link mismatch for uri '+ uri +'.\nExpected '+ expPrevious +'.\nGot '+ previous;
                        }

                    } else {
                        gu.debugLog('Matched previous link for uri '+ uri, VERBOSE);
                    }

                    if (expNext != next) {
                        if (null == err) {
                            err = '';
                        }
                        err += 'Next link mismatch.\nExpected '+ expNext +'.\nGot '+ next;
                    } else {
                        gu.debugLog('Matched next link for uri '+ uri, VERBOSE);
                    }

                    callback(err, uri);
                });
        }

        // Test next/prev for each uri
        async.timesSeries(theUris.length, function(n, next){
            testUri(n, function(err, uri) {
                next(err, uri);
            })
        }, function(err, testedUris) {

            if (null != err) {
                // pass that err along -- null if all went well
                callback(err);
            }
            else {
                gu.debugLog('Matched all next/prev links for '+ testedUris.length +' uris.', VERBOSE);

                getLatestUri(channelUri, function(latest, err) {
                    var expLatest = theUris[theUris.length - 1],
                        finalError = null;

                    if (latest != expLatest) {
                        finalError = 'Latest link mismatch.\nExpected '+ expLatest +'.\nGot '+ latest;

                        callback(finalError);
                    } else {
                        gu.debugLog('Latest link matched!', VERBOSE);

                        callback(null);
                    }
                })
            }
        });
    })
}
exports.testRelativeLinkInformation = testRelativeLinkInformation;

/**
 * Returns the last <numItems> of URIs in the channel as an array, going from older (index 0) to latest, as well as
 *  a flag stating whether or not all URIs in the channel were included (i.e., .numItems >= number of items in channel).
 * @param params: .numItems=2 (minimum 2; number of URIs to return, starting with the latest), .channelUri,
 *  .debug (optional)
 * @param myCallback: list of URIs as described, gotEntireChannel
 */
var getListOfLatestUrisFromChannel = function(params, myCallback){
    var allUris = [],
        numItems = params.numItems,
        channelUri = params.channelUri,
        gotEntireChannel = false,      // will be set to true if a previous link is not found
        VERBOSE = (undefined !== params.debug) ? params.debug : false;

    if (numItems < 2) {
        numItems = 2;
    }

    gu.debugLog('In getListofLatestUrisFromChannel...', VERBOSE);
    gu.debugLog('number of items requested: '+ numItems, VERBOSE);
    gu.debugLog('channel URI: '+ channelUri, VERBOSE);

    getLatestUri(channelUri, function(latest){
        var previous = null;

        allUris.unshift(latest);

        async.doWhilst(
            function (callback) {
               superagent.agent().get(allUris[0])
                    .end(function(err, res) {
                        var pGetHeader = new packetGETHeader(res.headers) ;
                        previous = pGetHeader.getPrevious();

                        if (null != previous) {
                            allUris.unshift(previous);
                        }
                        callback();
                    });
            },
            function() {
                return (allUris.length < numItems) && (null != previous);
            }
            , function(err) {
                gotEntireChannel = (null == previous);
                gu.debugLog('Did we get the entire channel? '+ gotEntireChannel, VERBOSE);

                myCallback(allUris, gotEntireChannel);
            }
        );
    });
};
exports.getListOfLatestUrisFromChannel = getListOfLatestUrisFromChannel;

/**
 * Get latest URI for channel
 * @param channelUri
 * @param callback: URI to latest data post, null || error text
 */
var getLatestUri = function(channelUri, callback) {


    getChannel({'uri': channelUri}, function(getCnRes, getCnBody) {
        if (getCnRes.status != gu.HTTPresponses.OK) {

            callback(null, 'getChannel() failed in getLatestUri: '+ getCnRes.status)
        }
        else {
            var cnMetadata = new channelMetadata(getCnBody),
                latestUri = cnMetadata.getLatestUri();

            gu.debugLog('latestUri in getLatestUri(): '+ latestUri);

            superagent.agent().head(latestUri)
                .redirects(0)
                .end(function(headErr, headRes) {
                    if (headErr) {
                        callback(null, headErr.message);
                    }
                    else {
                        if (headRes.status != gu.HTTPresponses.See_Other) {
                            callback(null, headRes.status);
                        }
                        else {
                            callback(headRes.headers.location, null);
                        }
                    }
                })
        }
    })

}
exports.getLatestUri = getLatestUri;

/**
 * Lists all channels.
 *
 * @param params: .domain,
 *  .debug (optional)
 * @param callback: response, array of channels
 */
var getAllChannels = function(params, callback) {
    var domain = params.domain || DOMAIN,
        uri = ['http:/', domain, 'channel'].join('/'),
        VERBOSE = (undefined !== params.debug) ? params.debug : false;

    gu.debugLog('uri for getAllChannels: '+ uri, VERBOSE);

    superagent.agent().get(uri)
        .end(function(err,res) {
            if (err) {
                throw err
            };

            var channels = ('undefined' == typeof res.body._links) ? null : res.body._links.channels;

            callback(res, channels);
        });
}
exports.getAllChannels = getAllChannels;

/**
 * Update a channel via PATCH. Currently, code only supports changing .ttlMillis property but this function will
 *  pass along the .name property if given for testing.
 *
 * @param params: .channelUri, .name (optional), .ttlMillis (optional), .description (optional), .debug (optional).
 * @param callback: response
 */
var patchChannel = function(params, callback) {
    var payload = {},
        uri = params.channelUri,
        VERBOSE = (undefined !== params.debug) ? params.debug : true;

    if (typeof params.name != 'undefined') {
        payload['name'] = params.name;
    }
    if (typeof params.ttlMillis != 'undefined') {
        payload['ttlMillis'] = params.ttlMillis;
    }

    if (typeof params.description != 'undefined') {
        payload['description'] = params.description;
    }

    if (VERBOSE) {
        gu.debugLog('PATCH channel URI: '+ uri);
        gu.debugLog('Payload dump: ');
        console.dir(payload);
    }

    superagent.agent().patch(uri)
        .send(payload)
        .end(function(err, res) {
            if (!gu.isHTTPSuccess(res.status)) {
                gu.debugLog('PATCH channel did not return success: '+ res.status);
            }
            else {
                gu.debugLog('PATCH channel succeeded.', VERBOSE);
            }

            callback(res);
        });
}
exports.patchChannel = patchChannel;

/**
 * Update a replication config on .target hub, replicating from .source hub.
 *
 * @param params: .source, .target, .historicalDays (optional), .excludeExcept (optional), .includeExcept (optional),
 *  .debug=true (optional).
*  @param callback: response, body
 */
var updateReplicationConfig = function(params, callback) {
    var payload = {},
        source = params.source,
        target = params.target,
        uri = ['http:/', target, 'replication', source].join('/'),
        VERBOSE = (undefined !== params.debug) ? params.debug : true;

    if ('undefined' != typeof params.historicalDays) {
        payload['historicalDays'] = params.historicalDays;
    }

    if ('undefined' != typeof params.excludeExcept) {
        payload['excludeExcept'] = params.excludeExcept;
    }

    if ('undefined' != typeof params.includeExcept) {
        payload['includeExcept'] = params.includeExcept;
    }

    if (VERBOSE) {
        gu.debugLog('update Replication URI: '+ uri);
        gu.debugLog('Payload dump: ');
        console.dir(payload);
    }

    superagent.agent().patch(uri)
        .send(payload)
        .end(function(err, res) {
            if (!gu.isHTTPSuccess(res.status)) {
                gu.debugLog('Update replication config did not return success: '+ res.status);
            }
            else {
                gu.debugLog('Update replication config succeeded.', VERBOSE);
            }

            callback(res, res.body);
        });
}
exports.updateReplicationConfig = updateReplicationConfig;


/** Get the replication config
 *
 * @param .target (hub), .source (hub) (OPTIONAL), .debug=true (OPTIONAL)
 * @param callback: response, body
 */
var getReplicationConfig = function(params, callback) {
    var target = params.target,
        uri = ['http:/', target, 'replication'].join('/'),
        VERBOSE = (undefined !== params.debug) ? params.debug : true;

    if ('undefined' != typeof params.source) {
        uri += '/'+ params.source;
    }

    if (VERBOSE) {
        gu.debugLog('Get Replication config URI: '+ uri);
    }

    superagent.agent().get(uri)
        .end(function(err,res) {
            if (err) {
                throw err
            };

            callback(res, res.body);
        });
}
exports.getReplicationConfig = getReplicationConfig;


/**
 * Calls the TTL reaper and waits for a response -- the reaper will not return errors (current plan, anyway).
 * @param params: .domain=dhh.DOMAIN, .debug=false
 * @param callback: response (200/OK or 409/Conflict if reaper was already running are the expected responses) or null
 *  if an error was thrown
 */
var executeTTLCleanup = function(params, callback) {
    var domain = params.domain || DOMAIN,
        uri = ['http:/', domain, 'sweep'].join('/'),
        VERBOSE = (undefined !== params.debug) ? params.debug : true;

    gu.debugLog('/sweep uri: '+ uri, VERBOSE);

    superagent.agent().post(uri)
        .send({})
        .end(function(err, res) {

            gu.debugLog('Sweep result: '+ res.status, VERBOSE);

            if (err) {
                gu.debugLog('Error in /sweep attempt: '+ err.message);
                callback(null);
            }
            else {
                if (!lodash.contains([gu.HTTPresponses.OK, gu.HTTPresponses.Conflict], res.status)) {
                    gu.debugLog('Unexpected status on /sweep attempt: '+ res.status);
                }

                callback(res);
            }
        })
}
exports.executeTTLCleanup = executeTTLCleanup;





