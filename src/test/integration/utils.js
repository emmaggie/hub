require('./integration_config.js');
var frisby = require('frisby');
var http = require('http');
var fs = require('fs');

function runInTestChannel(channelName, functionToExecute) {
    console.info('Ensuring that test channel has been created...');
    frisby.create('Ensuring that the test channel exists.')
        .post(channelUrl, null, { body: JSON.stringify({ "name": channelName})})
        .addHeader("Content-Type", "application/json")
        .expectStatus(200)
        .afterJSON(functionToExecute)
        .toss();
}

function randomChannelName() {
    return "test_" + Math.random().toString().replace(".", "_");
}

function download(url, completionHandler) {
    http.get(url, function (res) {
        var imagedata = '';
        res.setEncoding('binary');

        res.on('data', function (chunk) {
            imagedata += chunk
        });

        res.on('end', function () {
            completionHandler(imagedata);
        });
    });
}

exports.runInTestChannel = runInTestChannel;
exports.download = download;
exports.randomChannelName = randomChannelName;
