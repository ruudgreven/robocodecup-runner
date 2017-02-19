#!/usr/bin/env node

var program = require('commander');
var co = require('co');
var prompt = require('co-prompt');
var chalk = require('chalk');
var ProgressBar = require('progress');
var fs = require('fs');
var path = require('path');
var Q = require('q');
var unzip = require('unzip');
var readrecursive = require('fs-readdir-recursive')

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
};

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
};

/**
 * Extract the JAR files
 * @param from The folder where the teams are
 * @param to The folder where the teams should be extracted
 */
var extractTeams = function(from, to) {
    var files = fs.readdirSync(from);
    for (var i in files) {
        fs.createReadStream(from + '/' + files[i]).pipe(unzip.Extract({ path: to }));
    }
};

/**
 * Returns a list of teams for the battle files
 */
var checkAndListTeams = function(folder) {
    var teamfiles = [];
    var classDefs = [];
    var validteams = [];

    //Find all .team and .class files
    readrecursive(folder).forEach(function(filename) {
        if (filename.indexOf('.team') > -1) {
            teamfiles.push(filename);
        }

        if (filename.indexOf('.class') > -1) {
            classDefs.push(filename.substr(0, filename.length - 6).replace(/\//g, '.'));        //Remove .class postfix, and replace / with .
        }
    });

    //Check teams
    teamfiles.forEach(function(teamfile) {
        var teamname = teamfile.substr(0, teamfile.length - 5);
        teamname = teamname.replace(/\//g, '.');

        process.stdout.write(chalk.cyan('  Checking team configurations: ' + teamname + '...'));

        //Read file contents
        try {
            var contents = fs.readFileSync(folder + '/' + teamfile, 'utf8');
            contents.split('\n').forEach(function(line) {

                //Check the teammembers
                if (line.startsWith('team.members=')) {
                    var robotcount = 0;
                    line.substr(13).split(',').forEach(function(robot) {
                        if (classDefs.indexOf(robot) <= -1) {
                            if (classDefs.indexOf(robot.substr(0, robot.length - 1)) <= -1) {
                                throw 'Classfile for robot ' + robot + ' not found';
                            }
                        }
                        robotcount++;
                    });

                    if (robotcount!=4) {
                        throw 'There must be 4 robots in the team. Found ' + robotcount;
                    }
                }

                //Check the robocode version
                if (line.startsWith('robocode.version=')) {
                    if (line.indexOf('1.9.2.6') <= -1) {
                        throw 'Wrong robocode version, must be 1.9.2.6, found ' + line.substr(17);
                    }
                }
            });

            process.stdout.write(chalk.bold.cyan('OK!\n'));

            //Adding team to validteams
            validteams.push(teamname);
        } catch (error) {
            process.stdout.write(chalk.red('ERROR!, ' + error + '\n'));
        }
    });

    return validteams;
};

/**
var extractTeam = function(container) {
    var deferred = Q.defer();

    //java -Xmx512M -Dsun.io.useCanonCaches=false -DROBOTPATH=robots/ -cp libs/robocode.jar:. robocode.Robocode -battle battles/intro.battle -nodisplay -results results.txt -record results.replay
    var options = {
        Cmd: ['jar', 'xvf', 'workingfolder/*.jar'],
        AttachStdout: true,
        AttachStderr: true
    };

    container.exec(options, function(err, exec) {
        if (err) deferred.reject('Error running JAR command inside the container');;
        exec.start(function(err, stream) {
            if (err) deferred.reject('Error running JAR command inside the container');;
            container.modem.demuxStream(stream, process.stdout, process.stderr);
            deferred.resolve();
        });
    });

    return deferred.promise;
}
**/

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
        var container = docker.getContainer(containerId);
        process.stdout.write(chalk.bold.green('OK!\n'));

        //STEP 2: Extract JAR files
        process.stdout.write(chalk.green('Extracting team JAR files to working folder...'));
        yield extractTeams(program.teamfolder, program.workingfolder);
        process.stdout.write(chalk.bold.green('OK!\n'));

        //STEP 3: Check teams
        process.stdout.write(chalk.green('Checking team configurations:\n'));
        var teams = yield checkAndListTeams(program.workingfolder);

        //STEP 4: Generate battles
        process.stdout.write(chalk.green('Generating battles for ' + teams.length + ' teams...'));

        process.stdout.write(chalk.bold.green('OK!\n'));

    })().catch(function (error) {
        console.error(chalk.bold.red('\nError: ' + error));
    }).done();
} catch (error) {
    console.error(chalk.red('\nError: ' + error));
}
