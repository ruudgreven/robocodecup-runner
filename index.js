#!/usr/bin/env node

var program = require('commander');
var co = require('co');
var prompt = require('co-prompt');
var chalk = require('chalk');
var ProgressBar = require('progress');
var fs = require('fs');
var path = require('path');
var Q = require('q');

var Docker = require('dockerode');
var docker = new Docker({socketPath:'/var/run/docker.sock', version: 'v1.13'});

/**
 * Check the arguments of the script
 */
var checkArguments = function() {
    if (!program.workingfolder) {
        throw 'Please specify a workingfolder. Check out --help or README.md'
    } else {
        if (!fs.existsSync(program.workingfolder)) {
            throw 'The workingfolder does not exists';
        }
    }
    if (!program.teamfolder) {
        throw 'Please specify a teamfolder. Check out --help or README.md'
    } else {
        if (!fs.existsSync(program.teamfolder)) {
            throw 'The teamfolder does not exists';
        }
    }
}

/**
 * Search for a container with the name robocoderunner.
 * @return a promise that resolved on the id if it is available, or undefined if it's not available
 */
var checkForRunningContainer = function() {
    var deferred = Q.defer();

    docker.listContainers(function (err, containers) {
        containers.forEach(function (containerInfo) {
            if (containerInfo.Image === 'robocoderunner') {
                deferred.resolve (containerInfo.Id);
            }
        });
        deferred.reject('No container running. Please check README.md for details');
    });
    return deferred.promise;
}


/**
 * Execute the script
 */
program
    .option('-w, --workingfolder <workingfolder>', 'The workingfolder for the script. Make sure this is shared with the docker image')
    .option('-t, --teamfolder <teamfolder>', 'The folder with the teamfiles (JAR files)')
    .parse(process.argv);

try {
    Q.async(function *() {
        //STEP 0: Check command-line arguments
        process.stdout.write(chalk.green('Checking commandline arguments...'));
        checkArguments(program);
        process.stdout.write(chalk.bold.green('OK!\n'));


        //STEP 1: Find a running container
        process.stdout.write(chalk.green('Checking for a running Docker container to use...'));
        var containerId = yield checkForRunningContainer();
        process.stdout.write(chalk.bold.green('OK!\n'));

        //STEP 2:

    })().catch(function (error) {
        console.error(chalk.bold.red('\nError: ' + error));
    }).done();
} catch (error) {
    console.error(chalk.red('\nError: ' + error));
}
