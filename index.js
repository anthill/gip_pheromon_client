"use strict";

var mqtt = require('mqtt');
var spawn = require('child_process').spawn;
var schedule = require('node-schedule');
var fs = require('fs');

var wifi = require('6sense').wifi();

var PRIVATE = require('./PRIVATE/common.json');
var id = require('./PRIVATE/id.json').id;


// === to set ===
var MEASURE_PERIOD = 300; // in seconds
var WAKEUP_HOUR_UTC = '07';
var SLEEP_HOUR_UTC = '22';
var SSH_TIMEOUT = 20 * 1000;
// ===

var sshProcess;
var client;
var inited = false;
var startJob;
var stopJob;

// Debug logger
var DEBUG = process.env.DEBUG || false;
var debug = function() {
    if (DEBUG) {
        [].unshift.call(arguments, '[DEBUG pheromon-client] ');
        console.log.apply(console, arguments);
    }
};

// Restart 6sense processes if the date is in the range.
function restart6senseIfNeeded() {
    return new Promise(function (resolve) {
        wifi.pause();
        setTimeout(function(){
            var date = new Date();
            var current_hour = date.getHours();

            if (current_hour < parseInt(SLEEP_HOUR_UTC, 10) && current_hour >= parseInt(WAKEUP_HOUR_UTC, 10)) {
                debug('Restarting measurements.');
                wifi.record(MEASURE_PERIOD);
            }

            resolve();
        }, 3000);
    });
}

function createStartJob() {
    return schedule.scheduleJob('00 ' + WAKEUP_HOUR_UTC + ' * * *', function(){
        console.log('Restarting measurements.');
        wifi.record(MEASURE_PERIOD);
    });
}

function createStopJob() {
    return schedule.scheduleJob('00 '+ SLEEP_HOUR_UTC + ' * * *', function(){
        console.log('Pausing measurements.');
        wifi.pause();
    });
}

function openTunnel(queenPort, antPort, target) {
            
    return new Promise(function(resolve, reject){
        var myProcess = spawn("ssh", ["-v", "-N", "-o", "StrictHostKeyChecking=no", "-R", queenPort + ":localhost:" + antPort, target]);
        debug("nodeprocess :", myProcess.pid, "myProcess: ", process.pid);
        myProcess.stderr.on("data", function(chunkBuffer){
            var message = chunkBuffer.toString();
            debug("ssh stderr => " + message);
            if (message.indexOf("remote forward success") !== -1){
                resolve(myProcess);
            } else if (message.indexOf("Warning: remote port forwarding failed for listen port") !== -1){
                reject({process: myProcess, msg:"Port already in use."});
            }
        });
        // if no error after SSH_TIMEOUT 
        setTimeout(function(){reject({process: myProcess, msg:"SSH timeout"}); }, SSH_TIMEOUT);
    });

}

// restart measurements at WAKEUP_HOUR_UTC
startJob = createStartJob();

// stop measurements at SLEEP_HOUR_UTC
stopJob = createStopJob();


// 6SENSE WIFI BLOCK

wifi.on('monitorError', function () {
    console.log("ERROR on wifi detection");
});

wifi.on('processed', function (results) {
    console.log('wifi measurements received');
    var payload = JSON.stringify([{
        value: results.devices.length,
        date: new Date().toISOString()
    }]);
    fs.appendFile(__dirname + '/measurements.json', payload, function (err) {
        console.log("Couldn't write to file. ", err)
    });
    send('measurement/'+id+'/measurement', payload, {qos: 1});
});

wifi.on('transition', function (status){
    send('status/'+id+'/wifi', status.toState);
    debug('wifi status sent :', status.toState);
});

// MQTT BLOCK

/*
** Subscribed on :
**  all
**  id
**
** Publish on :
**  init/id
**  status/id/client
**  measurement/id/measurement
**  cmdResult/id
*/

function mqttConnect() {

    client = mqtt.connect('mqtt://' + PRIVATE.host + ':' + PRIVATE.port,
        {
            username: "gip",
            password: PRIVATE.mqttToken,
            clientId: id,
            keepalive: 10,
            clean: false,
            reconnectPeriod: 1000 * 60 * 1
        }
    );

    client.on('connect', function(){
        console.log('connected to the server. ID :', id);
        client.subscribe('all', {qos: 1});
        client.subscribe(id + '/#', {qos: 1});
        if (!inited) {
            send('init/' + id, '');
            inited = true;
        }
    });

    client.on('offline', function(topic, message) {
        console.log("offline")
    })

    client.on('message', function(topic, buffer) {
        var destination = topic.split('/')[1]; // subtopics[0] is id or all => irrelevant

        var message = buffer.toString();
        console.log("data received :", message, 'destination', destination);

        commandHandler(message, send, 'cmdResult/'+id);
    });
}

function send(topic, message, options) {
    if (client)
        client.publish(topic, message, options);
    else {
        debug("mqtt client not ready");
        setTimeout(function() {
            send(topic, message, options);
        }, 10000);
    }
}



function openTunnel(queenPort, antPort, target) {
            
    return new Promise(function(resolve, reject){
        var myProcess = spawn("ssh", ["-v", "-N", "-o", "StrictHostKeyChecking=no", "-R", queenPort + ":localhost:" + antPort, target]);
        debug("nodeprocess :", myProcess.pid, "myProcess: ", process.pid);
        myProcess.stderr.on("data", function(chunkBuffer){
            var message = chunkBuffer.toString();
            debug("ssh stderr => " + message);
            if (message.indexOf("remote forward success") !== -1){
                resolve(myProcess);
            } else if (message.indexOf("Warning: remote port forwarding failed for listen port") !== -1){
                reject({process: myProcess, msg:"Port already in use."});
            }
        });
        // if no error after SSH_TIMEOUT 
        setTimeout(function(){reject({process: myProcess, msg:"SSH timeout"}); }, SSH_TIMEOUT);
    });
}

// COMMAND BLOCK

function commandHandler(fullCommand, sendFunction, topic) { // If a status is sent, his pattern is [command]:[status]

    var commandArgs = fullCommand.split(' ');
    var command = (commandArgs.length >= 1) ? commandArgs[0] : undefined;
    debug('command received : ' + command);
    debug("args :", commandArgs);

    switch(commandArgs.length) {

        case 1:
            // command with no parameter
            switch(command) {
                case 'status':               // Send statuses
                    send('status/'+id+'/wifi', wifi.state);
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    break;
                case 'reboot':               // Reboot the system
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    setTimeout(function () {
                        spawn('reboot');
                    }, 1000);
                    break;
                case 'resumerecord':         // Start recording
                    wifi.record(MEASURE_PERIOD);
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    break;
                case 'pauserecord':          // Pause recording
                    wifi.pause();
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    break;
                case 'closetunnel':          // Close the SSH tunnel
                    if (sshProcess)
                        sshProcess.kill('SIGINT');
                    setTimeout(function () {
                        if (sshProcess)
                            sshProcess.kill();
                    }, 2000);
                    send('cmdResult/'+id, JSON.stringify({command: 'closetunnel', result: 'OK'}));
                    send('status/'+id+'/client', 'connected');
                    break;
            }
            break;

        case 2:
            // command with one parameters
            switch(command) {
                case 'changeperiod':
                    if (commandArgs[1].toString().match(/^\d{1,5}$/)) {
                        MEASURE_PERIOD = parseInt(commandArgs[1], 10);

                        restart6senseIfNeeded()
                        .then(function () {
                            sendFunction(topic, JSON.stringify({command: command, result: commandArgs[1]}));
                        })
                        .catch(function (err) {
                            console.log('Error in restart6senseIfNeeded :', err);
                        });

                    } else {
                        console.log('Period is not an integer ', commandArgs[1]);
                        sendFunction(topic, JSON.stringify({command: command, result: 'KO'}));
                    }
                case 'changestarttime':      // Change the hour when it starts recording
                    if (commandArgs[1].match(/^\d{1,2}$/)) {
                        WAKEUP_HOUR_UTC = commandArgs[1];

                        restart6senseIfNeeded()
                        .then(function () {
                            sendFunction(topic, JSON.stringify({command: command, result: commandArgs[1]}));
                        })
                        .catch(function (err) {
                            console.log('Error in restart6senseIfNeeded :', err);
                        });

                        startJob.cancel();
                        startJob = schedule.scheduleJob('00 ' + WAKEUP_HOUR_UTC + ' * * *', function(){
                            console.log('Restarting measurements.');

                            wifi.record(MEASURE_PERIOD);

                        });
                    }
                    else
                        sendFunction(topic, JSON.stringify({command: command, result: 'KO'}));
                    break;
                case 'changestoptime':       // Change the hour when it stops recording
                    if (commandArgs[1].match(/^\d{1,2}$/)) {
                        SLEEP_HOUR_UTC = commandArgs[1];

                        restart6senseIfNeeded()
                        .then(function () {
                            sendFunction(topic, JSON.stringify({command: command, result: commandArgs[1]}));
                        })
                        .catch(function (err) {
                            console.log('Error in restart6senseIfNeeded :', err);
                        });

                        stopJob.cancel();
                        stopJob = schedule.scheduleJob('00 '+ SLEEP_HOUR_UTC + ' * * *', function(){
                            console.log('Pausing measurements.');

                            wifi.pause();
                        });
                    }
                    else
                        sendFunction(topic, JSON.stringify({command: command, result: 'KO'}));
                    break;
            }
            break;

        case 4:
            // command with three parameters
            switch(command) {
                case 'opentunnel':           // Open a reverse SSH tunnel
                    openTunnel(commandArgs[1], commandArgs[2], commandArgs[3])
                    .then(function(process){
                        sshProcess = process;
                        send('cmdResult/'+id, JSON.stringify({command: 'opentunnel', result: 'OK'}));
                        send('status/'+id+'/client', 'tunnelling');
                    })
                    .catch(function(err){
                        console.log(err.msg);
                        console.log("Could not make the tunnel. Cleanning...");
                        send('cmdResult/'+id, JSON.stringify({command: 'opentunnel', result: 'Error : '+err.msg}));
                    });
                    break;
            }
            break;
        case 5:
            // command with three parameters
            switch(command) {
                case 'init':                 // Initialize period, start and stop time
                    if (commandArgs[1].match(/^\d{1,5}$/) && commandArgs[2].match(/^\d{1,2}$/) && commandArgs[3].match(/^\d{1,2}$/)) {

                        MEASURE_PERIOD = parseInt(commandArgs[1], 10);
                        WAKEUP_HOUR_UTC = commandArgs[2];
                        SLEEP_HOUR_UTC = commandArgs[3];
                        var newDate = commandArgs[4].toUpperCase().replace('T', ' ').split('.')[0];

                        spawn('date', ['-s', newDate]);
                        
                        restart6senseIfNeeded()
                        .then(function(){
                            sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                            debug('init done');
                        })
                        .catch(function(){
                            sendFunction(topic, JSON.stringify({command: command, result: 'Error in restarting 6sense'}));
                        });

                    }
                    else {
                        sendFunction(topic, JSON.stringify({command: command, result: 'Error in arguments'}));
                        console.log('error in arguments of init');
                    }
                    break;
            }
            break;
        default:
            console.log('Unrecognized command.', commandArgs);
            break;


    }
}

mqttConnect();

