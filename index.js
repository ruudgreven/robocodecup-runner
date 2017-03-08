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
var readrecursive = require('fs-readdir-recursive');
var waitOn = require('wait-on');
var AdmZip = require('adm-zip');

var Docker = require('dockerode');
var docker = new Docker({socketPath:'/var/run/docker.sock', version: 'v1.13'});

var logFile = undefined;

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

    logFile = fs.createWriteStream(program.workingfolder + '/battles.log', { flags: 'a' });
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
                logFile.write('\n  Running container found with id ' + containerInfo.Id + '\n');
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
    var deferred = Q.defer();
    var promises = [];

    var files = fs.readdirSync(from);
    for (var i in files) {
        var filename = files[i];
        if (filename.indexOf('.jar') != -1) {
            promises.push(extractTeam(from + '/' + filename, to));
        }
    }

    Q.all(promises).then(function() {
        deferred.resolve()
    });

    return deferred.promise;
};

/**
 * Extract one team
 * @param teamfile The JAR file of the team
 * @param to The output folder
 */
var extractTeam = function(teamfile, to) {
    var deferred = Q.defer();

    fs.createReadStream(teamfile).pipe(unzip.Extract({path: to}))
        .on('close', function () {
            deferred.resolve();
        });

    return deferred.promise;
}

/**
 * Returns a list of teams for the battle files
 * @folder the working folder
 */
var checkAndListTeams = function(folder) {
    var deferred = Q.defer();

    var teamfiles = [];
    var classDefs = [];
    var validteams = [];

    //Find all .team and .class files
    var files = readrecursive(folder);
    for (var i in files) {
        var filename = files[i];
        if (filename.indexOf('.team') > -1) {
            teamfiles.push(filename);
        }

        if (filename.indexOf('.class') > -1) {
            classDefs.push(filename.substr(0, filename.length - 6).replace(/\//g, '.').trim());        //Remove .class postfix, and replace / with .
        }
    }

    //Check teams
    for (var i in teamfiles) {
        var teamfile = teamfiles[i];
        var teamname = teamfile.substr(0, teamfile.length - 5);
        teamname = teamname.replace(/\//g, '.');

        process.stdout.write(chalk.cyan('  Checking team configurations: ' + teamname + '...'));
        logFile.write('Checking team configurations: ' + teamname + '...');

        //Read file contents
        try {
            var contents = fs.readFileSync(folder + '/' + teamfile, 'utf8');
            var contentsArray = contents.split('\n');
            for (var j in contentsArray) {
                var line = contentsArray[j];

                //Check the teammembers
                if (line.startsWith('team.members=')) {
                    var robotcount = 0;
                    var robots = line.substr(13).split(',');
                    for (var k in robots) {
                        var robot = robots[k].trim();
                        if (classDefs.indexOf(robot) <= -1) {
                            if (classDefs.indexOf(robot.substr(0, robot.length - 1)) <= -1) {
                                throw 'Classfile for robot ' + robot + ' not found';
                            }
                        }
                        robotcount++;
                    }

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
            }

            process.stdout.write(chalk.bold.cyan('OK!\n'));
            logFile.write('OK!\n');

            //Adding team to validteams
            validteams.push({
                packagename: teamname.substr(0, teamname.lastIndexOf('.')),
                teamname: teamname.substr(teamname.lastIndexOf('.') + 1)
            });
        } catch (error) {
            console.error(chalk.bold.red(error));
        }
        deferred.resolve(validteams);
    }

    return deferred.promise;
};

/**
 * Generate battle files for the given teams in the given folder
 * @param teams The teams for which battlefiles should be generated
 * @param folder The folder were the outputfiles should be written
 * @param templatefile A template file for the robocode battle
 */
var generateBattles = function(teams, folder, templatefile) {
    var deferred = Q.defer();

    var templatecontents = fs.readFileSync(templatefile, 'utf8');
    var counter = 0;

    try {
        for (var i in teams) {
            var team1 = teams[i];
            for (var j in teams) {
                var team2 = teams[j];

                if (team1 != team2) {
                    var team1full = team1.packagename + '.' + team1.teamname;
                    var team2full = team2.packagename + '.' + team2.teamname;

                    var battlefilename = team1.packagename + '-' + team2.packagename + '.battle';
                    var battlefilecontents = templatecontents + 'robocode.battle.selectedRobots=' + team1full + '*,' + team2full + '*\n';

                    fs.writeFile(folder + '/' + battlefilename, battlefilecontents, function(err) {
                        if(err) {
                            throw err;
                        }
                    });

                    logFile.write('\n  Generate battle for ' + team1full + ' - ' + team2full + ' in file ' + battlefilename + '\n');

                    counter++;
                }
            }
        }

        teams.forEach(function(team1) {
            teams.forEach(function(team2) {

            });
        });

        deferred.resolve(counter);
    } catch (e) {
        deferred.reject('Error writing battle files: ' + e);
    }

    return deferred.promise;
};

/**
 * Run all the battle files in the given folder
 * @param folder The folder where the battlefiles are and where the output should be stored
 * @param container The container to run the battles in
 * @param count The number of battlefiles
 */
var runBattles = function(folder, container, count) {
    var deferred = Q.defer();

    var barOpts = {
        width: 40,
        total: count,
        clear: true
    };
    var bar = new ProgressBar('  Running [:bar] :percent :etas', barOpts);

    Q.async(function *() {
        var files = fs.readdirSync(folder);
        for (var i in files) {
            var filename = files[i];
            if (filename.indexOf('.battle') == (filename.length - 7)) {
                var battlefile = filename;
                var scorefile = filename.replace('.battle', '.result');
                var replayfile = filename.replace('.battle', '.br');

                try {
                    yield runBattle(folder, container, battlefile, scorefile, replayfile);
                } catch (e) {
                    logFile.write('      Error in running command. Takes to long. Going to the next one\n');
                }

                bar.tick(1);
            }
        }
    })().done(function() {
        deferred.resolve();
    })

    return deferred.promise;

};

/**
 * Runs the battle specified in the battle file
 * @param folder The working folder
 * @param container The container to run Robocode in
 * @param battlefile The battle file with the battle
 * @param scorefile The output file for the score
 * @param replayfile The output file for the replay
 * @returns {*|promise}
 */
var runBattle = function(folder, container, battlefile, scorefile, replayfile) {
    var deferred = Q.defer();

    //java -Xmx512M -Dsun.io.useCanonCaches=false -DROBOTPATH=robots/ -cp libs/robocode.jar:. robocode.Robocode -battle battles/intro.battle -nodisplay -results results.txt -record results.replay
    var options = {
        Cmd: ['java', '-Xmx512M', '-Dsun.io.useCanonCaches=false', '-DROBOTPATH=workingfolder/' , '-cp', 'libs/robocode.jar:.', 'robocode.Robocode', '-nodisplay', '-battle', 'workingfolder/' + battlefile, '-results', 'workingfolder/' + scorefile, '-record', 'workingfolder/' + replayfile],
        AttachStdout: true,
        AttachStderr: true
    };

    var logfile = folder + '/' + battlefile.replace('.battle', '.log');
    logFile.write('  Running battle ' + battlefile + '. Writing log to ' + logfile + '\n');
    var wstream = fs.createWriteStream(logfile);
    logFile.write('    Running command in docker: '+ options.Cmd.join(' ') + '\n');

    container.exec(options, function(err, exec) {
        if (err) deferred.reject('Error running Robocde command inside the container');;
        exec.start(function(err, stream) {
            if (err) deferred.reject('Error running Robocde command inside the container');
            container.modem.demuxStream(stream, wstream, wstream);

        });
    });

    var opts = {
        resources: [folder + '/' + scorefile],
        interval: 250,
        timeout: 60000        //Wait 1 minutes and then timeouts
    };
    waitOn(opts, function (err) {
        if (err) {
            deferred.reject('There was an error waiting for the results file');
            return deferred.promise;
        } else {
            deferred.resolve();
        }
    });

    return deferred.promise;
}


var parsingResults = function(folder) {
    var files = fs.readdirSync(folder);

    var battles = [];
    for (var i in files) {
        var filename = files[i];
        if (filename.indexOf('.result') > -1) {
            var battle = {};

            //Read lines 2 and 3
            var contents = fs.readFileSync(folder + '/' + filename, 'utf8');
            var contentsArray = contents.split('\n');

            battle.teams = [];

            for (var j = 2; j < contentsArray.length; j++) {
                var teamVals = contentsArray[j].split('\t');
                if (teamVals.length >= 11) {
                    var team = {
                        team_name: teamVals[0].substr(teamVals[0].indexOf(' ') + 1, teamVals[0].lastIndexOf('.') - teamVals[0].indexOf(' ') - 1),
                        points: 0,
                        totalscore: parseInt(teamVals[1].substr(0, teamVals[1].indexOf(' '))),
                        survivalscore: parseInt(teamVals[2]),
                        survivalbonus: parseInt(teamVals[3]),
                        bulletdamage: parseInt(teamVals[4]),
                        bulletBonus: parseInt(teamVals[5]),
                        ramdamage: parseInt(teamVals[6]),
                        rambonus: parseInt(teamVals[7]),
                        firsts: parseInt(teamVals[8]),
                        seconds: parseInt(teamVals[9]),
                        thirds: parseInt(teamVals[10])
                    }
                    battle.teams.push(team);
                }
            }

            //Set correct points
            battle.teams[0].points = 3;
            battle.teams[1].points = 1;

            //Add links to replay and score files
            battle.scorefile = filename;
            battle.replayfile = filename.replace('.result', '.br');
            battle.datetime = new Date(fs.statSync(folder + '/' + filename).ctime);

            battles.push(battle);
        }
    }

    return battles;
}

/**
 * Zip all the battles to one file
 * TODO: ZIP File seems corrupt
 * @param folder The working folder
 * @returns {string} The filename
 */
var zipAllFiles = function(folder) {
    var zip = new AdmZip();

    var files = fs.readdirSync(folder);
    for (var i in files) {
        var filename = files[i];
        if (filename.indexOf('.result') > -1 || filename.indexOf('.br') > -1) {
            zip.addLocalFile(folder + '/' + filename);
        }
    }

    var filename = folder + '/' + 'battles.zip';
    zip.writeZip(filename);
    return filename;
};

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
        logFile.write('Checking commandline arguments...');
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!');


        //STEP 1: Find a running container
        process.stdout.write(chalk.green('Checking for a running Docker container to use...'));
        logFile.write('Checking for a running Docker container to use...');
        var containerId = yield checkForRunningContainer();
        var container = docker.getContainer(containerId);
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!\n');

        //STEP 2: Extract JAR files
        process.stdout.write(chalk.green('Extracting team JAR files to working folder...'));
        logFile.write('Extracting team JAR files to working folder...');
        yield extractTeams(program.teamfolder, program.workingfolder);
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!\n');

        //STEP 3: Check teams
        process.stdout.write(chalk.green('Checking team configurations:\n'));
        logFile.write('Checking team configurations:\n');
        var teams = yield checkAndListTeams(program.workingfolder);

        //STEP 4: Generate battles
        process.stdout.write(chalk.green('Generating battles for ' + teams.length + ' teams...'));
        logFile.write('Generating battles for ' + teams.length + ' teams...');
        var battlecount = yield generateBattles(teams, program.workingfolder, __dirname + '/templates/default.battle');
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!\n');

        //STEP 5: Run battles
        process.stdout.write(chalk.green('Running ' + battlecount + ' battles:\n'));
        logFile.write('Running ' + battlecount + ' battles:\n');
        yield runBattles(program.workingfolder, container, battlecount);
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!\n');

        //STEP 6: Parsing results
        process.stdout.write(chalk.green('Parsing results...'));
        logFile.write('Parsing results...');
        battles = yield parsingResults(program.workingfolder);
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!\n');

        //STEP 7: Writing results
        process.stdout.write(chalk.green('Writing results...'));
        logFile.write('Writing results...');
        fs.writeFile(program.workingfolder + '/battles.json', JSON.stringify(battles, null, '\t'), function(err) {
            if(err) {
                throw err;
            }
        });
        process.stdout.write(chalk.bold.green('OK!\n'));
        logFile.write('OK!\n');

        //STEP 8: Zip all the .result, .br and the .json file to one file
        //process.stdout.write(chalk.green('Zipping results to one file...'));
        //logFile.write('Zipping results to one file...');
        //var outputfile = yield zipAllFiles(program.workingfolder);
        //process.stdout.write(chalk.bold.green('OK!\n'));
        //logFile.write('OK!\n');

        process.stdout.write(chalk.bold.green('\n'));
        process.stdout.write(chalk.green('Done! There are two files with all the output:\n'));
        process.stdout.write(chalk.bold.green('- ' + program.workingfolder + '/battles.json' + ' - A JSON dump of all battles and scores\n'));
        //process.stdout.write(chalk.bold.green('- ' + outputfile + ' - A ZIP file containing all replay and result files (But seems corrupt??? TODO: FIX)\n'));
        logFile.write('Done!\n');

        logFile.close();
    })().catch(function (error) {
        console.error(chalk.bold.red('\nError: ' + error));
        if (logFile != undefined) {
            logFile.write('\nError: ' + error + '\n');
            logFile.close();
        }
    }).done();
} catch (error) {
    console.error(chalk.red('\nError: ' + error));
    if (logFile != undefined) {
        logFile.write('\nError: ' + error + '\n');
        logFile.close();
    }

}
